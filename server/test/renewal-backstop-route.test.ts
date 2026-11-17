// Overlord W1, the renewal readings PR A (plan `w1-renewal-readings.md` Task 2): the daily backstop's row
// (`renewal_backstop_settings`), its one writer and its read, and its two operator doors `GET` and
// `POST /api/continuity/renewal-backstop`: session-gated when sign-in is armed, never EXEMPT, consulting no box token.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { buildServer } from '../src/server.js';
import { registerContinuityRoutes } from '../src/continuity/routes.js';
import { CARD_REGISTRY_UNREAD } from '../src/continuity/card.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { BACKSTOP_DEFAULT } from '../../shared/renewal-readings.js';
import { testDeps } from './helpers.js';
import { ID_GATE_TOKEN, recorder } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const URL = '/api/continuity/renewal-backstop';
let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  removeTmpFixtures();
});

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-backstop-'), '.ccrc', 'coord.db')));
const refused = (res: { statusCode: number; json(): unknown }): [number, unknown] => [res.statusCode, (res.json() as { error?: unknown }).error];

describe('renewal_backstop_settings: the migration, the read and the one writer', () => {
  it('one migration creates the table and seeds the default, 04:00 UTC, marked default (question 2)', () => {
    expect(MIGRATIONS.filter((m) => m.includes('CREATE TABLE renewal_backstop_settings'))).toHaveLength(1);
    const s = store();
    expect(s.backstopRead()).toEqual({ ok: true, backstop: { ...BACKSTOP_DEFAULT, isDefault: true, setAt: 0 } });
  });

  it('a set writes the hour and the zone, clears `isDefault` and stamps the time', () => {
    const s = store();
    expect(s.setBackstop({ hour: 3, zone: 'Europe/Berlin', at: NOW })).toEqual({ ok: true });
    expect(s.backstopRead()).toEqual({ ok: true, backstop: { hour: 3, zone: 'Europe/Berlin', isDefault: false, setAt: NOW } });
  });

  it('a hand-written row outside the bounds, or no row, reads `{ ok: false }`, never the default', () => {
    const s = store();
    for (const bad of ['hour = 24', 'hour = 4.5', "zone = 'Not/AZone'", "zone = ''", 'isDefault = 2', "setAt = 'x'"]) {
      s.db.exec(`UPDATE renewal_backstop_settings SET ${bad}`);
      expect(s.backstopRead(), bad).toMatchObject({ ok: false });
      s.db.exec("UPDATE renewal_backstop_settings SET hour = 4, zone = 'UTC', isDefault = 1, setAt = 0");
      expect(s.backstopRead(), `${bad}, restored`).toMatchObject({ ok: true });
    }
    s.db.exec('DELETE FROM renewal_backstop_settings');
    expect(s.backstopRead()).toEqual({ ok: false, detail: 'renewal_backstop_settings has no row' });
    expect(s.setBackstop({ hour: 3, zone: 'UTC', at: NOW })).toEqual({ ok: false });
  });

  it('a store that fails reads `{ ok: false }` and writes `{ ok: false }`', () => {
    const s = store();
    s.db.exec("CREATE TRIGGER fail_set BEFORE UPDATE ON renewal_backstop_settings BEGIN SELECT RAISE(ABORT, 'forced'); END");
    expect(s.setBackstop({ hour: 3, zone: 'UTC', at: NOW })).toEqual({ ok: false });
    expect(s.backstopRead()).toMatchObject({ ok: true, backstop: { isDefault: true } });
    s.db.close();
    expect(s.backstopRead()).toMatchObject({ ok: false });
  });
});

/** The continuity routes alone, on a real store; every registry read is a stub the backstop doors never ask. */
async function rig(): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const coord = store();
  const a = Fastify({ logger: false });
  const unasked = async (): Promise<never> => { throw new Error('the backstop doors read no registry'); };
  registerContinuityRoutes(a, {
    coord, mailToken: () => ID_GATE_TOKEN, wall: () => NOW, attribute: unasked, attributeReader: unasked, setterStamp: unasked,
    cardRegistry: { childMark: async () => CARD_REGISTRY_UNREAD, incarnation: unasked, declaredIntent: () => false },
  });
  await a.ready();
  app = a;
  return { app: a, coord };
}

describe('GET and POST /api/continuity/renewal-backstop', () => {
  it('GET answers the seeded row', async () => {
    const { app: a } = await rig();
    const res = await a.inject({ method: 'GET', url: URL });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, hour: 4, zone: 'UTC', isDefault: true, setAt: 0 }]);
  });

  it('a good POST writes and answers the row read back, and GET reads it', async () => {
    const { app: a } = await rig();
    const res = await a.inject({ method: 'POST', url: URL, payload: { hour: 23, zone: 'America/New_York' } });
    const want = { ok: true, hour: 23, zone: 'America/New_York', isDefault: false, setAt: NOW };
    expect([res.statusCode, res.json()]).toEqual([200, want]);
    expect((await a.inject({ method: 'GET', url: URL })).json()).toEqual(want);
  });

  it('refuses `bad-request` for an hour outside 0 to 23, a non-integer, a zone Intl refuses, or no body, and writes nothing', async () => {
    const { app: a, coord } = await rig();
    for (const payload of [{ hour: 24, zone: 'UTC' }, { hour: -1, zone: 'UTC' }, { hour: 4.5, zone: 'UTC' }, { hour: '4', zone: 'UTC' },
      { hour: 4, zone: 'Not/AZone' }, { hour: 4, zone: '' }, { hour: 4 }, {}]) {
      const res = await a.inject({ method: 'POST', url: URL, payload });
      expect(refused(res), JSON.stringify(payload)).toEqual([400, 'bad-request']);
      expect(typeof (res.json() as { detail?: unknown }).detail).toBe('string');
    }
    expect(coord.backstopRead()).toMatchObject({ ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true } });
  });

  it('a store failure answers 503: `write-failed` for the set, `unavailable` for an unreadable row', async () => {
    const { app: a, coord } = await rig();
    coord.db.exec("CREATE TRIGGER fail_set BEFORE UPDATE ON renewal_backstop_settings BEGIN SELECT RAISE(ABORT, 'forced'); END");
    expect(refused(await a.inject({ method: 'POST', url: URL, payload: { hour: 3, zone: 'UTC' } }))).toEqual([503, 'write-failed']);
    coord.db.exec('DELETE FROM renewal_backstop_settings');
    const get = await a.inject({ method: 'GET', url: URL });
    expect(refused(get)).toEqual([503, 'unavailable']);
    expect((get.json() as { detail?: unknown }).detail).toBe('renewal_backstop_settings has no row');
  });
});

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };

async function server(armed: boolean): Promise<FastifyInstance> {
  const home = mkTmp('ccrc-backstop-server-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, recorder().run);
  const a = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: armed }, mailToken: ID_GATE_TOKEN, coord });
  await a.ready();
  app = a;
  return a;
}

describe('the doors on the real server: the operator\'s, session-gated, no box token', () => {
  it('with sign-in armed, no session is 401 at both, and the box token is no key to them', async () => {
    const a = await server(true);
    expect(refused(await a.inject({ method: 'GET', url: URL }))).toEqual([401, 'unauthenticated']);
    expect(refused(await a.inject({ method: 'POST', url: URL, payload: { hour: 3, zone: 'UTC' } }))).toEqual([401, 'unauthenticated']);
    const tokened = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
    expect(refused(await a.inject({ method: 'GET', url: URL, headers: tokened }))).toEqual([401, 'unauthenticated']);
    expect(refused(await a.inject({ method: 'POST', url: URL, headers: tokened, payload: { hour: 3, zone: 'UTC' } }))).toEqual([401, 'unauthenticated']);
  });

  it('with sign-in armed and a session, both answer', async () => {
    const a = await server(true);
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
    expect(login.statusCode, login.body).toBe(204);
    const setCookie = login.headers['set-cookie'];
    const line = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
    const cookie = line.slice(0, line.indexOf(';'));
    expect((await a.inject({ method: 'GET', url: URL, headers: { cookie } })).statusCode).toBe(200);
    const res = await a.inject({ method: 'POST', url: URL, headers: { cookie }, payload: { hour: 2, zone: 'Europe/Berlin' } });
    expect([res.statusCode, (res.json() as { hour?: unknown }).hour]).toEqual([200, 2]);
  });

  it('with sign-in off (the shipped default), both answer with no credential', async () => {
    const a = await server(false);
    expect((await a.inject({ method: 'GET', url: URL })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: URL, payload: { hour: 5, zone: 'UTC' } })).statusCode).toBe(200);
  });
});
