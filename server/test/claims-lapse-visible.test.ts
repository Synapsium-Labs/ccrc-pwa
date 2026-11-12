// D-8392 (public issue #145): a claim that lapsed is no longer indistinguishable from one never taken.
// The default `GET /api/claims` answer keeps `claims` as the live rows only and adds `recentlyLapsed`, the rows
// that lapsed within the last CLAIM_LEASE_MS; a re-take of paths the caller's OWN recently lapsed row held answers
// `lapsedSince`, so the worker learns there was a gap; and `ccrc-api claims list` prints the lapsed rows.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { recentlyLapsedClaims } from '../src/coord/claims.js';
import type { Runner } from '../src/exec.js';
import { CLAIM_HARD_CAP_MS, CLAIM_LEASE_MS, type ClaimSummary } from '../../shared/api.js';
import { runClient, writeClientHome } from './ccrcApiClient.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const A = { byId: 'demo-quiet-mesa', byUuid: 'a'.repeat(36) };
const B = { byId: 'demo-still-pond', byUuid: 'b'.repeat(36) };

const seed = (home: string, id: string, uuid: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const tmuxRunner: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: '', stderr: '' };
  return { ran: true, code: 1, stdout: '', stderr: '' };
};

let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
afterEach(async () => {
  try { if (app) await app.close(); } finally { coord?.db.close(); }
  app = undefined; coord = undefined;
});

const openApp = async (home: string): Promise<{ app: FastifyInstance; coord: CoordStore }> => {
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  app = await buildServer({ ...testDeps(home, tmuxRunner), mailToken: TOKEN, coord });
  return { app, coord };
};

/** A claim taken straight in the store at a backdated clock — the route always stamps its own now. */
const storeClaim = (c: CoordStore, who: typeof A, paths: string[], now: number): number => {
  const r = c.claimAttempt({ project: 'demo', paths, sessionId: who.byId, uuid: who.byUuid,
    intent: 'earlier work', runId: null, now });
  if (!r.ok) throw new Error(`seed claim refused: ${r.why}`);
  return r.claims[0]!.id;
};

type ListAnswer = { ok: true; claims: ClaimSummary[]; recentlyLapsed?: ClaimSummary[] };
type TakeAnswer = { ok: true; ids: number[]; lapsedSince?: { id: number; endedAt: number; endedBy: string }[] };

const list = async (a: FastifyInstance, qs = '?project=demo'): Promise<ListAnswer> =>
  (await a.inject({ method: 'GET', url: `/api/claims${qs}`, headers: tok })).json() as ListAnswer;
const take = (a: FastifyInstance, body: Record<string, unknown>) =>
  a.inject({ method: 'POST', url: '/api/claims', headers: tok, payload: { project: 'demo', ...body } });

describe('GET /api/claims keeps a recent lapse visible beside the live rows (D-8392)', () => {
  it('shows a just-lapsed row in recentlyLapsed, with its end, and not in claims', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    const w = await openApp(home);
    const now = Date.now();
    const gone = storeClaim(w.coord, A, ['shared/api.ts'], now - CLAIM_LEASE_MS);
    w.coord.lapseClaimRow(gone, 'session-gone', now - 60_000);
    const live = storeClaim(w.coord, B, ['ccd/ccd'], now);

    const body = await list(w.app);
    expect(body.claims.map((c) => c.id), 'claims stays live rows only').toEqual([live]);
    expect(body.recentlyLapsed?.map((c) => ({ id: c.id, state: c.state, endedBy: c.endedBy, heldBy: c.heldBy })))
      .toEqual([{ id: gone, state: 'lapsed', endedBy: 'session-gone', heldBy: A.byId }]);
    expect(body.recentlyLapsed?.[0]?.endedAt).toBe(now - 60_000);
    expect(body.recentlyLapsed?.[0]?.paths).toEqual(['shared/api.ts']);
  });

  it('reads a row whose lease ran out but no sweep has lapsed yet as lapsed at its expiry, never as absent', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    const w = await openApp(home);
    const now = Date.now();
    const id = storeClaim(w.coord, A, ['shared/api.ts'], now - CLAIM_LEASE_MS - 60_000);

    const body = await list(w.app);
    expect(body.claims).toEqual([]);
    expect(body.recentlyLapsed).toHaveLength(1);
    expect(body.recentlyLapsed?.[0]).toMatchObject({ id, state: 'lapsed', endedBy: 'expired',
      endedAt: now - 60_000 });
  });

  it('leaves out a row that lapsed longer ago than CLAIM_LEASE_MS, and history still has it', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    const w = await openApp(home);
    const now = Date.now();
    const old = storeClaim(w.coord, A, ['shared/api.ts'], now - 3 * CLAIM_LEASE_MS);
    w.coord.lapseClaimRow(old, 'session-gone', now - CLAIM_LEASE_MS - 60_000);
    storeClaim(w.coord, B, ['ccd/ccd'], now - 3 * CLAIM_LEASE_MS); // unswept, expired two leases ago

    const body = await list(w.app);
    expect(body.claims).toEqual([]);
    expect(body.recentlyLapsed).toEqual([]);
    const all = await list(w.app, '?project=demo&all=1');
    expect(all.claims.find((c) => c.id === old)?.state).toBe('lapsed');
    expect(all.recentlyLapsed, 'all=1 is history verbatim and adds nothing').toBeUndefined();
  });

  it('a released or broken row is not a lapse', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    const w = await openApp(home);
    const now = Date.now();
    w.coord.claimRelease(storeClaim(w.coord, A, ['shared/api.ts'], now - 60_000), A.byId, now - 30_000);
    w.coord.claimBreak(storeClaim(w.coord, B, ['ccd/ccd'], now - 60_000), 'operator', now - 30_000);
    expect((await list(w.app)).recentlyLapsed).toEqual([]);
  });
});

describe('POST /api/claims names the caller\'s own recent lapse it re-takes (D-8392)', () => {
  it('a re-take after the caller\'s own lapse carries lapsedSince; a first take does not', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    seed(home, A.byId, A.byUuid);
    const w = await openApp(home);
    const now = Date.now();
    const gone = storeClaim(w.coord, A, ['shared/api.ts'], now - CLAIM_LEASE_MS);
    w.coord.lapseClaimRow(gone, 'session-gone', now - 60_000);

    const res = await take(w.app, { ...A, paths: ['shared'], intent: 'back at it' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as TakeAnswer).lapsedSince)
      .toEqual([{ id: gone, endedAt: now - 60_000, endedBy: 'session-gone' }]);

    const fresh = await take(w.app, { ...A, paths: ['server/src/a.ts'], intent: 'new file' });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json() as TakeAnswer).not.toHaveProperty('lapsedSince');
  });

  it('names a lease that ran out unswept — the attempt\'s own expiry lapses it first', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    seed(home, A.byId, A.byUuid);
    const w = await openApp(home);
    const seededAt = Date.now() - CLAIM_LEASE_MS - 60_000;
    const gone = storeClaim(w.coord, A, ['shared/api.ts'], seededAt);

    const res = await take(w.app, { ...A, paths: ['shared/api.ts'], intent: 'back at it' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TakeAnswer;
    // The gap began when the lease ran out (its expiresAt), not at the re-take that swept it: the attempt's own
    // expiry writes endedAt = now, which would make the window to re-check read as nothing.
    expect(body.lapsedSince).toEqual([{ id: gone, endedAt: seededAt + CLAIM_LEASE_MS, endedBy: 'expired' }]);
    expect(body.ids).not.toContain(gone);
    // The GET read names the same lapse at the same moment, swept or not.
    const listed = (await list(w.app)).recentlyLapsed?.find((c) => c.id === gone);
    expect(listed?.expiresAt).toBe(seededAt + CLAIM_LEASE_MS);
  });

  it('a lapse a sweep wrote late still names the gap from when the lease ran out', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    seed(home, A.byId, A.byUuid);
    const w = await openApp(home);
    const now = Date.now();
    const seededAt = now - CLAIM_LEASE_MS - 10 * 60_000;
    const gone = storeClaim(w.coord, A, ['shared/api.ts'], seededAt);
    w.coord.lapseClaimRow(gone, 'session-gone', now - 60_000); // the watcher came back nine minutes late

    const res = await take(w.app, { ...A, paths: ['shared/api.ts'], intent: 'back at it' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as TakeAnswer).lapsedSince)
      .toEqual([{ id: gone, endedAt: seededAt + CLAIM_LEASE_MS, endedBy: 'session-gone' }]);
  });

  it('a re-take over SOMEONE ELSE\'s lapsed row carries no lapsedSince', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    seed(home, B.byId, B.byUuid);
    const w = await openApp(home);
    const now = Date.now();
    w.coord.lapseClaimRow(storeClaim(w.coord, A, ['shared/api.ts'], now - CLAIM_LEASE_MS), 'session-gone', now - 60_000);

    const res = await take(w.app, { ...B, paths: ['shared/api.ts'], intent: 'mine now' });
    expect(res.statusCode).toBe(200);
    expect(res.json() as TakeAnswer).not.toHaveProperty('lapsedSince');
  });

  it('an own lapse older than CLAIM_LEASE_MS is not named', async () => {
    const home = mkTmp('ccrc-claims-lapse-');
    seed(home, A.byId, A.byUuid);
    const w = await openApp(home);
    const now = Date.now();
    w.coord.lapseClaimRow(storeClaim(w.coord, A, ['shared/api.ts'], now - 3 * CLAIM_LEASE_MS), 'session-gone',
      now - CLAIM_LEASE_MS - 60_000);

    const res = await take(w.app, { ...A, paths: ['shared/api.ts'], intent: 'back much later' });
    expect(res.statusCode).toBe(200);
    expect(res.json() as TakeAnswer).not.toHaveProperty('lapsedSince');
  });
});

describe('recentlyLapsedClaims (L1, D-8392)', () => {
  const row = (over: Partial<ClaimSummary>): ClaimSummary => ({
    id: 1, project: 'demo', paths: ['a'], heldBy: 'x', heldByUuid: null, intent: 'i', runId: null,
    state: 'live', createdAt: 0, renewedAt: 0, expiresAt: 0, hardExpiresAt: CLAIM_HARD_CAP_MS,
    endedAt: null, endedBy: null, chainedFrom: null, ...over,
  });
  const NOW = 10 * CLAIM_LEASE_MS;

  it('keeps the window\'s edge out: a lapse exactly CLAIM_LEASE_MS ago is no longer recent', () => {
    expect(recentlyLapsedClaims([row({ state: 'lapsed', endedAt: NOW - CLAIM_LEASE_MS, endedBy: 'expired' })], NOW))
      .toEqual([]);
    expect(recentlyLapsedClaims([row({ state: 'lapsed', endedAt: NOW - CLAIM_LEASE_MS + 1, endedBy: 'expired' })], NOW))
      .toHaveLength(1);
  });

  it('words an unswept row past its hard cap as the sweep would: hard-cap', () => {
    const r = row({ expiresAt: NOW - 1000, hardExpiresAt: NOW - 1000 });
    expect(recentlyLapsedClaims([r], NOW)).toEqual([{ ...r, state: 'lapsed', endedAt: NOW - 1000, endedBy: 'hard-cap' }]);
  });

  it('a live row inside its lease is not a lapse', () => {
    expect(recentlyLapsedClaims([row({ expiresAt: NOW + 1 })], NOW)).toEqual([]);
  });
});

describe('ccrc-api claims list prints the lapsed rows (D-8392)', () => {
  it('the body on stdout carries recentlyLapsed, each row marked lapsed', async () => {
    const home = mkTmp('ccrc-claims-lapse-cli-');
    const w = await openApp(home);
    const now = Date.now();
    const gone = storeClaim(w.coord, A, ['shared/api.ts'], now - CLAIM_LEASE_MS);
    w.coord.lapseClaimRow(gone, 'session-gone', now - 60_000);
    await w.app.listen({ host: '127.0.0.1', port: 0 });
    const address = w.app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    writeClientHome(home, `http://127.0.0.1:${port}`, TOKEN);

    const r = await runClient(home, ['claims', 'list', '--project', 'demo']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^http 200$/m);
    const body = JSON.parse(r.stdout) as ListAnswer;
    expect(body.claims).toEqual([]);
    expect(body.recentlyLapsed?.map((c) => [c.id, c.state, c.endedBy, c.heldBy]))
      .toEqual([[gone, 'lapsed', 'session-gone', A.byId]]);
  });
});
