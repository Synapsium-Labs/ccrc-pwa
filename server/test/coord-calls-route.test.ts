// The coordinator call record's route (D-8126, coordinator-autonomy-default plan Task A3-3, spec §8.2): a real server over
// a fixture HOME, neutral names (prog-a, lane-a). The order the route keeps is part of what is pinned: box token, slug,
// identity, body, attribution, ownership, the run's programme, the write, the notice, the answer.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { blockExpiresAt } from '../src/coord/coordCalls.js';
import type { PushPayload } from '../src/push.js';
import { NotifyLog } from '../src/notifylog.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { EXEMPT } from '../src/auth/gate.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who = 'lane-a'): { byId: string; byUuid: string } => ({ byId: who, byUuid: `u-${who}` });
const URL_A = '/api/coord/programmes/prog-a/calls';

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig { app: FastifyInstance; coord: CoordStore; sent: PushPayload[]; runA: number; runB: number; notifyLog: NotifyLog }

/** prog-a is claimed by lane-a, prog-b by lane-b; lane-w is a worker that claims nothing. All three are in the registry. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-calls-route-');
  for (const id of ['lane-a', 'lane-b', 'lane-w']) seedRow(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  app = await buildServer(
    { ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord, push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
      viewers: { isVisible: () => false } as never, notifyLog },
    new Bus(),
  );
  const open = (program: string, claimedBy: string): number =>
    (coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  return { app, coord, sent, notifyLog, runA: open('prog-a', 'lane-a'), runB: open('prog-b', 'lane-b') };
}

const post = (r: Rig, url: string, payload: unknown, headers: Record<string, string> = HEADERS) =>
  r.app.inject({ method: 'POST', url, headers, payload: payload as never });
const rowCount = (r: Rig): number => r.coord.bigCallsFor(null, 100).length + r.coord.liveBlocksOf('lane-a', Date.now()).length;
const allCalls = (r: Rig, runId: number) => r.coord.callsForRun(runId);

const ROUTINE = { class: 'routine', question: 'Which fixture name?', options: ['demo-w1', 'demo-w2'], chosen: 'demo-w1', why: 'The shorter name reads better.', reversible: true };
const BIG = { ...ROUTINE, class: 'big', reversible: false };

describe('POST /api/coord/programmes/:slug/calls', () => {
  it('refuses 401 with no token, whatever the body says, and with a wrong one', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'POST', url: URL_A, payload: { nonsense: true } as never })).statusCode).toBe(401);
    expect((await post(r, URL_A, { ...as(), ...ROUTINE }, { 'x-ccrc-mail-token': 'e'.repeat(64) })).statusCode).toBe(401);
    expect(rowCount(r)).toBe(0);
  });

  it('refuses 501 when the store is not configured', async () => {
    const home = mkTmp('ccrc-calls-route-nocoord-');
    app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN }, new Bus());
    const res = await app.inject({ method: 'POST', url: URL_A, headers: HEADERS, payload: { ...as(), ...ROUTINE } as never });
    expect(res.statusCode).toBe(501);
  });

  it('refuses a body with no identity, and a slug that is not a slug, with 400', async () => {
    const r = await rig();
    expect((await post(r, URL_A, ROUTINE)).statusCode).toBe(400);
    expect((await post(r, '/api/coord/programmes/Not_A_Slug/calls', { ...as(), ...ROUTINE })).statusCode).toBe(400);
  });

  it('refuses a bad body 400 with the detail, and writes nothing', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as(), ...ROUTINE, options: ['only-one'], chosen: 'only-one' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toMatch(/options/);
    expect(allCalls(r, r.runA)).toEqual([]);
    expect(r.coord.bigCallsFor(null, 100)).toEqual([]);
  });

  it('a worker\'s own pair is refused 403 and nothing is written (F2)', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as('lane-w'), ...BIG });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-your-programme' });
    expect(r.coord.bigCallsFor(null, 100)).toEqual([]);
  });

  it('another programme\'s coordinator is refused 403 and nothing is written (F2)', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as('lane-b'), ...BIG });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not-your-programme' });
    expect(r.coord.bigCallsFor(null, 100)).toEqual([]);
  });

  it('a sender that is not in the registry is refused by attribution before ownership', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { byId: 'lane-a', byUuid: 'someone-else', ...BIG });
    expect(res.statusCode).not.toBe(200);
    expect(r.coord.bigCallsFor(null, 100)).toEqual([]);
  });

  it('a runId of another programme is refused 403, and an unknown run too', async () => {
    const r = await rig();
    const other = await post(r, URL_A, { ...as(), ...ROUTINE, runId: r.runB });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: 'not-your-programme' });
    const unknown = await post(r, URL_A, { ...as(), ...ROUTINE, runId: 99999 });
    expect(unknown.statusCode).toBe(403);
    expect(allCalls(r, r.runB)).toEqual([]);
  });

  it('a routine call is recorded 200 with no notice and no push', async () => {
    const r = await rig();
    const before = r.coord.feedEvents(100).length;
    const res = await post(r, URL_A, { ...as(), ...ROUTINE, runId: r.runA });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: expect.any(Number), class: 'routine', expiresAt: null });
    const rows = allCalls(r, r.runA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ program: 'prog-a', madeBy: 'lane-a', class: 'routine', chosen: 'demo-w1' });
    expect(r.coord.feedEvents(100).length).toBe(before);
    expect(r.sent).toEqual([]);
  });

  it('a big call is recorded 200 with exactly one record-only coord notice and no push', async () => {
    const r = await rig();
    const count = () => r.coord.feedEvents(100).filter((e) => e.kind === 'coord').length;
    const before = count();
    const res = await post(r, URL_A, { ...as(), ...BIG });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, class: 'big', expiresAt: null });
    expect(r.coord.bigCallsFor('prog-a', 10)).toHaveLength(1);
    expect(count() - before).toBe(1);
    expect(r.sent).toEqual([]);
  });

  it('a block call\'s expiresAt is blockExpiresAt of its wake', async () => {
    const r = await rig();
    const t0 = Date.now();
    const res = await post(r, URL_A, { ...as(), class: 'block', chosen: 'the disk to clear', why: 'Nothing else can start until then.', reversible: true, wakeOn: 'disk' });
    expect(res.statusCode, res.body).toBe(200);
    const { id, expiresAt } = res.json() as { id: number; expiresAt: number };
    const row = r.coord.callById(id)!;
    expect(expiresAt).toBe(blockExpiresAt('disk', row.at));
    expect(row.at).toBeGreaterThanOrEqual(t0);
    expect(r.coord.liveBlocksOf('lane-a', row.at)).toHaveLength(1);
  });

  it('a secret in why is stored masked (F3)', async () => {
    const r = await rig();
    const secret = 'sk-' + 'Zq9'.repeat(10);
    const res = await post(r, URL_A, { ...as(), ...BIG, why: `Used the key ${secret} as asked.` });
    expect(res.statusCode, res.body).toBe(200);
    const stored = r.coord.callById((res.json() as { id: number }).id)!;
    for (let i = 0; i + 8 <= secret.length; i++) expect(stored.why.includes(secret.slice(i, i + 8))).toBe(false);
  });
});

describe('the gate\'s EXEMPT entry', () => {
  it('names the box token, attribution and ownership', () => {
    const reason = new Map(EXEMPT).get('POST /api/coord/programmes/:slug/calls');
    expect(reason).toBeDefined();
    expect(reason).toMatch(/box token/);
    expect(reason).toMatch(/attribution/);
    expect(reason).toMatch(/ownership|claimsProgramme/);
  });
});
