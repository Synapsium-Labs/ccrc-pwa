// D-8071 (spec 2026-11-04 §11.4, A30, A31): `GET /api/runs/find`, the lookup and the close-order list in one slim read.
// Rows are seeded straight into the coord db (the read is a query over stored columns, so the seed names those columns).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { RunFindAnswer } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let app: FastifyInstance | null = null;
let coord: CoordStore;
afterEach(async () => { await app?.close(); app = null; });

const T0 = 1_758_500_000_000;

interface Seed {
  program?: string; runTitle?: string | null; wave?: number; state?: string; kind?: string; reviews?: number | null;
  workspace?: string | null; branch?: string | null; project?: string; claimedBy?: string | null;
  openedAt?: number; closedAt?: number | null; closedBy?: string | null; closeDetail?: string | null;
}
const programs = new Set<string>();
/** One run row with exactly the stored columns `find` reads. Ids ascend in call order. */
const seed = (o: Seed = {}): number => {
  const program = o.program ?? 'programme-a';
  if (!programs.has(program)) {
    coord.db.prepare("INSERT OR IGNORE INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')")
      .run(program, `Title of ${program}`, T0);
    programs.add(program);
  }
  const state = o.state ?? 'done';
  const closed = state === 'done' || state === 'failed';
  const res = coord.db.prepare(
    'INSERT INTO runs (program, wave, project, workspace, branch, state, kind, reviews, claimedBy, openedAt, closedAt, ' +
    'title, closedBy, closeDetail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    program, o.wave ?? 1, o.project ?? 'project-a', o.workspace ?? null, o.branch ?? null, state, o.kind ?? 'work',
    o.reviews ?? null, o.claimedBy ?? 'lane-a', o.openedAt ?? T0,
    o.closedAt === undefined ? (closed ? T0 + 1000 : null) : o.closedAt,
    o.runTitle ?? null, o.closedBy ?? null, o.closeDetail ?? null,
  );
  return Number(res.lastInsertRowid);
};

beforeEach(async () => {
  programs.clear();
  const home = mkTmp('ccrc-run-find-');
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  app = await buildServer(deps, bus, new FleetWatcher(deps, bus));
});

const find = async (qs: string): Promise<{ status: number; body: RunFindAnswer & { error?: string } }> => {
  const res = await app!.inject({ method: 'GET', url: `/api/runs/find${qs}` });
  return { status: res.statusCode, body: res.json() };
};
const ids = (a: { runs: { id: number }[] }): number[] => a.runs.map((r) => r.id);

describe('GET /api/runs/find (spec §11.4)', () => {
  it('closed runs order by closedAt, not id', async () => {
    const a = seed({ closedAt: T0 + 300 });
    const b = seed({ closedAt: T0 + 100 });
    const c = seed({ closedAt: T0 + 200 });
    const { status, body } = await find('?scope=closed');
    expect(status).toBe(200);
    expect(ids(body)).toEqual([a, c, b]);
  });

  it('a closed run below any read floor comes back', async () => {
    const old = seed({ closedAt: T0 + 5 });
    for (let i = 0; i < 600; i += 1) seed({ closedAt: T0 + 1000 + i });
    const { body } = await find(`?q=${old}`);
    expect(body.exact?.id).toBe(old);
    const all = await find('?scope=closed&limit=100&closedSince=0');
    expect(all.body.runs).toHaveLength(100);
    let at = all.body.next; let seen = 100; let last = all.body;
    while (at !== null) {
      last = (await find(`?scope=closed&limit=100&beforeAt=${at.beforeAt}&beforeId=${at.beforeId}`)).body;
      seen += last.runs.length; at = last.next;
    }
    expect(seen).toBe(601);
    expect(last.runs.at(-1)?.id).toBe(old);
  });

  it('a number that also matches a reviews target or a title resolves to that id, the others under their own headings', async () => {
    const target = seed({ closedAt: T0 + 10 });
    const reviewer = seed({ kind: 'review', reviews: target, closedAt: T0 + 20 });
    const titled = seed({ runTitle: `Fix item ${target} now`, closedAt: T0 + 30 });
    const { body } = await find(`?q=${target}`);
    expect(body.exact?.id).toBe(target);
    expect(body.reviewsOf.map((r) => r.id)).toEqual([reviewer]);
    expect(ids(body)).toEqual([titled]);
  });

  it('open runs come on the first page only, outside limit', async () => {
    const o1 = seed({ state: 'running' });
    const o2 = seed({ state: 'planned' });
    for (let i = 0; i < 5; i += 1) seed({ closedAt: T0 + i });
    const first = await find('?limit=2');
    expect(ids(first.body).slice(0, 2)).toEqual([o2, o1]);
    expect(first.body.runs).toHaveLength(4);
    expect(first.body.next).not.toBeNull();
    const n = first.body.next!;
    const second = await find(`?limit=2&beforeAt=${n.beforeAt}&beforeId=${n.beforeId}`);
    expect(second.body.runs.every((r) => r.closedAt !== null)).toBe(true);
  });

  it('scope=open has no next', async () => {
    for (let i = 0; i < 4; i += 1) seed({ state: 'running' });
    const { body } = await find('?scope=open&limit=1');
    expect(body.runs).toHaveLength(4);
    expect(body.next).toBeNull();
  });

  it('the cursor walks closed runs alone', async () => {
    seed({ state: 'running' });
    const c1 = seed({ closedAt: T0 + 3 }); const c2 = seed({ closedAt: T0 + 2 }); const c3 = seed({ closedAt: T0 + 1 });
    const p1 = await find('?limit=2');
    expect(p1.body.runs.map((r) => r.closedAt === null)).toEqual([true, false, false]);
    const p2 = await find(`?limit=2&beforeAt=${p1.body.next!.beforeAt}&beforeId=${p1.body.next!.beforeId}`);
    expect(ids(p2.body)).toEqual([c3]);
    expect(p2.body.next).toBeNull();
    expect([c1, c2]).toEqual(ids(p1.body).slice(1));
  });

  it('% and _ in q are escaped', async () => {
    const pct = seed({ runTitle: '100% done' });
    seed({ runTitle: '100 percent done' });
    const us = seed({ branch: 'ws/a_b' });
    seed({ branch: 'ws/aXb' });
    expect(ids((await find('?q=' + encodeURIComponent('100%'))).body)).toEqual([pct]);
    expect(ids((await find('?q=' + encodeURIComponent('a_b'))).body)).toEqual([us]);
  });

  it('closedBy filters on the stored column', async () => {
    const op = seed({ closedBy: 'operator' });
    seed({ closedBy: 'coordinator' });
    seed({ closedBy: null });
    expect(ids((await find('?closedBy=operator')).body)).toEqual([op]);
  });

  it('closedSince keeps closes at or after it', async () => {
    seed({ closedAt: T0 + 99 });
    const keep = seed({ closedAt: T0 + 100 });
    const keep2 = seed({ closedAt: T0 + 101 });
    expect(ids((await find(`?closedSince=${T0 + 100}`)).body).sort()).toEqual([keep, keep2]);
  });

  it('program keeps one slug\'s runs', async () => {
    seed({ program: 'programme-a' });
    const b = seed({ program: 'programme-b' });
    expect(ids((await find('?program=programme-b')).body)).toEqual([b]);
  });

  it('a hit carries claimedBy', async () => {
    const id = seed({ claimedBy: 'lane-a', closedBy: 'sweep', closeDetail: 'swept' });
    const { body } = await find('');
    expect(body.runs[0]).toMatchObject({ id, claimedBy: 'lane-a', closedBy: 'sweep', closeDetail: 'swept', programTitle: 'Title of programme-a' });
  });

  it('a bad closedSince or program is 400', async () => {
    for (const qs of ['?closedSince=abc', '?closedSince=-1', '?closedSince=1.5', '?program=' + encodeURIComponent('a b'), '?program=',
      '?limit=0', '?limit=101', '?scope=bogus', '?beforeAt=5', '?beforeId=5', '?closedBy=']) {
      const r = await find(qs);
      expect(r.status, qs).toBe(400);
      expect(r.body.error, qs).toBe('bad-request');
    }
  });

  it('closedBy with closedSince equals the Closed today count for that closer', async () => {
    const dayStart = T0 + 1_000_000;
    for (let i = 0; i < 3; i += 1) seed({ closedBy: 'operator', closedAt: dayStart + i });
    seed({ closedBy: 'operator', closedAt: dayStart - 1 });
    seed({ closedBy: 'coordinator', closedAt: dayStart + 5 });
    const { body } = await find(`?closedBy=operator&closedSince=${dayStart}&scope=closed`);
    expect(body.runs).toHaveLength(3);
  });

  it('session only', async () => {
    await app!.close();
    const home = mkTmp('ccrc-run-find-auth-');
    const base = testDeps(home);
    const c = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...base, coord: c, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' } };
    const bus = new Bus();
    app = await buildServer(deps, bus, new FleetWatcher(deps, bus));
    const res = await app.inject({ method: 'GET', url: '/api/runs/find', headers: { 'x-ccrc-mail-token': deps.mailToken ?? 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('120 a minute', async () => {
    let last = 0;
    for (let i = 0; i < 121; i += 1) last = (await find('?limit=1')).status;
    expect(last).toBe(429);
  });

  it('a page under 20 ms at 10,000 seeded rows', async () => {
    const ins = coord.db.prepare(
      'INSERT INTO runs (program, wave, project, state, kind, openedAt, closedAt, title) VALUES (?,?,?,?,?,?,?,?)');
    coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('bulk', 'Bulk', ?, 'active')").run(T0);
    coord.db.exec('BEGIN');
    for (let i = 0; i < 10_000; i += 1) ins.run('bulk', 1, 'project-a', 'done', 'work', T0, T0 + i, `Run ${i}`);
    coord.db.exec('COMMIT');
    const url = '/api/runs/find?scope=closed&limit=30';
    await app!.inject({ method: 'GET', url });
    const t = performance.now();
    const res = await app!.inject({ method: 'GET', url });
    const ms = performance.now() - t;
    expect((res.json() as RunFindAnswer).runs).toHaveLength(30);
    expect(ms).toBeLessThan(20);
  });
});
