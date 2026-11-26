// Overlord W1 readiness, plan `w1-readiness.md` Task 3 Step 1: the read door `GET /api/overlord/readiness`
// (`coord/overlordRoutes.ts`) over the real lane built by the composition root's builder (`readinessLaneOver`), a coord db
// opened through the real migrations and fake time ports. The door is session-gated with no box token, masked like the ladder's
// read, and answers 503 `unavailable` with the ladder's own body shape when the store cannot be read or no lane is wired.
//
// The lane's two tables come from the readiness migration, applied by `openCoordDb`.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import path from 'node:path';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { readinessLaneOver } from '../src/coord/overlordReadinessWiring.js';
import type { ReadinessLane, ReadinessTick } from '../src/coord/overlordReadinessLane.js';
import { readinessNow, recordReadiness } from '../src/coord/overlordReadinessStore.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { buildServer, MASKED_GET_ROUTES, type Deps } from '../src/server.js';
import type { SecretMasker } from '../src/accounts/mask.js';
import { hashLine } from '../src/auth/secret.js';
import { READINESS_FRESH_MS, READINESS_WORDS, type ReadinessWord } from '../../shared/overlord-readiness.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-readiness-route-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } vi.restoreAllMocks(); });
afterAll(() => removeTmpFixtures());

const NOBODY: ReadinessTick = { listed: true, sessions: [], records: [], listedIds: new Set(), names: [] };

interface Rig { readonly db: DatabaseSync; readonly coord: CoordStore; readonly ft: FakeTime; readonly deps: Deps; readonly lane: ReadinessLane; readonly home: string }
/** A fixture home with its own coord.db, fake time ports, and the real lane over them: nobody designated unless a case says. */
function rig(): Rig {
  const home = mkTmp('ccrc-readiness-route-');
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  const coord = new CoordStore(db);
  const ft = fakeTime();
  const deps: Deps = { ...testDeps(home), time: ft.ports, coord };
  const lane = readinessLaneOver({ db, coord, deps, operatorModel: undefined, limits: () => null });
  return { db, coord, ft, deps, lane, home };
}

/** The door alone, over a lane (or none): the same registration the server makes, with no gate in the way. */
function doorOver(read: (() => ReturnType<ReadinessLane['read']> | null) | undefined) {
  const app = Fastify();
  registerOverlordRoutes(app, { identity, coord: {}, facts: {}, readiness: read } as unknown as OverlordRouteDeps);
  return app;
}
const get = (app: ReturnType<typeof Fastify>) => app.inject({ method: 'GET', url: '/api/overlord/readiness' });

/** One stored word, as the lane's own writer records it. */
const store = (r: Rig, word: ReadinessWord, over: Partial<{ why: string | null; until: number | null; restartable: boolean; strandCause: 'limited' | null }> = {}): void => {
  const w = recordReadiness(r.db, { word, why: over.why ?? null, until: over.until ?? null, strandCause: over.strandCause ?? null, restartable: over.restartable ?? false, sessionId: 'session-a' }, r.ft.ports.clock.wall());
  expect(w.ok, `the premise: ${word} is recorded`).toBe(true);
};

describe('GET /api/overlord/readiness: the served word', () => {
  it('is listed among the masked GET routes beside the ladder', () => {
    expect(MASKED_GET_ROUTES.has('/api/overlord/readiness')).toBe(true);
  });

  it('serves unmeasured with why boot before the first pass, over a stored ready row from an earlier process', async () => {
    const r = rig();
    store(r, 'ready');
    const app = doorOver(() => r.lane.read());
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ word: 'unmeasured', why: 'boot', until: null, questionsGo: 'operator', restartable: false, strandCause: null });
    await app.close();
  });

  it('serves each word as the lane stores it, after a pass, with its detail and no field the lane did not write', async () => {
    const r = rig();
    const app = doorOver(() => r.lane.read());
    await r.lane.pass(NOBODY);
    for (const word of READINESS_WORDS) {
      r.ft.advance(1_000);
      const until = word === 'renewing' ? r.ft.ports.clock.wall() + 60_000 : null;
      store(r, word, { why: `why-${word}`, until, restartable: word === 'dead', strandCause: word === 'stranded' ? 'limited' : null });
      const res = await get(app);
      expect(res.statusCode, word).toBe(200);
      expect(res.json(), word).toEqual({
        word, since: r.ft.ports.clock.wall(), why: `why-${word}`, until, questionsGo: 'operator', restartable: word === 'dead',
        strandCause: word === 'stranded' ? 'limited' : null,
      });
    }
    await app.close();
  });

  it('serves a stored restartable flag only on dead', async () => {
    const r = rig();
    const app = doorOver(() => r.lane.read());
    await r.lane.pass(NOBODY);
    r.ft.advance(1_000);
    store(r, 'degraded', { restartable: true });
    expect((await get(app)).json()).toMatchObject({ word: 'degraded', restartable: false });
    await app.close();
  });

  it('serves unmeasured with why stale once 30 s pass with no pass, and the stored word again after the next pass', async () => {
    const r = rig();
    const app = doorOver(() => r.lane.read());
    await r.lane.pass(NOBODY);
    expect((await get(app)).json()).toMatchObject({ word: 'absent' });
    r.ft.advance(READINESS_FRESH_MS);
    expect((await get(app)).json()).toMatchObject({ word: 'absent' });
    r.ft.advance(1);
    expect((await get(app)).json()).toMatchObject({ word: 'unmeasured', why: 'stale' });
    await r.lane.pass(NOBODY);
    expect((await get(app)).json()).toMatchObject({ word: 'absent' });
    await app.close();
  });
});

describe('GET /api/overlord/readiness: unavailable', () => {
  it('answers 503 with the ladder read\'s body shape when the store cannot be read', async () => {
    const r = rig();
    r.db.exec('DROP TABLE IF EXISTS overlord_readiness');
    const app = doorOver(() => r.lane.read());
    const res = await get(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'unavailable', detail: 'the readiness word could not be read' });
    await app.close();
  });

  it('answers the same 503 when no lane is wired (a test, a script)', async () => {
    for (const read of [undefined, () => null]) {
      const app = doorOver(read);
      const res = await get(app);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, error: 'unavailable', detail: 'the readiness word could not be read' });
      await app.close();
    }
  });

  it('the server\'s own registration reads deps.overlordReadiness at call time, and answers 503 while none is set', async () => {
    const r = rig();
    const deps: Deps = { ...r.deps };
    const app = await buildServer(deps);
    expect((await get(app)).statusCode).toBe(503);
    deps.overlordReadiness = r.lane;
    await r.lane.pass(NOBODY);
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ word: 'absent' });
    await app.close();
  });
});

describe('GET /api/overlord/readiness: the session gate and the mask', () => {
  it('refuses a request with no session when sign-in is armed, and serves one with a session, with no box token either way', async () => {
    const r = rig();
    mkdirSync(path.join(r.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(r.home, '.ccrc', 'auth.scrypt'), `${await hashLine('fixture-passphrase', { n: 1024, r: 8, p: 1, keylen: 32 }, 1)}\n`);
    const deps: Deps = { ...r.deps, cfg: { ...r.deps.cfg, authEnabled: true, cookieSecure: false }, overlordReadiness: r.lane };
    const app = await buildServer(deps);
    await r.lane.pass(NOBODY);
    const bare = await get(app);
    expect(bare.statusCode).toBe(401);
    expect(bare.body).not.toContain('absent');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': 'lane-a' }, payload: { passphrase: 'fixture-passphrase' } });
    expect(login.statusCode).toBe(204);
    const set = login.headers['set-cookie'];
    const cookie = (Array.isArray(set) ? set[0]! : String(set)).split(';')[0]!;
    const res = await app.inject({ method: 'GET', url: '/api/overlord/readiness', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ word: 'absent' });
    await app.close();
  });

  it('passes a producer\'s detail through the server\'s masking hook', async () => {
    const r = rig();
    const masker = { maskDeep: (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll('sensitive text', '[masked]')) } as SecretMasker;
    const app = await buildServer({ ...r.deps, overlordReadiness: r.lane, masker });
    await r.lane.pass(NOBODY);
    r.ft.advance(1_000);
    store(r, 'unmeasured', { why: 'ladder: sensitive text' });
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().why).toBe('ladder: [masked]');
    await app.close();
  });
});

describe('nothing arms before a designation', () => {
  it('a lane over a fixture coord.db with nobody designated writes the absent word once, and raises no item and sends no push', async () => {
    const r = rig();
    const push = { notify: vi.fn(async () => undefined) };
    const deps: Deps = { ...r.deps, push: push as unknown as Deps['push'] };
    const lane = readinessLaneOver({ db: r.db, coord: r.coord, deps, operatorModel: undefined, limits: () => null });
    const count = (sql: string): number => (r.db.prepare(sql).get() as { n: number }).n;
    const lines = (): number => count('SELECT count(*) AS n FROM overlord_sequence');
    const before = { lines: lines(), items: count('SELECT count(*) AS n FROM operator_items'), outbox: count('SELECT count(*) AS n FROM push_outbox') };

    for (let i = 0; i < 4; i += 1) {
      const answer = await lane.pass(NOBODY);
      expect(answer?.word, `pass ${i + 1}`).toBe('absent');
      r.ft.advance(10_000);
      const rows = r.db.prepare('SELECT word, sessionId, pushedAt FROM overlord_readiness ORDER BY id').all();
      expect(rows, `pass ${i + 1}: one absent row, written once`).toEqual([{ word: 'absent', sessionId: null, pushedAt: null }]);
      expect(lines() - before.lines, `pass ${i + 1}: one sequence line`).toBe(1);
    }
    expect(count('SELECT count(*) AS n FROM overlord_readiness_items'), 'no item record').toBe(0);
    expect(count('SELECT count(*) AS n FROM operator_items') - before.items, 'no operator item').toBe(0);
    expect(count('SELECT count(*) AS n FROM push_outbox') - before.outbox, 'no outbox row').toBe(0);
    expect(push.notify, 'no push sent').not.toHaveBeenCalled();
    const stored = readinessNow(r.db);
    expect(stored.ok && stored.now !== 'none' && stored.now.word).toBe('absent');
  });
});
