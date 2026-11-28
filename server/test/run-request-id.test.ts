// Overlord W2, request ids A: the run door's `request` gate over the real `POST /api/runs`: a run names the request it is made
// for, and only the programme that owns that request may.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import type { CoordStore } from '../src/coord/store.js';
import { requestNotYoursDetail } from '../src/coord/requestMail.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { legacyOpens } from './helpers/plan.js';
import { landingStoreOver } from './landingFixture.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';
const C1 = 'demo-coord-one';
const C2 = 'demo-coord-two';
const UUIDS: Record<string, string> = { [C1]: 'a'.repeat(36), [C2]: 'b'.repeat(36) };
const P1 = 'build4';
const P2 = 'build5';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: UUIDS[id]!, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const quietRunner: Runner = async () => ({ ran: true as const, code: 0, stdout: '', stderr: '' });

const open = async () => {
  const home = mkTmp('ccrc-run-request-');
  seed(home, C1); seed(home, C2);
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  const app = legacyOpens(await buildServer({ ...testDeps(home, quietRunner), mailToken: TOKEN, coord }), coord.db);
  return { app, coord };
};

const postOpen = (app: FastifyInstance, program: string, claimedBy: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/runs', headers: { 'x-ccrc-mail-token': TOKEN },
    payload: { program, title: 'T', project: PROJECT, wave: 1, waveOf: 3, claimedBy, claimedByUuid: UUIDS[claimedBy],
      homeProject: PROJECT, ...extra } });

const insertRequest = (coord: CoordStore, id: number, owner: string | null): void => {
  coord.db.prepare('INSERT INTO overlord_requests (id, origin, summary, owner, state, openedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'operator', `request ${id}`, owner, 'routed', Date.now());
};
const runCount = (coord: CoordStore): number => (coord.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n;
const storedRequest = (coord: CoordStore, id: number): number | null =>
  (coord.db.prepare('SELECT requestId FROM runs WHERE id = ?').get(id) as { requestId: number | null }).requestId;

describe('POST /api/runs — the request gate (request ids A)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('1. a run with no requestId opens as today and stores no request', async () => {
    const w = await open(); app = w.app;
    const res = await postOpen(app, P1, C1);
    expect(res.statusCode, res.body).toBe(200);
    expect(storedRequest(w.coord, (res.json() as { id: number }).id)).toBeNull();
    const withNull = await postOpen(app, P1, C1, { wave: 2, requestId: null });
    expect(withNull.statusCode, withNull.body).toBe(200);
    expect(storedRequest(w.coord, (withNull.json() as { id: number }).id)).toBeNull();
  });

  it('2. a run naming a request its programme owns opens and stores it', async () => {
    const w = await open(); app = w.app;
    insertRequest(w.coord, 7, P1);
    const res = await postOpen(app, P1, C1, { requestId: 7 });
    expect(res.statusCode, res.body).toBe(200);
    expect(storedRequest(w.coord, (res.json() as { id: number }).id)).toBe(7);
  });

  it('3. another programme\'s request, an unowned one and an unknown id answer alike and open no run', async () => {
    const w = await open(); app = w.app;
    insertRequest(w.coord, 8, P2); insertRequest(w.coord, 9, null);
    const answers: { status: number; body: string }[] = [];
    for (const requestId of [8, 9, 999]) {
      const res = await postOpen(app, P1, C1, { requestId });
      expect(res.statusCode, res.body).toBe(REFUSAL_STATUS['request-not-yours']);
      expect(res.json()).toMatchObject({ ok: false, error: 'request-not-yours', detail: requestNotYoursDetail(requestId) });
      answers.push({ status: res.statusCode, body: JSON.stringify(res.json()).replace(String(requestId), 'N') });
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(runCount(w.coord)).toBe(0);
  });

  it('4. a malformed requestId is bad-request', async () => {
    const w = await open(); app = w.app;
    for (const requestId of [0, -1, 1.5, '7', true]) {
      const res = await postOpen(app, P1, C1, { requestId });
      expect(res.statusCode, String(requestId)).toBe(REFUSAL_STATUS['bad-request']);
      expect(res.json(), String(requestId)).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(runCount(w.coord)).toBe(0);
  });

  it('5. an unreadable request table is run-unreadable and opens no run', async () => {
    const w = await open(); app = w.app;
    insertRequest(w.coord, 7, P1);
    w.coord.db.exec('DROP TABLE overlord_requests');
    const res = await postOpen(app, P1, C1, { requestId: 7 });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'run-unreadable' });
    expect(runCount(w.coord)).toBe(0);
  });
});
