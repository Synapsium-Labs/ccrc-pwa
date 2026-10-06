// server/test/history-store.test.ts — ccd/history/store.mjs, the history
// store's L3 adapter (spec 2026-10-05 §6.2, §6.9, §6.11), imported directly
// (the compact-card.mjs precedent) and, where a pin needs a process that dies
// between two writes, run in a child killed by the test-only preload.
//
// Every store here lives in a mkTmp fixture HOME; nothing reads or writes the
// live ~/.ccrc. Runs on every platform: an L3 file under test in-process needs
// no carrier, and the children are plain node.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, constants as Z } from 'node:zlib';
import { mkTmp } from './tmpHelpers.js';
import { SCHEMA_ADDED, SCHEMA_VERSION, UUID_RE, WRITER_RE, decideStoreOpen, historyPaths } from '../../ccd/history/lib.mjs';
import {
  CODEC, MIGRATIONS, StoreError, openWriter, openReader, userVersion, probeFts5, withTx, brotli, unbrotli,
  measuredSize, getMeta, setMeta, bump, closeWriter, schemaOf,
  mintStoreId, mintWriter, writeFileAtomic, peekStoreId, measureStoreFacts, removeStaleTemps, createStore,
  finishPending, dropPending, syncWriterMirror,
  readAttempts, clearDoneMarkers, assertAdditive, runMigration,
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

describe('store.mjs: the binding', () => {
  const STORE = path.resolve(__dirname, '../../ccd/history/store.mjs');
  const FAULTS = path.resolve(__dirname, 'fixtures/history/preload-faults.mjs');
  const home = (): string => mkTmp('ccrc-history-bind-');
  /** createStore in a child that the fault preload SIGKILLs at the named call. The `timeout` bounds a
   *  child that hangs instead (vitest's testTimeout cannot interrupt a spawnSync); it ends one with
   *  SIGTERM, so a hang is never read as the preload's planned SIGKILL. */
  const createKilledAt = (h: string, kill: string): ReturnType<typeof spawnSync> => spawnSync(process.execPath, [
    '--no-warnings', '--import', pathToFileURL(FAULTS).href, '--input-type=module', '-e',
    `import { createStore } from ${JSON.stringify(pathToFileURL(STORE).href)}; createStore(process.argv[1]);`, h,
  ], {
    encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: h, HISTORY_TEST_KILL: kill },
    timeout: 60_000, killSignal: 'SIGTERM',
  });

  it('ids: a v4 store_id and an 8-hex writer token, fresh each call', () => {
    const a = mintStoreId(); const b = mintStoreId();
    expect(a).toMatch(UUID_RE);
    expect(a.split('-')[2]![0]).toBe('4');
    expect(a).not.toBe(b);
    expect(mintWriter()).toMatch(WRITER_RE);
  });

  it('writeFileAtomic leaves the file whole at 0600 and no temp, even over a stale temp with another mode', () => {
    const d = home();
    const p = path.join(d, 'store.writer');
    fs.writeFileSync(`${p}.tmp.${process.pid}`, 'stale', { mode: 0o644 });
    writeFileAtomic(p, 'abcdef01\n');
    expect(fs.readFileSync(p, 'utf8')).toBe('abcdef01\n');
    expect(mode(p)).toBe(0o600);
    expect(fs.readdirSync(d)).toEqual(['store.writer']);
  });

  it('createStore: §6.2 sequence end to end — binding files, modes, WAL, v1, and an `open` verdict after', () => {
    const h = home();
    const { storeId, writer } = createStore(h);
    const P = historyPaths(h);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(fs.readFileSync(P.writer, 'utf8').trim()).toBe(writer);
    expect(fs.existsSync(P.pending)).toBe(false);
    expect(fs.readdirSync(P.dbDir)).toEqual(['history.db']);
    expect(mode(P.root)).toBe(0o700);
    expect(mode(P.dbDir)).toBe(0o700);
    expect(mode(P.dbFile)).toBe(0o600);
    const r = new DatabaseSync(P.dbFile, { readOnly: true });
    expect(userVersion(r)).toBe(SCHEMA_VERSION);
    expect(pragma(r, 'journal_mode')).toBe('wal');
    expect(pragma(r, 'auto_vacuum')).toBe(2);
    expect(getMeta(r, 'store_id')).toBe(storeId);
    expect(getMeta(r, 'writer')).toBe(writer);
    r.close();
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'open' });
  });

  it('§9.14: store.writer is on disk before any marker names the store — a kill at the marker\'s write leaves the token alone', () => {
    const h = home();
    const P = historyPaths(h);
    // The FIRST rename naming store.id.pending is the marker's own temp rename
    // (store.id.pending.tmp.<pid>), killed before it runs: the state between the two binding writes.
    const r = createKilledAt(h, 'renameSync:store.id.pending:1');
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.pending)).toBe(false);
    expect(fs.readFileSync(P.writer, 'utf8').trim()).toMatch(WRITER_RE);
  });

  it('measureStoreFacts reports each binding read as value, absent or unreadable — never folded', () => {
    const h = home();
    const P = historyPaths(h);
    const fresh = measureStoreFacts(h, 'both');
    expect(fresh).toEqual({
      role: 'both', dbDir: 'absent', storeId: { state: 'absent' }, pending: { state: 'absent' }, writer: { state: 'absent' },
      db: 'absent', dbStoreId: { state: 'absent' }, wal: false, shm: false, journalStoreDirs: [], backupsDb: [],
    });
    fs.mkdirSync(P.dbDir, { recursive: true });
    fs.writeFileSync(P.storeId, 'not-a-uuid\n');
    fs.mkdirSync(P.writer);
    fs.writeFileSync(P.dbFile, '');
    fs.writeFileSync(P.wal, '');
    fs.mkdirSync(path.join(P.journalDir, '33333333-3333-4333-8333-333333333333'), { recursive: true });
    fs.mkdirSync(path.join(P.journalDir, 'not-a-store'));
    fs.mkdirSync(P.backups);
    fs.writeFileSync(path.join(P.backups, '20261005T000000Z.db'), 'x');
    fs.writeFileSync(path.join(P.backups, '.pre-v2.db.tmp'), 'x');
    const f = measureStoreFacts(h, 'fleet');
    expect(f.storeId).toEqual({ state: 'unreadable' });
    expect(f.writer).toEqual({ state: 'unreadable' });
    expect(f.db).toBe('zero-byte');
    expect(f.wal).toBe(true);
    expect(f.shm).toBe(false);
    expect(f.journalStoreDirs).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(f.backupsDb).toEqual(['20261005T000000Z.db']);
  });

  it('measureStoreFacts tells a dangling db/ link from an absent one, and follows a live link', () => {
    const h = home();
    const P = historyPaths(h);
    fs.mkdirSync(P.root, { recursive: true });
    fs.symlinkSync(path.join(h, 'volume-gone'), P.dbDir);
    expect(measureStoreFacts(h, 'fleet').dbDir).toBe('dangling');
    fs.mkdirSync(path.join(h, 'volume-gone'), { mode: 0o700 });
    expect(measureStoreFacts(h, 'fleet').dbDir).toBe('dir');
  });

  it('peekStoreId: the DB\'s own meta.store_id, absent without the row, unreadable for a file that is no store', () => {
    const h = home();
    const { storeId } = createStore(h);
    const P = historyPaths(h);
    expect(peekStoreId(P.dbFile)).toEqual({ state: 'value', value: storeId });
    const w = openWriter(P.dbFile);
    w.exec("DELETE FROM meta WHERE k = 'store_id'");
    closeWriter(w);
    expect(peekStoreId(P.dbFile)).toEqual({ state: 'absent' });
    const junk = path.join(h, 'junk.db');
    fs.writeFileSync(junk, 'this is not a database file at all, it is text\n'.repeat(40));
    expect(peekStoreId(junk)).toEqual({ state: 'unreadable' });
  });

  it('DM33: a creation killed before its link() leaves no history.db, and the next run creates the store', () => {
    // Two kill points: the temp just made (0 bytes), and the temp fully built
    // and closed but not yet fsynced or linked (the second open of its name).
    for (const kill of ['openSync:history.db.new.:1:after', 'openSync:history.db.new.:2']) {
      const h = home();
      const P = historyPaths(h);
      const r = createKilledAt(h, kill);
      expect(r.signal, `${kill}: ${String(r.stderr)}`).toBe('SIGKILL');
      expect(fs.existsSync(P.dbFile), kill).toBe(false);
      expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('history.db.new.')), kill).toHaveLength(1);
      expect(fs.existsSync(P.pending), kill).toBe(true);

      expect(decideStoreOpen(measureStoreFacts(h, 'fleet')), kill).toEqual({ act: 'drop-pending-create' });
      expect(removeStaleTemps(h), kill).toHaveLength(1);
      dropPending(h);
      const { storeId } = createStore(h);
      expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
      expect(peekStoreId(P.dbFile)).toEqual({ state: 'value', value: storeId });
      // (A read-only open of a WAL store makes its -wal and -shm, M 22.16.0: only temps are asserted gone.)
      expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('history.db.new.'))).toEqual([]);
    }
  });

  it('DM33b: a creation killed between the link() and the rename is finished, never refused; a foreign marker stays refused', () => {
    const h = home();
    const P = historyPaths(h);
    // The FIRST rename naming store.id.pending is the marker's own atomic write
    // (its temp is store.id.pending.tmp.<pid>); the SECOND is the rename to store.id.
    const r = createKilledAt(h, 'renameSync:store.id.pending:2');
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.dbFile)).toBe(true);
    expect(fs.existsSync(P.storeId)).toBe(false);
    const pending = fs.readFileSync(P.pending, 'utf8').trim();
    expect(peekStoreId(P.dbFile)).toEqual({ state: 'value', value: pending });

    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'finish-pending' });
    finishPending(h);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(pending);
    expect(fs.existsSync(P.pending)).toBe(false);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'open' });

    // CONTROL: the same DB beside a marker naming ANOTHER store is not this box's
    // creation — store-unbound, so S13's refusal is untouched.
    fs.renameSync(P.storeId, P.pending);
    fs.writeFileSync(P.pending, `${mintStoreId()}\n`);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'refuse', word: 'store-unbound' });
  });

  it('removeStaleTemps removes each writer temp WITH its sidecars, and nothing else', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    const plant = ['history.db.new.4242', 'history.db.new.4242-wal', 'history.db.new.4242-shm', 'history.db.new.4242-journal',
      '.history.db.restore.1700000000000', '.history.db.restore.1700000000000-wal', 'notes.txt'];
    for (const n of plant) fs.writeFileSync(path.join(P.dbDir, n), 'x');
    const removed = removeStaleTemps(h);
    expect(removed.sort()).toEqual(plant.filter((n) => n !== 'notes.txt').sort());
    expect(fs.readdirSync(P.dbDir).sort()).toEqual(['history.db', 'notes.txt']);
  });

  it('syncWriterMirror: meta.writer follows store.writer, and an absent file changes nothing', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    writeFileAtomic(P.writer, 'feedf00d\n');
    const db = openWriter(P.dbFile);
    syncWriterMirror(db, h);
    expect(getMeta(db, 'writer')).toBe('feedf00d');
    fs.rmSync(P.writer);
    syncWriterMirror(db, h);
    expect(getMeta(db, 'writer')).toBe('feedf00d');
    closeWriter(db);
  });
});

describe('store.mjs: the migration executor', () => {
  /** A bound store and its live writer, ready to migrate. */
  const bound = (): { h: string; db: DatabaseSync; storeId: string } => {
    const h = mkTmp('ccrc-history-mig-');
    const { storeId } = createStore(h);
    return { h, db: openWriter(historyPaths(h).dbFile), storeId };
  };
  /** A TEST-ONLY v2 and v3, passed in as data: shipped code has no v2. */
  const V2 = 'CREATE TABLE extra_v2 (x INTEGER); ALTER TABLE meta ADD COLUMN note TEXT;';
  const V3 = 'CREATE INDEX extra_v2_x ON extra_v2(x);';
  const TEST_MIGRATIONS = [MIGRATIONS[0]!, V2, V3];

  it('DM42 (executor half): every verdict but snapshot-then-migrate is refused, and nothing is written', () => {
    const { h, db } = bound();
    for (const verdict of ['none', 'refuse-newer', 'refuse-low-disk', 'snapshot-needs-op'] as const) {
      expect(wordOf(() => runMigration(db, h, { verdict, from: 1, to: 2, migrations: TEST_MIGRATIONS })), verdict)
        .toBe('migration-not-admitted');
    }
    expect(userVersion(db)).toBe(1);
    expect(fs.existsSync(historyPaths(h).backups)).toBe(false);
    closeWriter(db);
  });

  it('v1 -> v2: the snapshot opens at v1 with the same store_id, the live store reads v2, copy_bps is recorded', () => {
    const { h, db, storeId } = bound();
    const P = historyPaths(h);
    fs.mkdirSync(P.backups, { mode: 0o700 });
    fs.writeFileSync(path.join(P.backups, '.pre-v2.db.tmp'), 'a stale partial copy');
    fs.writeFileSync(path.join(P.backups, '.pre-v2.db.tmp-journal'), 'a stale hot journal');
    const out = runMigration(db, h, { verdict: 'snapshot-then-migrate', from: 1, to: 2, migrations: TEST_MIGRATIONS });
    expect(out.snapshot).toBe(path.join(P.backups, 'pre-v2.db'));
    expect(fs.readdirSync(P.backups).sort()).toEqual(['pre-v2.db']);
    expect(mode(out.snapshot)).toBe(0o600);
    const snap = new DatabaseSync(out.snapshot, { readOnly: true });
    expect(userVersion(snap)).toBe(1);
    expect(getMeta(snap, 'store_id')).toBe(storeId);
    snap.close();
    expect(userVersion(db)).toBe(2);
    expect(schemaOf(db)['extra_v2']).toEqual(['x']);
    expect(Number(getMeta(db, 'copy_bps'))).toBe(out.copyBps);
    expect(out.copyBps).toBeGreaterThan(0);
    closeWriter(db);
  });

  it('v2 -> v3 keeps only the newest pre-migration snapshot, and never touches an operator <ts>.db', () => {
    const { h, db } = bound();
    const P = historyPaths(h);
    runMigration(db, h, { verdict: 'snapshot-then-migrate', from: 1, to: 2, migrations: TEST_MIGRATIONS });
    fs.writeFileSync(path.join(P.backups, '20261005T000000Z.db'), 'an operator backup');
    runMigration(db, h, { verdict: 'snapshot-then-migrate', from: 2, to: 3, migrations: TEST_MIGRATIONS });
    expect(fs.readdirSync(P.backups).sort()).toEqual(['20261005T000000Z.db', 'pre-v3.db']);
    expect(fs.readFileSync(path.join(P.backups, '20261005T000000Z.db'), 'utf8')).toBe('an operator backup');
    expect(userVersion(db)).toBe(3);
    closeWriter(db);
  });

  it('a migration that drops or renames a column is refused and rolled back, its marker left as an attempt', () => {
    const { h, db } = bound();
    const DROPS = 'ALTER TABLE counters RENAME COLUMN n TO total;';
    expect(wordOf(() => runMigration(db, h, {
      verdict: 'snapshot-then-migrate', from: 1, to: 2, migrations: [MIGRATIONS[0]!, DROPS],
    }))).toBe('migration-not-additive');
    expect(userVersion(db)).toBe(1);
    expect(schemaOf(db)['counters']).toEqual(['name', 'n']);
    expect(readAttempts(h, 2)).toBe(1);
    closeWriter(db);
  });

  it('assertAdditive: an added table or column passes; a dropped table, a dropped or renamed column throws', () => {
    const prev = { meta: ['k', 'v'], counters: ['name', 'n'] };
    expect(() => assertAdditive(prev, { ...prev, extra: ['x'], meta: ['k', 'v', 'note'] })).not.toThrow();
    expect(() => assertAdditive(prev, { meta: ['k', 'v'] })).toThrow(/counters/);
    expect(() => assertAdditive(prev, { meta: ['k', 'v'], counters: ['name', 'total'] })).toThrow(/counters\.n/);
  });

  it('readAttempts: absent is 0, a count reads as itself, anything else escalates to the cap', () => {
    const { h, db } = bound();
    closeWriter(db);
    const P = historyPaths(h);
    expect(readAttempts(h, 2)).toBe(0);
    fs.mkdirSync(P.backups, { mode: 0o700 });
    fs.writeFileSync(path.join(P.backups, '.pre-v2.attempt'), '1\n');
    expect(readAttempts(h, 2)).toBe(1);
    fs.writeFileSync(path.join(P.backups, '.pre-v2.attempt'), 'garbled');
    expect(readAttempts(h, 2)).toBe(2);
  });

  it('O51: a killed creation\'s temp and its -wal go together, a recycled pid starts clean, and a done marker is cleared', () => {
    const h = mkTmp('ccrc-history-mig-');
    const P = historyPaths(h);
    fs.mkdirSync(P.dbDir, { recursive: true, mode: 0o700 });
    const recycled = `history.db.new.${process.pid}`;
    // A sidecar with no temp beside it: O_EXCL alone would let this pid create
    // the temp, and SQLite would then pair the stale WAL with it by name.
    fs.writeFileSync(path.join(P.dbDir, `${recycled}-wal`), 'its wal');
    expect(() => createStore(h)).toThrow(/never opened/);
    fs.writeFileSync(path.join(P.dbDir, recycled), 'half a database');
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'drop-pending-create' });
    expect(removeStaleTemps(h).sort()).toEqual([recycled, `${recycled}-wal`]);
    dropPending(h);
    createStore(h);
    expect(fs.readdirSync(P.dbDir)).toEqual(['history.db']);

    fs.mkdirSync(P.backups, { mode: 0o700 });
    fs.writeFileSync(path.join(P.backups, '.pre-v2.attempt'), '1\n');
    fs.writeFileSync(path.join(P.backups, '.pre-v3.attempt'), '1\n');
    expect(clearDoneMarkers(h, 1)).toEqual([]);
    expect(clearDoneMarkers(h, 2)).toEqual(['.pre-v2.attempt']);
    expect(fs.readdirSync(P.backups)).toEqual(['.pre-v3.attempt']);
  });
});
