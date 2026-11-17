// The coordinator's remaining-work door (Overlord W2 remaining work A, plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md Task 3): a real server over a fixture HOME, neutral names
// (prog-a, prog-b, lane-a, lane-b, lane-w), the call record route test's harness. The order the door keeps is part of what is
// pinned: box token, configured, slug, identity, body, attribution, ownership, the run's programme, the targets, the write.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { EXEMPT } from '../src/auth/gate.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who = 'lane-a'): { byId: string; byUuid: string } => ({ byId: who, byUuid: `u-${who}` });
const URL_A = '/api/coord/programmes/prog-a/remaining';
const NOW = Date.now();

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig { app: FastifyInstance; coord: CoordStore; runA: number; runB: number }

/** prog-a is claimed by lane-a, prog-b by lane-b; lane-w is a worker that claims nothing. All three are in the registry. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-remaining-route-');
  for (const id of ['lane-a', 'lane-b', 'lane-w']) seedRow(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord }, new Bus());
  const open = (program: string, claimedBy: string): number =>
    (coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  return { app, coord, runA: open('prog-a', 'lane-a'), runB: open('prog-b', 'lane-b') };
}

const post = (r: Rig, url: string, payload: unknown, headers: Record<string, string> = HEADERS) =>
  r.app.inject({ method: 'POST', url, headers, payload: payload as never });
const rows = (r: Rig): [number, number] => [
  (r.coord.db.prepare('SELECT COUNT(*) AS n FROM programme_remaining').get() as { n: number }).n,
  (r.coord.db.prepare('SELECT COUNT(*) AS n FROM programme_edges').get() as { n: number }).n,
];
const raise = (r: Rig, program: string): number => r.coord.raiseItem({
  program, runId: null, raisedBy: 'lane-a', kind: 'do', title: 't', why: 'w', how: [], options: null,
  neededBy: 'soon', soonLabel: null, secretSlot: null,
}, NOW - 60_000);

const STATEMENT = { lo: 2, hi: 3, reason: 'wave 4 of the plan, and its review' };
const landedOn = (runId: number) => ({ kind: 'needs-landed', target: { predicate: 'run-closed', runId }, why: 'prog-b lands first' });

describe('POST /api/coord/programmes/:slug/remaining', () => {
  it('is in the EXEMPT table as a box-token machine lane', () => {
    expect(EXEMPT.get('POST /api/coord/programmes/:slug/remaining')).toMatch(/^box-token machine lane/);
  });

  it('refuses 401 with no token, whatever the body says, and with a wrong one', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'POST', url: URL_A, payload: { nonsense: true } as never })).statusCode).toBe(401);
    expect((await post(r, URL_A, { ...as(), ...STATEMENT }, { 'x-ccrc-mail-token': 'e'.repeat(64) })).statusCode).toBe(401);
    expect(rows(r)).toEqual([0, 0]);
  });

  it('refuses 501 when the store is not configured', async () => {
    const home = mkTmp('ccrc-remaining-route-nocoord-');
    app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN }, new Bus());
    const res = await app.inject({ method: 'POST', url: URL_A, headers: HEADERS, payload: { ...as(), ...STATEMENT } as never });
    expect(res.statusCode).toBe(501);
  });

  it('refuses a slug that is not a slug, and a body with no identity, 400, writing nothing', async () => {
    const r = await rig();
    expect((await post(r, '/api/coord/programmes/Not_A_Slug/remaining', { ...as(), ...STATEMENT })).statusCode).toBe(400);
    const none = await post(r, URL_A, STATEMENT);
    expect(none.statusCode).toBe(400);
    expect((none.json() as { detail: string }).detail).toMatch(/byId and byUuid/);
    expect(rows(r)).toEqual([0, 0]);
  });

  it('refuses a bad body 400 with the decider\'s detail, writing nothing', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as(), ...STATEMENT, lo: 4, hi: 3 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request', detail: 'lo must not exceed hi' });
    expect(rows(r)).toEqual([0, 0]);
  });

  it('a sender that is not in the registry is refused by attribution before ownership, writing nothing', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { byId: 'lane-a', byUuid: 'someone-else', ...STATEMENT });
    expect(res.statusCode).not.toBe(200);
    expect(res.json()).not.toMatchObject({ error: 'not-your-programme' });
    expect(rows(r)).toEqual([0, 0]);
  });

  it('a worker\'s own pair of the programme is refused 403, writing nothing', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as('lane-w'), ...STATEMENT });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-your-programme' });
    expect(rows(r)).toEqual([0, 0]);
  });

  it('another programme\'s coordinator is refused 403, writing nothing', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as('lane-b'), ...STATEMENT });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not-your-programme' });
    expect(rows(r)).toEqual([0, 0]);
  });

  it('a runId of another programme, or of no run, is refused 403, writing nothing', async () => {
    const r = await rig();
    for (const runId of [r.runB, 99999]) {
      const res = await post(r, URL_A, { ...as(), ...STATEMENT, runId });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'not-your-programme' });
    }
    expect(rows(r)).toEqual([0, 0]);
  });

  it('the coordinator holding an open run writes one statement and its edges, 200', async () => {
    const r = await rig();
    const item = raise(r, 'prog-a');
    const res = await post(r, URL_A, { ...as(), ...STATEMENT, runId: r.runA, edges: [landedOn(r.runB),
      { kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId: item }, why: 'the operator picks the name' }] });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: true; id: number; added: number[]; kept: number[] };
    expect(body).toEqual({ ok: true, id: expect.any(Number), added: [expect.any(Number), expect.any(Number)], kept: [] });
    expect(rows(r)).toEqual([1, 2]);
    expect(r.coord.remainingOf('prog-a', 5)[0]).toMatchObject({ id: body.id, byId: 'lane-a', runId: r.runA, lo: 2, hi: 3 });
  });

  it('a second statement keeps an equal edge and adds none', async () => {
    const r = await rig();
    const first = (await post(r, URL_A, { ...as(), ...STATEMENT, edges: [landedOn(r.runB)] })).json() as { added: number[] };
    const second = await post(r, URL_A, { ...as(), ...STATEMENT, lo: 1, hi: 2, edges: [{ ...landedOn(r.runB), why: 'still' }] });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ added: [], kept: first.added });
    expect(rows(r)).toEqual([2, 1]);
  });

  it('a run-closed target naming one of the programme\'s own runs is refused 400, naming the edge', async () => {
    const r = await rig();
    const res = await post(r, URL_A, { ...as(), ...STATEMENT, edges: [landedOn(r.runA)] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toMatch(/^edge 0: run \d+ is a run of programme prog-a/);
    expect(rows(r)).toEqual([0, 0]);
  });

  it('a pr-merged target whose run\'s lineage does not list the pull request is refused 400', async () => {
    const r = await rig();
    r.coord.foldPrLineage(r.runB, [{ pr: 6, branch: 'ws/b', phase: 'open', recordedAt: NOW }]);
    const edge = { kind: 'needs-landed', target: { predicate: 'pr-merged', runId: r.runB, pr: 7 }, why: 'the store PR' };
    const res = await post(r, URL_A, { ...as(), ...STATEMENT, edges: [edge] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toMatch(/does not list pull request 7/);
    const ok = await post(r, URL_A, { ...as(), ...STATEMENT, edges: [{ ...edge, target: { ...edge.target, pr: 6 } }] });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('an operator-confirms target naming another programme\'s open item is refused 400 (F6)', async () => {
    const r = await rig();
    const theirs = raise(r, 'prog-b');
    const res = await post(r, URL_A, { ...as(), ...STATEMENT,
      edges: [{ kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId: theirs }, why: 'w' }] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toMatch(/not an item of programme prog-a/);
    expect(rows(r)).toEqual([0, 0]);
  });

  it('a statement past the open-edge cap is refused 400 too-many-open-edges, writing nothing', async () => {
    const r = await rig();
    const extra = Array.from({ length: 10 }, (_, i) => ({ kind: 'needs-landed', target: { predicate: 'pr-merged', runId: r.runB, pr: i + 1 }, why: 'w' }));
    r.coord.foldPrLineage(r.runB, Array.from({ length: 21 }, (_, i) => ({ pr: i + 1, branch: 'ws/b', phase: 'open', recordedAt: NOW })));
    expect((await post(r, URL_A, { ...as(), ...STATEMENT, edges: extra })).statusCode).toBe(200);
    const more = extra.map((e) => ({ ...e, target: { ...e.target, pr: e.target.pr + 10 } }));
    expect((await post(r, URL_A, { ...as(), ...STATEMENT, edges: more })).statusCode).toBe(200);
    const over = await post(r, URL_A, { ...as(), ...STATEMENT, edges: [{ ...extra[0]!, target: { ...extra[0]!.target, pr: 21 } }] });
    expect(over.statusCode).toBe(400);
    expect((over.json() as { detail: string }).detail).toMatch(/^too-many-open-edges/);
    expect(rows(r)).toEqual([2, 20]);
  });

  it('a store throw at the insert answers 503 run-unreadable and leaves no row', async () => {
    const r = await rig();
    const real = r.coord.insertRemaining.bind(r.coord);
    r.coord.insertRemaining = (...a: Parameters<typeof real>) => {
      void real;
      void a;
      throw new Error('database is locked');
    };
    const res = await post(r, URL_A, { ...as(), ...STATEMENT, edges: [landedOn(r.runB)] });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'run-unreadable' });
    expect(rows(r)).toEqual([0, 0]);
  });

  it('an unreadable lineage at the target check answers 503 run-unreadable and writes nothing', async () => {
    const r = await rig();
    r.coord.db.prepare('UPDATE runs SET prLineage = ? WHERE id = ?').run('{"not":"a list"}', r.runB);
    const res = await post(r, URL_A, { ...as(), ...STATEMENT,
      edges: [{ kind: 'needs-landed', target: { predicate: 'pr-merged', runId: r.runB, pr: 7 }, why: 'w' }] });
    expect(res.statusCode).toBe(503);
    expect(rows(r)).toEqual([0, 0]);
  });
});
