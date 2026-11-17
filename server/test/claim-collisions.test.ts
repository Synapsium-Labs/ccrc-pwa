// Overlord W2, plan w2-overlaps.md Task 3, question 4: the record of a REFUSED claim. The first block characterizes today's
// claim path and passes before `claimAttempt` calls the record; the rest pins the record, its prune, and the rule that a
// failed record never changes the claim's own answer (the plan review's F5).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { collisionsSince } from '../src/coord/claimCollisions.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;
const HOUR = 3_600_000;
const WARN_PREFIX = 'ccrc-server: claims: a collision record failed';

const mkStore = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-collisions-'), '.ccrc', 'coord.db')));

type Input = Parameters<CoordStore['claimAttempt']>[0];
const attempt = (s: CoordStore, over: Partial<Input> = {}) =>
  s.claimAttempt({ project: 'project-a', paths: ['server/src/io.ts'], sessionId: 'lane-a-project-a', uuid: 'u-1', runId: null,
    intent: 'holding', now: NOW, ...over });
const rival = (s: CoordStore, over: Partial<Input> = {}) =>
  attempt(s, { sessionId: 'lane-b-project-a', uuid: 'u-2', intent: 'colliding', now: NOW + 1000, ...over });

const count = (s: CoordStore, table: string): number =>
  (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const addProgram = (s: CoordStore, slug: string): void => {
  s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, 'active')").run(slug, slug);
};
const addRun = (s: CoordStore, program: string): number => Number(s.db.prepare(
  "INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, 1, 1, 'project-a', 'working', 'op-a', 1)",
).run(program).lastInsertRowid);
const seedOldCollision = (s: CoordStore, at: number): void => {
  s.db.prepare("INSERT INTO claim_collisions (at, project, path, claimedPath, requesterId, requesterRun, holderClaimId) " +
    "VALUES (?, 'project-a', 'old/x.ts', 'old/x.ts', 'lane-z-project-a', NULL, 999)").run(at);
};
const FORCE_ROLLBACK = "CREATE TRIGGER force_rb BEFORE INSERT ON claim_collisions BEGIN SELECT RAISE(ROLLBACK, 'forced'); END";

describe('the claim path today (characterization, green before the record is wired)', () => {
  it('a refused attempt answers exactly { ok: false, why: conflict, conflicts } and writes no claims or claim_paths row', () => {
    const s = mkStore();
    attempt(s, { paths: ['shared/api.ts', 'server/src/io.ts'] });
    const claimsBefore = count(s, 'claims');
    const pathsBefore = count(s, 'claim_paths');
    const r = rival(s, { paths: ['shared/api.ts', 'server/src/io.ts', 'docs/notes.md'] });
    expect(Object.keys(r).sort()).toEqual(['conflicts', 'ok', 'why']);
    expect(r).toMatchObject({ ok: false, why: 'conflict' });
    if (r.ok || r.why !== 'conflict') throw new Error('unreachable');
    expect(r.conflicts.map((c) => c.path).sort()).toEqual(['server/src/io.ts', 'shared/api.ts']);
    expect(count(s, 'claims')).toBe(claimsBefore);
    expect(count(s, 'claim_paths')).toBe(pathsBefore);
    expect(s.db.isTransaction).toBe(false);
  });

  it('a granted attempt is unchanged: one claim row, its paths, ok true', () => {
    const s = mkStore();
    const r = attempt(s, { paths: ['a/one.ts', 'a/two.ts'] });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error('unreachable');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ project: 'project-a', heldBy: 'lane-a-project-a', state: 'live', createdAt: NOW });
    expect([...r.claims[0]!.paths].sort()).toEqual(['a/one.ts', 'a/two.ts']);
    expect(count(s, 'claims')).toBe(1);
    expect(count(s, 'claim_paths')).toBe(2);
  });
});

describe('the collision record', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a refused attempt writes one row per conflict, with the requester and its run', () => {
    const s = mkStore();
    addProgram(s, 'prog-b');
    const runId = addRun(s, 'prog-b');
    const held = attempt(s, { paths: ['shared/api.ts', 'server/src/io.ts'] });
    if (!held.ok) throw new Error('unreachable');
    const r = rival(s, { paths: ['shared/api.ts', 'server/src/io.ts'], runId });
    expect(r).toMatchObject({ ok: false, why: 'conflict' });
    const rows = s.db.prepare('SELECT * FROM claim_collisions ORDER BY path').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x['path'])).toEqual(['server/src/io.ts', 'shared/api.ts']);
    for (const row of rows) {
      expect(row).toMatchObject({ at: NOW + 1000, project: 'project-a', requesterId: 'lane-b-project-a', requesterRun: runId,
        holderClaimId: held.claims[0]!.id });
      expect(row['claimedPath']).toBe(row['path']);
    }
  });

  it('a granted attempt and a renewal write none', () => {
    const s = mkStore();
    attempt(s);
    attempt(s, { now: NOW + 5000, intent: 'renewed' });
    attempt(s, { paths: ['elsewhere/x.ts'], sessionId: 'lane-b-project-a', uuid: 'u-2' });
    expect(count(s, 'claim_collisions')).toBe(0);
  });

  it('prunes a row 49 hours old on the next refused attempt and keeps a 47-hour one', () => {
    const s = mkStore();
    attempt(s);
    const at = NOW + 1000;
    seedOldCollision(s, at - 49 * HOUR);
    seedOldCollision(s, at - 47 * HOUR);
    expect(count(s, 'claim_collisions')).toBe(2);
    rival(s);
    const ats = (s.db.prepare('SELECT at FROM claim_collisions ORDER BY at').all() as { at: number }[]).map((x) => x.at);
    expect(ats).toEqual([at - 47 * HOUR, at]);
  });

  it('a dropped table leaves the answer equal to the characterized one', () => {
    const control = mkStore();
    attempt(control);
    const expected = rival(control);
    const s = mkStore();
    attempt(s);
    s.db.exec('DROP TABLE claim_collisions');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const got = rival(s);
    expect(got).toEqual(expected);
    expect(s.db.isTransaction).toBe(false);
  });

  it('warns once per process however often a record fails', async () => {
    // The latch is module-level, so this test loads a FRESH copy of the store (vi.resetModules) and its latch is unset:
    // two failing records then produce exactly one warning, whatever order the other tests ran in.
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fresh = await import('../src/coord/store.js');
    const freshDb = await import('../src/coord/db.js');
    const s = new fresh.CoordStore(freshDb.openCoordDb(path.join(mkTmp('ccrc-collisions-'), '.ccrc', 'coord.db')));
    s.claimAttempt({ project: 'project-a', paths: ['x/a.ts'], sessionId: 'lane-a-project-a', uuid: 'u-1', runId: null, intent: 'h', now: NOW });
    s.db.exec('DROP TABLE claim_collisions');
    for (const i of [1, 2]) {
      const r = s.claimAttempt({ project: 'project-a', paths: ['x/a.ts'], sessionId: 'lane-b-project-a', uuid: 'u-2', runId: null,
        intent: 'c', now: NOW + i });
      expect(r).toMatchObject({ ok: false, why: 'conflict' });
    }
    const ours = warn.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].startsWith(WARN_PREFIX));
    expect(ours).toHaveLength(1);
  });

  it('a forced rollback leaves the answer, no collision row, no pruned row, a closed transaction, and the next claim works', () => {
    const control = mkStore();
    attempt(control);
    const expected = rival(control);
    const s = mkStore();
    attempt(s);
    seedOldCollision(s, NOW - 49 * HOUR);
    s.db.exec(FORCE_ROLLBACK);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const got = rival(s);
    expect(got).toEqual(expected);
    expect(s.db.isTransaction).toBe(false);
    const rows = s.db.prepare('SELECT at, path FROM claim_collisions').all() as { at: number; path: string }[];
    expect(rows).toEqual([{ at: NOW - 49 * HOUR, path: 'old/x.ts' }]);   // the prune rolled back with the insert
    const next = attempt(s, { paths: ['free/path.ts'], sessionId: 'lane-c-project-a', uuid: 'u-3', now: NOW + 9000 });
    expect(next).toMatchObject({ ok: true });
    expect(rival(s, { now: NOW + 9500 })).toMatchObject({ ok: false, why: 'conflict' });
  });
});

describe('POST /api/claims with a failing record', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; vi.restoreAllMocks(); });

  it('answers 409 claim-conflict, never 500, under the forced-rollback trigger', async () => {
    const TOKEN = 'f'.repeat(64);
    const home = mkTmp('ccrc-collisions-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const seed = (id: string, uuid: string): void => {
      const fields = { wrapper: 'claude', project: 'project-a', workdir: `/w/project-a/${id}`, uuid, started: '1' };
      for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
    };
    const A = { byId: 'lane-a-project-a', byUuid: 'a'.repeat(36) };
    const B = { byId: 'lane-b-project-a', byUuid: 'b'.repeat(36) };
    seed(A.byId, A.byUuid); seed(B.byId, B.byUuid);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const alive = async (_c: string, args: readonly string[]) => args[0] === 'list-panes'
      ? { ran: true, code: 0, stdout: '4061\n', stderr: '' }
      : { ran: true, code: args[0] === 'has-session' ? 0 : 1, stdout: '', stderr: '' };
    app = await buildServer({ ...testDeps(home, alive as never), mailToken: TOKEN, coord });
    const post = (body: Record<string, unknown>) => app!.inject({ method: 'POST', url: '/api/claims',
      headers: { 'x-ccrc-mail-token': TOKEN }, payload: body });
    expect((await post({ ...A, project: 'project-a', paths: ['shared/api.ts'], intent: 'holding' })).statusCode).toBe(200);
    coord.db.exec(FORCE_ROLLBACK);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await post({ ...B, project: 'project-a', paths: ['shared/api.ts'], intent: 'colliding' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'claim-conflict' });
    expect(coord.db.isTransaction).toBe(false);
  });
});

describe('collisionsSince', () => {
  it('joins the requester run and the holder claim, run and both programmes, oldest first', () => {
    const s = mkStore();
    addProgram(s, 'prog-a'); addProgram(s, 'prog-b');
    const runA = addRun(s, 'prog-a');
    const runB = addRun(s, 'prog-b');
    const held = attempt(s, { runId: runA });
    if (!held.ok) throw new Error('unreachable');
    rival(s, { runId: runB });
    const r = collisionsSince(s.db, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ project: 'project-a', path: 'server/src/io.ts', requesterId: 'lane-b-project-a',
      requesterRun: runB, requesterProgram: 'prog-b', holderClaimId: held.claims[0]!.id, holderId: 'lane-a-project-a',
      holderRun: runA, holderProgram: 'prog-a' });
  });

  it('answers a null program for a side with no run, and honours since', () => {
    const s = mkStore();
    attempt(s);
    rival(s);
    const r = collisionsSince(s.db, 0);
    if (!r.ok) throw new Error('unreachable');
    expect(r.rows[0]).toMatchObject({ requesterRun: null, requesterProgram: null, holderRun: null, holderProgram: null });
    const later = collisionsSince(s.db, NOW + 2000);
    expect(later).toEqual({ ok: true, rows: [] });
  });

  it('answers { ok: false } with a detail when the table is gone, never an empty list', () => {
    const s = mkStore();
    s.db.exec('DROP TABLE claim_collisions');
    const r = collisionsSince(s.db, 0);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.detail).toContain('claim_collisions');
  });
});
