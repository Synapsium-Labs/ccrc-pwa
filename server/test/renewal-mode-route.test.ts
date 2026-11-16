// Overlord W1a, the renewal hand-offs, Task 4 (plan `w1a-renewal-handoffs.md`; spec §3.3.11 R19, Table 11.1d): the Setting
// "when soft renewals happen", `GET`/`POST /api/coord/renewal-mode`. The roll-idle door's shape, registered in
// `continuity/routes.ts` (slug renewal-mode-door-in-continuity-routes): session-gated when sign-in is armed, open dark; one
// writer, `CoordStore.setRenewalMode`; the seed is the spec's default, `when-away`; a word this build does not know reads as
// unreadable and the generations lane takes the default. Fixture HOMEs only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildServer } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { renewalModeOf } from '../src/continuity/renewNow.js';
import { generationsPass } from '../src/continuity/generationsLane.js';
import { softRenewalMay, type SoftInputs } from '../src/continuity/softRenewal.js';
import { RENEWAL_MODES, RENEWAL_MODE_DEFAULT } from '../../shared/continuity.js';
import { SWITCHES } from '../../shared/switches.js';
import { testDeps } from './helpers.js';
import { ID_GATE_TOKEN, recorder } from './idGateFixture.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  removeTmpFixtures();
});

async function server(armed: boolean): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-renewal-mode-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (armed) writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
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
const get = (a: FastifyInstance, headers: Record<string, string> = {}) => a.inject({ method: 'GET', url: '/api/coord/renewal-mode', headers });
const post = (a: FastifyInstance, mode: unknown, headers: Record<string, string> = {}) =>
  a.inject({ method: 'POST', url: '/api/coord/renewal-mode', headers, payload: { mode } });

describe('GET/POST /api/coord/renewal-mode', () => {
  it('reads the seeded default, when-away, with the choices', async () => {
    const { app: a } = await server(false);
    const res = await get(a);
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, mode: 'when-away', default: 'when-away', choices: ['when-away', 'on-schedule'] }]);
  });

  it('writes on-schedule and back, one row, and refuses a word it does not know (400) without writing', async () => {
    const { app: a, coord } = await server(false);
    expect((await post(a, 'on-schedule')).json()).toMatchObject({ ok: true, mode: 'on-schedule' });
    expect(coord.db.prepare('SELECT id, mode FROM renewal_mode_settings').all()).toEqual([{ id: 1, mode: 'on-schedule' }]);
    const bad = await post(a, 'sometimes');
    expect([bad.statusCode, (bad.json() as { error: string }).error]).toEqual([400, 'bad-request']);
    expect((await get(a)).json()).toMatchObject({ mode: 'on-schedule' });
    expect((await post(a, 'when-away')).json()).toMatchObject({ mode: 'when-away' });
  });

  it('a lost row reads the default, and the write re-inserts it', async () => {
    const { app: a, coord } = await server(false);
    coord.db.exec('DELETE FROM renewal_mode_settings');
    expect((await get(a)).json()).toMatchObject({ mode: 'when-away' });
    expect((await post(a, 'on-schedule')).json()).toMatchObject({ mode: 'on-schedule' });
  });

  it('with sign-in armed, no cookie is 401 at both and the box token is no key; with a session both answer', async () => {
    const { app: a } = await server(true);
    expect((await get(a)).statusCode).toBe(401);
    expect((await post(a, 'on-schedule')).statusCode).toBe(401);
    expect((await post(a, 'on-schedule', { 'x-ccrc-mail-token': ID_GATE_TOKEN })).statusCode).toBe(401);
    const cookie = await cookieOf(a);
    expect((await post(a, 'on-schedule', { cookie })).json()).toMatchObject({ ok: true, mode: 'on-schedule' });
  });
});

describe('renewalModeOf and the switches row', () => {
  it('a stored word through the one narrowing; a lost row is the default; an unknown word or a failed read is null', () => {
    for (const m of RENEWAL_MODES) expect(renewalModeOf({ kind: 'row', mode: m })).toBe(m);
    expect(renewalModeOf({ kind: 'absent' })).toBe(RENEWAL_MODE_DEFAULT);
    expect(renewalModeOf({ kind: 'row', mode: 'sometimes' })).toBeNull();
    expect(renewalModeOf({ kind: 'unreadable' })).toBeNull();
  });

  it('the switches row names its storage, default and writer', () => {
    expect(SWITCHES['renewal-mode']).toMatchObject({
      storage: { setting: 'renewal_mode_settings.mode' }, default: RENEWAL_MODE_DEFAULT, owner: 'C3', writer: 'POST /api/coord/renewal-mode',
    });
  });
});

describe('the generations lane passes the stored mode to softRenewalMay', () => {
  it('on-schedule stored reaches the decider; an unknown word falls back to when-away', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-renewal-mode-lane-'), '.ccrc', 'coord.db')));
    s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
    s.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-a', 'working', 'lane-a-project-a', 1)").run();
    const t = fakeTime({ wallMs: FAKE_T0, monoMs: 1_000 });
    const st = s.insertStart({ sessionId: 'lane-a-project-a', reportId: 'r-1', uuid: 'u', source: 'startup', model: null, rowIncarnation: 'inc',
      reportedAt: FAKE_T0, receivedAt: FAKE_T0 });
    if (!st.ok) throw new Error('start');
    const w = s.mintGeneration({ identity: 'lane-a-project-a', sessionId: 'lane-a-project-a', role: 'coordinator', term: 1, rowIncarnation: 'inc',
      startId: st.id, startReportedAt: FAKE_T0, resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'woken', mono: 1_000,
      proc: 'p1', now: FAKE_T0 }, null, false);
    if (!w.ok) throw new Error('mint');
    s.db.prepare('UPDATE continuity_generations SET shadowState = NULL, walk = NULL, shadowDeadlineAt = NULL WHERE id = ?').run(w.id);
    s.advanceCursor({ lane: 'generations', from: 0, to: st.id });
    const seen: SoftInputs['mode'][] = [];
    const pass = () => generationsPass({ coord: s, clock: t.ports.clock, entropy: t.ports.entropy, proc: 'p1', log: () => {}, retried: new Set(),
      emptyTries: new Map(), gate: () => null, decide: {
        renewalDue: () => ({ due: true, cls: 'soft', why: 'two-compactions', blind: [] }),
        softRenewalMay: (i) => { seen.push(i.mode); return { ...softRenewalMay(i), start: false, waitFor: 'least-age' } as ReturnType<typeof softRenewalMay>; },
      } }, { registry: [{ id: 'lane-a-project-a', uuid: 'u', lane: 'lane-a', child: { kind: 'none' } }], readings: new Map(),
      listedAt: t.ports.clock.wall() + 1, canRenew: true });
    s.setRenewalMode('on-schedule', 1);
    pass();
    s.db.prepare("UPDATE renewal_mode_settings SET mode = 'sometimes'").run();
    pass();
    expect(seen).toEqual(['on-schedule', 'when-away']);
  });
});
