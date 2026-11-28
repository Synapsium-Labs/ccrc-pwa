// Overlord W2, act journal plan Task A3: `GET /api/overlord/act-head`, the head read, through `registerOverlordRoutes` over the real
// answer (`readActHeadAnswer`) on a fixture `coord.db` and a real act journal. Session-gated, no box token, no step-up: it never asks
// the account gate. Fixture names only; temp databases only.
import { afterAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { MIGRATIONS } from '../src/coord/schema.js';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { overlordActsFileAt } from '../src/coord/overlordActJournal.js';
import { recordActHeadInTx } from '../src/coord/overlordActHeadStore.js';
import { readActHeadAnswer } from '../src/coord/overlordActHeadLane.js';
import type { OverlordActRecord } from '../src/coord/overlordActRecords.js';
import { SETTLE } from './sim/overlordActJournalSets.js';
import { mkTmp } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterAll(async () => { for (const a of apps) await a.close(); });
const HEADS = MIGRATIONS.find((sql) => sql.includes('CREATE TABLE overlord_act_heads'))!;
const D = (c: string): string => c.repeat(64);

function app(o: { wired?: boolean; acts?: number; headRow?: boolean; broken?: boolean } = {}): FastifyInstance {
  const dir = mkTmp('ccrc-acthead-route-');
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  if (!o.broken) db.exec(HEADS);
  const file = overlordActsFileAt(dir);
  for (let i = 1; i <= (o.acts ?? 0); i += 1) {
    const r = file.appendNext(() => ({ go: { entry: { ...SETTLE, actId: i } as OverlordActRecord, acceptedAt: '2026-11-28T09:00:00.000Z' } }));
    if (!r.ok) throw new Error('fixture append failed');
  }
  if (o.headRow) recordActHeadInTx(db, { day: '2026-11-28', sequence: 1, journalId: D('a'), digest: D('b'), signature: null, unsigned: 'shared-user', at: 1 });
  const journal = { readVerified: () => { const r = file.read(); return r.kind === 'unmeasured' ? { kind: 'unmeasured' as const, why: 'unreadable' as const } : r; } };
  const a = Fastify({ logger: false });
  apps.push(a);
  registerOverlordRoutes(a, {
    facts: {}, serial: async (f: () => unknown) => f(),
    gate: () => { throw new Error('the head read must not ask the account gate'); },
    ...(o.wired === false ? {} : { actHead: (at: number | null) => readActHeadAnswer({ db: () => db, journal, publicKeyPem: () => 'PEM' }, at) }),
  } as unknown as OverlordRouteDeps);
  return a;
}

describe('GET /api/overlord/act-head', () => {
  it('answers the newest head, the key and, with at, the digest of the record there; past the head, absent', async () => {
    const a = app({ acts: 2, headRow: true });
    const one = await a.inject({ method: 'GET', url: '/api/overlord/act-head?at=1' });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ v: 1, head: { day: '2026-11-28', sequence: 1, unsigned: 'shared-user', signature: null }, publicKeyPem: 'PEM', at: { sequence: 1 } });
    expect((one.json() as { at: { digest: string } }).at.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await a.inject({ method: 'GET', url: '/api/overlord/act-head?at=9' })).json()).toMatchObject({ at: { sequence: 9, digest: 'absent' } });
    expect((await a.inject({ method: 'GET', url: '/api/overlord/act-head' })).json()).toMatchObject({ head: { sequence: 1 }, at: null });
  });

  it('before any head: head absent, still 200', async () => {
    expect((await app().inject({ method: 'GET', url: '/api/overlord/act-head' })).json()).toEqual({ v: 1, head: 'absent', publicKeyPem: 'PEM', at: null });
  });

  it('an at that is not a positive whole number is a bad request', async () => {
    for (const at of ['0', '-1', '1.5', 'x', '00', '12345678901234567']) {
      expect((await app().inject({ method: 'GET', url: `/api/overlord/act-head?at=${at}` })).statusCode, at).toBe(400);
    }
  });

  it('unwired, or over a heads table that cannot be read: 503 unavailable, never an empty answer', async () => {
    const off = await app({ wired: false }).inject({ method: 'GET', url: '/api/overlord/act-head' });
    expect(off.statusCode).toBe(503);
    expect(off.json()).toMatchObject({ error: 'unavailable' });
    expect((await app({ broken: true }).inject({ method: 'GET', url: '/api/overlord/act-head' })).statusCode).toBe(503);
  });
});
