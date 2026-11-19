// Overlord W1a, the renewal hand-offs, Task 1 (plan `w1a-renewal-handoffs.md`): the operator's Renew now. The door
// `POST /api/sessions/:id/renew` records a request (session-gated, in `CONTINUITY_SESSION_DOORS`) and decides nothing about the
// renewal; the generations lane reads it after its own `renew-requests` cursor, once, and makes the session's live generation
// due `operator` (hard): live, the walk starts. A press in shadow, or one read on a shadow pass, is passed over with the cursor
// and never becomes a due, then or after the row is armed (the coordinator's ruling F1 on review 2312). A real coord.db,
// fixture HOMEs and the fake time ports; nothing reaches the fleet.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildServer } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { RENEW_REQUESTS_CURSOR, type GenRow } from '../src/continuity/continuityStore.js';
import { generationsPass, type GenerationsDeps, type RegistryFacts } from '../src/continuity/generationsLane.js';
import * as renewNowModule from '../src/continuity/renewNow.js';
import { renewDoorVerdict } from '../src/continuity/renewNow.js';
import { renewNowCases } from './sim/handoffSets.js';
import type { FleetRole } from '../../shared/fleetRoles.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { HANDOFF_REFUSALS, REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const COORD = 'lane-a-project-a';
const PLAIN = 'lane-b-project-a';
const U1 = '11111111-1111-4111-8111-111111111111';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  removeTmpFixtures();
});

let starts = 0;
/** One generation of `role` for `sessionId`, minted from a recorded start, in shadow (`state` stays `active`). */
function mint(coord: CoordStore, sessionId: string, role: FleetRole, now = FAKE_T0): GenRow {
  starts += 1;
  const s = coord.insertStart({ sessionId, reportId: `r-${starts}`, uuid: U1, source: 'startup', model: 'claude-opus-5-5',
    rowIncarnation: INC, reportedAt: now, receivedAt: now });
  if (!s.ok) throw new Error('start not recorded');
  const w = coord.mintGeneration({ identity: sessionId, sessionId, role, term: 1, rowIncarnation: INC, startId: s.id,
    startReportedAt: now, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'woken', mono: 1_000,
    proc: 'p1', now }, null, false);
  if (!w.ok) throw new Error(`mint: ${w.kind}`);
  return liveOf(coord, sessionId)!;
}
/** The generation at rest: no walk in flight on either column, as after a card read and its probes. */
function atRest(coord: CoordStore, sessionId: string): void {
  coord.db.prepare("UPDATE continuity_generations SET state = 'active', shadowState = NULL, walk = NULL, deadlineAt = NULL, "
    + "shadowDeadlineAt = NULL, walkClass = NULL WHERE sessionId = ? AND state <> 'ended'").run(sessionId);
}
const liveOf = (coord: CoordStore, sessionId: string): GenRow | undefined => {
  const r = coord.liveGenerations();
  if (!r.ok) throw new Error(r.detail);
  return r.rows.filter((g) => g.sessionId === sessionId).at(-1);
};
const cursorOf = (coord: CoordStore): number => {
  const c = coord.generationsCursor(RENEW_REQUESTS_CURSOR);
  if (!c.ok) throw new Error(c.detail);
  return c.lastStartId;
};
const refused = (res: { statusCode: number; json: () => unknown }): [number, string] => [res.statusCode, (res.json() as { error: string }).error];

// ── The decider ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('renewDoorVerdict and renewNowStands (L1)', () => {
  it('a live generation of a long-lived role with no request waiting is ok; anything else is refused or unmeasured', () => {
    expect(renewDoorVerdict({ live: { role: 'coordinator' }, pending: false })).toBe('ok');
    expect(renewDoorVerdict({ live: { role: 'overlord' }, pending: false })).toBe('ok');
    expect(renewDoorVerdict({ live: { role: 'coordinator' }, pending: true })).toBe('renew-pending');
    expect(renewDoorVerdict({ live: null, pending: false })).toBe('renew-not-long-lived');
    expect(renewDoorVerdict({ live: { role: 'plain' }, pending: false })).toBe('renew-not-long-lived');
    expect(renewDoorVerdict({ live: { role: 'worker' }, pending: 'unmeasured' })).toBe('renew-not-long-lived');
    expect(renewDoorVerdict({ live: 'unmeasured', pending: false })).toBe('unmeasured');
    expect(renewDoorVerdict({ live: { role: 'coordinator' }, pending: 'unmeasured' })).toBe('unmeasured');
  });

  // `renewNowStands`' cases are written once, in the mutation set, and run here against the real module.
  for (const [name, run] of Object.entries(renewNowCases(renewNowModule))) it(`renewNowStands: ${name}`, run);

  it('the door words are 409 each, from the one table', () => {
    for (const w of ['renew-not-long-lived', 'renew-pending', 'renewing'] as const) {
      expect(HANDOFF_REFUSALS[w]).toBe(409);
      expect(REFUSAL_STATUS[w]).toBe(409);
    }
  });
});

// ── The door, on the real server ─────────────────────────────────────────────────────────────────────────────────────

async function server(armed: boolean): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-renew-now-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  seedRow(home, COORD, { uuid: U1, project: 'project-a', generation: INC });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, recorder().run);
  const a = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: armed }, mailToken: ID_GATE_TOKEN, coord });
  await a.ready();
  app = a;
  return { app: a, coord };
}
const cookieOf = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
  expect(res.statusCode, res.body).toBe(204);
  const setCookie = res.headers['set-cookie'];
  const line = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return line.slice(0, line.indexOf(';'));
};
const renew = (a: FastifyInstance, id: string, headers: Record<string, string> = {}) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/renew`, headers, payload: {} });
const requests = (coord: CoordStore): unknown[] => coord.db.prepare('SELECT id, sessionId, actor, live FROM continuity_renew_requests ORDER BY id').all();

describe('POST /api/sessions/:id/renew (the door)', () => {
  it('with sign-in off, a coordinator with a live generation is recorded (200), once: a second waits for the lane (renew-pending)', async () => {
    const { app: a, coord } = await server(false);
    mint(coord, COORD, 'coordinator');
    const res = await renew(a, COORD);
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, id: 1, shadow: true }]);
    expect(requests(coord)).toEqual([{ id: 1, sessionId: COORD, actor: 'flag-off', live: 0 }]);
    expect(refused(await renew(a, COORD))).toEqual([409, 'renew-pending']);
    expect(requests(coord)).toHaveLength(1);
    // Once the lane has read it (its cursor past the request), the operator may ask again.
    expect(coord.advanceCursor({ lane: RENEW_REQUESTS_CURSOR, from: 0, to: 1 })).toEqual({ changed: true });
    expect((await renew(a, COORD)).statusCode).toBe(200);
  });

  it('with the continuity row live, the press is recorded live and the answer says so (shadow: false)', async () => {
    const { app: a, coord } = await server(false);
    coord.setLaneArm(CONTINUITY_LANE, 'live', 1);
    mint(coord, COORD, 'coordinator');
    const res = await renew(a, COORD);
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, id: 1, shadow: false }]);
    expect(requests(coord)).toEqual([{ id: 1, sessionId: COORD, actor: 'flag-off', live: 1 }]);
  });

  it('a session with no live generation, or one of a role that is not long-lived, is renew-not-long-lived and records nothing', async () => {
    const { app: a, coord } = await server(false);
    expect(refused(await renew(a, COORD))).toEqual([409, 'renew-not-long-lived']);
    mint(coord, PLAIN, 'plain');
    expect(refused(await renew(a, PLAIN))).toEqual([409, 'renew-not-long-lived']);
    expect(refused(await renew(a, 'bad id!'))).toEqual([400, 'bad-request']);
    expect(requests(coord)).toEqual([]);
  });

  it('with sign-in armed, no cookie is 401 and the box token is no key; with a session it is recorded, naming the device', async () => {
    const { app: a, coord } = await server(true);
    mint(coord, COORD, 'coordinator');
    expect(refused(await renew(a, COORD))).toEqual([401, 'unauthenticated']);
    expect(refused(await renew(a, COORD, { 'x-ccrc-mail-token': ID_GATE_TOKEN }))).toEqual([401, 'unauthenticated']);
    expect(requests(coord)).toEqual([]);
    const cookie = await cookieOf(a);
    expect((await renew(a, COORD, { cookie })).statusCode).toBe(200);
    const [row] = requests(coord) as { actor: string }[];
    expect(row!.actor).not.toBe('flag-off');
  });
});

// ── The lane ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function laneFixture() {
  const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-renew-lane-'), '.ccrc', 'coord.db')));
  // The coordinator claims an open work run, so `roleOf` reads it as a coordinator.
  s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
  s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1)").run(COORD);
  const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
  const registry: RegistryFacts[] = [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }];
  const logs: string[] = [];
  const deps: GenerationsDeps = { coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: (l) => logs.push(l),
    retried: new Set(), emptyTries: new Map(), gate: () => null };
  const pass = () => generationsPass(deps, { registry, readings: new Map(), listedAt: t.ports.clock.wall() + 1, canRenew: true });
  const request = (sessionId = COORD, live = true): number => {
    const w = s.insertRenewRequest({ sessionId, actor: 'flag-off', at: t.ports.clock.wall(), live });
    if (!w.ok) throw new Error('request not recorded');
    return w.id;
  };
  return { s, t, logs, pass, request };
}

describe('the generations lane reads Renew now requests (Task 1)', () => {
  it('shadow: a press is passed over with the cursor and logged; no operator due is written and nothing walks (ruling F1)', () => {
    const f = laneFixture();
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    const id = f.request(COORD, false);
    const r = f.pass();
    expect(r.live).toBe(false);
    expect(r.planned).toEqual([]);
    expect(liveOf(f.s, COORD)).toMatchObject({ state: 'active', shadowState: null, dueWhy: null, dueSince: null, walk: null });
    expect(f.logs.some((l) => l.includes(`${COORD} Renew now ${id} read; pressed or read in shadow, so nothing renews`))).toBe(true);
    expect(cursorOf(f.s)).toBe(id);
  });

  it('the flip: a press in shadow, read in shadow, then the row armed: the next live pass renews nothing (ruling F1)', () => {
    const f = laneFixture();
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    f.request(COORD, false);
    f.pass();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    f.t.advance(30_000);
    const r = f.pass();
    expect(r.live).toBe(true);
    expect(liveOf(f.s, COORD)).toMatchObject({ state: 'active', dueWhy: null, walkClass: null });
    expect(r.planned.filter((p) => p.act.kind === 'renew')).toEqual([]);
  });

  it('the race: a press in shadow that the lane first reads once the row is armed renews nothing either', () => {
    const f = laneFixture();
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    const id = f.request(COORD, false);
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    const r = f.pass();
    expect(r.live).toBe(true);
    expect(liveOf(f.s, COORD)).toMatchObject({ state: 'active', dueWhy: null });
    expect(cursorOf(f.s)).toBe(id);
  });

  it('a lowering: an operator due a live pass wrote is cleared by the next shadow pass, so re-arming renews nothing', () => {
    const f = laneFixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    f.s.db.prepare("UPDATE continuity_generations SET dueSince = 1, dueWhy = 'operator', dueClass = 'hard', dueSinceObservedMs = 0").run();
    f.s.setLaneArm(CONTINUITY_LANE, 'shadow', 2);
    f.pass();
    expect(liveOf(f.s, COORD)).toMatchObject({ dueWhy: null, dueSince: null });
  });

  it('an operator due ends with its generation: the ended row carries none (ruling F1)', () => {
    const f = laneFixture();
    const g = mint(f.s, COORD, 'coordinator');
    f.s.db.prepare("UPDATE continuity_generations SET dueSince = 1, dueWhy = 'operator', dueClass = 'hard', dueSinceObservedMs = 0 WHERE id = ?").run(g.id);
    const s2 = f.s.insertStart({ sessionId: COORD, reportId: 'r-end', uuid: U1, source: 'startup', model: 'claude-opus-5-5',
      rowIncarnation: INC, reportedAt: FAKE_T0, receivedAt: FAKE_T0 });
    if (!s2.ok) throw new Error('start');
    const w = f.s.mintGeneration({ identity: COORD, sessionId: COORD, role: 'coordinator', term: 1, rowIncarnation: INC, startId: s2.id,
      startReportedAt: FAKE_T0, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'woken', mono: 2_000,
      proc: 'p1', now: FAKE_T0 }, { term: g.term, n: g.n, state: g.state, shadowState: g.shadowState, walk: g.walk }, false);
    expect(w.ok).toBe(true);
    expect(f.s.db.prepare('SELECT state, dueWhy, dueSince, dueClass FROM continuity_generations WHERE id = ?').get(g.id))
      .toEqual({ state: 'ended', dueWhy: null, dueSince: null, dueClass: null });
  });

  it('live: the request starts the renewal walk on `state` (draining, hard)', () => {
    const f = laneFixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    f.request();
    const r = f.pass();
    expect(r.live).toBe(true);
    expect(liveOf(f.s, COORD)).toMatchObject({ state: 'draining', walkClass: 'hard', dueWhy: 'operator', walk: 'live' });
  });

  it('a request behind the cursor is not read again: the next pass, with the due cleared, finds nothing to renew', () => {
    const f = laneFixture();
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    const id = f.request();
    f.pass();
    atRest(f.s, COORD);
    f.s.db.prepare('UPDATE continuity_generations SET dueSince = NULL, dueWhy = NULL, dueClass = NULL, dueSinceObservedMs = NULL').run();
    f.t.advance(30_000);
    f.pass();
    expect(liveOf(f.s, COORD)).toMatchObject({ state: 'active', shadowState: null, dueWhy: null });
    expect(cursorOf(f.s)).toBe(id);
  });

  it('an operator due stands across passes while the renewal waits (no capability), rather than for one pass', () => {
    const f = laneFixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    f.request();
    const deps: GenerationsDeps = { coord: f.s, clock: f.t.ports.clock, entropy: f.t.ports.entropy, proc: 'p1', log: () => {},
      retried: new Set(), emptyTries: new Map(), gate: () => null };
    const passNoCap = () => generationsPass(deps, { registry: [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }],
      readings: new Map(), listedAt: f.t.ports.clock.wall() + 1, canRenew: false });
    expect(passNoCap().waits).toMatchObject({ 'capability-missing': 1 });
    f.t.advance(30_000);
    passNoCap();
    expect(liveOf(f.s, COORD)).toMatchObject({ state: 'active', dueWhy: 'operator' });
  });

  it('a request no judged generation reads (the session has none) is passed over with the cursor', () => {
    const f = laneFixture();
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    const id = f.request(PLAIN);
    f.pass();
    expect(cursorOf(f.s)).toBe(id);
    expect(liveOf(f.s, COORD)).toMatchObject({ dueWhy: null });
  });

  it('a due write that is refused leaves the cursor, so the next pass reads the request again', () => {
    const f = laneFixture();
    f.s.setLaneArm(CONTINUITY_LANE, 'live', 1);
    mint(f.s, COORD, 'coordinator');
    atRest(f.s, COORD);
    const id = f.request();
    const refuse = new Proxy(f.s, {
      get: (target, key, recv) => key === 'setGenerationDue' ? () => ({ changed: false }) : Reflect.get(target, key, recv),
    });
    generationsPass({ coord: refuse, clock: f.t.ports.clock, entropy: f.t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null }, { registry: [{ id: COORD, uuid: U1, lane: 'lane-a', child: { kind: 'none' } }],
      readings: new Map(), listedAt: f.t.ports.clock.wall() + 1 });
    expect(cursorOf(f.s)).toBe(0);
    f.pass();
    expect(cursorOf(f.s)).toBe(id);
    expect(liveOf(f.s, COORD)).toMatchObject({ dueWhy: 'operator' });
  });
});
