// Programme lifecycle W2 review (spec 2026-11-24 §5, §8, §11, §14): the lifecycle's doors AS REGISTERED, on a real server
// (`buildServer`) with sign-in ARMED (a passphrase, a real session cookie, the real step-up), a real `CoordStore` and the real
// coordination hold. `programme-lifecycle-doors.test.ts` drives the handlers directly; this file checks what the registration
// adds: the item doors' branches for an end proposal (the held-item check, their order before the end-request checks, the
// generic dismiss refused), the reads' box-token arm, and the end over open runs through the real abandon hold. Fixture HOME,
// neutral names (prog-a, lane-a).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { raiseEndProposal } from '../src/coord/programmeLifecycleRoutes.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'a test passphrase for the lifecycle suite';
const ORIGIN = 'http://localhost:7788';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

interface Rig {
  coord: CoordStore; runA: number;
  send: (method: 'GET' | 'POST', url: string, payload?: unknown, o?: { cookie?: boolean; headers?: Record<string, string> }) => Promise<LightMyRequestResponse>;
  stepUp: () => Promise<void>;
}

/** prog-a: lane-a's, one planned run (open, never dispatched). lane-b is a registry row that owns nothing. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-lifecycle-wired-');
  for (const id of ['lane-a', 'lane-b']) seedRow(home, id, { project: 'project-a' });
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const base = testDeps(home, recorder().run);
  app = await buildServer({ ...base, coord, mailToken: ID_GATE_TOKEN,
    cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: ORIGIN } }, new Bus());
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE }, headers: { 'user-agent': 'a test phone', origin: ORIGIN } });
  expect(login.statusCode, login.body).toBe(204);
  const set = login.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  const cookie = line.slice(0, line.indexOf(';'));
  const self = app;
  const send: Rig['send'] = (method, url, payload, o = {}) => self.inject({
    method, url,
    headers: { origin: ORIGIN, ...(o.cookie === false ? {} : { cookie }), ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...o.headers },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  const runA = (coord.openRun({ program: 'prog-a', title: 'Programme A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a', claimedByUuid: 'u-lane-a' }) as { id: number }).id;
  return {
    coord, runA, send,
    stepUp: async () => {
      const r = await send('POST', '/api/auth/step-up/passphrase', { passphrase: PASSPHRASE });
      expect(r.statusCode, r.body).toBeLessThan(300);
    },
  };
}

const closeRuns = (r: Rig) => r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE program = 'prog-a'").run(Date.now());
const propose = (r: Rig): number => {
  const p = raiseEndProposal(r.coord, { slug: 'prog-a', by: 'lane-a', outcome: 'done', why: 'met', evidence: ['it shipped'], via: 'door' }, Date.now());
  if (!p.ok) throw new Error(`fixture proposal refused: ${p.why}`);
  return p.id;
};
const edges = (r: Rig) => (r.coord.db.prepare("SELECT edge FROM programme_events WHERE program = 'prog-a' ORDER BY id").all() as { edge: string }[]).map((e) => e.edge);

describe('the item doors on an end proposal, as registered', () => {
  it('confirm on /act: held is not-open, no step-up is step-up-required, stepped up it ends the programme', async () => {
    const r = await rig();
    closeRuns(r);
    const id = propose(r);
    r.coord.db.prepare('UPDATE operator_items SET heldUntil = ? WHERE id = ?').run(Date.now() + 3_600_000, id);
    expect((await r.send('POST', `/api/items/${id}/act`, {})).json()).toMatchObject({ error: 'not-open' });
    r.coord.db.prepare('UPDATE operator_items SET heldUntil = NULL WHERE id = ?').run(id);
    expect((await r.send('POST', `/api/items/${id}/act`, {})).json()).toMatchObject({ error: 'step-up-required' });
    expect(r.coord.programmeLifecycleRow('prog-a')!.state).toBe('active');
    await r.stepUp();
    const res = await r.send('POST', `/api/items/${id}/act`, { programme: 'done' });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.coord.programmeLifecycleRow('prog-a')).toMatchObject({ state: 'done', coordinator: null });
    expect(edges(r).at(-1)).toBe('ended');
  });

  it('decline on /decline closes it with end-declined, signed in, without a step-up', async () => {
    const r = await rig();
    closeRuns(r);
    const id = propose(r);
    const res = await r.send('POST', `/api/items/${id}/decline`, { why: 'one more wave' });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.coord.itemById(id)!.state).toBe('dismissed');
    expect(edges(r).at(-1)).toBe('end-declined');
  });

  it('the generic dismiss is refused: no close goes unrecorded or untold', async () => {
    const r = await rig();
    closeRuns(r);
    const id = propose(r);
    const res = await r.send('POST', `/api/items/${id}/dismiss`);
    expect(res.json()).toMatchObject({ error: 'not-open', detail: expect.stringContaining('confirm it (act) or keep the programme open (decline)') });
    expect(r.coord.itemById(id)!.state).toBe('open');
    expect(r.coord.openEndProposalOf('prog-a')!.id).toBe(id);
    expect(edges(r)).not.toContain('end-declined');
  });
});

describe('the reads\' box-token arm, as registered', () => {
  const token = { 'x-ccrc-mail-token': ID_GATE_TOKEN };

  it('the history takes the bound coordinator\'s attribution; another session is not-your-programme; no credential is 401', async () => {
    const r = await rig();
    const as = (q: string) => r.send('GET', `/api/programmes/prog-a/history${q}`, undefined, { cookie: false, headers: token });
    expect((await as('?byId=lane-a&byUuid=u-lane-a')).statusCode).toBe(200);
    expect((await as('?byId=lane-b&byUuid=u-lane-b')).json()).toMatchObject({ error: 'not-your-programme' });
    expect((await as('')).statusCode).toBe(400);
    expect((await r.send('GET', '/api/programmes/prog-a/history', undefined, { cookie: false })).statusCode).toBe(401);
    // The console's session reads it with no attribution.
    expect((await r.send('GET', '/api/programmes/prog-a/history')).statusCode).toBe(200);
  });

  it('a session\'s programme takes that session\'s own attribution', async () => {
    const r = await rig();
    const as = (q: string) => r.send('GET', `/api/sessions/lane-a/programme${q}`, undefined, { cookie: false, headers: token });
    expect((await as('?byId=lane-a&byUuid=u-lane-a')).json()).toMatchObject({ ok: true, programme: { slug: 'prog-a' } });
    expect((await as('?byId=lane-b&byUuid=u-lane-b')).json()).toMatchObject({ error: 'not-owner' });
    expect((await r.send('GET', '/api/sessions/lane-a/programme')).json()).toMatchObject({ ok: true, programme: { slug: 'prog-a' } });
  });
});

describe('the end over open runs through the real abandon hold', () => {
  it('abandons the open run as the operator, then ends Abandoned, releasing the binding', async () => {
    const r = await rig();
    await r.stepUp();
    const res = await r.send('POST', '/api/programmes/prog-a/state', { edge: 'end', outcome: 'abandoned', why: 'objective dropped', abandonRuns: true });
    expect(res.statusCode, res.body).toBe(200);
    const run = r.coord.run(r.runA) as { ok: true; run: { state: string; closeDetail: string | null } };
    expect(run.run.state).toBe('failed');
    expect(run.run.closeDetail).toMatch(/abandoned with the end of programme prog-a: objective dropped/);
    expect(r.coord.programmeLifecycleRow('prog-a')).toMatchObject({ state: 'abandoned', planEnd: 'abandoned', coordinator: null });
    expect(r.coord.programOpenRunCount('prog-a')).toBe(0);
  });
});
