// Overlord W1a, the replay quiz's record path (plan `2026-11-17-overlord-quiz-record.md` Tasks 8 and 9): the record door,
// `POST /api/continuity/quiz-runs` (box token, the operator's shell), which records a single-arm report as `pending` through
// `quizRecordVerdict`, and the rule door, `POST /api/continuity/quiz-runs/:id/rule` (a session and the account gate's
// step-up), through which the operator confirms or discards it. Fixture HOMEs only.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { quizBaselineRead, quizPendingRead, quizRuns } from '../src/continuity/quizStore.js';
import { BOOTSTRAP } from '../../deploy/history-gate.mjs';
import { QUIZ_BOOTSTRAP } from '../../shared/lane-arm.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { singleReport } from './sim/quizSets.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'a test passphrase for the quiz suite';
const ORIGIN = 'http://localhost:7788';
const TOKEN = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const HOUR = 3_600_000;
const TRACE = 'quiz-record op both 2026-11-17T09:00:00Z';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

interface Rig {
  coord: CoordStore; now: number;
  send: (o: { url: string; payload?: unknown; headers?: Record<string, string>; cookie?: boolean }) => Promise<LightMyRequestResponse>;
  stepUp: () => Promise<void>;
}

/** The server over a fixture HOME. `armed`: sign-in on, a loopback origin, a session from the passphrase login. */
async function rig(o: { armed?: boolean; coord?: boolean } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-quiz-route-');
  seedRow(home, 'lane-a');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const base = testDeps(home, recorder().run);
  const armed = o.armed ?? false;
  const deps: Deps = {
    ...base, mailToken: ID_GATE_TOKEN, ...(o.coord === false ? {} : { coord }),
    cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false, rpId: 'localhost', origin: ORIGIN },
  };
  app = await buildServer(deps, new Bus());
  let cookie = '';
  if (armed) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE }, headers: { 'user-agent': 'a test phone', origin: ORIGIN } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  const self = app;
  const send: Rig['send'] = ({ url, payload, headers, cookie: withCookie = true }) => self.inject({
    method: 'POST', url,
    headers: { origin: ORIGIN, ...(withCookie && cookie !== '' ? { cookie } : {}), 'content-type': 'application/json', ...headers },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  return {
    coord, now: base.time.clock.wall(), send,
    stepUp: async () => {
      const r = await send({ url: '/api/auth/step-up/passphrase', payload: { passphrase: PASSPHRASE } });
      expect(r.statusCode, r.body).toBeLessThan(300);
    },
  };
}

const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');
/** The verb's body: the report file's text, its sha and the trace. */
const bodyOf = (r: Rig, over: Record<string, unknown> = {}, text?: string) => {
  const report = text ?? `${JSON.stringify(singleReport({ measured_ms: r.now - HOUR, ...over }))}\n`;
  return { report, sha256: sha(report), recordedBy: TRACE };
};
const record = (r: Rig, payload: unknown, headers: Record<string, string> = TOKEN) =>
  r.send({ url: '/api/continuity/quiz-runs', payload, headers, cookie: false });
const rule = (r: Rig, id: number | string, action: unknown) => r.send({ url: `/api/continuity/quiz-runs/${id}/rule`, payload: { action } });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;

describe('the frozen bootstrap copy', () => {
  it('equals history-gate.mjs#BOOTSTRAP on ci, method and B', () => {
    expect(QUIZ_BOOTSTRAP).toEqual({ ci: BOOTSTRAP.ci, method: BOOTSTRAP.method, B: BOOTSTRAP.B });
    expect(Object.isFrozen(QUIZ_BOOTSTRAP)).toBe(true);
  });
});

describe('POST /api/continuity/quiz-runs (the record door, box token)', () => {
  it('no token answers 401, and a wrong one too; nothing is written', async () => {
    const r = await rig();
    for (const headers of [{}, { 'x-ccrc-mail-token': 'e'.repeat(64) }]) {
      const res = await record(r, bodyOf(r), headers);
      expect(res.statusCode, res.body).toBe(401);
      expect(json(res)).toMatchObject({ ok: false, error: 'unauthenticated' });
    }
    expect(quizRuns(r.coord.db)).toEqual({ ok: true, rows: [] });
  });

  it('a good report answers 200 pending with no baseline; a resend answers fresh: false and the first row', async () => {
    const r = await rig();
    const body = bodyOf(r);
    const first = await record(r, body);
    expect(first.statusCode, first.body).toBe(200);
    expect(json(first)).toEqual({ ok: true, id: expect.any(Number), fresh: true, state: 'pending' });
    const again = await record(r, { ...body, recordedBy: 'quiz-record other both 2026-11-17T10:00:00Z' });
    expect(json(again)).toEqual({ ok: true, id: json(first)['id'], fresh: false, state: 'pending' });
    const runs = quizRuns(r.coord.db);
    expect(runs.ok && runs.rows.map((x) => [x.reportSha, x.recordedBy, x.state, x.baseline, x.score, x.answered])).toEqual([
      [body.sha256, TRACE, 'pending', false, 79 / 96, 96],
    ]);
    expect(quizBaselineRead(r.coord.db)).toEqual({ ok: true, exists: false, at: null });
    expect(quizPendingRead(r.coord.db)).toMatchObject({ ok: true, runs: [{ id: json(first)['id'], questions: 100, families: 34 }] });
  });

  it('a malformed body answers 400 naming the field, and the decider\'s refusals name theirs', async () => {
    const r = await rig();
    const good = bodyOf(r);
    const cases: [unknown, string][] = [
      [[], '(body)'],
      [{ ...good, report: 3 }, 'report'],
      [{ ...good, recordedBy: '' }, 'recordedBy'],
      [{ ...good, recordedBy: 'a\nb' }, 'recordedBy'],
      [{ ...good, recordedBy: 'x'.repeat(201) }, 'recordedBy'],
      [{ ...good, sha256: 'f'.repeat(64) }, 'sha256'],
      [{ ...good, sha256: good.sha256.toUpperCase() }, 'sha256'],
      [bodyOf(r, {}, 'not json'), 'report'],
      [bodyOf(r, { counts: { questions: 100, answered: 89, correct: 50, run_failed: 10, absent: 1 }, share: { num: 50, den: 89 } }), 'counts'],
      [bodyOf(r, { measured_ms: r.now - 9 * 24 * HOUR }), 'measured_ms'],
      [bodyOf(r, { verdict: 'PASS' }), 'verdict'],
      [bodyOf(r, { arm: 'control' }), 'arm'],
    ];
    for (const [payload, field] of cases) {
      const res = await record(r, payload);
      expect(res.statusCode, `${field}: ${res.body}`).toBe(400);
      expect(json(res), field).toMatchObject({ ok: false, error: 'bad-request', field });
    }
    expect(quizRuns(r.coord.db)).toEqual({ ok: true, rows: [] });
  });

  it('a server with no coordination store answers not-configured', async () => {
    const r = await rig({ coord: false });
    const res = await record(r, bodyOf(r));
    expect(json(res)).toMatchObject({ ok: false, error: 'not-configured' });
  });

  it('armed, the record door still takes the box token alone (an EXEMPT lane), and a cookie without the token is refused', async () => {
    const r = await rig({ armed: true });
    expect(json(await record(r, bodyOf(r)))).toMatchObject({ ok: true, state: 'pending' });
    const noToken = await r.send({ url: '/api/continuity/quiz-runs', payload: bodyOf(r, { n_families: 33 }) });
    expect(noToken.statusCode).toBe(401);
  });
});

describe('POST /api/continuity/quiz-runs/:id/rule (the rule door, session and step-up)', () => {
  const pending = async (r: Rig, over: Record<string, unknown> = {}): Promise<number> => {
    const res = await record(r, bodyOf(r, over));
    return json(res)['id'] as number;
  };

  it('refuses while sign-in is dark', async () => {
    const r = await rig();
    const id = await pending(r);
    const res = await rule(r, id, 'confirm');
    expect(json(res)).toMatchObject({ ok: false, error: 'auth-off' });
    expect(quizPendingRead(r.coord.db)).toMatchObject({ ok: true, runs: [{ id }] });
  });

  it('refuses without a session, with the box token alone, and without a step-up', async () => {
    const r = await rig({ armed: true });
    const id = await pending(r);
    const noSession = await r.send({ url: `/api/continuity/quiz-runs/${id}/rule`, payload: { action: 'confirm' }, cookie: false });
    expect(json(noSession)).toMatchObject({ ok: false, error: 'unauthenticated' });
    const tokenOnly = await r.send({ url: `/api/continuity/quiz-runs/${id}/rule`, payload: { action: 'confirm' }, headers: TOKEN, cookie: false });
    expect(tokenOnly.statusCode).toBeGreaterThanOrEqual(400);
    expect(json(tokenOnly)['ok']).toBe(false);
    const noStepUp = await rule(r, id, 'confirm');
    expect(noStepUp.statusCode).toBeGreaterThanOrEqual(400);
    expect(json(noStepUp)['ok']).toBe(false);
    expect(quizPendingRead(r.coord.db)).toMatchObject({ ok: true, runs: [{ id }] });
    expect(quizBaselineRead(r.coord.db)).toEqual({ ok: true, exists: false, at: null });
  });

  it('with a session and a step-up: confirm and discard answer the new state, and the baseline follows the rule', async () => {
    const r = await rig({ armed: true });
    const a = await pending(r);
    const b = await pending(r, { n_families: 33 });
    const c = await pending(r, { n_families: 32 });
    await r.stepUp();
    expect(json(await rule(r, c, 'discard'))).toEqual({ ok: true, id: c, state: 'discarded', baseline: false });
    expect(json(await rule(r, a, 'confirm'))).toEqual({ ok: true, id: a, state: 'confirmed', baseline: true });
    expect(json(await rule(r, b, 'confirm'))).toEqual({ ok: true, id: b, state: 'confirmed', baseline: false });
    expect(quizBaselineRead(r.coord.db)).toMatchObject({ ok: true, exists: true });
    const runs = quizRuns(r.coord.db);
    expect(runs.ok && runs.rows.map((x) => [x.id, x.state, x.baseline, typeof x.ruledBy])).toEqual([
      [a, 'confirmed', true, 'string'], [b, 'confirmed', false, 'string'], [c, 'discarded', false, 'string'],
    ]);
    const twice = await rule(r, a, 'discard');
    expect(twice.statusCode).toBe(400);
    expect(json(twice)).toEqual({ ok: false, error: 'bad-request', detail: 'already confirmed' });
    expect(json(await rule(r, 999, 'confirm'))).toEqual({ ok: false, error: 'bad-request', detail: 'no quiz run 999' });
    expect(json(await rule(r, 'x1', 'confirm'))).toMatchObject({ ok: false, error: 'bad-request' });
    expect(json(await rule(r, a, 'approve'))).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('a confirmation while a W1a row is live is no baseline', async () => {
    const r = await rig({ armed: true });
    const a = await pending(r);
    r.coord.setLaneArm('continuity', 'live', 5);
    await r.stepUp();
    expect(json(await rule(r, a, 'confirm'))).toEqual({ ok: true, id: a, state: 'confirmed', baseline: false });
  });
});
