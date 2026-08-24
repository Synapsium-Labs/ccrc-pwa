// The claims routes (build 9 D11/D12). The CAS is coord.db's own synchronous
// tx() inside `claimAttempt` — this file exercises the DOOR: gates,
// attribution, all-or-nothing, the 409-as-address, lapse-don't-delete, and the
// abandon-shaped break.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { CLAIM_LEASE_MS } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);

const seed = (home: string, id: string, uuid: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid,
    started: '1', ...over };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux alive for every id unless named dead — the deliverable measurement on
 *  the 409 arm reads it through assembleFleet. */
const tmuxRunner = (dead: readonly string[] = []): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') {
    return { code: dead.some((d) => args.join(' ').includes(d)) ? 1 : 0, stdout: '', stderr: '' };
  }
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

const openApp = async (home: string, run: Runner = tmuxRunner(), over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const A = { byId: 'demo-quiet-mesa', byUuid: UUID_A };
const B = { byId: 'demo-still-pond', byUuid: UUID_B };

/** Seed a claim straight into the store, bypassing the route — `claimAttempt`
 *  with `sessionId`/`uuid` is the LANDED spelling (Task 12's store); the
 *  plan's `acquireClaims({byId, byUuid, ...})` predates it, and the defining
 *  task's landed spelling wins (plan governance). */
const storeClaim = (coord: CoordStore, who: { byId: string; byUuid: string },
                    paths: string[], intent: string, now: number): void => {
  const r = coord.claimAttempt({ project: 'demo', paths, sessionId: who.byId,
    uuid: who.byUuid, intent, runId: null, now });
  expect(r.ok).toBe(true);
};

const claim = (app: FastifyInstance, body: Record<string, unknown>,
               headers: Record<string, string> = tok) =>
  app.inject({ method: 'POST', url: '/api/claims', headers, payload: body });
const release = (app: FastifyInstance, id: number, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/claims/${id}/release`, headers: tok, payload: body });
const brk = (app: FastifyInstance, id: number, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/claims/${id}/break`,
    ...(payload ? { payload } : { payload: {} }) });
const list = (app: FastifyInstance, qs = '?project=demo') =>
  app.inject({ method: 'GET', url: `/api/claims${qs}`, headers: tok });

describe('POST /api/claims', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('acquires, and a same-owner re-POST renews — new intent, renewed:true', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;

    const first = await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'],
      intent: 'rewiring the roster' });
    expect(first.statusCode).toBe(200);
    const body1 = first.json() as { ids: number[]; expiresAt: number; hardExpiresAt: number;
      renewed: boolean };
    expect(body1.renewed).toBe(false);
    expect(body1.ids).toHaveLength(1);
    expect(body1.expiresAt).toBeGreaterThan(Date.now());
    expect(body1.expiresAt).toBeLessThanOrEqual(Date.now() + CLAIM_LEASE_MS + 5_000);
    expect(body1.hardExpiresAt).toBeGreaterThan(body1.expiresAt);

    const again = await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'],
      intent: 'now proving the roster' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { renewed: boolean }).renewed).toBe(true);
    const rows = (await list(app)).json() as
      { claims: { intent: string; state: string }[] };
    expect(rows.claims.map((c) => c.intent)).toEqual(['now proving the roster']);
  });

  it('is all-or-nothing: one conflict means ZERO acquired, and the 409 names every conflicting path', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/mark.mjs', 'ccd/ccd'],
      intent: 'stamping' });

    const res = await claim(app, { ...B, project: 'demo',
      paths: ['shared/api.ts', 'shared/mark.mjs', 'ccd/ccd'], intent: 'colliding' });
    expect(res.statusCode).toBe(409);
    const conflicts = (res.json() as { conflicts: { path: string; heldBy: string }[] }).conflicts;
    expect(conflicts.map((c) => c.path).sort()).toEqual(['ccd/ccd', 'shared/mark.mjs']);
    expect(conflicts.every((c) => c.heldBy === A.byId)).toBe(true);
    // ZERO acquired — partial acquisition is two workers each holding half of
    // what the other needs (D12).
    const held = (await list(app)).json() as { claims: { heldBy: string }[] };
    expect(held.claims.filter((c) => c.heldBy === B.byId)).toEqual([]);
  });

  it('conflicts on directory-prefix containment, BOTH directions — shared/ vs shared/api.ts', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/'], intent: 'the whole module' });
    const leaf = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'one file' });
    expect(leaf.statusCode, 'a held directory contains its files').toBe(409);
    await app.close();

    const home2 = mkTmp('ccrc-claims-');
    seed(home2, A.byId, UUID_A);
    seed(home2, B.byId, UUID_B);
    const w2 = await openApp(home2); app = w2.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'one file' });
    const dir = await claim(app, { ...B, project: 'demo', paths: ['shared/'], intent: 'the module' });
    expect(dir.statusCode, 'a held file blocks its directory').toBe(409);
  });

  it("refuses '.' and '' as bad-path — claiming the repo IS the module wedge", async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    for (const p of ['.', '']) {
      const res = await claim(app, { ...A, project: 'demo', paths: [p], intent: 'everything' });
      expect(res.statusCode, JSON.stringify(p)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: p === '' ? 'bad-request' : 'bad-path' });
    }
  });

  it('the 409 carries the full envelope: heldBy/heldByUuid/intent/runId/expiresAt/deliverable/mailHint', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'rewiring' });

    const res = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'me too' });
    expect(res.statusCode).toBe(409);
    const c = (res.json() as { conflicts: Record<string, unknown>[] }).conflicts[0]!;
    // `mailHint` is the LANDED L0 envelope (`ClaimConflict.mailHint`,
    // shared/api.ts): `{toId, subject}` — the plan's `{send: {...}}` wrapper
    // predates the L0 slice, and the landed spelling wins.
    expect(c).toMatchObject({
      path: 'shared/api.ts', heldBy: A.byId, heldByUuid: UUID_A, intent: 'rewiring',
      runId: null, deliverable: 'yes',
      mailHint: { toId: A.byId, subject: 'claim conflict: shared/api.ts' },
    });
    expect(c['expiresAt'] as number).toBeGreaterThan(Date.now());
  });

  it("degrades the hint to null — the L0 spelling of operator escalation — when the holder is 'no:<reason>'", async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A, { stopped: '1755700000 pwa' });
    seed(home, B.byId, UUID_B);
    const w = await openApp(home, tmuxRunner([A.byId])); app = w.app;
    // A claimed while alive; the row outlives the session (lapse is the
    // watcher's job, and the lease has not run out yet).
    storeClaim(w.coord, A, ['shared/api.ts'], 'was rewiring', Date.now());

    const res = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'me too' });
    expect(res.statusCode).toBe(409);
    const c = (res.json() as { conflicts: { deliverable: string; mailHint: unknown }[] })
      .conflicts[0]!;
    expect(c.deliverable).toBe('no:stopped');
    // NEVER a silent send: the measured reason rides `deliverable` beside a
    // null hint (`ClaimConflict.mailHint`'s own contract).
    expect(c.mailHint).toBeNull();
  });

  it('expires a lapsed row IN THE SAME ATTEMPT — a wedged watcher cannot wedge the claim route', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    // A's lease is already over: acquire with a backdated clock, straight into
    // the store — the route always stamps its own now.
    storeClaim(w.coord, A, ['shared/api.ts'], 'long gone', Date.now() - CLAIM_LEASE_MS - 60_000);

    const res = await claim(app, { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'fresh' });
    expect(res.statusCode, 'the expiry ran inside the attempt tx (D12)').toBe(200);
    const all = (await list(app, '?project=demo&all=1')).json() as
      { claims: { heldBy: string; state: string }[] };
    // Lapse, don't delete: A's row SURVIVES as history.
    expect(all.claims.find((c) => c.heldBy === A.byId)?.state).toBe('lapsed');
    expect(all.claims.find((c) => c.heldBy === B.byId)?.state).toBe('live');
  });

  it('gates: no token 401; stale uuid 403; unknown claimant 403; unknown runId 404', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    const good = { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'x' };
    expect((await claim(app, good, {})).statusCode).toBe(401);
    expect((await claim(app, { ...good, byUuid: 'c'.repeat(36) })).statusCode).toBe(403);
    expect((await claim(app, { ...good, byId: 'demo-never-was' })).statusCode).toBe(403);
    expect((await claim(app, { ...good, runId: 999 })).statusCode).toBe(404);
  });
});

describe('release and break', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const acquire = async (app: FastifyInstance): Promise<number> => {
    const res = await claim(app, { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'x' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { ids: number[] }).ids[0]!;
  };

  it('the owner releases; a second release is claim-terminal, not a delete', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    const id = await acquire(app);
    expect((await release(app, id, { ...A })).statusCode).toBe(200);
    const again = await release(app, id, { ...A });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, error: 'claim-terminal', state: 'released' });
  });

  it('a non-owner cannot release — 403 names the holder; an unknown id is 404', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    seed(home, B.byId, UUID_B);
    const w = await openApp(home); app = w.app;
    const id = await acquire(app);
    const res = await release(app, id, { ...B });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-owner', heldBy: A.byId });
    expect((await release(app, 9999, { ...A })).statusCode).toBe(404);
  });

  it('break answers WITHOUT the box token and NEVER reads the body — the abandon-door shape', async () => {
    const home = mkTmp('ccrc-claims-');
    seed(home, A.byId, UUID_A);
    const w = await openApp(home); app = w.app;
    const id = await acquire(app);
    // No token header; a body full of garbage a gate might have parsed.
    const res = await brk(app, id, { byId: 'forged', archive: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: 'broken' });
    const all = (await list(app, '?project=demo&all=1')).json() as
      { claims: { id: number; state: string; endedBy: string | null }[] };
    expect(all.claims.find((c) => c.id === id)).toMatchObject({ state: 'broken', endedBy: 'operator' });
    expect((await brk(app, id)).statusCode).toBe(409);
  });
});
