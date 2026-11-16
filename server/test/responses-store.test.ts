// Overlord W1, the response record (Task 2: plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md):
// `operator_responses`, `response_receipts` and `response_boots`, each fact with one writer. Every insert names its
// conflict, so a repeat is nothing and a CHECK violation throws; one row per push id, per Waiting on you source, per
// digest key; a push row's verdict joins its accepted set, and a never-delivered row is removed only on a terminal,
// answered move.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import {
  insertPushResponseInTx, insertReceipt, landPushVerdictInTx, recordResponseBoot, responseRowForRef,
  type PushResponseInsert,
} from '../src/coord/responsesStore.js';
import { receiptVerdict } from '../src/responses.js';
import { PUSH_WINDOW_MS, type ReceiptIn, type ResponseStamp } from '../../shared/responses.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const NOW = 1_800_000_000_000;
const STAMP: ResponseStamp = { boot: { kind: 'measured', epoch: 1 }, restore: { kind: 'unmeasured' } };
const dbPathIn = (dir: string): string => path.join(dir, '.ccrc', 'coord.db');
const store = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-responses-'))));
const PID = 'a'.repeat(32);
const HASH = (c: string): string => c.repeat(64);
const push = (over: Partial<PushResponseInsert> = {}): PushResponseInsert =>
  ({ pushId: PID, label: 'ask', carries: { kind: 'ask', id: 7 }, hasActions: true, tag: 'ask-7', stamp: STAMP, at: NOW, ...over });
const rows = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT * FROM operator_responses ORDER BY id').all() as Record<string, unknown>[];
const receipts = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT * FROM response_receipts ORDER BY id').all() as Record<string, unknown>[];
const shown = (hash: string, pushId = PID): ReceiptIn =>
  ({ ref: { kind: 'push', pushId }, receipt: 'shown', from: { source: 'worker', version: 1, endpointHash: hash } });
const land = (s: CoordStore, accepted: string[], terminal: boolean, answered: boolean, at = NOW + 1): ReturnType<typeof landPushVerdictInTx> =>
  tx(s.db, () => landPushVerdictInTx(s.db, PID, { accepted, terminal, answered }, at));

const SLOT = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE operator_responses (')) + 1;

describe('the migration (Table 11.1a, M37)', () => {
  it('creates the three tables once, in one slot', () => {
    expect(SLOT).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE push_outbox (')) + 1);
    expect(MIGRATIONS.filter((m) => /CREATE TABLE (operator_responses|response_receipts|response_boots) /.test(m))).toHaveLength(1);
    expect(MIGRATIONS[SLOT - 1]).toContain('CREATE TABLE response_receipts (');
    expect(MIGRATIONS[SLOT - 1]).toContain('CREATE TABLE response_boots (');
  });

  it('applies on a database at the previous user_version', () => {
    const p = dbPathIn(mkTmp('ccrc-responses-mig-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${SLOT - 1}`); });
    raw.close();
    const db = openCoordDb(p);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['operator_responses', 'response_receipts', 'response_boots']));
  });
});

describe('the keys refuse for real (review 2184 F1)', () => {
  const ins = (s: CoordStore, sql: string): void => { s.db.prepare(sql).run(); };
  const COLS = '(kind, label, pushId, refKind, refId, refKey, delivery, state, bootMeasured, restoreMeasured, insertedAt)';
  it('the same Waiting on you source twice gives one row', () => {
    const s = store();
    for (let i = 0; i < 2; i++) {
      ins(s, `INSERT INTO operator_responses ${COLS} VALUES ('waiting', 'item', NULL, 'item', 3, NULL, 'at-once', 'pending', 0, 0, 1) `
        + "ON CONFLICT(refKind, refId) WHERE kind = 'waiting' DO NOTHING");
    }
    expect(rows(s)).toHaveLength(1);
  });
  it('the same digest key twice gives one row', () => {
    const s = store();
    for (let i = 0; i < 2; i++) {
      ins(s, `INSERT INTO operator_responses ${COLS} VALUES ('digest', 'ask', NULL, NULL, NULL, '2026-11-16:ask:4', 'at-once', 'pending', 0, 0, 1) `
        + "ON CONFLICT(refKey) WHERE kind = 'digest' DO NOTHING");
    }
    expect(rows(s)).toHaveLength(1);
  });
  it('the same push id twice gives one row, and the second answers inserted: false', () => {
    const s = store();
    expect(tx(s.db, () => insertPushResponseInTx(s.db, push()))).toEqual({ inserted: true });
    expect(tx(s.db, () => insertPushResponseInTx(s.db, push({ label: 'item' })))).toEqual({ inserted: false });
    expect(rows(s)).toHaveLength(1);
    expect(rows(s)[0]).toMatchObject({ kind: 'push', label: 'ask', pushId: PID, carriesKind: 'ask', carriesId: 7, hasActions: 1,
      tag: 'ask-7', delivery: 'at-once', state: 'pending', bootMeasured: 1, bootEpoch: 1, restoreMeasured: 0,
      restoreGeneration: null, insertedAt: NOW, acceptedSubs: '[]', sends: 0, deliveredAt: null, sealedAt: null });
  });
});

describe('a CHECK throws through the writer\'s own statement form (never INSERT OR IGNORE)', () => {
  const form = (s: CoordStore, values: string, target: string): void => {
    s.db.prepare('INSERT INTO operator_responses (kind, label, pushId, refKind, refId, refKey, delivery, state, bootMeasured, bootEpoch, '
      + `restoreMeasured, insertedAt) VALUES (${values}) ON CONFLICT(${target}) DO NOTHING`).run();
  };
  it('a measured boot with no epoch', () => {
    const s = store();
    expect(() => tx(s.db, () => insertPushResponseInTx(s.db, push({ stamp: { boot: { kind: 'measured', epoch: null as never }, restore: { kind: 'unmeasured' } } }))))
      .toThrow(/CHECK/);
    expect(rows(s)).toHaveLength(0);
  });
  it('a push with no push id', () => {
    const s = store();
    expect(() => form(s, "'push', 'ask', NULL, NULL, NULL, NULL, 'at-once', 'pending', 0, NULL, 0, 1", 'pushId')).toThrow(/CHECK/);
  });
  it('a Waiting on you row carrying a push id', () => {
    const s = store();
    expect(() => form(s, `'waiting', 'item', '${PID}', 'item', 3, NULL, 'at-once', 'pending', 0, NULL, 0, 1`, "refKind, refId) WHERE (kind = 'waiting'"))
      .toThrow(/CHECK/);
  });
});

describe('the verdict lands on the push row (landPushVerdictInTx)', () => {
  it('two accepted hashes set the set, sends 1, deliveredAt and windowCapAt; a second landing joins a third', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    expect(land(s, [HASH('c'), HASH('b')], true, true)).toEqual({ changed: true, removed: false });
    expect(rows(s)[0]).toMatchObject({ state: 'delivered', acceptedSubs: JSON.stringify([HASH('b'), HASH('c')]), sends: 1,
      deliveredAt: NOW + 1, admittedAt: NOW + 1, windowCapAt: NOW + 1 + PUSH_WINDOW_MS });
    expect(PUSH_WINDOW_MS).toBe(24 * 3_600_000);
    land(s, [HASH('a'), HASH('b')], true, true, NOW + 50);
    expect(rows(s)[0]).toMatchObject({ acceptedSubs: JSON.stringify([HASH('a'), HASH('b'), HASH('c')]), sends: 2, deliveredAt: NOW + 1,
      windowCapAt: NOW + 1 + PUSH_WINDOW_MS });
  });

  it('a never-delivered row: removed on a terminal, answered move; kept on retrying or unknown', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    expect(land(s, [], false, true)).toEqual({ changed: false, removed: false });   // retrying
    expect(land(s, [], true, false)).toEqual({ changed: false, removed: false });   // unknown: no-answer
    expect(rows(s)[0]).toMatchObject({ state: 'pending' });
    expect(land(s, [], true, true)).toEqual({ changed: true, removed: true });     // failed, unsent, silent
    expect(rows(s)).toHaveLength(0);
  });

  it('a never-delivered row holding a receipt is never removed: it keeps its receipt (review 2214 F2)', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    insertReceipt(s.db, Number(rows(s)[0]!.id), shown(HASH('d')), NOW);
    expect(land(s, [], true, true)).toEqual({ changed: false, removed: false });
    expect(rows(s)).toEqual([expect.objectContaining({ state: 'pending' })]);
    expect(receipts(s)).toHaveLength(1);
  });

  it('the same terminal, answered, unaccepted landing on a delivered row removes nothing', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    land(s, [HASH('b')], false, true);
    expect(land(s, [], true, true)).toEqual({ changed: false, removed: false });
    expect(rows(s)[0]).toMatchObject({ state: 'delivered', sends: 1 });
  });

  it('a landing on a sealed row adds to sends only', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    land(s, [HASH('b')], true, true);
    s.db.prepare("UPDATE operator_responses SET state = 'sealed', sealedAt = ?, outcome = 'opened'").run(NOW + 5);
    const before = rows(s)[0]!;
    land(s, [HASH('z')], true, true, NOW + 99);
    expect(rows(s)[0]).toEqual({ ...before, sends: 2 });
    expect(land(s, [], true, true)).toEqual({ changed: false, removed: false });
    expect(rows(s)).toHaveLength(1);
  });

  it('a push id with no row lands nothing', () => {
    const s = store();
    expect(land(s, [HASH('b')], true, true)).toEqual({ changed: false, removed: false });
  });
});

describe('the boots (question 17)', () => {
  it('two boots give two increasing epochs', () => {
    const s = store();
    const a = recordResponseBoot(s.db, 'abc', NOW);
    const b = s.recordResponseBoot(null, NOW + 1);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect((b as { epoch: number }).epoch).toBeGreaterThan((a as { epoch: number }).epoch);
  });
  it('a failed write answers ok: false, never a throw', () => {
    const s = store();
    s.db.exec('DROP TABLE response_boots');
    expect(recordResponseBoot(s.db, 'abc', NOW)).toMatchObject({ ok: false, detail: expect.stringContaining('response_boots') });
  });
});

describe('the receipts', () => {
  it('the same receipt twice keeps one', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    const id = Number(rows(s)[0]!.id);
    expect(insertReceipt(s.db, id, shown(HASH('d')), NOW)).toEqual({ kept: true });
    expect(insertReceipt(s.db, id, shown(HASH('d')), NOW + 1)).toEqual({ kept: false });
    expect(insertReceipt(s.db, id, { ref: { kind: 'push', pushId: PID }, receipt: 'opened', from: { source: 'console' } }, NOW)).toEqual({ kept: true });
    expect(receipts(s)).toEqual([
      expect.objectContaining({ responseId: id, receipt: 'shown', source: 'worker', version: 1, endpointHash: HASH('d'), at: NOW }),
      expect.objectContaining({ responseId: id, receipt: 'opened', source: 'console', version: null, endpointHash: '' }),
    ]);
  });

  it('receiveReceipts reads, asks the verdict and writes in one transaction', () => {
    const s = store();
    const one = (r: ReceiptIn): unknown => { const a = s.receiveReceipts([r], NOW, receiptVerdict); return a.ok ? a.answers[0] : a; };
    expect(one(shown(HASH('d')))).toEqual({ kept: false, why: 'no-row' });
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    expect(one(shown(HASH('d')))).toEqual({ kept: true });
    expect(one(shown(HASH('d')))).toEqual({ kept: false, why: 'repeat' });
    land(s, [HASH('b')], true, true);
    expect(one(shown(HASH('e')))).toEqual({ kept: false, why: 'not-accepted' });
    const seen: unknown[] = [];
    s.receiveReceipts([shown(HASH('b'))], NOW, (r, f) => { seen.push(f); return receiptVerdict(r, f); });
    expect(seen).toEqual([{ row: { kind: 'push', state: 'delivered', acceptedSubs: [HASH('b')] }, workerReceipts: 1 }]);
  });

  it('a failed read rolls the whole body back', () => {
    const s = store();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    tx(s.db, () => insertPushResponseInTx(s.db, push({ pushId: 'b'.repeat(32) })));
    s.db.prepare("UPDATE operator_responses SET acceptedSubs = 'nope' WHERE pushId = ?").run('b'.repeat(32));
    expect(s.receiveReceipts([shown(HASH('d')), shown(HASH('d'), 'b'.repeat(32))], NOW, receiptVerdict))
      .toMatchObject({ ok: false, detail: expect.stringContaining('acceptedSubs is not JSON') });
    expect(receipts(s)).toHaveLength(0);
  });

  it('a row whose state is an unknown word is answered unreadable, not dropped and not folded', () => {
    const s = store();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    s.db.prepare("UPDATE operator_responses SET state = 'weighed'").run();
    const read = responseRowForRef(s.db, { kind: 'push', pushId: PID });
    expect(read).toMatchObject({ ok: false, detail: expect.stringContaining('state weighed is not known') });
    expect(s.receiveReceipts([shown(HASH('d'))], NOW, receiptVerdict)).toMatchObject({ ok: false });
    expect(receipts(s)).toHaveLength(0);
    expect(rows(s)).toHaveLength(1);
  });

  it('a ref names its own kind of row only', () => {
    const s = store();
    tx(s.db, () => insertPushResponseInTx(s.db, push()));
    expect(responseRowForRef(s.db, { kind: 'ask', id: 7 })).toEqual({ ok: true, row: null });
    expect(responseRowForRef(s.db, { kind: 'push', pushId: PID })).toMatchObject({ ok: true, row: { kind: 'push', state: 'pending',
      acceptedSubs: [], workerReceipts: { shown: 0, opened: 0 } } });
  });
});
