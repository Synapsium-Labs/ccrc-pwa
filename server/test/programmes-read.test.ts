// D-8075 (spec 2026-11-04 §11.6, A26, A32, A55): `GET /api/programmes`, the programme aggregate. Rows are seeded straight into
// the coord db (the read is one statement over stored columns), and the stuck pass's answers are put into the watcher's
// `RunVerdicts` by hand.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { RunVerdict } from '../src/coord/runVerdicts.js';
import type { ProgrammesAnswer, ProgrammeRow } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let app: FastifyInstance | null = null;
let coord: CoordStore;
let watcher: FleetWatcher;
afterEach(async () => { await app?.close(); app = null; vi.useRealTimers(); });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_758_500_000_000;

interface Seed {
  program?: string; wave?: number; waveOf?: number | null; state?: string; kind?: string; claimedBy?: string | null;
  openedAt?: number; closedAt?: number | null; closedBy?: string | null; closeDetail?: string | null;
}
const programs = new Set<string>();
const seed = (o: Seed = {}): number => {
  const program = o.program ?? 'programme-a';
  if (!programs.has(program)) {
    // The programme's own state is deliberately wrong-able by a test: it is never read.
    coord.db.prepare("INSERT OR IGNORE INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')")
      .run(program, `Title of ${program}`, NOW - 60 * DAY);
    programs.add(program);
  }
  const state = o.state ?? 'working';
  const closed = state === 'done' || state === 'failed';
  const res = coord.db.prepare(
    'INSERT INTO runs (program, wave, waveOf, project, state, kind, claimedBy, openedAt, closedAt, closedBy, closeDetail) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    program, o.wave ?? 1, o.waveOf === undefined ? null : o.waveOf, 'project-a', state, o.kind ?? 'work',
    o.claimedBy === undefined ? 'lane-a' : o.claimedBy, o.openedAt ?? NOW - 10 * DAY,
    o.closedAt === undefined ? (closed ? NOW - HOUR : null) : o.closedAt, o.closedBy ?? null, o.closeDetail ?? null,
  );
  return Number(res.lastInsertRowid);
};

const verdict = (v: Partial<RunVerdict> = {}): RunVerdict => ({ stuck: null, blockedBy: null, coordinatorGone: false, ...v });

beforeEach(async () => {
  programs.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const home = mkTmp('ccrc-programmes-');
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  watcher = new FleetWatcher(deps, bus);
  app = await buildServer(deps, bus, watcher);
});

const read = async (since: number = NOW - 12 * HOUR): Promise<{ status: number; body: ProgrammesAnswer & { error?: string } }> => {
  const res = await app!.inject({ method: 'GET', url: `/api/programmes?since=${since}` });
  return { status: res.statusCode, body: res.json() };
};
const row = (b: ProgrammesAnswer, slug = 'programme-a'): ProgrammeRow => {
  const r = b.programmes.find((p) => p.slug === slug);
  if (r === undefined) throw new Error(`no row for ${slug}`);
  return r;
};

describe('GET /api/programmes', () => {
  it('open comes from runs, never programs.state', async () => {
    seed({ state: 'working', wave: 2 });
    coord.db.prepare("UPDATE programs SET state = 'done' WHERE slug = 'programme-a'").run();
    const { body } = await read();
    const r = row(body);
    expect(r.ending).toBeNull();
    expect(r.waves.working).toBe(1);
    expect(r.currentWave).toBe(2);
    expect(r.title).toBe('Title of programme-a');
    expect(r.claimedBy).toBe('lane-a');
  });

  it("a leftover review's abandon leaves a finished programme complete", async () => {
    seed({ wave: 1, state: 'done', closedBy: 'coordinator' });
    seed({ wave: 2, state: 'done', closedBy: 'coordinator' });
    seed({ wave: 2, kind: 'review', state: 'failed', closedBy: 'operator', closeDetail: 'abandon:review-of-closed' });
    // The abandon's retirement check wrote the programme's own column.
    coord.db.prepare("UPDATE programs SET state = 'abandoned' WHERE slug = 'programme-a'").run();
    const r = row((await read()).body);
    expect(r.ending).toEqual({ outcome: 'complete', waves: 2, neverStarted: 0, closedBy: null });
    expect(r.waves).toEqual({ working: 0, waiting: 0, queued: 0, done: 2, failed: 0 });
  });

  it('an ended programme names never-started waves and who closed the last', async () => {
    seed({ wave: 1, state: 'done', closedBy: 'coordinator' });
    seed({ wave: 2, state: 'failed', closedBy: 'sweep', closeDetail: 'abandon:never-started', closedAt: NOW - 3 * HOUR });
    seed({ wave: 3, state: 'failed', closedBy: 'sweep', closeDetail: 'abandon:never-started', closedAt: NOW - 2 * HOUR });
    const r = row((await read()).body);
    expect(r.ending).toEqual({ outcome: 'ended', waves: 3, neverStarted: 2, closedBy: 'sweep' });
    expect(r.waves.failed).toBe(2);
  });

  it('the wave counts put each wave in one group and reviews nest', async () => {
    seed({ wave: 1, state: 'done' });
    seed({ wave: 2, state: 'awaiting-review' });
    seed({ wave: 2, kind: 'review', state: 'working' });
    seed({ wave: 3, state: 'dispatched', waveOf: 5 });
    seed({ wave: 4, state: 'planned' });
    const r = row((await read()).body);
    expect(r.waves).toEqual({ working: 1, waiting: 1, queued: 1, done: 1, failed: 0 });
    // The highest wave that has left planned; wave 4 is queued ahead.
    expect(r.currentWave).toBe(3);
    expect(r.waveOf).toBe(5);
  });

  it('a programme whose only open run is planned reads its lowest queued wave', async () => {
    seed({ wave: 3, state: 'planned' });
    seed({ wave: 4, state: 'planned', waveOf: 6 });
    const r = row((await read()).body);
    expect(r.currentWave).toBe(3);
    expect(r.waves.queued).toBe(2);
  });

  it('since is clamped to the last 48 hours', async () => {
    seed({ state: 'done', closedBy: 'operator', closedAt: NOW - 3 * DAY });
    seed({ state: 'done', closedBy: 'operator', closedAt: NOW - 47 * HOUR });
    seed({ state: 'done', closedBy: 'sweep', closedAt: NOW - HOUR });
    seed({ state: 'done', closedBy: 'coordinator', closedAt: NOW - HOUR });
    seed({ state: 'done', closedBy: 'coordinator', closedAt: NOW - 2 * HOUR });
    const { body } = await read(0);
    expect(body.closedToday).toEqual({ operator: 1, sweep: 1, coordinator: 2 });
    const narrow = await read(NOW - 90 * 60_000);
    expect(narrow.body.closedToday).toEqual({ operator: 0, sweep: 1, coordinator: 1 });
  });

  it('a bad since is refused', async () => {
    const res = await app!.inject({ method: 'GET', url: '/api/programmes?since=yesterday' });
    expect(res.statusCode).toBe(400);
  });

  it('one aggregate statement gives the run facts', async () => {
    seed({ wave: 1, state: 'done' });
    seed({ program: 'programme-b', wave: 1, state: 'working' });
    const real = coord.db.prepare.bind(coord.db);
    const runsStatements: string[] = [];
    (coord.db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
      if (/GROUP BY/i.test(sql)) runsStatements.push(sql);
      return real(sql);
    };
    const { status } = await read();
    expect(status).toBe(200);
    expect(runsStatements.length).toBe(1);
  });

  it('stuck and pendingClose fold in from RunVerdicts, and the stuck count equals its entries for that programme', async () => {
    const a = seed({ wave: 1, state: 'working' });
    const b = seed({ wave: 2, state: 'planned' });
    const c = seed({ wave: 3, state: 'planned' });
    const other = seed({ program: 'programme-b', wave: 1, state: 'working' });
    watcher.runVerdicts.replace(new Map([
      [a, verdict({ stuck: { reason: 'overtaken', cause: null, since: NOW - 2 * DAY, closes: null } })],
      [b, verdict({ stuck: { reason: 'overtaken', cause: null, since: NOW - 2 * DAY, closes: null } })],
      [c, verdict({ stuck: { reason: 'never-started', cause: null, since: NOW - 2 * DAY, closes: null } })],
      [other, verdict()],
    ]), new Map());
    // The run-close lane's clocks live in their own map, which `all()` joins in.
    watcher.runVerdicts.setCloses(new Map([[a, { at: NOW + 5 * HOUR, armed: true }], [b, { at: NOW + 2 * HOUR, armed: true }]]));
    const { body } = await read();
    const r = row(body);
    expect(r.stuck).toBe(3);
    expect(r.pendingClose).toEqual([{ reason: 'overtaken', count: 2, soonestAt: NOW + 2 * HOUR, armed: true }]);
    expect(row(body, 'programme-b').stuck).toBe(0);
    expect(row(body, 'programme-b').pendingClose).toEqual([]);
  });

  it('armed runs are counted and shadow runs are not, when a reason mixes them', async () => {
    const a = seed({ wave: 1, state: 'working' });
    const b = seed({ wave: 2, state: 'working' });
    watcher.runVerdicts.replace(new Map([
      [a, verdict({ stuck: { reason: 'overtaken', cause: null, since: NOW - DAY, closes: null } })],
      [b, verdict({ stuck: { reason: 'overtaken', cause: null, since: NOW - DAY, closes: null } })],
    ]), new Map());
    watcher.runVerdicts.setCloses(new Map([[a, { at: NOW + HOUR, armed: false }], [b, { at: NOW + 4 * HOUR, armed: true }]]));
    const r = row((await read()).body);
    expect(r.pendingClose).toEqual([{ reason: 'overtaken', count: 1, soonestAt: NOW + 4 * HOUR, armed: true }]);
  });

  it('before the first pass both are absent', async () => {
    seed({ state: 'working' });
    const r = row((await read()).body);
    expect(r).not.toHaveProperty('stuck');
    expect(r).not.toHaveProperty('pendingClose');
    expect(r).not.toHaveProperty('coordinatorGone');
  });

  it('session only', async () => {
    // The gate answers before the handler: this build's test deps arm auth only when the helper says so, so the pin is the
    // auth-gate census (the route is session-gated and NOT exempt), and here the route answers a configured read.
    const res = await app!.inject({ method: 'GET', url: `/api/programmes?since=${NOW}` });
    expect(res.statusCode).toBe(200);
  });

  it('a programme with a gone coordinator has a row', async () => {
    const a = seed({ state: 'working' });
    watcher.runVerdicts.replace(new Map([[a, verdict({ coordinatorGone: true })]]), new Map());
    const r = row((await read()).body);
    expect(r.coordinatorGone).toBe(true);
  });

  it('coordinatorGone reads from its open runs', async () => {
    const a = seed({ wave: 1, state: 'working' });
    const b = seed({ program: 'programme-b', wave: 1, state: 'working' });
    watcher.runVerdicts.replace(new Map([[a, verdict({ coordinatorGone: true })], [b, verdict({ coordinatorGone: false })]]), new Map());
    const { body } = await read();
    expect(row(body).coordinatorGone).toBe(true);
    expect(row(body, 'programme-b').coordinatorGone).toBe(false);
  });

  it('a programme with no open run reads its own entry (D-1146)', async () => {
    seed({ wave: 1, state: 'done', closedAt: NOW - 2 * DAY, closedBy: 'coordinator' });
    watcher.runVerdicts.replace(new Map(), new Map([['programme-a', true]]));
    const r = row((await read()).body);
    expect(r.coordinatorGone).toBe(true);
    expect(r.ending?.outcome).toBe('complete');
  });

  it('past the window the field is absent', async () => {
    seed({ wave: 1, state: 'done', closedAt: NOW - 6 * DAY, closedBy: 'coordinator' });
    seed({ program: 'programme-b', wave: 1, state: 'done', closedAt: NOW - 8 * DAY, closedBy: 'coordinator' });
    // The pass measures no entry past 7 days, so the reader holds none for programme-b.
    watcher.runVerdicts.replace(new Map(), new Map([['programme-a', false]]));
    const { body } = await read();
    expect(row(body).coordinatorGone).toBe(false);
    // A programme closed 8 days ago is past the Finished window and has no row.
    expect(body.programmes.some((p) => p.slug === 'programme-b')).toBe(false);
  });
});
