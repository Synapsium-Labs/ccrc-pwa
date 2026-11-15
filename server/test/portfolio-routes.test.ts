// Overlord W1, portfolio (plan w1-portfolio.md Task 3): the operator's portfolio read, `GET /api/portfolio`, and the rank door,
// `POST /api/portfolio/rank`, both in `registerLedgerOperatorRoutes`, over `buildServer` and a fixture coord.db. Armed with a
// passphrase session, and dark.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SECRET_MASK } from '../../shared/api.js';
import type { PortfolioView } from '../../shared/portfolio.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const BOX = 'e'.repeat(64);
const HOUR = 3_600_000;

let app: FastifyInstance | null = null;
afterEach(async () => { vi.restoreAllMocks(); await app?.close(); app = null; });

interface Rig { app: FastifyInstance; coord: CoordStore; cookie: string | null }
async function rig(o: { armed: boolean }): Promise<Rig> {
  const home = mkTmp('ccrc-portfolio-routes-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (o.armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home);
  app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: o.armed }, mailToken: BOX, coord });
  let cookie: string | null = null;
  if (o.armed) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  return { app, coord, cookie };
}
const programme = (r: Rig, slug: string, o: { title?: string; createdAt?: number; open?: boolean } = {}): number => {
  r.coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')")
    .run(slug, o.title ?? `Title of ${slug}`, o.createdAt ?? Date.now() - 50 * 24 * HOUR);
  return Number(r.coord.db.prepare(
    "INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt) VALUES (?, 1, 'project-a', ?, 'work', ?, ?)",
  ).run(slug, o.open === false ? 'done' : 'working', Date.now() - 2 * HOUR, Date.now() - 2 * HOUR).lastInsertRowid);
};
const headers = (r: Rig): Record<string, string> => (r.cookie === null ? {} : { cookie: r.cookie });
const read = (r: Rig, h: Record<string, string> = headers(r)) => r.app.inject({ method: 'GET', url: '/api/portfolio', headers: h });
const rank = (r: Rig, payload: unknown, h: Record<string, string> = headers(r)) =>
  r.app.inject({ method: 'POST', url: '/api/portfolio/rank', headers: h, payload: payload as Record<string, unknown> });
const slugs = (v: PortfolioView) => v.programmes.map((p) => p.slug);
const setBy = (r: Rig) => r.coord.db.prepare('SELECT DISTINCT setBy FROM portfolio_rank').all();

describe('the operator\'s portfolio read and rank door, armed', () => {
  it('the read answers the view in rank order, an unranked programme last in standard', async () => {
    const r = await rig({ armed: true });
    programme(r, 'prog-a', { createdAt: 1 });
    programme(r, 'prog-b');
    programme(r, 'prog-c');
    expect((await rank(r, { basedOn: 0, seen: ['prog-b', 'prog-c'], order: [{ slug: 'prog-c', cls: 'standard' }, { slug: 'prog-b', cls: 'expedite' }] })).statusCode).toBe(200);
    const res = await read(r);
    expect(res.statusCode, res.body).toBe(200);
    const v = (res.json() as { ok: true; portfolio: PortfolioView }).portfolio;
    expect(v.revision).toBe(1);
    expect(slugs(v)).toEqual(['prog-b', 'prog-c', 'prog-a']);
    expect(v.programmes[2]).toMatchObject({ slug: 'prog-a', rank: null, cls: 'standard' });
  });

  it('the read without a session is 401, and with the box token alone it is still 401: it is the operator\'s read', async () => {
    const r = await rig({ armed: true });
    expect((await read(r, {})).statusCode).toBe(401);
    expect((await read(r, { 'x-ccrc-mail-token': BOX })).statusCode).toBe(401);
    expect((await rank(r, { basedOn: 0, seen: [], order: [] }, { 'x-ccrc-mail-token': BOX })).statusCode).toBe(401);
  });

  it('a valid order answers revision 1 and the view, recording the session\'s device actor', async () => {
    const r = await rig({ armed: true });
    programme(r, 'prog-a');
    const res = await rank(r, { basedOn: 0, seen: ['prog-a'], order: [{ slug: 'prog-a', cls: 'fixed-date', fixedDate: '2026-12-01' }] });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: true; revision: number; portfolio: PortfolioView };
    expect(body.revision).toBe(1);
    expect(body.portfolio.programmes[0]).toMatchObject({ slug: 'prog-a', rank: { position: 1, cls: 'fixed-date', fixedDate: '2026-12-01' } });
    // The session's device label is the login's user agent (`inject`'s own, `lightMyRequest`), recorded through
    // `ccdargv.ts#deviceActor`: the gate's own actor, never `flag-off`.
    expect(setBy(r)).toEqual([{ setBy: 'device:lightMyRequest' }]);
  });
});

describe('the rank door, dark', () => {
  it('accepts the same order and records flag-off', async () => {
    const r = await rig({ armed: false });
    programme(r, 'prog-a');
    const res = await rank(r, { basedOn: 0, seen: ['prog-a'], order: [{ slug: 'prog-a', cls: 'standard' }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(setBy(r)).toEqual([{ setBy: 'flag-off' }]);
    expect(r.coord.db.prepare('SELECT setBy FROM portfolio_rank_revision').all()).toEqual([{ setBy: 'flag-off' }]);
  });
});

describe('the rank door\'s refusals', () => {
  it('a stale basedOn answers 409 rank-changed with the current revision', async () => {
    const r = await rig({ armed: false });
    programme(r, 'prog-a');
    const ok = { basedOn: 0, seen: ['prog-a'], order: [{ slug: 'prog-a', cls: 'standard' }] };
    expect((await rank(r, ok)).statusCode).toBe(200);
    const res = await rank(r, ok);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'rank-changed', revision: 1 });
  });

  it('an unknown slug with a stale basedOn answers 404 not-found, and the revision does not move', async () => {
    const r = await rig({ armed: false });
    programme(r, 'prog-a');
    expect((await rank(r, { basedOn: 0, seen: ['prog-a'], order: [{ slug: 'prog-a', cls: 'standard' }] })).statusCode).toBe(200);
    const res = await rank(r, { basedOn: 0, seen: ['prog-a', 'prog-x'], order: [{ slug: 'prog-x', cls: 'standard' }] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-found' });
    expect(r.coord.db.prepare('SELECT revision FROM portfolio_rank_revision').get()).toEqual({ revision: 1 });
  });

  it('every shape refusal is bad-request and writes nothing', async () => {
    const r = await rig({ armed: false });
    programme(r, 'prog-a');
    programme(r, 'prog-b');
    const e = (o: Record<string, unknown> = {}) => ({ slug: 'prog-a', cls: 'standard', ...o });
    const many = Array.from({ length: 201 }, (_, i) => `prog-${i}`);
    const bodies: unknown[] = [
      { basedOn: -1, seen: ['prog-a'], order: [e()] },
      { basedOn: 1.5, seen: ['prog-a'], order: [e()] },
      { basedOn: '2', seen: ['prog-a'], order: [e()] },
      { basedOn: Number.MAX_SAFE_INTEGER + 1, seen: ['prog-a'], order: [e()] },
      { seen: ['prog-a'], order: [e()] },
      { basedOn: 0, seen: many, order: [] },
      { basedOn: 0, seen: many, order: many.map((slug) => ({ slug, cls: 'standard' })) },
      { basedOn: 0, seen: ['prog-a', 'prog-a'], order: [] },
      { basedOn: 0, seen: ['prog-a'], order: [e(), e()] },
      { basedOn: 0, seen: ['prog-b'], order: [e()] },
      { basedOn: 0, seen: ['prog-a'], order: [e({ cls: 'urgent' })] },
      { basedOn: 0, seen: ['prog-a'], order: [e({ fixedDate: '2026-12-01' })] },
      { basedOn: 0, seen: ['prog-a'], order: [e({ cls: 'fixed-date' })] },
      { basedOn: 0, seen: ['prog-a'], order: [e({ cls: 'fixed-date', fixedDate: '2026-02-30' })] },
      { basedOn: 0, seen: ['prog-a'], order: [e({ cls: 'fixed-date', fixedDate: '2026-13-01' })] },
      { basedOn: 0, seen: ['prog-a'], order: [e({ cls: 'fixed-date', fixedDate: '1 Dec 2026' })] },
      { basedOn: 0, seen: 'prog-a', order: [e()] },
      { basedOn: 0, seen: ['prog-a'], order: 'prog-a' },
      { basedOn: 0, seen: [''], order: [] },
    ];
    for (const b of bodies) {
      const res = await rank(r, b);
      expect(res.statusCode, JSON.stringify(b).slice(0, 120)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(r.coord.db.prepare('SELECT count(*) AS n FROM portfolio_rank_revision').get()).toEqual({ n: 0 });
  });

  it('a leap day is a date, on fixed-date', async () => {
    const r = await rig({ armed: false });
    programme(r, 'prog-a');
    const res = await rank(r, { basedOn: 0, seen: ['prog-a'], order: [{ slug: 'prog-a', cls: 'fixed-date', fixedDate: '2028-02-29' }] });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('an unknown slug is not-found and writes nothing', async () => {
    const r = await rig({ armed: false });
    programme(r, 'prog-a');
    const res = await rank(r, { basedOn: 0, seen: ['prog-a', 'prog-x'], order: [{ slug: 'prog-a', cls: 'standard' }, { slug: 'prog-x', cls: 'standard' }] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-found' });
    expect(r.coord.db.prepare('SELECT count(*) AS n FROM portfolio_rank').get()).toEqual({ n: 0 });
  });
});

describe('the read\'s failures and masking', () => {
  it('a facts read that throws answers 503 runs-unreadable, never an empty portfolio', async () => {
    const r = await rig({ armed: false });
    vi.spyOn(r.coord, 'portfolioFacts').mockImplementation(() => { throw new Error('database disk image is malformed'); });
    const res = await read(r);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'runs-unreadable', detail: 'database disk image is malformed' });
    expect(res.body).not.toContain('programmes');
  });

  it('with no live-ask reader wired, a released ask counts as unmeasured, never as live', async () => {
    const r = await rig({ armed: false });
    const runId = programme(r, 'prog-a');
    r.coord.db.prepare(
      "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, releasedAt) VALUES (?, 'lane-a-child', 'lane-a-parent', ?, 'k1', 1, 'd', 'q?', '[]', 'released', ?)",
    ).run(Date.now() - 2 * HOUR, runId, Date.now() - HOUR);
    const v = ((await read(r)).json() as { portfolio: PortfolioView }).portfolio;
    expect(v.programmes[0]).toMatchObject({ asksUnmeasured: 1, waitingOnOperatorMs28: 0, blocking: { items: [], asks: 0 } });
  });

  it('a programme title carrying a secret-shaped string comes back masked', async () => {
    const r = await rig({ armed: false });
    const key = ['sk', 'ant', 'api03', createHash('sha256').update('x').digest('base64url').repeat(3).slice(0, 95)].join('-');
    programme(r, 'prog-a', { title: `Ship with ${key} now` });
    const res = await read(r);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(key.slice(8, 40));
    expect(res.body).toContain(SECRET_MASK);
  });
});
