import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import Fastify from 'fastify';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { setRungInTx, raiseLatchInTx, clearLatchInTx, type AuthorityAppender, type RungMoveInput, type LatchClearInput } from '../src/coord/overlordLadderStore.js';
import { tx } from '../src/coord/db.js';

const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const operator = identity.operator(gateActorOf('device-a', 'abcdef0123456789'));
if (false) {
  // @ts-expect-error strings are never ladder actors
  const rung: RungMoveInput = { from: 'off', to: 'chat', actor: 'device-a', at: 1, opKey: 'op' };
  // @ts-expect-error a console result cannot clear a latch
  const clear: LatchClearInput = { cause: 'latch-a', actor: identity.console(false, null), at: 1, opKey: 'op' };
  void rung; void clear;
}
function rig(rung = 'off') {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
  db.prepare("INSERT INTO overlord_ladder VALUES (1, ?, 'old', 1, 1, NULL, NULL)").run(rung);
  const entries: unknown[] = [];
  const journal = { appendInTx: (_db: unknown, entry: unknown) => {
    entries.push(entry); return { ok: true, kind: 'appended', record: { sequence: 7 } };
  } } as unknown as AuthorityAppender;
  return { db, entries, journal, store: new CoordStore(db) };
}

describe('console brakes at the route', () => {
  it.each([
    ['pause', false, null, 'flag-off'],
    ['rung', false, null, 'flag-off'],
    ['rung', true, null, 'unmeasured'],
    ['rung', true, 'device-a', 'device:device-a'],
  ])('%s records the console facts, armed=%s device=%s', async (door, armed, device, expected) => {
    const r = rig(door === 'pause' ? 'advise' : 'chat');
    const app = Fastify();
    registerOverlordRoutes(app, {
      coord: r.store, facts: {}, serial: async (f: () => unknown) => f(), identity,
      gate: () => { throw Error('brake asked the gate'); },
      consoleFacts: () => ({ armed, device }),
      ladder: { coord: r.store, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'load-past-95': () => 'lifted' }, serverCaps: [] },
      journal: r.journal, clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' },
    } as unknown as OverlordRouteDeps);
    const response = await app.inject({ method: 'POST', url: `/api/overlord/${door}`, ...(door === 'rung' ? { payload: { rung: 'off' } } : {}) });
    expect(response.statusCode).toBe(200);
    expect(r.db.prepare('SELECT operatorRung, actor FROM overlord_ladder').get()).toMatchObject({ operatorRung: door === 'pause' ? 'chat' : 'off', actor: expected });
    await app.close(); r.db.close();
  });
});

describe('actor refusal at the route', () => {
  it('returns a fixed internal error without echoing an actor or authority detail', async () => {
    const r = rig();
    const app = Fastify();
    const coord = { ladderRungRead: r.store.ladderRungRead.bind(r.store), ladderRows: r.store.ladderRows.bind(r.store),
      setRung: () => ({ ok: false as const, reason: 'actor' as const }), clearLatch: r.store.clearLatch.bind(r.store) };
    registerOverlordRoutes(app, { identity, coord: r.store, facts: { authority: () => ({ kind: 'unmeasured', why: 'private-text' }) },
      serial: async (f: () => unknown) => f(), gate: () => ({ pass: true, actor: gateActorOf('private-actor', '') }),
      ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'load-past-95': () => 'lifted' }, serverCaps: [] },
      journal: r.journal, clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' },
    } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'chat' } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, error: 'internal' });
    expect(res.body).not.toContain('private-text');
    expect(res.body).not.toContain('private-actor');
    await app.close(); r.db.close();
  });
});

describe('ladder actor authority', () => {
  it.each([
    ['raw string', 'forged'],
    ['spread copy', { ...operator }],
    ['console result', identity.console(false, null)],
    ['signed-in console actor', (identity.console(true, 'device-a') as { kind: 'signed-in'; actor: unknown }).actor],
  ])('refuses %s as authority to raise before append or row write', (_name, actor) => {
    const r = rig();
    const result = r.store.setRung(r.journal, { from: 'off', to: 'chat', actor, at: 2, opKey: 'op' } as unknown as RungMoveInput);
    expect(result).toEqual({ ok: false, reason: 'actor' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT operatorRung, actor FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off', actor: 'old' });
    r.db.close();
  });
  it('refuses a minted session actor as authority to raise', async () => {
    const session = await identity.session('lane-a', 'uuid-a', 'byUuid');
    if (!session.ok) throw Error('fixture attribution failed');
    const r = rig();
    const result = r.store.setRung(r.journal, { from: 'off', to: 'chat', actor: session.actor, at: 2, opKey: 'op' } as unknown as RungMoveInput);
    expect(result).toEqual({ ok: false, reason: 'actor' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    r.db.close();
  });
  it.each([
    ['dark', identity.console(false, null), 'flag-off'],
    ['device-unmeasured', identity.console(true, null), 'unmeasured'],
    ['signed-in', identity.console(true, 'device-a'), 'device:device-a'],
  ])('records the %s console result while lowering', (_name, actor, expected) => {
    const r = rig('chat');
    const result = r.store.setRung(r.journal, { from: 'chat', to: 'off', actor, at: 2, opKey: 'op' } as unknown as RungMoveInput);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(r.db.prepare('SELECT operatorRung, actor FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off', actor: expected });
    r.db.close();
  });
  it('rejects a forged signed-in brake actor before opening the transaction', () => {
    const r = rig('chat');
    const caller = identity.console(true, 'device-a');
    if (caller.kind !== 'signed-in') throw Error('fixture console did not sign in');
    r.db.exec('BEGIN');
    try {
      const input = { from: 'chat', to: 'off', actor: { kind: 'signed-in', actor: { ...caller.actor } }, at: 2, opKey: 'op' } as RungMoveInput;
      expect(r.store.setRung(r.journal, input)).toEqual({ ok: false, reason: 'actor' });
      expect(r.entries).toEqual([]);
    } finally { r.db.exec('ROLLBACK'); r.db.close(); }
  });
  it('records a dark latch raise and refuses a forged raiser before catch-up', () => {
    const r = rig();
    const base = { cause: 'latch-a', cap: 'chat' as const, detail: 'detail', at: 2, opKey: 'op' };
    expect(r.store.raiseLatch(r.journal, { ...base, raisedBy: identity.console(false, null) })).toMatchObject({ ok: true, changed: true });
    expect(r.db.prepare('SELECT raisedBy FROM overlord_latches').get()).toMatchObject({ raisedBy: 'flag-off' });
    r.entries.length = 0;
    expect(r.store.raiseLatch(r.journal, { ...base, cause: 'latch-b', raisedBy: { ...operator } })).toEqual({ ok: false, reason: 'actor' });
    expect(tx(r.db, () => raiseLatchInTx(r.db, r.journal, { ...base, cause: 'latch-b', raisedBy: { ...operator } }))).toEqual({ ok: false, reason: 'actor' });
    r.db.exec('BEGIN');
    try { expect(r.store.raiseLatch(r.journal, { ...base, cause: 'latch-b', raisedBy: { ...operator } })).toEqual({ ok: false, reason: 'actor' }); }
    finally { r.db.exec('ROLLBACK'); }
    expect(r.entries).toEqual([]);
    r.db.close();
  });
  it('rejects a forged clear before catch-up or row write', () => {
    const r = rig();
    r.db.exec("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a', 'chat', 'detail', 1, 'old', NULL)");
    const result = r.store.clearLatch(r.journal, { cause: 'latch-a', actor: { ...operator }, at: 2, opKey: 'op' } as unknown as LatchClearInput);
    expect(result).toEqual({ ok: false, reason: 'actor' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT clearedAt FROM overlord_latches').get()).toMatchObject({ clearedAt: null });
    r.db.close();
  });
  it('rejects invalid provenance before opening a store transaction', () => {
    const r = rig();
    r.db.exec('BEGIN');
    try {
      expect(r.store.setRung(r.journal, { from: 'off', to: 'chat', actor: 'forged', at: 2, opKey: 'op' } as unknown as RungMoveInput)).toEqual({ ok: false, reason: 'actor' });
      expect(r.store.clearLatch(r.journal, { cause: 'latch-a', actor: 'forged', at: 2, opKey: 'op' } as unknown as LatchClearInput)).toEqual({ ok: false, reason: 'actor' });
      expect(r.entries).toEqual([]);
    } finally { r.db.exec('ROLLBACK'); r.db.close(); }
  });
  it('rejects a console raise before opening a store transaction', () => {
    const r = rig();
    r.db.exec('BEGIN');
    try {
      expect(r.store.setRung(r.journal, { from: 'off', to: 'chat', actor: identity.console(false, null), at: 2, opKey: 'op' }))
        .toEqual({ ok: false, reason: 'actor' });
      expect(r.entries).toEqual([]);
    } finally { r.db.exec('ROLLBACK'); r.db.close(); }
  });
  it('rejects an invalid destination at the start of the in-transaction writer', () => {
    const r = rig();
    const input = { from: 'off', to: 'bogus', actor: operator, at: 2, opKey: 'op' } as unknown as RungMoveInput;
    expect(tx(r.db, () => setRungInTx(r.db, r.journal, input))).toEqual({ ok: false, error: 'bad-entry' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT operatorRung, actor FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off', actor: 'old' });
    r.db.close();
  });
  it('the in-transaction rung writer refuses a console result for a measured raise', () => {
    const r = rig();
    const input: RungMoveInput = { from: 'off', to: 'chat', actor: identity.console(false, null), at: 2, opKey: 'op' };
    expect(tx(r.db, () => setRungInTx(r.db, r.journal, input))).toEqual({ ok: false, reason: 'actor' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    r.db.close();
  });
  it('the in-transaction writers independently refuse a forged actor before catch-up', () => {
    const r = rig();
    r.db.exec("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a', 'chat', 'detail', 1, 'old', NULL)");
    expect(tx(r.db, () => setRungInTx(r.db, r.journal, { from: 'off', to: 'chat', actor: { ...operator }, at: 2, opKey: 'op' } as RungMoveInput))).toEqual({ ok: false, reason: 'actor' });
    expect(tx(r.db, () => clearLatchInTx(r.db, r.journal, { cause: 'latch-a', actor: { ...operator }, at: 2, opKey: 'op' }))).toEqual({ ok: false, reason: 'actor' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT clearedAt, raiseSequence FROM overlord_latches').get()).toMatchObject({ clearedAt: null, raiseSequence: null });
    r.db.close();
  });
  it('refuses a lied-about origin before catch-up', () => {
    const r = rig('off');
    const input: RungMoveInput = { from: 'full', to: 'chat', actor: identity.console(false, null), at: 2, opKey: 'op' };
    const result = r.store.setRung(r.journal, input);
    expect(result).toEqual({ ok: false, error: 'row-changed' });
    expect(tx(r.db, () => setRungInTx(r.db, r.journal, input))).toEqual({ ok: false, error: 'row-changed' });
    expect(r.entries).toEqual([]);
    expect(r.db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    r.db.close();
  });
});

// Each independent authority term is exercised with provenance supplied by the test double.
// The integration cases above separately exercise the real minter and provenance check.
describe('independent widening terms', () => {
  it.each([
    ['kind', { kind: 'session', issuer: 'account-gate', strength: 'operator' }],
    ['issuer', { kind: 'operator', issuer: 'session-cookie', strength: 'operator' }],
    ['strength', { kind: 'operator', issuer: 'account-gate', strength: 'attributed' }],
  ])('rejects the wrong %s even if provenance is measured', async (_term, values) => {
    const candidate = { ...values, subject: 'fixture' };
    const original = WeakSet.prototype.has;
    const provenance = vi.spyOn(WeakSet.prototype, 'has').mockImplementation(function (this: WeakSet<object>, value: object) {
      return value === candidate || original.call(this, value);
    });
    try {
      const { ladderActor } = await import('../src/coord/overlordLadderStore.js');
      expect(ladderActor(candidate, 'widen')).toEqual({ ok: false, reason: 'actor' });
    } finally { provenance.mockRestore(); }
  });
});
