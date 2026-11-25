// Landing order wave 5j-b, Task 10: the operator's doors may pause or remove, never choose, reorder or bring forward
// (spec §4: "the session-gated landing routes can pause or remove, never choose a successor"; decision 3a, D-9047). Over the
// real store, journal and server, sign-in dark. Every landing table is read before and after each door, and the line's order
// is computed with the one order owner (`landingOrder`) from the stored rows alone: no door wrote it.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import { landingOrder } from '../src/coord/landingLine.js';
import type { LandingOrder } from '../../shared/landingLine.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { landingFactsOf } from './landingFixture.js';
import { sourceOfSymbol } from './scan/symbols.js';

const P = 'project-a';
const SHA = 'a'.repeat(40);
const HC = 'c'.repeat(40);
// Every landing table (review run 3864's F5 ruling added landing_intents, the run-keyed landing holds, which no door writes).
const TABLES = [
  'landing_entries', 'landing_projects', 'landing_subjects', 'landing_authority', 'landing_projection_witness', 'landing_journal_cursor',
  'landing_intents',
] as const;
const KEY: Record<(typeof TABLES)[number], readonly string[]> = {
  landing_entries: ['id'], landing_projects: ['project'], landing_subjects: ['id'], landing_authority: ['subjectId'],
  landing_projection_witness: ['entryId'], landing_journal_cursor: ['id'], landing_intents: ['runId', 'key'],
};

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  removeTmpFixtures();
});

type Form = 'run-bound' | 'run-less';
/** The fixture line: A the head, B after A, C after B, D (fixesMain) after B, E ejected, F a quarantined unknown row. */
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
type Name = (typeof NAMES)[number];
interface World { db: DatabaseSync; store: CoordStore; app: FastifyInstance; journal: () => string; ids: Record<Name, number>; runs: Partial<Record<Name, number>> }

const world = async (form: Form): Promise<World> => {
  const home = mkTmp('ccrc-landing-subtractive-');
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const store = new CoordStore(db, { landingJournal: createLandingJournal(dir) });
  const replay = store.replayLandingJournal();
  if (!replay.ok) throw new Error(`fixture replay refused: ${replay.error}`);
  const ids = {} as Record<Name, number>;
  const runs: Partial<Record<Name, number>> = {};
  NAMES.forEach((n, i) => {
    const pr = i + 1;
    if (form === 'run-less') {
      const r = store.writeLandingAuthority({ kind: 'entry', project: P, pr, pinnedSha: SHA, handoffCommit: HC, setBy: `creator-${n.toLowerCase()}` }, 1000 + pr);
      if (!r.ok) throw new Error('fixture entry refused');
      ids[n] = r.entry.id;
      return;
    }
    const o = store.openRun({ program: `prog-${n.toLowerCase()}`, title: 't', project: P, wave: 1, waveOf: null, claimedBy: `coord-${n.toLowerCase()}` });
    if (!('id' in o)) throw new Error('fixture openRun refused');
    runs[n] = o.id;
    ids[n] = 100 + pr;
    db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, ?, ?, ?, ?, ?, 'pinned', ?, ?)")
      .run(ids[n], P, pr, SHA, HC, o.id, `coord-${n.toLowerCase()}`, 1000 + pr);
  });
  const edge = (n: Name, after: Name[], fixesMain = false): void => {
    if (form === 'run-less') {
      const r = store.writeLandingAuthority({ kind: 'order', project: P, pr: NAMES.indexOf(n) + 1, afterIds: after.map((a) => ids[a]), fixesMain, setBy: 'lane-a' }, 2000);
      if (!r.ok) throw new Error(`fixture order refused: ${r.error}`);
    } else {
      db.prepare('UPDATE landing_entries SET afterIds = ?, fixesMain = ? WHERE id = ?').run(JSON.stringify(after.map((a) => ids[a])), fixesMain ? 1 : 0, ids[n]);
    }
  };
  edge('B', ['A']);
  edge('C', ['B']);
  edge('D', ['B'], true);
  db.prepare("UPDATE landing_entries SET state = 'ejected', ejections = 1 WHERE id = ?").run(ids.E);
  db.prepare("UPDATE landing_entries SET state = 'unknown', quarantineKind = 'stale-episode-head' WHERE id = ?").run(ids.F);
  // A landing hold of the project's own, so an empty landing_intents cannot pass for an unchanged one.
  const held = store.openRun({ program: 'prog-held', title: 't', project: P, wave: 1, waveOf: null, claimedBy: 'coord-held' });
  if (!('id' in held)) throw new Error('fixture openRun refused');
  db.prepare('INSERT INTO landing_intents (runId, project, key, setBy, takenAt) VALUES (?, ?, ?, ?, ?)').run(held.id, P, 'path:held.ts', 'coord-held', 3000);
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const base = testDeps(home);
  const app = await buildServer({ ...base, notifyLog: log, coord: store });
  closers.push(() => app.close());
  const journal = (): string => { try { return readFileSync(path.join(dir, 'landing.log'), 'utf8'); } catch { return ''; } };
  return { db, store, app, journal, ids, runs };
};

/** Every row of every landing table, keyed by its table's key. */
const snapshot = (w: World): Record<string, Record<string, Record<string, unknown>>> =>
  Object.fromEntries(TABLES.map((t) => [t, Object.fromEntries((w.db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[])
    .map((r) => [KEY[t].map((c) => String(r[c])).join('/'), r]))]));
/** Each changed cell, as `table key column`. */
const diff = (a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>): string[] => {
  const out: string[] = [];
  for (const t of TABLES) {
    for (const k of new Set([...Object.keys(a[t]!), ...Object.keys(b[t]!)])) {
      const x = a[t]![k]; const y = b[t]![k];
      if (x === undefined || y === undefined) { out.push(`${t} ${k} ${x === undefined ? 'inserted' : 'deleted'}`); continue; }
      for (const c of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[c]) !== JSON.stringify(y[c])) out.push(`${t} ${k} ${c}`);
    }
  }
  return out.sort();
};
const records = (w: World): Record<string, unknown>[] => w.journal().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const orderOf = (w: World): LandingOrder => { const f = landingFactsOf(w.store, P); return landingOrder(f.entries, f.flags, f.recovery, f.stateWords); };
const headOf = (o: LandingOrder): number | null => (o.paused ? null : o.head?.id ?? null);
const pinOf = (w: World, n: Name): number => landingFactsOf(w.store, P).entries.find((e) => e.id === w.ids[n])!.pinnedAt;
const withdraw = (w: World, n: Name) =>
  w.app.inject({ method: 'POST', url: '/api/landing/withdraw', payload: { project: P, pr: NAMES.indexOf(n) + 1, pinnedAt: pinOf(w, n) } });
const pause = (w: World, paused: boolean) => w.app.inject({ method: 'POST', url: '/api/landing/pause', payload: { project: P, paused } });
const heldMail = (w: World): { toId: string; subject: string }[] =>
  w.db.prepare("SELECT toId, subject FROM mail WHERE subject LIKE 'landing-held:%' ORDER BY id").all() as { toId: string; subject: string }[];

describe.each(['run-bound', 'run-less'] as const)('the withdraw door is subtractive only (%s)', (form) => {
  it.each(['A', 'B', 'C', 'D', 'E', 'F'] as const)('withdrawing %s changes only its own state, detail and marker, its subject row and the cursor', async (x) => {
    const w = await world(form);
    const before = snapshot(w);
    expect(Object.keys(before.landing_intents!)).toHaveLength(1);
    const recs = records(w).length;
    const res = await withdraw(w, x);
    expect(res.statusCode, res.body).toBe(200);
    const id = String(w.ids[x]);
    const changed = diff(before, snapshot(w)).filter((d) => !d.startsWith(`landing_subjects ${id} `) && d !== `landing_subjects ${id} inserted`);
    const allowed = [`landing_entries ${id} state`, `landing_entries ${id} detail`, `landing_entries ${id} quarantineKind`, 'landing_journal_cursor 1 appliedSeq'];
    expect(changed.filter((d) => !allowed.includes(d)), changed.join('\n')).toEqual([]);
    expect(changed).toContain(`landing_entries ${id} state`);
    expect(records(w)).toHaveLength(recs + 1);
    expect(records(w).at(-1)).toMatchObject({ kind: 'withdraw', subject: { id: w.ids[x] } });
    for (const k of ['head', 'next', 'order', 'successor']) expect(Object.keys(res.json() as object), k).not.toContain(k);
  });
});

describe.each(['run-bound', 'run-less'] as const)('the pause door is subtractive only (%s)', (form) => {
  it('a pause, then a resume: only that project\'s operatorPaused and the cursor change, one pause record each', async () => {
    const w = await world(form);
    const headBefore = headOf(orderOf(w));
    let prev = snapshot(w);
    expect(Object.keys(prev.landing_intents!)).toHaveLength(1);
    for (const paused of [true, false]) {
      const recs = records(w).length;
      const res = await pause(w, paused);
      expect(res.statusCode, res.body).toBe(200);
      const now = snapshot(w);
      const changed = diff(prev, now);
      // The first pause of a project with no flags row inserts it (operatorPaused set, mainRedHold at its default).
      expect(changed.filter((d) => ![`landing_projects ${P} operatorPaused`, `landing_projects ${P} inserted`, 'landing_journal_cursor 1 appliedSeq'].includes(d)),
        changed.join('\n')).toEqual([]);
      expect(records(w)).toHaveLength(recs + 1);
      expect(records(w).at(-1)).toMatchObject({ kind: 'pause', paused });
      prev = now;
    }
    expect(headOf(orderOf(w))).toBe(headBefore);
  });
});

describe.each(['run-bound', 'run-less'] as const)('nothing is brought forward (the F8 ruling, %s)', (form) => {
  it('a withdrawn middle entry with edges on both sides: the head stays A, and C and D wait on B, D\'s fixesMain notwithstanding', async () => {
    const w = await world(form);
    expect(headOf(orderOf(w))).toBe(w.ids.A);
    expect((await withdraw(w, 'B')).statusCode).toBe(200);
    const o = orderOf(w);
    expect(headOf(o)).toBe(w.ids.A);
    // `waits` lists the held entries in the line's key order (D, with fixesMain, before C); each names B by id and PR.
    expect([...(o.waits ?? [])].sort((x, y) => x.entryId - y.entryId))
      .toEqual([w.ids.C, w.ids.D].sort((a, b) => a - b).map((entryId) => ({ entryId, reason: 'withdrawn', on: [{ entryId: w.ids.B, pr: 2 }] })));
    expect(o.order.at(-1)!.id === w.ids.C || o.order.at(-1)!.id === w.ids.D).toBe(true);
  });

  it('a withdrawn head with a dependant: B waits on A, and the head is the next independent entry or null', async () => {
    const w = await world(form);
    expect((await withdraw(w, 'A')).statusCode).toBe(200);
    const o = orderOf(w);
    expect(o.waits).toEqual([{ entryId: w.ids.B, reason: 'withdrawn', on: [{ entryId: w.ids.A, pr: 1 }] }]);
    // C and D wait behind B, which is pinned and held; E is ejected and F unknown: no independent pinned entry remains.
    expect(headOf(o)).toBeNull();
  });

  it('a fixes-main dependant never becomes the head while its edge to the withdrawn B stands, main red as well', async () => {
    const w = await world(form);
    expect((await withdraw(w, 'B')).statusCode).toBe(200);
    w.db.prepare('INSERT INTO landing_projects (project, mainRedHold) VALUES (?, 1) ON CONFLICT(project) DO UPDATE SET mainRedHold = 1').run(P);
    expect((await withdraw(w, 'A')).statusCode).toBe(200);
    const o = orderOf(w);
    expect(headOf(o)).not.toBe(w.ids.D);
    expect(o.waits?.map((x) => x.entryId)).toContain(w.ids.D);
  });
});

describe('the dependants are told (D-9050)', () => {
  it('run-bound: each direct dependant one landing-held, a transitive one none, an unreadable one none while the withdrawal applies', async () => {
    const w = await world('run-bound');
    w.db.prepare("UPDATE runs SET claimedBy = x'00' WHERE id = ?").run(w.runs.D!);   // a BLOB: D's association does not read
    const res = await withdraw(w, 'B');
    expect(res.statusCode, res.body).toBe(200);
    expect(heldMail(w).map((m) => m.toId)).toEqual(['coord-c']);
    expect((res.json() as { notices: unknown[] }).notices).toEqual([
      expect.objectContaining({ word: 'landing-withdrawn', entryId: w.ids.B, kind: 'queued', toId: 'coord-b' }),
      expect.objectContaining({ word: 'landing-held', entryId: w.ids.C, kind: 'queued', toId: 'coord-c' }),
      { word: 'landing-held', entryId: w.ids.D, kind: 'unreadable' }]);
    const a = await world('run-bound');
    expect((await withdraw(a, 'A')).statusCode).toBe(200);
    expect(heldMail(a).map((m) => m.toId)).toEqual(['coord-b']);   // B only: C and D are transitive
  });

  it('run-less: the creation claimants are told', async () => {
    const w = await world('run-less');
    expect((await withdraw(w, 'B')).statusCode).toBe(200);
    expect(heldMail(w).map((m) => m.toId).sort()).toEqual(['creator-c', 'creator-d']);
  });
});

describe('no door names a successor (a static read of routes.ts)', () => {
  // The parse-based reader (`scan/symbols.ts`), never a literal read of the file (the advance-switches ratchet).
  const ROUTES = sourceOfSymbol('server/src/coord/routes.ts', 'registerCoordRoutes');
  const span = (from: string, to: string): string => {
    const i = ROUTES.indexOf(from);
    const j = ROUTES.indexOf(to, i);
    expect(i, from).toBeGreaterThan(-1);
    expect(j, to).toBeGreaterThan(i);
    return ROUTES.slice(i, j);
  };
  it('the doors\' code builds only pause and withdraw commands and names neither afterIds nor fixesMain', () => {
    const doors = span('const landingDoor = async (', "app.post('/api/landing/withdraw'")
      + span("app.post('/api/landing/withdraw'", '\n  });\n');
    expect(doors).not.toMatch(/afterIds|fixesMain|\bhead\b|successor/);
    expect([...new Set([...doors.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]))].sort()).toEqual(['pause', 'withdraw']);
  });
  it('CONTROL: the span reader finds the order door, registered just before the doors', () => {
    expect(span("app.post('/api/landing/order'", "app.post('/api/landing/pause'")).toContain("'order'");
  });
});
