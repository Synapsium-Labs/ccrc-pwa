// D-8071 (spec 2026-11-04 §11.5): `GET /api/runs/:id/record`, a run's lasting record, and the cold read's `lastMoveAt`.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { stallDetail } from '../src/coord/stall.js';
import type { RunRecordAnswer, RunSummary } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let app: FastifyInstance | null = null;
let coord: CoordStore;
afterEach(async () => { await app?.close(); app = null; });

const T0 = 1_758_500_000_000;

const seedRun = (o: { state?: string; reviews?: number | null; closedBy?: string | null } = {}): number => {
  coord.db.prepare("INSERT OR IGNORE INTO programs (slug, title, createdAt, state) VALUES ('programme-a', 'Programme a', ?, 'active')").run(T0);
  const state = o.state ?? 'working';
  const closed = state === 'done' || state === 'failed';
  const res = coord.db.prepare(
    'INSERT INTO runs (program, wave, project, state, kind, reviews, claimedBy, openedAt, closedAt, closedBy) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run('programme-a', 1, 'project-a', state, o.reviews === undefined || o.reviews === null ? 'work' : 'review', o.reviews ?? null,
    'lane-a', T0, closed ? T0 + 9000 : null, o.closedBy ?? null);
  return Number(res.lastInsertRowid);
};
const event = (runId: number, at: number, from: string, to: string, by: string, detail: string | null): void => {
  coord.db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?,?,?,?,?,?)')
    .run(runId, at, from, to, by, detail);
};

beforeEach(async () => {
  const home = mkTmp('ccrc-run-record-');
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  app = await buildServer(deps, bus, new FleetWatcher(deps, bus));
});

const record = async (id: number | string): Promise<{ status: number; body: RunRecordAnswer & { error?: string } }> => {
  const res = await app!.inject({ method: 'GET', url: `/api/runs/${id}/record` });
  return { status: res.statusCode, body: res.json() };
};

describe('GET /api/runs/:id/record (spec §11.5)', () => {
  it('any run reads, open or closed, however old', async () => {
    const open = seedRun();
    const old = seedRun({ state: 'done', closedBy: 'coordinator' });
    event(old, T0 + 9000, 'merging', 'done', 'coordinator', 'merged');
    for (let i = 0; i < 600; i += 1) seedRun({ state: 'done' });
    expect((await record(open)).body.run.id).toBe(open);
    const r = await record(old);
    expect(r.status).toBe(200);
    expect(r.body.run.id).toBe(old);
    expect(r.body.events[0]).toMatchObject({ at: T0 + 9000, from: 'merging', to: 'done', by: 'coordinator', detail: 'merged' });
    expect((await record(999_999)).status).toBe(404);
    expect((await record('007')).status).toBe(400);
  });

  it('the record\'s run carries stuck, waitsOn, blockedBy and coordinatorGone as a frame row does', async () => {
    await app!.close();
    const home = mkTmp('ccrc-run-record-w-');
    const c2 = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    coord = c2;
    const id2 = seedRun();
    const deps = { ...testDeps(home), coord: c2 };
    const bus = new Bus();
    const w = new FleetWatcher(deps, bus);
    w.runVerdicts.replace(new Map([[id2, {
      stuck: { reason: 'owner-gone', cause: null, since: T0, closes: null }, waitsOn: 'coordinator', blockedBy: 7, coordinatorGone: true,
    }]]), new Map());
    app = await buildServer(deps, bus, w);
    const run = (await record(id2)).body.run;
    expect(run.stuck?.reason).toBe('owner-gone');
    expect(run.waitsOn).toBe('coordinator');
    expect(run.blockedBy).toBe(7);
    expect(run.coordinatorGone).toBe(true);
    expect('lastMoveAt' in run).toBe(true);
  });

  it('stall observations fold into one row per unbroken span, with its count and end', async () => {
    const id = seedRun();
    event(id, T0 + 1, 'dispatched', 'working', 'coordinator', null);
    for (let i = 0; i < 6; i += 1) event(id, T0 + 100 + i * 10, 'working', 'working', 'operator', stallDetail('live', 'quiet', 1, 1000 + i));
    event(id, T0 + 500, 'working', 'awaiting-review', 'coordinator', null);
    for (let i = 0; i < 2; i += 1) event(id, T0 + 600 + i, 'awaiting-review', 'awaiting-review', 'operator', stallDetail('shadow', 'quiet', 1, 2000 + i));
    const { events } = (await record(id)).body;
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ at: T0 + 600, folded: { count: 2, untilAt: T0 + 601 } });
    expect(events[1]!.folded).toBeUndefined();
    expect(events[2]).toMatchObject({ at: T0 + 100, folded: { count: 6, untilAt: T0 + 150 } });
  });

  it('the newest 200 rows, with olderEvents counting the rest', async () => {
    const id = seedRun();
    for (let i = 0; i < 230; i += 1) event(id, T0 + i, i % 2 === 0 ? 'working' : 'blocked', i % 2 === 0 ? 'blocked' : 'working', 'coordinator', `n${i}`);
    const { body } = await record(id);
    expect(body.events).toHaveLength(200);
    expect(body.olderEvents).toBe(30);
    expect(body.events[0]!.detail).toBe('n229');
    expect(body.events[199]!.detail).toBe('n30');
  });

  it('detail goes through the redaction profile', async () => {
    const id = seedRun();
    event(id, T0, 'working', 'working', 'coordinator', 'token=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    const { body } = await record(id);
    expect(body.events[0]!.detail).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('by reads a session id as session, and reviewedBy lists the reviews', async () => {
    const id = seedRun();
    const rev = seedRun({ reviews: id });
    event(id, T0, 'working', 'working', 'session-xyz', 'x');
    const { body } = await record(id);
    expect(body.events[0]!.by).toBe('session');
    expect(body.reviewedBy.map((h) => h.id)).toEqual([rev]);
  });

  it('dual gate', async () => {
    await app!.close();
    const home = mkTmp('ccrc-run-record-auth-');
    const base = testDeps(home);
    const c = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    coord = c;
    const id = seedRun();
    const deps = { ...base, coord: c, mailToken: 'tok', cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' } };
    const bus = new Bus();
    app = await buildServer(deps, bus, new FleetWatcher(deps, bus));
    expect((await app.inject({ method: 'GET', url: `/api/runs/${id}/record` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/runs/${id}/record`, headers: { 'x-ccrc-mail-token': 'tok' } })).statusCode).toBe(200);
  });

  it('no agent link is needed', async () => {
    const id = seedRun();
    // testDeps' io has no agent link at all; the record read never touches it.
    expect((await record(id)).status).toBe(200);
  });
});

describe('GET /api/runs (cold read)', () => {
  it('the cold read carries lastMoveAt', async () => {
    const id = seedRun();
    event(id, T0 + 321, 'dispatched', 'working', 'coordinator', null);
    for (const url of ['/api/runs', '/api/runs?closed=1', '/api/runs?closed=1&limit=10']) {
      const res = await app!.inject({ method: 'GET', url });
      const run = (res.json() as { runs: RunSummary[] }).runs.find((r) => r.id === id)!;
      expect(run.lastMoveAt, url).toBe(T0 + 321);
    }
  });
});
