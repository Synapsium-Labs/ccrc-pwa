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
import { lstatSync, statSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync, constants as Z } from 'node:zlib';
import { BUSY_TIMEOUT_MS } from './lib.mjs';

/** The codec word every blob row records: Brotli at quality 5 (RV6). */
export const CODEC = 'br5';

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
 *  Changed: a 0-byte file is refused as the writer refuses it, and busy_timeout
 *  is set. `query_only` makes even a statement the readOnly flag would let
 *  through (a `temp.` create) a refusal. */
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
    params: { [Z.BROTLI_PARAM_QUALITY]: 5, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
}

export function unbrotli(z) {
  return brotliDecompressSync(z);
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
