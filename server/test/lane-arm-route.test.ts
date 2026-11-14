// D-8274 (worktree economy spec 2026-10-28 R-6): Settings › Automation › Shadow lanes, its store and its door —
// `lane_arm_settings` (migration 56, the roster card's row seeded `shadow`), `GET`/`POST /api/coord/lane-arm`, registered on
// a bare Fastify (the `dead-dispatch-route.test.ts` idiom), the one-time import of the retired marker, and the roster card's
// field on `GET /api/runs`, the one the session hook reads.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { NO_SESSION, type GateDecision } from '../src/auth/gate.js';
import { decideLaneArmBody, decideLaneArmImport, laneArmConfirmKey, laneArmRowViewOf, rosterCardFieldOf } from '../src/coord/laneArm.js';
import { LANE_ARM_FEED_TITLE, LANE_ARM_REFUSALS, ROSTER_CARD_SHADOW_LOG, RUNS_ROSTER_CARD_FIELD, laneArmGate } from '../../shared/lane-arm.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from '../../shared/switches.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
});

const SIGNED_IN: GateDecision = { allow: true, verdict: 'ok', reason: 'session', device: null };

const setup = async (o: { coord?: boolean; auth?: boolean; session?: GateDecision } = {}) => {
  const home = mkTmp('ccrc-lane-arm-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home);
  const deps: Deps = {
    ...base, notifyLog, cfg: { ...base.cfg, authEnabled: o.auth ?? true },
    ...(o.coord === false ? {} : { coord }),
  };
  const session = o.session ?? SIGNED_IN;
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), () => session, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  apps.push(app);
  return { app, coord, notifyLog };
};
const get = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/coord/lane-arm' });
const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/coord/lane-arm', payload: payload as Record<string, unknown> });
const rosterRow = (body: { lanes: { lane: string }[] }) => body.lanes.find((l) => l.lane === 'roster-card');

describe('the Shadow lanes store (D-8274)', () => {
  it('a fresh database seeds the roster card shadow, never written, nothing imported', async () => {
    const { coord } = await setup();
    expect(coord.laneArmSetting('roster-card')).toEqual({ kind: 'row', choice: 'shadow', updatedAt: 0, importedAt: null, imported: null });
  });

  it('setLaneArm is an upsert that keeps the import columns', async () => {
    const { coord } = await setup();
    coord.importLaneArmMarker('roster-card', false, 5);
    expect(coord.setLaneArm('roster-card', 'live', 9)).toEqual({ kind: 'row', choice: 'live', updatedAt: 9, importedAt: 5, imported: 'absent' });
    coord.db.exec('DELETE FROM lane_arm_settings');
    expect(coord.laneArmSetting('roster-card')).toEqual({ kind: 'absent' });
    expect(coord.setLaneArm('roster-card', 'shadow', 11)).toMatchObject({ kind: 'row', choice: 'shadow', updatedAt: 11, importedAt: null });
  });

  it('a table that cannot be read answers unreadable, never a throw', async () => {
    const { coord } = await setup();
    coord.db.exec('DROP TABLE lane_arm_settings');
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ kind: 'unreadable' });
  });
});

describe('the marker import, once (D-8274; R-6)', () => {
  it('a standing marker sets a never-written row Live, once; a second pass changes nothing', async () => {
    const { coord } = await setup();
    expect(coord.importLaneArmMarker('roster-card', true, 100)).toBe('stood');
    expect(coord.laneArmSetting('roster-card')).toEqual({ kind: 'row', choice: 'live', updatedAt: 100, importedAt: 100, imported: 'stood' });
    // The import ran: from now on the marker is not read, whether it stands or not.
    expect(coord.importLaneArmMarker('roster-card', false, 200)).toBeNull();
    coord.setLaneArm('roster-card', 'shadow', 300);
    expect(coord.importLaneArmMarker('roster-card', true, 400)).toBeNull();
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 300 });
  });

  it('no marker: the row stays shadow and the import is recorded as absent', async () => {
    const { coord } = await setup();
    expect(coord.importLaneArmMarker('roster-card', false, 100)).toBe('absent');
    expect(coord.laneArmSetting('roster-card')).toEqual({ kind: 'row', choice: 'shadow', updatedAt: 0, importedAt: 100, imported: 'absent' });
  });

  it('a row the operator already set is never overturned by a file', async () => {
    const { coord } = await setup();
    coord.setLaneArm('roster-card', 'shadow', 50);
    expect(coord.importLaneArmMarker('roster-card', true, 100)).toBe('stood-kept');
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 50, imported: 'stood-kept' });
  });

  it('the decider: nothing to do without a row or after the import', () => {
    expect(decideLaneArmImport({ kind: 'absent' }, true)).toBeNull();
    expect(decideLaneArmImport({ kind: 'unreadable', detail: 'x' }, true)).toBeNull();
    expect(decideLaneArmImport({ kind: 'row', choice: 'shadow', updatedAt: 0, importedAt: 1, imported: 'absent' }, true)).toBeNull();
    expect(decideLaneArmImport({ kind: 'row', choice: 'shadow', updatedAt: 0, importedAt: null, imported: null }, true))
      .toEqual({ result: 'stood', setLive: true });
  });
});

describe('GET/POST /api/coord/lane-arm (D-8274)', () => {
  it('the GET answers every row, seeded shadow, naming the retired marker', async () => {
    const { app } = await setup();
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, lanes: [{
      lane: 'roster-card', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null,
      marker: COORDINATOR_ROSTER_CARD_LIVE_MARKER,
    }, {
      lane: 'continuity', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null, marker: null,
    }] });
  });

  it('Live without a key answers 409 confirm-required with the facts and the key; with the key it is written', async () => {
    const { app, coord } = await setup();
    const ask = await post(app, { lane: 'roster-card', choice: 'live' });
    expect(ask.statusCode).toBe(409);
    const body = ask.json();
    expect(body).toMatchObject({ ok: false, error: 'confirm-required', lane: 'roster-card',
      facts: { stored: 'shadow', updatedAt: 0, shadowLog: ROSTER_CARD_SHADOW_LOG } });
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
    const res = await post(app, { lane: 'roster-card', choice: 'live', confirm: body.confirmKey });
    expect(res.statusCode).toBe(200);
    expect(rosterRow(res.json())).toMatchObject({ stored: 'live', live: true });
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'live' });
  });

  it('a key from before a write is stale: asked again with the newer facts, nothing written', async () => {
    const { app, coord } = await setup();
    const key = (await post(app, { lane: 'roster-card', choice: 'live' })).json().confirmKey as string;
    coord.setLaneArm('roster-card', 'shadow', 77);
    const res = await post(app, { lane: 'roster-card', choice: 'live', confirm: key });
    expect(res.statusCode).toBe(409);
    expect(res.json().facts).toMatchObject({ updatedAt: 77 });
    expect(res.json().confirmKey).not.toBe(key);
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow' });
  });

  it('Shadow needs no confirm, and each change is one record-only feed row naming the actor', async () => {
    const { app, coord } = await setup();
    const key = (await post(app, { lane: 'roster-card', choice: 'live' })).json().confirmKey as string;
    await post(app, { lane: 'roster-card', choice: 'live', confirm: key });
    const back = await post(app, { lane: 'roster-card', choice: 'shadow' });
    expect(back.statusCode).toBe(200);
    expect(rosterRow(back.json())).toMatchObject({ stored: 'shadow', live: false });
    // The same choice again changes nothing, and records nothing.
    expect((await post(app, { lane: 'roster-card', choice: 'shadow' })).statusCode).toBe(200);
    const rows = coord.feedEvents(50).filter((e) => e.title === LANE_ARM_FEED_TITLE.changed).map((e) => e.body);
    expect(rows).toEqual(['roster-card: shadow -> live; by unmeasured', 'roster-card: live -> shadow; by unmeasured']);
  });

  it('auth refused: Live answers 403 sign-in-unarmed without a signed-in session, and dark; nothing is written', async () => {
    for (const o of [{ auth: true, session: NO_SESSION }, { auth: false }]) {
      const { app, coord } = await setup(o);
      const res = await post(app, { lane: 'roster-card', choice: 'live', confirm: 'roster-card:shadow:0' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('sign-in-unarmed');
      expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
      // Shadow, the safe direction, is never refused for it.
      expect((await post(app, { lane: 'roster-card', choice: 'shadow' })).statusCode).toBe(200);
    }
    expect(LANE_ARM_REFUSALS).toContain('sign-in-unarmed');
  });

  it('the continuity row\'s gate: Live is refused 409 lane-gated with its reason, signed in, with a key or without, and Shadow is not (review 2003 F3)', async () => {
    const { app, coord } = await setup();
    for (const payload of [{ lane: 'continuity', choice: 'live' }, { lane: 'continuity', choice: 'live', confirm: 'continuity:shadow:0' }]) {
      const res = await post(app, payload);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, error: 'lane-gated', detail: laneArmGate('continuity') });
    }
    expect(coord.laneArmSetting('continuity')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
    expect((await post(app, { lane: 'continuity', choice: 'shadow' })).statusCode).toBe(200);
    // The gate is words a person reads, and only the continuity row has one.
    expect(laneArmGate('continuity')).toMatch(/renewal act/);
    expect(laneArmGate('roster-card')).toBeNull();
    expect(LANE_ARM_REFUSALS).toContain('lane-gated');
    expect(REFUSAL_STATUS['lane-gated']).toBe(409);
  });

  it('a Live already stored on the gated continuity row reads shadow in the view, and the roster card\'s Live stays live (review 2006 N1)', async () => {
    const { app, coord } = await setup();
    coord.setLaneArm('continuity', 'live', 1);
    coord.setLaneArm('roster-card', 'live', 1);
    const res = await get(app);
    const lanes = (res.json() as { lanes: { lane: string; stored: string; live: boolean }[] }).lanes;
    expect(lanes.find((l) => l.lane === 'continuity')).toMatchObject({ stored: 'live', live: false });
    expect(lanes.find((l) => l.lane === 'roster-card')).toMatchObject({ stored: 'live', live: true });
    expect(laneArmRowViewOf('continuity', { kind: 'row', choice: 'live', updatedAt: 1, importedAt: null, imported: null }).live).toBe(false);
  });

  it('refuses any other body with bad-request before anything else, and writes nothing', async () => {
    const { app, coord } = await setup();
    for (const body of [{}, { lane: 'roster-card' }, { lane: 'other', choice: 'live' }, { lane: 'roster-card', choice: 'LIVE' },
      { lane: 'roster-card', choice: 'shadow', extra: 1 }, { lane: 'roster-card', choice: 'live', confirm: 3 }, ['shadow']]) {
      const res = await post(app, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('bad-request');
    }
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
  });

  it('a token this build does not know reads unknown and arms nothing; an unreadable table refuses the POST', async () => {
    const { app, coord } = await setup();
    coord.db.exec("UPDATE lane_arm_settings SET choice = 'later'");
    expect(rosterRow((await get(app)).json())).toMatchObject({ stored: 'unknown', live: false });
    coord.db.exec('DROP TABLE lane_arm_settings');
    expect(rosterRow((await get(app)).json())).toMatchObject({ stored: 'unreadable', live: false });
    const res = await post(app, { lane: 'roster-card', choice: 'shadow' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('state-unreadable');
  });

  it('no coordination database: both verbs answer not-configured', async () => {
    const { app } = await setup({ coord: false });
    expect((await get(app)).json().error).toBe('not-configured');
    expect((await post(app, { lane: 'roster-card', choice: 'shadow' })).json().error).toBe('not-configured');
  });
});

describe('GET /api/runs carries the roster card switch to the hook (D-8274)', () => {
  it('shadow, then live once the row is Live, and left out when the row cannot be read', async () => {
    const { app, coord } = await setup();
    const runs = async () => (await app.inject({ method: 'GET', url: '/api/runs' })).json() as Record<string, unknown>;
    expect((await runs())[RUNS_ROSTER_CARD_FIELD]).toBe('shadow');
    coord.setLaneArm('roster-card', 'live', 1);
    expect((await runs())[RUNS_ROSTER_CARD_FIELD]).toBe('live');
    coord.db.exec("UPDATE lane_arm_settings SET choice = 'later'");
    expect((await runs())[RUNS_ROSTER_CARD_FIELD]).toBe('shadow');
    coord.db.exec('DROP TABLE lane_arm_settings');
    const r = await runs();
    expect(r).not.toHaveProperty(RUNS_ROSTER_CARD_FIELD);
    expect(r).toHaveProperty('runs');
  });
});

describe('the L1 rules (D-8274)', () => {
  it('only an exact live is live', () => {
    const row = (choice: unknown) => laneArmRowViewOf('roster-card', { kind: 'row', choice, updatedAt: 0, importedAt: null, imported: null });
    expect(row('live').live).toBe(true);
    for (const c of ['shadow', 'Live', 'on', 1, null]) expect(row(c).live).toBe(false);
    expect(rosterCardFieldOf({ kind: 'absent' })).toBeNull();
    expect(rosterCardFieldOf({ kind: 'unreadable', detail: 'x' })).toBeNull();
  });

  it('the confirm key binds the stored choice and its write time', () => {
    const v = laneArmRowViewOf('roster-card', { kind: 'row', choice: 'shadow', updatedAt: 0, importedAt: null, imported: null });
    expect(laneArmConfirmKey(v)).toBe('roster-card:shadow:0');
    expect(decideLaneArmBody({ lane: 'roster-card', choice: 'live', confirm: '' }).ok).toBe(false);
  });
});
