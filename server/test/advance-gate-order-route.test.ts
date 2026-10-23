// D-TBD-arch33-advance-gate (audit ticket ARCH-33, GitHub #550): characterization of `POST /api/runs/:id/advance`'s gate ORDER over
// the wire, written green on the inline handler BEFORE its gates moved to `coord/advance.ts`'s `advanceGate`, and
// still green after. Each row sends a body that trips two adjacent gates at once and names the earlier one as the
// answer. The decider's own table (`advance-gate.test.ts`) pins the same order without a server; this file holds
// what the WIRE answered, so the move cannot change a status or a body unseen.
//
// Fixture HOMEs only: `idGateFixture`'s runner records argv and execs nothing.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { appFor, recorder, storedRun, ID_GATE_TOKEN } from './idGateFixture.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = 'a'.repeat(40);
const CLAIM = { branchTip: SHA, prNumber: 7, prPhase: 'open', handoffCommit: SHA };
const COORD = 'demo-coordinator';

describe('POST /api/runs/:id/advance — gate order over the wire (ARCH-33)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const rig = async () => {
    const { run } = recorder();
    const w = await appFor(mkTmp('ccrc-advance-order-'), run);
    app = w.app;
    const post = (id: number | string, payload: unknown) => w.app.inject({
      method: 'POST', url: `/api/runs/${id}/advance`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN }, payload,
    });
    return { ...w, post };
  };

  it('the body shape (400) answers before the target scope (409)', async () => {
    const { post } = await rig();
    const res = await post(1, { to: 'done', fingerprint: null });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
  });

  it('the target scope (bad-transition, detail) answers before the run lookup (404)', async () => {
    const { post } = await rig();
    const res = await post(4242, { to: 'done', fingerprint: CLAIM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, reject: { code: 'bad-transition' } });
    expect(res.json().reject).toHaveProperty('detail');
    expect(res.json().reject).not.toHaveProperty('from');
  });

  it('unknown-run answers 404 with no other field', async () => {
    const { post } = await rig();
    const res = await post(4242, { to: 'working', fingerprint: CLAIM });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'unknown-run' } });
  });

  it('an illegal edge (bad-transition, from/to) answers before not-dispatched', async () => {
    const { post, coord } = await rig();
    const id = storedRun(coord, { state: 'working', sessionId: null, claimedBy: COORD });
    const res = await post(id, { to: 'working', fingerprint: CLAIM });          // working -> working is no edge
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'bad-transition', from: 'working', to: 'working' } });
  });

  it('not-dispatched answers before review-in-flight', async () => {
    const { post, coord } = await rig();
    const id = storedRun(coord, { state: 'awaiting-review', sessionId: null, claimedBy: COORD });
    storedRun(coord, { state: 'dispatched', sessionId: 'demo-rv', claimedBy: COORD, kind: 'review', reviews: id });
    const res = await post(id, { to: 'working', fingerprint: CLAIM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'not-dispatched' } });
  });

  it('review-in-flight answers before cap-concurrency', async () => {
    const { post, coord } = await rig();
    coord.setCaps({ maxConcurrentWorkers: 1, maxSessionsPerDay: 12 });
    const id = storedRun(coord, { state: 'awaiting-review', sessionId: 'demo-w1', claimedBy: COORD });
    const rv = storedRun(coord, { state: 'dispatched', sessionId: 'demo-rv', claimedBy: COORD, kind: 'review', reviews: id });
    const res = await post(id, { to: 'working', fingerprint: CLAIM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'review-in-flight', reviewRunId: rv } });
  });

  it('cap-concurrency answers with limit and running', async () => {
    const { post, coord } = await rig();
    coord.setCaps({ maxConcurrentWorkers: 1, maxSessionsPerDay: 12 });
    const id = storedRun(coord, { state: 'awaiting-review', sessionId: 'demo-w1', claimedBy: COORD });
    storedRun(coord, { state: 'working', sessionId: 'demo-w2', claimedBy: COORD });
    const res = await post(id, { to: 'working', fingerprint: CLAIM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'cap-concurrency', limit: 1, running: 1 } });
  });

  it('bad-session answers before any re-measurement on a forward edge', async () => {
    const { post, coord } = await rig();
    const id = storedRun(coord, { state: 'working', sessionId: '--actor', claimedBy: COORD });
    const res = await post(id, { to: 'awaiting-review', fingerprint: CLAIM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'bad-session' } });
  });

  it('a legal retreat with a bad stored session id is not refused by bad-session', async () => {
    const { post, coord } = await rig();
    const id = storedRun(coord, { state: 'awaiting-review', sessionId: '--actor', claimedBy: COORD });
    const res = await post(id, { to: 'working', fingerprint: CLAIM });
    expect(res.statusCode).toBe(200);
  });
});
