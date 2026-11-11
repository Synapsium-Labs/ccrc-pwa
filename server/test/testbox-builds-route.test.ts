// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): Settings › Automation › Test box's build list and its one
// operator act. `GET /api/testbox/builds` answers the record (`CoordStore.claudeBuilds`); `POST /api/testbox/builds/capture`
// takes `{build}` and nothing else, and sends a FAILED build back to the queue. Both are session-gated (neither is EXEMPT,
// and the POST is in `coord-pause-route.test.ts`'s SESSION_ONLY). A bare Fastify, the roll-idle route suite's idiom.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { Bus } from '../src/bus.js';
import { EXEMPT, type GateDecision } from '../src/auth/gate.js';
import { readClaudeBuildRecords } from '../../shared/claudeBuildTrust.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

async function setup(withCoord = true): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-builds-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home);
  const deps: Deps = { ...base, ...(withCoord ? { coord } : {}) };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, undefined);
  apps.push(app);
  return { app, coord };
}
const capture = (app: FastifyInstance, payload: unknown) => app.inject({ method: 'POST', url: '/api/testbox/builds/capture', payload: payload as object });

describe('GET /api/testbox/builds (D-8289)', () => {
  it('answers every row, newest build first, in the shape the console reads', async () => {
    const { app, coord } = await setup();
    coord.noteClaudeBuildsSeen(['2.1.320'], 5);
    const r = await app.inject({ method: 'GET', url: '/api/testbox/builds' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; claudeBuilds: unknown };
    expect(body.ok).toBe(true);
    expect(readClaudeBuildRecords(body.claudeBuilds)?.map((b) => `${b.build}:${b.capture}`)).toEqual([
      '2.1.320:queued', '2.1.302:pass', '2.1.301:pass', '2.1.300:pass', '2.1.296:pass',
    ]);
  });

  it('no coord.db is not-configured; a record that cannot be read is unavailable, never an empty list', async () => {
    expect((await (await setup(false)).app.inject({ method: 'GET', url: '/api/testbox/builds' })).statusCode).toBe(501);
    const { app, coord } = await setup();
    coord.db.exec('DROP TABLE claude_builds');
    const r = await app.inject({ method: 'GET', url: '/api/testbox/builds' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ error: 'unavailable' });
  });
});

describe('POST /api/testbox/builds/capture (D-8289)', () => {
  it('a failed build goes back to the queue, and the answer is the re-read list', async () => {
    const { app, coord } = await setup();
    coord.noteClaudeBuildsSeen(['2.1.321'], 5);
    coord.recordClaudeBuildVerdict({ build: '2.1.321', pass: false, cwd: false, output: 'replay: 1 failed' }, 6);
    const r = await capture(app, { build: '2.1.321' });
    expect(r.statusCode).toBe(200);
    const builds = readClaudeBuildRecords((r.json() as { claudeBuilds: unknown }).claudeBuilds);
    expect(builds?.find((b) => b.build === '2.1.321')).toMatchObject({ capture: 'queued', output: null });
  });

  it('an unknown build is not-found, and a build without a failure is a conflict: nothing moves', async () => {
    const { app, coord } = await setup();
    coord.noteClaudeBuildsSeen(['2.1.320'], 5);
    expect((await capture(app, { build: '2.1.399' })).json()).toMatchObject({ error: 'not-found' });
    for (const build of ['2.1.320', '2.1.302']) {
      const r = await capture(app, { build });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'conflict' });
    }
    expect(coord.claudeBuilds().find((b) => b.build === '2.1.302')?.capture).toBe('pass');
  });

  it('refuses any body but {build: <a Claude Code build>}', async () => {
    const { app } = await setup();
    for (const bad of [{}, { build: 'latest' }, { build: '2.1.321', force: true }, { build: 2 }, null]) {
      expect((await capture(app, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('neither door is exempt from the sign-in gate', () => {
    for (const k of ['GET /api/testbox/builds', 'POST /api/testbox/builds/capture']) expect(EXEMPT.has(k)).toBe(false);
  });
});
