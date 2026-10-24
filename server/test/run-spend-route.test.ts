// D-6799: GET /api/runs/:id — the run, plus an additive `spend` block joined from
// the usage sweep through the run's bound sessions. Measuring only: no budget.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { RUN_SPEND_RATE_LIMIT } from '../src/coord/routes.js';
import { clearSessionSpendCache } from '../src/shares.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);
const TOKEN = 'f'.repeat(64);
const H = { 'x-ccrc-mail-token': TOKEN };

const writeSweep = (home: string, per: Record<string, unknown> | null): void => {
  const dir = path.join(home, '.cc-sessions', 'usage', 'sweep');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'latest.json'),
    JSON.stringify({ finishedAt: '2026-10-24T12:00:00Z', perAccount: {}, ...(per === null ? {} : { perCcdSession: per }) }));
};

async function setup(opts: { sweep?: Record<string, unknown> | null | 'none'; rebind?: boolean } = {}): Promise<{ app: FastifyInstance; id: number }> {
  const home = mkTmp('ccrc-run-spend-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'coord-a' });
  if (!('id' in opened)) throw new Error('openRun refused');
  coord.markDispatched(opened.id, 'demo-w2', 'w', 'ws/w', false);
  if (opts.rebind) coord.recordRunEvent(opened.id, 'coordinator', 'session-rebound: demo-w1 -> demo-w2, 0 re-issued');
  if (opts.sweep !== 'none') writeSweep(home, opts.sweep ?? null);
  const app = await buildServer({ ...testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' })), mailToken: TOKEN, coord });
  return { app, id: opened.id };
}
const get = (app: FastifyInstance, id: number | string, headers: Record<string, string> = H) =>
  app.inject({ method: 'GET', url: `/api/runs/${id}`, headers });
const SPEND = (n: number) => ({ n: 1, input: n, output: 2 * n, cacheWrite: 3 * n, cacheRead: 4 * n, apiUsd: n / 2 });

describe('GET /api/runs/:id', () => {
  it('carries the run and its spend, summed over the current AND the predecessor session', async () => {
    const { app, id } = await setup({ sweep: { 'demo-w1': SPEND(1), 'demo-w2': SPEND(2) }, rebind: true });
    const r = await get(app, id);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, run: { id, sessionId: 'demo-w2' },
      spend: { measured: true, measuredAt: '2026-10-24T12:00:00Z', proxyUsd: 1.5,
        tokens: { input: 3, output: 6, cacheWrite: 9, cacheRead: 12 } } });
  });
  it('says unmeasured, with the reason, when the sweep is missing or has not seen the session', async () => {
    expect((await get((await setup({ sweep: 'none' })).app, 1)).json().spend).toEqual({ measured: false, reason: 'no-sweep' });
    const s = await setup({ sweep: { other: SPEND(1) } });
    expect((await get(s.app, s.id)).json().spend).toEqual({ measured: false, reason: 'not-swept' });
  });
  it('the run summary is exactly what GET /api/runs lists: spend is the only addition', async () => {
    const { app, id } = await setup({ sweep: {} });
    const one = (await get(app, id)).json() as { run: unknown };
    const list = (await app.inject({ method: 'GET', url: '/api/runs', headers: H })).json() as { runs: { id: number }[] };
    expect(one.run).toEqual(list.runs.find((x) => x.id === id));
  });
  it('404 for an unknown run, 400 for a malformed id', async () => {
    const { app } = await setup({ sweep: {} });
    expect((await get(app, 999999)).statusCode).toBe(404);
    expect((await get(app, 'x')).statusCode).toBe(400);
  });
  it('is rate-limited per client, and a neighbouring route is not affected', async () => {
    const { app, id } = await setup({ sweep: {} });
    for (let i = 0; i < RUN_SPEND_RATE_LIMIT.max; i += 1) expect((await get(app, id)).statusCode).toBe(200);
    expect((await get(app, id)).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers: H })).statusCode).toBe(200);
  });
  it('a session id named like an Object.prototype member reads as not swept, never a 500', async () => {
    const home = mkTmp('ccrc-run-spend-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'coord-a' });
    if (!('id' in opened)) throw new Error('openRun refused');
    coord.markDispatched(opened.id, 'constructor', 'w', 'ws/w', false);
    writeSweep(home, { other: SPEND(1), ['__proto__']: SPEND(2) });
    clearSessionSpendCache();
    const app = await buildServer({ ...testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' })), mailToken: TOKEN, coord });
    const r = await get(app, opened.id);
    expect(r.statusCode).toBe(200);
    expect(r.json().spend).toEqual({ measured: false, reason: 'not-swept' });
  });
});
