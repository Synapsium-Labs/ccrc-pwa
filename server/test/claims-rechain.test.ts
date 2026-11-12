// D-8395 (operator ruling 2026-11-12, the claims hard cap): a busy worker no longer loses its path claims silently at
// the 8 h hard cap. A RUNNING holder's re-take inside the last CLAIM_LEASE_MS before the cap ends the old row
// (`released`, `endedBy 'rechained'`) and opens a new one with a fresh lease and a fresh hard cap, `chainedFrom` naming
// the old id, so `GET /api/claims?all=1` still reads the whole hold. A holder that is not running keeps today's
// renewal, clipped at the cap, and lapses there. This amends D12's "no renewal moves the horizon" for this one case.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { rechainDue, rechainTargets } from '../src/coord/claims.js';
import type { Runner } from '../src/exec.js';
import { CLAIM_HARD_CAP_MS, CLAIM_LEASE_MS, isClaimRechainEnd, type ClaimSummary, type ClaimTakeAnswer } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const A = { byId: 'demo-quiet-mesa', byUuid: 'a'.repeat(36) };
const B = { byId: 'demo-still-pond', byUuid: 'b'.repeat(36) };
const MIN = 60_000;

const seed = (home: string, id: string, uuid: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux as the fleet box answers it: every pane live, or (`paneGone`) every pane gone, which reads as dead. */
const tmuxRunnerOf = (paneGone = false): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') return { ran: true, code: paneGone ? 1 : 0, stdout: '', stderr: '' };
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

const openStore = (home: string): CoordStore => {
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  return coord;
};
const openApp = async (home: string, paneGone = false): Promise<{ app: FastifyInstance; coord: CoordStore }> => {
  const c = openStore(home);
  app = await buildServer({ ...testDeps(home, tmuxRunnerOf(paneGone)), mailToken: TOKEN, coord: c });
  return { app, coord: c };
};

/** A claim taken straight in the store at a backdated clock; the route always stamps its own now. */
const storeClaim = (c: CoordStore, who: typeof A, paths: string[], at: number): number => {
  const r = c.claimAttempt({ project: 'demo', paths, sessionId: who.byId, uuid: who.byUuid,
    intent: 'earlier work', runId: null, now: at });
  if (!r.ok) throw new Error(`seed claim refused: ${r.why}`);
  return r.claims[0]!.id;
};
/** Keep a backdated row's lease alive up to `now`, as the watcher's renew lane does for a running holder. */
const keepLeased = (c: CoordStore, id: number, now: number): void => c.renewClaimRow(id, now + CLAIM_LEASE_MS, now);

const row = (c: CoordStore, id: number): ClaimSummary => {
  const r = c.allClaims().find((x) => x.id === id);
  if (r === undefined) throw new Error(`no claims row ${id}`);
  return r;
};

const take = (a: FastifyInstance, body: Record<string, unknown>) =>
  a.inject({ method: 'POST', url: '/api/claims', headers: tok, payload: { project: 'demo', ...body } });

describe('rechainDue and rechainTargets (L1, D-8395)', () => {
  const HARD = 100 * CLAIM_LEASE_MS;
  it('re-chains only a running holder, only inside the last lease before the cap, never at or past it', () => {
    const r = { hardExpiresAt: HARD };
    expect(rechainDue(r, HARD - CLAIM_LEASE_MS + 1, 'running')).toBe(true);
    expect(rechainDue(r, HARD - 1, 'running')).toBe(true);
    expect(rechainDue(r, HARD - CLAIM_LEASE_MS, 'running'), 'a renewal still reaches a full lease').toBe(false);
    expect(rechainDue(r, HARD, 'running'), 'at the cap the row has lapsed').toBe(false);
    for (const v of ['gone', 'unmeasurable'] as const) expect(rechainDue(r, HARD - MIN, v), v).toBe(false);
  });

  it('takes the own claims whose paths overlap the request, the same path or a covered one', () => {
    const own = [
      { id: 2, paths: ['shared'], hardExpiresAt: HARD },
      { id: 1, paths: ['server/src/a.ts'], hardExpiresAt: HARD },
      { id: 3, paths: ['ccd/ccd'], hardExpiresAt: HARD },
    ];
    expect(rechainTargets(own, ['shared/api.ts', 'server/src/a.ts'], HARD - MIN, 'running').map((c) => c.id))
      .toEqual([1, 2]);
    expect(rechainTargets(own, ['shared/api.ts'], HARD - MIN, 'unmeasurable')).toEqual([]);
  });
});

describe('claimAttempt re-chains a running holder near its hard cap (D-8395)', () => {
  it('a running re-take near the cap ends the old row and opens a chained one with a fresh lease and hard cap', () => {
    const c = openStore(mkTmp('ccrc-claims-rechain-'));
    const now = Date.now();
    const old = storeClaim(c, A, ['shared', 'ccd/ccd'], now - CLAIM_HARD_CAP_MS + 10 * MIN);
    keepLeased(c, old, now - MIN);

    const r = c.claimAttempt({ project: 'demo', paths: ['shared'], sessionId: A.byId, uuid: A.byUuid,
      intent: 'still at it', runId: null, now, callerLiveness: 'running' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claims).toHaveLength(1);
    const next = r.claims[0]!;
    expect(r.rechained).toEqual([{ from: old, to: next.id }]);
    expect(next).toMatchObject({ state: 'live', chainedFrom: old, paths: ['shared', 'ccd/ccd'], intent: 'still at it',
      createdAt: now, expiresAt: now + CLAIM_LEASE_MS, hardExpiresAt: now + CLAIM_HARD_CAP_MS });
    const ended = row(c, old);
    expect(ended).toMatchObject({ state: 'released', endedAt: now, endedBy: 'rechained', chainedFrom: null });
    expect(isClaimRechainEnd(ended.endedBy)).toBe(true);
    expect(c.activeClaims().map((x) => x.id)).toEqual([next.id]);
    // The chained row holds the paths: someone else still loses to it.
    const rival = c.claimAttempt({ project: 'demo', paths: ['ccd/ccd'], sessionId: B.byId, uuid: B.byUuid,
      intent: 'mine', runId: null, now: now + MIN });
    expect(rival.ok).toBe(false);
  });

  it('a holder that is not running gets today\'s renewal, clipped at the unchanged hard cap', () => {
    const c = openStore(mkTmp('ccrc-claims-rechain-'));
    const now = Date.now();
    const at = now - CLAIM_HARD_CAP_MS + 10 * MIN;
    const old = storeClaim(c, A, ['shared'], at);
    keepLeased(c, old, now - MIN);
    for (const callerLiveness of ['gone', 'unmeasurable', undefined] as const) {
      const r = c.claimAttempt({ project: 'demo', paths: ['shared'], sessionId: A.byId, uuid: A.byUuid,
        intent: 'renew', runId: null, now, ...(callerLiveness ? { callerLiveness } : {}) });
      expect(r.ok, String(callerLiveness)).toBe(true);
      if (!r.ok) return;
      expect(r.rechained).toEqual([]);
      expect(r.claims.map((x) => [x.id, x.hardExpiresAt, x.expiresAt, x.chainedFrom]))
        .toEqual([[old, at + CLAIM_HARD_CAP_MS, at + CLAIM_HARD_CAP_MS, null]]);
    }
  });

  it('a running re-take early in the window renews in place: no chain row per re-take', () => {
    const c = openStore(mkTmp('ccrc-claims-rechain-'));
    const now = Date.now();
    const old = storeClaim(c, A, ['shared'], now - 60 * MIN);
    keepLeased(c, old, now - MIN);
    const r = c.claimAttempt({ project: 'demo', paths: ['shared'], sessionId: A.byId, uuid: A.byUuid,
      intent: 'renew', runId: null, now, callerLiveness: 'running' });
    expect(r.ok && r.rechained).toEqual([]);
    expect(r.ok && r.claims.map((x) => x.id)).toEqual([old]);
  });
});

describe('POST /api/claims re-chains a running holder near its hard cap (D-8395)', () => {
  it('answers rechained, a fresh hard cap, and GET ?all=1 shows the chain', async () => {
    const home = mkTmp('ccrc-claims-rechain-');
    seed(home, A.byId, A.byUuid);
    const w = await openApp(home);
    const now = Date.now();
    const old = storeClaim(w.coord, A, ['shared'], now - CLAIM_HARD_CAP_MS + 10 * MIN);
    keepLeased(w.coord, old, now - MIN);

    const res = await take(w.app, { ...A, paths: ['shared/api.ts'], intent: 'still busy' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ClaimTakeAnswer;
    expect(body.rechained).toHaveLength(1);
    const to = body.rechained![0]!.to;
    expect(body.rechained).toEqual([{ from: old, to }]);
    expect(body.ids).toEqual([to]);
    expect(body.renewed).toBe(true);
    expect(body.hardExpiresAt).toBeGreaterThanOrEqual(now + CLAIM_HARD_CAP_MS);

    const all = (await w.app.inject({ method: 'GET', url: '/api/claims?project=demo&all=1', headers: tok }))
      .json() as { claims: ClaimSummary[] };
    expect(all.claims.map((x) => [x.id, x.state, x.endedBy, x.chainedFrom, x.paths]))
      .toEqual([[old, 'released', 'rechained', null, ['shared']], [to, 'live', null, old, ['shared']]]);
    const fleetAll = (await w.app.inject({ method: 'GET', url: '/api/claims?all=1', headers: tok }))
      .json() as { claims: ClaimSummary[] };
    expect(fleetAll.claims.find((x) => x.id === to)?.chainedFrom).toBe(old);
  });

  it('a holder that is not running gets no chain and keeps its hard cap', async () => {
    const home = mkTmp('ccrc-claims-rechain-');
    seed(home, A.byId, A.byUuid);
    const w = await openApp(home, true); // A's pane is gone: the fleet reads it dead, not running
    const now = Date.now();
    const at = now - CLAIM_HARD_CAP_MS + 10 * MIN;
    const old = storeClaim(w.coord, A, ['shared'], at);
    keepLeased(w.coord, old, now - MIN);

    const res = await take(w.app, { ...A, paths: ['shared'], intent: 'renew' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ClaimTakeAnswer;
    expect(body).not.toHaveProperty('rechained');
    expect(body.ids).toEqual([old]);
    expect(body.hardExpiresAt).toBe(at + CLAIM_HARD_CAP_MS);
    expect(row(w.coord, old).state).toBe('live');
  });

  it('someone else\'s re-take of a claim near its cap is still a conflict', async () => {
    const home = mkTmp('ccrc-claims-rechain-');
    seed(home, A.byId, A.byUuid);
    seed(home, B.byId, B.byUuid);
    const w = await openApp(home);
    const now = Date.now();
    const old = storeClaim(w.coord, A, ['shared'], now - CLAIM_HARD_CAP_MS + 10 * MIN);
    keepLeased(w.coord, old, now - MIN);

    const res = await take(w.app, { ...B, paths: ['shared'], intent: 'mine now' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { conflicts: { claimId: number }[] }).conflicts.map((x) => x.claimId)).toEqual([old]);
    expect(row(w.coord, old)).toMatchObject({ state: 'live', chainedFrom: null });
  });
});
