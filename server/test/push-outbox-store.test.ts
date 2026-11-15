// Overlord W1, the push outbox (Task 3: plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md):
// `push_outbox`, its moves through `OUTBOX_TRANSITIONS`, the reach stamp's one writer, and the reads. Every move is a
// compare-and-set on its `from` state; a verdict lands only on the claim it answers; a bound row is written inside its
// move's transaction and rolls back with it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { tx } from '../src/coord/tx.js';
import { raiseItem } from '../src/coord/ledgersStore.js';
import {
  armBoundRowInTx, claimOutboxRow, insertBoundRowInTx, markOutboxVerdict, stampReach,
  type OutboxPayload, type OutboxVerdictMove,
} from '../src/coord/pushOutboxStore.js';
import type { PushSilentWhy } from '../../shared/push-outbox.js';
import type { PushSendVerdict } from '../../shared/push-outbox.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-outbox-'), '.ccrc', 'coord.db')));
const PAYLOAD: OutboxPayload = { title: 'Waiting on you', body: 'Pick one', sessionId: '', tag: 'item-1', url: '/waiting' };
const ACCEPTED: PushSendVerdict = { kind: 'sent', subs: [{ endpointHash: 'ab', verdict: 'accepted', status: 201 }] };
const REFUSED: PushSendVerdict = { kind: 'sent', subs: [{ endpointHash: 'ab', verdict: 'refused', status: 503 }] };
const SENT: OutboxVerdictMove = { to: 'sent', verdict: ACCEPTED };
const retry = (nextAttemptAt: number): OutboxVerdictMove => ({ to: 'retrying', verdict: REFUSED, nextAttemptAt });
let ids = 0;
const pushId = (): string => `p${String(++ids).padStart(31, '0')}`;

/** An ask row, written as `insertAsk` writes one, held. */
const ask = (s: CoordStore): number => Number(s.db.prepare(
  "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state) VALUES (?, 'lane-a-project-a', "
  + "'lane-b-project-a', NULL, 'k', ?, 'd', 'Proceed?', '[\"Yes\",\"No\"]', 'held')").run(NOW, NOW).lastInsertRowid);
const item = (s: CoordStore, over: { heldUntil?: number | null; neededBy?: 'blocking' | 'soon' | 'later' } = {}): number =>
  raiseItem(s.db, { program: 'prog-a', runId: null, raisedBy: 'lane-b-project-a', kind: 'do', title: 'Do it', why: 'because',
    how: ['step'], options: null, neededBy: over.neededBy ?? 'soon', soonLabel: null, secretSlot: null, heldUntil: over.heldUntil ?? null }, NOW);
const rows = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT id, pushId, sourceKind, sourceId, payload, tag, state, armedAt, claimSeq, attempts, nextAttemptAt, pushedAt, '
    + 'silentWhy, settledAt FROM push_outbox ORDER BY id').all() as Record<string, unknown>[];
const bound = (s: CoordStore, sourceId: number, over: { source?: 'ask' | 'item'; at?: number } = {}): number =>
  tx(s.db, () => insertBoundRowInTx(s.db, { source: 'item', sourceId, pushId: pushId(), payload: PAYLOAD, state: 'pending',
    at: NOW, ...over }));
const silent = (s: CoordStore, sourceId: number, silentWhy: PushSilentWhy, over: { payload?: OutboxPayload | null; at?: number } = {}): number =>
  tx(s.db, () => insertBoundRowInTx(s.db, { source: 'item', sourceId, pushId: pushId(), payload: PAYLOAD, state: 'silent',
    silentWhy, at: NOW, ...over }));
const warnings = (): (() => string[]) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return () => warn.mock.calls.map((c) => String(c[0]));
};
const reachOf = (s: CoordStore, table: 'asks' | 'operator_items', id: number): unknown =>
  (s.db.prepare(`SELECT reachedOperatorAt FROM ${table} WHERE id = ?`).get(id) as { reachedOperatorAt: unknown }).reachedOperatorAt;

describe('push_outbox: the table (Overlord §6.7, Table 11.1a)', () => {
  it('the migration\'s slot is found by its DDL, and the table is created once', () => {
    const slot = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE push_outbox (')) + 1;
    expect(slot).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_probes')) + 1);
    expect(MIGRATIONS.filter((m) => m.includes('CREATE TABLE push_outbox'))).toHaveLength(1);
    expect(MIGRATIONS[slot - 1]).toContain('ALTER TABLE asks ADD COLUMN reachedOperatorAt INTEGER');
    expect(MIGRATIONS[slot - 1]).toContain('ALTER TABLE operator_items ADD COLUMN reachedOperatorAt INTEGER');
  });

  it('the CHECK refuses a source kind without an id, and an id without a kind', () => {
    const s = store();
    expect(() => s.db.prepare("INSERT INTO push_outbox (pushId, sourceKind, sourceId, tag, state, createdAt, armedAt) VALUES ('x', 'ask', NULL, 't', 'pending', 1, 1)").run())
      .toThrow(/CHECK/);
    expect(() => s.db.prepare("INSERT INTO push_outbox (pushId, sourceKind, sourceId, tag, state, createdAt, armedAt) VALUES ('y', NULL, 3, 't', 'pending', 1, 1)").run())
      .toThrow(/CHECK/);
  });

  it('the push id is unique', () => {
    const s = store();
    s.insertUnboundRow({ pushId: 'same', payload: PAYLOAD, at: NOW });
    expect(s.insertUnboundRow({ pushId: 'same', payload: PAYLOAD, at: NOW })).toMatchObject({ ok: false });
  });
});

describe('a bound row and the reach stamp (I2, C31)', () => {
  it('a bound row and its stamp written in a tx that then throws: neither lands', () => {
    const s = store();
    const id = item(s);
    expect(() => tx(s.db, () => {
      stampReach(s.db, 'item', id, NOW);
      insertBoundRowInTx(s.db, { source: 'item', sourceId: id, pushId: pushId(), payload: PAYLOAD, state: 'pending', at: NOW });
      throw new Error('the move failed');
    })).toThrow('the move failed');
    expect(rows(s)).toEqual([]);
    expect(reachOf(s, 'operator_items', id)).toBeNull();
  });

  it('a second bound row for the same source is refused by the unique index, and rolls its move back', () => {
    const s = store();
    const id = item(s);
    bound(s, id);
    expect(() => bound(s, id)).toThrow(/UNIQUE/);
    expect(rows(s)).toHaveLength(1);
  });

  it('an ask and an item with the same id are two sources', () => {
    const s = store();
    bound(s, 1, { source: 'item' });
    bound(s, 1, { source: 'ask' });
    expect(rows(s).map((r) => r.sourceKind)).toEqual(['item', 'ask']);
  });

  it('stampReach changes once and answers changed: false the second time, on asks and on items', () => {
    const s = store();
    const a = ask(s);
    const i = item(s);
    expect(tx(s.db, () => stampReach(s.db, 'ask', a, NOW))).toEqual({ changed: true });
    expect(tx(s.db, () => stampReach(s.db, 'ask', a, NOW + 5))).toEqual({ changed: false });
    expect(reachOf(s, 'asks', a)).toBe(NOW);
    expect(tx(s.db, () => stampReach(s.db, 'item', i, NOW + 1))).toEqual({ changed: true });
    expect(tx(s.db, () => stampReach(s.db, 'item', i, NOW + 9))).toEqual({ changed: false });
    expect(reachOf(s, 'operator_items', i)).toBe(NOW + 1);
  });

  it('a silent bound row stores no payload, keeps its tag and why, and is settled at once', () => {
    const s = store();
    silent(s, item(s), 'level');
    expect(rows(s)[0]).toMatchObject({ state: 'silent', payload: null, tag: 'item-1', silentWhy: 'level', settledAt: NOW });
  });

  it('a no-service row stores a null payload and a null tag (slug tag-null-without-payload)', () => {
    const s = store();
    silent(s, item(s), 'no-service', { payload: null });
    expect(rows(s)[0]).toMatchObject({ state: 'silent', payload: null, tag: null, silentWhy: 'no-service' });
  });

  it('the types make the departure true: a payload with no tag, pending with no payload, silent with no why, sent with no verdict', () => {
    const tagless = { title: 'a', body: 'b' };
    // @ts-expect-error a payload with no tag is not an OutboxPayload (slug tag-null-without-payload)
    const p: OutboxPayload = tagless;
    // @ts-expect-error a pending row carries a payload
    const pending: Parameters<typeof insertBoundRowInTx>[1] = { source: 'item', sourceId: 1, pushId: 'x', payload: null, state: 'pending', at: NOW };
    // @ts-expect-error a silent row carries its why
    const quiet: Parameters<typeof insertBoundRowInTx>[1] = { source: 'item', sourceId: 1, pushId: 'x', payload: null, state: 'silent', at: NOW };
    // @ts-expect-error a sent verdict carries the verdict
    const sent: OutboxVerdictMove = { to: 'sent', verdict: null };
    // @ts-expect-error a retry carries its time
    const again: OutboxVerdictMove = { to: 'retrying', verdict: REFUSED };
    expect([p, pending, quiet, sent, again]).toHaveLength(5);
  });

  it('a stored payload with no tag is unreadable, never a row with a null tag beside a payload', () => {
    const s = store();
    const read = warnings();
    const id = bound(s, item(s));
    s.db.prepare('UPDATE push_outbox SET payload = ? WHERE id = ?').run(JSON.stringify({ title: 'a', body: 'b' }), id);
    expect(s.dueOutboxRows(NOW)).toMatchObject({ ok: true, rows: [], unreadable: [{ id }] });
    expect(read()).toHaveLength(1);
  });

  it('a pending bound row is due', () => {
    const s = store();
    const id = bound(s, item(s));
    const due = s.dueOutboxRows(NOW);
    expect(due.ok && due.rows.map((r) => [r.id, r.state, r.payload])).toEqual([[id, 'pending', PAYLOAD]]);
  });
});

describe('the arm: a bound row armed again (slug rearm-is-an-upsert)', () => {
  const arm = (s: CoordStore, sourceId: number, at: number, p: OutboxPayload = PAYLOAD): { inserted: boolean } =>
    tx(s.db, () => armBoundRowInTx(s.db, 'item', sourceId, { pushId: pushId(), payload: p, at }));

  for (const start of ['sent', 'sending', 'silent'] as const) {
    it(`a ${start} row moves to pending with the same push id, attempts 0 and a new armedAt`, () => {
      const s = store();
      const src = item(s);
      const id = bound(s, src);
      const c = s.claimOutboxRow(id, NOW + 1);
      if (!c.changed) throw new Error('not claimed');
      if (start === 'sent') s.markOutboxVerdict(id, c.claimSeq, SENT, NOW + 2);
      if (start === 'silent') s.db.prepare("UPDATE push_outbox SET state = 'silent', silentWhy = 'settled' WHERE id = ?").run(id);
      const before = rows(s)[0]!;
      expect(arm(s, src, NOW + 10, { ...PAYLOAD, body: 'again' })).toEqual({ inserted: false });
      const after = rows(s)[0]!;
      expect(after).toMatchObject({ id, pushId: before.pushId, state: 'pending', attempts: 0, armedAt: NOW + 10, nextAttemptAt: null,
        claimSeq: before.claimSeq, silentWhy: null, settledAt: null });
      expect(JSON.parse(String(after.payload))).toMatchObject({ body: 'again' });
    });
  }

  it('with no row, inserts one with the given push id', () => {
    const s = store();
    const src = item(s);
    expect(tx(s.db, () => armBoundRowInTx(s.db, 'item', src, { pushId: 'given', payload: PAYLOAD, at: NOW }))).toEqual({ inserted: true });
    expect(rows(s)).toMatchObject([{ pushId: 'given', sourceKind: 'item', sourceId: src, state: 'pending', armedAt: NOW }]);
  });
});

describe('claims and verdicts (never twice)', () => {
  it('an unbound row is written claimed: sending, claimSeq 1, attempts 1, no source', () => {
    const s = store();
    const r = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    expect(r).toMatchObject({ ok: true, claimSeq: 1 });
    expect(rows(s)).toMatchObject([{ sourceKind: null, sourceId: null, state: 'sending', claimSeq: 1, attempts: 1 }]);
  });

  it('inside an open transaction the unbound insert joins it rather than failing', () => {
    const s = store();
    expect(tx(s.db, () => s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW }))).toMatchObject({ ok: true, claimSeq: 1 });
    expect(rows(s)).toMatchObject([{ state: 'sending', claimSeq: 1 }]);
  });

  it('claimOutboxRow on a pending row claims it once; on a sending or terminal row changes nothing', () => {
    const s = store();
    const id = bound(s, item(s));
    expect(s.claimOutboxRow(id, NOW + 1)).toEqual({ changed: true, claimSeq: 1 });
    expect(s.claimOutboxRow(id, NOW + 2)).toEqual({ changed: false });
    s.markOutboxVerdict(id, 1, SENT, NOW + 3);
    expect(s.claimOutboxRow(id, NOW + 4)).toEqual({ changed: false });
    expect(rows(s)[0]).toMatchObject({ state: 'sent', attempts: 1, claimSeq: 1 });
  });

  it('a retrying row is claimed again: attempts and claimSeq both rise', () => {
    const s = store();
    const id = bound(s, item(s));
    s.claimOutboxRow(id, NOW);
    s.markOutboxVerdict(id, 1, retry(NOW + 30_000), NOW + 1);
    expect(s.claimOutboxRow(id, NOW + 30_000)).toEqual({ changed: true, claimSeq: 2 });
    expect(rows(s)[0]).toMatchObject({ state: 'sending', attempts: 2, claimSeq: 2 });
  });

  it('a retrying row is not claimed before its nextAttemptAt; a pending row is claimed whatever the clock', () => {
    const s = store();
    const id = bound(s, item(s));
    s.claimOutboxRow(id, NOW);
    s.markOutboxVerdict(id, 1, retry(NOW + 30_000), NOW + 1);
    expect(s.claimOutboxRow(id, NOW + 29_999)).toEqual({ changed: false });
    expect(rows(s)[0]).toMatchObject({ state: 'retrying', attempts: 1, claimSeq: 1 });
    expect(s.claimOutboxRow(id, NOW + 30_000)).toEqual({ changed: true, claimSeq: 2 });
    const fresh = bound(s, item(s), { at: NOW });
    expect(s.claimOutboxRow(fresh, 0)).toEqual({ changed: true, claimSeq: 1 });
  });

  it('markOutboxVerdict with a stale claimSeq changes nothing', () => {
    const s = store();
    const id = bound(s, item(s));
    s.claimOutboxRow(id, NOW);
    s.markOutboxVerdict(id, 1, retry(NOW + 30_000), NOW + 1);
    s.claimOutboxRow(id, NOW + 30_000);
    expect(s.markOutboxVerdict(id, 1, { to: 'failed', verdict: null }, NOW + 30_001)).toEqual({ changed: false });
    expect(rows(s)[0]).toMatchObject({ state: 'sending', claimSeq: 2 });
    expect(s.markOutboxVerdict(id, 2, SENT, NOW + 30_002)).toEqual({ changed: true });
  });

  it('a terminal verdict nulls the payload and sets settledAt; sent writes pushedAt and the verdict', () => {
    const s = store();
    const id = bound(s, item(s));
    s.claimOutboxRow(id, NOW);
    s.markOutboxVerdict(id, 1, SENT, NOW + 5);
    expect(rows(s)[0]).toMatchObject({ state: 'sent', payload: null, pushedAt: NOW + 5, settledAt: NOW + 5 });
    const open = s.db.prepare('SELECT verdict FROM push_outbox WHERE id = ?').get(id) as { verdict: string };
    expect(JSON.parse(open.verdict)).toEqual(ACCEPTED);
  });

  it('a retrying verdict keeps the payload and is due only at nextAttemptAt', () => {
    const s = store();
    const id = bound(s, item(s));
    s.claimOutboxRow(id, NOW);
    s.markOutboxVerdict(id, 1, retry(NOW + 30_000), NOW + 1);
    expect(rows(s)[0]).toMatchObject({ state: 'retrying', settledAt: null, nextAttemptAt: NOW + 30_000 });
    expect(rows(s)[0]!.payload).not.toBeNull();
    const early = s.dueOutboxRows(NOW + 29_999);
    const late = s.dueOutboxRows(NOW + 30_000);
    expect(early.ok && early.rows).toEqual([]);
    expect(late.ok && late.rows.map((r) => r.id)).toEqual([id]);
  });

  it('a second sent after a re-arm leaves pushedAt at the first', () => {
    const s = store();
    const src = item(s);
    const id = bound(s, src);
    s.claimOutboxRow(id, NOW);
    s.markOutboxVerdict(id, 1, SENT, NOW + 5);
    tx(s.db, () => armBoundRowInTx(s.db, 'item', src, { pushId: pushId(), payload: PAYLOAD, at: NOW + 100 }));
    const c = s.claimOutboxRow(id, NOW + 101);
    if (!c.changed) throw new Error('not claimed');
    expect(c.claimSeq).toBe(2);
    s.markOutboxVerdict(id, c.claimSeq, SENT, NOW + 105);
    expect(rows(s)[0]).toMatchObject({ state: 'sent', pushedAt: NOW + 5, settledAt: NOW + 105 });
  });

  it('a verdict word outside the sender\'s moves throws and writes nothing', () => {
    const s = store();
    const id = bound(s, item(s));
    s.claimOutboxRow(id, NOW);
    expect(() => markOutboxVerdict(s.db, id, 1, { to: 'pending', verdict: null } as never, NOW)).toThrow(/may not move/);
    expect(rows(s)[0]).toMatchObject({ state: 'sending' });
  });

  it('silenceOutboxRow silences a pending row once, with its why, and nulls the payload', () => {
    const s = store();
    const id = bound(s, item(s));
    expect(s.silenceOutboxRow(id, 'settled', NOW + 1)).toEqual({ changed: true });
    expect(s.silenceOutboxRow(id, 'settled', NOW + 2)).toEqual({ changed: false });
    expect(rows(s)[0]).toMatchObject({ state: 'silent', silentWhy: 'settled', payload: null, settledAt: NOW + 1 });
  });

  it('the claim is one statement: claimOutboxRow reads no row first', () => {
    const s = store();
    expect(claimOutboxRow(s.db, 999, NOW)).toEqual({ changed: false });
  });
});

describe('the boot pass\'s reads and seals', () => {
  it('openOutboxRows answers every non-terminal row, oldest first; sealAtBoot seals sending unknown and fails stale ones', () => {
    const s = store();
    const sending = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    const pending = bound(s, item(s));
    const done = silent(s, item(s), 'level');
    const open = s.openOutboxRows();
    expect(open.ok && open.rows.map((r) => r.state)).toEqual(['sending', 'pending']);
    if (!sending.ok) throw new Error('no row');
    expect(s.sealAtBoot(sending.id, 'unknown', NOW + 1)).toEqual({ changed: true });
    expect(s.sealAtBoot(sending.id, 'unknown', NOW + 2)).toEqual({ changed: false });
    expect(s.sealAtBoot(pending, 'failed', NOW + 3)).toEqual({ changed: true });
    expect(s.sealAtBoot(done, 'failed', NOW + 3)).toEqual({ changed: false });
    expect(rows(s).map((r) => [r.state, r.payload, r.settledAt])).toEqual([['unknown', null, NOW + 1], ['failed', null, NOW + 3], ['silent', null, NOW]]);
  });

  it('one unreadable row beside two good ones: both good rows are read, the bad one named (slug one-unreadable-row-never-blinds-the-drain)', () => {
    const s = store();
    const read = warnings();
    const a = bound(s, item(s));
    const bad = bound(s, item(s));
    const b = bound(s, item(s));
    s.db.prepare("UPDATE push_outbox SET payload = '{not json' WHERE id = ?").run(bad);
    for (const r of [s.dueOutboxRows(NOW), s.openOutboxRows()]) {
      expect(r.ok && r.rows.map((x) => x.id)).toEqual([a, b]);
      expect(r).toMatchObject({ ok: true, unreadable: [{ id: bad, detail: expect.stringContaining('payload') as string }] });
      if (r.ok) expect(r.unreadable[0]!.detail).not.toContain('not json');
    }
    const lines = read();
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith(`ccrc-server: push_outbox row ${bad} `))).toBe(true);
  });

  it('an unknown source, verdict or silence word quarantines its row alone', () => {
    const s = store();
    warnings();
    const good = bound(s, item(s));
    const src = bound(s, item(s));
    const why = bound(s, item(s));
    const verdict = bound(s, item(s));
    s.db.prepare("UPDATE push_outbox SET sourceKind = 'later' WHERE id = ?").run(src);
    s.db.prepare("UPDATE push_outbox SET silentWhy = 'bored' WHERE id = ?").run(why);
    s.db.prepare("UPDATE push_outbox SET verdict = '{\"kind\":\"maybe\"}' WHERE id = ?").run(verdict);
    const r = s.openOutboxRows();
    expect(r.ok && r.rows.map((x) => x.id)).toEqual([good]);
    expect(r.ok && r.unreadable.map((x) => x.id)).toEqual([src, why, verdict]);
  });

  it('an unreadable sending row is still sealed unknown, and an unreadable terminal unbound row is still purged', () => {
    const s = store();
    warnings();
    const sending = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    const done = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    if (!sending.ok || !done.ok) throw new Error('no row');
    s.markOutboxVerdict(done.id, 1, SENT, NOW);
    s.db.prepare("UPDATE push_outbox SET payload = '{not json' WHERE id = ?").run(sending.id);
    s.db.prepare("UPDATE push_outbox SET verdict = 'garbage' WHERE id = ?").run(done.id);
    expect(s.openOutboxRows()).toMatchObject({ ok: true, rows: [], unreadable: [{ id: sending.id }] });
    expect(s.sealAtBoot(sending.id, 'unknown', NOW + 1)).toEqual({ changed: true });
    expect(s.purgeOutbox(NOW + 8 * DAY)).toEqual({ removed: 2 });
    expect(rows(s)).toEqual([]);
  });

  it('a failed query is ok: false, never an empty list', () => {
    const s = store();
    s.db.exec('DROP TABLE push_outbox');
    expect(s.dueOutboxRows(NOW)).toMatchObject({ ok: false });
    expect(s.openOutboxRows()).toMatchObject({ ok: false });
  });
});

describe('heldItemsReached (slug item-held-until-is-a-hold)', () => {
  const FIRST_BOOT = NOW - DAY;
  const read = (s: CoordStore, now: number): number[] => {
    const r = s.heldItemsReached(now, FIRST_BOOT);
    if (!r.ok) throw new Error(r.detail);
    return r.rows.map((x) => x.id);
  };
  const close = (s: CoordStore, id: number, at: number): void => {
    s.db.prepare("UPDATE operator_items SET state = 'done', closedAt = ? WHERE id = ?").run(at, id);
  };

  it('an open item whose hold has passed is reached; one still held, or never held, is not', () => {
    const s = store();
    const passed = item(s, { heldUntil: NOW + 10 });
    const held = item(s, { heldUntil: NOW + 1_000 });
    item(s, { heldUntil: null });
    expect(read(s, NOW + 100)).toEqual([passed]);
    expect(read(s, NOW + 1_000)).toEqual([passed, held]);
    expect(s.heldItemsReached(NOW + 100, FIRST_BOOT)).toMatchObject({ ok: true, rows: [{ id: passed, heldUntil: NOW + 10, neededBy: 'soon' }] });
  });

  it('an item whose neededBy this build does not know is quarantined alone, never read as a level', () => {
    const s = store();
    const read = warnings();
    const good = item(s, { heldUntil: NOW + 10 });
    const bad = item(s, { heldUntil: NOW + 10 });
    s.db.prepare("UPDATE operator_items SET neededBy = 'someday' WHERE id = ?").run(bad);
    expect(s.heldItemsReached(NOW + 100, FIRST_BOOT)).toMatchObject({ ok: true, rows: [{ id: good }], unreadable: [{ id: bad }] });
    expect(read()).toEqual([expect.stringMatching(new RegExp(`^ccrc-server: operator_items row ${bad} `)) as string]);
  });

  it('leaves out an item closed before heldUntil, and keeps one closed after it', () => {
    const s = store();
    const before = item(s, { heldUntil: NOW + 10 });
    const after = item(s, { heldUntil: NOW + 10 });
    close(s, before, NOW + 5);
    close(s, after, NOW + 20);
    expect(read(s, NOW + 100)).toEqual([after]);
  });

  it('leaves out an item whose heldUntil is before firstBootAt (no backfill)', () => {
    const s = store();
    item(s, { heldUntil: FIRST_BOOT - 1 });
    const edge = item(s, { heldUntil: FIRST_BOOT });
    expect(read(s, NOW)).toEqual([edge]);
  });

  it('leaves out an item already stamped', () => {
    const s = store();
    const id = item(s, { heldUntil: NOW + 10 });
    tx(s.db, () => stampReach(s.db, 'item', id, NOW + 10));
    expect(read(s, NOW + 100)).toEqual([]);
  });
});

describe('purgeOutbox', () => {
  it('removes terminal unbound rows settled before the cut, and keeps bound rows and open ones', () => {
    const s = store();
    const old = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    const fresh = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    const open = s.insertUnboundRow({ pushId: pushId(), payload: PAYLOAD, at: NOW });
    if (!old.ok || !fresh.ok || !open.ok) throw new Error('no row');
    s.markOutboxVerdict(old.id, 1, SENT, NOW);
    s.markOutboxVerdict(fresh.id, 1, { to: 'unsent', verdict: { kind: 'no-subscription' } }, NOW + 10 * DAY);
    const b = silent(s, item(s), 'level', { at: NOW });
    expect(s.purgeOutbox(NOW + 7 * DAY)).toEqual({ removed: 1 });
    expect(rows(s).map((r) => r.id)).toEqual([fresh.id, open.id, b]);
  });
});
