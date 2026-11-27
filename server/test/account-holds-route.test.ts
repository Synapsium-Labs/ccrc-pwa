// Overlord W1, the renewal readings PR H (plan `w1-renewal-readings.md` Task 11; spec §3.6): the account holds' table
// (`overlord_account_holds`), its two writers and its reads (`continuity/accountHolds.ts`, through `CoordStore`), and the
// operator's two doors, `GET /api/continuity/account-holds` and `POST /api/continuity/account-holds/:lane/clear`: session-gated
// when sign-in is armed, never EXEMPT, consulting no box token, and the clear records who cleared it.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { buildServer } from '../src/server.js';
import { registerContinuityRoutes } from '../src/continuity/routes.js';
import { CARD_REGISTRY_UNREAD } from '../src/continuity/card.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { testDeps } from './helpers.js';
import { ID_GATE_TOKEN, recorder } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const URL = '/api/continuity/account-holds';
const clearUrl = (lane: string): string => `${URL}/${lane}/clear`;
let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  removeTmpFixtures();
});

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-holds-'), '.ccrc', 'coord.db')));
const refused = (res: { statusCode: number; json(): unknown }): [number, unknown] => [res.statusCode, (res.json() as { error?: unknown }).error];
const row = (s: CoordStore, lane: string) => s.db.prepare('SELECT * FROM overlord_account_holds WHERE lane = ?').get(lane);

describe('overlord_account_holds: the migration, the two writers and the reads', () => {
  it('one migration creates the table, empty: no lane is held', () => {
    expect(MIGRATIONS.filter((m) => m.includes('CREATE TABLE overlord_account_holds'))).toHaveLength(1);
    const s = store();
    expect(s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(s.standingHolds()).toEqual({ ok: true, holds: [] });
  });

  it('a hold is written once per start: the same start again changes nothing', () => {
    const s = store();
    expect(s.holdAccount({ lane: 'lane-a', startId: 7, at: NOW })).toEqual({ ok: true, changed: true });
    expect(s.holdAccount({ lane: 'lane-a', startId: 7, at: NOW + 1 })).toEqual({ ok: true, changed: false });
    expect(s.standingHolds()).toEqual({ ok: true, holds: [{ lane: 'lane-a', cause: 'launch-profile-unmet', startId: 7, heldAt: NOW }] });
    expect(s.accountHolds()).toEqual({ ok: true, lanes: ['lane-a'] });
  });

  it('a clear stamps the row with who and when, and the account is no longer held', () => {
    const s = store();
    s.holdAccount({ lane: 'lane-a', startId: 7, at: NOW });
    expect(s.clearAccountHold({ lane: 'lane-a', by: 'device-1', at: NOW + 5 })).toEqual({ ok: true, changed: true });
    expect(row(s, 'lane-a')).toMatchObject({ clearedAt: NOW + 5, clearedBy: 'device-1' });
    expect(s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(s.clearAccountHold({ lane: 'lane-a', by: 'device-1', at: NOW + 6 })).toEqual({ ok: true, changed: false });
    expect(s.clearAccountHold({ lane: 'lane-b', by: 'device-1', at: NOW + 6 })).toEqual({ ok: true, changed: false });
  });

  it('a clear is never undone by the same start asked again (a restart re-asks), and a later failing start holds it again', () => {
    const s = store();
    s.holdAccount({ lane: 'lane-a', startId: 7, at: NOW });
    s.clearAccountHold({ lane: 'lane-a', by: 'flag-off', at: NOW + 5 });
    expect(s.holdAccount({ lane: 'lane-a', startId: 7, at: NOW + 9 })).toEqual({ ok: true, changed: false });
    expect(s.holdAccount({ lane: 'lane-a', startId: 3, at: NOW + 9 })).toEqual({ ok: true, changed: false });
    expect(s.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(s.holdAccount({ lane: 'lane-a', startId: 9, at: NOW + 10 })).toEqual({ ok: true, changed: true });
    expect(row(s, 'lane-a')).toMatchObject({ startId: 9, heldAt: NOW + 10, clearedAt: null, clearedBy: null });
  });

  it('a later failing start moves a standing hold onto its own start and keeps when it was first held', () => {
    const s = store();
    s.holdAccount({ lane: 'lane-a', startId: 7, at: NOW });
    expect(s.holdAccount({ lane: 'lane-a', startId: 9, at: NOW + 10 })).toEqual({ ok: true, changed: true });
    expect(row(s, 'lane-a')).toMatchObject({ startId: 9, heldAt: NOW, clearedAt: null });
    s.clearAccountHold({ lane: 'lane-a', by: 'flag-off', at: NOW + 11 });
    expect(s.holdAccount({ lane: 'lane-a', startId: 9, at: NOW + 12 })).toEqual({ ok: true, changed: false });
  });

  it('the standing holds read oldest first; the cause is the one word the table admits', () => {
    const s = store();
    s.holdAccount({ lane: 'lane-b', startId: 2, at: NOW + 1 });
    s.holdAccount({ lane: 'lane-a', startId: 1, at: NOW });
    expect(s.accountHolds()).toEqual({ ok: true, lanes: ['lane-a', 'lane-b'] });
    expect(() => s.db.prepare("INSERT INTO overlord_account_holds (lane, cause, startId, heldAt) VALUES ('lane-c', 'other', 1, 1)").run()).toThrow();
  });

  it('a store that fails answers { ok: false } with a detail, never an empty list', () => {
    const s = store();
    s.db.exec("CREATE TRIGGER fail_hold BEFORE INSERT ON overlord_account_holds BEGIN SELECT RAISE(ABORT, 'forced'); END");
    expect(s.holdAccount({ lane: 'lane-a', startId: 1, at: NOW })).toMatchObject({ ok: false });
    s.db.exec("CREATE TRIGGER fail_clear BEFORE UPDATE ON overlord_account_holds BEGIN SELECT RAISE(ABORT, 'forced'); END");
    s.db.exec("DROP TRIGGER fail_hold; INSERT INTO overlord_account_holds (lane, cause, startId, heldAt) VALUES ('lane-a', 'launch-profile-unmet', 1, 1)");
    expect(s.clearAccountHold({ lane: 'lane-a', by: 'x', at: NOW })).toMatchObject({ ok: false });
    s.db.close();
    expect(s.accountHolds()).toMatchObject({ ok: false, detail: expect.stringContaining('overlord_account_holds read failed') });
    expect(s.standingHolds()).toMatchObject({ ok: false });
  });
});

/** The continuity routes alone, on a real store; every registry read is a stub the holds' doors never ask. */
async function rig(actor?: (req: FastifyRequest) => string): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const coord = store();
  const a = Fastify({ logger: false });
  const unasked = async (): Promise<never> => { throw new Error('the holds doors read no registry'); };
  registerContinuityRoutes(a, {
    coord, mailToken: () => ID_GATE_TOKEN, wall: () => NOW, attribute: unasked, attributeReader: unasked, setterStamp: unasked,
    cardRegistry: { childMark: async () => CARD_REGISTRY_UNREAD, incarnation: unasked, declaredIntent: () => false },
    ...(actor === undefined ? {} : { operatorActor: actor }),
  });
  await a.ready();
  app = a;
  return { app: a, coord };
}

describe('GET /api/continuity/account-holds and POST /api/continuity/account-holds/:lane/clear', () => {
  it('GET answers the standing holds: lanes, the cause word, the start and when, and nothing else', async () => {
    const { app: a, coord } = await rig();
    expect((await a.inject({ method: 'GET', url: URL })).json()).toEqual({ ok: true, holds: [] });
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    const res = await a.inject({ method: 'GET', url: URL });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, holds: [{ lane: 'lane-a', cause: 'launch-profile-unmet', startId: 4, heldAt: NOW }] }]);
  });

  it('GET answers its own unmeasured kind when the table cannot be read, never an empty list', async () => {
    const { app: a, coord } = await rig();
    coord.db.exec('DROP TABLE overlord_account_holds');
    const res = await a.inject({ method: 'GET', url: URL });
    expect(refused(res)).toEqual([502, 'unmeasured']);
    expect((res.json() as { holds?: unknown }).holds).toBeUndefined();
  });

  it('a clear puts the account back, records the actor, and a second clear is not-found', async () => {
    const { app: a, coord } = await rig(() => 'device-7');
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    const res = await a.inject({ method: 'POST', url: clearUrl('lane-a') });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, lane: 'lane-a' }]);
    expect(coord.accountHolds()).toEqual({ ok: true, lanes: [] });
    expect(row(coord, 'lane-a')).toMatchObject({ clearedAt: NOW, clearedBy: 'device-7' });
    expect(refused(await a.inject({ method: 'POST', url: clearUrl('lane-a') }))).toEqual([404, 'not-found']);
  });

  it('with no actor port the clear records flag-off', async () => {
    const { app: a, coord } = await rig();
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    expect((await a.inject({ method: 'POST', url: clearUrl('lane-a') })).statusCode).toBe(200);
    expect(row(coord, 'lane-a')).toMatchObject({ clearedBy: 'flag-off' });
  });

  it('refuses a path that names no account id, and a store failure is write-failed', async () => {
    const { app: a, coord } = await rig();
    expect(refused(await a.inject({ method: 'POST', url: clearUrl('lane%20a') }))).toEqual([400, 'bad-request']);
    expect(refused(await a.inject({ method: 'POST', url: clearUrl('x'.repeat(65)) }))).toEqual([400, 'bad-request']);
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    coord.db.exec("CREATE TRIGGER fail_clear BEFORE UPDATE ON overlord_account_holds BEGIN SELECT RAISE(ABORT, 'forced'); END");
    expect(refused(await a.inject({ method: 'POST', url: clearUrl('lane-a') }))).toEqual([503, 'write-failed']);
    expect(coord.accountHolds()).toEqual({ ok: true, lanes: ['lane-a'] });
  });
});

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };

async function server(armed: boolean): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-holds-server-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, recorder().run);
  const a = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: armed }, mailToken: ID_GATE_TOKEN, coord });
  await a.ready();
  app = a;
  return { app: a, coord };
}

describe('the doors on the real server: the operator\'s alone, session-gated, never the box token\'s', () => {
  it('with sign-in armed, no session is 401 at both, and the box token is no key to them', async () => {
    const { app: a, coord } = await server(true);
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    expect(refused(await a.inject({ method: 'GET', url: URL }))).toEqual([401, 'unauthenticated']);
    expect(refused(await a.inject({ method: 'POST', url: clearUrl('lane-a') }))).toEqual([401, 'unauthenticated']);
    const tokened = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
    expect(refused(await a.inject({ method: 'GET', url: URL, headers: tokened }))).toEqual([401, 'unauthenticated']);
    expect(refused(await a.inject({ method: 'POST', url: clearUrl('lane-a'), headers: tokened }))).toEqual([401, 'unauthenticated']);
    expect(coord.accountHolds()).toEqual({ ok: true, lanes: ['lane-a'] });
  });

  it('with sign-in armed and a session, both answer and the clear records the signed-in device, never flag-off', async () => {
    const { app: a, coord } = await server(true);
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
    expect(login.statusCode, login.body).toBe(204);
    const setCookie = login.headers['set-cookie'];
    const line = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
    const cookie = line.slice(0, line.indexOf(';'));
    expect((await a.inject({ method: 'GET', url: URL, headers: { cookie } })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: clearUrl('lane-a'), headers: { cookie } })).statusCode).toBe(200);
    const by = (row(coord, 'lane-a') as { clearedBy: string }).clearedBy;
    expect(by).not.toBe('flag-off');
    expect(by.length).toBeGreaterThan(0);
  });

  it('with sign-in off (the shipped default), both answer with no credential and the clear records flag-off', async () => {
    const { app: a, coord } = await server(false);
    coord.holdAccount({ lane: 'lane-a', startId: 4, at: NOW });
    expect((await a.inject({ method: 'GET', url: URL })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: clearUrl('lane-a') })).statusCode).toBe(200);
    expect(row(coord, 'lane-a')).toMatchObject({ clearedBy: 'flag-off' });
  });
});
