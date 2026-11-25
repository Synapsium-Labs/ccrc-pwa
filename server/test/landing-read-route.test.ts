// GET /api/landing?project= — the landing line's read (landing order wave 5e, Task 3, D-7626): the entries, the
// flags and the decider's order, box-token gated like GET /api/ledger and masked by the one masking hook.
// The handler decides nothing: it reads CoordStore's two landing reads and calls landingOrder.
//
// Seeding writes rows through the database handle openCoordDb returned, because no route in 5e creates an
// entry without a run (that is 5f). The helpers live here, never in server/src, so the one-writer census of
// `pinnedSha` (D-7614) stays at one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { LandingEntry, LandingLineView } from '../../shared/landingLine.js';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import { landingOrder } from '../src/coord/landingLine.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { CONTROL_HEAD_SHA, CONTROL_NOW, controlRead, landingStoreOver } from './landingFixture.js';
import type { FleetWatcher } from '../src/watch.js';
import type { LandingControlRead } from '../src/coord/radar.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };

const openApp = async (over: Partial<Deps> = {}, watcher?: FleetWatcher) => {
  const home = mkTmp('ccrc-landing-read-');
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const db = openCoordDb(dbPath);
  const coord = landingStoreOver(db, dbPath);
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over }, undefined, watcher);
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

  // Wave 5j-a (D-9048), inverted: this case read "refuses 401 without the box token, and answers nothing of the line", on
  // a box whose sign-in is dark (`testDeps`). The read is now a dual-credential read in the `GET /api/feed` shape, so a dark
  // box answers it with no credential, like every dual-credential read; the armed cells are in the describe below.
  it('answers 200 with no credential on a dark box', async () => {
    seedEntry(db, A);
    const res = await read(app!, '?project=project-a', {});
    expect(res.statusCode).toBe(200);
    expect((res.json() as LandingLineView).entries.map((e) => e.pr)).toEqual([11]);
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
      entries: [], order: { paused: false, order: [], head: null }, binding: { mode: 'held', reason: 'opt-in-unknown', entryId: null }, recovery: { subjects: [], hold: null }, entriesScope: 'open' });
  });

  it('answers every entry still in the line as the wire LandingEntry, shas byte for byte through the masking hook', async () => {
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

  it('a recovered subject with no projection holds the line: recovery is additive, the head is null and `held` names it', async () => {
    seedEntry(db, A);
    db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (7, 'project-a', 40, 'no-run', NULL, 3)").run();
    const body = (await read(app!, '?project=project-a')).json() as LandingLineView & { ok: true };
    expect(body.recovery).toMatchObject({ hold: { reason: 'landing-recovery-unresolved', subjectIds: [7] },
      subjects: [{ id: 7, project: 'project-a', pr: 40, projection: { kind: 'missing', association: 'unmeasured' }, authority: { kind: 'not-set' } }] });
    expect(body.order).toEqual({ paused: false, order: [A], head: null, held: { reason: 'landing-recovery-unresolved', subjectIds: [7] } });
    expect(body.entries).toEqual([A]);
  });

  it('a real pause keeps its `by` beside the recovery hold, and no flag is invented', async () => {
    seedEntry(db, A); seedFlags(db, 'project-a', { operatorPaused: true, mainRedHold: false });
    db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (7, 'project-a', 40, 'no-run', NULL, 3)").run();
    const body = (await read(app!, '?project=project-a')).json() as LandingLineView & { ok: true };
    expect(body.order).toEqual({ paused: true, by: ['operator'], order: [A], held: { reason: 'landing-recovery-unresolved', subjectIds: [7] } });
    expect([body.operatorPaused, body.mainRedHold]).toEqual([true, false]);
  });

  it('a fenced store answers 503 landing-fenced with its remedy, and no entry', async () => {
    const home = mkTmp('ccrc-landing-fenced-');
    const dbPath = path.join(home, '.ccrc', 'coord.db');
    const coord = new CoordStore(openCoordDb(dbPath), { landingJournal: createLandingJournal(path.dirname(dbPath)) });
    const w = await openApp({ coord });
    try {
      const res = await read(w.app, '?project=project-a');
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, error: 'landing-fenced', recovery: 'replay' });
    } finally { await w.app.close(); }
  });

  it('a store with no journal port answers 503 landing-journal-unavailable', async () => {
    const home = mkTmp('ccrc-landing-noport-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const w = await openApp({ coord });
    try {
      const res = await read(w.app, '?project=project-a');
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, error: 'landing-journal-unavailable', recovery: 'restart' });
    } finally { await w.app.close(); }
  });

  it('the default read answers only the entries still in the line, and says so', async () => {
    const ent = (id: number, state: LandingEntry['state']): LandingEntry => ({ ...A, id, pr: 100 + id, state, pinnedAt: 1_000 + id });
    for (const [id, state] of [[1, 'pinned'], [2, 'ejected'], [3, 'unknown'], [4, 'landed'], [5, 'withdrawn'], [6, 'closed']] as const) {
      seedEntry(db, ent(id, state));
    }
    const body = (await read(app!, '?project=project-a')).json() as LandingLineView & { ok: true };
    expect(body.entriesScope).toBe('open');
    expect(body.entries.map((e) => e.state).sort()).toEqual(['ejected', 'pinned', 'unknown']);
    expect(body.order).toEqual(landingOrder(['pinned', 'ejected', 'unknown', 'landed', 'withdrawn', 'closed']
      .map((st, i) => ent(i + 1, st as LandingEntry['state'])), { operatorPaused: false, mainRedHold: false }));
  });

  it("?pr= answers that PR's entry in any state, beside the same flags and order", async () => {
    const landed: LandingEntry = { ...B, state: 'landed' };
    seedEntry(db, A); seedEntry(db, landed);
    const body = (await read(app!, '?project=project-a&pr=12')).json() as LandingLineView & { ok: true };
    expect(body.entriesScope).toBe('pr');
    expect(body.entries).toEqual([landed]);
    expect(body.order).toEqual(landingOrder([A, landed], { operatorPaused: false, mainRedHold: false }));
    expect(body.order).toMatchObject({ head: { id: 1, pr: 11 } });
  });

  it('?pr= naming no entry answers no entries and the lines order', async () => {
    seedEntry(db, A);
    const body = (await read(app!, '?project=project-a&pr=999')).json() as LandingLineView & { ok: true };
    expect(body.entries).toEqual([]);
    expect(body.entriesScope).toBe('pr');
    expect(body.order).toEqual(landingOrder([A], { operatorPaused: false, mainRedHold: false }));
  });

  it('?pr=0, ?pr=07, ?pr=x, ?pr=-1 and a pr past the safe range answer 400 bad-request with the pr detail', async () => {
    for (const pr of ['0', '07', 'x', '-1', '', '9007199254740993', '1.5']) {
      const res = await read(app!, `?project=project-a&pr=${pr}`);
      expect(res.statusCode, pr).toBe(400);
      expect(res.json(), pr).toEqual({ ok: false, error: 'bad-request',
        detail: 'the landing read takes ?pr= as a PR number: a positive integer with no leading zero' });
    }
  });

  it('trims the project as the ledger read does', async () => {
    seedEntry(db, A);
    expect(((await read(app!, '?project=%20project-a%20')).json() as LandingLineView).entries).toEqual([A]);
  });
});

// Wave 5i, Task 6: the binding head, computed on this read from current facts, the watcher's latest control snapshot and the
// route's own now. Routes write nothing and send nothing.
describe('GET /api/landing: the binding', () => {
  let app: FastifyInstance | undefined;
  let db: DatabaseSync;
  let coord: CoordStore;
  let snapshot: LandingControlRead | undefined;
  let H: LandingEntry;
  let NEXT: LandingEntry;
  const stubWatcher = { stop: () => undefined, serverCapsSettled: async () => {}, currentLandingControl: (project: string) => (project === 'project-a' ? snapshot : undefined) } as unknown as FleetWatcher;
  const bindingOf = async (qs = '?project=project-a') => (await read(app!, qs)).json() as LandingLineView & { ok: true };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CONTROL_NOW);
    snapshot = controlRead();
    const w = await openApp({}, stubWatcher);
    app = w.app; db = w.db; coord = w.coord;
    H = { id: 1, project: 'project-a', pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: 'd'.repeat(40), runId: openRunId(coord, 1),
      state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a-project-a', pinnedAt: 1_000 };
    NEXT = { ...H, id: 2, pr: 12, pinnedSha: 'c'.repeat(40), runId: openRunId(coord, 2), pinnedAt: 2_000 };
  });
  afterEach(async () => { vi.useRealTimers(); if (app) await app.close(); app = undefined; });

  it('a proven marker absence is inert, and no snapshot at all is held, never inert', async () => {
    seedEntry(db, H);
    snapshot = controlRead({ lander: { ok: false, reason: 'absent' } });
    expect((await bindingOf()).binding).toEqual({ mode: 'inert' });
    snapshot = undefined;
    expect((await bindingOf()).binding).toEqual({ mode: 'held', reason: 'opt-in-unknown', entryId: 1 });
  });

  it('a positive coherent opt-in with the selected head ready names its entry, PR, full pinned sha and base', async () => {
    seedEntry(db, H);
    expect((await bindingOf()).binding).toMatchObject({ mode: 'ready', entryId: 1, pr: 7, pinnedSha: CONTROL_HEAD_SHA, fixesMain: false });
  });

  it('order.head reads the stored word: a dependent head behind a damaged terminal target is the head, and behind a damaged pinned one is not', async () => {
    const raw = (id: number, pr: number, word: string) => db.prepare(
      "INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, state, setBy, pinnedAt, afterIds) VALUES (?, 'project-a', ?, ?, ?, ?, 'operator', 1, 'not-json')")
      .run(id, pr, 'f'.repeat(40), 'f'.repeat(40), word);
    raw(5, 50, 'landed');
    seedEntry(db, { ...H, afterIds: [5] });
    expect((await bindingOf()).order).toMatchObject({ paused: false, head: { id: 1, pr: 7 } });
    db.prepare("UPDATE landing_entries SET state = 'pinned' WHERE id = 5").run();
    expect((await bindingOf()).order).toMatchObject({ paused: false, head: null });
  });

  it('order.waits names a head held behind a withdrawn target, by entry id and PR (5j-a, D-9047), and is absent otherwise', async () => {
    db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, state, setBy, pinnedAt) VALUES (5, 'project-a', 50, ?, ?, 'withdrawn', 'operator', 1)")
      .run('f'.repeat(40), 'f'.repeat(40));
    seedEntry(db, { ...H, afterIds: [5] });
    const held = (await bindingOf()).order;
    expect(held).toMatchObject({ paused: false, head: null, waits: [{ entryId: 1, reason: 'withdrawn', on: [{ entryId: 5, pr: 50 }] }] });
    db.prepare("UPDATE landing_entries SET state = 'landed' WHERE id = 5").run();
    const met = (await bindingOf()).order;
    expect(met).toMatchObject({ paused: false, head: { id: 1, pr: 7 } });
    expect('waits' in met).toBe(false);
  });

  it('?pr= still returns that PR\'s entry, while readiness and order are computed over the whole project', async () => {
    seedEntry(db, H); seedEntry(db, NEXT);
    const body = await bindingOf('?project=project-a&pr=12');
    expect(body.entries.map((e) => e.pr)).toEqual([12]);
    expect(body.binding).toMatchObject({ mode: 'ready', entryId: 1, pr: 7 });
    expect(body.order).toMatchObject({ head: { id: 1 } });
  });

  it('pause, recovery, a dirty selected head and malformed evidence each hold', async () => {
    seedEntry(db, H);
    snapshot = controlRead({ lander: { ok: false, reason: 'malformed' } });
    expect((await bindingOf()).binding).toMatchObject({ mode: 'held', reason: 'opt-in-unknown' });
    const dirty = controlRead();
    if (!dirty.probe.ok) throw new Error('fixture');
    dirty.probe.doc.heads[0]!.base = { state: 'conflict', paths: ['x'], pathsCut: false } as never;
    snapshot = dirty;
    expect((await bindingOf()).binding).toMatchObject({ mode: 'held', reason: 'composition-not-clean' });
    snapshot = controlRead();
    db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (7, 'project-a', 40, 'no-run', NULL, 3)").run();
    expect((await bindingOf()).binding).toMatchObject({ mode: 'held', reason: 'recovery' });
    db.prepare('DELETE FROM landing_subjects').run();
    seedFlags(db, 'project-a', { operatorPaused: true, mainRedHold: false });
    expect((await bindingOf()).binding).toMatchObject({ mode: 'held', reason: 'paused' });
  });

  it('a stale persisted main-red hold beside a fresh green snapshot answers an UNPAUSED order and a ready binding', async () => {
    seedEntry(db, H); seedFlags(db, 'project-a', { operatorPaused: false, mainRedHold: true });
    const body = await bindingOf();
    expect(body.binding).toMatchObject({ mode: 'ready', entryId: 1 });
    expect(body.order).toMatchObject({ paused: false, head: { id: 1 } });
    expect(body.mainRedHold).toBe(false);
  });

  it('a fresh red snapshot beside an unset hold answers a main-red pause and a held binding, from one view of the hold', async () => {
    seedEntry(db, H);
    const red = controlRead();
    if (!red.health.ok) throw new Error('fixture');
    red.health.doc.state = 'red'; red.health.doc.failing = ['required-a'];
    snapshot = red;
    const body = await bindingOf();
    expect(body.order).toMatchObject({ paused: true, by: ['main-red'] });
    expect(body.binding).toMatchObject({ mode: 'held', reason: 'main-red' });
  });

  it('the read writes nothing and queues no mail', async () => {
    seedEntry(db, H); seedFlags(db, 'project-a', { operatorPaused: false, mainRedHold: true });
    const apply = vi.spyOn(coord, 'applyLandingControl');
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    await bindingOf();
    expect(apply).not.toHaveBeenCalled();
    expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(before);
    expect((db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT mainRedHold AS h FROM landing_projects').get() as { h: number }).h).toBe(1);
  });
});

// Landing order wave 5j-a (D-9048): with sign-in armed, the read takes a live session OR the box token, the `GET /api/feed`
// shape, and authenticates before `501 not-configured`. A real login gives the session; every body is read to its end.
describe('GET /api/landing with sign-in armed (5j-a, D-9048)', () => {
  const PASSPHRASE = 'correct horse battery staple';
  const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const armed = async (over: Partial<Deps> = {}): Promise<FastifyInstance> => {
    const home = mkTmp('ccrc-landing-read-armed-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST, 1)}\n`, { mode: 0o600 });
    const dbPath = path.join(home, '.ccrc', 'coord.db');
    const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
    const base = testDeps(home);
    return buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false }, mailToken: TOKEN, coord, ...over });
  };
  const login = async (a: FastifyInstance): Promise<string> => {
    const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    return line.slice(0, line.indexOf(';'));
  };

  it('a session and no token: 200', async () => {
    app = await armed();
    const res = await read(app, '?project=project-a', { cookie: await login(app) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, project: 'project-a' });
  });

  it('a token and no session: 200', async () => {
    app = await armed();
    const res = await read(app, '?project=project-a', tok);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, project: 'project-a' });
  });

  it('neither: 401 with the gate verdict, before 501 when coordination is absent', async () => {
    for (const over of [{}, { coord: undefined }] as Partial<Deps>[]) {
      app = await armed(over);
      const res = await read(app, '?project=project-a', {});
      expect(res.statusCode, res.body).toBe(401);
      const body = res.json() as Record<string, unknown>;
      expect(body).toMatchObject({ ok: false, error: 'unauthenticated' });
      expect(typeof body.verdict).toBe('string');
      expect(body.detail).toBe('GET /api/landing takes a session cookie OR the box token (x-ccrc-mail-token); ccrc-api reads it cookieless from the fleet host');
      await app.close(); app = undefined;
    }
  });

  it('a wrong token and no session: 401', async () => {
    app = await armed();
    const res = await read(app, '?project=project-a', { 'x-ccrc-mail-token': 'e'.repeat(64) });
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });
});
