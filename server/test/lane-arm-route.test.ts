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
import { decideLaneArmBody, decideLaneArmImport, decideLaneArmPost, laneArmConfirmKey, laneArmRowViewOf, rosterCardFieldOf } from '../src/coord/laneArm.js';
import { W1A_ARM_ROWS } from '../src/continuity/quiz.js';
import { insertQuizRun, ruleQuizRun } from '../src/continuity/quizStore.js';
import {
  LANE_ARM_FEED_TITLE, LANE_ARM_LANES, LANE_ARM_REFUSALS, LANE_ARM_TEXT, ROSTER_CARD_SHADOW_LOG, RUNS_ROSTER_CARD_FIELD, laneArmGate,
  type LaneArmLane,
} from '../../shared/lane-arm.js';
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


/** The replay quiz's baseline as the record path makes it: a run recorded pending, then confirmed by the operator. */
const confirmedBaseline = (coord: CoordStore, sha: string) => {
  const r = insertQuizRun(coord.db, { recordedBy: 'operator', recordedAt: 1, report: {
    measuredAt: 1, reportSha: sha.repeat(64), questionsSha: 'd'.repeat(64), questions: 40, families: 6, score: 0.7, lo: 0.6, hi: 0.8,
    judgeModel: 'judge-a', ccrcRelease: 'v1', claudeBuilds: ['2.1.0'], steerArmed: 'no', agentsOnArmed: 'no',
  }, extra: { answered: 40, correct: 28, runFailed: 0, absent: 0, arm: 'treatment', settingsMode: 'restricted', pilot: 'skipped-by-ruling', ci: 95, method: 'percentile', bootstrapB: 10000,
      inputs: { setup_sha256: '1'.repeat(64), frozen_sha256: '2'.repeat(64), arms_summary_sha256: '3'.repeat(64), judged_sha256: '4'.repeat(64) } } });
  if (!r.ok) throw new Error('insert failed');
  return ruleQuizRun(coord.db, { id: r.id, action: 'confirm', at: 2, by: 'device-a' }, (lane) => coord.laneArmSetting(lane));
};

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
    }, {
      lane: 'launch-profile', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null, marker: null,
    }, {
      lane: 'anchor-slot', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null, marker: null,
    }, {
      lane: 'approval-park', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null, marker: null,
    }], quizBaseline: { baseline: { state: 'not-yet' }, pending: { ok: true, runs: [] } } });
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

  it('the renewal act lifted the continuity row\'s gate: its Live asks for the confirm key like any row, and no row is gated (review 2003 F3)', async () => {
    const { app, coord } = await setup();
    // The replay quiz's baseline (W0-28) stands first, so what answers here is the row's own gate, not the baseline guard.
    expect(confirmedBaseline(coord, 'c')).toMatchObject({ ok: true, baseline: true });
    const first = await post(app, { lane: 'continuity', choice: 'live' });
    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({ ok: false, error: 'confirm-required', lane: 'continuity' });
    expect(coord.laneArmSetting('continuity')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
    const confirmed = await post(app, { lane: 'continuity', choice: 'live', confirm: (first.json() as { confirmKey: string }).confirmKey });
    expect(confirmed.statusCode).toBe(200);
    expect(coord.laneArmSetting('continuity')).toMatchObject({ choice: 'live' });
    expect((await post(app, { lane: 'continuity', choice: 'shadow' })).statusCode).toBe(200);
    // The gate mechanism stays for a row that needs one; approvals PR 3's park row has one until PR 3v.
    for (const lane of ['roster-card', 'continuity', 'launch-profile', 'anchor-slot'] as const) expect(laneArmGate(lane)).toBeNull();
    expect(laneArmGate('approval-park')).not.toBeNull();
    expect(LANE_ARM_REFUSALS).toContain('lane-gated');
    expect(REFUSAL_STATUS['lane-gated']).toBe(409);
  });

  it('approvals PR 3: Live on the park row is refused lane-gated while its gate stands, and nothing is written', async () => {
    const { app, coord } = await setup();
    const res = await post(app, { lane: 'approval-park', choice: 'live' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'lane-gated' });
    expect(coord.laneArmSetting('approval-park')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
  });

  it('a Live stored on the continuity row reads live in the view, as the roster card\'s does; a gate, where one stands, keeps a stored Live shadow (review 2006 N1)', async () => {
    const { app, coord } = await setup();
    coord.setLaneArm('continuity', 'live', 1);
    coord.setLaneArm('roster-card', 'live', 1);
    const res = await get(app);
    const lanes = (res.json() as { lanes: { lane: string; stored: string; live: boolean }[] }).lanes;
    expect(lanes.find((l) => l.lane === 'continuity')).toMatchObject({ stored: 'live', live: true });
    expect(lanes.find((l) => l.lane === 'roster-card')).toMatchObject({ stored: 'live', live: true });
    expect(laneArmRowViewOf('continuity', { kind: 'row', choice: 'live', updatedAt: 1, importedAt: null, imported: null }, 'a gate').live).toBe(false);
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

// The replay quiz piece (Overlord W1a, plan `w1a-replay-quiz.md` Task 2; W0-28 ruled B): a W1a lane-arm row goes live only
// after the replay quiz's baseline row exists (`baseline-missing`), so "taken before any W1a arm is armed" is a mechanism.
describe('arming a W1a lane waits for the quiz baseline (W0-28)', () => {
  const view = (lane: LaneArmLane, choice: unknown = 'shadow') =>
    laneArmRowViewOf(lane, { kind: 'row', choice, updatedAt: 0, importedAt: null, imported: null }, null);
  const decide = (lane: LaneArmLane, choice: 'live' | 'shadow', baseline: { ok: true; exists: boolean } | { ok: false; detail: string },
    confirm?: string) => decideLaneArmPost({
    request: { lane, choice, ...(confirm === undefined ? {} : { confirm }) }, row: view(lane), signedIn: true, baseline, gate: null,
  });
  const MISSING = { ok: true, exists: false } as const;
  const EXISTS = { ok: true, exists: true } as const;

  it('each W1a row: Live is refused baseline-missing before a baseline, and goes on to its confirm key after', () => {
    for (const lane of W1A_ARM_ROWS) {
      expect(decide(lane, 'live', MISSING), lane).toEqual({ kind: 'baseline-missing' });
      expect(decide(lane, 'live', MISSING, `${lane}:shadow:0`), `${lane} with its key`).toEqual({ kind: 'baseline-missing' });
      expect(decide(lane, 'live', EXISTS), lane).toMatchObject({ kind: 'confirm' });
      expect(decide(lane, 'live', EXISTS, `${lane}:shadow:0`), lane).toEqual({ kind: 'write', lane, choice: 'live' });
    }
  });

  it('a baseline that cannot be read refuses a W1a Live as unreadable: doubt never arms one', () => {
    for (const lane of W1A_ARM_ROWS) {
      expect(decide(lane, 'live', { ok: false, detail: 'no table' }, `${lane}:shadow:0`), lane)
        .toEqual({ kind: 'unreadable', detail: expect.stringContaining('no table') });
    }
  });

  it('Shadow is never refused, baseline or not', () => {
    for (const lane of LANE_ARM_LANES) {
      for (const b of [MISSING, EXISTS, { ok: false, detail: 'x' } as const]) {
        expect(decide(lane, 'shadow', b), lane).toEqual({ kind: 'write', lane, choice: 'shadow' });
      }
    }
  });

  it('a lane that is not a W1a row (roster-card) is unaffected', () => {
    expect(W1A_ARM_ROWS).not.toContain('roster-card');
    for (const b of [MISSING, { ok: false, detail: 'x' } as const]) {
      expect(decide('roster-card', 'live', b)).toMatchObject({ kind: 'confirm' });
      expect(decide('roster-card', 'live', b, 'roster-card:shadow:0')).toEqual({ kind: 'write', lane: 'roster-card', choice: 'live' });
    }
  });

  it('a standing gate still answers first: the baseline is asked of a row that can go live', () => {
    expect(decideLaneArmPost({ request: { lane: 'continuity', choice: 'live' }, row: view('continuity'), signedIn: true, baseline: MISSING, gate: 'g' }))
      .toEqual({ kind: 'gated', reason: 'g' });
  });

  it('the route: a W1a Live is 409 baseline-missing naming why, writes nothing, and passes once a baseline row exists', async () => {
    const { app, coord } = await setup();
    const res = await post(app, { lane: 'anchor-slot', choice: 'live', confirm: 'anchor-slot:shadow:0' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'baseline-missing', detail: LANE_ARM_TEXT.baselineMissing });
    expect(coord.laneArmSetting('anchor-slot')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
    expect(LANE_ARM_REFUSALS).toContain('baseline-missing');
    expect(REFUSAL_STATUS['baseline-missing']).toBe(409);
    const recorded = confirmedBaseline(coord, 'a');
    expect(recorded).toMatchObject({ ok: true, baseline: true });
    const ok = await post(app, { lane: 'anchor-slot', choice: 'live', confirm: 'anchor-slot:shadow:0' });
    expect(ok.statusCode).toBe(200);
    expect(coord.laneArmSetting('anchor-slot')).toMatchObject({ choice: 'live' });
  });

  it('the route: an unreadable quiz table refuses a W1a Live 503 state-unreadable, and Shadow still writes', async () => {
    const { app, coord } = await setup();
    coord.db.exec('DROP TABLE continuity_quiz_runs');
    const res = await post(app, { lane: 'launch-profile', choice: 'live', confirm: 'launch-profile:shadow:0' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'state-unreadable' });
    expect((await post(app, { lane: 'launch-profile', choice: 'shadow' })).statusCode).toBe(200);
  });

  it('the route: roster-card goes live with no baseline', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { lane: 'roster-card', choice: 'live', confirm: 'roster-card:shadow:0' })).statusCode).toBe(200);
    expect(coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'live' });
  });
});

// The replay quiz's block on the card (plan `2026-11-17-overlord-quiz-record.md` Task 12): the GET and the POST's answer carry
// the baseline (recorded with its date, not yet, or unreadable) and the pending runs, oldest first.
describe('the Shadow lanes card\'s quiz block', () => {
  it('not yet with no runs; a pending run listed; once confirmed the baseline is recorded with its date', async () => {
    const { app, coord } = await setup();
    expect((await get(app)).json()).toMatchObject({ ok: true, quizBaseline: { baseline: { state: 'not-yet' }, pending: { ok: true, runs: [] } } });
    const r = insertQuizRun(coord.db, { recordedBy: 'operator', recordedAt: 7, report: {
      measuredAt: 6, reportSha: 'e'.repeat(64), questionsSha: 'd'.repeat(64), questions: 40, families: 6, score: 0.7, lo: 0.6, hi: 0.8,
      judgeModel: 'judge-a', ccrcRelease: 'v1', claudeBuilds: ['2.1.0'], steerArmed: 'no', agentsOnArmed: 'no',
    }, extra: { answered: 39, correct: 27, runFailed: 1, absent: 0, arm: 'treatment', settingsMode: 'fallback', pilot: 'skipped-by-ruling', ci: 95,
      method: 'percentile', bootstrapB: 10000, inputs: { setup_sha256: '1'.repeat(64), frozen_sha256: '2'.repeat(64), arms_summary_sha256: '3'.repeat(64), judged_sha256: '4'.repeat(64) } } });
    if (!r.ok) throw new Error('insert failed');
    expect((await get(app)).json()).toMatchObject({ quizBaseline: { baseline: { state: 'not-yet' }, pending: { ok: true, runs: [
      { id: r.id, recordedAt: 7, reportShaPrefix: 'e'.repeat(12), recordedBy: 'operator', measuredAt: 6, score: 0.7, lo: 0.6, hi: 0.8,
        questions: 40, families: 6, answered: 39, runFailed: 1, absent: 0 },
    ] } } });
    ruleQuizRun(coord.db, { id: r.id, action: 'confirm', at: 8, by: 'device-a' }, (lane) => coord.laneArmSetting(lane));
    expect((await get(app)).json()).toMatchObject({ quizBaseline: { baseline: { state: 'recorded', at: 7 }, pending: { ok: true, runs: [] } } });
    expect((await post(app, { lane: 'roster-card', choice: 'shadow' })).json()).toMatchObject({ quizBaseline: { baseline: { state: 'recorded', at: 7 } } });
  });

  it('an unreadable quiz table shows the baseline and the pending runs as unreadable, never as not yet', async () => {
    const { app, coord } = await setup();
    coord.db.exec('DROP TABLE continuity_quiz_runs');
    const body = (await get(app)).json() as { quizBaseline: { baseline: { state: string }; pending: { ok: boolean } } };
    expect(body.quizBaseline.baseline.state).toBe('unreadable');
    expect(body.quizBaseline.pending.ok).toBe(false);
  });
});
