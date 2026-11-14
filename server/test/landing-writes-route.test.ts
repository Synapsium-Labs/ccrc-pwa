// Landing order wave 5f, Task 2: `POST /api/landing/entries` and `POST /api/landing/order` over the real store, the real
// journal adapter and the real server. Fixture HOME, database and journal directory only; the box token is a test
// constant; the registry is a fixture directory. A fault is a fixture port that fails the next append.
import { describe, it, expect, afterEach } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import type { LandingJournalPort } from '../src/coord/landingJournalPort.js';
import type { LandingAdvance } from '../src/coord/landingEntry.js';
import type { CcdResult } from '../src/lifecycle.js';
import { LANDING_REFUSAL_STATUS } from '../../shared/refusal.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { seedLegacyProgramme } from './helpers/plan.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const P = 'project-a';
const HEAD = 'a'.repeat(40);
const HC = 'c'.repeat(40);
const WHO = {
  'lane-a': 'a'.repeat(36), 'lane-b': 'b'.repeat(36), 'coord-a': 'c'.repeat(36),
} as const;
type Who = keyof typeof WHO;
const id = (who: Who): { byId: string; byUuid: string } => ({ byId: who, byUuid: WHO[who] });

interface Faults { append: null | 'durability' }
interface World {
  home: string; dir: string; dbPath: string; db: DatabaseSync; store: CoordStore; app: FastifyInstance;
  faults: Faults; log: NotifyLog; ioCalls: { n: number }; journal: () => string;
}
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  removeTmpFixtures();
});

const seedRegistry = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [who, uuid] of Object.entries(WHO)) {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${who}`, uuid, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${who}.${k}`), v);
  }
};

const portOver = (inner: LandingJournalPort, faults: Faults): LandingJournalPort => ({
  read: () => inner.read(),
  confirmDurable: (s) => inner.confirmDurable(s),
  append: (s, r) => {
    if (faults.append !== null) { const error = faults.append; faults.append = null; return { ok: false, error, mayApply: true }; }
    return inner.append(s, r);
  },
});

interface Opts { home?: string; port?: boolean; io?: (inner: FleetIO, calls: { n: number }) => FleetIO; over?: Partial<Deps> }
const world = async (o: Opts = {}): Promise<World> => {
  const home = o.home ?? mkTmp('ccrc-lwr-');
  const dir = path.join(home, '.ccrc');
  const dbPath = path.join(dir, 'coord.db');
  const db = openCoordDb(dbPath);
  const faults: Faults = { append: null };
  const store = o.port === false ? new CoordStore(db)
    : new CoordStore(db, { landingJournal: portOver(createLandingJournal(dir), faults), onUnusableConnection: (): never => { throw new Error('fixture fail-stop'); } });
  if (o.port !== false) { const r = store.replayLandingJournal(); if (!r.ok) throw new Error(`fixture replay refused: ${r.error}`); }
  seedRegistry(home);
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const ioCalls = { n: 0 };
  const base = testDeps(home);
  const io = o.io === undefined ? base.io : o.io(base.io, ioCalls);
  const app = await buildServer({ ...base, io, mailToken: TOKEN, coord: store, notifyLog: log, ...o.over });
  closers.push(() => app.close());
  const journal = (): string => { try { return readFileSync(path.join(dir, 'landing.log'), 'utf8'); } catch { return ''; } };
  return { home, dir, dbPath, db, store, app, faults, log, ioCalls, journal };
};
/** Counts every call a server makes through the fleet IO after `ioCalls.n` is zeroed. */
const counting = (inner: FleetIO, calls: { n: number }): FleetIO =>
  new Proxy(inner, { get: (t, k) => { const v = (t as unknown as Record<string | symbol, unknown>)[k]; return typeof v === 'function' ? (...a: unknown[]) => { calls.n++; return (v as (...x: unknown[]) => unknown)(...a); } : v; } });

const post = (w: World, route: 'entries' | 'order', body: unknown, headers: Record<string, string> = tok) =>
  w.app.inject({ method: 'POST', url: `/api/landing/${route}`, headers, payload: body as object });
const entryBody = (who: Who, pr: number, over: Record<string, unknown> = {}) =>
  ({ ...id(who), project: P, pr, pinnedSha: HEAD, handoffCommit: HC, ...over });
const orderBody = (who: Who, pr: number, patch: { afterIds?: number[]; fixesMain?: boolean }) => ({ ...id(who), project: P, pr, ...patch });
const create = async (w: World, pr: number, who: Who = 'lane-a'): Promise<number> => {
  const r = await post(w, 'entries', entryBody(who, pr));
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as { entry: { id: number } }).entry.id;
};
const line = async (w: World): Promise<{ entries: Array<{ id: number; pr: number; afterIds: number[]; fixesMain: boolean; setBy: string; runId: number | null }> }> =>
  (await w.app.inject({ method: 'GET', url: `/api/landing?project=${P}`, headers: tok })).json();
const lines = (w: World): Record<string, unknown>[] => w.journal().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const feed = (w: World) => w.store.feedEvents(100);

const openRun = (w: World, claimedBy: string, wave = 1): number => {
  const o = w.store.openRun({ program: `prog-${wave}`, title: 't', project: P, wave, waveOf: 9, claimedBy });
  if (!('id' in o)) throw new Error('fixture openRun refused');
  w.store.setSession(o.id, `ws${wave}`);
  for (const to of ['dispatched', 'working', 'awaiting-review'] as const) {
    if (!w.store.advance(o.id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
  }
  return o.id;
};
const pin = (w: World, runId: number, pr: number) => {
  const landing: LandingAdvance = { kind: 'pin', head: HEAD, pr, mode: 'off', handoffCommit: HC };
  const r = w.store.advanceLanding({ runId, to: 'merging', causedBy: 'coordinator', landing });
  if (!r.ok) throw new Error(`fixture pin refused: ${r.error}`);
};
/** A run-bound entry: the run is claimed by `claimedBy`, the entry pinned by it. */
const runBound = (w: World, pr: number, claimedBy: string, wave = 1): { runId: number; entryId: number } => {
  const runId = openRun(w, claimedBy, wave);
  pin(w, runId, pr);
  const entryId = (w.db.prepare('SELECT id FROM landing_entries WHERE project = ? AND pr = ?').get(P, pr) as { id: number }).id;
  return { runId, entryId };
};

describe('token before attribution', () => {
  for (const route of ['entries', 'order'] as const) {
    it(`${route}-token-before-attribution`, async () => {
      const w = await world({ io: counting });
      w.ioCalls.n = 0;
      const body = route === 'entries' ? entryBody('lane-a', 11) : orderBody('lane-a', 11, { afterIds: [] });
      for (const headers of [{}, { 'x-ccrc-mail-token': 'not-the-box-token' }] as Array<Record<string, string>>) {
        const res = await post(w, route, body, headers);
        expect(res.statusCode, JSON.stringify(headers)).toBe(401);
        expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
      }
      expect(w.ioCalls.n, 'a refused token reached the registry').toBe(0);
      expect(w.journal()).toBe('');
    });
  }

  it('token with no cookie is answered by the route; a cookie with no token is not', async () => {
    const w = await world();
    const ok = await post(w, 'entries', entryBody('lane-a', 11));
    expect(ok.statusCode).toBe(200);
    const cookieOnly = await post(w, 'entries', entryBody('lane-a', 12), { cookie: 'ccrc_session=anything' });
    expect(cookieOnly.statusCode).toBe(401);
    expect(lines(w)).toHaveLength(1);
  });
});

describe('measured attribution', () => {
  it('entries-reuses-measured-attribution', async () => {
    const w = await world();
    const stale = await post(w, 'entries', { ...entryBody('lane-a', 11), byUuid: 'z'.repeat(36) });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ ok: false, error: 'stale-uuid' });
    expect(w.journal()).toBe('');
  });
  it('order-reuses-measured-attribution', async () => {
    const w = await world();
    await create(w, 11);
    const before = w.journal();
    const ghost = await post(w, 'order', { byId: 'lane-ghost', byUuid: 'g'.repeat(36), project: P, pr: 11, afterIds: [] });
    expect(ghost.statusCode).toBe(403);
    expect(ghost.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
    expect(w.journal()).toBe(before);
  });
  it('an unmeasurable registry is 502 and writes nothing', async () => {
    const w = await world({ io: (inner) => ({ ...inner, readdir: async () => null }) });
    for (const [route, body] of [['entries', entryBody('lane-a', 11)], ['order', orderBody('lane-a', 11, { afterIds: [] })]] as const) {
      const res = await post(w, route, body);
      expect(res.statusCode, route).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    }
    expect(w.journal()).toBe('');
  });
  it('a malformed body is 400 bad-request before any registry read', async () => {
    const w = await world({ io: counting });
    w.ioCalls.n = 0;
    for (const body of [{}, { ...entryBody('lane-a', 11), setBy: 'lane-b' }, { ...entryBody('lane-a', 11), pr: 0 }]) {
      const res = await post(w, 'entries', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    const empty = await post(w, 'order', { ...id('lane-a'), project: P, pr: 11 });
    expect(empty.statusCode).toBe(400);
    expect(w.ioCalls.n).toBe(0);
  });
});

describe('not configured', () => {
  it('no coordination database is 501 not-configured on both routes', async () => {
    const w = await world({ over: { coord: undefined } });
    for (const route of ['entries', 'order'] as const) {
      const res = await post(w, route, route === 'entries' ? entryBody('lane-a', 11) : orderBody('lane-a', 11, { fixesMain: true }));
      expect(res.statusCode, route).toBe(501);
      expect(res.json()).toMatchObject({ ok: false, error: 'not-configured' });
    }
  });
  it('a store with no journal port is landing-journal-unavailable, restart, with nothing written', async () => {
    const w = await world({ port: false });
    for (const route of ['entries', 'order'] as const) {
      const res = await post(w, route, route === 'entries' ? entryBody('lane-a', 11) : orderBody('lane-a', 11, { fixesMain: true }));
      expect(res.statusCode, route).toBe(503);
      expect(res.json()).toMatchObject({ ok: false, error: 'landing-journal-unavailable', recovery: 'restart' });
    }
    expect(feed(w)).toEqual([]);
  });
});

describe('creation', () => {
  it('records the entry with the attributed setter, the real journal line and the projection', async () => {
    const w = await world();
    const res = await post(w, 'entries', entryBody('lane-b', 11));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; entry: Record<string, unknown>; previous: unknown; changed: boolean; seq: number };
    expect(body).toMatchObject({ ok: true, previous: null, changed: true, seq: 1 });
    expect(body.entry).toMatchObject({ project: P, pr: 11, pinnedSha: HEAD, handoffCommit: HC, runId: null, afterIds: [], fixesMain: false, setBy: 'lane-b' });
    expect(body).not.toHaveProperty('coordinator');
    const recs = lines(w);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ v: 1, seq: 1, setBy: 'lane-b', kind: 'entry', claim: { pinnedSha: HEAD, handoffCommit: HC },
      subject: { id: body.entry.id, project: P, pr: 11, binding: { kind: 'no-run' } } });
    expect((await line(w)).entries).toHaveLength(1);
    expect(feed(w), 'a creation owes no notice').toEqual([]);
  });
  it('entry-refuses-materialized-duplicate', async () => {
    const w = await world();
    runBound(w, 11, 'coord-a');
    const before = w.journal();
    const res = await post(w, 'entries', entryBody('lane-a', 11));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'landing-entry-exists' });
    expect(w.journal()).toBe(before);
  });
  it('entry-refuses-recovered-duplicate', async () => {
    const w = await world();
    w.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const snap = path.join(w.home, 'before.db');
    copyFileSync(w.dbPath, snap);
    await create(w, 11);
    const journal = w.journal();
    await w.app.close();
    w.db.close();
    for (const ext of ['-wal', '-shm']) rmSync(w.dbPath + ext, { force: true });
    copyFileSync(snap, w.dbPath);
    const w2 = await world({ home: w.home });
    expect((await line(w2)).entries, 'the projection is not fabricated').toEqual([]);
    const res = await post(w2, 'entries', entryBody('lane-a', 11));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'landing-entry-exists' });
    expect(w2.journal()).toBe(journal);
  });
});

describe('order', () => {
  it('records afterIds and fixesMain by the attributed setter', async () => {
    const w = await world();
    const a = await create(w, 11); const b = await create(w, 12);
    const res = await post(w, 'order', orderBody('lane-b', 12, { afterIds: [a], fixesMain: true }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, seq: 3, entry: { id: b, afterIds: [a], fixesMain: true, setBy: 'lane-b' },
      previous: { afterIds: [], fixesMain: false, setBy: 'lane-a' } });
    expect(lines(w)[2]).toMatchObject({ seq: 3, setBy: 'lane-b', kind: 'order', fixesMain: true, subject: { id: b, pr: 12 },
      after: [{ id: a, project: P, pr: 11, binding: { kind: 'no-run' } }] });
  });
  it('foreign-setter-is-recorded', async () => {
    // the entry's run is claimed by coord-a; the order is attributed to lane-b, so the setter is the writer, never the claimant
    const w = await world();
    const { entryId } = runBound(w, 11, 'coord-a');
    const res = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, entry: { id: entryId, setBy: 'lane-b' } });
    const last = lines(w).at(-1)!;
    expect(last).toMatchObject({ kind: 'order', setBy: 'lane-b' });
    expect(last.setBy).not.toBe('coord-a');
    expect(w.db.prepare('SELECT setBy FROM landing_authority WHERE subjectId = ?').get(entryId)).toEqual({ setBy: 'lane-b' });
    expect((await line(w)).entries[0]).toMatchObject({ id: entryId, setBy: 'lane-b', fixesMain: true });
  });
  const clearedAndReplayed = async (patchSet: { afterIds?: number[]; fixesMain?: boolean }, patchClear: { afterIds?: number[]; fixesMain?: boolean }) => {
    const w = await world();
    const a = await create(w, 11); await create(w, 12);
    w.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const snap = path.join(w.home, 'ordered.db');
    copyFileSync(w.dbPath, snap);
    const set = await post(w, 'order', orderBody('lane-b', 12, patchSet.afterIds === undefined ? patchSet : { afterIds: [a] }));
    expect(set.statusCode, set.body).toBe(200);
    const clear = await post(w, 'order', orderBody('lane-b', 12, patchClear));
    expect(clear.statusCode, clear.body).toBe(200);
    expect(clear.json()).toMatchObject({ ok: true, changed: true });
    await w.app.close();
    w.db.close();
    for (const ext of ['-wal', '-shm']) rmSync(w.dbPath + ext, { force: true });
    copyFileSync(snap, w.dbPath);
    const w2 = await world({ home: w.home });
    return { cleared: clear.json() as { entry: { afterIds: number[]; fixesMain: boolean } }, replayed: (await line(w2)).entries.find((e) => e.pr === 12)! };
  };
  it('clears-after-array', async () => {
    const { cleared, replayed } = await clearedAndReplayed({ afterIds: [1] }, { afterIds: [] });
    expect(cleared.entry.afterIds).toEqual([]);
    expect(replayed.afterIds, 'the explicit [] is recorded and replayed').toEqual([]);
  });
  it('clears-fixes-flag', async () => {
    const { cleared, replayed } = await clearedAndReplayed({ fixesMain: true }, { fixesMain: false });
    expect(cleared.entry.fixesMain).toBe(false);
    expect(replayed.fixesMain, 'the explicit false is recorded and replayed').toBe(false);
  });
  it('policy-refusal-before-append', async () => {
    const w = await world();
    const a = await create(w, 11);
    const before = w.journal();
    const rows = (): unknown => w.db.prepare('SELECT * FROM landing_entries ORDER BY id').all();
    const projBefore = JSON.stringify(rows());
    const events = feed(w).length;
    const cases: Array<[number, { afterIds?: number[]; fixesMain?: boolean }, string, number]> = [
      [99, { fixesMain: true }, 'landing-entry-missing', 404],
      [11, { afterIds: [999] }, 'landing-after-missing', 409],
      [11, { afterIds: [a] }, 'landing-cycle', 409],
    ];
    for (const [pr, patch, error, status] of cases) {
      const res = await post(w, 'order', orderBody('lane-b', pr, patch));
      expect(res.statusCode, error).toBe(status);
      expect(res.json()).toMatchObject({ ok: false, error });
      expect(res.json()).not.toHaveProperty('mayApply');
    }
    expect(w.journal()).toBe(before);
    expect(JSON.stringify(rows())).toBe(projBefore);
    expect(feed(w)).toHaveLength(events);
  });
  it('missing-current-run-refuses', async () => {
    const w = await world();
    const { runId } = runBound(w, 11, 'coord-a');
    const before = w.journal();
    w.db.exec('PRAGMA foreign_keys = OFF');
    w.db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    const res = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'run-unreadable' });
    expect(w.journal()).toBe(before);
    expect(feed(w)).toEqual([]);
  });
  it('unreadable-current-run-refuses', async () => {
    const w = await world();
    const { runId } = runBound(w, 11, 'coord-a');
    const before = w.journal();
    w.db.prepare("UPDATE runs SET claimedBy = x'ff' WHERE id = ?").run(runId);
    const res = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'run-unreadable' });
    expect(w.journal()).toBe(before);
    expect(feed(w)).toEqual([]);
  });
});

describe('the inversion notice', () => {
  it('foreign-setter-named-in-inversion', async () => {
    const w = await world();
    const { runId, entryId } = runBound(w, 11, 'coord-a');
    const dep = await create(w, 12);
    const res = await post(w, 'order', orderBody('lane-b', 11, { afterIds: [dep], fixesMain: true }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ entry: { id: entryId } });
    const events = feed(w);
    expect(events).toHaveLength(1);
    const { seq: _s, at: _a, ...rest } = events[0]!;
    expect(rest).toEqual({ kind: 'coord', sessionId: 'lane-b', title: `landing-inversion: ${P} #11`,
      body: `lane-b set ${P} #11 afterIds=[${dep}], fixesMain=true`, runId });
  });
  it('coordinator-order-does-not-notify', async () => {
    const w = await world();
    runBound(w, 11, 'coord-a');
    const dep = await create(w, 12);
    const res = await post(w, 'order', orderBody('coord-a', 11, { afterIds: [dep] }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ changed: true });
    expect(feed(w)).toEqual([]);
  });
  it('unchanged-order-does-not-notify', async () => {
    const w = await world();
    await create(w, 11);
    const first = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(first.json()).toMatchObject({ changed: true });
    const events = feed(w).length;
    const lineCount = lines(w).length;
    const again = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ ok: true, changed: false, seq: null });
    expect(feed(w)).toHaveLength(events);
    expect(lines(w)).toHaveLength(lineCount);
  });
  it('clear-order-notifies', async () => {
    const w = await world();
    const a = await create(w, 11); await create(w, 12);
    await post(w, 'order', orderBody('lane-b', 12, { afterIds: [a] }));
    const before = feed(w).length;
    const res = await post(w, 'order', orderBody('lane-b', 12, { afterIds: [] }));
    expect(res.json()).toMatchObject({ changed: true });
    const events = feed(w);
    expect(events).toHaveLength(before + 1);
    expect(events[events.length - 1]).toMatchObject({ kind: 'coord', body: `lane-b set ${P} #12 afterIds=[], fixesMain=false` });
  });
  it('no-run-order-notifies', async () => {
    const w = await world();
    await create(w, 11);
    await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(feed(w)).toEqual([expect.objectContaining({ kind: 'coord', sessionId: 'lane-b', runId: null, title: `landing-inversion: ${P} #11` })]);
  });
  it('unclaimed-run-order-notifies', async () => {
    const w = await world();
    const { runId } = runBound(w, 11, 'coord-a');
    w.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(runId);
    const res = await post(w, 'order', orderBody('coord-a', 11, { fixesMain: true }));
    expect(res.statusCode, res.body).toBe(200);
    expect(feed(w)).toEqual([expect.objectContaining({ sessionId: 'coord-a', runId })]);
  });
  it('the notice reaches the real feed catch-up and the archive, record-only', async () => {
    const w = await world();
    await create(w, 11);
    const epoch = w.log.epoch;
    await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    const res = await w.app.inject({ method: 'GET', url: `/api/notifications/catchup?epoch=${epoch}&seq=0` });
    const got = res.json() as { resync: boolean; events: Array<{ kind: string; sessionId: string; title: string; runId: number | null }> };
    expect(got.resync).toBe(false);
    expect(got.events).toEqual([expect.objectContaining({ kind: 'coord', sessionId: 'lane-b', title: `landing-inversion: ${P} #11`, runId: null })]);
    expect(feed(w)).toHaveLength(1);
  });
});

describe('uncertainty', () => {
  it('uncertainty-crosses-http', async () => {
    const w = await world();
    await create(w, 11);
    w.faults.append = 'durability';
    const res = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'landing-journal-append', mayApply: true, recovery: 'replay' });
    // the fence holds every later write and read until replay
    const next = await post(w, 'order', orderBody('lane-b', 11, { fixesMain: false }));
    expect(next.statusCode).toBe(503);
    expect(next.json()).toMatchObject({ ok: false, error: 'landing-fenced' });
  });
  it('failed-writes-never-notify', async () => {
    const w = await world();
    await create(w, 11);
    w.faults.append = 'durability';
    await post(w, 'order', orderBody('lane-b', 11, { fixesMain: true }));
    expect(feed(w)).toEqual([]);
    expect(w.log.seq).toBe(0);
  });
});

describe('serialisation', () => {
  it('write-serial-with-advance', async () => {
    // A real holder of `coordMutex`: `POST /api/runs` with a session awaits `deps.runCcd` inside the lock, so a runner that
    // signals on entry and then waits keeps the lock across a real await. The landing write is queued behind it; while it
    // waits, an advance gives the entry its current run, and the write's facts must be read after the holder releases.
    let signalHeld: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { signalHeld = resolve; });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runCcd = async (): Promise<CcdResult> => {
      signalHeld();
      await gate;
      return { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null };
    };
    const w = await world({ over: { runCcd } });
    for (const [k, v] of Object.entries({ workspace: 'lane-a', branch: 'ws/lane-a', base: 'origin/main' })) {
      writeFileSync(path.join(w.home, '.cc-sessions', `lane-a.${k}`), v);
    }
    await create(w, 11);
    const runId = openRun(w, 'coord-a');
    seedLegacyProgramme(w.store.db, 'holder', 'demo');
    const opening = w.app.inject({ method: 'POST', url: '/api/runs', headers: tok,
      payload: { program: 'holder', title: 'H', project: 'demo', wave: 1, waveOf: 8, claimedBy: 'lane-a', claimedByUuid: WHO['lane-a'],
        sessionId: 'holder-worker', homeProject: 'demo' } });
    // premise 1: the holder reached the hold (it fails fast, not by a timeout, when it answered without reaching it)
    const brokenPremise = opening.then((r) => { throw new Error(`POST /api/runs answered ${r.statusCode} without reaching the hold: ${r.body}`); });
    brokenPremise.catch(() => undefined);
    await Promise.race([held, brokenPremise]);

    const bytesBefore = w.journal();
    const settled: number[] = [];
    const write = post(w, 'order', orderBody('lane-b', 11, { fixesMain: true })).then((r) => { settled.push(r.statusCode); return r; });
    // premise 2: the lock is held, measured: a write that can finish while the hold is in flight was not queued behind it
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(settled, 'the landing write finished while another route held the coordination mutex').toEqual([]);
    expect(w.journal(), 'the landing write appended while the mutex was held').toBe(bytesBefore);

    // the advance lands while the write waits; the write has read nothing of the store yet
    pin(w, runId, 11);
    release();
    const [openRes, res] = await Promise.all([opening, write]);
    expect(openRes.statusCode, openRes.body).toBe(200);
    expect(res.statusCode, res.body).toBe(200);
    expect(feed(w)).toEqual([expect.objectContaining({ sessionId: 'lane-b', runId })]);
    expect(lines(w).at(-1)).toMatchObject({ kind: 'order', subject: { binding: { kind: 'run', observedRunId: runId } } });
  });
});

describe('typed write failures reach HTTP with their status and word', () => {
  const Q = 'project-b';
  const rawProjection = (w: World, rowId: number, pr: number, project: string): void => {
    w.db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, ?, ?, ?, ?, NULL, 'pinned', 'operator', 1)")
      .run(rowId, project, pr, HEAD, HC);
  };
  const restoredFromBefore = async (w: World, build: () => Promise<void>): Promise<World> => {
    w.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const snap = path.join(w.home, 'restore-point.db');
    copyFileSync(w.dbPath, snap);
    await build();
    await w.app.close();
    w.db.close();
    for (const ext of ['-wal', '-shm']) rmSync(w.dbPath + ext, { force: true });
    copyFileSync(snap, w.dbPath);
    return world({ home: w.home });
  };
  /** The answer is the word, its LANDING_REFUSAL_STATUS status, and nothing the result did not carry. */
  const refused = (res: { statusCode: number; json: () => unknown }, error: keyof typeof LANDING_REFUSAL_STATUS, extra: Record<string, unknown> = {}): void => {
    expect(res.statusCode, error).toBe(LANDING_REFUSAL_STATUS[error]);
    expect(res.json()).toMatchObject({ ok: false, error, ...extra });
    for (const k of ['mayApply', 'recovery']) if (!(k in extra)) expect(res.json(), `${error} grew a ${k}`).not.toHaveProperty(k);
  };

  it('landing-after-cross-project is 409 and appends nothing', async () => {
    const w = await world();
    await create(w, 11);
    const other = (await post(w, 'entries', { ...entryBody('lane-a', 5), project: Q })).json() as { entry: { id: number } };
    const before = w.journal();
    refused(await post(w, 'order', orderBody('lane-b', 11, { afterIds: [other.entry.id] })), 'landing-after-cross-project');
    expect(w.journal()).toBe(before);
  });

  it('landing-recovery-unresolved is 409 for an order on a recovered subject and for a new entry', async () => {
    const w = await world();
    const w2 = await restoredFromBefore(w, async () => { await create(w, 11); await create(w, 12); });
    const bytes = w2.journal();
    expect((await line(w2)).entries, 'the projection is not fabricated').toEqual([]);
    refused(await post(w2, 'order', orderBody('lane-b', 11, { afterIds: [] })), 'landing-recovery-unresolved');
    refused(await post(w2, 'entries', entryBody('lane-a', 99)), 'landing-recovery-unresolved');
    expect(w2.journal()).toBe(bytes);
  });

  it('landing-identity-conflict is 409 for a creation while the project holds a conflicting projection', async () => {
    const w = await world();
    let subject = 0;
    const w2 = await restoredFromBefore(w, async () => { subject = await create(w, 11); });
    rawProjection(w2, subject, 5, Q);
    const bytes = w2.journal();
    refused(await post(w2, 'entries', entryBody('lane-a', 99)), 'landing-identity-conflict');
    refused(await post(w2, 'order', orderBody('lane-b', 11, { afterIds: [] })), 'landing-identity-conflict');
    expect(w2.journal()).toBe(bytes);
  });

  it('landing-dependencies-unreadable is 503 when the walk reaches a row whose stored edges cannot be read', async () => {
    const w = await world();
    await create(w, 11);
    rawProjection(w, 50, 12, P);
    w.db.prepare("UPDATE landing_entries SET afterIds = 'nope' WHERE id = 50").run();
    const before = w.journal();
    refused(await post(w, 'order', orderBody('lane-b', 11, { afterIds: [50] })), 'landing-dependencies-unreadable');
    expect(w.journal()).toBe(before);
  });

  it('a stored afterIds with a duplicate id is unreadable, so an order keeping it refuses and appends nothing', async () => {
    // Copying such a list into the journal would append a line (`after` is duplicate-free) that the next read of the
    // history refuses, fencing the line and refusing the next boot.
    const w = await world();
    rawProjection(w, 4, 2, P);
    rawProjection(w, 5, 3, P);
    w.db.prepare("UPDATE landing_entries SET afterIds = '[4,4]' WHERE id = 5").run();
    const before = w.journal();
    refused(await post(w, 'order', orderBody('lane-b', 3, { fixesMain: true })), 'landing-projection-unreadable', { recovery: 'restart' });
    expect(w.journal()).toBe(before);
  });

  it('landing-id-overflow is 409 when the allocator has no safe id left', async () => {
    const w = await world();
    rawProjection(w, Number.MAX_SAFE_INTEGER, 1, P);
    refused(await post(w, 'entries', entryBody('lane-a', 2)), 'landing-id-overflow');
    expect(w.journal()).toBe('');
  });

  it('landing-projection-unreadable is 503 and keeps its restart recovery on the wire', async () => {
    const w = await world();
    rawProjection(w, 5, 3, P);
    w.db.exec('UPDATE landing_entries SET fixesMain = 7 WHERE id = 5');
    const before = w.journal();
    refused(await post(w, 'order', orderBody('lane-b', 3, { afterIds: [] })), 'landing-projection-unreadable', { recovery: 'restart' });
    expect(w.journal()).toBe(before);
    expect(feed(w)).toEqual([]);
  });
});
