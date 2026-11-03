// GET /api/landing?project= — the landing line's read (landing order wave 5e, Task 3, D-7626): the entries, the
// flags and the decider's order, box-token gated like GET /api/ledger and masked by the one masking hook.
// The handler decides nothing: it reads CoordStore's two landing reads and calls landingOrder.
//
// Seeding writes rows through the database handle openCoordDb returned, because no route in 5e creates an
// entry without a run (that is 5f). The helpers live here, never in server/src, so the one-writer census of
// `pinnedSha` (D-7614) stays at one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { LandingEntry, LandingLineView } from '../../shared/landingLine.js';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { landingOrder } from '../src/coord/landingLine.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };

const openApp = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-landing-read-');
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord, db };
};

const read = (app: FastifyInstance, qs: string, headers: Record<string, string> = tok) =>
  app.inject({ method: 'GET', url: `/api/landing${qs}`, headers });

const openRunId = (coord: CoordStore, wave: number): number => {
  const opened = coord.openRun({ program: 'landing', title: 't', project: 'project-a', wave, waveOf: 2, claimedBy: 'coord-a' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  return opened.id;
};

const seedEntry = (db: DatabaseSync, e: LandingEntry): void => {
  db.prepare(
    `INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, baseSha, ejectionKind,
       ejections, afterIds, fixesMain, setBy, pinnedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(e.id, e.project, e.pr, e.pinnedSha, e.handoffCommit, e.runId, e.state, e.baseSha, e.ejectionKind,
    e.ejections, JSON.stringify(e.afterIds), e.fixesMain ? 1 : 0, e.setBy, e.pinnedAt);
};

const seedFlags = (db: DatabaseSync, project: string, f: { operatorPaused: boolean; mainRedHold: boolean }): void => {
  db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, ?, ?)')
    .run(project, f.operatorPaused ? 1 : 0, f.mainRedHold ? 1 : 0);
};

describe('GET /api/landing', () => {
  let app: FastifyInstance | undefined;
  let db: DatabaseSync;
  let A: LandingEntry;
  let B: LandingEntry;
  let OTHER: LandingEntry;

  beforeEach(async () => {
    const w = await openApp();
    app = w.app; db = w.db;
    const r1 = openRunId(w.coord, 1);
    const r2 = openRunId(w.coord, 2);
    A = { id: 1, project: 'project-a', pr: 11, pinnedSha: 'a'.repeat(40), handoffCommit: 'b'.repeat(40), runId: r1,
      state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false,
      setBy: 'lane-a-project-a', pinnedAt: 1_000 };
    B = { ...A, id: 2, pr: 12, pinnedSha: 'c'.repeat(40), handoffCommit: 'd'.repeat(40), runId: r2, pinnedAt: 2_000 };
    OTHER = { ...A, id: 3, project: 'project-b', pr: 99 };
  });
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses 401 without the box token, and answers nothing of the line', async () => {
    seedEntry(db, A);
    const res = await read(app!, '?project=project-a', {});
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('a'.repeat(40));
  });

  it('refuses 400 bad-request without ?project=, and with a blank one', async () => {
    for (const qs of ['', '?project=', '?project=%20%20']) {
      const res = await read(app!, qs);
      expect(res.statusCode, qs).toBe(400);
      expect(res.json(), qs).toEqual({ ok: false, error: 'bad-request',
        detail: 'the landing line is per-project — ?project= is required' });
    }
  });

  it('answers 501 not-configured with no coordination database', async () => {
    const w = await openApp({ coord: undefined });
    try {
      const res = await read(w.app, '?project=project-a');
      expect(res.statusCode).toBe(501);
      expect(res.json()).toMatchObject({ ok: false, error: 'not-configured' });
    } finally { await w.app.close(); }
  });

  it('an empty project answers an empty, unpaused line with the inert flags', async () => {
    const res = await read(app!, '?project=project-a');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, project: 'project-a', operatorPaused: false, mainRedHold: false,
      entries: [], order: { paused: false, order: [], head: null } });
  });

  it('answers every entry of the project as the wire LandingEntry, shas byte for byte through the masking hook', async () => {
    seedEntry(db, B); seedEntry(db, A);
    const res = await read(app!, '?project=project-a');
    expect(res.statusCode).toBe(200);
    const body = res.json() as LandingLineView & { ok: true };
    expect(body.entries.map((e) => e.pr).sort()).toEqual([11, 12]);
    expect(body.entries.find((e) => e.pr === 11)).toEqual(A);
    expect(Object.keys(body.entries[0]!).sort()).toEqual(['afterIds', 'baseSha', 'ejectionKind', 'ejections',
      'fixesMain', 'handoffCommit', 'id', 'pinnedAt', 'pinnedSha', 'pr', 'project', 'runId', 'setBy', 'state']);
  });

  it("the order is the decider's, computed on this read: first-pinned is the head", async () => {
    seedEntry(db, B); seedEntry(db, A);
    const body = (await read(app!, '?project=project-a')).json() as LandingLineView & { ok: true };
    expect(body.order).toEqual(landingOrder(body.entries, { operatorPaused: false, mainRedHold: false }));
    expect(body.order).toMatchObject({ paused: false, head: { id: 1, pr: 11 } });
  });

  it('an operator pause on the project answers a paused line, by the operator, with the entries still listed', async () => {
    seedEntry(db, A); seedFlags(db, 'project-a', { operatorPaused: true, mainRedHold: false });
    const body = (await read(app!, '?project=project-a')).json() as LandingLineView & { ok: true };
    expect(body.operatorPaused).toBe(true);
    expect(body.mainRedHold).toBe(false);
    expect(body.order).toEqual({ paused: true, by: ['operator'], order: [A] });
  });

  it('a main-red hold answers a paused line by main-red', async () => {
    seedEntry(db, A); seedFlags(db, 'project-a', { operatorPaused: false, mainRedHold: true });
    const res = await read(app!, '?project=project-a');
    expect((res.json() as LandingLineView).order).toEqual({ paused: true, by: ['main-red'], order: [A] });
  });

  it("answers one project's line only: another project's entry and flags never leak in", async () => {
    seedEntry(db, A); seedEntry(db, OTHER); seedFlags(db, 'project-b', { operatorPaused: true, mainRedHold: true });
    const body = (await read(app!, '?project=project-a')).json() as LandingLineView & { ok: true };
    expect(body.entries.map((e) => e.project)).toEqual(['project-a']);
    expect([body.operatorPaused, body.mainRedHold]).toEqual([false, false]);
  });

  it('trims the project as the ledger read does', async () => {
    seedEntry(db, A);
    expect(((await read(app!, '?project=%20project-a%20')).json() as LandingLineView).entries).toEqual([A]);
  });
});
