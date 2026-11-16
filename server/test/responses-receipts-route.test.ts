// Overlord W1, the response record (Task 4: plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md): the
// receipts door, `POST /api/responses/receipts`. It reads the row a receipt names, asks `receiptVerdict`, and writes the
// kept ones with the server's clock; its answer is counts only. Session-gated when armed, no box token. Fixture homes only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { UNAVAILABLE_DETAIL } from '../src/responses/routes.js';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { insertPushResponseInTx, landPushVerdictInTx } from '../src/coord/responsesStore.js';
import { RECEIPTS_MAX_PER_BODY, type ReceiptIn } from '../../shared/responses.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const PID = 'a'.repeat(32);
const PENDING = 'b'.repeat(32);
const HASH = (c: string): string => c.repeat(64);
const STAMP = { boot: { kind: 'measured', epoch: 1 }, restore: { kind: 'unmeasured' } } as const;

const open = async (authEnabled = false): Promise<{ app: FastifyInstance; coord: CoordStore; now: () => number }> => {
  const home = mkTmp('ccrc-receipts-');
  const base = testDeps(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled }, coord };
  const app = await buildServer(deps);
  await app.ready();
  for (const pushId of [PID, PENDING]) {
    tx(coord.db, () => insertPushResponseInTx(coord.db, { pushId, label: 'coord', carries: null, hasActions: false, tag: 'x', stamp: STAMP, at: 1 }));
  }
  tx(coord.db, () => landPushVerdictInTx(coord.db, PID, { accepted: [HASH('a')], terminal: true, answered: true }, 2));
  return { app, coord, now: () => deps.time.clock.wall() };
};
const worker = (pushId: string, hash: string, receipt: 'shown' | 'opened' = 'shown'): ReceiptIn =>
  ({ ref: { kind: 'push', pushId }, receipt, from: { source: 'worker', version: 1, endpointHash: hash } });
const post = (app: FastifyInstance, receipts: unknown[]) =>
  app.inject({ method: 'POST', url: '/api/responses/receipts', payload: { v: 1, receipts } });
const stored = (c: CoordStore): Record<string, unknown>[] =>
  c.db.prepare('SELECT responseId, receipt, source, endpointHash, at FROM response_receipts ORDER BY id').all() as Record<string, unknown>[];

describe('POST /api/responses/receipts', () => {
  it('a worker shown for a delivered push from an accepted subscription is kept, stamped with the server\'s clock', async () => {
    const { app, coord, now } = await open();
    const res = await post(app, [worker(PID, HASH('a'))]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, kept: 1, dropped: {} });
    expect(stored(coord)).toEqual([{ responseId: 1, receipt: 'shown', source: 'worker', endpointHash: HASH('a'), at: now() }]);
    await app.close();
  });

  it('from another subscription it is dropped not-accepted; for a pending push it is kept', async () => {
    const { app, coord } = await open();
    expect((await post(app, [worker(PID, HASH('e')), worker(PENDING, HASH('e'))])).json()).toEqual({ ok: true, kept: 1, dropped: { 'not-accepted': 1 } });
    expect(stored(coord)).toEqual([expect.objectContaining({ responseId: 2 })]);
    await app.close();
  });

  it('a console opened for a push is dropped wrong-source; a receipt naming no row is dropped no-row', async () => {
    const { app, coord } = await open();
    const res = await post(app, [{ ref: { kind: 'push', pushId: PID }, receipt: 'opened', from: { source: 'console' } },
      worker('c'.repeat(32), HASH('a'))]);
    expect(res.json()).toEqual({ ok: true, kept: 0, dropped: { 'wrong-source': 1, 'no-row': 1 } });
    expect(stored(coord)).toEqual([]);
    await app.close();
  });

  it('the same receipt twice keeps one, and the answer carries counts only', async () => {
    const { app, coord } = await open();
    const res = await post(app, [worker(PID, HASH('a'), 'opened'), worker(PID, HASH('a'), 'opened')]);
    expect(res.json()).toEqual({ ok: true, kept: 1, dropped: { repeat: 1 } });
    expect(JSON.stringify(res.json())).not.toContain(PID);
    expect(stored(coord)).toHaveLength(1);
    await app.close();
  });

  it(`a body of ${RECEIPTS_MAX_PER_BODY + 1} receipts is bad-request, and nothing is written`, async () => {
    const { app, coord } = await open();
    const res = await post(app, Array.from({ length: RECEIPTS_MAX_PER_BODY + 1 }, () => worker(PID, HASH('a'))));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    expect(stored(coord)).toEqual([]);
    await app.close();
  });

  it('a failed read is unavailable, with nothing written; the answer is one fixed sentence, the cause only in the log', async () => {
    const { app, coord } = await open();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    coord.db.prepare("UPDATE operator_responses SET state = 'weighed' WHERE pushId = ?").run(PENDING);
    const res = await post(app, [worker(PID, HASH('a')), worker(PENDING, HASH('a'))]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'unavailable', detail: UNAVAILABLE_DETAIL });
    expect(res.body).not.toMatch(/weighed|row \d/);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/^ccrc-server: operator_responses row \d+ is unreadable by this build: state weighed/)]);
    expect(stored(coord)).toEqual([]);
    await app.close();
  });

  it('armed, with no cookie the door answers 401 and writes nothing', async () => {
    const { app, coord } = await open(true);
    expect((await post(app, [worker(PID, HASH('a'))])).statusCode).toBe(401);
    expect(stored(coord)).toEqual([]);
    await app.close();
  });
});
