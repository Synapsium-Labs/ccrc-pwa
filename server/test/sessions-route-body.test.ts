// Routing spec 2026-09-14 §5.3 (slice 4, Task 3) — an OPERATOR's own
// `route?` on `POST /api/sessions` and `POST /api/projects/:project/
// workspaces`. Same `buildServer(testDeps(...))` + `app.inject` idiom as
// `workspaces-route.test.ts`/`routes.test.ts`.
//
// THIS DIFFERS FROM DISPATCH'S OWN RULE ON PURPOSE (see `server.ts`'s
// `parseOperatorRoute` docstring): a missing `route-argv-v1` is 501 here,
// never the silent omit-and-journal `dispatch-route.test.ts` pins for an
// unattended coordinator wave — an operator who asked is never quietly
// served the plain argv.
import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { ROUTE_ARGV_CAP } from '../src/ccdargv.js';

const WITH_TOKEN = ['ws-add', 'ensure', 'ws-hold', ROUTE_ARGV_CAP];

/** `/api/sessions`'s pool pre-check reads the registry directory (`readdir`)
 *  to tell a revival apart from a fresh create — an unlisted (rather than
 *  merely empty) directory reads as `pool-unreadable`, so every fixture home
 *  here creates it up front, the same baseline `run-routes.test.ts`'s own
 *  `openApp` gives every one of ITS fixtures. */
async function appWithCcdSpy(ccdVerbs?: string[]): Promise<{ app: FastifyInstance; calls: string[][] }> {
  const home = mkTmp('ccrc-sessions-route-body-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  const base = testDeps(home, run);
  const app = await buildServer({
    ...base,
    ...(ccdVerbs === undefined
      ? {}
      : { fleetState: { connected: true, downSince: null, ccdVerbs, rosterFp: null, build: null } }),
  });
  return { app, calls };
}

describe('POST /api/sessions carries an operator route', () => {
  it('with route and the token: start carries --route pairs, leading the positionals', async () => {
    const { app, calls } = await appWithCcdSpy(WITH_TOKEN);
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'demo', enable: false, route: { class: 'opus' } },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['start', '--route', 'class=opus', 'claude', 'demo']);
    await app.close();
  });

  it('a bad field: 400, and no ccd call reaches the fleet at all', async () => {
    const { app, calls } = await appWithCcdSpy(WITH_TOKEN);
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'demo', route: { colour: 'blue' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'route: unknown-field colour' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('route given, route-argv-v1 absent: 501, and no ccd call reaches the fleet at all', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'demo', route: { class: 'opus' } },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('no route: today\'s argv, byte for byte, even on a box that never advertised the token', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'demo', enable: false },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['start', 'claude', 'demo']);
    await app.close();
  });

  it('the enable (default) arm carries the same route pairs as the start arm', async () => {
    const { app, calls } = await appWithCcdSpy(WITH_TOKEN);
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'demo', route: { effort: 'high' } },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['enable', '--route', 'effort=high', 'claude', 'demo']);
    await app.close();
  });
});

describe('POST /api/projects/:project/workspaces carries an operator route', () => {
  it('with route and the token: ws-add carries --route pairs, leading the project', async () => {
    const { app, calls } = await appWithCcdSpy(WITH_TOKEN);
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { route: { effort: 'high' } },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-add', '--route', 'effort=high', 'demo']);
    await app.close();
  });

  it('a bad field: 400, and no ccd call reaches the fleet at all', async () => {
    const { app, calls } = await appWithCcdSpy(WITH_TOKEN);
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { route: { effort: '' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'route: bad-value effort' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('route given, route-argv-v1 absent: 501, and no ccd call reaches the fleet at all', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { route: { effort: 'high' } },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('no route: today\'s argv, byte for byte, even on a box that never advertised the token', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({ method: 'POST', url: '/api/projects/demo/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-add', 'demo']);
    await app.close();
  });

  it('an empty route object ({}) is treated as absent — no 501 even without the token', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({
      method: 'POST', url: '/api/projects/demo/workspaces', payload: { route: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-add', 'demo']);
    await app.close();
  });
});
