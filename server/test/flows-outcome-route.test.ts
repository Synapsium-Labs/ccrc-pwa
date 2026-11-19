// Flows wave 3b (plan 2026-11-20-flows-w3b): a coordinator reports a flow outcome, recorded in shadow. A real server over a
// fixture HOME and the call record route's harness (neutral names: prog-a, prog-b, lane-a, lane-b, lane-w).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { EXEMPT } from '../src/auth/gate.js';
import { findTemplate } from '../src/flows/templates.js';
import { decideOutcome, wouldSendOf } from '../src/flows/outcome.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who = 'lane-a') => ({ byId: who, byUuid: `u-${who}` });
const URL_A = '/api/coord/programmes/prog-a/flow-outcome';
const ccrc = () => structuredClone(findTemplate('ccrc')!.doc);

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

/** prog-a pins the ccrc template's copy and is claimed by lane-a; prog-b pins nothing, claimed by lane-b. */
async function rig(): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-flow-outcome-');
  for (const id of ['lane-a', 'lane-b', 'lane-w']) seedRow(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord }, new Bus());
  const flowId = coord.createFlow(ccrc(), { template: 'ccrc', version: 1 }, 1);
  coord.publishFlow(flowId, ccrc(), 2);
  coord.setDefaultFlow(flowId);
  coord.openRun({ program: 'prog-a', title: 'A', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'lane-a' });
  coord.setDefaultFlow(null);
  coord.openRun({ program: 'prog-b', title: 'B', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'lane-b' });
  return { app, coord };
}
const post = (a: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = HEADERS) =>
  a.inject({ method: 'POST', url, headers, payload: payload as never });
const count = (c: CoordStore): number => (c.db.prepare('SELECT COUNT(*) AS n FROM flow_outcomes').get() as { n: number }).n;

describe('decideOutcome (L1)', () => {
  const doc = { ok: true as const, doc: ccrc() };
  it('a skill block\'s outcome leads to its edge, and says what entering it would do', () => {
    expect(decideOutcome(doc, true, { block: 'brainstorm', outcome: 'done' }, {})).toMatchObject({ ok: true, next: 'spec-approved', wouldSend: 'measure approval' });
    expect(wouldSendOf(doc.doc, 'verify', {})).toBe('observe verify');
    expect(wouldSendOf(doc.doc, 'build', {})).toMatch(/^send worker build bytes=\d+ missing=plan\.path$/);
  });
  it('refuses a protocol step, a gate, an unknown block or outcome, and a programme with no flow', () => {
    expect(decideOutcome(doc, true, { block: 'verify', outcome: 'verified' }, {})).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(decideOutcome(doc, true, { block: 'spec-approved', outcome: 'approved' }, {})).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(decideOutcome(doc, true, { block: 'nope', outcome: 'done' }, {})).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(decideOutcome(doc, true, { block: 'build', outcome: 'maybe' }, {})).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(decideOutcome(null, false, { block: 'build', outcome: 'done' }, {})).toEqual({ ok: false, refusal: 'conflict', detail: 'the programme follows no flow' });
    expect(decideOutcome(doc, true, { block: 'build' }, {})).toMatchObject({ ok: false, refusal: 'bad-request' });
  });
});

describe('POST /api/coord/programmes/:slug/flow-outcome', () => {
  it('is in the EXEMPT table as a box-token machine lane', () => {
    expect(EXEMPT.get('POST /api/coord/programmes/:slug/flow-outcome')).toMatch(/^box-token machine lane/);
  });

  it('refuses 401 with no token or a wrong one, and writes nothing', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'POST', url: URL_A, payload: { nonsense: true } as never })).statusCode).toBe(401);
    expect((await post(r.app, URL_A, { ...as(), block: 'build', outcome: 'done' }, { 'x-ccrc-mail-token': 'e'.repeat(64) })).statusCode).toBe(401);
    expect(count(r.coord)).toBe(0);
  });

  it('records the holder\'s outcome in shadow and answers where the flow goes next', async () => {
    const r = await rig();
    const res = await post(r.app, URL_A, { ...as(), block: 'build', outcome: 'done' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, next: 'verify', wouldSend: 'observe verify' });
    expect(r.coord.lastFlowOutcome('prog-a')).toMatchObject({ blockId: 'build', outcome: 'done', nextBlock: 'verify', byId: 'lane-a' });
  });

  it('refuses a worker, another programme\'s coordinator, a programme with no flow, and a protocol step', async () => {
    const r = await rig();
    expect((await post(r.app, URL_A, { ...as('lane-w'), block: 'build', outcome: 'done' })).statusCode).toBe(403);
    expect((await post(r.app, URL_A, { ...as('lane-b'), block: 'build', outcome: 'done' })).statusCode).toBe(403);
    expect((await post(r.app, '/api/coord/programmes/prog-b/flow-outcome', { ...as('lane-b'), block: 'build', outcome: 'done' })).statusCode).toBe(409);
    expect((await post(r.app, URL_A, { ...as(), block: 'verify', outcome: 'verified' })).statusCode).toBe(409);
    expect((await post(r.app, URL_A, { block: 'build', outcome: 'done' })).statusCode).toBe(400);
    expect(count(r.coord)).toBe(0);
  });
});
