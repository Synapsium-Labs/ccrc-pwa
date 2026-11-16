// Overlord W1, the response record, Task 7 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md): the
// response lane seals each row once its window closes, defers a seal whose facts it cannot read at most a day past the
// window, and keeps the operator's retention through the deleter by time. Fixture store, the lane driven directly with
// the time as a fact. Neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import {
  deleteResponsesThroughInTx, insertPushResponseInTx, insertReceipt, insertWaitingResponseInTx, landPushVerdictInTx, recordResponseBoot,
} from '../src/coord/responsesStore.js';
import { RESPONSES_LANE_CAUSES_MAX, responsesLane } from '../src/responses/lane.js';
import { PUSH_WINDOW_MS, SEAL_DEFER_MS, WAITING_WINDOW_MS, type ResponseStamp } from '../../shared/responses.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const T = 1_800_000_000_000;
const DAY = 86_400_000;
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-responses-lane-'), '.ccrc', 'coord.db')));
const measured = (epoch: number, n = 4): ResponseStamp => ({ boot: { kind: 'measured', epoch }, restore: { kind: 'measured', n } });
const rows = (c: CoordStore): Record<string, unknown>[] => c.db.prepare('SELECT * FROM operator_responses ORDER BY id').all() as Record<string, unknown>[];
const one = (c: CoordStore, id: number): Record<string, unknown> => c.db.prepare('SELECT * FROM operator_responses WHERE id = ?').get(id) as Record<string, unknown>;

/** A delivered push carrying nothing with actions (so it can seal opened, not-opened or unmeasured), accepted on A and B. */
function pushRow(c: CoordStore, pushId: string, at: number, stamp: ResponseStamp, accepted: string[] = [A, B]): number {
  tx(c.db, () => {
    insertPushResponseInTx(c.db, { pushId, label: 'coord', carries: null, hasActions: true, tag: `tag-${pushId}`, stamp, at });
    if (accepted.length > 0) landPushVerdictInTx(c.db, pushId, { accepted, terminal: true, answered: true }, at);
  });
  return Number((c.db.prepare('SELECT id FROM operator_responses WHERE pushId = ?').get(pushId) as { id: number }).id);
}
const shownBy = (c: CoordStore, id: number, hash: string, at: number): void => {
  insertReceipt(c.db, id, { ref: { kind: 'push', pushId: 'x'.repeat(32) }, receipt: 'shown', from: { source: 'worker', version: 1, endpointHash: hash } }, at);
};
const run = (c: CoordStore, now: number, stamp: ResponseStamp | null = measured(1), lane = responsesLane(() => {})): void =>
  lane.run(c, stamp === null ? undefined : () => stamp, now);

describe('the seal', () => {
  it('a push row is sealed once at its window\'s end, and never again', () => {
    const c = store();
    c.db.prepare('INSERT INTO response_boots (epoch, bootedAt) VALUES (1, ?)').run(T - 10);
    const id = pushRow(c, '1'.repeat(32), T, measured(1));
    shownBy(c, id, A, T + 5); shownBy(c, id, B, T + 6);
    run(c, T + PUSH_WINDOW_MS - 1);
    expect(one(c, id)).toMatchObject({ state: 'delivered', sealedAt: null });
    run(c, T + PUSH_WINDOW_MS);
    expect(one(c, id)).toMatchObject({ state: 'sealed', outcome: 'not-opened', why: null, shownAt: T + 5, openedAt: null, sealedAt: T + PUSH_WINDOW_MS });
    insertReceipt(c.db, id, { ref: { kind: 'push', pushId: 'x'.repeat(32) }, receipt: 'opened', from: { source: 'worker', version: 1, endpointHash: A } }, T + 7);
    run(c, T + PUSH_WINDOW_MS + DAY);
    expect(one(c, id)).toMatchObject({ outcome: 'not-opened', sealedAt: T + PUSH_WINDOW_MS });
  });

  it('the store seals a row once: a second seal changes nothing (sealedAt IS NULL)', () => {
    const c = store();
    const id = pushRow(c, 'd'.repeat(32), T, measured(1));
    const first = { seal: true, outcome: 'opened', how: null, why: null, actedAt: null, shownAt: T + 1, openedAt: T + 2 } as const;
    expect(c.sealResponse(id, first, T + 10)).toEqual({ changed: true });
    expect(c.sealResponse(id, { ...first, outcome: 'not-opened', openedAt: null }, T + 20)).toEqual({ changed: false });
    expect(one(c, id)).toMatchObject({ outcome: 'opened', openedAt: T + 2, sealedAt: T + 10 });
  });

  it('a pending push is sealed unmeasured, no-verdict, 24 hours after its insert', () => {
    const c = store();
    const id = pushRow(c, '2'.repeat(32), T, measured(1), []);
    run(c, T + PUSH_WINDOW_MS);
    expect(one(c, id)).toMatchObject({ outcome: 'unmeasured', why: 'no-verdict' });
  });

  it('an owner read that fails defers the seal, then seals unmeasured, reader, a day after the window', () => {
    const c = store();
    const item = c.raiseItem({ program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Do it', why: 'because', how: ['step'],
      options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, T);
    tx(c.db, () => { insertWaitingResponseInTx(c.db, { source: 'item', id: item, stamp: measured(1), at: T }); });
    const id = Number((rows(c)[0] as { id: number }).id);
    vi.spyOn(c, 'itemHistory').mockImplementation(() => { throw new Error('disk gone'); });
    run(c, T + WAITING_WINDOW_MS);
    run(c, T + WAITING_WINDOW_MS + SEAL_DEFER_MS - 1);
    expect(one(c, id)).toMatchObject({ sealedAt: null });
    run(c, T + WAITING_WINDOW_MS + SEAL_DEFER_MS);
    expect(one(c, id)).toMatchObject({ outcome: 'unmeasured', why: 'reader', how: null, actedAt: null });
  });

  it('a Waiting on you row whose item the operator ticked seals acted, tick, before its seven days', () => {
    const c = store();
    const item = c.raiseItem({ program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Do it', why: 'because', how: ['step'],
      options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, T);
    tx(c.db, () => { insertWaitingResponseInTx(c.db, { source: 'item', id: item, stamp: measured(1), at: T }); });
    expect(c.moveItem(item, 'tick', 'operator', { answer: null }, T + DAY, { programmeHasOpenRun: true })).toMatchObject({ ok: true });
    run(c, T + DAY + 1);
    expect(rows(c)[0]).toMatchObject({ outcome: 'acted', how: 'tick', actedAt: T + DAY, sealedAt: T + DAY + 1 });
  });

  it('a push whose window holds a boot seals unmeasured, receipts, where it would have been not-opened', () => {
    const c = store();
    const id = pushRow(c, '3'.repeat(32), T, measured(1));
    shownBy(c, id, A, T + 5); shownBy(c, id, B, T + 6);
    recordResponseBoot(c.db, 'sha-2', T + 60_000);
    run(c, T + PUSH_WINDOW_MS, measured(2));
    expect(one(c, id)).toMatchObject({ outcome: 'unmeasured', why: 'receipts' });
  });

  it('the roll-back-and-forward case: v2 inserts, v1 boots, v2 boots; equal builds at the ends still seal unmeasured, receipts', () => {
    const c = store();
    recordResponseBoot(c.db, 'sha-v2', T - 10);
    const id = pushRow(c, '4'.repeat(32), T, measured(1));
    shownBy(c, id, A, T + 5); shownBy(c, id, B, T + 6);
    recordResponseBoot(c.db, 'sha-v1', T + 60_000);
    recordResponseBoot(c.db, 'sha-v2', T + 120_000);
    run(c, T + PUSH_WINDOW_MS, measured(3));
    expect(one(c, id)).toMatchObject({ outcome: 'unmeasured', why: 'receipts' });
  });

  it('no stamp source this pass leaves every row for a pass that has one', () => {
    const c = store();
    const id = pushRow(c, '5'.repeat(32), T, measured(1), []);
    run(c, T + 9 * DAY, null);
    expect(one(c, id)).toMatchObject({ sealedAt: null });
  });

  it('a failing cause logs once while it recurs, again after a pass it cleared in, and the causes one pass keeps are bounded (review 2260 F11)', () => {
    const c = store();
    const lines: string[] = [];
    const lane = responsesLane((l) => lines.push(l));
    const ids = Array.from({ length: RESPONSES_LANE_CAUSES_MAX + 8 }, (_, i) => pushRow(c, i.toString(16).padStart(32, '7'), T, measured(1), []));
    const seal = vi.spyOn(c, 'sealResponse').mockImplementation((id) => { throw new Error(`seal broke on ${id}`); });
    lane.run(c, () => measured(1), T + 9 * DAY);
    lane.run(c, () => measured(1), T + 9 * DAY);
    const sealLines = (): string[] => lines.filter((l) => l.includes('seal broke'));
    expect(sealLines()).toHaveLength(RESPONSES_LANE_CAUSES_MAX);
    expect(lines.filter((l) => l.includes('8 more failing causes'))).toHaveLength(1);
    // A pass that seals cleanly clears every cause; the same cause failing after it is logged again.
    seal.mockImplementation(() => ({ changed: false }));
    lane.run(c, () => measured(1), T + 9 * DAY);
    seal.mockImplementation((id) => { throw new Error(`seal broke on ${id}`); });
    lane.run(c, () => measured(1), T + 9 * DAY);
    expect(sealLines().filter((l) => l.includes(`seal broke on ${ids[0]})`))).toHaveLength(2);
    expect(lines.filter((l) => l.includes('more failing causes'))).toHaveLength(2);
  });

  it('a failing seal does not stop retention', () => {
    const c = store();
    const old = pushRow(c, '6'.repeat(32), T - 400 * DAY, measured(1), []);
    vi.spyOn(c, 'sealResponse').mockImplementation(() => { throw new Error('seal broke'); });
    run(c, T);
    expect(c.db.prepare('SELECT id FROM operator_responses WHERE id = ?').get(old)).toBeUndefined();
  });
});

describe('retention and the deleter by time', () => {
  it('deletes rows, their receipts and older boots past the period, keeps the newest boot and the rest', () => {
    const c = store();
    recordResponseBoot(c.db, null, T - 300 * DAY);
    recordResponseBoot(c.db, null, T - 250 * DAY);
    const old = pushRow(c, '7'.repeat(32), T - 200 * DAY, measured(1));
    shownBy(c, old, A, T - 200 * DAY + 5);
    const recent = pushRow(c, '8'.repeat(32), T - 10 * DAY, measured(1));
    shownBy(c, recent, A, T - 10 * DAY + 5);
    run(c, T);
    expect(rows(c).map((r) => r.id)).toEqual([recent]);
    expect(c.db.prepare('SELECT responseId FROM response_receipts').all()).toEqual([{ responseId: recent }]);
    expect(c.db.prepare('SELECT bootedAt FROM response_boots').all()).toEqual([{ bootedAt: T - 250 * DAY }]);
  });

  it('the operator\'s setting decides the period', () => {
    const c = store();
    const row = pushRow(c, '9'.repeat(32), T - 20 * DAY, measured(1));
    run(c, T);
    expect(one(c, row)).toBeDefined();
    c.setResponseRetention(14, T);
    run(c, T);
    expect(c.db.prepare('SELECT id FROM operator_responses WHERE id = ?').get(row)).toBeUndefined();
  });

  it('a caller\'s open transaction runs the InTx form without a nested BEGIN', () => {
    const c = store();
    pushRow(c, 'a'.repeat(32), T - 400 * DAY, measured(1));
    expect(() => tx(c.db, () => deleteResponsesThroughInTx(c.db, T - 180 * DAY))).not.toThrow();
    expect(rows(c)).toEqual([]);
  });

  it('a throw between the receipts and the rows leaves both in place (one transaction)', () => {
    const c = store();
    const row = pushRow(c, 'b'.repeat(32), T - 400 * DAY, measured(1));
    shownBy(c, row, A, T - 400 * DAY + 5);
    c.db.exec("CREATE TRIGGER no_delete BEFORE DELETE ON operator_responses BEGIN SELECT RAISE(ABORT, 'no deletes'); END");
    expect(() => c.deleteResponsesThrough(T)).toThrow();
    expect(rows(c)).toHaveLength(1);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM response_receipts').get()).toEqual({ n: 1 });
  });

  it('an unreadable setting deletes nothing, and warns once over two passes', () => {
    const c = store();
    const row = pushRow(c, 'c'.repeat(32), T - 400 * DAY, measured(1), []);
    c.db.prepare('UPDATE response_settings SET retentionDays = 0').run();
    const lines: string[] = [];
    const lane = responsesLane((l) => lines.push(l));
    lane.run(c, undefined, T);
    lane.run(c, undefined, T + 1);
    expect(one(c, row)).toBeDefined();
    expect(lines.filter((l) => l.includes('retention setting is unreadable'))).toHaveLength(1);
    c.db.prepare('DELETE FROM response_settings').run();
    lane.run(c, undefined, T + 2);
    expect(one(c, row)).toBeDefined();
  });
});
