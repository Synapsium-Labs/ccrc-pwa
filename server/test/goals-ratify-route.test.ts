// Overlord W1, portfolio B (plan `w1-portfolio.md` Task 5): the operator's ratify door, `POST
// /api/programmes/:slug/goals/ratify`, in `registerLedgerOperatorRoutes`, over `buildServer`, a fixture coord.db and a
// counting bus. It confers authority, so it takes the account gate and refuses while sign-in is dark (question 4).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { GoalsView } from '../../shared/ledgers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const BOX = 'e'.repeat(64);
const SPEC = 'docs/superpowers/specs/2026-11-01-x-design.md';
const PIN_AT = 1_790_000_000_000;

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

interface Rig { app: FastifyInstance; coord: CoordStore; cookie: string | null; frames: () => number }
async function rig(o: { armed: boolean }): Promise<Rig> {
  const home = mkTmp('ccrc-goals-ratify-route-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (o.armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  for (const slug of ['prog-a', 'prog-b']) {
    coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, 'active')").run(slug, slug.toUpperCase());
  }
  // A pin that rests on an item, so it reads not ratified until the operator ratifies it.
  coord.setSpecPin('prog-a', SPEC, 'What it builds.', PIN_AT, null, { kind: 'item' });
  const bus = new Bus();
  let frames = 0;
  bus.on('waiting', () => { frames += 1; });
  const base = testDeps(home);
  app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: o.armed }, mailToken: BOX, coord }, bus);
  let cookie: string | null = null;
  if (o.armed) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  return { app, coord, cookie, frames: () => frames };
}
const headers = (r: Rig): Record<string, string> => (r.cookie === null ? {} : { cookie: r.cookie });
const ratify = (r: Rig, slug: string, payload: unknown, h: Record<string, string> = headers(r)) =>
  r.app.inject({ method: 'POST', url: `/api/programmes/${slug}/goals/ratify`, headers: h, payload: payload as Record<string, unknown> });
const goalsRead = async (r: Rig): Promise<GoalsView> =>
  ((await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/goals', headers: headers(r) })).json() as { goals: GoalsView }).goals;

describe('the ratify door, armed', () => {
  it('a valid pin ratification flips the goals read\'s verdict to ratified by the operator, and emits the frame once', async () => {
    const r = await rig({ armed: true });
    expect((await goalsRead(r)).pinRatification).toMatchObject({ ratified: false, why: 'unreadable' });
    const res = await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, goals: { pinRatification: { ratified: true, source: { kind: 'operator' } } } });
    expect((await goalsRead(r)).pinRatification).toEqual({ ratified: true, source: { kind: 'operator' } });
    expect(r.frames()).toBe(1);
  });

  it('a second call answers changed: false, writes nothing and emits no frame', async () => {
    const r = await rig({ armed: true });
    expect((await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT } })).statusCode).toBe(200);
    const at = r.coord.db.prepare("SELECT ratifiedAt FROM programs WHERE slug = 'prog-a'").get();
    const again = await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT } });
    expect(again.json()).toMatchObject({ ok: true, changed: false });
    expect(r.coord.db.prepare("SELECT ratifiedAt FROM programs WHERE slug = 'prog-a'").get()).toEqual(at);
    expect(r.frames()).toBe(1);
  });

  it('a stale inShortAt answers 409 goals-changed with the stored stamp, and writes nothing', async () => {
    const r = await rig({ armed: true });
    const res = await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT - 1 } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'goals-changed', inShortAt: PIN_AT });
    expect(r.coord.db.prepare("SELECT ratifiedBy FROM programs WHERE slug = 'prog-a'").get()).toEqual({ ratifiedBy: 'item' });
    expect(r.frames()).toBe(0);
  });

  it('another programme\'s modification id, and a programme with no pin, are not-found', async () => {
    const r = await rig({ armed: true });
    const theirs = r.coord.addModification('prog-b', { text: 'theirs', ruling: null, itemId: null, pr: null }, PIN_AT, { kind: 'item' });
    expect((await ratify(r, 'prog-a', { modification: theirs })).json()).toMatchObject({ ok: false, error: 'not-found' });
    expect((await ratify(r, 'prog-b', { pin: { inShortAt: PIN_AT } })).json()).toMatchObject({ ok: false, error: 'not-found' });
    expect(r.frames()).toBe(0);
  });

  it('a modification of this programme is ratified by its id', async () => {
    const r = await rig({ armed: true });
    const mod = r.coord.addModification('prog-a', { text: 'ours', ruling: null, itemId: null, pr: null }, PIN_AT, { kind: 'item' });
    expect((await ratify(r, 'prog-a', { modification: mod })).json()).toMatchObject({ ok: true, changed: true });
    expect((await goalsRead(r)).modifications[0]!.ratification).toEqual({ ratified: true, source: { kind: 'operator' } });
  });

  it('every other body is bad-request', async () => {
    const r = await rig({ armed: true });
    for (const body of [{}, { pin: {} }, { pin: { inShortAt: '1' } }, { pin: { inShortAt: 1.5 } }, { modification: 0 }, { modification: -1 },
      { modification: 1, pin: { inShortAt: PIN_AT } }, { pin: { inShortAt: PIN_AT, x: 1 } }, [1]]) {
      const res = await ratify(r, 'prog-a', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(r.frames()).toBe(0);
  });

  it('no session is 401, and the box token alone is still 401: it is the operator\'s door', async () => {
    const r = await rig({ armed: true });
    expect((await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT } }, {})).statusCode).toBe(401);
    expect((await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT } }, { 'x-ccrc-mail-token': BOX })).statusCode).toBe(401);
    expect(r.coord.db.prepare("SELECT ratifiedBy FROM programs WHERE slug = 'prog-a'").get()).toEqual({ ratifiedBy: 'item' });
  });
});

describe('the ratify door, sign-in dark (question 4: it confers authority)', () => {
  it('answers auth-off and writes nothing', async () => {
    const r = await rig({ armed: false });
    const res = await ratify(r, 'prog-a', { pin: { inShortAt: PIN_AT } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    expect(r.coord.db.prepare("SELECT ratifiedBy FROM programs WHERE slug = 'prog-a'").get()).toEqual({ ratifiedBy: 'item' });
    expect(r.frames()).toBe(0);
  });
});
