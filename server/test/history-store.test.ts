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
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, constants as Z } from 'node:zlib';
import { mkTmp } from './tmpHelpers.js';
import { recordDirFsyncs, recordOpenFlags, rewindStoreToV1, plantBlobs, owedIndexFacts } from './historyHelpers.js';
import { INDEXED_PROVENANCE, BLOB_DECODE_MAX, SIDECAR_WHOLE_MAX, makePairIndex, MAX_INTERRUPTED_ATTEMPTS, SCHEMA_ADDED, SCHEMA_VERSION, UUID_RE, WRITER_RE, decideStoreOpen, historyPaths, backupNameOf, FTS_SHADOWS, ftsTablesHealthy } from '../../ccd/history/lib.mjs';
import {
  CODEC, MIGRATIONS, OWED_INDEX, V2_INDEXES, StoreError, openWriter, openReader, userVersion, probeFts5, withTx, brotli, unbrotli,
  measuredSize, getMeta, setMeta, bump, closeWriter, schemaOf,
  mintStoreId, mintWriter, writeFileAtomic, peekStoreId, measureStoreFacts, removeStaleTemps, removeStaleMigrationTemps, createStore,
  finishPending, dropPending, syncWriterMirror, createFtsTables, integrityCheck, foreignKeyRows, ftsMeasure, dropFtsTables, setCounter,
  pruneProtected, pruneCandidates, pruneBatch, pruneDryRun, incrementalVacuum, pruneApply,
  readAttempts, measureAttempts, clearDoneMarkers, assertAdditive, runMigration, removeEntry, readBounded, removeStaleAtomicTemps, mkdirDurable,
  writeBackup, blobPlainText, blobPlainTextMeasured,
} from '../../ccd/history/store.mjs';
import { adoptStore, stageRestore, commitRestore, abortRestore } from '../../ccd/history/store.mjs';
import { parseJournalRecord } from '../../ccd/history/lib.mjs';

/** A delete-mode (rollback-journal) store at this build's schema, built by hand, the shape a
 *  `VACUUM INTO` restore leaves: no createStore, no binding files. It runs every migration, as createStore does
 *  (D-5015: v2 adds the owed-row index); `MIGRATIONS[0]` alone is the v1 schema. */
const v1Store = (dir: string): string => {
  const p = path.join(dir, 'history.db');
  const db = new DatabaseSync(p);
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  for (const m of MIGRATIONS) db.exec(m);
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
  it('the code\'s schema version is one number: MIGRATIONS.length === SCHEMA_VERSION === the highest SCHEMA_ADDED key', () => {
    const highest = Math.max(...Object.keys(SCHEMA_ADDED).map(Number));
    expect(MIGRATIONS.length).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(highest);
    // Every version from 1 to the code's has an entry and a migration: no gap a bump could hide behind.
    for (let v = 1; v <= SCHEMA_VERSION; v++) expect(Object.keys(SCHEMA_ADDED), `SCHEMA_ADDED lacks v${v}`).toContain(String(v));
  });

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
    // The second lock: with query_only lifted, the readOnly open flag alone must still refuse a write.
    r.exec('PRAGMA query_only = OFF');
    expect(() => r.exec("INSERT INTO meta (k, v) VALUES ('x', 'y')")).toThrow(/readonly database/);
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
    expect(unbrotli(z, text.length).equals(text)).toBe(true);
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

  /** Run `fn` with `fs.writeSync` replaced by a seam that takes both call forms (the string form HEAD used and the
   *  buffer form), counting its calls; the real function is restored in `finally`. `rule` answers each call. */
  const withWriteSeam = (rule: (call: number, real: typeof fs.writeSync, fd: number, buf: Buffer, off: number, len: number) => number, fn: () => void): void => {
    const real = fs.writeSync; let calls = 0;
    fs.writeSync = ((fd: number, data: string | NodeJS.ArrayBufferView, a?: number, b?: number) => {
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const off = typeof data === 'string' ? 0 : (a ?? 0); const len = typeof data === 'string' ? buf.length : (b ?? buf.length - off);
      calls += 1; return rule(calls, real, fd, buf, off, len);
    }) as typeof fs.writeSync;
    syncBuiltinESMExports();
    try { fn(); } finally { fs.writeSync = real; syncBuiltinESMExports(); }
  };
  const tmpNames = (d: string): string[] => fs.readdirSync(d).filter((n) => n.includes('.tmp.'));

  it('writeFileAtomic finishes a short write and leaves the file whole (review 316 F21)', () => {
    const d = home();
    const p = path.join(d, 'store.writer');
    withWriteSeam((call, real, fd, buf, off, len) => (call === 1 ? real(fd, buf, off, Math.floor(len / 2)) : real(fd, buf, off, len)), () => {
      writeFileAtomic(p, 'abcdef01\n');
    });
    expect(fs.readFileSync(p, 'utf8')).toBe('abcdef01\n');
    expect(tmpNames(d)).toEqual([]);
  });

  it('a write that makes no progress throws and leaves no temp (review 316 F21)', () => {
    const d = home();
    const p = path.join(d, 'store.writer');
    withWriteSeam(() => 0, () => {
      expect(() => writeFileAtomic(p, 'abcdef01\n')).toThrow(/short write/);
    });
    expect(fs.existsSync(p)).toBe(false);
    expect(tmpNames(d)).toEqual([]);
  });

  it('a link planted at its own temp name is never written through (review 316 F21)', () => {
    const d = home();
    const p = path.join(d, 'store.writer');
    const outside = path.join(d, 'outside');
    fs.writeFileSync(outside, 'ORIG');
    fs.symlinkSync(outside, `${p}.tmp.${process.pid}`);
    writeFileAtomic(p, 'abcdef01\n');
    expect(fs.readFileSync(outside, 'utf8')).toBe('ORIG');
    expect(fs.lstatSync(p).isFile()).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toBe('abcdef01\n');
  });

  it('a temp a killed write left is swept by removeStaleAtomicTemps, and nothing else (review 316 F21)', () => {
    const h = home();
    const P = historyPaths(h);
    const k = createKilledAt(h, 'renameSync:store.writer.tmp:1:before');
    expect(k.signal, String(k.stderr)).toBe('SIGKILL');
    const killedTemp = fs.readdirSync(P.root).filter((n) => /^store\.writer\.tmp\.[0-9]+$/.test(n));
    expect(killedTemp).toHaveLength(1);
    fs.writeFileSync(path.join(P.root, 'notes.tmp.12'), 'x');
    fs.writeFileSync(path.join(P.root, 'store.writer.tmpx'), 'x');
    fs.mkdirSync(P.backups, { recursive: true });
    fs.writeFileSync(path.join(P.backups, '.pre-v2.attempt.tmp.99'), 'x');
    fs.writeFileSync(path.join(P.backups, 'pre-v2.db.tmp.5'), 'x');
    expect(removeStaleAtomicTemps(h)).toEqual([...killedTemp, '.pre-v2.attempt.tmp.99']);
    expect(fs.existsSync(path.join(P.root, 'notes.tmp.12'))).toBe(true);
    expect(fs.existsSync(path.join(P.root, 'store.writer.tmpx'))).toBe(true);
    expect(fs.existsSync(path.join(P.backups, 'pre-v2.db.tmp.5'))).toBe(true);
    expect(fs.existsSync(path.join(P.backups, '.pre-v2.attempt.tmp.99'))).toBe(false);
  });

  // Tick-stale review T2 (D-5016): the scheduled pass's marker is written with writeFileAtomic too, so its temp is swept like the others.
  it('a pass.tmp.<pid> a killed marker write left is swept by removeStaleAtomicTemps; the marker itself and look-alikes are not (D-5016, T2)', () => {
    const h = home();
    const P = historyPaths(h);
    fs.mkdirSync(P.root, { recursive: true });
    fs.writeFileSync(path.join(P.root, 'pass.tmp.4242'), 'x');
    fs.writeFileSync(path.join(P.root, 'pass'), '1 2 3 4\n');
    fs.writeFileSync(path.join(P.root, 'pass.tmp.x'), 'x');
    fs.writeFileSync(path.join(P.root, 'passes.tmp.7'), 'x');
    expect(removeStaleAtomicTemps(h), 'only the pass temp').toEqual(['pass.tmp.4242']);
    expect(fs.existsSync(path.join(P.root, 'pass.tmp.4242'))).toBe(false);
    for (const keep of ['pass', 'pass.tmp.x', 'passes.tmp.7']) expect(fs.existsSync(path.join(P.root, keep)), `CONTROL: ${keep} stays`).toBe(true);
  });

  // D-5026: the death record is written with writeFileAtomic too, so a killed write's temp is swept like the marker's.
  it('a pass-died.tmp.<pid> a killed record write left is swept by removeStaleAtomicTemps; the record itself and look-alikes are not (D-5026)', () => {
    const h = home();
    const P = historyPaths(h);
    fs.mkdirSync(P.root, { recursive: true });
    fs.writeFileSync(path.join(P.root, 'pass-died.tmp.4242'), 'x');
    fs.writeFileSync(path.join(P.root, 'pass-died'), '{}\n');
    fs.writeFileSync(path.join(P.root, 'pass-died.tmp.x'), 'x');
    fs.writeFileSync(path.join(P.root, 'pass-diedx.tmp.7'), 'x');
    expect(removeStaleAtomicTemps(h), 'only the record\'s temp').toEqual(['pass-died.tmp.4242']);
    expect(fs.existsSync(path.join(P.root, 'pass-died.tmp.4242'))).toBe(false);
    for (const keep of ['pass-died', 'pass-died.tmp.x', 'pass-diedx.tmp.7']) expect(fs.existsSync(path.join(P.root, keep)), `CONTROL: ${keep} stays`).toBe(true);
  });

  it('mkdirDurable fsyncs every parent that gained an entry, top-down, and nothing when the directory exists (review 316 F23)', () => {
    const base = home();
    const first = recordDirFsyncs(() => mkdirDurable(`${base}/a/b/c`));
    expect(first.out).toBe(true);
    expect(first.dirs).toEqual([base, `${base}/a`, `${base}/a/b`]);
    const again = recordDirFsyncs(() => mkdirDurable(`${base}/a/b/c`));
    expect(again.out).toBe(false);
    expect(again.dirs).toEqual([]);
  });

  it('createStore fsyncs the directory that gained ~/.ccrc and the root (review 316 F23)', () => {
    const h = home();
    expect(recordDirFsyncs(() => createStore(h)).dirs.slice(0, 3)).toEqual([h, `${h}/.ccrc`, historyPaths(h).root]);
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

  // Root bypasses mode 000, so an unlistable directory cannot be made as uid 0.
  it.skipIf(process.getuid?.() === 0)('an evidence directory that exists but cannot be listed is ONE "(unlistable)" entry, and a both-absent store refuses store-recoverable', () => {
    // journal/ unlistable, no db/ at all.
    const h1 = home();
    const P1 = historyPaths(h1);
    fs.mkdirSync(P1.journalDir, { recursive: true });
    fs.chmodSync(P1.journalDir, 0o000);
    try {
      const f = measureStoreFacts(h1, 'fleet');
      expect(f.db).toBe('absent');
      expect(f.storeId).toEqual({ state: 'absent' });
      expect(f.journalStoreDirs).toEqual(['(unlistable)']);
      expect(decideStoreOpen(f)).toEqual({ act: 'refuse', word: 'store-recoverable' });
    } finally {
      fs.chmodSync(P1.journalDir, 0o700);
    }
    // db/backups/ unlistable under a real db/ with no history.db.
    const h2 = home();
    const P2 = historyPaths(h2);
    fs.mkdirSync(P2.backups, { recursive: true });
    fs.chmodSync(P2.backups, 0o000);
    try {
      const f = measureStoreFacts(h2, 'fleet');
      expect(f.dbDir).toBe('dir');
      expect(f.db).toBe('absent');
      expect(f.backupsDb).toEqual(['(unlistable)']);
      expect(decideStoreOpen(f)).toEqual({ act: 'refuse', word: 'store-recoverable' });
    } finally {
      fs.chmodSync(P2.backups, 0o700);
    }
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

  it('removeStaleTemps answers [] for an absent db/ (ENOENT), and removes nothing there (D-4305)', () => {
    const h = home();
    expect(removeStaleTemps(h)).toEqual([]);
  });

  it('removeStaleMigrationTemps removes every backups/.pre-v<N>.db.tmp (and -journal) for ANY N, answers their bytes, and keeps snapshots, markers and operator backups (D-4339)', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    fs.mkdirSync(P.backups, { recursive: true });
    const temps: Array<[string, number]> = [['.pre-v2.db.tmp', 300], ['.pre-v2.db.tmp-journal', 20], ['.pre-v9.db.tmp', 7]];
    for (const [n, size] of temps) fs.writeFileSync(path.join(P.backups, n), Buffer.alloc(size, 0x61));
    const keep = ['pre-v2.db', '.pre-v2.attempt', '20261005T000000Z.db', '.pre-v2.db.tmpx', 'pre-v2.db.tmp'];
    for (const n of keep) fs.writeFileSync(path.join(P.backups, n), 'x');
    const r = removeStaleMigrationTemps(h);
    expect(r.removed.sort()).toEqual(temps.map(([n]) => n).sort());
    expect(r.bytes).toBe(327);
    expect(fs.readdirSync(P.backups).sort()).toEqual([...keep].sort());
    expect(removeStaleMigrationTemps(h)).toEqual({ removed: [], bytes: 0 });
  });

  it('removeStaleMigrationTemps answers nothing for an absent backups/ (ENOENT)', () => {
    expect(removeStaleMigrationTemps(home())).toEqual({ removed: [], bytes: 0 });
  });

  // Root bypasses mode 0o100, so backups/ cannot be made unlistable as uid 0.
  it.skipIf(process.getuid?.() === 0)('removeStaleMigrationTemps answers no credit, and does not throw, for an unlistable backups/ (D-4339 round 1)', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    fs.mkdirSync(P.backups, { recursive: true });
    fs.writeFileSync(path.join(P.backups, '.pre-v2.db.tmp'), Buffer.alloc(40, 0x61));
    fs.chmodSync(P.backups, 0o100);
    try {
      expect(removeStaleMigrationTemps(h)).toEqual({ removed: [], bytes: 0 });
    } finally {
      fs.chmodSync(P.backups, 0o700);
    }
    expect(fs.existsSync(path.join(P.backups, '.pre-v2.db.tmp')), 'the temp it could not see is still there').toBe(true);
  });

  it('removeStaleMigrationTemps does not throw for a directory planted under a temp name, credits nothing for it, and still removes the others (D-4339 round 1)', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    fs.mkdirSync(path.join(P.backups, '.pre-v2.db.tmp'), { recursive: true });
    fs.writeFileSync(path.join(P.backups, '.pre-v2.db.tmp', 'inner'), 'x');
    fs.writeFileSync(path.join(P.backups, '.pre-v3.db.tmp'), Buffer.alloc(9, 0x61));
    fs.mkdirSync(path.join(P.backups, '.pre-v4.db.tmp'));                    // an EMPTY directory is removed, with no credit (review 316 F22)
    expect(removeStaleMigrationTemps(h)).toEqual({ removed: ['.pre-v3.db.tmp', '.pre-v4.db.tmp'], bytes: 9 });
    expect(fs.existsSync(path.join(P.backups, '.pre-v2.db.tmp', 'inner'))).toBe(true);
  });

  // M23: only the FIFO row is Linux-only; the directory rows run on every platform.
  it('removeStaleTemps removes an empty directory at a writer temp name, keeps a non-empty one, and never throws (review 316 F22)', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    const fifo = process.platform !== 'darwin';
    fs.mkdirSync(path.join(P.dbDir, 'history.db.new.77'));
    fs.mkdirSync(path.join(P.dbDir, '.history.db.restore.1'));
    fs.writeFileSync(path.join(P.dbDir, '.history.db.restore.1', 'inner'), 'x');
    if (fifo) expect(spawnSync('mkfifo', [path.join(P.dbDir, 'history.db.new.78-wal')]).status).toBe(0);
    expect(removeStaleTemps(h)).toEqual(fifo ? ['history.db.new.77', 'history.db.new.78-wal'] : ['history.db.new.77']);
    expect(fs.readFileSync(path.join(P.dbDir, '.history.db.restore.1', 'inner'), 'utf8')).toBe('x');
  });

  it('clearDoneMarkers never throws on a directory at a marker name (review 316 F22)', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    fs.mkdirSync(path.join(P.backups, '.pre-v1.attempt'), { recursive: true });
    expect(clearDoneMarkers(h, 1)).toEqual(['.pre-v1.attempt']);
    expect(fs.existsSync(path.join(P.backups, '.pre-v1.attempt'))).toBe(false);
    fs.mkdirSync(path.join(P.backups, '.pre-v1.attempt'));
    fs.writeFileSync(path.join(P.backups, '.pre-v1.attempt', 'inner'), 'x');
    expect(clearDoneMarkers(h, 1)).toEqual([]);
    expect(fs.existsSync(path.join(P.backups, '.pre-v1.attempt', 'inner'))).toBe(true);
  });

  // Root bypasses mode 0o100, so db/ cannot be made unlistable as uid 0.
  it.skipIf(process.getuid?.() === 0)('an unlistable db/ throws instead of reading as nothing stale (D-4305)', () => {
    const h = home();
    const P = historyPaths(h);
    fs.mkdirSync(P.dbDir, { recursive: true });
    fs.writeFileSync(path.join(P.dbDir, '.history.db.restore.1700000000000'), 'x');
    fs.chmodSync(P.dbDir, 0o100); // search but no read: readdir fails EACCES, the temp inside is out of sight
    try {
      expect(() => removeStaleTemps(h)).toThrow(/EACCES/);
    } finally {
      fs.chmodSync(P.dbDir, 0o700);
    }
    expect(fs.existsSync(path.join(P.dbDir, '.history.db.restore.1700000000000'))).toBe(true);
    expect(removeStaleTemps(h)).toEqual(['.history.db.restore.1700000000000']);
  });

  it('an attempt marker that is a link reads as the escalating count: only db/ may hold a link (review 316 F10)', () => {
    const h = home();
    createStore(h);
    const P = historyPaths(h);
    fs.mkdirSync(P.backups, { recursive: true });
    const marker = path.join(P.backups, '.pre-v2.attempt');
    fs.writeFileSync(marker, '1\n');
    expect(readAttempts(h, 2), 'CONTROL: a regular marker reads its count').toBe(1);
    fs.rmSync(marker);
    const real = path.join(h, 'real-attempt');
    fs.writeFileSync(real, '1\n');
    fs.symlinkSync(real, marker);
    expect(readAttempts(h, 2)).toBe(MAX_INTERRUPTED_ATTEMPTS);
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
    rewindStoreToV1(historyPaths(h).dbFile);   // createStore makes this build's v2; these cases migrate a v1 through injected migrations
    return { h, db: openWriter(historyPaths(h).dbFile), storeId };
  };
  /** A TEST-ONLY v2 and v3, passed in as data, over the v1 DDL alone: they stand in for builds past v1 (the shipped v2 is the owed-row index). */
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

  it('runMigration fsyncs db/ when it creates backups/ (review 316 F23)', () => {
    const { h, db } = bound();
    const P = historyPaths(h);
    expect(fs.existsSync(P.backups)).toBe(false);
    const { dirs } = recordDirFsyncs(() => runMigration(db, h, { verdict: 'snapshot-then-migrate', from: 1, to: 2, migrations: TEST_MIGRATIONS }));
    expect(dirs.indexOf(P.dbDir)).toBeGreaterThanOrEqual(0);
    expect(dirs.indexOf(P.dbDir)).toBeLessThan(dirs.indexOf(P.backups));
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

  it('the attempt marker counts: each interrupted attempt raises it by one, from a planted count too (the escalation to snapshot-needs-op reads it)', () => {
    const { h, db } = bound();
    const P = historyPaths(h);
    const DROPS = 'ALTER TABLE counters RENAME COLUMN n TO total;';
    const failing = { verdict: 'snapshot-then-migrate', from: 1, to: 2, migrations: [MIGRATIONS[0]!, DROPS] } as const;
    expect(wordOf(() => runMigration(db, h, failing))).toBe('migration-not-additive');
    expect(readAttempts(h, 2)).toBe(1);
    expect(wordOf(() => runMigration(db, h, failing))).toBe('migration-not-additive');
    expect(readAttempts(h, 2)).toBe(2);
    // A count planted by an earlier, killed attempt is carried forward, not reset.
    fs.writeFileSync(path.join(P.backups, '.pre-v2.attempt'), '1\n');
    expect(wordOf(() => runMigration(db, h, failing))).toBe('migration-not-additive');
    expect(readAttempts(h, 2)).toBe(2);
    expect(userVersion(db)).toBe(1);
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

  it('measureAttempts says which condition it was: absent, a count, or unmeasured (an unreadable, empty or garbled marker); readAttempts derives from it (FIN2)', () => {
    const { h, db } = bound();
    closeWriter(db);
    const P = historyPaths(h);
    const marker = path.join(P.backups, '.pre-v2.attempt');
    expect(measureAttempts(h, 2), 'no backups directory: absent').toEqual({ state: 'absent', count: 0 });
    fs.mkdirSync(P.backups, { mode: 0o700 });
    expect(measureAttempts(h, 2), 'no marker: absent').toEqual({ state: 'absent', count: 0 });
    const cases: Array<[string, string, { state: string; count: number }]> = [
      ['one', '1\n', { state: 'count', count: 1 }],
      ['zero', '0\n', { state: 'count', count: 0 }],
      ['the cap', `${MAX_INTERRUPTED_ATTEMPTS}\n`, { state: 'count', count: MAX_INTERRUPTED_ATTEMPTS }],
      ['garbled', 'garbled', { state: 'unmeasured', count: MAX_INTERRUPTED_ATTEMPTS }],
      ['empty', '', { state: 'unmeasured', count: MAX_INTERRUPTED_ATTEMPTS }],
      ['a number with a tail', '1 attempt\n', { state: 'unmeasured', count: MAX_INTERRUPTED_ATTEMPTS }],
    ];
    for (const [name, body, want] of cases) {
      fs.writeFileSync(marker, body);
      expect(measureAttempts(h, 2), name).toEqual(want);
      expect(readAttempts(h, 2), `${name}: readAttempts is the same count`).toBe(want.count);
    }
    fs.rmSync(marker);
    const real = path.join(h, 'real-attempt');
    fs.writeFileSync(real, '1\n');
    fs.symlinkSync(real, marker);
    expect(measureAttempts(h, 2), 'a link is unreadable: unmeasured').toEqual({ state: 'unmeasured', count: MAX_INTERRUPTED_ATTEMPTS });
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

describe('store.mjs: removeEntry (review 316 F8; D-4347 (history-planted-entries-never-wedge))', () => {
  it('a regular file answers removed, an absent path absent, and a symlink to a directory removes only the link', () => {
    const d = mkTmp('ccrc-history-rm-');
    const f = path.join(d, 'f');
    fs.writeFileSync(f, 'x');
    expect(removeEntry(f)).toBe('removed');
    expect(fs.existsSync(f)).toBe(false);
    expect(removeEntry(path.join(d, 'nope'))).toBe('absent');
    const target = path.join(d, 'target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'inside'), 'x');
    const link = path.join(d, 'link');
    fs.symlinkSync(target, link);
    expect(removeEntry(link)).toBe('removed');
    expect(fs.lstatSync(target).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(target, 'inside'))).toBe(true);
  });

  it.skipIf(process.platform === 'darwin')('a FIFO answers removed', () => {
    const p = path.join(mkTmp('ccrc-history-rm-'), 'fifo');
    expect(spawnSync('mkfifo', [p]).status).toBe(0);
    expect(removeEntry(p)).toBe('removed');
    expect(fs.existsSync(p)).toBe(false);
  });

  it('an empty directory answers removed; a directory holding a file answers kept-dir and keeps its file', () => {
    const d = mkTmp('ccrc-history-rm-');
    const empty = path.join(d, 'empty');
    fs.mkdirSync(empty);
    expect(removeEntry(empty)).toBe('removed');
    expect(fs.existsSync(empty)).toBe(false);
    const full = path.join(d, 'full');
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, 'keep'), 'x');
    expect(removeEntry(full)).toBe('kept-dir');
    expect(fs.readFileSync(path.join(full, 'keep'), 'utf8')).toBe('x');
  });
});

describe('store.mjs: readBounded (review 316 F10, F18; D-4347 (history-planted-entries-never-wedge))', () => {
  const STORE = path.resolve(__dirname, '../../ccd/history/store.mjs');
  const dir = (): string => mkTmp('ccrc-history-rb-');

  it('an absent path answers absent; a short file answers its text; exactly max bytes still answers value', () => {
    const d = dir();
    expect(readBounded(path.join(d, 'nope'), 64, false)).toEqual({ state: 'absent' });
    fs.writeFileSync(path.join(d, 'f'), 'abc');
    expect(readBounded(path.join(d, 'f'), 64, false)).toEqual({ state: 'value', value: 'abc' });
    fs.writeFileSync(path.join(d, 'edge'), 'a'.repeat(64));
    expect(readBounded(path.join(d, 'edge'), 64, false)).toEqual({ state: 'value', value: 'a'.repeat(64) });
  });

  it('a file over max answers over-cap, never its text', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'big'), 'a'.repeat(65));
    expect(readBounded(path.join(d, 'big'), 64, false)).toEqual({ state: 'over-cap' });
  });

  it('a symlink to a regular file is unreadable when follow is false and its text when follow is true', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'real'), 'abc');
    fs.symlinkSync(path.join(d, 'real'), path.join(d, 'link'));
    expect(readBounded(path.join(d, 'link'), 64, false)).toEqual({ state: 'unreadable' });
    expect(readBounded(path.join(d, 'link'), 64, true)).toEqual({ state: 'value', value: 'abc' });
  });

  it('a directory and a followed link to /dev/zero are unreadable, not read', () => {
    const d = dir();
    fs.mkdirSync(path.join(d, 'sub'));
    expect(readBounded(path.join(d, 'sub'), 64, true)).toEqual({ state: 'unreadable' });
    fs.symlinkSync('/dev/zero', path.join(d, 'zero'));
    expect(readBounded(path.join(d, 'zero'), 64, true)).toEqual({ state: 'unreadable' });
  });

  // M22: a scheduled pass is its unit's session leader with no controlling terminal; opening a terminal without
  // O_NOCTTY would make it one, so a later hangup on it could signal the pass. A followed link can reach one.
  it.each([[false], [true]])('opens with O_NOCTTY and O_NONBLOCK (follow %s), so a linked terminal never becomes the pass\'s controlling terminal (M22)', (follow) => {
    const d = dir();
    const f = path.join(d, 'f');
    fs.writeFileSync(f, 'abc');
    const { out, opens } = recordOpenFlags(() => readBounded(f, 64, follow));
    expect(out).toEqual({ state: 'value', value: 'abc' });
    const mine = opens.filter((o) => o.path === f);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.flags & fs.constants.O_NOCTTY).toBe(fs.constants.O_NOCTTY);
    expect(mine[0]!.flags & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
    expect(mine[0]!.flags & fs.constants.O_NOFOLLOW).toBe(follow ? 0 : fs.constants.O_NOFOLLOW);
  });

  // Root bypasses mode 000.
  it.skipIf(process.getuid?.() === 0)('a file with mode 000 is unreadable, not absent', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'locked'), 'abc', { mode: 0o000 });
    expect(readBounded(path.join(d, 'locked'), 64, false)).toEqual({ state: 'unreadable' });
  });

  // Run in a CHILD, so a regression that blocks in open(2) cannot wedge this worker: the child is killed by the timeout.
  it.skipIf(process.platform === 'darwin')('a FIFO with no writer answers unreadable at once and is never waited on', () => {
    const d = dir();
    const fifo = path.join(d, 'fifo');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      `import { readBounded } from ${JSON.stringify(pathToFileURL(STORE).href)}; process.stdout.write(JSON.stringify(readBounded(process.argv[1], 64, false)));`, fifo],
    { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: d }, timeout: 10_000, killSignal: 'SIGTERM' });
    expect(r.status, String(r.stderr)).toBe(0);
    expect(r.stdout).toBe('{"state":"unreadable"}');
  });
});

// ── W1-B2 Task 9: the lineage range CTE (P7) and the edge lookups — DM9 (spec 2026-10-05 §6.3, §6.7) ───────
// On real SQLite: a condensed node's lineage is its SOURCES (the leaves it condenses, then their entries), never
// its consumers; the walk survives a cycle (UNION); childrenOf and parentOf read the two directions by name.
import * as v9s from 'vitest';
import * as tmp9s from './tmpHelpers.js';
import * as lib9s from '../../ccd/history/lib.mjs';
import * as store9s from '../../ccd/history/store.mjs';
import type { DatabaseSync as Db9s } from 'node:sqlite';

const T9S = 'd9a00000-1111-4111-8111-111111111111';

/** One family, one transcript, four entries; leaves L1 (entries 1, 2) and L2 (entries 3, 4) under parent N. */
function lineageStore9(): { db: Db9s; l1: string; l2: string; n: string } {
  const home = tmp9s.mkTmp('ccrc-hist-dm9-');
  store9s.createStore(home);
  const db = store9s.openWriter(lib9s.historyPaths(home).dbFile);
  const l1 = lib9s.leafId('claude-a-demo', T9S, 'span-1');
  const l2 = lib9s.leafId('claude-a-demo', T9S, 'span-2');
  const n = lib9s.parentId([l1, l2]);
  db.exec('BEGIN');
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'claude-a-demo', '', 'demo', 1)").run();
  db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(T9S);
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 7), Buffer.from([0]));
  const ent = db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 1, 'user', 'operator', 1, 0, 0, 1, ?)");
  for (let k = 1; k <= 4; k += 1) ent.run(k, `d9a00000-0000-4000-8000-${k.toString(16).padStart(12, '0')}`, 1000 + k);
  const node = db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, parser_version, created_ms) VALUES (?, 1, 1, 1, ?, ?, 'ok', 1, 1)");
  node.run(l1, 'native_leaf', 0);
  node.run(l2, 'native_leaf', 0);
  node.run(n, 'condensed', 1);
  const src = db.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, ?)');
  src.run(l1, 1, 0); src.run(l1, 2, 1); src.run(l2, 3, 0); src.run(l2, 4, 1);
  const kid = db.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, ?)');
  kid.run(n, l1, 0); kid.run(n, l2, 1);
  db.exec('COMMIT');
  return { db, l1, l2, n };
}

v9s.describe('DM9: the lineage walks toward a node\'s sources, on real SQLite (W1-B2 Task 9)', () => {
  v9s.it('a condensed node\'s lineage lists its sources\' entries; a leaf\'s lists its own; the edges read both ways', () => {
    const { db, l1, l2, n } = lineageStore9();
    try {
      const of = (id: string): number[] => store9s.lineageEntries(db, id).map((r) => r.entryId).sort((a, b) => a - b);
      v9s.expect(of(n), 'the parent condenses L1 and L2: their four entries').toEqual([1, 2, 3, 4]);
      v9s.expect(of(l1)).toEqual([1, 2]);
      // Rows come grouped by leaf id (code-unit order) and in each leaf's ord.
      const byLeaf = [[l1, 0, 1001], [l1, 1, 1002], [l2, 0, 1003], [l2, 1, 1004]];
      const expected = l1 < l2 ? byLeaf : [...byLeaf.slice(2), ...byLeaf.slice(0, 2)];
      v9s.expect(store9s.lineageEntries(db, n).map((r) => [r.nodeId, r.ord, r.tsMs])).toEqual(expected);
      v9s.expect(store9s.childrenOf(db, n)).toEqual([{ childId: l1, ord: 0 }, { childId: l2, ord: 1 }]);
      v9s.expect(store9s.childrenOf(db, l1)).toEqual([]);
      v9s.expect(store9s.parentOf(db, l1)).toBe(n);
      v9s.expect(store9s.parentOf(db, n)).toBeNull();
    } finally {
      db.close();
    }
  });

  v9s.it('a cycle in node_children ends the walk (UNION), and the lineage stays the sources\'', () => {
    const { db, l2, n } = lineageStore9();
    try {
      db.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, 0)').run(l2, n);
      v9s.expect(store9s.lineageEntries(db, n).map((r) => r.entryId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    } finally {
      db.close();
    }
  });
});

// ── W1-B2 Task 20: prune by referrer age (spec 2026-10-05 §6.6; DM14 store half, DM15) ────────────
describe('store.mjs: prune tombstones by referrer age (W1-B2 Task 20)', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
  const CUTOFF = NOW - 90 * DAY;
  const OLD = NOW - 200 * DAY;
  const NEW = NOW - DAY;

  /** A bound store holding one referrer arrangement per DM15 clause, planted by SQL on the writer handle.
   *  Blob ids are assigned in this order: old-only 1, shared 2, young 3, summary 4, kept 5, boundary 6,
   *  null-ts 7, variant-host-old 8, variant-of-old 9, variant-host-new 10, variant-of-new 11,
   *  sidecar-unlinked 12, orphan 13, summary-no-leaf 14, sidecar-old 15 (minted last so the ids above keep their order). */
  function planted(): { home: string; db: DatabaseSync; blob: Record<string, number>; close: () => void } {
    const home = mkTmp('ccrc-history-prune-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    const blob: Record<string, number> = {};
    const mkBlob = (tag: string): number => {
      const r = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)")
        .run(createHash('sha256').update(tag).digest(), brotli(Buffer.from(tag)), tag.length);
      blob[tag] = Number(r.lastInsertRowid);
      return blob[tag]!;
    };
    const tp = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)')
      .run('11111111-1111-4111-8111-111111111111').lastInsertRowid);
    let n = 0;
    const entry = (blobId: number, tsMs: number | null): number => {
      n += 1;
      return Number(db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns,
          struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, ?, 1, ?, ?)`)
        .run(`e${String(n).padStart(4, '0')}`, tp, n, blobId, tsMs).lastInsertRowid);
    };
    const oldOnlyEntry = entry(mkBlob('old-only'), OLD);
    const shared = mkBlob('shared');
    entry(shared, OLD);
    const young = entry(mkBlob('young'), NEW);
    db.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, ?)')
      .run(tp, 'toolu_01shared.txt', shared, young, NEW);
    const summary = mkBlob('summary');
    entry(summary, OLD);
    const sp = Number(db.prepare("INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES ('claude-a-demo', '', 'demo', 1)")
      .run().lastInsertRowid);
    db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, summary_blob_id,
        parser_version, created_ms) VALUES ('L00000000000000000001', ?, 1, ?, 'native_leaf', 0, 'not-requested', ?, 1, 1)`)
      .run(sp, tp, summary);
    const kept = mkBlob('kept');
    entry(kept, OLD);   // a kept list some old row also names: only the structure rule protects it
    const boundaryEntry = entry(mkBlob('boundary'), OLD);
    db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, kept_blob_id) VALUES (?, ?, 1, ?)').run(boundaryEntry, tp, kept);
    entry(mkBlob('null-ts'), null);
    const oldHost = entry(mkBlob('variant-host-old'), OLD);
    db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (?, ?, 1, ?)')
      .run(oldHost, mkBlob('variant-of-old'), OLD);
    const newHost = entry(mkBlob('variant-host-new'), NEW);
    db.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms) VALUES (?, ?, 1, ?)')
      .run(newHost, mkBlob('variant-of-new'), NEW);
    db.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, NULL, ?)')
      .run(tp, 'toolu_01unlinked.txt', mkBlob('sidecar-unlinked'), OLD);
    mkBlob('orphan');
    // D-4590: an old compact-summary entry whose own blob no node names yet (derivation lags a cap or floor pause)
    const lagging = db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns,
        struct_file_id, blob_id, ts_ms, is_compact_summary) VALUES (?, ?, 'user', 'operator', 1, ?, 1, ?, ?, 1)`);
    n += 1;
    lagging.run(`e${String(n).padStart(4, '0')}`, tp, n, mkBlob('summary-no-leaf'), OLD);
    // H-41: a sidecar linked to an OLD entry — "a sidecar ages by its entry", the positive half: its blob is pruned with it
    db.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, ?)')
      .run(tp, 'toolu_01old.txt', mkBlob('sidecar-old'), oldOnlyEntry, OLD);
    return { home, db, blob, close: () => closeWriter(db) };
  }
  const PRUNED = ['boundary', 'old-only', 'sidecar-old', 'variant-host-old', 'variant-of-old'];
  const KEPT = ['shared', 'young', 'summary', 'kept', 'null-ts', 'variant-host-new', 'variant-of-new', 'sidecar-unlinked', 'orphan', 'summary-no-leaf'];

  it('DM15: a blob is a candidate only when every referrer is older than the cutoff; shared, NULL-time, unlinked-sidecar, unreferenced and structure blobs stay', () => {
    const { db, blob, close } = planted();
    try {
      const protectedIds = pruneProtected(db);
      expect(protectedIds.has(blob['summary-no-leaf']!), 'D-4590: a compact summary with no leaf yet is structure').toBe(true);
      expect([...protectedIds].sort((a, b) => a - b), 'structure: the native summary, the kept list and a compact summary no leaf names yet')
        .toEqual([blob['summary']!, blob['kept']!, blob['summary-no-leaf']!].sort((a, b) => a - b));
      const c = pruneCandidates(db, { cutoffMs: CUTOFF, afterBlobId: 0, limit: 100, protectedIds });
      const name = (id: number): string => Object.keys(blob).find((k) => blob[k] === id)!;
      expect(c.blobIds.map(name).sort()).toEqual(PRUNED);
      expect(c.more).toBe(false);
      expect(c.exported, 'nothing is exported before W1-B4').toBe(0);
      expect(pruneDryRun(db, CUTOFF)).toEqual({ blobs: 5, bytes: c.bytes, exported: 0 });
    } finally { close(); }
  });

  it('D-4601 (history-prune-protects-boundary-anchors): the row a boundary\'s anchor_uuid names is structure whether or not it is flagged, so an old unflagged anchor no node names yet keeps its text; a boundary naming itself protects nothing (H-49)', () => {
    const home = mkTmp('ccrc-history-prune-anchor-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    try {
      const blob: Record<string, number> = {};
      const mkBlob = (tag: string): number => {
        const r = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)")
          .run(createHash('sha256').update(tag).digest(), brotli(Buffer.from(tag)), tag.length);
        blob[tag] = Number(r.lastInsertRowid);
        return blob[tag]!;
      };
      const tp = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)')
        .run('33333333-3333-4333-8333-333333333333').lastInsertRowid);
      let n = 0;
      // Every entry is OLD and NOT a compact summary: only the anchor arm can protect one.
      const entry = (uuid: string, tag: string): number => {
        n += 1;
        return Number(db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns,
            struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, ?, 1, ?, ?)`)
          .run(uuid, tp, n, mkBlob(tag), OLD).lastInsertRowid);
      };
      const boundary = (entryId: number, ord: number, anchorUuid: string | null): void => {
        db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid) VALUES (?, ?, ?, ?)').run(entryId, tp, ord, anchorUuid);
      };
      const b1 = entry('boundary-1', 'boundary-one');
      entry('anchor-1', 'anchor-text');
      boundary(b1, 1, 'anchor-1');                       // names another, unflagged row: that row is the summary
      const b2 = entry('boundary-2', 'boundary-two');
      boundary(b2, 2, 'boundary-2');                     // names itself: the pick is the first compact summary AFTER it
      const b3 = entry('boundary-3', 'boundary-three');
      boundary(b3, 3, null);                             // names nothing
      entry('plain', 'plain-text');
      const protectedIds = pruneProtected(db);
      expect([...protectedIds], 'only the anchor\'s own blob is structure').toEqual([blob['anchor-text']!]);
      const name = (id: number): string => Object.keys(blob).find((k) => blob[k] === id)!;
      const c = pruneCandidates(db, { cutoffMs: CUTOFF, afterBlobId: 0, limit: 100, protectedIds });
      expect(c.blobIds.map(name).sort()).toEqual(['boundary-one', 'boundary-three', 'boundary-two', 'plain-text']);
      expect(pruneDryRun(db, CUTOFF).blobs).toBe(4);
      expect(pruneApply(db, { cutoffMs: CUTOFF, nowMs: NOW, batch: 2, vacuumPages: 64, between: () => {} }).blobs).toBe(4);
      const z = (tag: string): Uint8Array | null =>
        (db.prepare('SELECT z FROM blobs WHERE blob_id = ?').get(blob[tag]!) as { z: Uint8Array | null }).z;
      expect(z('anchor-text'), 'the anchored summary text is never pruned').not.toBeNull();
      for (const tag of ['boundary-one', 'boundary-two', 'boundary-three', 'plain-text']) expect(z(tag), tag).toBeNull();
    } finally { closeWriter(db); }
  });

  it('DM14 (store half): pruneApply tombstones in bounded batches — z NULL, pruned_ms stamped, the FTS row gone, the merge step registered inside the batch — keeps every row, truncates the WAL after each batch, and calls back between batches', (ctx) => {
    const { home, db, blob, close } = planted();
    try {
      if (probeFts5(db) === 'absent') ctx.skip();
      withTx(db, 'NORMAL', () => {
        createFtsTables(db);
        db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(blob['old-only']!, 'oldonlyword');
        db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(blob['shared']!, 'sharedword');
        db.prepare('UPDATE blobs SET fts_indexed = 1 WHERE blob_id IN (?, ?)').run(blob['old-only']!, blob['shared']!);
      });
      const count = (t: string): number => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
      const TABLES = ['entries', 'entry_variants', 'sidecars', 'nodes', 'boundaries', 'blobs'];
      const before = TABLES.map(count);
      // RB3: the -wal file's size at each between() call, after that batch's vacuum and checkpoint. This test holds
      // no other connection, so a TRUNCATE checkpoint always completes and leaves the file empty.
      const mergePending = (): number => (db.prepare("SELECT count(*) AS n FROM derivation_state WHERE step = 'fts-merge' AND completed_ms IS NULL").get() as { n: number }).n;
      expect(mergePending(), 'CONTROL: no merge step is pending before the prune').toBe(0);
      const wal = `${historyPaths(home).dbFile}-wal`;
      const walSizes: number[] = [];
      let registered = 0;
      // batch 2: SQL pages [1,4] [5,6] [8,9] [14,15] [] — the protected 4, 5 and 14 dropped, and the fifth read is empty because the fourth page was full — so four batches tombstone.
      const r = pruneApply(db, {
        cutoffMs: CUTOFF, nowMs: NOW, batch: 2, vacuumPages: 64,
        between: () => { walSizes.push(fs.statSync(wal).size); },
        onDeleted: () => {
          expect(() => db.exec('BEGIN'), 'registered inside the batch\'s own transaction').toThrow(/within a transaction/);
          // The sweep's registration (derivStmts(db).pending), written here by its SQL: it must commit with the batch.
          db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('fts-merge', 1, NULL, NULL)
            ON CONFLICT(step, version) DO UPDATE SET completed_ms = NULL`).run();
          registered += 1;
        },
      });
      expect(r).toEqual({ blobs: 5, bytes: expect.any(Number), fts: true });
      expect(walSizes, 'one call after each batch that tombstoned something, the WAL truncated before each').toEqual([0, 0, 0, 0]);
      expect(registered, 'every batch that deleted index rows registers the merge step with them').toBe(4);
      expect(mergePending(), 'a registration written inside onDeleted committed with the batch').toBe(1);
      const state = (tag: string): { z: Uint8Array | null; pruned_ms: number | null; fts_indexed: number } =>
        db.prepare('SELECT z, pruned_ms, fts_indexed FROM blobs WHERE blob_id = ?').get(blob[tag]!) as never;
      for (const tag of PRUNED) expect(state(tag), tag).toEqual({ z: null, pruned_ms: NOW, fts_indexed: 0 });
      for (const tag of KEPT) expect(state(tag).z, tag).not.toBeNull();
      const match = (w: string): number =>
        (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(w) as { n: number }).n;
      expect(match('oldonlyword'), 'the tombstoned blob left the index').toBe(0);
      expect(match('sharedword'), 'a kept blob keeps its row').toBe(1);
      expect(TABLES.map(count), 'tombstones content, never rows').toEqual(before);
      expect(pruneApply(db, { cutoffMs: CUTOFF, nowMs: NOW, batch: 2, vacuumPages: 64, between: () => {} }).blobs,
        'a second pass finds nothing left').toBe(0);
    } finally { close(); }
  });

  it('pruneApply returns the pages its batches free: the freelist is empty after it, so the store file shrinks', () => {
    const arrange = (): { db: DatabaseSync; close: () => void } => {
      const home = mkTmp('ccrc-history-prune-vac-');
      createStore(home);
      const db = openWriter(historyPaths(home).dbFile);
      const tp = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)')
        .run('22222222-2222-4222-8222-222222222222').lastInsertRowid);
      for (let k = 0; k < 4; k += 1) {
        const z = randomBytes(64 * 1024);   // incompressible: each blob spans many pages
        const b = Number(db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)")
          .run(createHash('sha256').update(z).digest(), z, z.length).lastInsertRowid);
        db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns,
            struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, ?, 1, ?, ?)`)
          .run(`v${String(k)}`, tp, k + 1, b, OLD);
      }
      return { db, close: () => closeWriter(db) };
    };
    const pragma = (db: DatabaseSync, name: string): number =>
      Number((db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)[name]);
    const a = arrange();
    try {
      const pages = pragma(a.db, 'page_count');
      const r = pruneApply(a.db, { cutoffMs: CUTOFF, nowMs: NOW, batch: 500, vacuumPages: 65_536, between: () => {}, onDeleted: () => {} });
      expect(r.blobs, 'CONTROL: the four old blobs were tombstoned').toBe(4);
      expect(pragma(a.db, 'freelist_count'), 'the vacuum returned every freed page').toBe(0);
      expect(pragma(a.db, 'page_count'), 'the store file shrank').toBeLessThan(pages);
    } finally { a.close(); }
    const b = arrange();
    try {
      const c = pruneCandidates(b.db, { cutoffMs: CUTOFF, afterBlobId: 0, limit: 500, protectedIds: pruneProtected(b.db) });
      pruneBatch(b.db, { blobIds: c.blobIds, nowMs: NOW, fts: false, onDeleted: () => {} });
      expect(pragma(b.db, 'freelist_count'), 'CONTROL: a tombstone batch alone leaves free pages, so the fixture frees pages').toBeGreaterThan(0);
    } finally { b.close(); }
  });

  it('incrementalVacuum returns what it freed and refuses a page count that is not a positive integer', () => {
    const { db, close } = planted();
    try {
      withTx(db, 'NORMAL', () => {
        db.exec('CREATE TABLE scratch_free (x BLOB)');
        const ins = db.prepare('INSERT INTO scratch_free (x) VALUES (?)');
        for (let k = 0; k < 200; k += 1) ins.run(Buffer.alloc(4000, k % 251));
        db.exec('DROP TABLE scratch_free');
      });
      const freelist = (): number => Number((db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count);
      const free = freelist();
      expect(free, 'CONTROL: dropping the filled table left free pages').toBeGreaterThan(0);
      expect(incrementalVacuum(db, 64)).toBe(Math.min(free, 64));
      expect(freelist(), 'the freelist shrank by exactly what was returned').toBe(free - Math.min(free, 64));
      expect(() => incrementalVacuum(db, 0)).toThrow(TypeError);
    } finally { close(); }
  });
});

// ── W1-B2 Task 22: doctor --backup's copy (spec 2026-10-05 §8.4) ─────────────────────────────────
describe('store.mjs: writeBackup (W1-B2 Task 22)', () => {
  it('copies to backups/<ts>.db through a dot-temp, removes every stale backup temp first, never touches a pre-v temp or an operator file, and refuses a same-second name', () => {
    const home = mkTmp('ccrc-history-backup-');
    createStore(home);
    const P = historyPaths(home);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(P.backups, '.20260101T000000Z.db.tmp'), 'partial');
    fs.writeFileSync(path.join(P.backups, '.20260101T000000Z.db.tmp-journal'), 'partial');
    fs.writeFileSync(path.join(P.backups, '.pre-v2.db.tmp'), 'the migration owns this one');
    fs.writeFileSync(path.join(P.backups, '20251231T000000Z.db'), 'an operator backup');
    const db = openWriter(P.dbFile);
    try {
      const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
      const r = writeBackup(db, home, { nowMs });
      expect(r.name).toBe('20261006T120000Z.db');
      expect(fs.readdirSync(P.backups).sort()).toEqual(['.pre-v2.db.tmp', '20251231T000000Z.db', '20261006T120000Z.db']);
      expect(fs.readFileSync(path.join(P.backups, '20251231T000000Z.db'), 'utf8')).toBe('an operator backup');
      const copy = new DatabaseSync(path.join(P.backups, r.name), { readOnly: true });
      try {
        expect((copy.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string }).v).toBe(getMeta(db, 'store_id'));
        expect((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
      } finally { copy.close(); }
      expect(r.sizeBytes).toBe(fs.statSync(path.join(P.backups, r.name)).size);
      expect(Number(getMeta(db, 'copy_bps')), 'every copy records its measured rate').toBe(r.copyBps);
      expect(wordOf(() => writeBackup(db, home, { nowMs })), 'never clobbered').toBe('backup-exists');
      expect(fs.readdirSync(P.backups).filter((n) => n.endsWith('.tmp')), 'the refused copy left no temp').toEqual(['.pre-v2.db.tmp']);
    } finally { closeWriter(db); }
  });

  it('writeBackup fsyncs db/ when it creates backups/, before backups/ itself (review 316 F23)', () => {
    // B1's `runMigration fsyncs db/ when it creates backups/` case, for the second creator of that directory.
    // recordDirFsyncs is B1's (historyHelpers.ts), already imported by this file.
    const home = mkTmp('ccrc-history-backup-f23-');
    createStore(home);
    const P = historyPaths(home);
    expect(fs.existsSync(P.backups), 'createStore makes no backups/').toBe(false);
    const db = openWriter(P.dbFile);
    try {
      const { dirs } = recordDirFsyncs(() => writeBackup(db, home, { nowMs: Date.UTC(2026, 9, 6, 12, 0, 0) }));
      expect(dirs.indexOf(P.dbDir), 'db/ gained backups/ and is fsynced').toBeGreaterThanOrEqual(0);
      expect(dirs.indexOf(P.dbDir), 'db/ before backups/').toBeLessThan(dirs.indexOf(P.backups));
    } finally { closeWriter(db); }
  });

  it('a file that appears at the final name after the existence check is refused backup-exists by the publish, left as it was, and no temp remains (D-4721: link, not rename)', () => {
    // The race the lstat pre-check cannot close: an operator file lands at the final name between the check and
    // the publish. The seam makes the check answer ENOENT for that one path, so only the publish itself can refuse.
    const home = mkTmp('ccrc-history-backup-link-');
    createStore(home);
    const P = historyPaths(home);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
    const finalPath = path.join(P.backups, '20261006T120000Z.db');
    fs.writeFileSync(finalPath, 'an operator file');
    const db = openWriter(P.dbFile);
    const realLstat = fs.lstatSync;
    let seamFired = 0;
    try {
      fs.lstatSync = ((p: fs.PathLike, ...rest: unknown[]) => {
        if (String(p) === finalPath) { seamFired += 1; throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }); }
        return (realLstat as (...a: unknown[]) => unknown)(p, ...rest);
      }) as typeof fs.lstatSync;
      syncBuiltinESMExports();
      let got: unknown = null;
      try { writeBackup(db, home, { nowMs }); } catch (e) { got = e; } finally { fs.lstatSync = realLstat; syncBuiltinESMExports(); }
      expect(seamFired, 'CONTROL: the pre-check consulted the seam once and was told the name was free, so only the publish can refuse').toBe(1);
      expect(got, 'the publish refused where rename() would have replaced').toBeInstanceOf(StoreError);
      expect((got as StoreError).word).toBe('backup-exists');
      expect((got as StoreError).message, 'link() refused, not the pre-check ("already exists")').toMatch(/appeared while it was written$/);
      expect(fs.readFileSync(finalPath, 'utf8'), 'the operator file is as it was').toBe('an operator file');
      expect(fs.readdirSync(P.backups).filter((n) => n.endsWith('.tmp')), 'the refused copy left no temp').toEqual([]);
    } finally { fs.lstatSync = realLstat; syncBuiltinESMExports(); closeWriter(db); }
  });

  it('a dangling link at the final name is refused backup-exists BEFORE the copy runs, worded "already exists" (lstat, not a link-following existsSync; H-69)', () => {
    const home = mkTmp('ccrc-history-backup-dangling-');
    createStore(home);
    const P = historyPaths(home);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const nowMs = Date.UTC(2026, 9, 6, 12, 0, 0);
    const name = backupNameOf(nowMs);
    const finalPath = path.join(P.backups, name);
    const target = path.join(P.backups, 'nowhere');
    fs.symlinkSync(target, finalPath);
    const db = openWriter(P.dbFile);
    try {
      const before = getMeta(db, 'copy_bps');
      let err: unknown;
      try { writeBackup(db, home, { nowMs }); } catch (e) { err = e; }
      expect(err, 'a dangling link is a name that is taken').toBeInstanceOf(StoreError);
      expect((err as StoreError).word).toBe('backup-exists');
      expect((err as StoreError).message, 'refused by the pre-check, not after a whole copy').toMatch(/already exists$/);
      expect(fs.readlinkSync(finalPath), 'the link is as it was').toBe(target);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readdirSync(P.backups).filter((n) => n.endsWith('.tmp')), 'no copy was made, so no temp').toEqual([]);
      expect(getMeta(db, 'copy_bps'), 'no copy was timed').toBe(before);
    } finally { closeWriter(db); }
  });
});

// ── W1-B2 Task 23: doctor --repair's measurements (spec 2026-10-05 §8.4; P21, P24) ─────────────────
describe('store.mjs: the repair measurements (W1-B2 Task 23)', () => {
  it('integrityCheck reads ok, foreignKeyRows names a planted dangling reference, and ftsMeasure and dropFtsTables see and remove both FTS tables with their own shadows', (ctx) => {
    const home = mkTmp('ccrc-history-repair-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    try {
      if (probeFts5(db) === 'absent') ctx.skip();
      expect(integrityCheck(db)).toEqual(['ok']);
      expect(foreignKeyRows(db)).toEqual([]);
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare("INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES ('/fk-test', 2147483647, 0)").run();
      db.exec('PRAGMA foreign_keys = ON');
      expect(foreignKeyRows(db)).toEqual([{ table: 'file_paths', rowid: 1, parent: 'ingest_files', fkid: 0 }]);
      withTx(db, 'NORMAL', () => { createFtsTables(db); });
      const m = ftsMeasure(db);
      expect([...m.tables].sort()).toEqual(['blobs_fts', ...FTS_SHADOWS.blobs_fts, 'nodes_fts', ...FTS_SHADOWS.nodes_fts].sort());
      expect(m.columns).toEqual({ blobs_fts: ['body'], nodes_fts: ['gist', 'topics', 'refs'] });
      expect(ftsTablesHealthy(m)).toEqual({ blobs: true, nodes: true });
      withTx(db, 'NORMAL', () => { dropFtsTables(db); });
      expect(ftsMeasure(db).tables.size, 'both tables and every shadow are gone').toBe(0);
      expect(ftsTablesHealthy(ftsMeasure(db))).toEqual({ blobs: false, nodes: false });
      withTx(db, 'NORMAL', () => { dropFtsTables(db); });   // with nothing left it is a no-op, never a throw
    } finally { closeWriter(db); }
  });

  it('dropFtsTables removes a table left at a shadow\'s name when its FTS table is gone, so createFtsTables can run (P24)', (ctx) => {
    const home = mkTmp('ccrc-history-repair-orphan-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    try {
      if (probeFts5(db) === 'absent') ctx.skip();
      withTx(db, 'NORMAL', () => { createFtsTables(db); });
      db.exec('DROP TABLE blobs_fts');                       // takes its own shadows with it
      db.exec('CREATE TABLE blobs_fts_idx (x)');             // allowed: no FTS table owns that name now
      db.exec('SAVEPOINT control');
      expect(() => createFtsTables(db), 'CONTROL: the orphan blocks the re-create').toThrow(/already exists/);
      db.exec('ROLLBACK TO control');
      db.exec('RELEASE control');
      withTx(db, 'NORMAL', () => { dropFtsTables(db); });
      expect(() => withTx(db, 'NORMAL', () => { createFtsTables(db); })).not.toThrow();
      expect([...ftsMeasure(db).tables]).toContain('blobs_fts');
    } finally { closeWriter(db); }
  });
});

describe('store.mjs: setCounter (W1-B2 Task 23)', () => {
  it('sets a counter to n, and 0 removes its row, which every reader reads as 0', () => {
    const home = mkTmp('ccrc-history-setcounter-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    try {
      const n = (name: string): number | undefined => (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;
      withTx(db, 'NORMAL', () => { bump(db, 'drain_rejected', 3); setCounter(db, 'spool_blocked', 2); });
      expect([n('drain_rejected'), n('spool_blocked')]).toEqual([3, 2]);
      withTx(db, 'NORMAL', () => { setCounter(db, 'drain_rejected', 1); setCounter(db, 'spool_blocked', 0); });
      expect(n('drain_rejected')).toBe(1);
      expect(n('spool_blocked'), 'a reset leaves no row').toBeUndefined();
    } finally { closeWriter(db); }
  });
});

// ── W1-B2 Task 24: the binding verbs' store sequences (spec §8.4 adopt, restore, rebuild; §6.2) ────────────────
describe('store.mjs: the binding verbs\' sequences (W1-B2 Task 24)', () => {
  const STORE_MJS = path.resolve(__dirname, '../../ccd/history/store.mjs');
  const FAULTS_MJS = path.resolve(__dirname, 'fixtures/history/preload-faults.mjs');
  /** One fixed bind time, so every `bound:<ms>`, recover step and `bind` record below is named exactly. */
  const T = 1_791_000_000_000;
  const RESTORE_BODY = 'const s = S.stageRestore(process.argv[1], process.argv[2]); '
    + 'S.commitRestore(process.argv[1], s, { nowMs: Number(process.argv[3]) });';
  const ADOPT_BODY = 'S.adoptStore(process.argv[1], { nowMs: Number(process.argv[2]) });';
  const REBUILD_BODY = "S.createStore(process.argv[1], { storeId: process.argv[2], bind: { kind: 'rebuild', nowMs: Number(process.argv[3]) } });";
  const home = (): string => mkTmp('ccrc-history-bindverb-');

  /** `body` in a child that imports store.mjs as `S`, SIGKILLed by the fault preload at `kill`. The `timeout`
   *  ends a child that hangs instead, with SIGTERM, so a hang is never read as the planned SIGKILL. */
  const killedAt = (h: string, kill: string, body: string, args: string[]): ReturnType<typeof spawnSync> => spawnSync(
    process.execPath,
    ['--no-warnings', '--import', pathToFileURL(FAULTS_MJS).href, '--input-type=module', '-e',
      `import * as S from ${JSON.stringify(pathToFileURL(STORE_MJS).href)}; ${body}`, ...args],
    { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: h, HISTORY_TEST_KILL: kill }, timeout: 60_000, killSignal: 'SIGTERM' },
  );

  /** A store, a `VACUUM INTO` backup of it under its own db/backups/, then the box as a loss leaves it. The DB,
   *  its sidecars and store.writer are gone, and store.id is gone too unless `keepStoreId`. */
  const backedUp = (h: string, name: string, keepStoreId: boolean): { storeId: string; oldWriter: string } => {
    const { storeId, writer } = createStore(h);
    const P = historyPaths(h);
    const db = openWriter(P.dbFile);
    bump(db, 'fixture_rows', 3);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    db.prepare('VACUUM INTO ?').run(path.join(P.backups, name));
    closeWriter(db);
    for (const f of [P.dbFile, P.wal, P.shm, P.writer, ...(keepStoreId ? [] : [P.storeId])]) fs.rmSync(f, { force: true });
    return { storeId, oldWriter: writer };
  };

  /** A backup with one page overwritten (the middle page, else the quarter page): the first candidate that
   *  integrity_check answers as rows is used. It reports such damage as rows at the offsets chosen below (it throws at
   *  others, so the loop checks), and meta.store_id still reads. So only the integrity check can refuse it. The candidates are
   *  measured on Node 24.x; the node-floor leg (22.16.0, which runs this file) is the arbiter for the floor. */
  const corruptBackup = (h: string, name: string): void => {
    const P = historyPaths(h);
    const db = openWriter(P.dbFile);
    const ins = db.prepare('INSERT INTO counters (name, n) VALUES (?, ?)');
    withTx(db, 'NORMAL', () => {
      for (let i = 0; i < 4000; i += 1) ins.run(`fixture_counter_${String(i).padStart(5, '0')}_${'x'.repeat(60)}`, i);
    });
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const out = path.join(P.backups, name);
    db.prepare('VACUUM INTO ?').run(out);
    closeWriter(db);
    const pages = Math.floor(fs.statSync(out).size / 4096);
    const whole = fs.readFileSync(out);
    // Some page offsets make integrity_check THROW 'database disk image is malformed' (measured, 24.14.1, at the middle
    // page's byte 8), and a throw would hide the integrity check's own verdict from the case. So the first damage that
    // integrity_check answers as rows, and not as the one row `ok`, is the one used.
    const answers = (): string[] | null => {
      const probe = new DatabaseSync(out, { readOnly: true });
      try { return probe.prepare('PRAGMA integrity_check').all().map((r) => String(Object.values(r)[0])); } catch { return null; } finally { probe.close(); }
    };
    for (const [page, off] of [[Math.floor(pages / 2), 100], [Math.floor(pages / 2), 8], [Math.floor(pages / 4), 8], [Math.floor(pages / 4), 100]] as const) {
      fs.writeFileSync(out, whole);
      const fd = fs.openSync(out, 'r+');
      try { fs.writeSync(fd, Buffer.alloc(200, 0xff), 0, 200, page * 4096 + off); } finally { fs.closeSync(fd); }
      const got = answers();
      if (got !== null && !(got.length === 1 && got[0] === 'ok')) return;
    }
    throw new Error('fixture: no candidate damage reads as integrity_check rows');
  };

  /** What a binding left INSIDE a DB file, read through a read-only handle. */
  const inside = (dbFile: string): {
    storeId: string | null; writer: string | null; journalMode: string;
    bound: Array<Record<string, unknown>>; recover: Array<Record<string, unknown>>; binds: Array<Record<string, unknown>>;
  } => {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      return {
        storeId: getMeta(db, 'store_id'),
        writer: getMeta(db, 'writer'),
        journalMode: String(pragma(db, 'journal_mode')),
        bound: db.prepare("SELECT k, v FROM meta WHERE k LIKE 'bound:%' ORDER BY k").all().map((r) => ({ ...r })),
        recover: db.prepare("SELECT version, cursor, completed_ms FROM derivation_state WHERE step = 'recover' ORDER BY version")
          .all().map((r) => ({ ...r })),
        binds: db.prepare('SELECT rec FROM journal_outbox ORDER BY seq').all().flatMap((r) => {
          const p = parseJournalRecord(String(r['rec']));
          return p.kind === 'record' ? [{ ...p.rec }] : [];
        }),
      };
    } finally {
      db.close();
    }
  };
  const bindRecord = (kind: string, writer: string, t = T): Record<string, unknown> =>
    ({ v: 1, k: 'verdict', t, event_key: 'none', kind: 'bind', bind: kind, writer });

  it('adoptStore: the bind commits inside the DB, then store.writer, then store.id; a fresh token and no recovery step', () => {
    const h = home();
    const P = historyPaths(h);
    const { storeId, writer: oldWriter } = createStore(h);
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'refuse', word: 'store-unbound' });
    const got = adoptStore(h, { nowMs: T });
    expect(got.storeId).toBe(storeId);
    expect(got.writer).toMatch(WRITER_RE);
    expect(got.writer).not.toBe(oldWriter);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(fs.readFileSync(P.writer, 'utf8').trim()).toBe(got.writer);
    expect(mode(P.storeId)).toBe(0o600);
    const f = inside(P.dbFile);
    expect(f.writer).toBe(got.writer);
    expect(f.bound).toEqual([{ k: `bound:${T}`, v: 'adopt' }]);
    expect(f.recover, 'adopt registers no recovery step (RC16)').toEqual([]);
    expect(f.binds).toEqual([bindRecord('adopt', got.writer)]);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'open' });
  });

  it('adoptStore killed right after store.id lands finds the bind already committed; killed before it, the store stays unbound and a second adopt binds it', () => {
    const h = home();
    const P = historyPaths(h);
    createStore(h);
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    // writeFileAtomic(store.id) renames `store.id.tmp.<pid>`: the first rename naming `store.id.tmp`.
    const r = killedAt(h, 'renameSync:store.id.tmp:1:after', ADOPT_BODY, [h, String(T)]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.storeId)).toBe(true);
    const f = inside(P.dbFile);
    expect(f.bound, 'the bind committed before store.id named the store').toEqual([{ k: `bound:${T}`, v: 'adopt' }]);
    expect(f.binds).toHaveLength(1);
    expect(f.writer).toBe(fs.readFileSync(P.writer, 'utf8').trim());

    const h2 = home();
    const P2 = historyPaths(h2);
    createStore(h2);
    fs.rmSync(P2.storeId);
    fs.rmSync(P2.writer);
    const r2 = killedAt(h2, 'renameSync:store.id.tmp:1', ADOPT_BODY, [h2, String(T)]);
    expect(r2.signal, String(r2.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P2.storeId)).toBe(false);
    expect(decideStoreOpen(measureStoreFacts(h2, 'fleet'))).toEqual({ act: 'refuse', word: 'store-unbound' });
    const again = adoptStore(h2, { nowMs: T + 1 });
    expect(fs.readFileSync(P2.storeId, 'utf8').trim()).toBe(again.storeId);
    const f2 = inside(P2.dbFile);
    expect(f2.binds).toHaveLength(2);
    expect(f2.writer).toBe(again.writer);
    expect(fs.readFileSync(P2.writer, 'utf8').trim()).toBe(again.writer);
    expect(decideStoreOpen(measureStoreFacts(h2, 'fleet'))).toEqual({ act: 'open' });
  }, 120_000);

  it('restore onto a fresh box: a 0600 copy measured, then made WAL with every binding fact inside it, linked, and bound through the pending marker', () => {
    const h = home();
    const P = historyPaths(h);
    const name = '20261001T000000Z.db';
    const { storeId, oldWriter } = backedUp(h, name, false);
    const prev = process.umask(0o002);
    let staged: ReturnType<typeof stageRestore> | null = null;
    let tempMode = 0;
    let got: { storeId: string; writer: string } | null = null;
    try {
      staged = stageRestore(h, name);
      tempMode = mode(staged.tempPath);
      got = commitRestore(h, staged, { nowMs: T });
    } finally {
      process.umask(prev);
    }
    expect(tempMode, 'the copy is 0600 under any umask').toBe(0o600);
    expect(path.basename(staged!.tempPath)).toMatch(/^\.history\.db\.restore\.[0-9]+$/);
    expect(staged).toMatchObject({ storeId: { state: 'value', value: storeId }, userVersion: SCHEMA_VERSION, integrityOk: true });
    expect(staged!.sizeBytes).toBe(fs.statSync(path.join(P.backups, name)).size);
    const bound = got!;
    expect(bound.storeId).toBe(storeId);
    expect(bound.writer).toMatch(WRITER_RE);
    expect(bound.writer).not.toBe(oldWriter);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(fs.readFileSync(P.writer, 'utf8').trim()).toBe(bound.writer);
    expect(fs.existsSync(P.pending)).toBe(false);
    expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.'))).toEqual([]);
    expect(mode(P.dbFile)).toBe(0o600);
    const f = inside(P.dbFile);
    expect(f).toMatchObject({
      storeId, writer: bound.writer, journalMode: 'wal',
      bound: [{ k: `bound:${T}`, v: 'restore' }],
      recover: [{ version: T, cursor: null, completed_ms: null }],
    });
    expect(f.binds).toEqual([bindRecord('restore', bound.writer)]);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'open' });
  });

  it('restore with store.id already naming the backup\'s store writes no pending marker, and a kill right after the link finds the binding and the recovery step inside history.db', () => {
    const h = home();
    const P = historyPaths(h);
    const name = '20261002T000000Z.db';
    const { storeId } = backedUp(h, name, true);
    const r = killedAt(h, 'linkSync:.history.db.restore.:1:after', RESTORE_BODY, [h, name, String(T)]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.pending), 'store.id already names the store: no marker').toBe(false);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    const f = inside(P.dbFile);
    expect(f.recover, 'the recovery step was inside the copy before it was linked').toEqual([{ version: T, cursor: null, completed_ms: null }]);
    expect(f.bound).toEqual([{ k: `bound:${T}`, v: 'restore' }]);
    expect(f.writer).toBe(fs.readFileSync(P.writer, 'utf8').trim());
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'open' });
    // The temp the kill left (a second name of the same inode) goes with the next lock-holding pass; the store stays.
    expect(removeStaleTemps(h).some((n) => n.startsWith('.history.db.restore.'))).toBe(true);
    expect(peekStoreId(P.dbFile)).toEqual({ state: 'value', value: storeId });
  }, 120_000);

  it('restore onto a fresh box killed between the link and the pending rename: the next pass finishes it, the recovery step already inside', () => {
    const h = home();
    const P = historyPaths(h);
    const name = '20261003T000000Z.db';
    const { storeId } = backedUp(h, name, false);
    // The FIRST rename naming store.id.pending is the marker's own temp rename; the SECOND is the rename to store.id.
    const r = killedAt(h, 'renameSync:store.id.pending:2', RESTORE_BODY, [h, name, String(T)]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.storeId)).toBe(false);
    expect(fs.readFileSync(P.pending, 'utf8').trim()).toBe(storeId);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'finish-pending' });
    const f = inside(P.dbFile);
    expect(f.recover).toEqual([{ version: T, cursor: null, completed_ms: null }]);
    expect(f.bound).toEqual([{ k: `bound:${T}`, v: 'restore' }]);
  }, 120_000);

  it('restore killed before the link: no history.db, a tick would refuse store-recoverable rather than create, the temp goes with the next pass, and a second restore completes', () => {
    const h = home();
    const P = historyPaths(h);
    const name = '20261004T000000Z.db';
    const { storeId } = backedUp(h, name, false);
    const r = killedAt(h, 'linkSync:.history.db.restore.:1', RESTORE_BODY, [h, name, String(T)]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.dbFile)).toBe(false);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'refuse', word: 'store-recoverable' });
    const removed = removeStaleTemps(h);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((n) => n.startsWith('.history.db.restore.'))).toBe(true);
    const s2 = stageRestore(h, name);
    commitRestore(h, s2, { nowMs: T + 1 });
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'open' });
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(inside(P.dbFile).recover).toEqual([{ version: T + 1, cursor: null, completed_ms: null }]);
  }, 120_000);

  it('restore puts every journal-known redact pair into the copy before the link and starts the step +pairs; a pair the backup already holds adds nothing (spec §8.4 and §9.14)', () => {
    const shaA = 'a1'.repeat(32);   // recorded before the backup was taken: the backup holds it
    const shaB = 'b2'.repeat(32);   // learned after it: only the journal holds it
    /** A store holding pair A, its VACUUM INTO backup under db/backups/, then the box as a loss leaves it. */
    const withPairA = (h: string, name: string): void => {
      const P = historyPaths(h);
      createStore(h);
      const db = openWriter(P.dbFile);
      try {
        db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?)').run(32, Buffer.from(shaA, 'hex'), T - 10);
        fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
        db.prepare('VACUUM INTO ?').run(path.join(P.backups, name));
      } finally { closeWriter(db); }
      for (const f of [P.dbFile, P.wal, P.shm, P.writer, P.storeId]) fs.rmSync(f, { force: true });
    };
    const pairsIn = (dbFile: string): Array<Record<string, unknown>> => {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      try {
        return db.prepare('SELECT len, lower(hex(sha256)) AS sha FROM redact_hashes ORDER BY len').all().map((r) => ({ ...r }));
      } finally { db.close(); }
    };
    const PAIRS_BODY = 'const s = S.stageRestore(process.argv[1], process.argv[2]); '
      + 'S.commitRestore(process.argv[1], s, { nowMs: Number(process.argv[3]), pairs: JSON.parse(process.argv[4]) });';

    // Killed right before the link: the copy the kill leaves already holds both pairs and the +pairs cursor.
    const h = home();
    const P = historyPaths(h);
    const name = '20261005T000000Z.db';
    withPairA(h, name);
    const both = JSON.stringify([{ len: 32, sha256: shaA, t: T - 10 }, { len: 40, sha256: shaB, t: T - 5 }]);
    const r = killedAt(h, 'linkSync:.history.db.restore.:1', PAIRS_BODY, [h, name, String(T), both]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.dbFile), 'CONTROL: killed before the link').toBe(false);
    const temps = fs.readdirSync(P.dbDir).filter((n) => /^\.history\.db\.restore\.[0-9]+$/.test(n));
    expect(temps.length, 'CONTROL: the kill left the copy').toBe(1);
    const copy = path.join(P.dbDir, temps[0]!);
    expect(pairsIn(copy), 'both pairs are inside the copy before it is linked').toEqual([{ len: 32, sha: shaA }, { len: 40, sha: shaB }]);
    expect(inside(copy).recover, 'the journal-only pair starts the step +pairs, so the reindex phase still runs')
      .toEqual([{ version: T, cursor: 'index+pairs', completed_ms: null }]);

    // Every pair the journal knows already in the backup: nothing added, and the step starts at NULL as before.
    const h2 = home();
    const P2 = historyPaths(h2);
    withPairA(h2, name);
    commitRestore(h2, stageRestore(h2, name), { nowMs: T, pairs: [{ len: 32, sha256: shaA, t: T - 10 }] });
    expect(pairsIn(P2.dbFile)).toEqual([{ len: 32, sha: shaA }]);
    expect(inside(P2.dbFile).recover).toEqual([{ version: T, cursor: null, completed_ms: null }]);
    // A malformed pair is a caller's bug, refused before anything is written.
    const h3 = home();
    withPairA(h3, name);
    const s3 = stageRestore(h3, name);
    expect(() => commitRestore(h3, s3, { nowMs: T, pairs: [{ len: 40, sha256: 'not hex', t: T }] })).toThrow(TypeError);
    expect(fs.existsSync(historyPaths(h3).dbFile), 'nothing linked').toBe(false);
    abortRestore(s3);
  }, 120_000);

  it('restore runs the caller\'s belt hooks inside the FULL bind transaction: the check before any binding fact or pair, the stamp after the pairs; a throw links nothing (ruling R-witness-restore)', () => {
    const shaB = 'b2'.repeat(32);   // a journal-only pair: the backup lacks it
    const name = '20261006T000000Z.db';
    const h = home();
    const P = historyPaths(h);
    backedUp(h, name, false);
    const seen: Array<{ hook: string; pairs: number; recover: number; inTx: boolean }> = [];
    const look = (hook: string) => (db: DatabaseSync): void => {
      seen.push({
        hook,
        pairs: Number((db.prepare('SELECT count(*) AS n FROM redact_hashes').get() as { n: number }).n),
        recover: Number((db.prepare("SELECT count(*) AS n FROM derivation_state WHERE step = 'recover'").get() as { n: number }).n),
        inTx: (() => { try { db.exec('BEGIN'); } catch { return true; } db.exec('ROLLBACK'); return false; })(),
      });
    };
    commitRestore(h, stageRestore(h, name), { nowMs: T, pairs: [{ len: 40, sha256: shaB, t: T - 5 }], belt: { check: look('check'), stamp: look('stamp') } });
    expect(seen, 'the check sees the copy as the backup left it, the stamp sees every write, both inside the transaction').toEqual([
      { hook: 'check', pairs: 0, recover: 0, inTx: true },
      { hook: 'stamp', pairs: 1, recover: 1, inTx: true },
    ]);
    expect(inside(P.dbFile).recover, 'CONTROL: the restore committed').toEqual([{ version: T, cursor: 'index+pairs', completed_ms: null }]);

    // A throw from the stamp rolls the whole bind back: nothing is linked, and the copy holds none of it.
    const h2 = home();
    backedUp(h2, name, false);
    const s2 = stageRestore(h2, name);
    expect(() => commitRestore(h2, s2, { nowMs: T, pairs: [{ len: 40, sha256: shaB, t: T - 5 }], belt: {
      check: () => {}, stamp: () => { throw new Error('fixture: the stamp failed'); },
    } })).toThrow('fixture: the stamp failed');
    expect(fs.existsSync(historyPaths(h2).dbFile), 'nothing linked').toBe(false);
    expect(inside(s2.tempPath).recover, 'the bind rolled back with the stamp').toEqual([]);
    abortRestore(s2);
    // A belt without both hooks is a caller's bug, refused before anything is written.
    const h3 = home();
    backedUp(h3, name, false);
    const s3 = stageRestore(h3, name);
    expect(() => commitRestore(h3, s3, { nowMs: T, belt: { check: () => {} } as never }), 'the guard\'s own words, not a native TypeError from inside the transaction').toThrow(/a belt is null or/);
    expect(inside(s3.tempPath).bound, 'nothing written').toEqual([]);
    expect(inside(s3.tempPath).journalMode, 'refused before the copy was made WAL').not.toBe('wal');
    abortRestore(s3);
  });

  it('H-84: a malformed redact pair is refused naming only its index and field, never dumping its digest or length (spec §15 SE12), and a digest that is not a string is refused too', () => {
    const shaB = 'b2'.repeat(32);
    const name = '20261006T000000Z.db';
    const h = home();
    backedUp(h, name, false);
    const staged = stageRestore(h, name);
    const messageOf = (pairs: unknown[]): string => {
      try { commitRestore(h, staged, { nowMs: T, pairs: pairs as never }); } catch (e) { return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`; }
      return 'no throw';
    };
    const good = { len: 32, sha256: 'a1'.repeat(32), t: T };
    // An array of one hex string passes String() and 64-hex, and Buffer.from(array, 'hex') makes a 1-byte digest that masks nothing.
    expect(messageOf([{ len: 40, sha256: [shaB], t: T }]), 'a digest that is not a string').toMatch(/^commitRestore: redact pair 0: sha256 is not valid$/);
    const m = messageOf([good, { len: 40, sha256: `zz${shaB.slice(2)}`, t: T }]);
    expect(m, 'the index and the field, nothing else').toMatch(/^commitRestore: redact pair 1: sha256 is not valid$/);
    expect(m, 'no digest in the message').not.toContain(shaB.slice(2));
    expect(m, 'no length in the message').not.toContain('40');
    abortRestore(staged);
  });

  /** H-83's seams, each a SECOND connection to the copy that holds a read snapshot, so SQLite's close-time
   *  checkpoint can neither complete nor delete the -wal (it ignores that failure). `commit` opens it right after the
   *  COMMIT that lands on `tempPath`'s connection: an explicit PRAGMA wal_checkpoint(TRUNCATE) then answers busy
   *  (that connection's busy_timeout is cut to 100 ms, so the refusal is measured, not waited for). `close` opens it
   *  as that connection closes, after one more write puts frames in the -wal: only a look AFTER the close sees them. */
  const blockCheckpoint = (tempPath: string, at: 'commit' | 'close'): { fired: () => number; stop: () => void } => {
    const realExec = DatabaseSync.prototype.exec;
    const realClose = DatabaseSync.prototype.close;
    const blockers: DatabaseSync[] = [];
    let target: DatabaseSync | null = null;
    const hold = (): void => {
      const reader = new DatabaseSync(tempPath);
      reader.exec('BEGIN');
      reader.prepare('SELECT count(*) AS n FROM meta').get();
      blockers.push(reader);
    };
    DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string): void {
      realExec.call(this, sql);
      if (sql === 'COMMIT' && target === null && fs.existsSync(tempPath)) {
        target = this;
        if (at === 'commit') {
          realExec.call(this, 'PRAGMA busy_timeout = 100');
          hold();
        }
      }
    } as typeof DatabaseSync.prototype.exec;
    if (at === 'close') {
      DatabaseSync.prototype.close = function (this: DatabaseSync): void {
        if (this === target && blockers.length === 0) {
          realExec.call(this, "INSERT INTO meta (k, v) VALUES ('h83-after-seal', 'x')");
          hold();
        }
        realClose.call(this);
      } as typeof DatabaseSync.prototype.close;
    }
    return {
      fired: () => blockers.length,
      stop: () => {
        DatabaseSync.prototype.exec = realExec;
        DatabaseSync.prototype.close = realClose;
        for (const b of blockers.splice(0)) b.close();
      },
    };
  };
  const SEAMS = [['commit', /checkpoint did not complete/], ['close', /still holds frames after the close/]] as const;

  it('H-83: a restore whose bind facts could not be checkpointed into the copy (before the close, or by the close) is refused, never linked: commitRestore throws and history.db does not exist', () => {
    const name = '20261006T000000Z.db';
    for (const [at, words] of SEAMS) {
      const h = home();
      const P = historyPaths(h);
      backedUp(h, name, false);
      const staged = stageRestore(h, name);
      const block = blockCheckpoint(staged.tempPath, at);
      let thrown: unknown;
      try {
        try { commitRestore(h, staged, { nowMs: T }); } catch (e) { thrown = e; }
        expect(block.fired(), `${at}: CONTROL: the second connection was open`).toBe(1);
      } finally { block.stop(); }
      expect(thrown, `${at}: the incomplete checkpoint is refused`).toBeInstanceOf(Error);
      expect(String((thrown as Error).message), at).toMatch(words);
      expect(fs.existsSync(P.dbFile), `${at}: nothing linked: the facts would live in a -wal no link carries`).toBe(false);
      abortRestore(staged);
      expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), `${at}: abort takes the -wal too`).toEqual([]);
    }
  });

  it('H-83: a rebuild\'s creation whose bind facts could not be checkpointed into the copy (before the close, or by the close) is refused, never linked: createStore throws and history.db does not exist', () => {
    for (const [at, words] of SEAMS) {
      const h = home();
      const P = historyPaths(h);
      fs.mkdirSync(P.dbDir, { recursive: true, mode: 0o700 });
      const block = blockCheckpoint(path.join(P.dbDir, `history.db.new.${process.pid}`), at);
      let thrown: unknown;
      try {
        try { createStore(h, { storeId: mintStoreId(), bind: { kind: 'rebuild', nowMs: T } }); } catch (e) { thrown = e; }
        expect(block.fired(), `${at}: CONTROL: the second connection was open`).toBe(1);
      } finally { block.stop(); }
      expect(thrown, `${at}: the incomplete checkpoint is refused`).toBeInstanceOf(Error);
      expect(String((thrown as Error).message), at).toMatch(words);
      expect(fs.existsSync(P.dbFile), `${at}: nothing linked`).toBe(false);
    }
  });

  it('H-85: stageRestore applies the §8.4 name rule itself (lib\'s restoreNameOk): an in-flight dot-temp, a stray .db and an unnamed file are refused restore-refused before any copy is made', () => {
    const h = home();
    const P = historyPaths(h);
    createStore(h);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const refused = ['.pre-v1.db.tmp', '.20261001T000000Z.db.tmp', 'notes.db', '20261001T000000Z.db.tmp', 'pre-v0.db'];
    for (const name of refused) fs.writeFileSync(path.join(P.backups, name), 'this is not a store');
    for (const name of refused) {
      expect(wordOf(() => stageRestore(h, name)), name).toBe('restore-refused');
    }
    expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), 'refused before the copy').toEqual([]);
  });

  it('H-87: a pair with a length that is not positive or a time that is not an integer is refused by the pair guard before the copy is touched; the copy is still 0600 under a umask that strips the owner bits (fchmod)', () => {
    const shaB = 'b2'.repeat(32);
    const name = '20261006T000000Z.db';
    const h = home();
    backedUp(h, name, false);
    const staged = stageRestore(h, name);
    const messageOf = (pair: unknown): string => {
      try { commitRestore(h, staged, { nowMs: T, pairs: [pair] as never }); } catch (e) { return e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`; }
      return 'no throw';
    };
    expect(messageOf({ len: 0, sha256: shaB, t: T }), 'a zero length').toBe('commitRestore: redact pair 0: len is not valid');
    expect(messageOf({ len: -3, sha256: shaB, t: T }), 'a negative length').toBe('commitRestore: redact pair 0: len is not valid');
    expect(messageOf({ len: 40, sha256: shaB, t: Number.NaN }), 'a time that is NaN').toBe('commitRestore: redact pair 0: t is not valid');
    expect(inside(staged.tempPath).journalMode, 'refused before the copy was made WAL').not.toBe('wal');
    abortRestore(staged);

    // umask 0o277 strips the owner's write bit from open()'s 0600, so only the fchmod makes the copy 0600.
    const h2 = home();
    backedUp(h2, name, false);
    const prev = process.umask(0o277);
    let tempMode = 0;
    let s2: ReturnType<typeof stageRestore> | null = null;
    try {
      s2 = stageRestore(h2, name);
      tempMode = mode(s2.tempPath);
    } finally { process.umask(prev); }
    expect(tempMode, 'the copy is 0600 whatever the umask').toBe(0o600);
    abortRestore(s2!);
  });

  it('H-88: abortRestore and commitRestore take only a path shaped like the restore temp (.history.db.restore.<pid>): a forged staged value is a TypeError that removes, opens and links nothing, history.db included', () => {
    const h = home();
    const P = historyPaths(h);
    createStore(h);
    const forged = { tempPath: P.dbFile, dbDir: P.dbDir, storeId: { state: 'value', value: mintStoreId() }, userVersion: SCHEMA_VERSION, integrityOk: true, sizeBytes: 0 };
    expect(() => abortRestore(forged as never)).toThrow(TypeError);
    expect(fs.existsSync(P.dbFile), 'history.db survives the forged abort').toBe(true);
    expect(() => commitRestore(h, forged as never, { nowMs: T })).toThrow(TypeError);
    expect(inside(P.dbFile).bound, 'nothing was bound into the live store').toEqual([]);
    expect(fs.existsSync(P.pending), 'no marker was written').toBe(false);
    for (const bad of [`${P.dbDir}/.history.db.restore.`, `${P.dbDir}/.history.db.restore.12x`, `${P.dbDir}/history.db.new.1`, `${P.dbFile}-wal`]) {
      expect(() => abortRestore({ ...forged, tempPath: bad } as never), bad).toThrow(TypeError);
    }
    // H-189: the right basename in another directory is no restore temp of this home: nothing there is bound, linked or removed.
    const other = path.join(h, 'other-dir');
    fs.mkdirSync(other, { recursive: true });
    const foreignTemp = path.join(other, '.history.db.restore.1');
    fs.writeFileSync(foreignTemp, 'not this home\'s temp');
    fs.writeFileSync(`${foreignTemp}-wal`, 'its sidecar');
    expect(() => abortRestore({ ...forged, tempPath: foreignTemp } as never), 'abort').toThrow(TypeError);
    expect(() => abortRestore({ ...forged, tempPath: foreignTemp, dbDir: undefined } as never), 'abort of a value that records no db/').toThrow(TypeError);
    expect(() => commitRestore(h, { ...forged, tempPath: foreignTemp } as never, { nowMs: T }), 'commit').toThrow(TypeError);
    expect(fs.readFileSync(foreignTemp, 'utf8'), 'the file in the other directory survives').toBe('not this home\'s temp');
    expect(fs.existsSync(`${foreignTemp}-wal`), 'and so does its sidecar').toBe(true);
    expect(inside(P.dbFile).bound, 'nothing was bound into the live store').toEqual([]);
    // The real shape still passes (the temp need not exist: removal is idempotent).
    expect(() => abortRestore({ ...forged, tempPath: `${P.dbDir}/.history.db.restore.${process.pid}` } as never)).not.toThrow();
  });

  // M23: only the FIFO rows are Linux-only (the macOS leg is advisory); this one skips on darwin like the file's others.
  it.skipIf(process.platform === 'darwin')('H-86 (a): a FIFO at the backup name is refused restore-refused and never waited on (O_NONBLOCK), in a child with a 5 s deadline', () => {
    const h = home();
    const P = historyPaths(h);
    createStore(h);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const name = '20261001T000000Z.db';
    const mk = spawnSync('mkfifo', [path.join(P.backups, name)], { encoding: 'utf8' });
    expect(mk.status, String(mk.stderr)).toBe(0);
    // A child, because a stage that blocks on the FIFO would hang this process, under the operator's lock, forever.
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      `import * as S from ${JSON.stringify(pathToFileURL(STORE_MJS).href)}; `
      + 'try { S.stageRestore(process.argv[1], process.argv[2]); console.log("no throw"); } catch (e) { console.log(e instanceof S.StoreError ? e.word : "not a StoreError: " + String(e)); }',
    h, name], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: h }, timeout: 5_000, killSignal: 'SIGKILL' });
    expect(r.signal, `the stage hung on the FIFO: ${String(r.stderr)}`).toBeNull();
    expect(String(r.stdout).trim()).toBe('restore-refused');
    expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), 'no copy was started').toEqual([]);
  });

  it('H-86 (b): a directory at the backup name is refused restore-refused by the regular-file check, before any copy is started', () => {
    const h = home();
    const P = historyPaths(h);
    createStore(h);
    fs.mkdirSync(path.join(P.backups, '20261001T000000Z.db'), { recursive: true, mode: 0o700 });
    expect(wordOf(() => stageRestore(h, '20261001T000000Z.db'))).toBe('restore-refused');
    expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), 'no copy was started').toEqual([]);
  });

  it('H-86 (c): a temp, or any sidecar of one, already at the restore temp name is never reopened: stageRestore throws and leaves the planted file as it was', () => {
    const name = '20261006T000000Z.db';
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const h = home();
      const P = historyPaths(h);
      backedUp(h, name, false);
      const planted = `${P.dbDir}/.history.db.restore.${process.pid}${suffix}`;
      fs.writeFileSync(planted, 'a leftover');
      let err: unknown;
      try { stageRestore(h, name); } catch (e) { err = e; }
      expect(err, `${suffix || 'the temp itself'}: refused`).toBeInstanceOf(Error);
      expect(String((err as Error).message), suffix).toMatch(/a temp is never reopened/);
      expect(fs.readFileSync(planted, 'utf8'), `${suffix || 'the temp itself'}: untouched`).toBe('a leftover');
      expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), suffix).toEqual([path.basename(planted)]);
    }
  });

  it('stageRestore measures the copy and never trusts it: damage reads integrityOk false, a file that is no store reads its store_id unreadable, a link or a path is refused, and abortRestore takes the temp', () => {
    const h = home();
    const P = historyPaths(h);
    const { storeId } = createStore(h);
    corruptBackup(h, '20261002T000000Z.db');
    const s = stageRestore(h, '20261002T000000Z.db');
    expect(s.storeId, 'meta still reads: only the integrity check can refuse this copy').toEqual({ state: 'value', value: storeId });
    expect(s.integrityOk).toBe(false);
    abortRestore(s);
    expect(fs.existsSync(s.tempPath)).toBe(false);

    fs.writeFileSync(path.join(P.backups, 'pre-v1.db'), 'this is not a database file at all, it is text\n'.repeat(400));
    const t = stageRestore(h, 'pre-v1.db');
    expect(t).toMatchObject({ storeId: { state: 'unreadable' }, userVersion: null, integrityOk: false });
    abortRestore(t);

    fs.symlinkSync(path.join(P.backups, '20261002T000000Z.db'), path.join(P.backups, '20261003T000000Z.db'));
    expect(wordOf(() => stageRestore(h, '20261003T000000Z.db')), 'a symlink is never followed (O_NOFOLLOW)').toBe('restore-refused');
    expect(wordOf(() => stageRestore(h, '../store.id'))).toBe('restore-refused');
    expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('.history.db.restore.'))).toEqual([]);
  });

  it('createStore with a store_id and a rebuild bind: that id, the binding and the recovery step inside, store.id through the pending marker; none when store.id already names it; B1\'s plain creation unchanged', () => {
    const S1 = mintStoreId();
    const h = home();
    const P = historyPaths(h);
    const got = createStore(h, { storeId: S1, bind: { kind: 'rebuild', nowMs: T } });
    expect(got.storeId).toBe(S1);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(S1);
    expect(fs.existsSync(P.pending)).toBe(false);
    const f = inside(P.dbFile);
    expect(f).toMatchObject({
      storeId: S1, writer: got.writer, journalMode: 'wal',
      bound: [{ k: `bound:${T}`, v: 'rebuild' }],
      recover: [{ version: T, cursor: null, completed_ms: null }],
    });
    expect(f.binds).toEqual([bindRecord('rebuild', got.writer)]);

    // store.id already names the store: a kill right after the link leaves no marker, and the store opens.
    const h2 = home();
    const P2 = historyPaths(h2);
    fs.mkdirSync(P2.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(P2.storeId, `${S1}\n`);
    const r = killedAt(h2, 'linkSync:history.db.new.:1:after', REBUILD_BODY, [h2, S1, String(T)]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P2.pending)).toBe(false);
    expect(decideStoreOpen(measureStoreFacts(h2, 'fleet'))).toEqual({ act: 'open' });
    expect(inside(P2.dbFile).recover).toEqual([{ version: T, cursor: null, completed_ms: null }]);

    // B1's first install: no bound row, no recovery step, an empty outbox.
    const h3 = home();
    createStore(h3);
    expect(inside(historyPaths(h3).dbFile)).toMatchObject({ bound: [], recover: [], binds: [] });
  }, 120_000);

  it('createStore with a rebuild bind killed between the link and the pending rename: finish-pending, the recovery step already inside', () => {
    const S1 = mintStoreId();
    const h = home();
    const P = historyPaths(h);
    const r = killedAt(h, 'renameSync:store.id.pending:2', REBUILD_BODY, [h, S1, String(T)]);
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.storeId)).toBe(false);
    expect(decideStoreOpen(measureStoreFacts(h, 'fleet'))).toEqual({ act: 'finish-pending' });
    const f = inside(P.dbFile);
    expect(f.storeId).toBe(S1);
    expect(f.recover).toEqual([{ version: T, cursor: null, completed_ms: null }]);
    expect(f.bound).toEqual([{ k: `bound:${T}`, v: 'rebuild' }]);
  }, 120_000);
});

describe('blobPlainTextMeasured: a stored body as text, with the condition that kept it from being one (HA1 fix round 1 (g))', () => {
  const idx = makePairIndex([]);
  const body = (v: unknown): { z: Uint8Array; len: number } => {
    const raw = Buffer.from(JSON.stringify(v));
    return { z: brotli(raw), len: raw.length };
  };
  it('answers text, absent, oversize and undecodable apart, and an empty text is a text', () => {
    const ok = body('the summary');
    expect(blobPlainTextMeasured(ok.z, false, idx, ok.len)).toEqual({ state: 'text', text: 'the summary' });
    const empty = body('');
    expect(blobPlainTextMeasured(empty.z, false, idx, empty.len), 'an empty summary decodes: it is a text, not a damage').toEqual({ state: 'text', text: '' });
    expect(blobPlainTextMeasured(null, false, idx, 5), 'a tombstoned blob has no bytes').toEqual({ state: 'absent', text: '' });
    expect(blobPlainTextMeasured(ok.z, false, idx, BLOB_DECODE_MAX + 1), 'a body past the decode bound').toEqual({ state: 'oversize', text: '' });
    expect(blobPlainTextMeasured(ok.z, true, idx, SIDECAR_WHOLE_MAX + 1), 'a sidecar past its whole-read bound').toEqual({ state: 'oversize', text: '' });
    expect(blobPlainTextMeasured(Uint8Array.from([0, 255]), false, idx, 10), 'bytes that are no Brotli').toEqual({ state: 'undecodable', text: '' });
    const deep = Buffer.from('['.repeat(100_000));
    expect(blobPlainTextMeasured(brotli(deep), false, idx, deep.length), 'a body past the structure bound').toEqual({ state: 'undecodable', text: '' });
  });
  it('blobPlainText keeps its old meaning: the text of a text, and \'\' for every other state', () => {
    const ok = body('the summary');
    expect(blobPlainText(ok.z, false, idx, ok.len)).toBe('the summary');
    expect(blobPlainText(ok.z, false, idx, BLOB_DECODE_MAX + 1)).toBe('');
    expect(blobPlainText(null, false, idx, 5)).toBe('');
    expect(blobPlainText(Uint8Array.from([0, 255]), false, idx, 10)).toBe('');
    expect(blobPlainText(ok.z, true, idx, SIDECAR_WHOLE_MAX + 1)).toBe('');
  });
});

// ── schema v2: every derived index, versioned (D-5015, D-5018, D-5019, D-5020; review 441 F1) ─────────────────────
// A healthy pass asks "is any blob still owed an FTS row?" on every tick (sweep.mjs's ftsOwesRow). Without an index on fts_indexed that is
// a read of the whole blobs table, which cost minutes of cold I/O on a half-gigabyte store; schema v2's partial index makes it O(index), the
// two owed queries NAME it (INDEXED BY, behind a presence guard) so a stored statistic cannot steer them back to a scan, and the probe into
// `entries` is covering. The two node indexes derivation used to make with an unversioned IF NOT EXISTS are made here too.
describe('schema v2: the owed-row index, its covering probe and the node indexes (D-5015, D-5018, D-5019, D-5020)', () => {
  interface OwedPlans { owes: string[]; backfill: string[]; owesSql: string; backfillSql: string }
  interface FreeOk { state: 'ok'; bytes: number; fsSize: number }
  interface OwedSweep {
    ftsOwedPlans(db: DatabaseSync): OwedPlans; ftsOwesRow(db: DatabaseSync): boolean;
    migrationVerdict(db: DatabaseSync, home: string, P: unknown, o: {
      stored: number; code: number; free: FreeOk; sizeBytes: number; boundS: number | null; schemaAdded: unknown;
    }): string;
  }
  const loadSweep = async (): Promise<OwedSweep> => (await import('../../ccd/history/sweep.mjs')) as unknown as OwedSweep;
  const fresh = (): { h: string; file: string } => { const h = mkTmp('ccrc-history-v2idx-'); createStore(h); return { h, file: historyPaths(h).dbFile }; };
  const INDEXED_BY = ' INDEXED BY blobs_unindexed';
  /** Both owed queries' plans on a fresh writer connection (so sqlite_stat1 is read as stored), as the pass would prepare them. The
   *  backfill's statement needs the FTS tables, as ftsStmts does. The connection is closed plainly: closeWriter's PRAGMA optimize
   *  would write statistics of its own into the fixture. */
  const plansOf = async (file: string): Promise<OwedPlans> => {
    const S = await loadSweep();
    const db = openWriter(file);
    try {
      if (!probeTables(db)) createFtsTables(db);
      return S.ftsOwedPlans(db);
    } finally { db.close(); }
  };
  const probeTables = (db: DatabaseSync): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'blobs_fts'").get() !== undefined;
  const planOfSql = (file: string, sql: string, ...args: unknown[]): string[] => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as never[])) as Array<{ detail: string }>).map((r) => String(r.detail)); } finally { db.close(); }
  };
  const withDb = <T>(file: string, fn: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(file); try { return fn(db); } finally { db.close(); } };
  const usesTheIndex = (plan: string[], what: string): void => {
    expect(plan[0], `${what}: ${plan.join(' | ')}`).toMatch(/^(SCAN|SEARCH) b USING INDEX blobs_unindexed\b/);
    expect(plan.filter((l) => /^SCAN b\s*$/.test(l) || /^SEARCH b USING INTEGER PRIMARY KEY/.test(l)), `${what}: a full read of blobs: ${plan.join(' | ')}`).toEqual([]);
  };

  it('PIN (a): EXPLAIN QUERY PLAN of the owed check and of the backfill names the index and has no full read of blobs', async () => {
    const { file } = fresh();
    plantBlobs(file, { owed: 3, indexed: 3, pruned: 3 });
    const p = await plansOf(file);
    usesTheIndex(p.owes, 'the owed check');
    usesTheIndex(p.backfill, 'the backfill select');
    expect(p.owesSql, 'the owed check names the index').toContain(`FROM blobs b${INDEXED_BY} WHERE`);
    expect(p.backfillSql, 'the backfill names the index').toContain(`FROM blobs b${INDEXED_BY}`);
  });

  it('CONTROL: the same two queries over a v1 store (no index) are the plain full read the pin refuses, so the pin is not vacuous', async () => {
    const { file } = fresh();
    rewindStoreToV1(file);
    const p = await plansOf(file);
    expect(p.owes.filter((l) => /^SCAN b\s*$/.test(l))).toEqual(['SCAN b']);
    expect(p.backfill[0]).toMatch(/^SEARCH b USING INTEGER PRIMARY KEY/);
  });

  // The statistics PRAGMA optimize writes at a writer's close (closeWriter) are what steer the planner off an unforced partial index: at
  // most of the blobs rows (the review put it at about 70-75%; it reproduces here at 90%), it takes `SCAN b` for the owed check and the
  // rowid range for the backfill, both of which read every blob row, overflow chains included. The review also saw a recorded-empty
  // (`0 0`) index flip on its fixture; that did NOT reproduce here (D-5018). These two pins run ANALYZE first, which PIN (a) does not:
  // (a2) has a CONTROL that shows the plain form flipping under the same statistics, (a3) pins the forced plan at `0 0` and has none.
  it('PIN (a2): at a 90% unindexed share, once ANALYZEd, both queries still plan the index; the plain form flips to the full read', async () => {
    const { file } = fresh();
    plantBlobs(file, { owed: 180, indexed: 20 });
    withDb(file, (db) => db.exec('ANALYZE'));
    const stat = withDb(file, (db) => db.prepare("SELECT stat FROM sqlite_stat1 WHERE idx = 'blobs_unindexed'").get() as { stat: string });
    expect(stat.stat, 'the statistic records the index as 180 of 200 rows').toBe('180 1');
    const p = await plansOf(file);
    usesTheIndex(p.owes, 'owed check at 90%');
    usesTheIndex(p.backfill, 'backfill at 90%');
    const P = [...INDEXED_PROVENANCE, ...INDEXED_PROVENANCE];
    const plainOwes = planOfSql(file, p.owesSql.replace(INDEXED_BY, ''), ...P);
    const plainBackfill = planOfSql(file, p.backfillSql.replace(INDEXED_BY, ''), 0, ...P, 1);
    expect(plainOwes.filter((l) => /^SCAN b\s*$/.test(l)), `CONTROL: the plain owed check flips: ${plainOwes.join(' | ')}`).toEqual(['SCAN b']);
    expect(plainBackfill[0], `CONTROL: the plain backfill flips: ${plainBackfill.join(' | ')}`).toMatch(/^SEARCH b USING INTEGER PRIMARY KEY/);
  });

  it('PIN (a3): with the index recorded empty (`0 0`) and owed rows planted after, both queries still plan the index', async () => {
    const { file } = fresh();
    plantBlobs(file, { indexed: 2000 });
    withDb(file, (db) => db.exec('ANALYZE'));
    expect(withDb(file, (db) => (db.prepare("SELECT stat FROM sqlite_stat1 WHERE idx = 'blobs_unindexed'").get() as { stat: string }).stat), 'CONTROL: ANALYZE over the empty index records `0 0`').toBe('0 0');
    plantBlobs(file, { owed: 5 });
    const p = await plansOf(file);
    usesTheIndex(p.owes, 'owed check at `0 0`');
    usesTheIndex(p.backfill, 'backfill at `0 0`');
  });

  it('GUARD, the owed check: over a store with no owed-row index (v1, or v2 with it dropped) it answers, it does not throw "no such index"', async () => {
    const S = await loadSweep();
    for (const how of ['v1', 'v2-index-gone'] as const) {
      const { file } = fresh();
      plantBlobs(file, { owed: 2 });
      if (how === 'v1') rewindStoreToV1(file); else withDb(file, (db) => db.exec('DROP INDEX blobs_unindexed'));
      const db = openWriter(file);
      try {
        expect(() => S.ftsOwesRow(db), how).not.toThrow();
        expect(S.ftsOwesRow(db), `${how}: the plain form answers the same question (a blob with bytes and no referrer is not eligible)`).toBe(false);
      } finally { db.close(); }
    }
  });

  it('GUARD, the backfill: its statement is prepared over a store with no owed-row index, in the plain form', async () => {
    const S = await loadSweep();
    for (const how of ['v1', 'v2-index-gone'] as const) {
      const { file } = fresh();
      if (how === 'v1') rewindStoreToV1(file); else withDb(file, (db) => db.exec('DROP INDEX blobs_unindexed'));
      const db = openWriter(file);
      try {
        createFtsTables(db);
        let p: OwedPlans | null = null;
        expect(() => { p = S.ftsOwedPlans(db); }, how).not.toThrow();
        expect(p!.backfillSql, `${how}: no INDEXED BY where there is nothing to name`).not.toContain('INDEXED BY');
        expect(p!.owesSql, `${how}: no INDEXED BY where there is nothing to name`).not.toContain('INDEXED BY');
      } finally { db.close(); }
    }
  });

  // Only the owed CHECK follows the index on one handle: ftsOwesRow measures it per call. ftsStmts measures it once per handle, with the
  // statement it prepares, and this test does not claim otherwise (D-5018): no production path migrates under a handle that has prepared
  // ftsStmts (the scheduled pass returns right after runMigration, migrateOp returns, and every other op is refused migration-pending).
  it('GUARD, the other way: the owed check is measured per call, so a store that gains the index (its migration) is not left on the plain form', async () => {
    const S = await loadSweep();
    const { file } = fresh();
    rewindStoreToV1(file);
    const db = openWriter(file);
    try {
      createFtsTables(db);
      expect(S.ftsOwedPlans(db).owesSql).not.toContain('INDEXED BY');
      db.exec(MIGRATIONS[1]!);
      expect(S.ftsOwedPlans(db).owesSql, 'measured per call: the owed check now names it').toContain(INDEXED_BY);
    } finally { db.close(); }
  });

  it('PIN (d): the owed check\'s probe into entries is COVERING (entries_blob_prov), and no other probe scans a table', async () => {
    const { file } = fresh();
    plantBlobs(file, { owed: 2 });
    const p = await plansOf(file);
    for (const [name, plan] of [['owed check', p.owes], ['backfill', p.backfill]] as const) {
      expect(plan, `${name}: the entries probe reads the covering index alone`).toContain('SEARCH e USING COVERING INDEX entries_blob_prov (blob_id=? AND provenance=?)');
      expect(plan, `${name}: the sidecars probe is covering too`).toContain('SEARCH s USING COVERING INDEX sidecars_blob (blob_id=?)');
      // the variants probe is the one that is not covering (entry_variants_blob holds blob_id alone); it is read per blob, a handful of
      // pages while entry_variants is nearly empty, and its entries row is fetched by primary key only for a blob that HAS a variant
      expect(plan, `${name}: the variants probe`).toContain('SEARCH v USING INDEX entry_variants_blob (blob_id=?)');
      expect(plan.filter((l) => /^SCAN /.test(l)), `${name}: the one scan is the owed index; every probe is a SEARCH`).toHaveLength(name === 'owed check' ? 1 : 0);
    }
  });

  it('PIN (b): the index leaves out what can never be owed: N pruned tombstones and N indexed blobs, 0 owed, 0 entries; one owed blob, one entry', () => {
    const { file } = fresh();
    plantBlobs(file, { pruned: 40, indexed: 40 });
    const none = owedIndexFacts(file);
    expect(none.entries, 'a tombstone (z NULL, fts_indexed 0) is never owed, so it is not indexed; nor is an indexed blob').toBe(0);
    expect(none.sql, 'the index has its predicate, spelled once in store.mjs').toBe('CREATE INDEX blobs_unindexed ON blobs(blob_id) WHERE fts_indexed = 0 AND z IS NOT NULL');
    plantBlobs(file, { owed: 1 });
    expect(owedIndexFacts(file).entries, 'CONTROL: an unindexed blob with bytes is').toBe(1);
  });

  it('PIN (b2): prune\'s tombstone leaves the index: pruneBatch on an owed blob takes it out', () => {
    const { h, file } = fresh();
    plantBlobs(file, { owed: 2 });
    expect(owedIndexFacts(file).entries).toBe(2);
    const db = openWriter(historyPaths(h).dbFile);
    try { expect(pruneBatch(db, { blobIds: [1, 2], nowMs: 1, fts: false })).toBe(2); } finally { closeWriter(db); }
    expect(owedIndexFacts(file).entries, 'a pruned blob keeps fts_indexed = 0 with z NULL, and the predicate leaves it out').toBe(0);
  });

  it('PIN (c): a fresh store and a migrated v1 store have the same schema, and the same user_version', () => {
    const fresh2 = fresh();
    // The v1 store is built from MIGRATIONS[0] alone, never through createStore, so the migration is what adds every v2 index.
    const h = mkTmp('ccrc-history-v2idx-mig-');
    fs.mkdirSync(historyPaths(h).backups, { recursive: true, mode: 0o700 });
    const v1File = path.join(h, 'v1.db');
    const old = new DatabaseSync(v1File);
    old.exec(MIGRATIONS[0]!);
    old.exec('PRAGMA user_version = 1');
    const dump = (db: DatabaseSync): unknown[] => db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const names = (rows: unknown[]): string[] => rows.map((r) => (r as { name: string }).name);
    const before = dump(old);
    for (const ix of V2_INDEXES) expect(names(before), `CONTROL: v1 has no ${ix}`).not.toContain(ix);
    runMigration(old, h, { verdict: 'snapshot-then-migrate', from: 1, to: 2, migrations: MIGRATIONS });
    expect(userVersion(old)).toBe(2);
    const now = dump(old);
    old.close();
    for (const ix of V2_INDEXES) expect(names(now), `the migration made ${ix}`).toContain(ix);
    const f = new DatabaseSync(fresh2.file, { readOnly: true });
    try {
      expect(userVersion(f)).toBe(SCHEMA_VERSION);
      expect(now).toEqual(dump(f));
    } finally { f.close(); }
  });

  it('SCHEMA_ADDED[2] is HEAVY (ruling 5012, §6.11) and adds no table or column; MIGRATIONS[1] is exactly four plain CREATE INDEXes, and V2_INDEXES lists them', () => {
    expect(SCHEMA_ADDED[2]).toEqual({ heavy: true, tables: {} });
    expect(MIGRATIONS).toHaveLength(2);
    const stmts = MIGRATIONS[1]!.trim().split(';').map((x) => x.trim()).filter((x) => x !== '');
    expect(stmts).toEqual([
      'CREATE INDEX blobs_unindexed ON blobs(blob_id) WHERE fts_indexed = 0 AND z IS NOT NULL',
      'CREATE INDEX entries_blob_prov ON entries(blob_id, provenance)',
      'CREATE INDEX nodes_boundary ON nodes(boundary_entry_id)',
      'CREATE INDEX node_children_child ON node_children(child_id)',
    ]);
    expect(V2_INDEXES).toEqual(['blobs_unindexed', 'entries_blob_prov', 'nodes_boundary', 'node_children_child']);
    expect(OWED_INDEX, 'the name sweep.mjs forces is V2\'s first statement\'s').toBe(V2_INDEXES[0]);
    expect(MIGRATIONS.some((m) => /IF NOT EXISTS/i.test(m) && /INDEX/i.test(m)), 'no unversioned index creation').toBe(false);
  });

  it('createStore builds a fresh store by running every migration in order: every v2 index is there', () => {
    const { file } = fresh();
    const db = new DatabaseSync(file, { readOnly: true });
    try { expect(userVersion(db)).toBe(MIGRATIONS.length); } finally { db.close(); }
    expect(owedIndexFacts(file).sql, 'the owed-row index is there on a store born at this build').not.toBeNull();
    const have = withDb(file, (db) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name));
    for (const ix of V2_INDEXES) expect(have, ix).toContain(ix);
  });

  it('DM43 on the REAL v2 (ruling 5012): migrationVerdict reads SCHEMA_ADDED\'s heavy flag, so a v1 store of 1.5 GB + 1 byte at the default rate answers snapshot-needs-op, and one of exactly 1.5 GB (the strict half-bound) copies', async () => {
    const S = await loadSweep();
    const h = mkTmp('ccrc-history-v2heavy-');
    createStore(h);
    const db = openWriter(historyPaths(h).dbFile);
    const TiB = 1024 ** 4;
    const half = (600 / 2) * 10_000_000 / 2;   // CARRIER_KILL_S / 2 seconds, at DEFAULT_COPY_BPS, the estimate counted twice: 1.5 GB
    const verdict = (sizeBytes: number, schemaAdded: unknown): string => S.migrationVerdict(db, h, null, {
      stored: 1, code: 2, free: { state: 'ok', bytes: TiB, fsSize: 2 * TiB }, sizeBytes, boundS: 600, schemaAdded,
    });
    try {
      expect(half).toBe(1_500_000_000);
      expect(getMeta(db, 'copy_bps'), 'CONTROL: no recorded copy_bps, so the default 10 MB/s rate').toBeNull();
      expect(verdict(half + 1, SCHEMA_ADDED), 'the real v2 is counted twice: 1.5 GB + 1 is over the half-bound').toBe('snapshot-needs-op');
      expect(verdict(half, SCHEMA_ADDED), 'the test is strict: exactly the half-bound copies').toBe('snapshot-then-migrate');
      expect(verdict(half - 1, SCHEMA_ADDED)).toBe('snapshot-then-migrate');
      // CONTROL: the same sizes with v2 light (a seam, not the real entry) are counted once and copy up to 3 GB.
      const light = { ...SCHEMA_ADDED, 2: { heavy: false, tables: {} } };
      expect(verdict(half + 1, light), 'CONTROL: a light v2 at 1.5 GB + 1 copies').toBe('snapshot-then-migrate');
      expect(verdict(2 * half + 1, light), 'CONTROL: and a light v2 escalates only past 3 GB').toBe('snapshot-needs-op');
    } finally { db.close(); }
  });

  it('D-5019: entries_blob stays beside the covering index (the spec\'s DDL and B1\'s listing name it), and v2 drops nothing', () => {
    const { file } = fresh();
    const have = withDb(file, (db) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'entries'").all() as Array<{ name: string }>).map((r) => r.name));
    expect(have).toContain('entries_blob');
    expect(have).toContain('entries_blob_prov');
    expect(MIGRATIONS[1], 'v2 is additive: it drops no index').not.toMatch(/\bDROP\b/i);
  });

  it('D-5020: no index is made outside MIGRATIONS: ccd/history/ holds no CREATE INDEX but store.mjs\'s V1 and V2, and none with IF NOT EXISTS', () => {
    const dir = fileURLToPath(new URL('../../ccd/history/', import.meta.url));
    const re = /CREATE\s+(UNIQUE\s+)?INDEX\b/gi;
    for (const name of fs.readdirSync(dir).filter((n) => /\.(mjs|mts|ts|js)$/.test(n))) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      const hits = [...src.matchAll(re)];
      if (name === 'store.mjs') {
        const end = src.indexOf('export const MIGRATIONS');
        expect(end, 'store.mjs\'s MIGRATIONS line').toBeGreaterThan(0);
        expect(hits.filter((m) => m.index! > end).map((m) => m.index), 'store.mjs: a CREATE INDEX after the migration table').toEqual([]);
      } else {
        expect(hits.map((m) => src.slice(Math.max(0, m.index! - 40), m.index! + 60)), `${name}: an index made outside the versioned migrations`).toEqual([]);
      }
      for (const m of hits) expect(src.slice(m.index!, m.index! + 90), `${name}: IF NOT EXISTS`).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });
});

// ===========================================================================
// W1-B4 Task 4: export segments (spec 2026-10-05 §9.15 "Write", "Who reads
// it"; §9.14 "Export replay"; O39's store half). In-process on real files in
// mkTmp directories, and in a child that the fault preload kills or that runs
// under umask 0002. The imports are namespaced, so this block binds no name the
// file already binds; ESM hoists them.
// ===========================================================================
import * as segStore from '../../ccd/history/store.mjs';
import * as segLib from '../../ccd/history/lib.mjs';

describe('store.mjs: export segments (W1-B4; spec 9.15 "Write", "Who reads it"; O39 store half)', () => {
  const SEG_STORE_MJS = path.resolve(__dirname, '../../ccd/history/store.mjs');
  const SEG_FAULTS = path.resolve(__dirname, 'fixtures/history/preload-faults.mjs');
  const SID = '0189abcd-1234-4678-9abc-0000000000f1';
  const W = '0a1b2c3d';
  const G = '0189abcd-1234-4678-9abc-0000000000f2';
  const U1 = '0189abcd-1234-4678-9abc-0000000000a1';
  const E1 = '0189abcd-1234-4678-9abc-0000000000b1';
  const E2 = '0189abcd-1234-4678-9abc-0000000000b2';
  const PATH = '/home/u/.claude-a/projects/-home-u-tree-demo/0189abcd-1234-4678-9abc-0000000000a1.jsonl';
  const DEV = 2049n;
  const INO = 2n ** 60n + 7n;                        // past 2^53: kept exact only as a BigInt
  const NS = 1_764_000_000_123_456_789n;
  const segMode = (p: string): number => fs.statSync(p).mode & 0o777;
  const segWord = (fn: () => unknown): string => {
    try { fn(); } catch (e) { return e instanceof StoreError ? e.word : `not a StoreError: ${String(e)}`; }
    return 'no throw';
  };
  const sha = (n: number): Uint8Array => new Uint8Array(32).fill(n);
  const meta = (seq: number, o: Partial<segStore.SegmentMeta> = {}): segStore.SegmentMeta =>
    ({ storeId: SID, writer: W, seq, harnesses: ['claude-code'], cutoffMs: 1_764_000_000_000, format: segLib.EXPORT_SEGMENT_FORMAT, ...o });
  const freshDir = (): string => segStore.ensureSegmentDir(path.join(mkTmp('ccrc-history-seg-'), segLib.EXPORT_DIR), SID);
  const nameOf = (seq: number): string => segLib.segmentName({ seq, writer: W });
  const entryRow = (uuid: string, blob: Uint8Array): segStore.SegmentRows['entry'] => ({
    uuid, cc_session_uuid: U1, agent_id: '', type: 'user', subtype: null, role: 'user', model: null, parent_uuid: null,
    ts_ms: 1_000_010, request_id: null, api_block_index: null, msg_id: null, source_tool_use_id: null, tool_name: null,
    is_compact_summary: 0, provenance: 'operator', prov_version: 1, parse_state: 'ok', struct_rank_ns: NS, struct_path: PATH,
    struct_dev: DEV, struct_ino: INO, blob_sha256: blob,
  });
  /** One row of every kind, in write order, plus a carried blob and a stub. */
  const fillAll = (ins: segStore.SegmentInserts): number[] => {
    ins.blob({ sha256: sha(1), codec: 'br5', raw_len: 11, z: new Uint8Array([1, 2, 3]), pruned: false });
    ins.blob({ sha256: sha(2), codec: 'br5', raw_len: 40, z: null, pruned: true });
    return [
      ins.family({ ccrc_id: 'claude-a-demo', generation: G, project: 'demo', first_seen_ms: 1_000_000 }),
      ins.transcript({ cc_session_uuid: U1, agent_id: '', harness: 'claude-code', parent_tool_use_id: null, workflow_run_id: null, agent_type: null }),
      ins.epoch({ ccrc_id: 'claude-a-demo', generation: G, seq: 1, cc_session_uuid: U1, cause: 'startup', declared_by: 'hook',
        started_ms: 1_000_000, cwd: '/home/u/tree/demo', cwd_real: '/home/u/tree/demo', git_branch: 'main', confirmed_ms: 1_000_001 }),
      ins.file({ path: PATH, dev: DEV, ino: INO, cc_session_uuid: U1, agent_id: '', size: 512, mtime_ns: NS, eof_ms: 1_000_500 }),
      ins.entry(entryRow(E1, sha(1))),
      ins.variant({ uuid: E1, blob_sha256: sha(2), first_path: PATH, first_dev: DEV, first_ino: INO, first_seen_ms: 1_000_020, cause: 'unknown' }),
      ins.boundary({ uuid: E1, cc_session_uuid: U1, agent_id: '', boundary_ord: 1, trigger: 'manual', head_uuid: null, anchor_uuid: null,
        tail_uuid: null, kept_sha256: null, pre_tokens: 100, post_tokens: 10, duration_ms: 5 }),
      ins.sidecar({ cc_session_uuid: U1, agent_id: '', name: 'tool-results/x.txt', blob_sha256: sha(1), uuid: E1, first_seen_ms: 1_000_030 }),
      ins.membership({ path: PATH, dev: DEV, ino: INO, uuid: E1, line: 3 }),
    ];
  };
  /** A segment built and published in `dir` by this process. */
  const publishOne = (dir: string, seq: number, o: Partial<segStore.SegmentMeta> = {}): string => {
    const name = nameOf(seq);
    const seg = segStore.createSegment(dir, name, meta(seq, o));
    fillAll(segStore.segmentInserts(seg));
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    return path.join(dir, name);
  };
  /** The same build and publish in a child node: under the fault preload with HISTORY_TEST_KILL when `kill` is
   *  given, and under `umask` through /bin/sh. The `timeout` bounds a hang, ending it with SIGTERM so it is never
   *  read as the preload's SIGKILL. */
  const childPublish = (root: string, seq: number, o: { kill?: string; umask?: string } = {}): ReturnType<typeof spawnSync> => {
    const script = [
      `import { ensureSegmentDir, createSegment, segmentInserts, publishSegment } from ${JSON.stringify(pathToFileURL(SEG_STORE_MJS).href)};`,
      'const [root, sid, writer, seq] = process.argv.slice(1);',
      'const dir = ensureSegmentDir(root, sid);',
      'const name = `${seq}.${writer}.db`;',
      "const seg = createSegment(dir, name, { storeId: sid, writer, seq: Number(seq), harnesses: ['claude-code'], cutoffMs: 0, format: 1 });",
      "segmentInserts(seg).blob({ sha256: new Uint8Array(32).fill(7), codec: 'br5', raw_len: 3, z: new Uint8Array([1, 2, 3]), pruned: false });",
      'process.stdout.write(publishSegment(seg, dir, name));',
    ].join('\n');
    const node = [process.execPath, '--no-warnings', ...(o.kill ? ['--import', pathToFileURL(SEG_FAULTS).href] : []), '--input-type=module', '-e', script, root, SID, W, String(seq)];
    const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', HOME: path.dirname(root), ...(o.kill ? { HISTORY_TEST_KILL: o.kill } : {}) };
    return o.umask
      ? spawnSync('/bin/sh', ['-c', `umask ${o.umask}; exec "$@"`, 'sh', ...node], { encoding: 'utf8', env, timeout: 60_000, killSignal: 'SIGTERM' })
      : spawnSync(node[0]!, node.slice(1), { encoding: 'utf8', env, timeout: 60_000, killSignal: 'SIGTERM' });
  };

  it('O39: built in a dot-temp, published by link, and read back whole: meta, a blob and a stub, every row kind in write order, BigInts exact', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    expect(fillAll(segStore.segmentInserts(seg))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fs.readdirSync(dir)).toEqual([segLib.segmentTempName(name)]);
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    expect(seg.db).toBeNull();
    expect(fs.readdirSync(dir), 'the temp is gone and no -journal, -wal or -shm is left beside the segment').toEqual([name]);
    expect(segStore.listSegments(dir)).toEqual([{ name, seq: 1, writer: W, bytes: fs.statSync(path.join(dir, name)).size }]);
    const db = segStore.openSegment(path.join(dir, name));
    try {
      expect(segStore.segmentMeta(db)).toEqual(meta(1));
      const blobs = segStore.segmentBlobsAfter(db, 0, 1 << 20, 'bytes');
      expect(blobs.map((b) => [b.rowid, b.raw_len, b.pruned, b.z === null ? null : [...b.z]])).toEqual([[1, 11, false, [1, 2, 3]]]);
      expect([...blobs[0]!.sha256]).toEqual([...sha(1)]);
      const stubs = segStore.segmentBlobsAfter(db, 0, 1 << 20, 'stubs');
      expect(stubs.map((b) => [b.rowid, b.raw_len, b.pruned, b.z === null ? null : [...b.z]]), 'the stub is the other kind\'s (D-5397)').toEqual([[2, 40, true, null]]);
      const rows = segStore.segmentRowsAfter(db, 0, 100);
      expect(rows.map((r) => [r.ord, r.kind])).toEqual([[1, 'family'], [2, 'transcript'], [3, 'epoch'], [4, 'file'], [5, 'entry'],
        [6, 'variant'], [7, 'boundary'], [8, 'sidecar'], [9, 'membership']]);
      const file = rows[3]!.row as segStore.SegmentRows['file'];
      expect([file.dev, file.ino, file.mtime_ns]).toEqual([DEV, INO, NS]);
      expect(typeof file.size).toBe('number');
      expect(typeof file.eof_ms).toBe('number');
      const entry = rows[4]!.row as segStore.SegmentRows['entry'];
      expect([entry.struct_rank_ns, entry.struct_ino, entry.ts_ms, entry.is_compact_summary]).toEqual([NS, INO, 1_000_010, 0]);
      expect([...entry.blob_sha256]).toEqual([...sha(1)]);
      expect(rows[8]!.row).toEqual({ path: PATH, dev: DEV, ino: INO, uuid: E1, line: 3 });
    } finally {
      db.close();
    }
  });

  it('pages: rows after an ord come back in write order across kinds, and a blob page stops before its bound but always takes one', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    const ins = segStore.segmentInserts(seg);
    for (const n of [1, 2, 3]) ins.blob({ sha256: sha(n), codec: 'br5', raw_len: 10, z: new Uint8Array(10).fill(n), pruned: false });
    ins.entry(entryRow(E1, sha(1)));                                        // ord 1
    ins.membership({ path: PATH, dev: DEV, ino: INO, uuid: E1, line: 1 }); // ord 2
    ins.entry(entryRow(E2, sha(2)));                                        // ord 3
    ins.membership({ path: PATH, dev: DEV, ino: INO, uuid: E2, line: 2 }); // ord 4
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    const db = segStore.openSegment(path.join(dir, name));
    try {
      expect(segStore.segmentRowsAfter(db, 0, 10).map((r) => [r.ord, r.kind])).toEqual([[1, 'entry'], [2, 'membership'], [3, 'entry'], [4, 'membership']]);
      expect(segStore.segmentRowsAfter(db, 1, 2).map((r) => r.ord)).toEqual([2, 3]);
      expect(segStore.segmentRowsAfter(db, 4, 10)).toEqual([]);
      expect(segStore.segmentBlobsAfter(db, 0, 25, 'bytes').map((b) => b.rowid)).toEqual([1, 2]);
      expect(segStore.segmentBlobsAfter(db, 2, 25, 'bytes').map((b) => b.rowid)).toEqual([3]);
      expect(segStore.segmentBlobsAfter(db, 0, 1, 'bytes').map((b) => b.rowid), 'the first blob whatever its size').toEqual([1]);
    } finally {
      db.close();
    }
  });

  it('D-5397: a blob page is one kind, bytes or stubs, in rowid order whatever sits between them; a stub counts no bytes against the bound; any other kind throws', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    const ins = segStore.segmentInserts(seg);
    // rowids: 1 bytes, 2 stub, 3 bytes, 4 stub, 5 stub, 6 bytes
    ins.blob({ sha256: sha(1), codec: 'br5', raw_len: 10, z: new Uint8Array(10).fill(1), pruned: false });
    ins.blob({ sha256: sha(2), codec: 'br5', raw_len: 10, z: null, pruned: true });
    ins.blob({ sha256: sha(3), codec: 'br5', raw_len: 10, z: new Uint8Array(10).fill(3), pruned: false });
    ins.blob({ sha256: sha(4), codec: 'br5', raw_len: 10, z: null, pruned: true });
    ins.blob({ sha256: sha(5), codec: 'br5', raw_len: 10, z: null, pruned: true });
    ins.blob({ sha256: sha(6), codec: 'br5', raw_len: 10, z: new Uint8Array(10).fill(6), pruned: false });
    expect(segStore.publishSegment(seg, dir, name)).toBe('linked');
    const db = segStore.openSegment(path.join(dir, name));
    try {
      expect(segStore.segmentBlobsAfter(db, 0, 1 << 20, 'bytes').map((b) => b.rowid)).toEqual([1, 3, 6]);
      expect(segStore.segmentBlobsAfter(db, 0, 1 << 20, 'stubs').map((b) => b.rowid)).toEqual([2, 4, 5]);
      expect(segStore.segmentBlobsAfter(db, 1, 1 << 20, 'bytes').map((b) => b.rowid), 'past a rowid, of its own kind').toEqual([3, 6]);
      expect(segStore.segmentBlobsAfter(db, 2, 1 << 20, 'stubs').map((b) => b.rowid)).toEqual([4, 5]);
      expect(segStore.segmentBlobsAfter(db, 0, 15, 'bytes').map((b) => b.rowid), 'bytes count against the bound: one more would pass it').toEqual([1]);
      expect(segStore.segmentBlobsAfter(db, 0, 0, 'stubs').map((b) => b.rowid), 'a stub counts none: the bound never stops a page of stubs').toEqual([2, 4, 5]);
      expect(segStore.segmentBlobsAfter(db, 6, 1 << 20, 'bytes')).toEqual([]);
      expect(segStore.segmentBlobsAfter(db, 5, 1 << 20, 'stubs')).toEqual([]);
      for (const kind of ['all', '', undefined, 'toString', 'constructor']) {
        expect(() => (segStore.segmentBlobsAfter as (...a: unknown[]) => unknown)(db, 0, 1 << 20, kind), String(kind)).toThrow(/segmentBlobsAfter: kind is bytes or stubs/);
      }
    } finally {
      db.close();
    }
  });

  it('O39: an existing name answers exists and stays byte-identical; the temp, renumbered, publishes under the next number; a name off its meta is refused', () => {
    const dir = freshDir();
    const name = nameOf(1);
    fs.writeFileSync(path.join(dir, name), 'another writer\'s segment', { mode: 0o600 });
    const seg = segStore.createSegment(dir, name, meta(1));
    fillAll(segStore.segmentInserts(seg));
    expect(segStore.publishSegment(seg, dir, name)).toBe('exists');
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe('another writer\'s segment');
    expect(fs.existsSync(seg.temp), 'the temp is kept for the retry').toBe(true);
    expect(() => segStore.publishSegment(seg, dir, nameOf(2)), 'its meta still says seq 1').toThrow(TypeError);
    segStore.setSegmentSeq(seg.temp, 2);
    expect(segStore.publishSegment(seg, dir, nameOf(2))).toBe('linked');
    expect(fs.readdirSync(dir).sort()).toEqual([name, nameOf(2)].sort());
    const db = segStore.openSegment(path.join(dir, nameOf(2)));
    try { expect(segStore.segmentMeta(db).seq).toBe(2); } finally { db.close(); }
  });

  it('O39: a kill at the link leaves only the temp, and removeStaleSegmentTemps removes it with its sidecars and nothing else', () => {
    const root = path.join(mkTmp('ccrc-history-seg-kill-'), segLib.EXPORT_DIR);
    const r = childPublish(root, 1, { kill: `linkSync:${nameOf(1)}:1` });
    expect(r.signal, String(r.stderr)).toBe('SIGKILL');
    const dir = path.join(root, SID);
    const temp = segLib.segmentTempName(nameOf(1));
    expect(fs.readdirSync(dir)).toEqual([temp]);
    for (const stray of [`${temp}-journal`, '.notes.tmp', 'notes.txt']) fs.writeFileSync(path.join(dir, stray), '');
    expect(segStore.removeStaleSegmentTemps(dir)).toEqual([temp, `${temp}-journal`]);
    expect(fs.readdirSync(dir).sort()).toEqual(['.notes.tmp', 'notes.txt']);
    expect(segStore.removeStaleSegmentTemps(path.join(root, 'absent'))).toEqual([]);
    expect(segStore.listSegments(path.join(root, 'absent'))).toEqual([]);
  });

  it('F22: a non-empty directory planted at a temp\'s name is kept and not listed, and the stale-temp removal never throws on it; an empty one is removed', () => {
    const dir = freshDir();
    const planted = path.join(dir, segLib.segmentTempName(nameOf(7)));
    fs.mkdirSync(planted);
    fs.writeFileSync(path.join(planted, 'not-ours.txt'), 'a same-user process put this here');
    const empty = path.join(dir, segLib.segmentTempName(nameOf(8)));
    fs.mkdirSync(empty);
    const stale = segLib.segmentTempName(nameOf(9));
    fs.writeFileSync(path.join(dir, stale), '');
    let removed: string[] = [];
    expect(() => { removed = segStore.removeStaleSegmentTemps(dir); }, 'a planted directory never wedges the pass').not.toThrow();
    expect(removed, 'the kept directory is not listed').toEqual([segLib.segmentTempName(nameOf(8)), stale]);
    expect(fs.readdirSync(planted), 'never recursed into').toEqual(['not-ours.txt']);
    expect(fs.existsSync(empty)).toBe(false);
    expect(segStore.removeStaleSegmentTemps(dir), 'the next pass meets it again and still does not throw').toEqual([]);
  });

  it('F23: ensureSegmentDir fsyncs every directory that gained an entry, up to and including export/, and nothing on a second call', () => {
    const base = mkTmp('ccrc-history-seg-durable-');
    const exportRoot = path.join(base, segLib.EXPORT_DIR);
    const first = recordDirFsyncs(() => segStore.ensureSegmentDir(exportRoot, SID));
    expect(first.out).toBe(path.join(exportRoot, SID));
    expect(first.dirs, 'the history root gained export/, and export/ gained <store_id>/').toEqual([base, exportRoot]);
    expect(recordDirFsyncs(() => segStore.ensureSegmentDir(exportRoot, SID)).dirs).toEqual([]);
  });

  it('modes: under an inherited umask 0002 the segment is 0600 and export/ and export/<store_id>/ are 0700; a hand-made export/ at 0755 is brought to 0700', () => {
    const root = path.join(mkTmp('ccrc-history-seg-umask-'), segLib.EXPORT_DIR);
    const r = childPublish(root, 1, { umask: '0002' });
    expect(r.status, String(r.stderr)).toBe(0);
    expect(r.stdout).toBe('linked');
    expect(segMode(root)).toBe(0o700);
    expect(segMode(path.join(root, SID))).toBe(0o700);
    expect(segMode(path.join(root, SID, nameOf(1)))).toBe(0o600);
    const hand = path.join(mkTmp('ccrc-history-seg-hand-'), segLib.EXPORT_DIR);
    fs.mkdirSync(path.join(hand, SID), { recursive: true });
    fs.chmodSync(hand, 0o755);
    fs.chmodSync(path.join(hand, SID), 0o755);
    expect(segStore.ensureSegmentDir(hand, SID)).toBe(path.join(hand, SID));
    expect([segMode(hand), segMode(path.join(hand, SID))]).toEqual([0o700, 0o700]);
    expect(() => segStore.ensureSegmentDir(hand, '../elsewhere')).toThrow(TypeError);
  });

  it('format guard: a built segment\'s schema is EXPORT_SEGMENT_FORMAT\'s literal; a blob row is bytes or a stub, never a mix', () => {
    const FORMATS: Record<number, Record<string, string[]>> = {
      1: {
        meta: ['k TEXT pk', 'v TEXT nn'],
        blobs: ['sha256 BLOB pk', 'codec TEXT nn', 'raw_len INTEGER nn', 'z BLOB', 'pruned INTEGER nn'],
        families: ['ord INTEGER pk', 'ccrc_id TEXT nn', 'generation TEXT nn', 'project TEXT nn',
          'first_seen_ms INTEGER nn'],
        transcripts: ['ord INTEGER pk', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn', 'harness TEXT nn',
          'parent_tool_use_id TEXT', 'workflow_run_id TEXT', 'agent_type TEXT'],
        epochs: ['ord INTEGER pk', 'ccrc_id TEXT nn', 'generation TEXT nn', 'seq INTEGER nn',
          'cc_session_uuid TEXT nn', 'cause TEXT nn', 'declared_by TEXT nn', 'started_ms INTEGER', 'cwd TEXT',
          'cwd_real TEXT', 'git_branch TEXT', 'confirmed_ms INTEGER'],
        files: ['ord INTEGER pk', 'path TEXT nn', 'dev INTEGER nn', 'ino INTEGER nn', 'cc_session_uuid TEXT nn',
          'agent_id TEXT nn', 'size INTEGER', 'mtime_ns INTEGER', 'eof_ms INTEGER'],
        entries: ['ord INTEGER pk', 'uuid TEXT nn', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn', 'type TEXT nn',
          'subtype TEXT', 'role TEXT', 'model TEXT', 'parent_uuid TEXT', 'ts_ms INTEGER', 'request_id TEXT',
          'api_block_index INTEGER', 'msg_id TEXT', 'source_tool_use_id TEXT', 'tool_name TEXT',
          'is_compact_summary INTEGER nn', 'provenance TEXT nn', 'prov_version INTEGER nn', 'parse_state TEXT nn',
          'struct_rank_ns INTEGER nn', 'struct_path TEXT nn', 'struct_dev INTEGER nn', 'struct_ino INTEGER nn',
          'blob_sha256 BLOB nn'],
        variants: ['ord INTEGER pk', 'uuid TEXT nn', 'blob_sha256 BLOB nn', 'first_path TEXT nn',
          'first_dev INTEGER nn', 'first_ino INTEGER nn', 'first_seen_ms INTEGER nn', 'cause TEXT nn'],
        boundaries: ['ord INTEGER pk', 'uuid TEXT nn', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn',
          'boundary_ord INTEGER nn', 'trigger TEXT', 'head_uuid TEXT', 'anchor_uuid TEXT', 'tail_uuid TEXT',
          'kept_sha256 BLOB', 'pre_tokens INTEGER', 'post_tokens INTEGER', 'duration_ms INTEGER'],
        sidecars: ['ord INTEGER pk', 'cc_session_uuid TEXT nn', 'agent_id TEXT nn', 'name TEXT nn',
          'blob_sha256 BLOB nn', 'uuid TEXT', 'first_seen_ms INTEGER nn'],
        memberships: ['ord INTEGER pk', 'path TEXT nn', 'dev INTEGER nn', 'ino INTEGER nn', 'uuid TEXT nn',
          'line INTEGER nn'],
      },
    };
    const dir = freshDir();
    const p = publishOne(dir, 1);
    const db = segStore.openSegment(p);
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid").all().map((t) => String(t['name']));
      const schema = Object.fromEntries(tables.map((t) => [t, db.prepare('SELECT name, type, "notnull" AS nn, pk FROM pragma_table_info(?) ORDER BY cid').all(t)
        .map((c) => `${String(c['name'])} ${String(c['type'])}${Number(c['nn']) ? ' nn' : ''}${Number(c['pk']) ? ' pk' : ''}`)]));
      expect(schema, 'the segment DDL changed: bump EXPORT_SEGMENT_FORMAT and add its literal here').toEqual(FORMATS[segLib.EXPORT_SEGMENT_FORMAT]);
    } finally {
      db.close();
    }
    const seg = segStore.createSegment(dir, nameOf(2), meta(2));
    const ins = segStore.segmentInserts(seg);
    expect(() => ins.blob({ sha256: sha(5), codec: 'br5', raw_len: 1, z: null, pruned: false })).toThrow();
    expect(() => ins.blob({ sha256: sha(6), codec: 'br5', raw_len: 1, z: new Uint8Array([1]), pruned: true })).toThrow();
    seg.db!.close();
  });

  it('openSegment is read-only, and refuses a link, a directory, an empty file and a file that is not a segment', () => {
    const dir = freshDir();
    const p = publishOne(dir, 1);
    const db = segStore.openSegment(p);
    try {
      expect(() => db.exec("INSERT INTO meta (k, v) VALUES ('x', 'y')")).toThrow();
      expect(() => db.exec('CREATE TEMP TABLE t (a)'), 'query_only refuses what readOnly lets through').toThrow();
    } finally {
      db.close();
    }
    const link = path.join(dir, nameOf(2));
    fs.symlinkSync(p, link);
    fs.mkdirSync(path.join(dir, nameOf(3)));
    fs.writeFileSync(path.join(dir, nameOf(4)), '');
    fs.writeFileSync(path.join(dir, nameOf(5)), 'not a database at all, but long enough to be read as one');
    expect(segWord(() => segStore.openSegment(link))).toBe('segment-unreadable');
    expect(segWord(() => segStore.openSegment(path.join(dir, nameOf(3))))).toBe('segment-unreadable');
    expect(segWord(() => segStore.openSegment(path.join(dir, nameOf(4))))).toBe('segment-unreadable');
    expect(segWord(() => segStore.openSegment(path.join(dir, 'absent.db')))).toBe('segment-unreadable');
    expect(segWord(() => {
      const junk = segStore.openSegment(path.join(dir, nameOf(5)));
      try { return segStore.segmentMeta(junk); } finally { junk.close(); }
    })).toBe('segment-unreadable');
    expect(segStore.listSegments(dir).map((s) => s.name), 'a link, a directory and a stray are not segments').toEqual([nameOf(1), nameOf(4), nameOf(5)]);
  });

  it('segmentMeta reads a newer format\'s meta by the same six keys, and a key off its grammar is segment-unreadable', () => {
    const dir = freshDir();
    const p2 = publishOne(dir, 2, { format: 2 });
    const db2 = segStore.openSegment(p2);
    try { expect(segStore.segmentMeta(db2)).toEqual(meta(2, { format: 2 })); } finally { db2.close(); }
    const p1 = publishOne(dir, 1);
    const w = new DatabaseSync(p1);
    w.exec("UPDATE meta SET v = 'NOT-HEX!' WHERE k = 'writer'");
    w.close();
    const db1 = segStore.openSegment(p1);
    try { expect(segWord(() => segStore.segmentMeta(db1))).toBe('segment-unreadable'); } finally { db1.close(); }
    expect(segStore.listSegments(dir).map((s) => s.name), '(seq, writer) order').toEqual([nameOf(1), nameOf(2)]);
    publishOne(dir, 10);
    expect(segStore.listSegments(dir).map((s) => s.seq), 'seq numerically, never 10 before 2').toEqual([1, 2, 10]);
  });

  // Task 4 fix round 1 (review): checkSegmentMeta is the replay's only guard on a segment's format and store_id (lib's
  // decideSegmentReplay answers 'replay' for any format <= 1, 0 and NaN included), and publishSegment's two fsyncs are
  // what make a mark committed after the link safe. Each clause below is corrupted or removed ALONE in the mutants.
  it('segmentMeta refuses a format and a store_id off their grammars, each corrupted alone in a published segment (the replay\'s only guard on both)', () => {
    const dir = freshDir();
    const corrupt: Array<[string, string]> = [
      ['format', '0'], ['format', '-1'], ['format', '1.5'], ['format', 'one'], ['format', ''],
      ['store_id', 'not-a-store-id'], ['store_id', ''], ['store_id', SID.toUpperCase()], ['store_id', `${SID}0`],
    ];
    corrupt.forEach(([key, value], i) => {
      const p = publishOne(dir, i + 1);
      const w = new DatabaseSync(p);
      try { w.prepare('UPDATE meta SET v = ? WHERE k = ?').run(value, key); } finally { w.close(); }
      const db = segStore.openSegment(p);
      try {
        expect(segWord(() => segStore.segmentMeta(db)), `${key} = ${JSON.stringify(value)}, every other key as written`).toBe('segment-unreadable');
      } finally {
        db.close();
      }
    });
    const good = publishOne(dir, corrupt.length + 1);
    const db = segStore.openSegment(good);
    try { expect(segStore.segmentMeta(db), 'CONTROL: the same build untouched reads back whole').toEqual(meta(corrupt.length + 1)); } finally { db.close(); }
    // The writer's side of the same grammar: createSegment refuses these before it creates a temp.
    for (const bad of [{ format: 0 }, { format: 1.5 }, { format: Number.NaN }, { storeId: 'not-a-store-id' }]) {
      expect(() => segStore.createSegment(dir, nameOf(99), meta(99, bad)), JSON.stringify(bad)).toThrow(TypeError);
    }
    expect(fs.existsSync(path.join(dir, segLib.segmentTempName(nameOf(99)))), 'and left no temp behind').toBe(false);
  });

  /** Every file or directory fsync, link and unlink `fn` makes in this process, in order, as `fsync-file <path>`,
   *  `fsync-dir <path>`, `link <from> <to>` and `unlink <path>`. A minimal in-process patch of node:fs in
   *  historyHelpers' recordDirFsyncs style (fd -> path from openSync), restored in `finally`;
   *  syncBuiltinESMExports makes store.mjs's named imports see it. Plain node:fs, so it runs on macOS too. */
  const recordPublishOps = <T>(fn: () => T): { out: T; ops: string[] } => {
    const realOpen = fs.openSync; const realClose = fs.closeSync; const realFsync = fs.fsyncSync;
    const realLink = fs.linkSync; const realUnlink = fs.unlinkSync;
    const open = new Map<number, string>();
    const ops: string[] = [];
    fs.openSync = ((p: fs.PathLike, ...rest: unknown[]) => {
      const fd = (realOpen as (...a: unknown[]) => number)(p, ...rest);
      open.set(fd, String(p));
      return fd;
    }) as typeof fs.openSync;
    fs.closeSync = ((fd: number) => { open.delete(fd); return realClose(fd); }) as typeof fs.closeSync;
    fs.fsyncSync = ((fd: number) => {
      const p = open.get(fd);
      if (p !== undefined) ops.push(`${fs.fstatSync(fd).isDirectory() ? 'fsync-dir' : 'fsync-file'} ${p}`);
      return realFsync(fd);
    }) as typeof fs.fsyncSync;
    fs.linkSync = ((from: fs.PathLike, to: fs.PathLike) => { ops.push(`link ${String(from)} ${String(to)}`); return realLink(from, to); }) as typeof fs.linkSync;
    fs.unlinkSync = ((p: fs.PathLike) => { ops.push(`unlink ${String(p)}`); return realUnlink(p); }) as typeof fs.unlinkSync;
    syncBuiltinESMExports();
    try {
      return { out: fn(), ops };
    } finally {
      fs.openSync = realOpen; fs.closeSync = realClose; fs.fsyncSync = realFsync; fs.linkSync = realLink; fs.unlinkSync = realUnlink;
      syncBuiltinESMExports();
    }
  };

  it('9.15 Write: publishSegment fsyncs the temp BEFORE it links it, then unlinks the temp and fsyncs the directory AFTER (what makes a mark after the link safe)', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    fillAll(segStore.segmentInserts(seg));
    const temp = seg.temp;
    const r = recordPublishOps(() => segStore.publishSegment(seg, dir, name));
    expect(r.out).toBe('linked');
    expect(r.ops, 'the temp\'s bytes are durable before the name exists; the name\'s entry, and the temp\'s removal, are durable before the call answers').toEqual([
      `fsync-file ${temp}`, `link ${temp} ${path.join(dir, name)}`, `unlink ${temp}`, `fsync-dir ${dir}`,
    ]);
    const db = segStore.openSegment(path.join(dir, name));
    try { expect(segStore.segmentMeta(db), 'CONTROL: and what was published reads back').toEqual(meta(1)); } finally { db.close(); }
  });

  it('F23: a publish fsyncs the export store directory (recordDirFsyncs sees it) and no other, so the published name survives a power loss', () => {
    const dir = freshDir();
    const name = nameOf(1);
    const seg = segStore.createSegment(dir, name, meta(1));
    fillAll(segStore.segmentInserts(seg));
    const r = recordDirFsyncs(() => segStore.publishSegment(seg, dir, name));
    expect(r.out).toBe('linked');
    expect(r.dirs).toEqual([dir]);
  });

  it('every insert takes exactly its columns: a missing or an unknown one throws and writes nothing; createSegment refuses a name off its meta, a bad meta and a temp that exists', () => {
    const dir = freshDir();
    const seg = segStore.createSegment(dir, nameOf(1), meta(1));
    const ins = segStore.segmentInserts(seg);
    const t = { cc_session_uuid: U1, agent_id: '', harness: 'claude-code', parent_tool_use_id: null, workflow_run_id: null, agent_type: null };
    const { parent_tool_use_id: _gone, ...missing } = t;
    expect(() => ins.transcript(missing as segStore.SegmentRows['transcript'])).toThrow(/missing column parent_tool_use_id/);
    expect(() => ins.transcript({ ...t, bogus: 1 } as segStore.SegmentRows['transcript'])).toThrow(/unknown column\(s\) bogus/);
    expect(() => ins.blob({ sha256: sha(1), codec: 'br5', raw_len: 1, z: null, pruned: 1 as unknown as boolean })).toThrow(TypeError);
    expect(ins.transcript(t), 'the counter did not move').toBe(1);
    seg.db!.close();
    expect(() => segStore.createSegment(dir, nameOf(2), meta(3))).toThrow(TypeError);
    expect(() => segStore.createSegment(dir, nameOf(4), meta(4, { writer: 'NOTHEX00' }))).toThrow(TypeError);
    fs.writeFileSync(path.join(dir, segLib.segmentTempName(nameOf(5))), '');
    expect(() => segStore.createSegment(dir, nameOf(5), meta(5))).toThrow(/EEXIST/);
  });
});
