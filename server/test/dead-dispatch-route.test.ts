// D-7319: the switch's store and door — `dispatch_abandon_settings` (migration 33, seeded `on`), and `GET`/`POST
// /api/coord/dispatch-abandon`, registered on a bare Fastify (the `stall-settings-route.test.ts` idiom). Also the bound's
// config key: a value inside the stalled threshold is refused for the default.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import type { GateDecision } from '../src/auth/gate.js';
import { dispatchAbandonMsOf, loadConfig } from '../src/config.js';
import { SPAWN_STALL_MS } from '../../shared/api.js';
import { DISPATCH_ABANDON_DEFAULT_MS, DISPATCH_ABANDON_REFUSALS } from '../../shared/dispatch-abandon.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
});

const setup = async (o: { coord?: boolean } = {}) => {
  const home = mkTmp('ccrc-dispatch-abandon-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home);
  const deps: Deps = { ...base, notifyLog, ...(o.coord === false ? {} : { coord }) };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  apps.push(app);
  return { app, coord, notifyLog };
};
const get = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/coord/dispatch-abandon' });
const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/coord/dispatch-abandon', payload: payload as Record<string, unknown> });

describe('the dead-dispatch switch (D-7319)', () => {
  it('a fresh database is seeded ON: the ruling default, armed, with the default bound', async () => {
    const { app } = await setup();
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, stored: 'on', detail: null, armed: true, boundMs: DISPATCH_ABANDON_DEFAULT_MS, updatedAt: 0 });
  });

  it('POST off then on stores each, answers the view, and records each change in the feed once', async () => {
    const { app, coord } = await setup();
    const off = await post(app, { choice: 'off' });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ ok: true, stored: 'off', armed: false });
    expect(coord.dispatchAbandonSetting()).toMatchObject({ kind: 'row', choice: 'off' });
    // The same choice again changes nothing, and records nothing.
    expect((await post(app, { choice: 'off' })).statusCode).toBe(200);
    const on = await post(app, { choice: 'on' });
    expect(on.json()).toMatchObject({ stored: 'on', armed: true });
    const titles = coord.feedEvents(50).filter((e) => e.title === 'dispatch abandon changed').map((e) => e.body);
    expect(titles).toEqual([
      'abandoning dispatches that never came back: on -> off; by flag-off',
      'abandoning dispatches that never came back: off -> on; by flag-off',
    ]);
  });

  it('refuses any other body with bad-request and writes nothing', async () => {
    const { app, coord } = await setup();
    for (const body of [{}, { choice: 'ON' }, { choice: true }, { choice: 'off', extra: 1 }, ['off']]) {
      const res = await post(app, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('bad-request');
    }
    expect(coord.dispatchAbandonSetting()).toMatchObject({ kind: 'row', choice: 'on', updatedAt: 0 });
    expect(DISPATCH_ABANDON_REFUSALS).toContain('bad-request');
  });

  it('a row holding a token this build does not know reads unknown and arms nothing; a lost row reads absent', async () => {
    const { app, coord } = await setup();
    coord.db.exec("UPDATE dispatch_abandon_settings SET choice = 'later'");
    expect((await get(app)).json()).toMatchObject({ stored: 'unknown', armed: false });
    coord.db.exec('DELETE FROM dispatch_abandon_settings');
    expect((await get(app)).json()).toMatchObject({ stored: 'absent', armed: false, updatedAt: null });
    // The POST puts a row back.
    expect((await post(app, { choice: 'on' })).json()).toMatchObject({ stored: 'on', armed: true });
  });

  it('a table that cannot be read: the GET says unreadable, the POST refuses state-unreadable', async () => {
    const { app, coord } = await setup();
    coord.db.exec('DROP TABLE dispatch_abandon_settings');
    expect((await get(app)).json()).toMatchObject({ stored: 'unreadable', armed: false });
    const res = await post(app, { choice: 'on' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('state-unreadable');
  });

  it('no coordination database: both verbs answer not-configured', async () => {
    const { app } = await setup({ coord: false });
    expect((await get(app)).json().error).toBe('not-configured');
    expect((await post(app, { choice: 'on' })).json().error).toBe('not-configured');
  });
});

describe('CCRC_DISPATCH_ABANDON_MS (D-7319)', () => {
  it('unset or empty is the default; a whole number at or above the stalled threshold is taken', () => {
    expect(dispatchAbandonMsOf(undefined)).toBe(DISPATCH_ABANDON_DEFAULT_MS);
    expect(dispatchAbandonMsOf('')).toBe(DISPATCH_ABANDON_DEFAULT_MS);
    expect(dispatchAbandonMsOf(String(SPAWN_STALL_MS))).toBe(SPAWN_STALL_MS);
    expect(dispatchAbandonMsOf('3600000')).toBe(3_600_000);
    const home = mkTmp('ccrc-cfg-');
    seedRoster(home);
    expect(loadConfig({ CCRC_HOME: home, CCRC_DISPATCH_ABANDON_MS: '1800000' } as never).dispatchAbandonMs).toBe(1_800_000);
  });

  it('a value inside the stalled threshold, or not a whole number, is refused for the default, said once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(dispatchAbandonMsOf(String(SPAWN_STALL_MS - 1))).toBe(DISPATCH_ABANDON_DEFAULT_MS);
    expect(dispatchAbandonMsOf('15m')).toBe(DISPATCH_ABANDON_DEFAULT_MS);
    expect(dispatchAbandonMsOf('900000.5')).toBe(DISPATCH_ABANDON_DEFAULT_MS);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
