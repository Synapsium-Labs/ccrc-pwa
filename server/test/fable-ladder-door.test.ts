// D-6790: the run-route door's backstop over a LADDER result. The ladders stop at the ceiling, so the only way to
// put a `fable` move in front of the door is a ladder that answers one; this file stubs `escalate` to do so.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

vi.mock('../../shared/routing-ladder.js', async (orig) => {
  const real = await orig<typeof import('../../shared/routing-ladder.js')>();
  return { ...real, escalate: () => ({ kind: 'move', mode: 'escalate', field: 'class', from: 'opus', to: 'fable', why: 'stub' }) };
});

import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

describe('D-6790: POST /api/runs/:id/route over a ladder result naming fable', () => {
  it('answers 409 fable-operator-only and writes nothing', async () => {
    const home = mkTmp('ccrc-fable-ladder-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const seed = (id: string) => {
      for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`,
        started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', class: 'opus', effort: 'high' })) {
        writeFileSync(path.join(reg, `${id}.${k}`), v);
      }
    };
    seed('coord');
    const calls: string[][] = [];
    const run: Runner = async (_c, args) => {
      calls.push(args);
      if (args[0] === 'ws-add') { seed('demo-fresh'); return { code: 0, stdout: 'workspace demo-decoy on claude — /w/x (branch ws/decoy)', stderr: '' }; }
      return { code: 0, stdout: '', stderr: '' };
    };
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const fleetState = { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ROUTE_CAP, ACTOR_FLAGS_CAP] as string[] };
    app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, fleetState });
    const headers = { 'x-ccrc-mail-token': TOKEN };
    const opened = (await app.inject({ method: 'POST', url: '/api/runs', headers, payload: {
      program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: 'coord', homeProject: 'demo', claimedByUuid: 'u-coord' } })).json() as { id: number };
    const d = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/dispatch`, headers, payload: { brief: 'go' } });
    expect(d.body).toContain('"ok":true');
    const res = await app.inject({ method: 'POST', url: `/api/runs/${opened.id}/route`, headers,
      payload: { target: 'worker', why: 'stub', kind: 'ceiling' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'fable-operator-only' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
  });
});
