// Overlord W1 authority journal plan, Task 6: `POST /api/overlord/witness` (`coord/overlordRoutes.ts`). The door asks the account gate
// with `{ cap: null }` and no step-up, hands the exchange the signed-in subject and the body's `held`, and answers the offer; sign-in
// dark it refuses `auth-off` through the real gate. The exchange itself is `overlord-authority-exchange.test.ts`'s.
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import type { ExchangeAnswer } from '../src/coord/overlordAuthorityExchange.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());
const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const TUPLE = { v: 1, epoch: 0, base: 0, terms: { authority: 0, privacy: 'absent', act: 'absent' }, boot: 'b', authority: null, privacy: 'absent', act: 'absent', highestIds: { restoreGeneration: 0 }, told: { operatorRung: null, latches: [] } };

function rig(answer: ExchangeAnswer | 'no-exchange') {
  const asks: unknown[] = [];
  const calls: { key: string; held: unknown }[] = [];
  const app = Fastify();
  registerOverlordRoutes(app, {
    identity, coord: {}, facts: {}, serial: async (f: () => unknown) => f(),
    gate: (_req: unknown, _reply: unknown, ask: unknown) => { asks.push(ask); return { pass: true, actor: gateActorOf('device:lane-a', 'ab'.repeat(32)) }; },
    ...(answer === 'no-exchange' ? {} : { exchange: { exchangeConsole: (key: string, held: unknown) => { calls.push({ key, held }); return answer; } } }),
  } as unknown as OverlordRouteDeps);
  return { app, asks, calls };
}

describe('POST /api/overlord/witness', () => {
  it('asks the account gate with cap null and no step-up, hands the exchange the signed-in subject and held, and answers the offer', async () => {
    const r = rig({ kind: 'offer', tuple: TUPLE as never });
    const res = await r.app.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ offer: TUPLE });
    expect(r.asks).toEqual([{ cap: null }]);
    expect(r.calls).toEqual([{ key: expect.stringContaining('device:lane-a'), held: null }]);
    await r.app.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held: TUPLE } });
    expect(r.calls[1]!.held).toEqual(TUPLE);
  });
  it.each([{}, { held: 3 }, { held: [] }, { held: null, extra: 1 }, { held: 'x' }])('refuses the body %j as bad-request', async (payload) => {
    const r = rig({ kind: 'offer', tuple: TUPLE as never });
    const res = await r.app.inject({ method: 'POST', url: '/api/overlord/witness', payload });
    expect(res.statusCode).toBe(400);
    expect(r.calls).toEqual([]);
  });
  it('answers 503 authority-rolled-back with the unmeasured cause when no offer can be built, or no exchange is wired', async () => {
    const a = rig({ kind: 'unmeasured', why: 'privacy-head' });
    const res = await a.app.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held: null } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'authority-rolled-back', cause: 'unmeasured: privacy-head' });
    const b = rig('no-exchange');
    const none = await b.app.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held: null } });
    expect(none.statusCode).toBe(503);
    expect(none.json()).toMatchObject({ error: 'authority-rolled-back', cause: expect.stringContaining('unmeasured') });
  });
  it('returns the measured rollback cause without giving the witness an offer', async () => {
    const r = rig({ kind: 'rolled-back', cause: 'witness-epoch' });
    const res = await r.app.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held: TUPLE } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'authority-rolled-back', cause: 'witness-epoch' });
    await r.app.close();
  });
  it('refuses auth-off through the real gate while sign-in is dark', async () => {
    const base = testDeps(mkTmp('witness-door-'));
    const app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: false } });
    const res = await app.inject({ method: 'POST', url: '/api/overlord/witness', payload: { held: null } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    await app.close();
  });
});
