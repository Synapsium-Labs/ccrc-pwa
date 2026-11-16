// Overlord W1 sandbox, Task 5 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`; spec §3.6 H4, Table 11.1e):
// `POST /api/sessions/:id/start/loads`, the hook's loads report. The box token first, then the path's session is the sender,
// then `startLoadsOf` (the body's one narrowing, `bad-request` naming the field), then the registry's attribution of the
// sender, then `insertStartLoads`, which finds the start the `reportId` names (`unknown-start`, 404) and keeps the first body.
// The read side (`startLoadsOfNewestStart`, `startLoadsRowOf`) is pinned here too. Fixture HOMEs only.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import * as startLoadsModule from '../src/continuity/startLoads.js';
import { startLoadsRowOf } from '../src/continuity/startLoads.js';
import { UNMEASURED as SERVER_UNMEASURED } from '../src/unmeasured.js';
import { UNMEASURED as L0_UNMEASURED } from '../../shared/overlord-sandbox.js';
import { FAKE_T0 } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { goodLoads, startLoadsCases } from './sim/startLoadsSets.js';

const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
beforeEach(() => { home = mkTmp('ccrc-loads-route-'); seedRow(home, ID, { uuid: UUID, project: 'project-a' }); });
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});
const open = async (): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run, {});
  coord = r.coord;
  await r.app.ready();
  return r.app;
};
const start = (a: FastifyInstance, reportId = 'r-0001-abcd', source = 'startup', reportedAt = FAKE_T0 - 50) => a.inject({
  method: 'POST', url: `/api/sessions/${ID}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
  payload: { fromId: ID, fromUuid: UUID, reportId, source, reportedAt },
});
const post = (a: FastifyInstance, b: unknown, id = ID, token: string | null = ID_GATE_TOKEN) => a.inject({
  method: 'POST', url: `/api/sessions/${id}/start/loads`, payload: b as never,
  headers: token === null ? {} : { 'x-ccrc-mail-token': token },
});
const rows = (): Record<string, unknown>[] => coord!.db.prepare('SELECT * FROM continuity_start_loads ORDER BY startId').all() as Record<string, unknown>[];

describe('startLoadsOf: the body\'s one narrowing (Task 5)', () => {
  for (const [name, run] of Object.entries(startLoadsCases(startLoadsModule))) it(name, run);
});

describe('POST /api/sessions/:id/start/loads', () => {
  it('records the first body as sent (202, fresh), joined to its start, unmeasured kept as a word', async () => {
    app = await open();
    expect((await start(app)).statusCode).toBe(202);
    const res = await post(app, goodLoads({}, { agents: 'unmeasured' }));
    expect([res.statusCode, res.json()]).toEqual([202, { ok: true, startId: 1, fresh: true }]);
    const [r] = rows();
    expect(r).toMatchObject({ startId: 1, profileRole: 'overlord', profileDigest: 'a'.repeat(64), launchRc: 'off', claudeVersion: '2.1.325',
      permissionMode: 'bypassPermissions', cwdInWorkspace: 1, carriedFrom: null, conflicted: 0, reportedAt: 1000, receivedAt: FAKE_T0 });
    expect(JSON.parse(r!['loaded'] as string).agents).toBe('unmeasured');
  });
  it('a resend of the same bytes, or the same body at another reportedAt, answers fresh: false and is no conflict', async () => {
    app = await open();
    await start(app);
    await post(app, goodLoads());
    for (const b of [goodLoads(), goodLoads({ reportedAt: 5000 })]) {
      const res = await post(app, b);
      expect([res.statusCode, res.json()]).toEqual([202, { ok: true, startId: 1, fresh: false }]);
    }
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!['conflicted']).toBe(0);
  });
  it('a second body that differs sets conflicted and keeps the first', async () => {
    app = await open();
    await start(app);
    await post(app, goodLoads());
    const res = await post(app, goodLoads({}, { skills: ['ccrc-overlord', 'other'] }));
    expect([res.statusCode, res.json()]).toEqual([202, { ok: true, startId: 1, fresh: false }]);
    expect(rows()[0]).toMatchObject({ conflicted: 1 });
    expect(JSON.parse(rows()[0]!['loaded'] as string).skills).toStrictEqual(['ccrc-overlord']);
  });
  it('refuses in order: the token, the sender, the body, the attribution, then a start nobody recorded', async () => {
    app = await open();
    await start(app);
    expect((await post(app, goodLoads(), ID, null)).statusCode).toBe(401);
    const notOwner = await post(app, goodLoads({ fromId: 'lane-b-project-a' }));
    expect([notOwner.statusCode, notOwner.json().error]).toEqual([403, 'not-owner']);
    const bad = await post(app, goodLoads({ profileDigest: 'x' }));
    expect([bad.statusCode, bad.json().error, bad.json().detail]).toEqual([400, 'bad-request', 'profileDigest']);
    const stale = await post(app, goodLoads({ fromUuid: '99999999-2222-3333-4444-555555555555' }));
    expect(stale.json().error).toBe('stale-uuid');
    const unknown = await post(app, goodLoads({ reportId: 'r-9999-zzzz' }));
    expect([unknown.statusCode, unknown.json().error]).toEqual([404, 'unknown-start']);
    expect(rows()).toStrictEqual([]);
  });
  it('a report naming a clear or compact start is unknown-start: only a startup or resume start takes one (review 2135 nit)', async () => {
    app = await open();
    for (const [rid, source] of [['r-0005-abcd', 'clear'], ['r-0006-abcd', 'compact']] as const) {
      await start(app, rid, source, FAKE_T0 - 5);
      const res = await post(app, goodLoads({ reportId: rid }));
      expect([res.statusCode, res.json().error], source).toEqual([404, 'unknown-start']);
    }
    expect(rows()).toStrictEqual([]);
  });
  it('the L0 word and the server\'s are one word (the second spelling\'s reason, review 2135 nit)', () => {
    expect(L0_UNMEASURED).toBe(SERVER_UNMEASURED);
  });
  it('a report for another session\'s start is unknown-start: the join is by this session\'s own start', async () => {
    app = await open();
    await start(app);
    seedRow(home, 'lane-b-project-a', { uuid: '22222222-2222-3333-4444-555555555555', project: 'project-a' });
    const res = await post(app, goodLoads({ fromId: 'lane-b-project-a', fromUuid: '22222222-2222-3333-4444-555555555555' }), 'lane-b-project-a');
    expect([res.statusCode, res.json().error]).toEqual([404, 'unknown-start']);
  });
});

describe('the read side (Task 5)', () => {
  it('startLoadsOfNewestStart answers a newer start with a null report over an older start\'s held report', async () => {
    app = await open();
    await start(app, 'r-0001-abcd', 'startup', FAKE_T0 - 100);
    await post(app, goodLoads());
    expect(coord!.startLoadsOfNewestStart(ID)).toMatchObject({ ok: true, newest: { start: { reportId: 'r-0001-abcd' }, report: { startId: 1 } } });
    await start(app, 'r-0002-abcd', 'resume', FAKE_T0 - 10);
    const r = coord!.startLoadsOfNewestStart(ID);
    expect(r).toMatchObject({ ok: true, newest: { start: { reportId: 'r-0002-abcd', source: 'resume' }, report: null } });
  });
  it('a clear or compact start is never the newest: only startup and resume are read; no start reads null', async () => {
    app = await open();
    expect(coord!.startLoadsOfNewestStart(ID)).toStrictEqual({ ok: true, newest: null });
    await start(app, 'r-0001-abcd', 'startup', FAKE_T0 - 100);
    await start(app, 'r-0003-abcd', 'clear', FAKE_T0 - 5);
    expect(coord!.startLoadsOfNewestStart(ID)).toMatchObject({ ok: true, newest: { start: { reportId: 'r-0001-abcd' } } });
  });
  it('startLoadsRowOf reads an unknown stored kind, a malformed value or an unparsable column as unmeasured', () => {
    const base = { startId: 1, profileRole: 'overlord', profileDigest: 'a'.repeat(64), launchRc: 'off', claudeVersion: '2.1.325',
      permissionMode: 'bypassPermissions', cwdInWorkspace: 1, carriedFrom: null, conflicted: 0 };
    const r = startLoadsRowOf({ ...base, loaded: JSON.stringify({ skills: ['a'], agents: 'nonsense', futureKind: ['x'] }) });
    expect(r.loaded).toStrictEqual({ instructions: 'unmeasured', hooks: 'unmeasured', skills: ['a'], agents: 'unmeasured',
      tools: 'unmeasured', toolServers: 'unmeasured' });
    expect(startLoadsRowOf({ ...base, loaded: '{not json', launchRc: 'sideways', conflicted: 1 })).toMatchObject({
      launchRc: null, conflicted: true, loaded: { skills: 'unmeasured' } });
  });
});
