// Settings › Automation › "Roll idle sessions" (D-7453; D-8276): the store's one row and its door, `GET`/`POST
// /api/coord/roll-idle`. The default is `all` (every idle session, the operator's ruling of 2026-11-10); `coordinators`
// keeps the 2026-10-29 rule as a choice; `off` rolls nothing. The migration's seed (`coordinators`, never written by an
// operator) reads as the default. A bare Fastify, the stall-watch route suite's idiom.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import type { GateDecision } from '../src/auth/gate.js';
import { rollTargetsOf } from '../src/coord/rollTarget.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

async function setup(): Promise<{ app: FastifyInstance; coord: CoordStore; notifyLog: NotifyLog }> {
  const home = mkTmp('ccrc-roll-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home);
  const deps: Deps = { ...base, notifyLog, coord };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, undefined);
  apps.push(app);
  return { app, coord, notifyLog };
}

describe('the roll setting row (D-7453; D-8276)', () => {
  it('a fresh database\'s seed, never written by an operator, reads as the default: every idle session', async () => {
    const { coord } = await setup();
    expect(coord.rollSettings()).toEqual({ kind: 'row', targets: 'coordinators', seeded: true });
    expect(rollTargetsOf(coord.rollSettings())).toBe('all');
  });

  it('GET answers the setting, its default and its three choices', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: '/api/coord/roll-idle' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, targets: 'all', default: 'all', choices: ['all', 'coordinators', 'off'] });
  });

  it('POST off turns it off, records who did, and POST all turns it back on', async () => {
    const { app, coord } = await setup();
    const off = await app.inject({ method: 'POST', url: '/api/coord/roll-idle', payload: { targets: 'off' } });
    expect(off.statusCode).toBe(200);
    expect(off.json().targets).toBe('off');
    expect(rollTargetsOf(coord.rollSettings())).toBe('off');
    const ev = coord.feedEvents(10).at(-1)!;
    expect([ev.kind, ev.title, ev.body]).toEqual(['coord', 'roll idle sessions changed', 'roll idle sessions: all -> off; by flag-off']);
    const on = await app.inject({ method: 'POST', url: '/api/coord/roll-idle', payload: { targets: 'all' } });
    expect(on.json().targets).toBe('all');
  });

  it('POST coordinators on the untouched seed writes it, so the 10-29 rule can still be chosen and stays chosen', async () => {
    const { app, coord } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/coord/roll-idle', payload: { targets: 'coordinators' } });
    expect(r.json().targets).toBe('coordinators');
    expect(coord.rollSettings()).toEqual({ kind: 'row', targets: 'coordinators', seeded: false });
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.body).toBe('roll idle sessions: all -> coordinators; by flag-off');
  });

  it('anything outside the three is refused and changes nothing', async () => {
    const { app, coord } = await setup();
    for (const bad of [{ targets: 'children' }, { targets: 1 }, {}]) {
      const r = await app.inject({ method: 'POST', url: '/api/coord/roll-idle', payload: bad });
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(rollTargetsOf(coord.rollSettings())).toBe('all');
  });

  it('a write that changes nothing keeps the stored time', async () => {
    const { coord } = await setup();
    coord.setRollTargets('off', 5);
    const w = coord.setRollTargets('off', 9);
    expect(w.before).toEqual(w.after);
  });
});
