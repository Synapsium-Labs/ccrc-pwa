// server/test/history-store.test.ts — ccd/history/store.mjs, the history
// store's L3 adapter (spec 2026-10-05 §6.2, §6.9, §6.11), imported directly
// (the compact-card.mjs precedent) and, where a pin needs a process that dies
// between two writes, run in a child killed by the test-only preload.
//
// Every store here lives in a mkTmp fixture HOME; nothing reads or writes the
// live ~/.ccrc. Runs on every platform: an L3 file under test in-process needs
// no carrier, and the children are plain node.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, constants as Z } from 'node:zlib';
import { mkTmp } from './tmpHelpers.js';
import { SCHEMA_ADDED, SCHEMA_VERSION } from '../../ccd/history/lib.mjs';
import {
  CODEC, MIGRATIONS, StoreError, openWriter, openReader, userVersion, probeFts5, withTx, brotli, unbrotli,
  measuredSize, getMeta, setMeta, bump, closeWriter, schemaOf,
} from '../../ccd/history/store.mjs';

/** A delete-mode (rollback-journal) v1 store built by hand, the shape a
 *  `VACUUM INTO` restore leaves: no createStore, no binding files. */
const v1Store = (dir: string): string => {
  const p = path.join(dir, 'history.db');
  const db = new DatabaseSync(p);
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  db.exec(MIGRATIONS[0]!);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  db.close();
  return p;
};
/** A pragma's one value, whatever SQLite names its column (`busy_timeout`
 *  answers in a column called `timeout`). */
const pragma = (db: DatabaseSync, name: string): unknown =>
  Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];
const mode = (p: string): number => fs.statSync(p).mode & 0o777;
const wordOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return e instanceof StoreError ? e.word : `not a StoreError: ${String(e)}`; }
  return 'no throw';
};

describe('store.mjs: open, schema v1, pragmas', () => {
  it('MIGRATIONS[0] is the whole v1 schema, and SCHEMA_ADDED[1] names its every table and column in order', () => {
    const db = new DatabaseSync(v1Store(mkTmp('ccrc-history-store-')));
    const schema = schemaOf(db);
    db.close();
    expect(Object.keys(schema).length, 'the scan saw no table').toBeGreaterThan(20);
    expect(schema).toEqual(SCHEMA_ADDED[1]!.tables);
    expect(SCHEMA_ADDED[1]!.heavy).toBe(false);
    // RV2: the FTS tables are a derivation's, never schema v1's.
    expect(Object.keys(schema).filter((t) => t.includes('fts'))).toEqual([]);
  });

  it('a blob\'s referrers are found by an index SEARCH, never a table scan (FTS backfill, export census)', () => {
    const db = new DatabaseSync(v1Store(mkTmp('ccrc-history-store-')));
    const plan = (sql: string): string => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
      .map((r) => r.detail).join('\n');
    expect(plan('SELECT 1 FROM sidecars WHERE blob_id = 1')).toMatch(/SEARCH sidecars USING (COVERING )?INDEX sidecars_blob\b/);
    expect(plan('SELECT 1 FROM entry_variants WHERE blob_id = 1'))
      .toMatch(/SEARCH entry_variants USING (COVERING )?INDEX entry_variants_blob\b/);
    expect(plan('SELECT 1 FROM boundaries WHERE kept_blob_id = 1')).toMatch(/SEARCH boundaries USING (COVERING )?INDEX boundaries_kept\b/);
    db.close();
  });

  it('DM16: a 0-byte history.db is refused by the writer and the reader, and stays 0 bytes', () => {
    const p = path.join(mkTmp('ccrc-history-store-'), 'history.db');
    fs.writeFileSync(p, '');
    expect(wordOf(() => openWriter(p))).toBe('store-zero-byte');
    expect(wordOf(() => openReader(p))).toBe('store-zero-byte');
    expect(fs.statSync(p).size).toBe(0);
  });

  it('an open never creates: an absent history.db is store-missing, and no file appears', () => {
    const p = path.join(mkTmp('ccrc-history-store-'), 'history.db');
    expect(wordOf(() => openWriter(p))).toBe('store-missing');
    expect(wordOf(() => openReader(p))).toBe('store-missing');
    expect(fs.existsSync(p)).toBe(false);
  });

  it('a history.db that is not a regular file (a directory, a symlink to a real store) is store-unmeasured from both opens, and nothing is opened or created', () => {
    const d = path.join(mkTmp('ccrc-history-store-'), 'history.db');
    fs.mkdirSync(d);
    expect(wordOf(() => openWriter(d))).toBe('store-unmeasured');
    expect(wordOf(() => openReader(d))).toBe('store-unmeasured');
    expect(fs.readdirSync(d)).toEqual([]);

    // An open never follows a link: only db/ may be a symlink (§9.3), never the file in it.
    const real = v1Store(mkTmp('ccrc-history-store-'));
    const link = path.join(mkTmp('ccrc-history-store-'), 'history.db');
    fs.symlinkSync(real, link);
    expect(wordOf(() => openWriter(link))).toBe('store-unmeasured');
    expect(wordOf(() => openReader(link))).toBe('store-unmeasured');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('O57: a delete-mode store is set to WAL at open and read back; a store that will not change is store-not-wal', () => {
    const p = v1Store(mkTmp('ccrc-history-store-'));
    const before = new DatabaseSync(p);
    expect(pragma(before, 'journal_mode')).toBe('delete');
    before.close();
    const db = openWriter(p);
    expect(pragma(db, 'journal_mode')).toBe('wal');
    closeWriter(db);

    // The seam: a DatabaseSync whose WAL set is swallowed, as a set SQLite
    // declines is. In-process, on the class store.mjs itself imported.
    const q = v1Store(mkTmp('ccrc-history-store-'));
    const realExec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function exec(this: DatabaseSync, sql: string): void {
      if (/journal_mode\s*=\s*WAL/i.test(sql)) return;
      realExec.call(this, sql);
    };
    try {
      expect(wordOf(() => openWriter(q))).toBe('store-not-wal');
    } finally {
      DatabaseSync.prototype.exec = realExec;
    }
    const after = new DatabaseSync(q);
    expect(pragma(after, 'journal_mode'), 'the refused store was not changed').toBe('delete');
    after.close();
  });

  it('the writer connection carries the §6.2 pragmas (V6)', () => {
    const db = openWriter(v1Store(mkTmp('ccrc-history-store-')));
    expect(pragma(db, 'busy_timeout')).toBe(30000);
    expect(pragma(db, 'foreign_keys')).toBe(1);
    expect(pragma(db, 'synchronous')).toBe(1);
    expect(pragma(db, 'journal_size_limit')).toBe(67108864);
    expect(pragma(db, 'cache_size')).toBe(-65536);
    expect(pragma(db, 'temp_store')).toBe(2);
    expect(pragma(db, 'auto_vacuum')).toBe(2);
    closeWriter(db);
  });

  it('DM10: deleting an entry a node lists as a source is a constraint error (RESTRICT)', () => {
    const db = openWriter(v1Store(mkTmp('ccrc-history-store-')));
    db.exec(`
      INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'claude-a-demo', '', 'demo', 1);
      INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, '11111111-1111-4111-8111-111111111111');
      INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, x'00', 'br5', x'00', 1);
      INSERT INTO entries (entry_id, uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id)
        VALUES (1, '22222222-2222-4222-8222-222222222222', 1, 'user', 'operator', 1, 1, 1, 1);
      INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, parser_version, created_ms)
        VALUES ('L0123456789abcdef0123', 1, 1, 1, 'native_leaf', 0, 'ok', 1, 1);
      INSERT INTO node_sources (node_id, entry_id, ord) VALUES ('L0123456789abcdef0123', 1, 0);
    `);
    expect(() => db.exec('DELETE FROM entries WHERE entry_id = 1')).toThrow(/FOREIGN KEY constraint failed/);
    expect((db.prepare('SELECT count(*) AS n FROM entries').get() as { n: number }).n).toBe(1);
    closeWriter(db);
  });

  it('the reader is read-only twice over, and its FTS5 probe answers where a temp create throws (P0, RV1)', () => {
    const r = openReader(v1Store(mkTmp('ccrc-history-store-')));
    expect(pragma(r, 'query_only')).toBe(1);
    expect(pragma(r, 'busy_timeout')).toBe(30000);
    expect(userVersion(r)).toBe(SCHEMA_VERSION);
    expect(probeFts5(r)).toBe('present');
    expect(() => r.exec('CREATE VIRTUAL TABLE temp.probe USING fts5(x)')).toThrow();
    expect(() => r.exec("INSERT INTO meta (k, v) VALUES ('x', 'y')")).toThrow();
    r.close();
  });

  it('withTx sets synchronous BEFORE BEGIN, resets it after, and rolls back with the original error', () => {
    const db = openWriter(v1Store(mkTmp('ccrc-history-store-')));
    const inside = withTx(db, 'FULL', () => pragma(db, 'synchronous'));
    expect(inside).toBe(2);
    expect(pragma(db, 'synchronous')).toBe(1);
    expect(withTx(db, 'NORMAL', () => pragma(db, 'synchronous'))).toBe(1);
    const boom = new Error('the real failure');
    expect(() => withTx(db, 'FULL', () => { setMeta(db, 'k', 'v'); throw boom; })).toThrow(boom);
    expect(getMeta(db, 'k')).toBeNull();
    expect(pragma(db, 'synchronous')).toBe(1);
    expect(() => withTx(db, 'OFF' as 'FULL', () => 0)).toThrow(TypeError);
    closeWriter(db);
  });

  it('brotli is quality 5 with a size hint, recorded as br5, and round-trips', () => {
    const text = Buffer.from(Array.from({ length: 4000 }, (_, i) => `line ${i % 97} of a transcript body\n`).join(''));
    const z = brotli(text);
    expect(CODEC).toBe('br5');
    expect(unbrotli(z).equals(text)).toBe(true);
    const q5 = brotliCompressSync(text, { params: { [Z.BROTLI_PARAM_QUALITY]: 5, [Z.BROTLI_PARAM_SIZE_HINT]: text.length } });
    const q11 = brotliCompressSync(text);
    expect(z.equals(q5)).toBe(true);
    expect(q5.equals(q11), 'the sample cannot tell quality 5 from the default').toBe(false);
  });

  it('measuredSize is page_count x page_size plus the -wal file', () => {
    const p = v1Store(mkTmp('ccrc-history-store-'));
    const db = openWriter(p);
    for (let i = 0; i < 50; i += 1) bump(db, `c${i}`);
    const pages = Number(pragma(db, 'page_count')) * Number(pragma(db, 'page_size'));
    const wal = fs.existsSync(`${p}-wal`) ? fs.statSync(`${p}-wal`).size : 0;
    expect(wal, 'no -wal to count: the case measures nothing').toBeGreaterThan(0);
    expect(measuredSize(db, p)).toBe(pages + wal);
    closeWriter(db);
  });

  it('meta and counters are upserts; closeWriter closes', () => {
    const db = openWriter(v1Store(mkTmp('ccrc-history-store-')));
    expect(getMeta(db, 'copy_bps')).toBeNull();
    setMeta(db, 'copy_bps', 21000000);
    setMeta(db, 'copy_bps', 22000000);
    expect(getMeta(db, 'copy_bps')).toBe('22000000');
    bump(db, 'raw_only');
    bump(db, 'raw_only');
    bump(db, 'raw_only', 5);
    expect((db.prepare("SELECT n FROM counters WHERE name = 'raw_only'").get() as { n: number }).n).toBe(7);
    closeWriter(db);
    expect(() => db.prepare('SELECT 1').get()).toThrow();
  });
});
