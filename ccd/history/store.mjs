// ccd/history/store.mjs — the history store's adapter (L3, spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §6.4):
// open (writer and reader), the schema v1 DDL, the FTS5 probe, Brotli, the
// store's measured size, the creation and binding sequence, and the migration
// executor behind the pre-migration snapshot.
//
// IT EXECUTES, IT NEVER DECIDES. Every verdict this file acts on is computed by
// lib.mjs (L1) from facts this file measures, and passed in: `decideStoreOpen`
// says whether to create, open, finish a pending creation or refuse;
// `planMigration` says whether a migration may run. Nothing here reads an
// environment variable, and nothing here takes the shim's lock — the shim is
// the one lock taker (§5.1), and every writing caller runs under it.
//
// Plain node, `node:*` imports plus lib.mjs — a deploy-side module the PWA
// never bundles, imported by vitest directly (types in the hand-written
// store.d.mts beside it, the compact-card.d.mts precedent). `DatabaseSync` is
// synchronous by design (server/src/coord/db.ts's `tx` header): a transaction
// never yields, and nothing here wraps it async.
import { DatabaseSync } from 'node:sqlite';
import {
  chmodSync, closeSync, constants as FS, existsSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readdirSync, readSync, renameSync, rmdirSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants as Z, createBrotliCompress, createBrotliDecompress } from 'node:zlib';
import { BUSY_TIMEOUT_MS, CONTROL_FILE_MAX, MAX_INTERRUPTED_ATTEMPTS, RECOVER_PHASES, SCHEMA_VERSION, SIDECAR_WHOLE_MAX, UUID_RE, WRITER_RE, backupNameOf, blobOverDecodeCap, FTS_SHADOWS, formatRecoverCursor, ftsTextOf, historyPaths, journalRecord, jsonWithinStructureBound, newSha256, sidecarIndexText } from './lib.mjs';

/** The codec word every blob row records: Brotli at quality 5 (RV6). */
export const CODEC = 'br5';
/** Brotli quality for every blob (§6.2, RV6: the node default is 11). Spelled once: brotli() and compressFdRange() both read it. */
export const BR_QUALITY = 5;

/** A refusal with its word: the caller prints the word, never the message. */
export class StoreError extends Error {
  constructor(word, message) {
    super(message);
    this.name = 'StoreError';
    this.word = word;
  }
}

// ── schema v1 (§6.2, verbatim apart from the comments and three indexes) ─────
// The FTS tables are NOT here: derivation step ('fts', 1) creates them after the
// writer's FTS5 probe passes (RV2; D-4215). The
// event tables, the identity columns, merged_into, confirmed_ms and
// sidecar_seen are in v1 while the store is empty, so no first migration has
// to carry them (D-4213). So are the three referrer
// indexes §6.2 does not name — entry_variants_blob, boundaries_kept and
// sidecars_blob — which turn a blob's referrer lookups (the FTS backfill, the
// export census) from table scans into searches (D-4217).
// SCHEMA_ADDED[1] in lib.mjs lists every table and column below, in this order;
// history-store.test.ts holds the two equal.
const V1 = `
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE sessions (session_pk INTEGER PRIMARY KEY, ccrc_id TEXT NOT NULL,
  generation TEXT NOT NULL DEFAULT '', project TEXT NOT NULL, first_seen_ms INTEGER NOT NULL,
  merged_into INTEGER REFERENCES sessions,
  UNIQUE (ccrc_id, generation));
CREATE TABLE epochs (session_pk INTEGER NOT NULL REFERENCES sessions, seq INTEGER NOT NULL,
  cc_session_uuid TEXT NOT NULL, cause TEXT NOT NULL, declared_by TEXT NOT NULL,
  started_ms INTEGER, cwd TEXT, git_branch TEXT,
  cwd_real TEXT,
  confirmed_ms INTEGER,
  PRIMARY KEY (session_pk, seq), UNIQUE (session_pk, cc_session_uuid));
CREATE INDEX epochs_cwd ON epochs(cwd_real);
CREATE TABLE epoch_candidates (cc_session_uuid TEXT NOT NULL, ccrc_id TEXT NOT NULL,
  generation TEXT NOT NULL, cause TEXT NOT NULL, ts_ms INTEGER, first_seen_ms INTEGER NOT NULL,
  PRIMARY KEY (cc_session_uuid, ccrc_id));
CREATE TABLE transcripts (transcript_pk INTEGER PRIMARY KEY,
  cc_session_uuid TEXT NOT NULL,
  harness TEXT NOT NULL DEFAULT 'claude-code',
  agent_id TEXT NOT NULL DEFAULT '',
  parent_tool_use_id TEXT, workflow_run_id TEXT, agent_type TEXT,
  UNIQUE (cc_session_uuid, agent_id));
CREATE TABLE ingest_files (file_id INTEGER PRIMARY KEY, dev INTEGER NOT NULL, ino INTEGER NOT NULL,
  source_key TEXT NOT NULL DEFAULT '',
  transcript_pk INTEGER NOT NULL REFERENCES transcripts, size INTEGER, mtime_ns INTEGER,
  birth_ns INTEGER, head_sha256 BLOB,
  offset INTEGER NOT NULL DEFAULT 0, tail_sha256 BLOB, status TEXT NOT NULL,
  eof_ms INTEGER,
  retry_attempts INTEGER NOT NULL DEFAULT 0, next_attempt_ms INTEGER,
  last_error_code TEXT, last_error_offset INTEGER,
  parser_version INTEGER NOT NULL, UNIQUE (dev, ino, source_key));
CREATE TABLE file_paths (path TEXT PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES ingest_files,
  last_seen_ms INTEGER NOT NULL);
CREATE TABLE blobs (blob_id INTEGER PRIMARY KEY AUTOINCREMENT, sha256 BLOB NOT NULL UNIQUE,
  codec TEXT NOT NULL, z BLOB, raw_len INTEGER NOT NULL, fts_indexed INTEGER NOT NULL DEFAULT 0,
  pruned_ms INTEGER,
  exported_ms INTEGER, exported_seg TEXT);
CREATE INDEX blobs_unexported ON blobs(blob_id) WHERE exported_ms IS NULL;
CREATE TABLE entries (entry_id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
  transcript_pk INTEGER NOT NULL REFERENCES transcripts, type TEXT NOT NULL, subtype TEXT, role TEXT,
  model TEXT,
  parent_uuid TEXT, ts_ms INTEGER, request_id TEXT, api_block_index INTEGER, msg_id TEXT,
  source_tool_use_id TEXT, tool_name TEXT, is_compact_summary INTEGER NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL, prov_version INTEGER NOT NULL, parse_state TEXT NOT NULL DEFAULT 'ok',
  struct_rank_ns INTEGER NOT NULL, struct_file_id INTEGER NOT NULL,
  exported_ms INTEGER, exported_seg TEXT,
  blob_id INTEGER NOT NULL REFERENCES blobs ON DELETE RESTRICT);
CREATE INDEX entries_ts ON entries(transcript_pk, ts_ms);
CREATE INDEX entries_unexported ON entries(ts_ms) WHERE exported_ms IS NULL;
CREATE INDEX entries_blob ON entries(blob_id);
CREATE INDEX entries_event ON entries(request_id, api_block_index) WHERE request_id IS NOT NULL;
CREATE TABLE memberships (file_id INTEGER NOT NULL REFERENCES ingest_files,
  entry_id INTEGER NOT NULL REFERENCES entries,
  line INTEGER NOT NULL,
  PRIMARY KEY (file_id, entry_id));
CREATE INDEX memberships_order ON memberships(file_id, line);
CREATE TABLE entry_variants (entry_id INTEGER NOT NULL REFERENCES entries,
  blob_id INTEGER NOT NULL REFERENCES blobs ON DELETE RESTRICT, first_file_id INTEGER NOT NULL,
  first_seen_ms INTEGER NOT NULL, cause TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (entry_id, blob_id));
CREATE INDEX entry_variants_blob ON entry_variants(blob_id);
CREATE TABLE boundaries (entry_id INTEGER PRIMARY KEY REFERENCES entries,
  transcript_pk INTEGER NOT NULL REFERENCES transcripts,
  ord INTEGER NOT NULL,
  trigger TEXT,
  head_uuid TEXT, anchor_uuid TEXT, tail_uuid TEXT, kept_blob_id INTEGER REFERENCES blobs,
  pre_tokens INTEGER, post_tokens INTEGER, duration_ms INTEGER, UNIQUE (transcript_pk, ord));
CREATE INDEX boundaries_kept ON boundaries(kept_blob_id);
CREATE TABLE sidecars (transcript_pk INTEGER NOT NULL REFERENCES transcripts, name TEXT NOT NULL,
  blob_id INTEGER NOT NULL REFERENCES blobs ON DELETE RESTRICT, entry_id INTEGER REFERENCES entries,
  first_seen_ms INTEGER NOT NULL,
  PRIMARY KEY (transcript_pk, name, blob_id));
CREATE INDEX sidecars_blob ON sidecars(blob_id);
CREATE TABLE sidecar_seen (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL,
  blob_id INTEGER NOT NULL REFERENCES blobs);
CREATE TABLE nodes (node_id TEXT PRIMARY KEY, session_pk INTEGER NOT NULL REFERENCES sessions,
  epoch_seq INTEGER NOT NULL, transcript_pk INTEGER NOT NULL REFERENCES transcripts,
  kind TEXT NOT NULL CHECK (kind IN ('steered_leaf','native_leaf','raw_leaf','condensed')),
  depth INTEGER NOT NULL, status TEXT NOT NULL,
  gist TEXT, topics TEXT, summary_blob_id INTEGER REFERENCES blobs ON DELETE RESTRICT,
  boundary_entry_id INTEGER REFERENCES boundaries, span_start_uuid TEXT,
  earliest_ms INTEGER, latest_ms INTEGER, src_chars INTEGER, desc_count INTEGER, desc_chars INTEGER,
  directive_flag INTEGER NOT NULL DEFAULT 0, capped INTEGER NOT NULL DEFAULT 0,
  parser_version INTEGER NOT NULL, created_ms INTEGER NOT NULL);
CREATE TABLE node_sources (node_id TEXT NOT NULL REFERENCES nodes ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES entries ON DELETE RESTRICT, ord INTEGER NOT NULL,
  PRIMARY KEY (node_id, entry_id));
CREATE INDEX node_sources_entry ON node_sources(entry_id);
CREATE TABLE node_children (node_id TEXT NOT NULL REFERENCES nodes ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES nodes ON DELETE RESTRICT, ord INTEGER NOT NULL,
  PRIMARY KEY (node_id, child_id));
CREATE TABLE node_refs (node_id TEXT NOT NULL REFERENCES nodes, kind TEXT NOT NULL, value TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('model','tool_use','meta')), PRIMARY KEY (node_id, kind, value));
CREATE TABLE redact_hashes (len INTEGER NOT NULL, sha256 BLOB NOT NULL, first_seen_ms INTEGER NOT NULL,
  PRIMARY KEY (len, sha256));
CREATE TABLE spool_receipts (event_key TEXT PRIMARY KEY,
  payload_sha BLOB NOT NULL, received_ms INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL, ts_source TEXT NOT NULL);
CREATE TABLE ticks (tick_id INTEGER PRIMARY KEY, ts_ms INTEGER NOT NULL, lag_ms INTEGER,
  bytes INTEGER NOT NULL, files_behind INTEGER NOT NULL,
  bytes_behind INTEGER NOT NULL);
CREATE TABLE recall_calls (event_key TEXT PRIMARY KEY, ccrc_id TEXT NOT NULL,
  generation TEXT NOT NULL DEFAULT '', ts_ms INTEGER NOT NULL, verb TEXT NOT NULL, rc INTEGER NOT NULL,
  ms INTEGER NOT NULL, arm TEXT);
CREATE INDEX recall_calls_family ON recall_calls(ccrc_id, generation, ts_ms);
CREATE TABLE steer_receipts (event_key TEXT PRIMARY KEY, ccrc_id TEXT NOT NULL,
  cc_session_uuid TEXT NOT NULL, leaf_id TEXT NOT NULL,
  ts_ms INTEGER NOT NULL);
CREATE TABLE derivation_state (step TEXT NOT NULL, version INTEGER NOT NULL, cursor TEXT,
  completed_ms INTEGER, PRIMARY KEY (step, version));
CREATE TABLE breaker (key TEXT PRIMARY KEY, consecutive_fail INTEGER NOT NULL, open_until_ms INTEGER);
CREATE TABLE counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE journal_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT,
  rec TEXT NOT NULL);
`;

/** MIGRATIONS[v] takes a store from user_version v to v + 1. Index 0 is the
 *  whole v1 schema, run once by `createStore` and never by a migration (v1 has
 *  none). FROZEN: an entry, once shipped, is never edited — a store that ran it
 *  is past it — and every later entry is additive only (§6.11;
 *  D-4212). */
export const MIGRATIONS = Object.freeze([V1]);

// ── open ─────────────────────────────────────────────────────────────────────

/** `lstat` of the DB path as one of the four answers an open acts on. Never
 *  follows a link: only `db/` may be a symlink (§9.3), never the file in it. */
function dbFileState(dbPath) {
  let st;
  try { st = lstatSync(dbPath); } catch (e) {
    if (e && e.code === 'ENOENT') return 'absent';
    return 'unmeasured';
  }
  if (!st.isFile()) return 'unmeasured';
  return st.size === 0 ? 'zero-byte' : 'present';
}

/** The refusal an open gives for every DB-file state but `present`. A 0-byte
 *  file is refused BEFORE `new DatabaseSync`, which would adopt it as a fresh
 *  database (`server/src/coord/db.ts:130-150`, "never start empty"), so it stays
 *  0 bytes (DM16). An absent file is refused rather than created: only
 *  `createStore` makes a DB, under the sequence §6.2 names. */
function refuseUnlessPresent(dbPath) {
  const s = dbFileState(dbPath);
  if (s === 'absent') throw new StoreError('store-missing', `${dbPath} does not exist; an open never creates it`);
  if (s === 'zero-byte') throw new StoreError('store-zero-byte', `${dbPath} is 0 bytes; refusing to adopt it as an empty store`);
  if (s === 'unmeasured') throw new StoreError('store-unmeasured', `${dbPath} is not a regular file that can be read`);
}

/** The writer's connection pragmas — derived from lossless-claw src/db/connection.ts @ e05d8d3, MIT, see LICENSE.lossless-claw.
 *  Changed: journal_size_limit added; journal_mode set and ASSERTED apart
 *  (openWriter, below) rather than set blind; no allowExtension handle at all.
 *  foreign_keys is node:sqlite's default too (`enableForeignKeyConstraints`),
 *  and is said here anyway: RESTRICT lineage (DM10) must not rest on a
 *  default. busy_timeout goes first so every later statement waits on a reader
 *  rather than failing. */
const WRITER_PRAGMAS = Object.freeze([
  `PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`,
  'PRAGMA foreign_keys = ON',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA journal_size_limit = 67108864',
  'PRAGMA cache_size = -65536',
  'PRAGMA temp_store = MEMORY',
]);

const journalModeOf = (db) => String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase();

/** Open the writer's connection to an EXISTING store, or refuse with a word.
 *
 *  WAL AT EVERY OPEN (§6.2, CT3; D-4218). A restored
 *  store is a `VACUUM INTO` output, which is a rollback-journal database, so
 *  the mode is read, set when it is not WAL, and read again. A store that
 *  still is not WAL — a set that threw ("database is locked" past the busy
 *  timeout) or one SQLite declined — is `store-not-wal`: the drain's
 *  durability argument assumes WAL, so no tick writes it (O57). */
export function openWriter(dbPath) {
  refuseUnlessPresent(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    for (const p of WRITER_PRAGMAS) db.exec(p);
    if (journalModeOf(db) !== 'wal') {
      try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* re-read below decides */ }
      if (journalModeOf(db) !== 'wal') {
        throw new StoreError('store-not-wal', `${dbPath} is not in WAL mode and would not change to it`);
      }
    }
    return db;
  } catch (e) {
    try { db.close(); } catch { /* the refusal above is the signal */ }
    throw e;
  }
}

/** The read-only handle — derived from lossless-claw src/cli/database.ts @ e05d8d3, MIT, see LICENSE.lossless-claw.
 *  Changed: upstream's refusal of a missing or non-regular path is kept, from an
 *  lstat (a link at the file is refused, not followed), as three words
 *  (refuseUnlessPresent: store-missing, store-zero-byte, store-unmeasured);
 *  a failing open is not wrapped here: each caller answers it (status: exit 5
 *  store-read-failed); busy_timeout is set. `query_only` makes even a
 *  statement the readOnly flag would let through (a `temp.` create) a refusal. */
export function openReader(dbPath) {
  refuseUnlessPresent(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return db;
  } catch (e) {
    try { db.close(); } catch { /* the throw above is the signal */ }
    throw e;
  }
}

/** `PRAGMA user_version`: read first by every caller, before any table (§6.11).
 *  A version above the code's is not an open refusal: the writer's pass holds
 *  on it (planRun's `schema-newer`) and a reader still reads it, by the
 *  columns that version has (G9; D-4216). */
export function userVersion(db) {
  return Number(db.prepare('PRAGMA user_version').get().user_version);
}

/** The FTS5 probe (P0, replacing lossless-claw's temp-table create, RV1;
 *  D-4214).
 *  READ-ONLY on both handles: a `pragma_module_list` lookup answers on a
 *  `readOnly` + `query_only` handle, where a `temp.` create throws. A throw
 *  from the probe itself propagates — the caller reports it as `probe-failed`,
 *  never folded into `absent` (§9.1). */
export function probeFts5(db) {
  const row = db.prepare("SELECT 1 AS present FROM pragma_module_list WHERE name = 'fts5'").get();
  return row === undefined ? 'absent' : 'present';
}

/** Every write in a transaction: `BEGIN IMMEDIATE`, so a busy store fails at
 *  the start of a unit and never in its middle (the coord `tx` rule).
 *
 *  `sync` IS SET BEFORE `BEGIN`, because SQLite refuses to change
 *  `synchronous` inside a transaction ("Safety level may not be changed inside
 *  a transaction", M, 22.16.0): the drain, every outbox-row transaction and
 *  every verdict commit under FULL (§6.2, CT10), and the level goes back to
 *  NORMAL after, whatever happened. A ROLLBACK that itself throws never
 *  replaces the real error. */
export function withTx(db, sync, fn) {
  if (sync !== 'NORMAL' && sync !== 'FULL') throw new TypeError(`withTx: sync must be NORMAL or FULL, not ${sync}`);
  db.exec(`PRAGMA synchronous = ${sync}`);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
      throw err;
    }
  } finally {
    if (sync === 'FULL') {
      try { db.exec('PRAGMA synchronous = NORMAL'); } catch { /* the next withTx sets its own level */ }
    }
  }
}

/** Brotli at quality 5 with the input's size as the hint (RV6: the node default
 *  is 11, about twenty times slower for 10-13% less; D-4211).
 *  Recorded as `CODEC`. */
export function brotli(buf) {
  return brotliCompressSync(buf, {
    params: { [Z.BROTLI_PARAM_QUALITY]: BR_QUALITY, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
}

/** A stored blob's whole body, its output bounded by `maxLen`, the blob's own stored raw_len (final review 316 FPM10).
 *  BLOB_DECODE_MAX is checked against that column before any caller decodes, so without this bound a blob whose bytes
 *  decode past its raw_len (a corrupt or foreign z) was decompressed whole whatever its size: node:zlib stops at
 *  `maxOutputLength` and throws ERR_BUFFER_TOO_LARGE, a RangeError, which every caller already answers as a blob that
 *  does not decode. A body longer than `maxLen` throws a RangeError too (maxOutputLength cannot be 0, so an empty
 *  body's bound is checked after), and a call with no bound throws a TypeError, never an unbounded decode. */
export function unbrotli(z, maxLen) {
  if (!Number.isSafeInteger(maxLen) || maxLen < 0) throw new TypeError('history: unbrotli needs the blob\'s stored raw_len as its bound');
  const out = brotliDecompressSync(z, { maxOutputLength: Math.max(1, maxLen) });
  if (out.length > maxLen) throw new RangeError(`history: a blob decoded past its stored length ${maxLen}`);
  return out;
}

/** Output of one decompressor read, and so the most `unbrotliPrefix` can decode past its bound. */
const PREFIX_CHUNK = 16384;

/** The first `max` bytes of a Brotli blob's body, decoded by a STREAMING decompressor that is
 *  destroyed the moment it has produced them, so a multi-MiB sidecar is never decompressed whole
 *  (D-4312, history-sidecar-redact-before-cut; O20's RSS bound). `decoded` is the byte count the
 *  decompressor actually produced (at most `max` plus one output chunk), the measurable seam of
 *  that bound; `whole` says the body ended before `max`, so `bytes` is all of it. A corrupt blob
 *  rejects, as `unbrotli` throws. */
export function unbrotliPrefix(z, max) {
  return new Promise((resolve, reject) => {
    const d = createBrotliDecompress({ chunkSize: PREFIX_CHUNK });
    const parts = [];
    let held = 0;
    let decoded = 0;
    let cut = false;
    let ended = false;
    let failed = false;
    // The promise settles on 'close' — after destroy() has taken effect, or after 'end' — so
    // `decoded` is final: every chunk the decompressor emitted is counted, kept or not. Counting
    // stops only because the decompressor did (F1: a counter that stopped at the cut itself would
    // read the same with or without destroy()).
    d.on('data', (c) => {
      decoded += c.length;
      if (cut) return;
      parts.push(c);
      held += c.length;
      if (held >= max) { cut = true; d.destroy(); }
    });
    d.on('end', () => { ended = true; });
    d.on('error', (e) => { failed = true; reject(e); });
    d.on('close', () => {
      if (failed) return;
      const all = Buffer.concat(parts);
      resolve({ bytes: all.length > max ? all.subarray(0, max) : all, decoded, whole: ended && !cut });
    });
    d.end(z);
  });
}

/** The store's measured size (§9.3): `page_count × page_size` plus the `-wal`
 *  file, which can hold a large share of recent writes between checkpoints. */
export function measuredSize(db, dbPath) {
  const pages = Number(db.prepare('PRAGMA page_count').get().page_count);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size);
  let wal = 0;
  try { wal = statSync(`${dbPath}-wal`).size; } catch { /* no -wal is a size of 0 */ }
  return pages * pageSize + wal;
}

export function getMeta(db, k) {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return row === undefined ? null : String(row.v);
}

export function setMeta(db, k, v) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, String(v));
}

/** A counter, by name (§6.2 `counters`): an upsert, so the first bump creates it. */
export function bump(db, name, by = 1) {
  db.prepare('INSERT INTO counters (name, n) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET n = n + excluded.n')
    .run(name, by);
}

/** `PRAGMA optimize` on close, best effort in its own try so a busy optimize
 *  never skips the close (the lossless-claw closeDatabase shape, V6). */
export function closeWriter(db) {
  try { db.exec('PRAGMA optimize'); } catch { /* best effort */ }
  db.close();
}

/** Every ordinary table's columns in declaration order: the shape
 *  `SCHEMA_ADDED` describes and a migration must only ever grow. `sqlite_*`
 *  tables are SQLite's own, and FTS5's shadow tables appear only after
 *  derivation, so they are reported like any other table when present. */
export function schemaOf(db) {
  const out = {};
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
  for (const { name } of tables) {
    out[name] = db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(name).map((r) => String(r.name));
  }
  return out;
}

// ── the binding: facts, creation, the pending marker ────────────────────────

/** A random v4 uuid, lowercase: the NODE_ID_RE grammar (§6.2). Minted once per
 *  store, by `createStore`; it never records the box's node-id (D-4219). */
export function mintStoreId() {
  return randomUUID();
}

/** The writer token (§9.14, BK8): 8 hex digits, minted at every binding, so two
 *  boxes or two bindings of one store never name a journal file the same (D-4220). */
export function mintWriter() {
  return randomBytes(4).toString('hex');
}

/** fsync a directory, so a rename or link inside it survives a power loss. */
function fsyncDir(dir) {
  const fd = openSync(dir, FS.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** An `mkdir -p` whose every new entry survives a power loss: each directory that gained an entry is fsynced, its parents
 *  top-down (the one that existed first, then each new one but the last). Answers true when it created anything, and
 *  fsyncs nothing when the directory already existed (review 316 F23). */
export function mkdirDurable(dir, mode = 0o700) {
  const first = mkdirSync(dir, { recursive: true, mode });
  if (first === undefined) return false;
  const chain = [];
  for (let d = dir; ; d = dirname(d)) { chain.unshift(dirname(d)); if (d === first || dirname(d) === d) break; }
  for (const p of chain) fsyncDir(p);
  return true;
}

/** A type-aware removal of a name the sweep owns (D-4347 (history-planted-entries-never-wedge)): a file, link or FIFO is
 *  unlinked (a link's target is untouched), an EMPTY directory is rmdir'd, and a non-empty directory is left in place and
 *  reported, never recursed into. Never recursive, because a directory a same-user process planted may hold content the
 *  sweep did not write, and a recursive walk descends into a mount (a FUSE mount needs no root). `unlinkSync` is tried
 *  first: the O33 order recorder watches it. */
export function removeEntry(path) {
  try { unlinkSync(path); return 'removed'; } catch (e) { if (e && e.code === 'ENOENT') return 'absent'; if (!(e && (e.code === 'EISDIR' || e.code === 'EPERM'))) throw e; }
  try { rmdirSync(path); return 'removed'; } catch (e) { if (e && e.code === 'ENOENT') return 'absent'; if (e && (e.code === 'ENOTEMPTY' || e.code === 'EEXIST')) return 'kept-dir'; throw e; }
}

/** Write all of `buf` to `fd`, or throw: a short `writeSync` is finished, and one that makes no progress is an error. */
function writeAll(fd, buf) {
  for (let off = 0; off < buf.length;) {
    const n = writeSync(fd, buf, off, buf.length - off);
    if (!(n > 0)) throw new Error('writeFileAtomic: short write');
    off += n;
  }
}

/** Temp in the same directory, written WHOLE, fsynced, renamed over `path`, and the
 *  directory fsynced: the file exists whole or not at all. The temp (`<path>.tmp.<pid>`) is
 *  removed first by type and created O_EXCL|O_NOFOLLOW, so a stale temp or a link planted at its
 *  name is never written through; a short write is finished, and a failure before the rename
 *  removes the temp. `fchmod` after the open, because a umask still applies to `mode`. */
export function writeFileAtomic(path, text, mode = 0o600) {
  const tmp = `${path}.tmp.${process.pid}`;
  removeEntry(tmp);
  let renamed = false;
  try {
    const fd = openSync(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, mode);
    try { fchmodSync(fd, mode); writeAll(fd, Buffer.from(text, 'utf8')); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
    renamed = true;
  } finally {
    if (!renamed) { try { removeEntry(tmp); } catch { /* the stale sweep removes it */ } }
  }
  fsyncDir(path.slice(0, path.lastIndexOf('/')));
}

/** `writeFileAtomic`'s `<path>.tmp.<pid>` for every path it is handed: the root's three binding files and `op`,
 *  and db/backups/'s attempt markers. */
const ATOMIC_TEMP_RE = /^(store\.writer|store\.id\.pending|store\.id|op|\.pre-v[0-9]+\.attempt)\.tmp\.[0-9]+$/;

/** Remove the temps a killed `writeFileAtomic` left under another pid, from the root and db/backups/, and answer the
 *  names removed (§9.10 "Stale temp": a writer's temp is removed by the next pass that takes the lock). An absent or
 *  unlistable directory is skipped, and a temp that cannot be removed is left: a leftover blocks nothing (the D-4339
 *  reasoning), and `writeFileAtomic` removes its own pid's name itself. */
export function removeStaleAtomicTemps(home) {
  const P = historyPaths(home);
  const removed = [];
  for (const dir of [P.root, P.backups]) {
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) {
      if (!ATOMIC_TEMP_RE.test(n)) continue;
      try { if (removeEntry(`${dir}/${n}`) === 'removed') removed.push(n); } catch { /* not ours to remove */ }
    }
  }
  return removed;
}

/** The one reader of every small file the history modules read whole (D-4347 (history-planted-entries-never-wedge)):
 *  ONE open with O_RDONLY|O_NONBLOCK|O_NOCTTY (plus O_NOFOLLOW unless `follow`), with the type and the size judged on the
 *  DESCRIPTOR, so a FIFO, socket, device or directory is never waited on and no stat can be raced into one between the
 *  check and the open (the `_reg_read` lesson). At most `max` bytes are read: a larger file answers `over-cap`, and one
 *  that grows while it is read answers `unreadable`. It never folds its answers: `absent` is ENOENT, `unreadable` is every
 *  other failure (a refused link, ELOOP; EACCES; a socket, ENXIO; a non-regular descriptor), and each caller folds
 *  `over-cap` where its own rule already folds `unreadable`. `follow` is false for the writer's own files under
 *  `~/.ccrc/history`, which only `db/` may link out of (§9.3), and true for operator and registry files. O_NOCTTY: a
 *  scheduled pass is its unit's session leader with no controlling terminal, and a terminal reached through a followed
 *  link must never become one, or a hangup on it would signal the pass (fix round 1, M22). */
export function readBounded(path, max, follow) {
  let fd;
  try {
    fd = openSync(path, FS.O_RDONLY | FS.O_NONBLOCK | FS.O_NOCTTY | (follow ? 0 : FS.O_NOFOLLOW));
  } catch (e) {
    return e && e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable' };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { state: 'unreadable' };
    if (st.size > max) return { state: 'over-cap' };
    const buf = Buffer.allocUnsafe(st.size + 1);
    let n = 0;
    for (;;) {
      const r = readSync(fd, buf, n, buf.length - n, n);
      if (r === 0) break;
      n += r;
      if (n === buf.length) return { state: 'unreadable' };   // it grew while it was read
    }
    return { state: 'value', value: buf.toString('utf8', 0, n) };
  } catch {
    return { state: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

/** One binding file (`store.id`, `store.id.pending`, `store.writer`) as a
 *  Presence: absent, unreadable, or its trimmed value. A value that fails its
 *  grammar is UNREADABLE, never absent — absent means "no store was bound",
 *  which a garbled file does not say (IV5). */
function readBindingFile(path, re) {
  // D-4347 (history-planted-entries-never-wedge): one bounded nonblocking open that refuses a link (only db/ may be one,
  // §9.3), so a FIFO or a link at a binding file is store-unmeasured and never waited on.
  const r = readBounded(path, CONTROL_FILE_MAX, false);
  if (r.state === 'absent') return { state: 'absent' };
  if (r.state !== 'value') return { state: 'unreadable' };
  const v = r.value.trim();
  return re.test(v) ? { state: 'value', value: v } : { state: 'unreadable' };
}

/** The DB's own `meta.store_id`, read through a read-only handle. A DB that
 *  opens but carries no store_id row reads `absent`; a DB that will not open,
 *  or has no meta table, reads `unreadable` (store-unmeasured, never "no store";
 *  D-4219). */
export function peekStoreId(dbPath) {
  let db;
  try {
    db = openReader(dbPath);
    const row = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (row === undefined) return { state: 'absent' };
    const v = String(row.v);
    return UUID_RE.test(v) ? { state: 'value', value: v } : { state: 'unreadable' };
  } catch {
    return { state: 'unreadable' };
  } finally {
    try { db?.close(); } catch { /* read-only: nothing to lose */ }
  }
}

/** A directory's entries, or the marker that it exists and cannot be listed.
 *  ENOENT is an empty list: a store that never ran has no journal yet. */
function listOrUnlistable(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return e && e.code === 'ENOENT' ? [] : null;
  }
}

/** Every fact `decideStoreOpen` (lib.mjs) needs, measured; nothing decided.
 *
 *  ORDER MATTERS ONCE: `-wal`/`-shm` are measured BEFORE the DB is peeked,
 *  because a read-only open of a WAL database creates both sidecars and cannot
 *  remove them (M, 22.16.0), and a sidecar is evidence only when it predates
 *  this pass (store-wal-orphaned).
 *
 *  THE EVIDENCE LISTS. `journalStoreDirs` holds the uuid-named directories under
 *  `journal/`, and `backupsDb` the regular `*.db` files directly in
 *  `db/backups/`. A directory that exists but cannot be listed is reported as
 *  ONE entry, `'(unlistable)'`, so the both-absent arm refuses
 *  `store-recoverable` rather than mint a store over evidence it could not read
 *  — the conservative direction, at the cost of naming recoverability where
 *  readability is the fault. */
export function measureStoreFacts(home, role) {
  const P = historyPaths(home);
  let dbDir;
  try {
    const l = lstatSync(P.dbDir);
    if (l.isDirectory()) dbDir = 'dir';
    else if (l.isSymbolicLink()) {
      try { dbDir = statSync(P.dbDir).isDirectory() ? 'dir' : 'unmeasured'; } catch (e) {
        dbDir = e && e.code === 'ENOENT' ? 'dangling' : 'unmeasured';
      }
    } else dbDir = 'unmeasured';
  } catch (e) {
    dbDir = e && e.code === 'ENOENT' ? 'absent' : 'unmeasured';
  }

  const facts = {
    role,
    dbDir,
    storeId: readBindingFile(P.storeId, UUID_RE),
    pending: readBindingFile(P.pending, UUID_RE),
    writer: readBindingFile(P.writer, WRITER_RE),
    db: 'absent',
    dbStoreId: { state: 'absent' },
    wal: false,
    shm: false,
    journalStoreDirs: [],
    backupsDb: [],
  };

  const journal = listOrUnlistable(P.journalDir);
  facts.journalStoreDirs = journal === null
    ? ['(unlistable)']
    : journal.filter((e) => e.isDirectory() && UUID_RE.test(e.name)).map((e) => e.name).sort();

  if (dbDir === 'dir') {
    facts.wal = existsSync(P.wal);
    facts.shm = existsSync(P.shm);
    facts.db = dbFileState(P.dbFile);
    const backups = listOrUnlistable(P.backups);
    facts.backupsDb = backups === null
      ? ['(unlistable)']
      : backups.filter((e) => e.isFile() && e.name.endsWith('.db')).map((e) => e.name).sort();
    if (facts.db === 'present') facts.dbStoreId = peekStoreId(P.dbFile);
  } else if (dbDir === 'unmeasured') {
    facts.db = 'unmeasured';
  }
  return facts;
}

/** The writer's own temps (§6.2, DI13): a creation's `history.db.new.<pid>`
 *  and a restore's `.history.db.restore.<…>`, each WITH its `-wal`, `-shm` and
 *  `-journal`. SQLite pairs a WAL with its database by NAME, so a temp is never
 *  reopened: the pass that holds the lock removes every one, sidecars
 *  together, and returns the names it removed. `[]` means ONLY "no stale temp":
 *  an absent db/ (ENOENT) answers it, and any other readdir failure (EACCES,
 *  EIO, ENOTDIR) propagates, because folding "could not look" into "nothing
 *  stale" would let restore temps (each possibly a full store copy) pile up
 *  unseen. The pass fails loudly and doctor's tick freshness reports it.
 *  A name is removed BY TYPE (`removeEntry`): a file, link or FIFO is unlinked and an empty directory rmdir'd; a
 *  non-empty directory planted at the name is kept, not listed, and blocks nothing, because the names carry a pid or a
 *  timestamp a later pass never reuses (review 316 F22).
 *  D-4305 (history-stale-temps-unlistable-is-loud) */
const TEMP_RE = /^(history\.db\.new\.|\.history\.db\.restore\.)/;
export function removeStaleTemps(home) {
  const P = historyPaths(home);
  let names;
  try {
    names = readdirSync(P.dbDir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const removed = [];
  for (const n of names.sort()) {
    if (!TEMP_RE.test(n)) continue;
    if (removeEntry(`${P.dbDir}/${n}`) === 'removed') removed.push(n);   // a non-empty directory at the name is kept (review 316 F22)
  }
  return removed;
}

/** A pre-migration snapshot's copy in flight, or its leftover: `backups/.pre-v<N>.db.tmp` and its `-journal`, for ANY
 *  target N. A copy killed mid-`VACUUM INTO` leaves up to one store's size of it on db/'s filesystem. The finished
 *  `pre-v<N>.db`, the `.pre-v<N>.attempt` marker and an operator's `<ts>.db` are not temps and never match. */
const MIGRATION_TEMP_RE = /^\.pre-v[0-9]+\.db\.tmp(-journal)?$/;

/** Remove every stale pre-migration temp under backups/, whatever its target version, and answer what it freed
 *  (D-4339, history-migration-temp-precleaned). Run by the pass that holds the lock, BEFORE the room check that
 *  decides whether a migration may start, so a partial copy never counts against the very check that would let
 *  the next copy replace it: the bytes it held are returned as `bytes`, which the caller adds to the free space it
 *  measured earlier in the pass. It credits only what it MEASURED and removed, and never throws for a filesystem
 *  condition: an absent or unlistable backups/ (a mode the operator set, EIO, ESTALE) and a temp that cannot be
 *  measured or removed (a non-empty directory planted under its name; an empty one is removed, review 316 F22) answer no credit for it, so a pass with nothing to
 *  migrate still captures; `runMigration`'s own step 1 stays the guard when a migration IS admitted. Unlike
 *  removeStaleTemps (D-4305), where an unlistable db/ means the store is unusable, an unlistable backups/ blocks
 *  only a migration (D-4339 round 1, history-migration-temp-precleaned). */
export function removeStaleMigrationTemps(home) {
  const dir = historyPaths(home).backups;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { removed: [], bytes: 0 };
  }
  const removed = [];
  let bytes = 0;
  for (const n of names.sort()) {
    if (!MIGRATION_TEMP_RE.test(n)) continue;
    try {
      const st = lstatSync(`${dir}/${n}`);
      if (removeEntry(`${dir}/${n}`) !== 'removed') continue;     // a non-empty directory is kept: no credit, not listed
      if (st.isFile()) bytes += st.size;
      removed.push(n);
    } catch {
      continue;                                                   // gone, or not ours to remove: no credit for it
    }
  }
  return { removed, bytes };
}

/** First creation (§6.2), run only on `decideStoreOpen`'s `create` (or after
 *  `dropPending` on `drop-pending-create`), under the shim's lock. Since
 *  W1-B2 it is also run by `doctor --rebuild` (§8.4), which passes the
 *  journal's store_id as `opts.storeId` and a `bind` (D-4694 (history-rebuild-verb)):
 *
 *   1. root and db/ exist, 0700;
 *   2. the store_id (`opts.storeId`, else minted) and a fresh writer token.
 *      `store.writer` is written first, then `store.id.pending`. The marker is
 *      skipped when `store.id` already names the store, as a rebuild's may.
 *      Each is written temp-then-rename and fsynced (§9.14: the token is on
 *      disk before any marker names the store);
 *   3. `history.db.new.<pid>` created O_CREAT|O_EXCL 0600 — a temp whose name
 *      exists, or whose sidecars exist, is never opened;
 *   4. auto_vacuum, WAL, the v1 DDL, meta store_id and writer, user_version 1,
 *      and with `opts.bind` every DB-side fact of the binding (`bound:<ms>`,
 *      the ('recover', <ms>) step, the `bind` outbox row), all in ONE
 *      transaction; then close (the WAL is checkpointed away);
 *   5. fsync the temp, `link()` it to history.db (fails if one appeared), unlink
 *      the temp, fsync db/;
 *   6. when step 2 wrote the marker, rename `store.id.pending` to `store.id`
 *      and fsync the root.
 *
 *  A kill at any step leaves a state `decideStoreOpen` decides:
 *  - before step 5, no history.db exists. The pending marker is dropped
 *    (`drop-pending-create`, DM33). For a rebuild, its journal makes the box
 *    `store-recoverable`, and the operator runs the verb again;
 *  - between 5 and 6, the DB carries the marker's id, and the next pass
 *    finishes the rename (`finish-pending`, DM33b). A rebuild's binding and
 *    recovery step are already inside it (D-4724 (history-binding-facts-before-link)).
 *
 *  D-4219 (the store.id / meta.store_id marker: a DB beside a marker naming
 *  another store is refused, never restarted empty, §6.5) D-4220 (store.writer
 *  is written before store.id.pending). */
export function createStore(home, opts = {}) {
  const P = historyPaths(home);
  mkdirDurable(P.dbDir);
  chmodSync(P.root, 0o700);
  if (lstatSync(P.dbDir).isDirectory()) chmodSync(P.dbDir, 0o700);

  const storeId = opts.storeId ?? mintStoreId();
  const writer = mintWriter();
  const viaPending = readBindingFile(P.storeId, UUID_RE).state === 'absent';
  writeFileAtomic(P.writer, `${writer}\n`);
  if (viaPending) writeFileAtomic(P.pending, `${storeId}\n`);

  const tmp = `${P.dbDir}/history.db.new.${process.pid}`;
  for (const s of ['-wal', '-shm', '-journal']) {
    if (existsSync(`${tmp}${s}`)) throw new Error(`${tmp}${s} exists; a temp with sidecars is never opened`);
  }
  closeSync(openSync(tmp, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, 0o600));
  const db = new DatabaseSync(tmp);
  try {
    db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[0]);
      const put = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
      put.run('store_id', storeId);
      put.run('writer', writer);
      if (opts.bind !== undefined) insertBindFacts(db, { kind: opts.bind.kind, nowMs: opts.bind.nowMs, writer, recover: true });
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
      throw err;
    }
  } finally {
    db.close();
  }
  const fd = openSync(tmp, FS.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
  linkSync(tmp, P.dbFile);
  unlinkSync(tmp);
  fsyncDir(P.dbDir);
  if (viaPending) {
    renameSync(P.pending, P.storeId);
    fsyncDir(P.root);
  }
  return { storeId, writer };
}

/** `finish-pending`: this box's own interrupted creation — the DB carries the
 *  marker's id — so the rename the kill skipped is done now. The caller counts
 *  `store_creation_completed` once the store opens. */
export function finishPending(home) {
  const P = historyPaths(home);
  renameSync(P.pending, P.storeId);
  fsyncDir(P.root);
}

/** `drop-pending-create`: a marker with no DB names a creation that never
 *  linked; it is removed so the next `createStore` mints afresh. */
export function dropPending(home) {
  const P = historyPaths(home);
  removeEntry(P.pending);
  fsyncDir(P.root);
}

/** At open, `meta.writer` follows `store.writer` (§9.14, DI5; D-4220): the file is
 *  the binding fact the journal half reads with no DB open, and the meta row
 *  its mirror. An absent or garbled file changes nothing — the journal half
 *  then observes only, until a binding writes the file. */
export function syncWriterMirror(db, home) {
  const w = readBindingFile(historyPaths(home).writer, WRITER_RE);
  if (w.state !== 'value') return;
  if (getMeta(db, 'writer') !== w.value) setMeta(db, 'writer', w.value);
}

// ── migrations: the executor behind the pre-migration snapshot ──────────────

const attemptMarker = (home, n) => `${historyPaths(home).backups}/.pre-v${n}.attempt`;

/** How many attempts at migrating to version `n` were started and never
 *  finished (§6.11). Absent is 0. A marker that cannot be read, or holds
 *  anything but a count, reads as MAX_INTERRUPTED_ATTEMPTS — the escalating
 *  direction: a scheduled pass then answers `snapshot-needs-op` rather than
 *  copy again on a guess, and the operator's `--op migrate` is unbounded. */
export function readAttempts(home, n) {
  const r = readBounded(attemptMarker(home, n), CONTROL_FILE_MAX, false);
  if (r.state === 'absent') return 0;
  if (r.state !== 'value') return MAX_INTERRUPTED_ATTEMPTS;
  const v = r.value.trim();
  return /^[0-9]{1,6}$/.test(v) ? Number(v) : MAX_INTERRUPTED_ATTEMPTS;
}

/** A marker a kill left AFTER its migration committed (DI13): once the store
 *  reads `version`, every `.pre-v<N>.attempt` with N ≤ version is done with.
 *  Returns the names removed. */
export function clearDoneMarkers(home, version) {
  const dir = historyPaths(home).backups;
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const removed = [];
  for (const n of names.sort()) {
    const m = /^\.pre-v([0-9]+)\.attempt$/.exec(n);
    if (!m || Number(m[1]) > version) continue;
    if (removeEntry(`${dir}/${n}`) === 'removed') removed.push(n);
  }
  return removed;
}


/** Throws unless `next` keeps every table and column `prev` had: migrations add
 *  tables, columns and indexes, and never rename or drop (§6.11, DM44; D-4212
 *  history-cli-reads-store-version), because
 *  an older CLI reads a newer store by the columns it names. A rename is a drop
 *  plus an add, so it is caught as the drop. */
export function assertAdditive(prev, next) {
  const lost = [];
  for (const [table, cols] of Object.entries(prev)) {
    const now = next[table];
    if (now === undefined) { lost.push(table); continue; }
    for (const c of cols) if (!now.includes(c)) lost.push(`${table}.${c}`);
  }
  if (lost.length > 0) {
    throw new StoreError('migration-not-additive', `a migration may only add; it removed ${lost.join(', ')}`);
  }
}

/** Run migrations `from`..`to`-1 behind a snapshot of the store as it was
 *  (§6.11, ruled Q6; D-4182 history-pre-migration-snapshot). The verdict is a PARAMETER: this function has no path
 *  that migrates without `snapshot-then-migrate` in hand (DM42), and lib.mjs's
 *  `planMigration` is the only thing that answers it. With N = `to`:
 *
 *   1. remove a stale `backups/.pre-v<N>.db.tmp` and its `-journal` (the
 *      `deploy/backup-coord.mjs` pre-clean), then write the attempt marker
 *      `backups/.pre-v<N>.attempt` holding the attempt count, temp-then-rename;
 *   2. `VACUUM INTO` the `.tmp`, its name a bound parameter, then 0600 (SQLite
 *      creates it 0644 under the default umask);
 *   3. fsync it, rename it to `backups/pre-v<N>.db`, fsync backups/;
 *   4. remove every older `pre-v*.db` — only the newest pre-migration snapshot
 *      is kept, and the operator's `<ts>.db` files are never touched;
 *   5. the migrations in ONE `BEGIN IMMEDIATE` (FULL), which checks they were
 *      additive, records `copy_bps` (the copy's measured rate, which the next
 *      `planMigration` reads) and ends by raising user_version; then the marker
 *      goes.
 *
 *  A kill in 1-3 leaves only the `.tmp` and the marker, user_version unchanged;
 *  the next pass removes the `.tmp` first (`removeStaleMigrationTemps`, from the
 *  verdict, before the room check: D-4339; step 1 stays as the executor's own
 *  guard), and the marker's count escalates a
 *  scheduled pass to `snapshot-needs-op` after two. A finished `pre-v<N>.db` from
 *  an interrupted attempt is never reused: step 2 always copies afresh. */
export function runMigration(db, home, i) {
  if (i.verdict !== 'snapshot-then-migrate') {
    throw new StoreError('migration-not-admitted', `runMigration was handed '${i.verdict}'; only snapshot-then-migrate migrates`);
  }
  const P = historyPaths(home);
  const n = i.to;
  mkdirDurable(P.backups);
  const tmp = `${P.backups}/.pre-v${n}.db.tmp`;
  const snapshot = `${P.backups}/pre-v${n}.db`;
  removeEntry(tmp);
  removeEntry(`${tmp}-journal`);
  writeFileAtomic(attemptMarker(home, n), `${readAttempts(home, n) + 1}\n`);

  const t0 = process.hrtime.bigint();
  db.prepare('VACUUM INTO ?').run(tmp);
  chmodSync(tmp, 0o600);
  const fd = openSync(tmp, FS.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const size = statSync(tmp).size;
  renameSync(tmp, snapshot);
  fsyncDir(P.backups);
  for (const name of readdirSync(P.backups)) {
    const m = /^pre-v([0-9]+)\.db$/.exec(name);
    if (m && Number(m[1]) < n) removeEntry(`${P.backups}/${name}`);
  }

  const copyBps = Math.max(1, Math.round(size / Math.max(seconds, 0.001)));
  withTx(db, 'FULL', () => {
    const before = schemaOf(db);
    for (let v = i.from; v < i.to; v += 1) db.exec(i.migrations[v]);
    assertAdditive(before, schemaOf(db));
    setMeta(db, 'copy_bps', copyBps);
    db.exec(`PRAGMA user_version = ${i.to}`);
  });
  removeEntry(attemptMarker(home, n));
  return { snapshot, copyBps };
}

/** One read when streaming a range: big enough to keep the compressor busy, small enough that
 *  the stream never holds more than a few of them. */
const RANGE_PIECE = 1 << 20;

/** A byte range of an open file, sha256-hashed and Brotli-compressed (BR_QUALITY, codec `br5`) in
 *  one streaming pass, so a line longer than LINE_MAX, or a sidecar over SIDECAR_WHOLE_MAX, is
 *  captured without ever being held whole (§9.2 step 4: "streamed through createBrotliCompress and
 *  a streaming sha256 rather than refused"). Returns null when the file ends before `end`, because
 *  it shrank under the read: the caller holds its cursor and tries again next tick. */
export async function compressFdRange(fd, start, end) {
  const hash = newSha256();
  const enc = createBrotliCompress({
    params: { [Z.BROTLI_PARAM_QUALITY]: BR_QUALITY, [Z.BROTLI_PARAM_SIZE_HINT]: end - start },
  });
  const out = [];
  enc.on('data', (c) => { out.push(c); });
  const finished = new Promise((resolve, reject) => { enc.once('end', resolve); enc.once('error', reject); });
  for (let pos = start; pos < end;) {
    const piece = Buffer.allocUnsafe(Math.min(RANGE_PIECE, end - pos));
    const n = readSync(fd, piece, 0, piece.length, pos);
    if (n === 0) { enc.destroy(); return null; }
    const chunk = n === piece.length ? piece : piece.subarray(0, n);
    hash.update(chunk);
    if (!enc.write(chunk)) await new Promise((resolve) => { enc.once('drain', resolve); });
    pos += n;
  }
  enc.end();
  await finished;
  return { sha: hash.digest(), z: Buffer.concat(out), rawLen: end - start };
}

/** The two FTS5 tables. They are NOT in schema v1 (RV2; history-fts-tables-by-derivation):
 *  derivation step ('fts', 1) runs these only after the writer's read-only probe answered present.
 *  blobs_fts is contentless, with rowid = blob_id and contentless_delete, so a late redaction pair
 *  can delete one row. */
export const FTS_DDL = Object.freeze([
  "CREATE VIRTUAL TABLE IF NOT EXISTS blobs_fts USING fts5(body, content='', contentless_delete=1, tokenize='porter unicode61')",
  "CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(gist, topics, refs, tokenize='porter unicode61')",
]);

/** Run FTS_DDL; the caller holds the transaction. */
export function createFtsTables(db) {
  for (const sql of FTS_DDL) db.exec(sql);
}


// ── W1-B2 Task 8: derivation_state steps by name (§6.2 `derivation_state`) ─────────────────────────────────────

/** One derivation step's row: its cursor (TEXT, as the step wrote it) and when it completed; null when the step
 *  has no row. */
export function getStep(db, step, version) {
  const r = db.prepare('SELECT cursor, completed_ms FROM derivation_state WHERE step = ? AND version = ?').get(step, version);
  if (r === undefined) return null;
  return { cursor: r.cursor === null ? null : String(r.cursor), completedMs: r.completed_ms === null ? null : Number(r.completed_ms) };
}

/** Upsert one derivation step's row; the caller holds the transaction. An omitted `completedMs` leaves an
 *  existing completed_ms as it is (a new row gets NULL); a number or null sets it. */
export function setStep(db, step, version, cursor, completedMs) {
  if (completedMs === undefined) {
    db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, ?, ?, NULL)
      ON CONFLICT (step, version) DO UPDATE SET cursor = excluded.cursor`).run(step, version, cursor);
    return;
  }
  db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT (step, version) DO UPDATE SET cursor = excluded.cursor, completed_ms = excluded.completed_ms`)
    .run(step, version, cursor, completedMs);
}

// ── Lineage: the range CTE and the two edge lookups (spec §6.3; W1-B2 Task 9) ────────────────────────────
// The edge names are directional (§6.3):
//   - node_sources is leaf → its entries, ordered;
//   - node_children is parent → the nodes it condenses, ordered.
// The lineage walks DOWN, from a node to what it condenses and then to those nodes' source entries. The
// upstream subtree CTE walks toward a summary's CONSUMERS with UNION ALL (summary-store.ts:780-822); it is not
// ported (§11, refuted candidate 4). UNION, not UNION ALL, so a cycle in node_children ends the walk.
// derived from lossless-claw src/store/summary-store.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
// From getSummaryMessageSeqRange, upstream lines 595-621. SQLite keeps a CROSS JOIN's order, so this visits
// the lineage before it looks up any link. A reordered join could scan every family's links once per node.
const LINEAGE_SQL = `WITH RECURSIVE source_nodes(node_id) AS (
  SELECT ?
  UNION
  SELECT nc.child_id
  FROM node_children nc
  JOIN source_nodes s ON s.node_id = nc.node_id
)
SELECT ns.node_id AS node_id, ns.entry_id AS entry_id, ns.ord AS ord, e.ts_ms AS ts_ms
FROM source_nodes s
CROSS JOIN node_sources ns ON ns.node_id = s.node_id
CROSS JOIN entries e ON e.entry_id = ns.entry_id
ORDER BY ns.node_id, ns.ord`;

/** Every source entry under `nodeId`: a leaf's own, or every leaf's below a parent. Rows come grouped by leaf id
 *  and in each leaf's `ord`. Ordering the leaves themselves (by `boundaries.ord`) is the caller's job. */
export function lineageEntries(db, nodeId) {
  return db.prepare(LINEAGE_SQL).all(nodeId).map((r) => ({
    nodeId: r.node_id, entryId: Number(r.entry_id), ord: Number(r.ord), tsMs: r.ts_ms === null ? null : Number(r.ts_ms),
  }));
}

/** What `nodeId` condenses, in order (empty for a leaf). */
export function childrenOf(db, nodeId) {
  return db.prepare('SELECT child_id, ord FROM node_children WHERE node_id = ? ORDER BY ord').all(nodeId)
    .map((r) => ({ childId: r.child_id, ord: Number(r.ord) }));
}

/** The node that condenses `nodeId`, or null. Fan-in gives a node one parent; ORDER BY keeps the answer
 *  deterministic over a hand-damaged table. */
export function parentOf(db, nodeId) {
  const r = db.prepare('SELECT node_id FROM node_children WHERE child_id = ? ORDER BY node_id LIMIT 1').get(nodeId);
  return r === undefined ? null : r.node_id;
}

/** A stored blob's plain text for synchronous read verbs. Sidecars use the same redacted index text as FTS; bodies
 * remain plain for the caller's bounded display window. Malformed, oversized, or undecodable data stays absent. */
export function blobPlainText(z, isSidecar, idx, rawLen) {
  try {
    if (isSidecar) return rawLen <= SIDECAR_WHOLE_MAX ? sidecarIndexText(unbrotli(z, rawLen), idx) : '';
    if (blobOverDecodeCap(rawLen)) return '';
    const bytes = unbrotli(z, rawLen);
    if (!jsonWithinStructureBound(bytes)) return '';
    return ftsTextOf(JSON.parse(bytes.toString('utf8')), 'entry');
  } catch {
    return '';
  }
}

// ── W1-B2 Task 19: a registered recovery step and the stored version, measured read-only (RB6, RB13) ──────────
/** An open ('recover', <bind ms>) step: what restore and rebuild register (§9.14), and what refuses every writing
 *  --op form lib's recoveryExempt does not exempt meanwhile (RB6 with RB12-RB14, slug
 *  history-ops-refused-while-recovering; lib's decideOpGate decides). */
const RECOVER_OPEN_SQL = "SELECT 1 AS x FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL LIMIT 1";

/** Whether db/history.db holds an open recovery step, on its OWN read-only handle, closed before it returns, so it
 *  can run before any writer opens the store. Four answers, kept apart: 'absent' (no file), 'unmeasured' (the
 *  file would not open read-only, or has no derivation_state), 'none' and 'open'. A caller refuses on 'open' only
 *  and leaves every other answer to the store's own refusal words further on (openStore, decideBind). */
export function recoverStepAt(dbFile) {
  if (dbFileState(dbFile) === 'absent') return 'absent';
  let db;
  try { db = openReader(dbFile); } catch { return 'unmeasured'; }
  try {
    return db.prepare(RECOVER_OPEN_SQL).get() === undefined ? 'none' : 'open';
  } catch {
    return 'unmeasured';
  } finally {
    db.close();
  }
}

/** history.db's own user_version, on its OWN read-only handle, closed before it returns: the stored-version fact
 *  decideOpGate's RB13 exemption reads while a recovery step is open (both halves), and the one decideBind's adopt
 *  arm decides a newer store by (RB17, through sweep.mjs's bindFactsOf). A Presence, never a bare number: 'absent'
 *  (no file) and 'unreadable' (the file would not open read-only, or the pragma would not read) stay apart from a
 *  value, so an unmeasured version is never read as one (IV5). B1's peekVersion stays openStore's throwing peek. */
export function storedVersionAt(dbFile) {
  if (dbFileState(dbFile) === 'absent') return { state: 'absent' };
  let db;
  try { db = openReader(dbFile); } catch { return { state: 'unreadable' }; }
  try {
    const v = userVersion(db);
    return Number.isSafeInteger(v) && v >= 0 ? { state: 'value', value: v } : { state: 'unreadable' };
  } catch {
    return { state: 'unreadable' };
  } finally {
    db.close();
  }
}

// ── prune: tombstones by referrer age (§6.6; W1-B2 Task 20) ──────────────────────────────────────

/** The blob ids that are structure, never content (§6.6): every native summary a node names
 *  (nodes.summary_blob_id), every kept list (boundaries.kept_blob_id) and, D-4590
 *  (history-prune-protects-compact-summaries), every compact-summary entry's own blob: that blob is structure from
 *  its capture, before any leaf names it, because node derivation can lag behind (a cap or floor pause, an
 *  unconfirmed epoch, a pending receipt). Read once per pass: nodes has no index on summary_blob_id, so a probe per
 *  candidate would scan it once per blob. */
export function pruneProtected(db) {
  const ids = new Set();
  for (const r of db.prepare('SELECT summary_blob_id AS id FROM nodes WHERE summary_blob_id IS NOT NULL').all()) ids.add(Number(r.id));
  for (const r of db.prepare('SELECT kept_blob_id AS id FROM boundaries WHERE kept_blob_id IS NOT NULL').all()) ids.add(Number(r.id));
  for (const r of db.prepare('SELECT blob_id AS id FROM entries WHERE is_compact_summary = 1 AND blob_id IS NOT NULL').all()) ids.add(Number(r.id));
  return ids;
}

const PRUNE_STMTS = new WeakMap();
/** The candidate page, prepared once per connection (a reader's too: it writes nothing). One row per blob past
 *  the cursor that still holds text, has at least one content referrer
 *  (history-prune-needs-a-referrer), and has no referrer at or after the cutoff: a referrer with no time is
 *  never old, a variant ages by its entry, a sidecar ages by its entry, and a sidecar no entry names is
 *  never old. Each clause is ONE line: the mutation steps edit them line by line. The referrer probes are
 *  index searches (entries_blob, entry_variants_blob, sidecars_blob). */
function pruneStmts(db) {
  let s = PRUNE_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    candidates: db.prepare(`SELECT b.blob_id AS blob_id, length(b.z) AS zlen, b.exported_ms IS NOT NULL AS exported
      FROM blobs b
      WHERE b.blob_id > ? AND b.z IS NOT NULL
        AND (EXISTS (SELECT 1 FROM entries e WHERE e.blob_id = b.blob_id) OR EXISTS (SELECT 1 FROM entry_variants v WHERE v.blob_id = b.blob_id) OR EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = b.blob_id))
        AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.blob_id = b.blob_id AND (e.ts_ms IS NULL OR e.ts_ms >= ?))
        AND NOT EXISTS (SELECT 1 FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id WHERE v.blob_id = b.blob_id AND (e.ts_ms IS NULL OR e.ts_ms >= ?))
        AND NOT EXISTS (SELECT 1 FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id WHERE s.blob_id = b.blob_id AND (e.entry_id IS NULL OR e.ts_ms IS NULL OR e.ts_ms >= ?))
      ORDER BY b.blob_id LIMIT ?`),
  };
  PRUNE_STMTS.set(db, s);
  return s;
}

/** One page of prune candidates past `afterBlobId` (§6.6): `limit` rows read, the protected ones dropped.
 *  `more` says the page was full, so the caller reads the next one from `lastBlobId`; `exported` counts the
 *  candidates the sole-copy export already holds (exported_ms, set from W1-B4). */
export function pruneCandidates(db, i) {
  const rows = pruneStmts(db).candidates.all(i.afterBlobId, i.cutoffMs, i.cutoffMs, i.cutoffMs, i.limit);
  const blobIds = [];
  let bytes = 0;
  let exported = 0;
  for (const r of rows) {
    const id = Number(r.blob_id);
    if (i.protectedIds.has(id)) continue;
    blobIds.push(id);
    bytes += Number(r.zlen);
    if (Number(r.exported) === 1) exported += 1;
  }
  const lastBlobId = rows.length > 0 ? Number(rows[rows.length - 1].blob_id) : i.afterBlobId;
  return { blobIds, bytes, exported, lastBlobId, more: rows.length === i.limit };
}

/** One batch in its own BEGIN IMMEDIATE transaction (§6.6): each blob's z set NULL, pruned_ms stamped and
 *  fts_indexed cleared — a tombstone; the blob row and every row naming it stay — and its blobs_fts row
 *  deleted when the index exists. Deleting a rowid the contentless index never held is a no-op (measured,
 *  24.14.1). When it deleted index rows it calls `onDeleted` INSIDE the same transaction, so the caller's merge
 *  step commits with the deletes it exists to purge (§6.2) and no stop between batches can separate them.
 *  Answers how many blobs this batch tombstoned. */
export function pruneBatch(db, i) {
  const tombstone = db.prepare('UPDATE blobs SET z = NULL, pruned_ms = ?, fts_indexed = 0 WHERE blob_id = ? AND z IS NOT NULL');
  const del = i.fts ? db.prepare('DELETE FROM blobs_fts WHERE rowid = ?') : null;
  let n = 0;
  withTx(db, 'NORMAL', () => {
    for (const id of i.blobIds) {
      if (Number(tombstone.run(i.nowMs, id).changes) !== 1) continue;
      n += 1;
      if (del !== null) del.run(id);
    }
    if (del !== null && n > 0 && i.onDeleted !== undefined) i.onDeleted();
  });
  return n;
}

/** What `prune` without --apply reports (§6.6): how many blobs, and their compressed bytes, --apply would
 *  tombstone at this cutoff, and how many of those the export already holds. It runs on a reader. */
export function pruneDryRun(db, cutoffMs) {
  const protectedIds = pruneProtected(db);
  let after = 0;
  let blobs = 0;
  let bytes = 0;
  let exported = 0;
  for (;;) {
    const c = pruneCandidates(db, { cutoffMs, afterBlobId: after, limit: 500, protectedIds });
    blobs += c.blobIds.length;
    bytes += c.bytes;
    exported += c.exported;
    after = c.lastBlobId;
    if (!c.more) return { blobs, bytes, exported };
  }
}

/** §6.6's PRAGMA incremental_vacuum(N): returns at most `pages` free pages to the filesystem (the store is
 *  auto_vacuum=INCREMENTAL from creation, §6.2). A full VACUUM is never run: it needs about the store's size
 *  free, which the floor (§9.3) forbids. Answers the pages it freed. */
export function incrementalVacuum(db, pages) {
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new TypeError(`incrementalVacuum: pages must be a positive integer, not ${String(pages)}`);
  }
  const free = Number(db.prepare('PRAGMA freelist_count').get().freelist_count);
  const n = Math.min(free, pages);
  if (n > 0) db.exec(`PRAGMA incremental_vacuum(${n})`);
  return n;
}

/** `prune --apply`'s loop (§6.6): pages of candidates from a blob-id cursor; each non-empty page tombstoned
 *  in one batch (with `onDeleted`, the caller's merge-step registration, inside it), the freed pages vacuumed,
 *  the WAL checkpointed and truncated (RB3: the batch's frames never accumulate across a long pass on the very
 *  store that has no room for them; a reader on an older snapshot makes the checkpoint answer busy, which is not
 *  an error and is retried after the next batch), then `between()` — the caller's journal half, which may throw
 *  to end the pass. It stops when a page comes back short. Answers what it tombstoned and whether the FTS table
 *  exists.
 *  derived from lossless-claw src/prune.ts @ e05d8d3, MIT, see LICENSE.lossless-claw */
export function pruneApply(db, i) {
  const protectedIds = pruneProtected(db);
  const fts = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'blobs_fts'").get() !== undefined;
  let after = 0;
  let blobs = 0;
  let bytes = 0;
  for (;;) {
    const c = pruneCandidates(db, { cutoffMs: i.cutoffMs, afterBlobId: after, limit: i.batch, protectedIds });
    if (c.blobIds.length > 0) {
      blobs += pruneBatch(db, { blobIds: c.blobIds, nowMs: i.nowMs, fts, onDeleted: i.onDeleted });
      bytes += c.bytes;
      incrementalVacuum(db, i.vacuumPages);
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      i.between();
    }
    after = c.lastBlobId;
    if (!c.more) return { blobs, bytes, fts };
  }
}

// ── doctor --backup's copy (§8.4; W1-B2 Task 22) ─────────────────────────────────────────────────

/** A backup's temp (§8.4 "temp then rename"): `.<ts>.db.tmp` in backups/, with the rollback journal SQLite may
 *  leave beside it. Only a pass holding the lock writes one, so every match a pass finds is stale. The
 *  pre-migration snapshot's `.pre-v<N>.db.tmp` is runMigration's and never matches. */
const BACKUP_TMP_RE = /^\.[0-9]{8}T[0-9]{6}Z\.db\.tmp(-journal)?$/;

/** Remove every stale backup temp under backups/ (`BACKUP_TMP_RE`, through `removeEntry`); nothing when backups/ is
 *  absent. `doctor --backup` calls it BEFORE its room probe, so the free space that probe measures already includes
 *  the bytes a killed copy left; otherwise a store too full for a copy stays refused by the very temp a crashed
 *  copy left (D-4588, history-backup-stale-temp-before-room-probe; spec §9.3 planCopy, §6.6). */
export function removeStaleBackupTemps(home) {
  const P = historyPaths(home);
  if (!existsSync(P.backups)) return;
  for (const n of readdirSync(P.backups)) if (BACKUP_TMP_RE.test(n)) removeEntry(`${P.backups}/${n}`);
}

/** `doctor --backup`'s copy (§8.4; ruled Q6). VACUUM INTO `backups/.<ts>.db.tmp` — the target is a bound
 *  parameter and never a caller's path — then fsync, link() it to `backups/<ts>.db`, unlink the temp and fsync
 *  the directory. A kill leaves only the temp, which the next backup removes first (C51), so a partial copy
 *  never carries a backup's name. link() refuses a name that exists, where rename() would replace it: a second
 *  backup in the same second, or an operator file of that name, is StoreError('backup-exists')
 *  (D-4721, history-backup-link-not-rename). The copy's mode is the process umask's — 0600 from its first byte under
 *  the shim's and runPass's umask 077 (C35); the fchmod is a belt for a caller with another umask. Every copy
 *  stores its measured rate in meta.copy_bps, which planMigration reads (§8.4), at whatever version the store is:
 *  the rate is the disk's, not the schema's. */
export function writeBackup(db, home, i) {
  const P = historyPaths(home);
  // B1's mkdirDurable, as B1's runMigration creates this same directory: the first backup on a box with no backups/
  // fsyncs db/, so a power loss cannot lose backups/ and the copy inside it (review 316 F23).
  mkdirDurable(P.backups);
  for (const n of readdirSync(P.backups)) if (BACKUP_TMP_RE.test(n)) removeEntry(`${P.backups}/${n}`);
  const name = backupNameOf(i.nowMs);
  const finalPath = `${P.backups}/${name}`;
  if (existsSync(finalPath)) throw new StoreError('backup-exists', `${name} already exists`);
  const tmpPath = `${P.backups}/.${name}.tmp`;
  const t0 = process.hrtime.bigint();
  db.prepare('VACUUM INTO ?').run(tmpPath);
  const fd = openSync(tmpPath, FS.O_RDONLY);
  try {
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const sizeBytes = statSync(tmpPath).size;
  try {
    linkSync(tmpPath, finalPath);
  } catch (e) {
    removeEntry(tmpPath);
    if (e && e.code === 'EEXIST') throw new StoreError('backup-exists', `${name} appeared while it was written`);
    throw e;
  }
  unlinkSync(tmpPath);
  fsyncDir(P.backups);
  const copyBps = Math.max(1, Math.round(sizeBytes / Math.max(seconds, 0.001)));
  withTx(db, 'NORMAL', () => { setMeta(db, 'copy_bps', copyBps); });
  return { name, sizeBytes, copyBps };
}

// ── doctor --repair's measurements (§8.4; W1-B2 Task 23) ─────────────────────────────────────────

/** PRAGMA integrity_check's rows as text: exactly ['ok'] for a sound store. */
export function integrityCheck(db) {
  return db.prepare('PRAGMA integrity_check').all().map((r) => String(r.integrity_check));
}

/** PRAGMA foreign_key_check's rows, the input of lib's diffForeignKeys (P21): one per child row whose parent is
 *  missing. The writer runs with foreign keys ON (WRITER_PRAGMAS), so a violation here was written with them off
 *  or deferred — a store restored from elsewhere, a hand edit, or a bug. No v1 table is WITHOUT ROWID, so a v1
 *  table's `rowid` is never null. */
export function foreignKeyRows(db) {
  return db.prepare('PRAGMA foreign_key_check').all().map((r) => ({
    table: r.table ?? null,
    rowid: r.rowid === null || r.rowid === undefined ? null : Number(r.rowid),
    parent: r.parent ?? null,
    fkid: r.fkid === null || r.fkid === undefined ? null : Number(r.fkid),
  }));
}

/** What lib's ftsTablesHealthy reads (P24): every FTS table and shadow table present, and each FTS table's
 *  columns. */
export function ftsMeasure(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .map((r) => String(r.name)).filter((n) => n.startsWith('blobs_fts') || n.startsWith('nodes_fts')));
  const columns = {};
  for (const t of ['blobs_fts', 'nodes_fts']) {
    if (tables.has(t)) columns[t] = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => String(r.name));
  }
  return { tables, columns };
}

/** Drop both FTS tables, then any shadow a missing main table left behind — P24's sequence, the table and then
 *  each shadow if it exists. A live table's shadows go with it, and node:sqlite's defensive mode refuses to
 *  drop one by name, so only an orphaned shadow is ever dropped here. The caller holds the transaction and
 *  recreates the tables with createFtsTables.
 *  derived from lossless-claw src/db/migration.ts @ e05d8d3, MIT, see LICENSE.lossless-claw */
export function dropFtsTables(db) {
  db.exec('DROP TABLE IF EXISTS blobs_fts');
  db.exec('DROP TABLE IF EXISTS nodes_fts');
  for (const names of Object.values(FTS_SHADOWS)) for (const n of names) db.exec(`DROP TABLE IF EXISTS "${n}"`);
}

/** A counter set to `n` by a re-measure, inside the caller's transaction (W1-B2 Task 23; D-4723 (history-counter-resets-after-cure)):
 *  0 deletes its row, which every reader reads as 0 (sweep.mjs's counterOf, status's counters). */
export function setCounter(db, name, n) {
  if (n === 0) db.prepare('DELETE FROM counters WHERE name = ?').run(name);
  else db.prepare('INSERT INTO counters (name, n) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET n = excluded.n').run(name, n);
}

// ── The binding verbs' sequences: adopt, restore, rebuild (spec §8.4, §6.2, §9.14; W1-B2) ───────────────────
// lib's decideBind decides each verb's preconditions from measureStoreFacts' facts (L1). These functions only
// execute the sequence §8.4 names, in its order (L3).
//
// The rule all three share (rev 3.2 review, DI3; D-4724 (history-binding-facts-before-link)): every DB-side fact of a
// binding is committed INSIDE the database before any binding file names it. The facts are:
//   - `bound:<ms>` = the verb, so a later merger can see that the store moved;
//   - a new writer token as meta.writer, the mirror of store.writer (D-4226,
//     D-4220);
//   - for a restore or a rebuild, the ('recover', <ms>) derivation step the following ticks run (§9.14);
//   - the `bind` verdict in journal_outbox, which the first pass to open the store flushes into
//     journal/<store_id>/ under the new token.
// So a kill leaves one of two states (D-4184):
//   - an unbound store, which a second run binds;
//   - a store whose binding and recovery are already inside it, which the pending-marker path finishes (§6.2).
// It never leaves a bound store under a departed box's token, and never a restore whose replay is skipped.

/** The size of one read and one write while a restore copies its backup. */
const RESTORE_PIECE = 1 << 20;
/** A journal-known redact pair into the staged copy (spec §8.4 and §9.14): the same row the
 *  recovery step's index phase inserts, so that phase finds it present. */
const RESTORE_PAIR_INSERT = 'INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?) ON CONFLICT (len, sha256) DO NOTHING';
const PAIR_SHA_RE = /^[0-9a-f]{64}$/;

/** Every DB-side fact of one binding, inside the CALLER's transaction. A second call for the same verb and
 *  millisecond rewrites meta.writer and adds its `bind` row; the `bound:<ms>` row and the recover row stay single. */
function insertBindFacts(db, b) {
  setMeta(db, `bound:${b.nowMs}`, b.kind);
  setMeta(db, 'writer', b.writer);
  if (b.recover) {
    db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL) ON CONFLICT (step, version) DO NOTHING")
      .run(b.nowMs);
  }
  db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)')
    .run(journalRecord('verdict', b.nowMs, { event_key: 'none', kind: 'bind', bind: b.kind, writer: b.writer }));
}

/** `doctor --adopt` (§8.4; D-4692 (history-adopt-verb)), once decideBind admitted it: the present DB's own
 *  meta.store_id becomes this box's store. In order:
 *  1. the bind commits FULL: `bound:<ms>` = adopt, the new token, the `bind` row. No recovery step: the store is
 *     whole, it only moved (RC16);
 *  2. store.writer;
 *  3. store.id.
 *  A kill between 1 and 3 leaves the store unbound, and a second adopt binds it. Never a bound store under the
 *  departed box's token. */
export function adoptStore(home, { nowMs }) {
  const P = historyPaths(home);
  const writer = mintWriter();
  const db = openWriter(P.dbFile);
  try {
    const storeId = getMeta(db, 'store_id');
    if (storeId === null || !UUID_RE.test(storeId)) {
      throw new StoreError('adopt-refused', `${P.dbFile} carries no readable meta.store_id`);
    }
    withTx(db, 'FULL', () => { insertBindFacts(db, { kind: 'adopt', nowMs, writer, recover: false }); });
    writeFileAtomic(P.writer, `${writer}\n`);
    writeFileAtomic(P.storeId, `${storeId}\n`);
    return { storeId, writer };
  } finally {
    closeWriter(db);
  }
}

/** What a staged restore copy says about itself, measured on the COPY, never on the backup: its user_version, its
 *  meta.store_id (a value, absent, or unreadable for a file that is no store) and whether PRAGMA integrity_check
 *  answers exactly one row, `ok`. A file that will not open as a database reads as unreadable and not ok. */
function measureStaged(tempPath) {
  const out = { storeId: { state: 'unreadable' }, userVersion: null, integrityOk: false };
  let db;
  try {
    db = openReader(tempPath);
    out.userVersion = userVersion(db);
    const row = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (row === undefined) out.storeId = { state: 'absent' };
    else if (UUID_RE.test(String(row.v))) out.storeId = { state: 'value', value: String(row.v) };
    const rows = db.prepare('PRAGMA integrity_check').all();
    out.integrityOk = rows.length === 1 && String(Object.values(rows[0])[0]) === 'ok';
  } catch {
    // A file that is no database, or whose meta cannot be read: what was measured stands, the rest stays unread.
  } finally {
    try { db?.close(); } catch { /* read-only: nothing to lose */ }
  }
  return out;
}

/** `doctor --restore <name>`, first half (§8.4; D-4693 (history-restore-verb)). Copy db/backups/<name> to
 *  db/.history.db.restore.<pid>:
 *  - the backup is opened O_NOFOLLOW|O_NONBLOCK and must be a regular file;
 *  - the temp is created O_EXCL and fchmodded 0600, so it is 0600 from its first byte under any umask;
 *  - the copy is fsynced, then measured (measureStaged) for decideBind's second look.
 *  A bare name only: anything with a `/` is refused here as in lib's restoreNameOk. The caller removes the temp on
 *  any refusal (abortRestore), and the next lock-holding pass's removeStaleTemps catches a kill. */
export function stageRestore(home, name) {
  const P = historyPaths(home);
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || name.includes('/')) {
    throw new StoreError('restore-refused', `${JSON.stringify(name)} is not a bare file name under db/backups`);
  }
  const src = `${P.backups}/${name}`;
  const tempPath = `${P.dbDir}/.history.db.restore.${process.pid}`;
  for (const s of ['', '-wal', '-shm', '-journal']) {
    if (existsSync(`${tempPath}${s}`)) throw new Error(`${tempPath}${s} exists; a temp is never reopened`);
  }
  let from;
  try {
    from = openSync(src, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
  } catch (e) {
    throw new StoreError('restore-refused', `${src} cannot be opened as a regular file without following a link (${e && e.code ? e.code : 'error'})`);
  }
  let sizeBytes = 0;
  try {
    if (!fstatSync(from).isFile()) throw new StoreError('restore-refused', `${src} is not a regular file`);
    const to = openSync(tempPath, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY, 0o600);
    try {
      fchmodSync(to, 0o600);
      const buf = Buffer.allocUnsafe(RESTORE_PIECE);
      for (;;) {
        const n = readSync(from, buf, 0, buf.length, null);
        if (n === 0) break;
        writeAll(to, buf.subarray(0, n));
        sizeBytes += n;
      }
      fsyncSync(to);
    } finally {
      closeSync(to);
    }
  } finally {
    closeSync(from);
  }
  return { tempPath, ...measureStaged(tempPath), sizeBytes };
}

/** `doctor --restore`, second half, once decideBind admitted the staged copy (D-4218,
 *  D-4724 (history-binding-facts-before-link)). In order:
 *  1. on the COPY: `PRAGMA journal_mode=WAL`, because a VACUUM INTO output is a rollback-journal database (M,
 *     22.16.0);
 *  2. still on the copy, ONE FULL transaction: `bound:<ms>` = restore, a new writer token, the ('recover', <ms>)
 *     step and the `bind` outbox row, and every journal-known redact pair `i.pairs` carries (W1-B2 Task 25's
 *     journalRedactPairs, which Task 27's restore reads under its lock) into redact_hashes. A pair the copy lacked
 *     starts the step's cursor `+pairs` (lib's formatRecoverCursor), so the reindex phase still re-derives what the
 *     pair masks, although the index phase will find every pair already present
 *     (spec §8.4 and §9.14). So no read verb ever serves the restored store without a pair the
 *     journal knows: they answer while the step is registered, and their pair index is the store's redact_hashes.
 *     The pair insert raises a value the belt's witness reads, so with `i.belt` that transaction opens with
 *     `belt.check(db)` and closes with `belt.stamp(db)` (spec §6.2 "The belt"; coordinator ruling R-witness-restore:
 *     a belt-aware writer that changes witnessed values checks the witness first, then writes, then stamps). Task 27
 *     passes sweep.mjs's check and Task 7B's stampBeltWitness; store.mjs owns the order only;
 *  3. close it, which checkpoints its own -wal away, and fsync it;
 *  4. store.writer, then store.id.pending when store.id is absent (decideBind refused a store.id naming another
 *     store);
 *  5. `link()` the copy to history.db, which fails if one appeared; unlink the temp;
 *  6. rename the marker to store.id.
 *  A kill anywhere leaves either no history.db, or one whose binding and recovery step are already inside it. */
export function commitRestore(home, staged, { nowMs, pairs = [], belt = null }) {
  const P = historyPaths(home);
  if (staged.storeId.state !== 'value') {
    throw new StoreError('restore-refused', `${staged.tempPath} carries no readable meta.store_id`);
  }
  for (const pr of pairs) {
    if (!Number.isSafeInteger(pr.len) || pr.len <= 0 || !PAIR_SHA_RE.test(String(pr.sha256)) || !Number.isSafeInteger(pr.t)) {
      throw new TypeError(`commitRestore: a redact pair is { len, sha256 (64 hex), t }: ${JSON.stringify(pr)}`);
    }
  }
  if (belt !== null && (typeof belt?.check !== 'function' || typeof belt?.stamp !== 'function')) {
    throw new TypeError('commitRestore: a belt is null or { check(db), stamp(db) }');
  }
  const storeId = staged.storeId.value;
  const writer = mintWriter();
  const db = new DatabaseSync(staged.tempPath);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA journal_mode = WAL');
    if (journalModeOf(db) !== 'wal') {
      throw new StoreError('store-not-wal', `${staged.tempPath} would not change to WAL mode`);
    }
    withTx(db, 'FULL', () => {
      // spec §6.2 "The belt" (R-witness-restore): the witness checked before this transaction writes anything.
      if (belt !== null) belt.check(db);
      insertBindFacts(db, { kind: 'restore', nowMs, writer, recover: true });
      // spec §8.4 and §9.14 (R-restore-pairs): every journal-known pair, inside the copy, before the link.
      const ins = db.prepare(RESTORE_PAIR_INSERT);
      let added = 0;
      for (const pr of pairs) added += Number(ins.run(pr.len, Buffer.from(pr.sha256, 'hex'), pr.t).changes);
      if (added > 0) {
        db.prepare("UPDATE derivation_state SET cursor = ? WHERE step = 'recover' AND version = ?")
          .run(formatRecoverCursor({ phase: RECOVER_PHASES[0], file: null, offset: 0, blobId: null, pairsAdded: true }), nowMs);
      }
      // ... and stamped after its last write, so the first recovery pass never reads the pairs as another build's.
      if (belt !== null) belt.stamp(db);
    });
  } finally {
    db.close();
  }
  const fd = openSync(staged.tempPath, FS.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
  writeFileAtomic(P.writer, `${writer}\n`);
  const needsPending = readBindingFile(P.storeId, UUID_RE).state === 'absent';
  if (needsPending) writeFileAtomic(P.pending, `${storeId}\n`);
  linkSync(staged.tempPath, P.dbFile);
  unlinkSync(staged.tempPath);
  fsyncDir(P.dbDir);
  if (needsPending) {
    renameSync(P.pending, P.storeId);
    fsyncDir(P.root);
  }
  return { storeId, writer };
}

/** A refused restore's copy, removed with its sidecars: SQLite pairs a WAL with its file by name (DI13). */
export function abortRestore(staged) {
  for (const s of ['', '-wal', '-shm', '-journal']) removeEntry(`${staged.tempPath}${s}`);
}
