import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const accountActor = gateActorOf('device:lane-a', '');
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { buildServer, MASKED_GET_ROUTES } from '../src/server.js';
import { testDeps } from './helpers.js';
import type { SecretMasker } from '../src/accounts/mask.js';
import { NO_LADDER_AUTHORITY, type OverlordAuthorityJournal } from '../src/coord/overlordAuthorityJournal.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashLine } from '../src/auth/secret.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { ladderConditionInputs, type NarrowingWitness } from '../src/coord/overlordLadderRead.js';

function rig(witness?: NarrowingWitness) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
  const coord = new CoordStore(db);
  const app = Fastify();
  registerOverlordRoutes(app, { identity,
    coord, gate: () => { throw Error('ladder must not ask account gate'); }, serial: () => { throw Error('ladder must not serialize'); },
    facts: { serverWords: [] }, ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, witness, serverCaps: [] },
  } as unknown as OverlordRouteDeps);
  return { app, db };
}

describe('ladder write doors', () => {
  it('clears a standing unknown latch only after step-up', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a', 'chat', 'detail', 1, 'actor', 1)");
    const coord = new CoordStore(db);
    const asks: unknown[] = [];
    const app = Fastify();
    registerOverlordRoutes(app, { identity,
      coord, facts: {}, serial: async (f: () => unknown) => f(),
      gate: (_req: unknown, _reply: unknown, ask: unknown) => { asks.push(ask); return { pass: true, actor: accountActor }; },
      ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
      journal: { appendInTx: () => ({ ok: true, kind: 'appended', record: { sequence: 7 } }) },
      clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' }, consoleFacts: () => ({ armed: false, device: null }),
    } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'POST', url: '/api/overlord/latches/latch-a/clear' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, journalled: true, recordSequence: 7 });
    expect(asks).toEqual([{ cap: null, stepUp: true }]);
    expect(db.prepare('SELECT clearedBy FROM overlord_latches').get()).toMatchObject({ clearedBy: 'device:lane-a 00000000' });
    await app.close(); db.close();
  });

  it('lowers without a gate, and raises only after step-up', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    const coord = new CoordStore(db);
    const asks: unknown[] = [];
    const app = Fastify();
    registerOverlordRoutes(app, { identity,
      coord, facts: {}, serial: async (f: () => unknown) => f(),
      gate: (_req: unknown, _reply: unknown, ask: unknown) => { asks.push(ask); return { pass: true, actor: accountActor }; },
      ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
      journal: { appendInTx: () => ({ ok: true, kind: 'appended', record: { sequence: 7 } }) },
      clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' }, consoleFacts: () => ({ armed: false, device: null }),
    } as unknown as OverlordRouteDeps);
    const lower = await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'off' } });
    expect(lower.statusCode).toBe(200);
    expect(lower.json()).toMatchObject({ changed: true, rung: 'off', journalled: true, recordSequence: 7 });
    expect(asks).toEqual([]);
    const raise = await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'chat' } });
    expect(raise.statusCode).toBe(200);
    expect(asks).toEqual([{ cap: null, stepUp: true }]);
    expect(db.prepare('SELECT actor FROM overlord_ladder').get()).toMatchObject({ actor: 'device:lane-a 00000000' });
    await app.close(); db.close();
  });
});

function writeRig(options: { gateError?: string; actor?: string; caps?: string[]; journalAnswer?: unknown; authority?: unknown; witness?: NarrowingWitness } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
  const coord = new CoordStore(db);
  const app = Fastify();
  const asks: unknown[] = [], entries: any[] = [];
  registerOverlordRoutes(app, { identity,
    coord, facts: { authority: () => options.authority }, serial: async (f: () => unknown) => f(),
    gate: (_req: unknown, reply: any, ask: unknown) => {
      asks.push(ask);
      if (options.gateError) { reply.code(403).send({ ok: false, error: options.gateError }); return { pass: false }; }
      return { pass: true, actor: accountActor };
    },
    ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, witness: options.witness, serverCaps: options.caps ?? [] },
    journal: { appendInTx: (_db: unknown, entry: unknown) => { entries.push(entry); return options.journalAnswer ?? { ok: true, kind: 'appended', record: { sequence: 7 } }; } },
    clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' }, consoleFacts: () => ({ armed: options.actor !== undefined && options.actor !== 'flag-off', device: options.actor?.replace(/^device:/, '') ?? null }),
  } as unknown as OverlordRouteDeps);
  const post = (path: string, payload?: unknown) => app.inject({ method: 'POST', url: `/api/overlord/${path}`, ...(payload === undefined ? {} : { payload: payload as object }) });
  const put = (rung: string) => db.prepare("INSERT OR REPLACE INTO overlord_ladder VALUES (1, ?, 'old', 1, 1, NULL, NULL)").run(rung);
  const latch = (cap = 'chat') => db.prepare("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a', ?, 'detail', 1, 'actor', 1)").run(cap);
  return { app, db, asks, entries, post, put, latch };
}

describe('ladder write safeguards', () => {
  it('refuses Pause if a readable full rung becomes an unknown word before the write', async () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, 1, NULL, NULL)");
    const coord = new CoordStore(db); const app = Fastify(); const entries: unknown[] = [];
    const ladderCoord = { ladderRows: () => coord.ladderRows(), setRung: coord.setRung.bind(coord), clearLatch: coord.clearLatch.bind(coord),
      ladderRungRead: () => { const read = coord.ladderRungRead(); db.exec("UPDATE overlord_ladder SET operatorRung = 'future'"); return read; } };
    registerOverlordRoutes(app, { identity, coord, facts: {}, serial: async (f: () => unknown) => f(), consoleFacts: () => ({ armed: false, device: null }),
      journal: { appendInTx: (_db: unknown, entry: unknown) => { entries.push(entry); return { ok: true, kind: 'appended', record: { sequence: 7 } }; } },
      clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' }, ladder: { coord: ladderCoord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
    } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'POST', url: '/api/overlord/pause' });
    expect(res.statusCode).toBe(503); expect(res.json()).toMatchObject({ error: 'unavailable' });
    expect(entries).toEqual([]); expect(db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'future' });
    await app.close(); db.close();
  });
  it('refuses a classified lowering if the rung changes before the writer', async () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'advise', 'actor', 1, 1, NULL, NULL)");
    const coord = new CoordStore(db); const app = Fastify(); const entries: unknown[] = [];
    const ladderCoord = { ladderRows: () => coord.ladderRows(), setRung: coord.setRung.bind(coord), clearLatch: coord.clearLatch.bind(coord),
      ladderRungRead: () => { const read = coord.ladderRungRead(); db.exec("UPDATE overlord_ladder SET operatorRung = 'off'"); return read; } };
    registerOverlordRoutes(app, { identity, coord, facts: {}, serial: async (f: () => unknown) => f(), consoleFacts: () => ({ armed: false, device: null }),
      journal: { appendInTx: (_db: unknown, entry: unknown) => { entries.push(entry); return { ok: true, kind: 'appended', record: { sequence: 7 } }; } },
      clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' }, ladder: { coord: ladderCoord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
    } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'chat' } });
    expect(res.statusCode).toBe(503); expect(res.json()).toMatchObject({ error: 'unavailable' });
    expect(entries).toEqual([]); expect(db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    await app.close(); db.close();
  });
  it('refuses a lowering with a ladder but no actor port', async () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    const coord = new CoordStore(db); const app = Fastify();
    registerOverlordRoutes(app, { identity, coord, facts: {}, serial: async (f: () => unknown) => f(),
      ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
    } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'off' } });
    expect(res.statusCode).toBe(503); expect(res.json()).toMatchObject({ error: 'unavailable' });
    await app.close(); db.close();
  });
  it.each(['auth-off', 'step-up-required'])('refuses raise and clear on %s before composed reads', async (error) => {
    const r = writeRig({ gateError: error }); r.put('off'); r.latch('invalid');
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ error });
    expect((await r.post('latches/latch-a/clear')).json()).toMatchObject({ error });
    expect(r.asks).toEqual([{ cap: null, stepUp: true }, { cap: null, stepUp: true }]);
    expect(r.entries).toEqual([]); await r.app.close(); r.db.close();
  });
  it('refuses a missing capability before gate; supplied capability reaches it', async () => {
    const a = writeRig({ gateError: 'auth-off' }); a.put('off');
    expect((await a.post('rung', { rung: 'advise' })).json()).toMatchObject({ error: 'capability-missing', needs: 'overlord-route-v1' });
    expect(a.asks).toEqual([]); await a.app.close(); a.db.close();
    const b = writeRig({ gateError: 'auth-off', caps: ['overlord-route-v1'] }); b.put('off');
    expect((await b.post('rung', { rung: 'advise' })).json()).toMatchObject({ error: 'auth-off' });
    expect(b.asks).toHaveLength(1); await b.app.close(); b.db.close();
  });
  it.each(['flag-off', 'device:lane-a'])('lowers without a gate with actor %s and a held witness', async (actor) => {
    const r = writeRig({ actor, witness: { heldFor: () => 'held' } });
    expect((await r.post('rung', { rung: 'off' })).json()).toMatchObject({ changed: true, narrowing: { state: 'done' }, recordSequence: 7 });
    expect(r.db.prepare('SELECT actor FROM overlord_ladder').get()).toMatchObject({ actor });
    expect(r.asks).toEqual([]); await r.app.close(); r.db.close();
  });
  it('Pause does not raise from off or chat, but lowers advise', async () => {
    const r = writeRig();
    expect((await r.post('pause')).json()).toMatchObject({ changed: false, rung: 'chat' });
    r.put('off'); expect((await r.post('pause')).json()).toMatchObject({ changed: false, rung: 'off' });
    r.put('advise'); expect((await r.post('pause')).json()).toMatchObject({ changed: true, rung: 'chat' });
    expect(r.asks).toEqual([]); expect(r.entries).toHaveLength(1); await r.app.close(); r.db.close();
  });
  it('bad latch brakes never block a lowering, but block a raise and a clear', async () => {
    const r = writeRig(); r.latch('invalid'); r.put('advise');
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ changed: true });
    expect((await r.post('rung', { rung: 'off' })).json()).toMatchObject({ changed: true });
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ error: 'unavailable' });
    expect((await r.post('latches/latch-a/clear')).json()).toMatchObject({ error: 'unavailable' });
    expect(r.entries).toHaveLength(2); await r.app.close(); r.db.close();
  });
  it.each([
    ['off', 'chat', 'rung', { rung: 'off' }, 'off'],
    ['Pause', 'advise', 'pause', undefined, 'chat'],
    ['lower', 'advise', 'rung', { rung: 'chat' }, 'chat'],
  ] as const)('%s lands over an oversized latch while composed doors refuse', async (_name, from, door, payload, to) => {
    const r = writeRig({ caps: ['overlord-route-v1'] }); r.put(from); r.latch();
    r.db.exec('UPDATE overlord_latches SET raisedAt = 9007199254740992');
    expect((await r.app.inject({ method: 'GET', url: '/api/overlord/ladder' })).statusCode).toBe(503);
    expect((await r.post('latches/latch-a/clear')).statusCode).toBe(503);
    const response = await r.post(door, payload);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ changed: true, rung: to });
    expect((await r.post('rung', { rung: 'advise' })).statusCode).toBe(503);
    expect(r.entries).toHaveLength(1);
    await r.app.close(); r.db.close();
  });
  it('a brake lands over oversized rung sequence metadata', async () => {
    const r = writeRig(); r.put('advise');
    r.db.exec('UPDATE overlord_ladder SET recordSequence = 9007199254740992');
    expect((await r.app.inject({ method: 'GET', url: '/api/overlord/ladder' })).statusCode).toBe(503);
    const res = await r.post('rung', { rung: 'chat' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, rung: 'chat' });
    await r.app.close(); r.db.close();
  });
  it('an unknown rung can only go off, including Pause, and records from full', async () => {
    const r = writeRig(); r.put('future');
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ error: 'unavailable' });
    expect((await r.post('pause')).json()).toMatchObject({ changed: true, rung: 'off' });
    expect(r.entries[0]).toMatchObject({ from: 'full', to: 'off' });
    r.put('future'); expect((await r.post('rung', { rung: 'off' })).json()).toMatchObject({ changed: true });
    expect(r.entries[1]).toMatchObject({ from: 'full', to: 'off' }); await r.app.close(); r.db.close();
  });
  it.each([{ kind: 'rolled-back', cause: 'fixture' }, { kind: 'unmeasured', why: 'fixture' }])('row-only %j lowerings land explicitly unjournalled', async (state) => {
    const r = writeRig({ journalAnswer: { ok: true, kind: 'row-only', state } });
    expect((await r.post('rung', { rung: 'off' })).json()).toMatchObject({ changed: true, journalled: false, recordSequence: null, narrowing: { why: 'not-journalled' } });
    await r.app.close(); r.db.close();
  });
  it.each([['authority-rolled-back', 'authority-rolled-back'], ['authority-unmeasured', 'authority-rolled-back'], ['journal-append', 'journal-unreadable'], ['bad-entry', 'journal-unreadable'], ['not-in-transaction', 'journal-unreadable']])('maps %s to %s on widening', async (error, wire) => {
    const r = writeRig({ journalAnswer: { ok: false, error, detail: 'fixture' }, authority: { kind: 'rolled-back', cause: 'fixture-cause' } }); r.put('off');
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ error: wire, detail: 'fixture-cause' });
    expect(r.db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    await r.app.close(); r.db.close();
  });
  it('a raise does not ask the narrowing witness', async () => {
    let calls = 0;
    const r = writeRig({ witness: { heldFor: () => { calls++; return 'held'; } } }); r.put('off');
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ changed: true, narrowing: null });
    expect(calls).toBe(0); await r.app.close(); r.db.close();
  });
  it('same-rung writes do not append or ask the gate', async () => {
    const r = writeRig({ gateError: 'auth-off' }); r.put('off');
    expect((await r.post('rung', { rung: 'off' })).json()).toEqual({ ok: true, changed: false, rung: 'off' });
    expect(r.asks).toEqual([]); expect(r.entries).toEqual([]); await r.app.close(); r.db.close();
  });
  it('a row-only raise is refused without changing the rung', async () => {
    const r = writeRig({ journalAnswer: { ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'fixture' } } }); r.put('off');
    expect((await r.post('rung', { rung: 'chat' })).json()).toMatchObject({ error: 'authority-rolled-back' });
    expect(r.db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    await r.app.close(); r.db.close();
  });
  it('a refused clear preserves authority values while committing prior narrowing catch-up', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'off', 'actor', 1, NULL, 'chat', 1)");
    db.exec("INSERT INTO overlord_latches (cause,cap,detail,raisedAt,raisedBy,raiseSequence) VALUES ('latch-a','chat','detail',1,'actor',1)");
    const coord = new CoordStore(db);
    const beforeLatch = db.prepare('SELECT * FROM overlord_latches').get();
    const entries: unknown[] = [];
    const journal = { appendInTx: (_db: unknown, entry: unknown) => {
      entries.push(entry);
      return entries.length === 1 ? { ok: true, kind: 'appended', record: { sequence: 7 } } : { ok: false, error: 'journal-append', detail: 'failed' };
    } };
    const app = Fastify();
    registerOverlordRoutes(app, { identity, coord, journal, facts: {}, serial: async (f: () => unknown) => f(),
      gate: () => ({ pass: true, actor: accountActor }), clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' },
      ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
    } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'POST', url: '/api/overlord/latches/latch-a/clear' });
    expect(res.json()).toMatchObject({ error: 'journal-unreadable' });
    expect(db.prepare('SELECT operatorRung,actor,updatedAt,narrowedAt,recordSequence,recordFrom FROM overlord_ladder').get()).toMatchObject({
      operatorRung: 'off', actor: 'actor', updatedAt: 1, narrowedAt: 1, recordSequence: 7, recordFrom: null,
    });
    expect(db.prepare('SELECT * FROM overlord_latches').get()).toEqual(beforeLatch);
    expect(entries).toEqual([
      { kind: 'authority-rung', opKey: 'latch-clear-abcd', from: 'chat', to: 'off' },
      { kind: 'authority-latch-clear', opKey: 'latch-clear-abcd', cause: 'latch-a' },
    ]);
    await app.close(); db.close();
  });
  it('refuses a row-only widening, preserves latch and returns false for absent latch', async () => {
    const r = writeRig({ journalAnswer: { ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'fixture' } } }); r.latch();
    expect((await r.post('latches/latch-a/clear')).json()).toMatchObject({ error: 'authority-rolled-back' });
    expect(r.db.prepare('SELECT clearedAt FROM overlord_latches').get()).toMatchObject({ clearedAt: null });
    expect((await r.post('latches/latch-b/clear')).json()).toMatchObject({ changed: false });
    await r.app.close(); r.db.close();
  });
  it.each([false, true])('production lowering records the measured device when armed=%s', async (armed) => {
    const home = mkTmp('ladder-actor-');
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_designation'))!);
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    const coord = new CoordStore(db);
    const base = testDeps(home);
    if (armed) {
      mkdirSync(path.join(home, '.ccrc'), { recursive: true });
      writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine('fixture-passphrase', { n: 1024, r: 8, p: 1, keylen: 32 }, 1)}\n`);
    }
    const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: { sequence: 7 } }) } as unknown as OverlordAuthorityJournal;
    const app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false }, coord, overlordAuthority: journal });
    let cookie = '';
    if (armed) {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': 'lane-a' }, payload: { passphrase: 'fixture-passphrase' } });
      expect(login.statusCode).toBe(204);
      const set = login.headers['set-cookie']; cookie = (Array.isArray(set) ? set[0]! : String(set)).split(';')[0]!;
    }
    const res = await app.inject({ method: 'POST', url: '/api/overlord/rung', headers: cookie ? { cookie } : {}, payload: { rung: 'off' } });
    expect(res.statusCode).toBe(200);
    expect(db.prepare('SELECT actor FROM overlord_ladder').get()).toMatchObject({ actor: armed ? 'device:lane-a' : 'flag-off' });
    await app.close(); db.close(); removeTmpFixtures();
  });
  it('production wiring lands a row-only lowering without an authority journal', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_designation'))!);
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    const coord = new CoordStore(db);
    const app = await buildServer({ ...testDeps(), coord });
    const res = await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'off' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, journalled: false, recordSequence: null, rung: 'off', narrowing: { why: 'not-journalled' } });
    expect(db.prepare('SELECT operatorRung,recordSequence FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off', recordSequence: null });
    await app.close(); db.close();
  });
  it('the missing-journal ladder adapter refuses widening and leaves the latch standing', async () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'off', 'actor', 1, 1, NULL, 1)");
    db.exec("INSERT INTO overlord_latches (cause,cap,detail,raisedAt,raisedBy,raiseSequence) VALUES ('latch-a','chat','detail',1,'actor',1)");
    const coord = new CoordStore(db); const app = Fastify();
    registerOverlordRoutes(app, { identity, coord, facts: {}, serial: async (f: () => unknown) => f(), gate: () => ({ pass: true, actor: accountActor }),
      journal: NO_LADDER_AUTHORITY, clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' },
      ladder: { coord, journal: NO_LADDER_AUTHORITY, inputs: { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, serverCaps: [] },
    } as unknown as OverlordRouteDeps);
    expect((await app.inject({ method: 'POST', url: '/api/overlord/rung', payload: { rung: 'chat' } })).json()).toMatchObject({ error: 'authority-rolled-back' });
    expect((await app.inject({ method: 'POST', url: '/api/overlord/latches/latch-a/clear' })).json()).toMatchObject({ error: 'authority-rolled-back' });
    expect(db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' });
    expect(db.prepare('SELECT clearedAt FROM overlord_latches').get()).toMatchObject({ clearedAt: null });
    await app.close(); db.close();
  });
  it('fails closed for designation-only harnesses without ladder dependencies', async () => {
    const app = Fastify();
    registerOverlordRoutes(app, { identity, coord: {}, facts: {}, serial: async (f: () => unknown) => f(),
      gate: () => ({ pass: true, actor: accountActor }) } as unknown as OverlordRouteDeps);
    for (const [url, payload] of [['/api/overlord/rung', { rung: 'off' }], ['/api/overlord/pause', undefined], ['/api/overlord/latches/latch-a/clear', undefined]] as const) {
      const res = await app.inject({ method: 'POST', url, ...(payload === undefined ? {} : { payload }) });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'unavailable' });
    }
    await app.close();
  });
  it('rejects bad input and unreadable database', async () => {
    const r = writeRig();
    expect((await r.post('rung', { rung: 'bogus' })).statusCode).toBe(400);
    expect((await r.post('latches/BadCause/clear')).statusCode).toBe(400);
    r.db.exec('DROP TABLE overlord_ladder');
    expect((await r.post('rung', { rung: 'off' })).statusCode).toBe(503);
    await r.app.close(); r.db.close();
  });
});

describe('ladder GET', () => {
  it('reads the default without the account gate or serial, and names unavailable rungs', async () => {
    const { app, db } = rig();
    const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, operatorRung: 'chat', operatorRungSource: 'default', effectiveRung: 'chat', binding: [], rungs: [{ rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null }, { rung: 'advise', available: false, needs: 'overlord-route-v1' }, { rung: 'full', available: false, needs: 'overlord-answer-v1' }] });
    expect(MASKED_GET_ROUTES.has('/api/overlord/ladder')).toBe(true);
    await app.close(); db.close();
  });
  it('returns the effective rung, not the stored rung, and the latch narrowing', async () => {
    const { app, db } = rig();
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, 7, NULL, 1)");
    db.exec("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a', 'chat', 'detail', 2, 'actor', 8)");
    const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ operatorRung: 'full', effectiveRung: 'chat', operatorRungSource: 'set', binding: [{ cause: 'latch-a', known: false }], latches: [{ cause: 'latch-a', narrowing: { state: 'taking-effect', why: 'no-witness-yet' } }], lastChange: { narrowing: { state: 'taking-effect', why: 'no-witness-yet' } } });
    await app.close(); db.close();
  });
  it('reads an actual designated degraded generation and binds the condition', async () => {
    const db = new DatabaseSync(':memory:');
    for (const name of ['CREATE TABLE lane_arm_settings', 'CREATE TABLE continuity_starts', 'CREATE TABLE continuity_generations', 'ADD COLUMN prevLane', 'ADD COLUMN designatedClass', 'CREATE TABLE overlord_designation', 'ALTER TABLE overlord_designation ADD COLUMN actorKind', 'CREATE TABLE overlord_ladder']) {
      db.exec(MIGRATIONS.find((m) => m.includes(name))!);
    }
    db.exec(`INSERT INTO overlord_designation (id, sessionId, generation, term, designatedTerm, model, accountPools, actor, updatedAt)
      VALUES (1, 'overlord-a', 'generation-a', 1, 1, 'opus', '{"pools":[],"untagged":true}', 'actor', 1)`);
    db.exec(`INSERT INTO continuity_starts (id, sessionId, reportId, uuid, source, reportedAt, receivedAt)
      VALUES (1, 'overlord-a', 'report-a', 'uuid-a', 'startup', 1, 1)`);
    db.exec(`INSERT INTO continuity_generations (identity, sessionId, role, term, n, state, enteredAt, resumed, startId, startReportedAt, observed, mintedObservedMs)
      VALUES ('overlord', 'overlord-a', 'overlord', 1, 1, 'degraded', 1, 0, 1, 1, '{"ms":1,"mono":1,"proc":"a"}', 1)`);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, 7, NULL, NULL)");
    const coord = new CoordStore(db);
    const caps = ['overlord-route-v1', 'overlord-answer-v1'];
    const app = Fastify();
    registerOverlordRoutes(app, { identity, coord, facts: {}, ladder: { coord, inputs: ladderConditionInputs({ coord, serverCaps: caps, continuityGate: () => null }), serverCaps: caps } } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ operatorRung: 'full', effectiveRung: 'chat', binding: [{ cause: 'generation-degraded', reading: 'standing' }], conditions: expect.arrayContaining([expect.objectContaining({ cause: 'generation-degraded', reading: 'standing' })]) });
    await app.close(); db.close();
  });
  it('exposes row-only, held and unmeasured witness states on the wire', async () => {
    for (const [sequence, witness, expected] of [
      [null, 'held', { state: 'taking-effect', why: 'not-journalled' }],
      [7, 'held', { state: 'done' }],
      [7, 'unmeasured', { state: 'taking-effect', why: 'witness-unmeasured' }],
    ] as const) {
      const { app, db } = rig({ heldFor: () => witness });
      db.prepare("INSERT INTO overlord_ladder VALUES (1, 'chat', 'actor', 1, ?, NULL, 1)").run(sequence);
      db.prepare("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES ('latch-a', 'chat', 'detail', 1, 'actor', ?)").run(sequence);
      const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ lastChange: { narrowing: expected }, latches: [{ narrowing: expected }] });
      await app.close(); db.close();
    }
  });
  it('passes latch detail through the server masking hook', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_designation'))!);
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy) VALUES ('latch-a', 'chat', 'sensitive text', 2, 'actor')");
    const coord = new CoordStore(db);
    const masker = { maskDeep: (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll('sensitive text', '[masked]')) } as SecretMasker;
    const app = await buildServer({ ...testDeps(), coord, masker });
    const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
    expect(res.statusCode).toBe(200);
    expect(res.json().latches[0].detail).toBe('[masked]');
    await app.close(); db.close();
  });
  it('fails closed when a designation-only harness omits ladder dependencies', async () => {
    const app = Fastify();
    registerOverlordRoutes(app, { identity, coord: {}, facts: {} } as unknown as OverlordRouteDeps);
    const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ detail: 'the ladder could not be read' });
    await app.close();
  });
  it('refuses an unreadable table', async () => {
    const { app, db } = rig(); db.exec('DROP TABLE overlord_latches');
    const res = await app.inject({ method: 'GET', url: '/api/overlord/ladder' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ detail: 'the ladder could not be read' });
    await app.close(); db.close();
  });
});
