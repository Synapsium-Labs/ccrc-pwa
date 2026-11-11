// D-8126 (coordinator-autonomy-default plan, Task A3-2): `coordinator_calls` and its store, one writer per column.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { BLOCK_CONDITION_TTL_MS, CALL_SEEN_WINDOW_MS, type NewCall } from '../src/coord/coordCalls.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const CREATE = /CREATE TABLE coordinator_calls(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const objectNames = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all() as
    unknown as { name: string }[]).map((r) => r.name);

const store = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-calls-store-'))));
const big = (o: Partial<NewCall> = {}): NewCall => ({
  class: 'big', runId: null, question: 'Which store?', options: ['sqlite', 'postgres'], chosen: 'sqlite',
  why: 'one box', reversible: true, wakeOn: null, ...o,
});
const routine = (o: Partial<NewCall> = {}): NewCall => big({ class: 'routine', ...o });
const block = (o: Partial<NewCall> = {}): NewCall => ({
  class: 'block', runId: null, question: null, options: null, chosen: 'waiting on disk', why: 'full', reversible: true,
  wakeOn: 'disk', ...o,
});

describe('the migration', () => {
  it('is one new entry that adds exactly the table and its three indexes, and no column on an older table', () => {
    expect(SLOT, 'no MIGRATIONS entry creates coordinator_calls').toBeGreaterThanOrEqual(49);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => m.includes('coordinator_calls'))).toBe(false);
    expect(MIGRATIONS[SLOT - 1]!).not.toMatch(/ALTER TABLE/);
    const p = dbPathIn(mkTmp('ccrc-calls-mig-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    });
    const had = objectNames(raw);
    raw.close();
    // A database at the previous version migrates through the real opener.
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    // The later entries replay too: migration 56 (D-8274) adds `lane_arm_settings` and its primary-key index, and migration 57
    // (Overlord W1a) adds `practice_cases` and its index, nothing of this one's.
    expect(objectNames(db).filter((n) => !had.includes(n) && !n.includes('lane_arm_settings') && !n.includes('practice_cases')).sort()).toEqual([
      'coordinator_calls', 'coordinator_calls_by_program', 'coordinator_calls_by_run', 'coordinator_calls_live_blocks',
    ]);
    const cols = (db.prepare('PRAGMA table_info(coordinator_calls)').all() as unknown as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'program', 'runId', 'madeBy', 'class', 'question', 'options', 'chosen', 'why', 'reversible',
      'wakeOn', 'expiresAt', 'at', 'seenAt', 'overturnedAt', 'overturnNote', 'wokenAt', 'build']);
    db.close();
  });
});

describe('insertCall and the readers', () => {
  it('round-trips a big call through callById, callsForRun and bigCallsFor', () => {
    const s = store();
    s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'A', 1, 'active')").run();
    const runId = Number(s.db.prepare(
      "INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 1, 'demo', 'working', 'c', 1)",
    ).run().lastInsertRowid);
    const id = s.insertCall('prog-a', 'coord-1', big({ runId }), 'b-1', NOW);
    expect(s.callById(id)).toEqual({
      id, program: 'prog-a', runId, madeBy: 'coord-1', class: 'big', question: 'Which store?', options: ['sqlite', 'postgres'],
      chosen: 'sqlite', why: 'one box', reversible: true, wakeOn: null, expiresAt: null, at: NOW, seenAt: null,
      overturnedAt: null, overturnNote: null, wokenAt: null, build: 'b-1',
    });
    s.insertCall('prog-a', 'coord-1', routine(), null, NOW + 1);
    expect(s.callsForRun(runId).map((r) => r.id)).toEqual([id]);
    expect(s.bigCallsFor('prog-a', 10).map((r) => r.id)).toEqual([id]);
    expect(s.callById(9999)).toBeNull();
  });

  it('bigCallsFor lists only big calls, newest first, within the limit, for one programme or all', () => {
    const s = store();
    const a = s.insertCall('prog-a', 'c1', big(), null, NOW);
    const b = s.insertCall('prog-b', 'c2', big(), null, NOW + 1);
    const c = s.insertCall('prog-a', 'c1', big(), null, NOW + 2);
    s.insertCall('prog-a', 'c1', routine(), null, NOW + 3);
    expect(s.bigCallsFor('prog-a', 10).map((r) => r.id)).toEqual([c, a]);
    expect(s.bigCallsFor(null, 10).map((r) => r.id)).toEqual([c, b, a]);
    expect(s.bigCallsFor(null, 2).map((r) => r.id)).toEqual([c, b]);
  });

  it('a block stores its expiry by blockExpiresAt: a condition a day out, a time wake at its time', () => {
    const s = store();
    const d = s.insertCall('p', 'c1', block(), null, NOW);
    const t = s.insertCall('p', 'c1', block({ wakeOn: `time:${NOW + 5000}` }), null, NOW);
    expect(s.callById(d)!.expiresAt).toBe(NOW + BLOCK_CONDITION_TTL_MS);
    expect(s.callById(t)!.expiresAt).toBe(NOW + 5000);
  });

  it('liveBlocksOf excludes woken and expired rows, other coordinators and other classes', () => {
    const s = store();
    const live = s.insertCall('p', 'c1', block(), null, NOW);
    const woken = s.insertCall('p', 'c1', block(), null, NOW);
    s.insertCall('p', 'c2', block(), null, NOW);
    s.insertCall('p', 'c1', big(), null, NOW);
    const timed = s.insertCall('p', 'c1', block({ wakeOn: `time:${NOW + 1000}` }), null, NOW);
    expect(s.markBlockWoken(woken, NOW + 1)).toBe(true);
    expect(s.liveBlocksOf('c1', NOW + 10).map((r) => r.id)).toEqual([live, timed]);
    expect(s.liveBlocksOf('c1', NOW + 1000).map((r) => r.id)).toEqual([live]);
    expect(s.liveBlocksOf('c1', NOW + BLOCK_CONDITION_TTL_MS).map((r) => r.id)).toEqual([]);
  });
});

describe('the writers', () => {
  it('markCallSeen: seen, then already; a routine row is not-big; an unknown id is unknown', () => {
    const s = store();
    const id = s.insertCall('p', 'c1', big(), null, NOW);
    const r = s.insertCall('p', 'c1', routine(), null, NOW);
    expect(s.markCallSeen(id, NOW + 5)).toBe('seen');
    expect(s.callById(id)!.seenAt).toBe(NOW + 5);
    expect(s.markCallSeen(id, NOW + 9)).toBe('already');
    expect(s.callById(id)!.seenAt).toBe(NOW + 5);
    expect(s.markCallSeen(r, NOW)).toBe('not-big');
    expect(s.callById(r)!.seenAt).toBeNull();
    expect(s.markCallSeen(424242, NOW)).toBe('unknown');
  });

  it('markBlockWoken answers true once, then false; a non-block row is never woken', () => {
    const s = store();
    const b = s.insertCall('p', 'c1', block(), null, NOW);
    const g = s.insertCall('p', 'c1', big(), null, NOW);
    expect(s.markBlockWoken(b, NOW + 1)).toBe(true);
    expect(s.markBlockWoken(b, NOW + 2)).toBe(false);
    expect(s.callById(b)!.wokenAt).toBe(NOW + 1);
    expect(s.markBlockWoken(g, NOW)).toBe(false);
    expect(s.markBlockWoken(777, NOW)).toBe(false);
  });

  it('overturnCallTx writes the overturn and rolls back with its transaction', () => {
    const s = store();
    const id = s.insertCall('p', 'c1', big(), null, NOW);
    expect(() => tx(s.db, () => { s.overturnCallTx(id, 'use postgres', NOW + 3); throw new Error('mail failed'); })).toThrow('mail failed');
    expect(s.callById(id)!.overturnedAt).toBeNull();
    tx(s.db, () => s.overturnCallTx(id, 'use postgres', NOW + 3));
    expect(s.callById(id)).toMatchObject({ overturnedAt: NOW + 3, overturnNote: 'use postgres' });
  });

  it('callsForOperator: open holds the unseen, uncorrected, recent big calls; cleared holds those that left, newest-cleared first', () => {
    const s = store();
    const open = s.insertCall('p', 'c1', big(), null, NOW);
    const seen = s.insertCall('p', 'c1', big(), null, NOW + 1);
    const turned = s.insertCall('p', 'c1', big(), null, NOW + 2);
    const aged = s.insertCall('p', 'c1', big(), null, NOW - CALL_SEEN_WINDOW_MS - 1000);
    s.insertCall('p', 'c1', routine(), null, NOW);
    s.insertCall('p', 'c1', block(), null, NOW);
    s.markCallSeen(seen, NOW + 10);
    tx(s.db, () => s.overturnCallTx(turned, 'no', NOW + 20));
    const got = s.callsForOperator(NOW + 100);
    expect(got.open.map((r) => r.id)).toEqual([open]);
    expect(got.cleared.map((r) => r.id)).toEqual([turned, seen, aged]);
  });
});
