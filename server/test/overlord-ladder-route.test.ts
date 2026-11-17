import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { buildServer, MASKED_GET_ROUTES } from '../src/server.js';
import { testDeps } from './helpers.js';
import type { SecretMasker } from '../src/accounts/mask.js';
import { ladderConditionInputs, type NarrowingWitness } from '../src/coord/overlordLadderRead.js';

function rig(witness?: NarrowingWitness) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
  const coord = new CoordStore(db);
  const app = Fastify();
  registerOverlordRoutes(app, {
    coord, gate: () => { throw Error('ladder must not ask account gate'); }, serial: () => { throw Error('ladder must not serialize'); },
    facts: { serverWords: [] }, ladder: { coord, inputs: { 'generation-degraded': () => 'lifted', 'rung-word-missing': () => 'lifted' }, witness, serverCaps: [] },
  } as unknown as OverlordRouteDeps);
  return { app, db };
}

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
    for (const name of ['CREATE TABLE lane_arm_settings', 'CREATE TABLE continuity_starts', 'CREATE TABLE continuity_generations', 'ADD COLUMN prevLane', 'CREATE TABLE overlord_designation', 'CREATE TABLE overlord_ladder']) {
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
    registerOverlordRoutes(app, { coord, facts: {}, ladder: { coord, inputs: ladderConditionInputs({ coord, serverCaps: caps, continuityGate: () => null }), serverCaps: caps } } as unknown as OverlordRouteDeps);
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
    registerOverlordRoutes(app, { coord: {}, facts: {} } as unknown as OverlordRouteDeps);
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
