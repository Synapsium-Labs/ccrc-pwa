// D-6790: Fable runs only when the operator selects it. Every box-token route write refuses a class of `fable`
// (409 `fable-operator-only`); the cookie-session routes the operator's PWA uses stay able to set it.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, ROUTE_APPLY_CAP, ROUTE_ARGV_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { routeNamesFable } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'ccrc-pwa-coordinator';
const TOKEN = 'f'.repeat(64);
const OPEN_BODY = { program: 'build4', title: 'Fable door', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, homeProject: PROJECT, claimedByUuid: `u-${CLAIMED_BY}` };
const FLEET = {
  connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ROUTE_CAP, ROUTE_APPLY_CAP, ROUTE_ARGV_CAP, ACTOR_FLAGS_CAP] as string[],
};

const seed = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', class: 'sonnet', effort: 'high', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

async function rig() {
  const home = mkTmp('ccrc-fable-');
  const calls: string[][] = [];
  const run: Runner = async (_c, args) => {
    calls.push(args);
    if (args[0] === 'ws-add') { seed(home, `${PROJECT}-fresh`); return { code: 0, stdout: '', stderr: '' }; }
    return { code: 0, stdout: '', stderr: '' };
  };
  seed(home, CLAIMED_BY);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord, fleetState: FLEET });
  const box = { 'x-ccrc-mail-token': TOKEN };
  const sent = (verb: string) => calls.filter((c) => c[0] === verb);
  return { app, home, calls, sent, box };
}

describe('D-6790: the one predicate', () => {
  it('names class fable, in any case or padding, and nothing else', () => {
    expect(routeNamesFable({ class: 'fable' })).toBe(true);
    expect(routeNamesFable({ class: ' Fable ' })).toBe(true);
    expect(routeNamesFable({ class: 'opus', effort: 'high' })).toBe(false);
    expect(routeNamesFable({ effort: 'fable' })).toBe(false);
    expect(routeNamesFable({})).toBe(false);
  });
  it('is a 409 in the refusal table', () => {
    expect(REFUSAL_STATUS['fable-operator-only']).toBe(409);
  });
});

describe('D-6790: box-token doors refuse Fable', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('POST /api/runs/:id/route: the manual field/value arm answers 409 and sends nothing', async () => {
    const r = await rig(); app = r.app;
    const opened = (await app.inject({ method: 'POST', url: '/api/runs', headers: r.box, payload: OPEN_BODY })).json() as { id: number };
    expect((await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/dispatch`, headers: r.box, payload: { brief: 'go' } })).statusCode).toBe(200);
    const before = r.calls.length;
    const res = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/route`, headers: r.box,
      payload: { target: 'worker', why: 'try', field: 'class', value: 'fable' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'fable-operator-only' });
    expect(r.calls.length).toBe(before);
    // The same door still writes any other class.
    const ok = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/route`, headers: r.box,
      payload: { target: 'worker', why: 'try', field: 'class', value: 'opus' } });
    expect(ok.statusCode).toBe(200);
  });

  it('POST /api/runs/:id/dispatch: a route naming fable answers 409 before any ws-add', async () => {
    const r = await rig(); app = r.app;
    const opened = (await app.inject({ method: 'POST', url: '/api/runs', headers: r.box, payload: OPEN_BODY })).json() as { id: number };
    const res = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/dispatch`, headers: r.box,
      payload: { brief: 'go', route: { class: 'fable', effort: 'high' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'fable-operator-only' });
    expect(r.sent('ws-add')).toEqual([]);
    expect(r.sent('route')).toEqual([]);
  });
});

describe('D-6790: the operator PWA routes can still set Fable', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('POST /api/sessions/:id/route writes class=fable', async () => {
    const r = await rig(); app = r.app;
    seed(r.home, 'demo-picker');
    const res = await app.inject({ method: 'POST', url: '/api/sessions/demo-picker/route', payload: { field: 'class', value: 'fable' } });
    expect(res.statusCode).toBe(200);
    expect(r.calls.some((c) => c.join(' ').includes('class=fable') || (c.includes('fable') && c[0] === 'route'))).toBe(true);
  });

  it('POST /api/projects/:p/workspaces carries route class=fable to ws-add', async () => {
    const r = await rig(); app = r.app;
    const res = await app.inject({ method: 'POST', url: `/api/projects/${PROJECT}/workspaces`, payload: { route: { class: 'fable' } } });
    expect(res.statusCode).toBe(200);
    expect(r.sent('ws-add').some((c) => c.join(' ').includes('fable'))).toBe(true);
  });

  it('POST /api/sessions carries route class=fable to start', async () => {
    const r = await rig(); app = r.app;
    const res = await app.inject({ method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude', project: 'other', route: { class: 'fable' } } });
    expect(res.statusCode).not.toBe(409);
    expect(res.statusCode).not.toBe(400);
    expect(r.calls.some((c) => c.join(' ').includes('fable'))).toBe(true);
  });
});
