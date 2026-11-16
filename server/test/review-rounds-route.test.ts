// D-8125: the coordinator's review-cap door, POST /api/runs/:id/review-rounds. Fixture HOMEs only, neutral names.
// The rounds are opened through the store (a failed review run is one spent round), the way review-cap-store.test.ts does.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { CcrcConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const REASON = 'F1 and F3 are real majors and round 3 closed two of five';
const hdr = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const pair = (id: string) => ({ byId: id, byUuid: `u-${id}` });

async function rig(cfg: Partial<CcrcConfig> = {}) {
  const home = mkTmp('ccrc-review-rounds-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const id of ['lane-a', 'lane-b', 'demo-w1']) seedRow(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home, recorder().run);
  const app: FastifyInstance = await buildServer({ ...base, mailToken: ID_GATE_TOKEN, coord, notifyLog, cfg: { ...base.cfg, ...cfg } });
  const open = (program: string, claimedBy: string, over: Record<string, unknown> = {}) =>
    coord.openRun({ program, title: 'T', project: 'demo', wave: 1, waveOf: null, claimedBy, ...over });
  const work = (program = 'prog-a', claimedBy = 'lane-a'): number => (open(program, claimedBy) as { id: number }).id;
  const round = (workId: number): void => {
    const r = open('prog-a', 'lane-a', { kind: 'review', reviews: workId }) as { id: number };
    coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(r.id);
  };
  const rounds = (workId: number, n: number): void => { for (let i = 0; i < n; i++) round(workId); };
  const post = (id: number, payload: unknown, headers: Record<string, string> = hdr) =>
    app.inject({ method: 'POST', url: `/api/runs/${id}/review-rounds`, headers, payload: payload as object });
  const count = (table: string): number => Number((coord.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  const written = () => [count('review_cap'), count('review_cap_lifts'), count('run_events'), count('operator_items'), count('operator_item_events')];
  const feed = () => notifyLog.catchUp(notifyLog.epoch, 0).events;
  const row = async (id: number) => {
    const res = await app.inject({ method: 'GET', url: '/api/runs' });
    return (res.json() as { runs: { id: number; reviewCap: Record<string, unknown> | null }[] }).runs.find((r) => r.id === id)!;
  };
  return { app, cfg: { ...base.cfg, ...cfg }, coord, home, work, round, rounds, post, written, feed, row, open, count };
}

describe('POST /api/runs/:id/review-rounds (D-8125)', () => {
  it('401 with no box token and nothing written', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    const before = t.written();
    expect((await t.post(id, { ...pair('lane-a'), reason: REASON }, {})).statusCode).toBe(401);
    expect(t.written()).toEqual(before);
  });

  it('R3: a missing, blank, short, multi-line or over-long reason is 400 bad-request, nothing written', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    const before = t.written();
    for (const reason of [undefined, '', '   ', 'too short', `${REASON}\nsecond line`, 'x'.repeat(301), 7]) {
      const res = await t.post(id, { ...pair('lane-a'), ...(reason === undefined ? {} : { reason }) });
      expect(res.statusCode, String(reason)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect((await t.post(id, { reason: REASON })).statusCode).toBe(400);
    expect(t.written()).toEqual(before);
  });

  it('a stale byUuid is refused by the attribution verdict, nothing written', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    const before = t.written();
    const res = await t.post(id, { byId: 'lane-a', byUuid: 'u-stale', reason: REASON });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json()).toMatchObject({ ok: false });
    expect(t.written()).toEqual(before);
  });

  it('R1: the bound worker with its own fresh pair is 403 not-your-programme, nothing written', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    const before = t.written();
    const res = await t.post(id, { ...pair('demo-w1'), reason: REASON });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-your-programme' });
    expect(t.written()).toEqual(before);
  });

  it('R2: another programme\'s coordinator is 403 not-your-programme, nothing written', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    t.work('prog-b', 'lane-b');
    const before = t.written();
    const res = await t.post(id, { ...pair('lane-b'), reason: REASON });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-your-programme' });
    expect(t.written()).toEqual(before);
  });

  it('404 for an absent run, 400 for a bad id', async () => {
    const t = await rig();
    expect((await t.post(9999, { ...pair('lane-a'), reason: REASON })).statusCode).toBe(404);
    const bad = await t.app.inject({ method: 'POST', url: '/api/runs/abc/review-rounds', headers: hdr, payload: { ...pair('lane-a'), reason: REASON } });
    expect(bad.statusCode).toBe(400);
  });

  it('under the cap is 409 cap-not-reached', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 2);
    const before = t.written();
    const res = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'cap-not-reached' });
    expect(t.written()).toEqual(before);
  });

  it('at the cap: 200, +3 rounds, the ask closed, the row and the feed say so, and the 4th review opens', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    expect(t.coord.raiseReviewCapAsk(id, 1000)).toBe(true); // what the 4th open's refusal does
    const items = [t.count('operator_items'), t.count('operator_item_events')];
    const pushes = t.feed().length;
    const res = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, run: id, rounds: 3, capBefore: 3, capAfter: 6, closedAsk: true });
    const cap = (await t.row(id)).reviewCap!;
    expect(cap).toMatchObject({ cap: 6, granted: 3, coordLift: { by: 'lane-a', reason: REASON, rounds: 3, capBefore: 3, capAfter: 6, count: 1 } });
    expect(typeof cap.askHandledAt).toBe('number');
    const added = t.feed().slice(pushes);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'coord', title: 'Review cap lifted by its coordinator', runId: id });
    expect(added[0]!.body).toContain(REASON);
    expect([t.count('operator_items'), t.count('operator_item_events')]).toEqual(items); // R7
    expect(t.open('prog-a', 'lane-a', { kind: 'review', reviews: id })).toHaveProperty('id');
  });

  it('R4: a second lift straight away is cap-not-reached; after rounds 4 to 6 it lifts again, 3 to 6 to 9', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    expect((await t.post(id, { ...pair('lane-a'), reason: REASON })).statusCode).toBe(200);
    const early = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'cap-not-reached' });
    t.rounds(id, 3);
    expect(t.open('prog-a', 'lane-a', { kind: 'review', reviews: id })).toMatchObject({ refused: 'cap-review-rounds', by: '6' });
    expect(t.coord.raiseReviewCapAsk(id, 2000)).toBe(true); // reopened: the first ask was closed by the lift
    const res = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(res.json()).toMatchObject({ ok: true, rounds: 6, capBefore: 6, capAfter: 9, closedAsk: true });
    expect((await t.row(id)).reviewCap).toMatchObject({ cap: 9, granted: 6, coordLift: { count: 2 } });
    expect(t.count('review_cap_lifts')).toBe(2);
    const events = t.coord.db.prepare("SELECT COUNT(*) AS n FROM run_events WHERE runId = ? AND detail LIKE 'coord-lift:%'").get(id) as { n: number };
    expect(Number(events.n)).toBe(2);
  });

  it('R5: the lift is always on (D-8165): a coordinator lift succeeds with no setting, and no config field switches it', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    expect(Object.keys(t.cfg)).not.toContain('reviewCapCoordLift');
    const res = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, capBefore: 3, capAfter: 6 });
  });

  it('after the operator lifted the cap a coordinator lift is cap-not-reached', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    await t.app.inject({ method: 'POST', url: '/api/coord/review-cap', payload: { run: id } });
    const res = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'cap-not-reached' });
  });

  it('a closed work run is 409 run-closed', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    t.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    const res = await t.post(id, { ...pair('lane-a'), reason: REASON });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'run-closed' });
  });

  it('R8: a reason carrying a key is stored and sent with no 8-character slice of it', async () => {
    const t = await rig(); const id = t.work(); t.rounds(id, 3);
    const key = 'sk-' + 'Zq7Lm2Xv9Rt4Bw8Nc3Hd6Fy1Ka5Js0Pe';
    const res = await t.post(id, { ...pair('lane-a'), reason: `F1 is a real major, token ${key} was in the report` });
    expect(res.statusCode).toBe(200);
    const stored = JSON.stringify(t.coord.db.prepare('SELECT reason FROM review_cap_lifts').all())
      + JSON.stringify(t.coord.db.prepare('SELECT detail FROM run_events').all());
    const sent = JSON.stringify(await t.row(id)) + JSON.stringify(t.feed());
    for (let i = 0; i + 8 <= key.length; i++) {
      expect(stored, key.slice(i, i + 8)).not.toContain(key.slice(i, i + 8));
      expect(sent, key.slice(i, i + 8)).not.toContain(key.slice(i, i + 8));
    }
  });
});
