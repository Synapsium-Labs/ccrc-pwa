// server/test/history-fts-fold.test.ts — D-8726 (history-fts-fold-once): the merge steps fold an FTS5 index only when
// no merge is in progress, and drain without folding near FTS5's 2000-segment limit (spec 2026-10-05 §6.2, O47).
//
// Every case runs on this interpreter's own node:sqlite build, so the FTS5 behaviour the fix relies on is pinned here,
// not remembered: a NEGATIVE 'merge' rebuilds the structure with every segment on one level and nMerge 0 whenever it is
// not already "optimal", which discards a merge in progress and starts another that needs a new segment id; a POSITIVE
// 'merge' continues the level whose merge is in progress and allocates none. Nothing here spawns the sweep, so the file
// runs on every platform (O24's darwin rule is for files that spawn it).
import { describe, it, expect } from 'vitest';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { FTS_MERGE_ARMS, decideFtsMerge, parseFtsStructure, type FtsStructure } from '../../ccd/history/fts-structure.mjs';
import { FTS5_MAX_SEGMENT, FTS_SEGMENTS_DRAIN, FTS_SEGMENTS_WARN, historyPaths } from '../../ccd/history/lib.mjs';
import { createFtsTables, createStore, ftsSegmentsOn, ftsStructureOn, openWriter, withTx } from '../../ccd/history/store.mjs';
import { mergeSteps, newBudget } from '../../ccd/history/sweep.mjs';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_800_000_000_000;
const PAGES = 64;   // sweep.mjs's MERGE_PAGES

/** A deterministic word stream (an LCG), so every run builds the same index. */
function wordsFrom(seed: number): () => string {
  let s = seed >>> 0;
  return () => Array.from({ length: 12 }, () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return `w${s % 5000}`;
  }).join(' ');
}

const block = (db: DatabaseSync, table: string): Uint8Array =>
  (db.prepare(`SELECT block FROM ${table}_data WHERE id = 10`).get() as { block: Uint8Array }).block;
const structureOf = (db: DatabaseSync, table = 'blobs_fts'): Extract<FtsStructure, { state: 'ok' }> => {
  const s = parseFtsStructure(block(db, table));
  if (s.state !== 'ok') throw new Error(`${table}'s structure did not parse: ${s.state}`);
  return s;
};
const segids = (s: Extract<FtsStructure, { state: 'ok' }>): number[] => s.levels.flatMap((l) => l.segids);
const inProgress = (s: Extract<FtsStructure, { state: 'ok' }>): boolean => s.levels.some((l) => l.nMerge > 0);

/** A store createStore made, with its FTS tables, on a writer handle. */
function storeDb(prefix: string): DatabaseSync {
  const home = mkTmp(prefix);
  createStore(home);
  const db = openWriter(historyPaths(home).dbFile);
  withTx(db, 'NORMAL', () => { createFtsTables(db); });
  return db;
}
/** The merge step registered pending, as every writer that deletes index rows registers it. */
const registerMerge = (db: DatabaseSync): void => {
  db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('fts-merge', 1, NULL, NULL)
    ON CONFLICT(step, version) DO UPDATE SET completed_ms = NULL`).run();
};
const mergeDone = (db: DatabaseSync): boolean =>
  (db.prepare("SELECT completed_ms FROM derivation_state WHERE step = 'fts-merge' AND version = 1").get() as { completed_ms: number | null }).completed_ms !== null;
/** A run budget of `calls` loop passes: a clock that moves 1 ms per read (newBudget reads it once, budgetLeft once a pass). */
const passes = (calls: number): ReturnType<typeof newBudget> => {
  let t = 0;
  return newBudget(() => { t += 1; return t; }, { maxMs: calls + 1 });
};
const runMerge = (db: DatabaseSync, calls: number): void => { mergeSteps(db, { fts: true, nowMs: T0 }, passes(calls)); };

/** The handle mergeSteps is given, recording the rank of every 'merge' it runs and the structure it ran on. */
function spied(db: DatabaseSync): { db: DatabaseSync; calls: Array<{ table: string; rank: number; before: Extract<FtsStructure, { state: 'ok' }> }> } {
  const calls: Array<{ table: string; rank: number; before: Extract<FtsStructure, { state: 'ok' }> }> = [];
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string): StatementSync => {
          const st = target.prepare(sql);
          const m = /INSERT INTO (\w+) \(\1, rank\) VALUES \('merge', \?\)/.exec(sql);
          if (m === null) return st;
          const table = m[1]!;
          return new Proxy(st, {
            get(s, k) {
              if (k === 'run') return (rank: number) => { calls.push({ table, rank, before: structureOf(target, table) }); return s.run(rank); };
              const v = Reflect.get(s, k, s) as unknown;
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
            },
          });
        };
      }
      const v = Reflect.get(target, key, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { db: proxy, calls };
}

describe('parseFtsStructure reads FTS5\'s own structure record (D-8726)', () => {
  it('an empty table: V1 and the contentless_delete V2 form, as node:sqlite writes them', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE VIRTUAL TABLE v1 USING fts5(body)");
    db.exec("CREATE VIRTUAL TABLE v2 USING fts5(body, content='', contentless_delete=1)");
    expect(parseFtsStructure(block(db, 'v1'))).toEqual({ state: 'ok', v2: false, nLevel: 0, nSegment: 0, levels: [], tombstonePages: 0 });
    expect(parseFtsStructure(block(db, 'v2'))).toEqual({ state: 'ok', v2: true, nLevel: 0, nSegment: 0, levels: [], tombstonePages: 0 });
  });

  it('segments on their levels, an in-progress merge, and V2 tombstone pages', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE VIRTUAL TABLE v1 USING fts5(body)");
    db.exec("CREATE VIRTUAL TABLE v2 USING fts5(body, content='', contentless_delete=1)");
    const next = wordsFrom(7);
    for (const t of ['v1', 'v2']) {
      db.exec(`INSERT INTO ${t}(${t}, rank) VALUES ('pgsz', 64)`);
      db.exec(`INSERT INTO ${t}(${t}, rank) VALUES ('automerge', 0)`);
      for (let i = 1; i <= 5; i += 1) db.prepare(`INSERT INTO ${t}(rowid, body) VALUES (?, ?)`).run(i, next());
    }
    for (const t of ['v1', 'v2']) {
      const s = structureOf(db, t);
      expect(s.nSegment, t).toBe(5);
      expect(s.levels.map((l) => [l.nMerge, l.nSeg]), t).toEqual([[0, 5]]);
      expect(new Set(segids(s)).size, `${t}: five distinct ids`).toBe(5);
    }
    // A fold of a big enough index runs out of pages: an in-progress merge of every segment, its output one level up.
    const big = wordsFrom(11);
    db.exec('BEGIN');
    for (let i = 6; i < 3000; i += 1) db.prepare('INSERT INTO v2(rowid, body) VALUES (?, ?)').run(i, big());
    db.exec('COMMIT');
    db.exec("INSERT INTO v2(v2, rank) VALUES ('merge', -1)");
    const m = structureOf(db, 'v2');
    expect(m.levels.filter((l) => l.nSeg > 0).map((l) => [l.nMerge, l.nSeg])).toEqual([[6, 6], [0, 1]]);
    expect(m.nSegment).toBe(7);
    expect(m.tombstonePages).toBe(0);
    // A contentless delete records a tombstone page on the V2 segment that held the row.
    db.exec("INSERT INTO v2(v2, rank) VALUES ('merge', 100000)");
    expect(structureOf(db, 'v2').nSegment, 'CONTROL: the merge ran to its end').toBe(1);
    db.prepare('DELETE FROM v2 WHERE rowid = ?').run(42);
    expect(structureOf(db, 'v2').tombstonePages).toBeGreaterThan(0);
  });

  it('answers missing for no record and unreadable for a record it cannot read, and never throws', () => {
    expect(parseFtsStructure(null)).toEqual({ state: 'missing' });
    expect(parseFtsStructure(undefined)).toEqual({ state: 'missing' });
    for (const b of [new Uint8Array([]), new Uint8Array([0, 0, 0]), new Uint8Array([0, 0, 0, 0, 1, 1]), new Uint8Array([0, 0, 0, 0, 0x80]),
      new Uint8Array([0, 0, 0, 0, 1, 2, 0, 0, 1, 5, 1, 1]), 'not bytes']) {
      expect(parseFtsStructure(b as Uint8Array), JSON.stringify(Array.from(b as Uint8Array))).toEqual({ state: 'unreadable' });
    }
  });

  it('a varint is read big-endian in 7-bit groups, its 9th byte whole (one segment id of 300, a last page of 2^28)', () => {
    // cookie, nLevel 1, nSegment 1, nWriteCounter 1; level: nMerge 0, nSeg 1; segment: id 300, first 1, last 2^28
    const rec = new Uint8Array([0, 0, 0, 1, 1, 1, 1, 0, 1, 0x82, 0x2c, 1, 0x81, 0x80, 0x80, 0x80, 0x00]);
    expect(parseFtsStructure(rec)).toEqual({ state: 'ok', v2: false, nLevel: 1, nSegment: 1, levels: [{ nMerge: 0, nSeg: 1, segids: [300] }], tombstonePages: 0 });
  });
});

describe('decideFtsMerge: continue a merge in progress, fold only when none is, and never fold near the limit (D-8726)', () => {
  const ok = (nSegment: number, levels: Array<{ nMerge: number; nSeg: number }>): FtsStructure =>
    ({ state: 'ok', v2: true, nLevel: levels.length, nSegment, levels: levels.map((l) => ({ ...l, segids: [] })), tombstonePages: 0 });

  it('the arms', () => {
    expect(FTS_MERGE_ARMS).toEqual(['continue', 'fold', 'drain']);
    expect(decideFtsMerge(ok(3, [{ nMerge: 0, nSeg: 2 }, { nMerge: 0, nSeg: 1 }]), PAGES)).toEqual({ arm: 'fold', pages: -PAGES });
    expect(decideFtsMerge(ok(5, [{ nMerge: 0, nSeg: 2 }, { nMerge: 2, nSeg: 2 }, { nMerge: 0, nSeg: 1 }]), PAGES)).toEqual({ arm: 'continue', pages: PAGES });
    expect(decideFtsMerge(ok(FTS_SEGMENTS_DRAIN, [{ nMerge: 0, nSeg: FTS_SEGMENTS_DRAIN }]), PAGES)).toEqual({ arm: 'drain', pages: PAGES });
    expect(decideFtsMerge(ok(FTS_SEGMENTS_DRAIN - 1, [{ nMerge: 0, nSeg: FTS_SEGMENTS_DRAIN - 1 }]), PAGES)).toEqual({ arm: 'fold', pages: -PAGES });
    expect(decideFtsMerge({ state: 'missing' }, PAGES), 'nothing to fold: a no-op').toEqual({ arm: 'fold', pages: -PAGES });
    expect(decideFtsMerge({ state: 'unreadable' }, PAGES), 'never fold blind').toEqual({ arm: 'drain', pages: PAGES });
  });

  it('the thresholds sit below FTS5\'s own limit, in order', () => {
    expect(FTS5_MAX_SEGMENT).toBe(2000);
    expect(FTS_SEGMENTS_WARN).toBe(500);
    expect(FTS_SEGMENTS_DRAIN).toBe(1500);
  });
});

describe('the merge steps never discard a merge in progress (D-8726)', () => {
  /** An index big enough that a 64-page merge step never finishes a fold in one call. */
  const seed = (db: DatabaseSync, table: string, n: number): number => {
    db.exec(`INSERT INTO ${table}(${table}, rank) VALUES ('pgsz', 64)`);
    const next = wordsFrom(3);
    const ins = db.prepare(`INSERT INTO ${table}(rowid, body) VALUES (?, ?)`);
    db.exec('BEGIN');
    for (let i = 1; i <= n; i += 1) ins.run(i, next());
    db.exec('COMMIT');
    return n;
  };

  it('CHARACTERIZATION: the old per-tick negative merge refolds after every writer commit, so the segment count climbs every tick', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE VIRTUAL TABLE t USING fts5(body, content='', contentless_delete=1)");
    let id = seed(db, 't', 20_000);
    const next = wordsFrom(5);
    const counts: number[] = [];
    for (let tick = 0; tick < 40; tick += 1) {
      for (let c = 0; c < 3; c += 1) db.prepare('INSERT INTO t(rowid, body) VALUES (?, ?)').run(++id, next());
      db.prepare("INSERT INTO t(t, rank) VALUES ('merge', ?)").run(-PAGES);
      counts.push(structureOf(db, 't').nSegment);
    }
    for (let i = 1; i < counts.length; i += 1) expect(counts[i], `tick ${i}: ${counts.join(',')}`).toBeGreaterThan(counts[i - 1]!);
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(counts[0]! + 39 * 4);
    // The measured signature: every segment but one an input of the top merge, its output alone on the level above.
    const s = structureOf(db, 't');
    const used = s.levels.filter((l) => l.nSeg > 0);
    expect(used.map((l) => l.nSeg)).toEqual([s.nSegment - 1, 1]);
    expect(used[0]!.nMerge).toBe(s.nSegment - 1);
  });

  it('the same ticks through mergeSteps keep both tables\' segment counts bounded', () => {
    const db = storeDb('ccrc-hist-fts-fold-bounded-');
    try {
      let id = seed(db, 'blobs_fts', 20_000);
      db.exec("INSERT INTO nodes_fts(nodes_fts, rank) VALUES ('pgsz', 64)");
      const next = wordsFrom(5);
      let most = { blobs: 0, nodes: 0 };
      // A tick's merge runs 16 calls a table here; a scheduled pass runs as many as the card step's slice of its budget allows.
      for (let tick = 0; tick < 120; tick += 1) {
        for (let c = 0; c < 3; c += 1) {
          id += 1;
          withTx(db, 'NORMAL', () => {
            db.prepare('INSERT INTO blobs_fts(rowid, body) VALUES (?, ?)').run(id, next());
            db.prepare('INSERT INTO nodes_fts(rowid, gist, topics, refs) VALUES (?, ?, ?, ?)').run(id, next(), next(), '');
            registerMerge(db);
          });
        }
        runMerge(db, 16);
        most = { blobs: Math.max(most.blobs, structureOf(db).nSegment), nodes: Math.max(most.nodes, structureOf(db, 'nodes_fts').nSegment) };
      }
      expect(most.blobs).toBeLessThanOrEqual(30);
      expect(most.nodes).toBeLessThanOrEqual(30);
    } finally { db.close(); }
  });

  it('near the limit it only continues: an in-progress merge of 1500 segments drains to one segment with no fold and no new segment id', () => {
    const db = storeDb('ccrc-hist-fts-fold-crisis-');
    try {
      db.exec("INSERT INTO blobs_fts(blobs_fts, rank) VALUES ('pgsz', 64)");
      db.exec("INSERT INTO blobs_fts(blobs_fts, rank) VALUES ('automerge', 0)");
      db.exec("INSERT INTO blobs_fts(blobs_fts, rank) VALUES ('crisismerge', 1999)");
      const next = wordsFrom(9);
      for (let i = 1; i <= FTS_SEGMENTS_DRAIN; i += 1) db.prepare('INSERT INTO blobs_fts(rowid, body) VALUES (?, ?)').run(i, `${next()} ${next()}`);
      expect(structureOf(db).nSegment, 'CONTROL: one segment per commit').toBe(FTS_SEGMENTS_DRAIN);
      db.exec("INSERT INTO blobs_fts(blobs_fts, rank) VALUES ('merge', -1)");   // the old fold: a merge of everything, in progress
      const start = structureOf(db);
      expect(inProgress(start)).toBe(true);
      expect(start.nSegment).toBe(FTS_SEGMENTS_DRAIN + 1);
      const known = new Set(segids(start));
      registerMerge(db);
      const spy = spied(db);
      let rounds = 0;
      while (!mergeDone(db) && rounds < 500) { mergeSteps(spy.db, { fts: true, nowMs: T0 }, passes(3)); rounds += 1; }
      expect(mergeDone(db), `done after ${rounds} rounds`).toBe(true);
      const blobs = spy.calls.filter((c) => c.table === 'blobs_fts');
      const draining = blobs.filter((c) => c.before.nSegment >= FTS_SEGMENTS_DRAIN || inProgress(c.before));
      expect(draining.length, 'the drain took many calls').toBeGreaterThan(10);
      for (const c of draining) {
        expect(c.rank, `${c.before.nSegment} segments`).toBe(PAGES);
        for (const s of segids(c.before)) expect(known.has(s), `segment ${s} is new`).toBe(true);
      }
      expect(structureOf(db).nSegment).toBe(1);
    } finally { db.close(); }
  });

  it('§6.2 and O47: once the merge steps complete, a contentless delete leaves no byte of its unique term in blobs_fts_data', () => {
    const db = storeDb('ccrc-hist-fts-fold-purge-');
    const TERM = 'zqpurgezq';
    const holds = (): boolean => (db.prepare('SELECT block FROM blobs_fts_data').all() as { block: Uint8Array }[])
      .some((r) => Buffer.from(r.block).toString('latin1').includes(TERM));
    try {
      const next = wordsFrom(13);
      for (let c = 0; c < 4; c += 1) {
        withTx(db, 'NORMAL', () => {
          for (let i = 1; i <= 100; i += 1) db.prepare('INSERT INTO blobs_fts(rowid, body) VALUES (?, ?)').run(c * 100 + i, c === 2 && i === 50 ? `${next()} ${TERM}` : next());
        });
      }
      registerMerge(db);
      runMerge(db, 1000);
      expect(mergeDone(db)).toBe(true);
      expect(structureOf(db).nSegment, 'CONTROL: one segment').toBe(1);
      expect(holds(), 'CONTROL: the term is indexed').toBe(true);
      withTx(db, 'NORMAL', () => { db.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(250); registerMerge(db); });
      expect(holds(), 'CONTROL: a contentless delete alone leaves the bytes').toBe(true);
      const s = structureOf(db);
      expect(s.tombstonePages, 'one tombstone, under deletemerge\'s 10% of 400 entries').toBeGreaterThan(0);
      db.prepare("INSERT INTO blobs_fts(blobs_fts, rank) VALUES ('merge', ?)").run(PAGES);
      expect(holds(), 'CONTROL: a positive merge alone does not purge a small deletion in a big segment').toBe(true);
      runMerge(db, 1000);
      expect(mergeDone(db)).toBe(true);
      expect(holds()).toBe(false);
      expect(structureOf(db).tombstonePages).toBe(0);
    } finally { db.close(); }
  });
});

describe('the store reads each FTS5 index\'s structure (D-8726)', () => {
  it('ftsStructureOn and ftsSegmentsOn: a missing table, an empty one, a counted one and an unreadable record', () => {
    const home = mkTmp('ccrc-hist-fts-fold-store-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    try {
      expect(ftsStructureOn(db, 'blobs_fts')).toEqual({ state: 'missing' });
      expect(ftsSegmentsOn(db)).toEqual({ blobs: null, nodes: null });
      withTx(db, 'NORMAL', () => { createFtsTables(db); });
      expect(ftsSegmentsOn(db)).toEqual({ blobs: 0, nodes: 0 });
      db.exec("INSERT INTO blobs_fts(blobs_fts, rank) VALUES ('automerge', 0)");
      for (let i = 1; i <= 3; i += 1) db.prepare('INSERT INTO blobs_fts(rowid, body) VALUES (?, ?)').run(i, `zq${i}`);
      expect(ftsSegmentsOn(db)).toEqual({ blobs: 3, nodes: 0 });
    } finally { db.close(); }
    // FTS5 refuses a write to its shadow tables on a defensive handle, so a damaged record is a stand-in handle's answer.
    const damaged = (nodes: Uint8Array | (() => never)): DatabaseSync => ({
      prepare: (sql: string) => ({
        get: () => /sqlite_master/.test(sql) ? { x: 1 }
          : /nodes_fts_data/.test(sql) ? (typeof nodes === 'function' ? nodes() : { block: nodes }) : { block: new Uint8Array([0, 0, 0, 0, 0, 0, 0]) },
      }),
    }) as unknown as DatabaseSync;
    expect(ftsStructureOn(damaged(new Uint8Array([0, 0, 0, 0, 9])), 'nodes_fts')).toEqual({ state: 'unreadable' });
    expect(ftsStructureOn(damaged(() => { throw new Error('SQLITE_CORRUPT'); }), 'nodes_fts'), 'a read that throws').toEqual({ state: 'unreadable' });
    expect(ftsSegmentsOn(damaged(new Uint8Array([0, 0, 0, 0, 0, 0, 0]))), 'CONTROL: the stand-in reads').toEqual({ blobs: 0, nodes: 0 });
    expect(() => ftsSegmentsOn(damaged(new Uint8Array([0, 0, 0, 0, 9])))).toThrow(/nodes_fts/);
  });
});
