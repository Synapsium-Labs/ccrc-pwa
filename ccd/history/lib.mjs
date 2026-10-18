// ccd/history/lib.mjs — ccrc history's policy ring (L1): every vocabulary,
// every constant and every pure decision the sweep, the CLI and doctor share.
//
// Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
// (§6.4 rings by imports, §13 cross-cutting invariants). L1 is a property of
// this file's IMPORTS, not its path, and history-lib.test.ts reads it off the
// import block: `node:crypto` is the only import. No `fs`, no `sqlite`, no
// `child_process`, no environment read, and nothing that imports them —
// `compact-card.mjs` imports `node:fs`, so a function of its reaches a
// decision here as an injected parameter, never by import. A decision that
// needs a file's bytes or a stat takes them as arguments.
//
// Every vocabulary is spelled ONCE, here, and frozen. The sweep, the CLI and
// the bash that must agree with them (the hook's spool line, doctor's words,
// `_uninst_purge`'s store files) are pinned to these declarations by
// single-definition.test.ts and history-lib.test.ts, never retyped. A word the
// spec names only in prose is marked plan-chosen where it is declared.
//
// Types: the hand-written `lib.d.mts` beside this file (the
// `compact-card.d.mts` precedent). Nothing machine-checks it against this
// file, so every export added here is declared there in the same commit.
// `node:crypto` arrives with the ids and digests (canonical JSON, eventKey).
import { createHash } from 'node:crypto';

// ── exit codes and the reason words (§8.3) ────────────────────────────────
// D-4169: 4 (writer busy) and 9 (no store on this box)
// are additive to the approved codes, which keep their meanings.
export const EXIT = Object.freeze({
  OK: 0, INTERNAL: 1, REFUSED: 2, NOT_FOUND: 3, WRITER_BUSY: 4, DB: 5,
  NOT_INDEXED: 6, FTS_UNAVAILABLE: 7, RECALL_OFF: 8, NO_STORE: 9,
});

// D-4171: every reason word maps to its ONE exit code.
// Exits 2, 4, 5 and 7 carry words that are distinct by design; 3, 6, 8 and 9
// each have one meaning and carry none. Plan-chosen spellings of conditions
// the spec names only in prose: `bad-args`, `regex-syntax`, `regex-refused`,
// `project-unreadable`, `store-zero-byte`, `store-schema-missing`, `store-read-failed`.
const REASON_ROWS = [
  // `repair-refused` and `backup-refused` (W1-B2): doctor --repair refused on integrity_check or on a NEW
  // foreign-key violation, and doctor --backup refused for room. D-4696 (history-reasons-repair-backup)
  // `recovering` (W1-B2, RB6): a writing --op form refused while a recovery step is registered (decideOpGate).
  // It is doctor's WARN word too; one word in two tables, as store-unmeasured is.
  // D-4698 (history-ops-refused-while-recovering)
  [EXIT.REFUSED, [
    'bad-args', 'regex-syntax', 'regex-refused', 'regex-timeout', 'cross-project', 'out-of-scope',
    'project-unreadable', 'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'no-identity',
    'bad-id', 'apply-in-session', 'needs-tty', 'irreversible-in-pane', 'history-off', 'span-pruned',
    'older-than-floor', 'reparse-too-many', 'workspace-unreadable', 'harness-unsupported',
    'harness-unreadable', 'generation-unreadable', 'writer-absent', 'adopt-refused', 'restore-refused',
    'rebuild-refused', 'migrate-refused', 'repair-refused', 'backup-refused', 'recovering',
    // `roster-unreadable` and `uuid-claimed` (Task 26F, D-4313): `--op import`'s two refusals that used to answer
    // exit 0 — the shim passed --roster-unreadable (no homes to list or admit), or an operator's --session --file
    // mapping names a uuid another family already holds confirmed. Plan-chosen words.
    'roster-unreadable', 'uuid-claimed',
  ]],
  [EXIT.WRITER_BUSY, ['writer-busy']],
  [EXIT.DB, [
    'probe-failed', 'store-zero-byte', 'store-schema-missing', 'store-root-dangling', 'store-missing',
    'store-mismatch', 'store-unbound', 'store-unreachable', 'store-unmeasured', 'store-recoverable',
    'store-wal-orphaned', 'store-not-wal', 'migration-pending',
    // `schema-newer` (Task 24): the newer-schema refusal of a WRITING pass — a scheduled pass prints it and exits 5,
    // and an `--op import` relays it; the CLI never needs it, because it reads a newer store (G9). Plan-chosen word.
    'schema-newer',
    // `store-read-failed` (Task RF5b, review 316 F11; D-4171, D-4313): status's read of a store the binding read admitted
    // threw an SQLite error — a v1 table or column it names is missing, a corrupt file, an I/O error. Plan-chosen word.
    'store-read-failed',
  ]],
  [EXIT.FTS_UNAVAILABLE, ['fts5-absent', 'fts-pending']],
];
const reasonEntries = REASON_ROWS.flatMap(([code, words]) => words.map((w) => [w, code]));
export const REASONS = Object.freeze(Object.fromEntries(reasonEntries));
// A word listed twice would silently keep its LAST code — the overloaded value
// this table exists to prevent — so a duplicate refuses to load at all.
if (Object.keys(REASONS).length !== reasonEntries.length) {
  throw new Error('lib.mjs: a reason word is listed under two exit codes');
}
/** Derived, never declared apart (O14): the exit-2 words. */
export const REFUSALS = Object.freeze(Object.keys(REASONS).filter((w) => REASONS[w] === EXIT.REFUSED));

// ── the writing forms and their speed bumps (§8.4) ────────────────────────
// `irreversible` forms also need a TTY and refuse from a `cc-` pane;
// `binding` forms (adopt, restore, rebuild) still run while capture is off.
const form = (op, irreversible, binding) => Object.freeze({ op, irreversible, binding });
export const WRITING_FORMS = Object.freeze({
  'import-apply': form('import', false, false),
  'import-session-apply': form('import', true, false),
  'prune-apply': form('prune', true, false),
  repair: form('repair', true, false),
  backup: form('backup', false, false),
  migrate: form('migrate', false, false),
  adopt: form('adopt', true, true),
  restore: form('restore', true, true),
  rebuild: form('rebuild', true, true),
  'reparse-apply': form('reparse', false, false),
  'recall-off': form('recall-off', false, false),
  'recall-off-clear-all': form('recall-off', false, false),
});

// ── where the store lives (§5.2, §9.5, §9.7) ──────────────────────────────
// D-4172: the root is the fixed `~/.ccrc/history`, and
// only `db/` may be a symlink. This literal is the ONLY spelling of the DB
// directory in ccd/history/*.mjs (O14; the disk spec's parity pin, O30).
export const STORE_DB_REL = '.ccrc/history/db';
/** The root, derived from the one spelling above rather than typed again. */
export const HISTORY_ROOT_REL = STORE_DB_REL.slice(0, -'/db'.length);
export const STORE_DB_FILE = 'history.db';
/** What the store owns under `db/`, as globs. `_uninst_purge` spells the same
 *  list once, in bash, pinned equal to this (O42). */
export const STORE_FILES = Object.freeze([
  'history.db', 'history.db-wal', 'history.db-shm', 'history.db-journal',
  'history.db.new.*', '.history.db.restore.*', 'backups',
]);
// D-4166: the cap is an operator file, not an env key. Every
// switch is a file with NO writer in the tree (§9.7, O13); this object is the
// one sanctioned spelling, HOME-relative.
export const SWITCHES = Object.freeze({
  off: '.ccrc/history-off',
  maxGb: '.ccrc/history-max-gb',
  steerOff: '.ccrc/history-steer-off',
  steerLivePrefix: '.ccrc/history-steer-live.',
  steerOnDir: '.ccrc/history/steer-on',
  headlessOn: '.ccrc/history/headless-on',
});

// ── constants (each *chosen* in the spec unless it says measured) ─────────
export const SPOOL_LINE_MAX = 1024;                 // bytes, one spool line without its fence
/** A draining spool file over this is never read, journaled or drained (D-4337, history-spool-file-size-cap): it is moved
 *  aside into `.draining/oversize/` and counted `spool_oversize`. A hook line is at most SPOOL_LINE_MAX bytes and a file is
 *  renamed every tick, so a legitimate one stays far under it. */
export const SPOOL_FILE_MAX = 67108864;             // 64 MiB
/** The observation sidecar's read bound: one observation plus the first-match times of its held lines (sweep.mjs `readSidecar`). */
export const OBS_FILE_MAX = 65536;
/** The read bound of a control or binding file (`store.id`, `store.id.pending`, `store.writer`, `op`, an attempt marker,
 *  `history-max-gb`, `ccrc.env`); each holds a few dozen bytes (store.mjs `readBounded`, D-4347 (history-planted-entries-never-wedge)). */
export const CONTROL_FILE_MAX = 65536;
/** D-4337 (history-spool-file-size-cap, its line arm): a draining spool file holding more than this many lines
 *  (splitSpoolText's ordinals: empty lines take none) is set aside like one over SPOOL_FILE_MAX, counted
 *  `spool_overlines`. Lines of at most SPOOL_LINE_MAX bytes bound a file's line count only from below (a real hook line
 *  is about 30-200 bytes, so a file under SPOOL_FILE_MAX can hold millions); the real margin is the per-tick rename: a
 *  spool file is renamed into `.draining` every tick (2 min), so a legitimate one holds the few lines one id writes
 *  between two ticks, and reaching this many needs that many hook events for one id while no sweep renames its file, a
 *  long outage (the timer stopped, or history-off while sessions keep writing; SessionStart's line is written whatever
 *  history-off says). A file that reaches the cap that way is set aside unread, its bytes kept, as D-4337 says. What
 *  the cap refuses is the amplification the byte cap let through: 24 MiB of 2-byte lines (12.6 million) aborted every
 *  pass in a 1 GiB scope (review 316 F6). */
export const SPOOL_FILE_LINES_MAX = SPOOL_FILE_MAX / SPOOL_LINE_MAX;   // 65536
export const SPOOL_ID_MAX = 224;                    // `.draining/<id>.<ms>.<pid>.jsonl` fits 255
export const STATFS_DEADLINE_MS = 5000;             // the writer's free-space probe (§9.3)
export const CLI_STAT_DEADLINE_MS = 2000;           // the CLI's reachability stat (§8.1)
export const TMUX_DEADLINE_MS = 2000;               // `tmux display-message -p -t` (§8.2)
export const REPARSE_MAX_TARGETS = 500;
export const CARRIER_KILL_S = 600;                  // == the unit's TimeoutStartSec=10min (DM43)
export const EXPORT_MARGIN_DAYS = 30;
// W1-B4 (spec §9.15): the sole-copy export's directory under the root, its segment bound and cadence (both chosen),
// and the one segment format this build writes and reads. Declared here, above MODE_CHECKED_FILE_ROOTS, which
// names EXPORT_DIR: a const read before its declaration is a TDZ error at load.
export const EXPORT_DIR = 'export';
export const EXPORT_SEGMENT_MAX_BYTES = 256 * 1024 * 1024;
export const EXPORT_PASS_INTERVAL_MS = 60 * 60 * 1000;
export const EXPORT_SEGMENT_FORMAT = 1;
export const LINE_MAX = 16 * 1024 * 1024;           // a longer transcript line is stored raw-only
/** The largest decompressed size (raw_len) a reader that must hold a whole stored body will decode. A body stored
 *  from a row Claude Code wrote (JSON.stringify output) re-encodes at no more than its line's length, so it is within
 *  LINE_MAX. A blob over it is a raw-only line-too-long line, whose raw_len is the full line and has no ceiling
 *  (findLineEnd scans to the next newline), or a foreign row whose canonical JSON grew past its line (an exponent
 *  number written out in digits, an invalid UTF-8 byte as U+FFFD's three bytes), which is passed over the same way.
 *  A body-reader reaches a raw line-too-long blob when a later row's uuid collides with the raw row's rawRowKey;
 *  decompressing it whole inside the chunk transaction could exhaust the carrier's memory on every ingest of that
 *  uuid (review 316 F7 sibling). A reader that meets one passes it over: the variant compare gets no body (cause
 *  `unknown`), the blob keeps no FTS row (marked indexed, none inserted, and any row an older store holds is deleted
 *  by the re-derivation; FU5, final pass FP9), and the paired-tool-use walk goes on to its parent. The check reads the
 *  stored raw_len, so the decode itself is bounded by that same raw_len too (store's unbrotli): a blob whose bytes
 *  decode past it does not decode, never an allocation past the cap (final review 316 FPM10).
 *  D-4346 (history-permanent-failures-classified). */
export const BLOB_DECODE_MAX = LINE_MAX;
/** Is a stored blob's decompressed size over BLOB_DECODE_MAX, so that a whole-body reader must refuse it before it
 *  decompresses? A non-numeric raw_len (never written: raw_len is NOT NULL INTEGER) refuses too. D-4346. */
export function blobOverDecodeCap(rawLen) {
  return !(typeof rawLen === 'number' && rawLen <= BLOB_DECODE_MAX);
}
/** D-4345 (history-json-structure-bound): the deepest a transcript line's JSON may nest, and the most structural
 *  units it may hold (a unit is a `[`, `{` or `,` outside a string; every value or key follows a `[`, `{`, `,` or `:`,
 *  and a `:` only follows a key, so a line holds at most 2 × units + 1 of them). A line over either is stored raw-only
 *  and never parsed: JSON.parse and canonicalJson hold every value at once, and 8.1 million nested arrays in a valid
 *  16,200,040-byte line, or 5.4 million empty objects side by side, aborted every pass in a 1 GiB scope (review 316 F7).
 *  Measured for a whole pass on Node 24.14.1: the heaviest structured shape, 500,000 units of 30-character strings in
 *  one 16,499,914-byte line, peaked at 389,508 KiB, under half the carrier's MemoryMax=1G (524,288 KiB, D-4244's bound
 *  family), where 999,013 units of 13-character strings peaked at 516,988 KiB, 7,300 KiB (1.4%) under that half and too
 *  near it to keep. A plain-text line's cost is redaction and indexing, which this bound does not reach and D-4419's
 *  window does: with the window, a 16 MB user text of 8,000,000 one-letter words with a secret file loaded peaks at
 *  184,960 KiB for a whole pass in a 1 GiB scope (783,640 KiB before it, FU2), and the heaviest plain-text line
 *  measured with it, an ESC 7-dense one, at 372,204 KiB. A 4.3-million-line sample of this fleet's transcripts held at
 *  most 24,944 units, 15 deep. */
export const JSON_DEPTH_MAX = 100_000;
export const JSON_NODES_MAX = 500_000;
// 2 MiB, within §9.2's "≤16 MiB": the most headroom under O20's 256 MiB on Node 22.16.0 (whole sweep 172884 KiB; 4 MiB chunks: 210824 KiB, 247412 KiB once FTS indexes inline) (plan tasks 20, 23; D-4244).
export const CHUNK_BYTES = 2 * 1024 * 1024;         // parsed lines per ingest transaction
export const RUN_BUDGET_MS = 90_000;                // one budget per run, never reset per file
export const RUN_BUDGET_BYTES = 512 * 1024 * 1024;
/** One tick's share of the run budget for the re-derivation (D-4344, history-reindex-mark-by-rederivation), so a
 *  generation never starves capture; bytes are compressed, as the backfill charges them. */
export const REDERIVE_SLICE_MS = 20_000;
export const REDERIVE_SLICE_BYTES = 128 * 1024 * 1024;
export const CAP_DEFAULT_GB = 50;
export const CAP_WARN_PCT = 80;
export const FLOOR_GIB = 15;
export const FLOOR_PCT = 10;
export const EPOCH_CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SCAN_INTERVAL_MS = 30 * 60 * 1000;
export const SIDECAR_FTS_BYTES = 512 * 1024;
/** How far past SIDECAR_FTS_BYTES a sidecar is decoded and redacted before it is cut (D-4312). */
export const SIDECAR_REDACT_MARGIN = 65536;
/** The most UTF-8 bytes of an entry's plain text the FTS index holds (D-4419, history-entry-index-text-windowed; final
 *  review 316 FP2, FP7). `entryIndexText` cuts every index text written or re-derived to its first ENTRY_FTS_BYTES after
 *  `redactForIndex` has read ENTRY_REDACT_MARGIN bytes more. redactForIndex reads up to nine times what it is given, so
 *  the window, not LINE_MAX, bounds one text's cost: one 16 MB line cost one call about 650-690 s, another aborted every
 *  pass in a 1 GiB scope, and with the window the worst shape measured costs 34-43 s. Of 3,123,407 lines sampled from
 *  this fleet's transcripts, two held more plain text than this (1,717,658 bytes each). */
export const ENTRY_FTS_BYTES = 1024 * 1024;
/** How far past ENTRY_FTS_BYTES an entry's text is redacted before it is cut: the sidecar's margin (D-4419). */
export const ENTRY_REDACT_MARGIN = SIDECAR_REDACT_MARGIN;
/** The most JSON-escape decodes redactForIndex reads past its first redaction (D-4343). A backslash run halves per
 *  decode and a backslash-u-005c chain loses one level, so 8 undo nesting far deeper than real tools write; the count
 *  bounds a pathological input's cost. */
export const INDEX_UNESCAPE_PASSES = 8;
export const SECRET_MIN_LEN = 20;
export const SECRET_SEGMENT_MIN = 12;
export const DEFAULT_COPY_BPS = 10_000_000;
export const MAX_INTERRUPTED_ATTEMPTS = 2;
// SCHEMA_VERSION is derived from SCHEMA_ADDED (below): the code's schema version is spelled once.
export const BUSY_TIMEOUT_MS = 30_000;
export const SHIM_GRACE_MS = 4 * 60 * 1000;         // two timer periods of the shim's mtime (§9.6)
export const TICK_STALE_MS = 10 * 60 * 1000;
/** How far past `nowMs` a live pass's recorded start may lie before `deriveHealth` stops reading it: a small slack for
 *  two clocks read a moment apart, not for a clock that stepped back (tick-stale review T3). */
export const PASS_FUTURE_SLACK_MS = 60 * 1000;
export const LAG_FAIL_MS = 30 * 60 * 1000;
export const RECOVERY_STALL_TICKS = 15;
export const CATCHING_UP_TICKS = 3;
export const JOURNAL_GROWTH_BYTES = 40 * 1024 * 1024;

/** A UUID as ccd and the hook spell one: lowercase, 8-4-4-4-12. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A binding's writer token (§9.14): 8 lowercase hex. */
export const WRITER_RE = /^[0-9a-f]{8}$/;

// ── vocabularies (O14: each declared here and nowhere else) ───────────────
export const NODE_KINDS = Object.freeze(['steered_leaf', 'native_leaf', 'raw_leaf', 'condensed']);
/** `nodes.status` (§6.2). */
/** `parse-failed` (W1-B2, RB5): a leaf whose node parser threw, written with its id, span and sources and re-derived
 *  only by reparse. D-4706 (history-parser-crash-recorded) */
export const PARSE_STATUS = Object.freeze(['ok', 'degraded', 'invalid', 'absent', 'not-requested', 'parse-failed']);
/** `entries.parse_state` (§6.2, §9.2 step 4). */
export const ENTRY_PARSE_STATES = Object.freeze(['ok', 'raw-only']);
export const PROVENANCE = Object.freeze(['operator', 'model', 'tool', 'summary', 'harness', 'ccrc-injected', 'recall-echo']);
/** The provenances the FTS index holds (§6.2). */
export const SEARCHABLE_PROVENANCE = Object.freeze(['operator', 'model', 'tool']);
/** Spool line kinds: the hook writes the first three, the CLI `recall` (B2),
 *  the hook `steer` (W3). */
export const SPOOL_EVENTS = Object.freeze(['Stop', 'PostCompact', 'SessionStart', 'recall', 'steer']);
/** The SessionStart sources that spool (ruled Q2), and `fork` from W1-B2 (ruled Q16, D-4734 (history-fork-spooled),
 *  reversing D-4173). A fork epoch needs no migration: `epochs.cause` is TEXT with no CHECK
 *  in schema v1, and EPOCH_CAUSES (below) has held `fork` since W1-B1 (D-4342).
 *  THE ROLLBACK EDGE (§6.1): a W1-B1 build's drain rejects a spooled fork line (spool_line_rejected), its journal
 *  reader skips that line's `spool` record as malformed (journal_line_malformed; doctor WARN journal-record-skipped,
 *  §9.14), and that fork falls back to its registry backfill. Because W1-B1 merged with `fork` in EPOCH_CAUSES, a
 *  rolled-back build reads a fork epoch's journal `verdict` record and a waiting fork candidate's verdict as valid;
 *  only this spool-line part remains. */
export const SPOOL_SOURCES = Object.freeze(['startup', 'resume', 'clear', 'fork']);
/** The non-regular nodes a planted `spool/<id>.jsonl` can be, in the one wording status's `spool-planted` detail and
 *  README's spool paragraph both carry (H-137: history-skill.test.ts pins README against this). */
export const SPOOL_NODE_KINDS = 'a FIFO, a link, a directory or any other non-regular node';
/** D-4342 (history-epoch-causes-widened-for-rollback): 'fork' is vocabulary only. B1 still spools no fork (D-4173);
 *  W1-B2 does (Q16), and a box rolled back from B2 can hold a fork candidate whose verdict this build must read back. */
export const EPOCH_CAUSES = Object.freeze(['startup', 'resume', 'clear', 'import', 'fork']);
export const DECLARED_BY = Object.freeze(['hook', 'registry', 'journal', 'operator']);
/** `ingest_files.last_error_code`: a closed vocabulary, never `e.message`. */
export const ERROR_CODES = Object.freeze(['json-parse', 'not-object', 'line-too-long', 'line-too-complex', 'read-failed', 'stat-failed', 'open-refused', 'parser-crash']);
export const CARD_PREFIX = 'History: ';
// D-4167: W1 answers for this box's store only.
export const COVERAGE = Object.freeze(['this-box']);
export const SCOPE_SOURCES = Object.freeze(['tmux']);
export const VARIANT_CAUSES = Object.freeze(['ccd-sanitize', 'unknown']);
export const BACKENDS = Object.freeze(['anthropic', 'other', 'unknown']);
export const JOURNAL_KINDS = Object.freeze(['head', 'file', 'spool', 'verdict', 'redact', 'tick']);
export const JOURNAL_VERDICTS = Object.freeze([
  'family', 'epoch-confirmed', 'epoch-unconfirmed', 'epoch-chained', 'generation-joined',
  'rekeyed', 'mapping', 'bind', 'drained',
]);
export const BIND_KINDS = Object.freeze(['adopt', 'restore', 'rebuild']);
export const MIGRATION_VERDICTS = Object.freeze(['none', 'refuse-newer', 'refuse-low-disk', 'snapshot-needs-op', 'snapshot-then-migrate']);
/** SQLite result codes the sweep decides on, spelled once. node:sqlite's `errcode` is the EXTENDED code; its low byte is
 *  the primary. D-4346 (history-permanent-failures-classified). */
export const SQLITE_CODES = Object.freeze({
  BUSY: 5, LOCKED: 6, TOOBIG: 18, CONSTRAINT: 19, MISMATCH: 20,
  CONSTRAINT_CHECK: 275, CONSTRAINT_NOTNULL: 1299, CONSTRAINT_PRIMARYKEY: 1555, CONSTRAINT_UNIQUE: 2067,
  CONSTRAINT_ROWID: 2579, CONSTRAINT_DATATYPE: 3091,
});
/** What the drain does with one file's failed transaction (D-4346). */
export const DRAIN_FAILURE_ARMS = Object.freeze(['defer', 'reject', 'fail']);
/** The exact extended codes by which the store refused a file's own row values; every other constraint (a foreign key, a
 *  trigger, a commit hook, a virtual table) names something outside the file. */
const DRAIN_REJECT_CODES = Object.freeze([
  SQLITE_CODES.TOOBIG, SQLITE_CODES.CONSTRAINT, SQLITE_CODES.MISMATCH, SQLITE_CODES.CONSTRAINT_CHECK,
  SQLITE_CODES.CONSTRAINT_NOTNULL, SQLITE_CODES.CONSTRAINT_PRIMARYKEY, SQLITE_CODES.CONSTRAINT_UNIQUE,
  SQLITE_CODES.CONSTRAINT_ROWID, SQLITE_CODES.CONSTRAINT_DATATYPE,
]);
/** What the drain does with one file's failed transaction, from the extended result code of its SQLite error
 *  (D-4346, history-permanent-failures-classified). Pure: sweep.mjs only executes the answer.
 *  - 'defer': the store is busy (BUSY or LOCKED, any extended code), so the file and every later one wait in order, as before.
 *  - 'reject': the store refused the file's own rows; the already-journaled file is set aside and the drain goes on.
 *  - 'fail': the store itself failed (FULL, I/O, corruption, a foreign schema object, a foreign key) or no code was given;
 *    the tick ends with the error, as ingest's SQLite errors do (D-4340). */
export function decideDrainFailure(errcode) {
  if (typeof errcode !== 'number' || !Number.isInteger(errcode)) return 'fail';
  const primary = errcode & 0xff;
  if (primary === SQLITE_CODES.BUSY || primary === SQLITE_CODES.LOCKED) return 'defer';
  if (DRAIN_REJECT_CODES.includes(errcode)) return 'reject';
  return 'fail';
}
/** The one word a scheduled pass prints as `history-sweep: <word>` when it
 *  ends without a tick (§5.3: no DB is open to count it in). Plan-chosen
 *  where the spec names the condition only: `schema-newer`, `held`. */
export const PASS_WORDS = Object.freeze([
  'store-create-refused-role', 'store-unreachable', 'journal-unwritable', 'store-recoverable',
  'store-wal-orphaned', 'store-missing', 'store-mismatch', 'store-unbound', 'store-unmeasured',
  'store-root-dangling', 'store-zero-byte', 'store-schema-missing', 'store-not-wal', 'schema-newer', 'migration-refused',
  'migration-needs-op', 'held', 'off', 'migrated',
]);
/** Every durability word `status --json` reports and doctor's `_check_history`
 *  prints (§9.6, O14), with its class. Plan-chosen spellings of conditions the
 *  spec names in prose: `first-tick-pending`, `tick-stale`, `lag-high`,
 *  `at-cap`, `capture-paused-low-disk`, `mode-wrong`, `schema-newer`,
 *  `cap-malformed`, `cap-near`, `breaker-open`, `roster-unreadable`,
 *  `root-is-symlink`, `fts-unavailable`, `status-unreadable`, D-4346's `blob-undecodable` and `drain-rejected`, and D-4347's
 *  `spool-planted`. */
const healthRows = (cls, words) => words.map((w) => [w, cls]);
const healthEntries = [
  // D-4168: within the shim's grace with no tick yet, doctor answers PASS, not §9.6 step 3's WARN.
  ...healthRows('pass', ['first-tick-pending', 'ok']),
  ...healthRows('warn', [
    'off', 'recovering', 'op-running', 'catching-up', 'lag-unmeasured', 'fts-unavailable', 'cap-malformed',
    'redact-source-unreadable', 'cap-near', 'breaker-open', 'roster-unreadable', 'root-is-symlink',
    'export-due', 'export-paused-low-disk', 'retention-unmeasured', 'retention-lowered',
    'export-segment-missing', 'journal-record-skipped', 'journal-growth', 'blob-undecodable',
    'drain-rejected', 'spool-planted',
  ]),
  ...healthRows('fail', [
    'tick-stale', 'lag-high', 'at-cap', 'capture-paused-low-disk', 'mode-wrong', 'schema-newer',
    'store-not-wal', 'store-unmeasured', 'recovery-stalled', 'store-root-dangling', 'store-missing',
    'store-mismatch', 'store-unbound', 'store-unreachable', 'store-recoverable', 'store-wal-orphaned',
    'store-zero-byte', 'store-schema-missing', 'migration-refused', 'migration-needs-op', 'journal-unwritable',
    'export-segment-newer', 'export-overdue', 'status-unreadable',
  ]),
];
export const HEALTH_WORDS = Object.freeze(Object.fromEntries(healthEntries));
if (Object.keys(HEALTH_WORDS).length !== healthEntries.length) {
  throw new Error('lib.mjs: a health word is listed under two classes');
}

// ── ids that become paths (§8.2) ──────────────────────────────────────────
// D-4170: ccd's session-id grammar (`^[A-Za-z0-9._-]+$`,
// ccd/ccd's id check), minus `.` and `..`, at most SPOOL_ID_MAX chars. It runs
// on every id before a path is formed from it: the tmux-derived id,
// `--session`, `recall-off`, `import`, and a spool line's `id`.
const ID_RE = /^[A-Za-z0-9._-]+$/;
export function idOk(id) {
  return typeof id === 'string' && id.length <= SPOOL_ID_MAX && ID_RE.test(id) && id !== '.' && id !== '..';
}

/** The id a name in spool/ spools for, `<id>.jsonl` with an id that passes idOk and no leading dot; null for any other
 *  name, which no hook writes. The one grammar the sweep's rename and status's refused-node count both read (FR2c). */
export function spoolFileIdOf(name) {
  if (typeof name !== 'string' || name.startsWith('.') || !name.endsWith('.jsonl')) return null;
  const id = name.slice(0, -'.jsonl'.length);
  return idOk(id) ? id : null;
}

// ── the one role reader (§5.2, O53) ───────────────────────────────────────
/** One key out of an env file's TEXT, by `ccd/ccrc`'s `_box_env_value` rules
 *  in its default (two-argument) mode, which every doctor caller uses — so the
 *  sweep, the CLI and doctor never disagree about a server box. Exactly:
 *  per line, strip LEADING space, tab and CR; the line counts only if it then
 *  starts with `KEY=` (an `export KEY=` line does NOT, and a space before `=`
 *  does not); the LAST such line wins; then ONE trailing CR goes, then ONE
 *  layer of matching surrounding quotes (`"…"` or `'…'`, two chars or more).
 *  Trailing spaces stay. `found` is true when a `KEY=` line was seen, even
 *  with an empty value — `_box_env_value`'s rc 0. The file holds secrets
 *  (`CCRC_AGENT_TOKEN`, …): only the requested key's value is returned. */
export function readBoxEnvValue(text, key) {
  let value = '';
  let found = false;
  for (const raw of String(text).split('\n')) {
    let i = 0;
    while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t' || raw[i] === '\r')) i += 1;
    const line = raw.slice(i);
    if (line.startsWith(`${key}=`)) {
      value = line.slice(key.length + 1);
      found = true;
    }
  }
  if (value.endsWith('\r')) value = value.slice(0, -1);
  if (value.length >= 2) {
    const q = value[0];
    if ((q === '"' || q === "'") && value[value.length - 1] === q) value = value.slice(1, -1);
  }
  return { found, value };
}

// ── every path the history code forms (§5.2) ──────────────────────────────
/** Absolute paths under one HOME, joined with '/' (no `node:path` in L1).
 *  Each is derived from STORE_DB_REL, HISTORY_ROOT_REL or SWITCHES — never a
 *  second spelling. `journalFile` is SQLite's rollback journal beside the DB
 *  (`history.db-journal`), NOT the history journal: that is `journalDir`. */
export function historyPaths(home) {
  const h = String(home).replace(/\/+$/, '');
  if (!h.startsWith('/')) throw new TypeError(`historyPaths: HOME must be an absolute path, got ${JSON.stringify(home)}`);
  const root = `${h}/${HISTORY_ROOT_REL}`;
  const dbDir = `${h}/${STORE_DB_REL}`;
  const dbFile = `${dbDir}/${STORE_DB_FILE}`;
  return Object.freeze({
    root,
    spool: `${root}/spool`,
    draining: `${root}/spool/.draining`,
    journalDir: `${root}/journal`,
    dbDir,
    dbFile,
    wal: `${dbFile}-wal`,
    shm: `${dbFile}-shm`,
    journalFile: `${dbFile}-journal`,
    backups: `${dbDir}/backups`,
    storeId: `${root}/store.id`,
    pending: `${root}/store.id.pending`,
    writer: `${root}/store.writer`,
    op: `${root}/op`,
    pass: `${root}/pass`,
    passDied: `${root}/pass-died`,
    lock: `${h}/.ccrc/history-sweep.lock`,
    off: `${h}/${SWITCHES.off}`,
    cap: `${h}/${SWITCHES.maxGb}`,
    ccrcEnv: `${h}/.ccrc/ccrc.env`,
    accountsSh: `${h}/.ccrc/accounts.sh`,
    reg: `${h}/.cc-sessions`,
    shim: `${h}/.local/bin/ccd-history-sweep`,
  });
}

// ── canonical JSON, digests and ids (§6.1, §6.5, §9.14) ───────────────────
/** One body, one string, on every box and in every locale: object keys sorted
 *  by `Array.prototype.sort()`'s default order — UTF-16 code units, which no
 *  locale moves — never `localeCompare` (`tr_TR` reorders `i`/`I`, measured;
 *  DM8). Arrays keep their order; primitives are JSON.stringify's; a key whose
 *  value is `undefined` is dropped, as JSON.stringify drops it. */
export function canonicalJson(value) {
  const leaf = (v) => {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  };
  if (value === null || typeof value !== 'object') return leaf(value);
  // D-4304 (canonical-json-iterative): an explicit stack, not recursion. A
  // model-written tool input nested ~3,000 levels deep is valid JSON that
  // JSON.parse reads at any depth, and a recursive walk threw RangeError on it.
  const open = (v) => {
    const isArr = Array.isArray(v);
    return { v, isArr, keys: isArr ? null : Object.keys(v).filter((k) => v[k] !== undefined).sort(), i: 0, parts: [], prefix: '' };
  };
  const stack = [open(value)];
  for (;;) {
    const f = stack[stack.length - 1];
    const n = f.isArr ? f.v.length : f.keys.length;
    if (f.i < n) {
      const key = f.isArr ? null : f.keys[f.i];
      const child = f.isArr ? f.v[f.i] : f.v[key];
      f.i += 1;
      const prefix = key === null ? '' : `${JSON.stringify(key)}:`;
      if (child === null || typeof child !== 'object') {
        f.parts.push(`${prefix}${leaf(child)}`);
      } else {
        const g = open(child);
        g.prefix = prefix;
        stack.push(g);
      }
      continue;
    }
    const text = f.isArr ? `[${f.parts.join(',')}]` : `{${f.parts.join(',')}}`;
    stack.pop();
    if (stack.length === 0) return text;
    const parent = stack[stack.length - 1];
    parent.parts.push(`${f.prefix}${text}`);
  }
}

/** D-4345 (history-json-structure-bound): are a line's bytes within JSON_DEPTH_MAX and JSON_NODES_MAX? One pass
 *  over the bytes BEFORE any parse, allocating nothing. A string is skipped (a backslash skips the byte after it), so a
 *  bracket or comma inside one never counts; a multi-byte UTF-8 sequence holds no ASCII byte. The bytes need not be
 *  valid JSON: JSON.parse builds every value before it meets a trailing bad byte, so an over-bound line is refused
 *  whether or not it parses, and a line within the bound that does not parse is JSON.parse's to refuse. */
export function jsonWithinStructureBound(bytes) {
  let depth = 0;
  let units = 0;
  let inString = false;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (inString) {
      if (b === 0x5c) i += 1;                 // `\`: the next byte is escaped, never a closing quote
      else if (b === 0x22) inString = false;
      continue;
    }
    if (b === 0x22) inString = true;
    else if (b === 0x5b || b === 0x7b) {     // `[` `{`
      depth += 1;
      units += 1;
      if (depth > JSON_DEPTH_MAX || units > JSON_NODES_MAX) return false;
    } else if (b === 0x5d || b === 0x7d) depth -= 1;
    else if (b === 0x2c) {                   // `,`
      units += 1;
      if (units > JSON_NODES_MAX) return false;
    }
  }
  return true;
}

export function sha256Bytes(data) {
  return createHash('sha256').update(data).digest();
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

// derived from lossless-claw src/pending-summary-projection.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
/** Hash ordered identity parts with unambiguous separators: the domain
 *  prefix, then a NUL before each part, so `['ab','c']` and `['a','bc']`
 *  never collide (§11 V3). Strings hash as UTF-8. */
export function digestText(prefix, parts) {
  const hash = createHash('sha256');
  hash.update(prefix);
  for (const part of parts) {
    hash.update('\0');
    hash.update(part);
  }
  return hash.digest('hex');
}

/** A leaf's id, minted BEFORE compaction so instructions and the card can
 *  carry it (§6.1). The boundary-qualified form is the later of two forked
 *  copies that compacted after one head (`leaf_id_forked`). */
export function leafId(ccrcId, ccUuid, spanStartUuid, boundaryUuid) {
  const parts = [ccrcId, ccUuid, spanStartUuid];
  if (boundaryUuid) parts.push(boundaryUuid);
  return `L${digestText('ccrc-leaf/v1', parts).slice(0, 20)}`;
}

export function parentId(childIds) {
  return `N${digestText('ccrc-node/v1', childIds).slice(0, 20)}`;
}

/** A spool line's key (§9.14): where the line SITS — its draining file's name
 *  and its ordinal — never when it was received, so a file journaled again
 *  after a crash, and a line with no `ts`, keep their keys. */
export function eventKey(drainingFileName, ordinal) {
  return digestText('ccrc-spool/v1', [drainingFileName, String(ordinal)]);
}

/** A blob's address (§6.1): sha256 over the body's canonical JSON. */
export function blobShaOfBody(body) {
  return sha256Bytes(canonicalJson(body));
}

/** A sidecar's address: sha256 over the file's own bytes. */
export function blobShaOfBytes(bytes) {
  return sha256Bytes(bytes);
}

// ── the spool line (§5.1, §9.2 step 1; S5, S14, S17) ──────────────────────
// D-4176: every writer appends `\n<json>\n`, so a short
// write leaves a partial line the next append cannot fuse with; an EMPTY line
// takes no ordinal, so a fenced file and an unfenced one give one set of keys.
// D-4175: `reg` rides startup, resume
// and fork lines only (fork from W1-B2, D-4734 (history-fork-spooled), which reverses D-4173's
// value rejection); `src` is one of SPOOL_SOURCES. D-4177: no key carries summary text or a
// hash of it. The `recall` (B2's CLI) and `steer` (W3's
// hook) key sets are plan-chosen; B1 drains them for the counters (O52).
// `sid` is optional on Stop and PostCompact only. A SessionStart line exists to
// declare an epoch's cc_session_uuid, so its `sid` is REQUIRED: one without
// `sid` answers `keys` and one with a non-UUID `sid` answers `value`, both by
// design; a writer with no lowercase-UUID sid emits no SessionStart line.
const keySet = (required, optional) => Object.freeze({ required: Object.freeze(required), optional: Object.freeze(optional) });
export const SPOOL_KEYS = Object.freeze({
  Stop: keySet(['v', 'ev', 'id'], ['sid', 'gen', 'ts']),
  PostCompact: keySet(['v', 'ev', 'id'], ['sid', 'trig', 'gen', 'ts']),
  SessionStart: keySet(['v', 'ev', 'id', 'sid', 'src'], ['reg', 'gen', 'ts']),
  recall: keySet(['v', 'ev', 'id', 'cmd', 'rc', 'ms'], ['gen', 'ts', 'arm']),
  steer: keySet(['v', 'ev', 'id', 'sid', 'leaf'], ['gen', 'ts']),
});

const isUuid = (x) => typeof x === 'string' && UUID_RE.test(x);
const isMs = (x) => Number.isSafeInteger(x) && x >= 0;
const isPos = (x) => Number.isSafeInteger(x) && x > 0;
/** Every value a spool line may carry, by key. `id` is not here: a bad id is
 *  its own answer (`bad-id`), never folded into `value`. */
const SPOOL_VALUE = Object.freeze({
  v: (x) => x === 1,
  ev: (x) => typeof x === 'string' && Object.hasOwn(SPOOL_KEYS, x),
  sid: isUuid,
  reg: isUuid,
  gen: isUuid,
  src: (x) => SPOOL_SOURCES.includes(x),
  trig: (x) => x === 'manual' || x === 'auto',
  ts: isPos,
  cmd: (x) => typeof x === 'string' && /^[a-z-]{1,32}$/.test(x),
  rc: (x) => Number.isSafeInteger(x) && x >= 0 && x <= 255,
  ms: isMs,
  arm: (x) => typeof x === 'string' && /^[a-z]{1,16}$/.test(x),
  leaf: (x) => x === '' || (typeof x === 'string' && /^L[0-9a-f]{20}$/.test(x)),
});

/** A spool file's lines with their ordinals: 1-based in file order, EMPTY
 *  lines skipped without taking one (S17). A last fragment with no `\n` is
 *  still a line — a partial one, which parseSpoolLine rejects. It walks the
 *  text with `indexOf` and never calls `split`, so a file of empty lines costs
 *  no array (D-4337: 64 MiB of newlines aborted a pass under a 512 MiB heap,
 *  review 316 F6). */
export function splitSpoolText(text) {
  const s = String(text);
  const out = [];
  let ordinal = 0;
  for (let start = 0; start < s.length;) {
    if (s.charCodeAt(start) === 10) { start += 1; continue; }   // an empty line takes no ordinal (S17)
    let nl = s.indexOf('\n', start);
    if (nl < 0) nl = s.length;
    ordinal += 1;
    out.push({ ordinal, raw: s.slice(start, nl) });
    start = nl + 1;
  }
  return out;
}

/** How many lines splitSpoolText returns for these bytes' UTF-8 text — the non-empty `\n`-separated pieces, a last
 *  piece with no `\n` included — counted on the bytes before any string exists: 0x0a never occurs inside a
 *  multi-byte UTF-8 sequence, and a decoder's replacement character is never `\n` (D-4337). */
export function spoolLineCount(bytes) {
  let n = 0;
  let open = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) { if (open) { n += 1; open = false; } } else open = true;
  }
  return open ? n + 1 : n;
}

/** D-4337 (history-spool-file-size-cap, its line arm): is a draining file's text over SPOOL_FILE_LINES_MAX lines? */
export function spoolLinesOverCap(bytes) {
  return spoolLineCount(bytes) > SPOOL_FILE_LINES_MAX;
}

/** One spool line, judged before anything reads it (S5): at most
 *  SPOOL_LINE_MAX bytes, one JSON object, exactly a declared key set, every
 *  value in its grammar. Any same-user process can write to `spool/`, so only
 *  a line that passes is ever journaled or drained. Checked in this order, and
 *  each failure answers its own word: too-long, json, not-object, keys (a
 *  missing or undeclared key, `reg` off a startup, resume or fork line, no `ev`), then
 *  bad-id, then value. */
export function parseSpoolLine(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > SPOOL_LINE_MAX) return { ok: false, why: 'too-long' };
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ok: false, why: 'json' };
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { ok: false, why: 'not-object' };
  if (!Object.hasOwn(o, 'ev')) return { ok: false, why: 'keys' };
  if (!SPOOL_VALUE.ev(o.ev)) return { ok: false, why: 'value' };
  const set = SPOOL_KEYS[o.ev];
  const keys = Object.keys(o);
  if (!set.required.every((k) => Object.hasOwn(o, k))) return { ok: false, why: 'keys' };
  if (!keys.every((k) => set.required.includes(k) || set.optional.includes(k))) return { ok: false, why: 'keys' };
  if (Object.hasOwn(o, 'reg') && o.src !== 'startup' && o.src !== 'resume' && o.src !== 'fork') return { ok: false, why: 'keys' };
  if (!idOk(o.id)) return { ok: false, why: 'bad-id' };
  for (const k of keys) {
    if (k !== 'id' && !SPOOL_VALUE[k](o[k])) return { ok: false, why: 'value' };
  }
  return { ok: true, rec: o };
}

// ── the journal's records (§9.14) ─────────────────────────────────────────
// D-4174: a `spool` record holds a line that passed
// parseSpoolLine, as its parsed object; nothing else reaches the journal. Every
// change to a record's shape bumps JOURNAL_V, so an older build reading a newer
// journal answers `newer` and skips, never throws (§9.14, unknown records).
export const JOURNAL_V = 1;
/** How an epoch was confirmed (§6.1): its own `reg`, the `.uuid` observed at
 *  the rename, the first match recorded while held, a later tick, or (a clear
 *  epoch only) its transcript's location. */
export const CONFIRM_BY = Object.freeze(['reg', 'observed', 'held-match', 'later-tick', 'location']);
/** Where a line's generation came from (§6.1): its own `gen`, the registry's
 *  `.generation`, or neither — absent and unreadable never folded. */
export const GENERATION_VIA = Object.freeze(['line', 'registry', 'absent', 'unreadable']);

/** D-4303 (draining-name-253): the longest draining name whose sidecar temp,
 *  `<name minus .jsonl>.obs.tmp` (two bytes longer than the name), still fits a
 *  255-byte NAME_MAX. A 254- or 255-byte name would make the sidecar's temp
 *  open throw ENAMETOOLONG on every pass, so it is refused here, not admitted. */
export const DRAINING_NAME_MAX = 253;

/** `.draining/<id>.<tickms>.<pid>.jsonl`, one name of at most DRAINING_NAME_MAX
 *  (253) bytes whose id passes idOk; the id is everything before the last three
 *  dot-parts. The ONE spelling of this grammar: the sweep's draining-name parser
 *  gates on it first, so a name refused here is never listed, journaled or
 *  drained. The sweep's own renames reach 252 bytes at most (D-4303). */
export function drainingNameOk(name) {
  return drainingNameParts(name) !== null;
}

/** A draining name's three parts, `{ id, tickMs, pid }`, or null for a name `drainingNameOk` refuses (FU8): this grammar's one
 *  split, shared by sweep.mjs's `parseDrainingName` and status's held-file walk. */
export function drainingNameParts(name) {
  if (typeof name !== 'string' || Buffer.byteLength(name, 'utf8') > DRAINING_NAME_MAX) return null;
  const m = /^(.+)\.([0-9]{1,16})\.([0-9]{1,10})\.jsonl$/.exec(name);
  return m !== null && idOk(m[1]) ? { id: m[1], tickMs: Number(m[2]), pid: Number(m[3]) } : null;
}

/** Journaling order (rev 3.2 review, DI9; FU8): tick ms, then pid, then name, of two `{ name, parts }` whose `parts` are
 *  `drainingNameParts(name)`. readdir order is a hash order, and lexical order puts tick 1000 before tick 900. sweep.mjs's
 *  `listDraining` and status's held-file walk sort by this one rule, so status knows which files the drain holds behind which. */
export function drainingOrder(a, b) {
  return a.parts.tickMs - b.parts.tickMs || a.parts.pid - b.parts.pid || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

const isGen = (x) => x === '' || isUuid(x);
const oneOf = (list) => (x) => list.includes(x);
const shape = (required, optional = {}) => Object.freeze({ required: Object.freeze(required), optional: Object.freeze(optional) });
const RECORD_SHAPES = Object.freeze({
  head: shape({ store_id: isUuid, month: (x) => typeof x === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(x), writer: (x) => typeof x === 'string' && WRITER_RE.test(x) }),
  file: shape({ name: drainingNameOk }),
  spool: shape({ ord: isPos, rec: (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && parseSpoolLine(JSON.stringify(x)).ok }),
  redact: shape({ len: isPos, sha256: (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x) }),
  tick: shape({ lag_ms: (x) => x === null || isMs(x) }),
});
const VERDICT_BASE = Object.freeze({ event_key: (x) => x === 'none' || (typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)), kind: oneOf(JOURNAL_VERDICTS) });
const VERDICT_SHAPES = Object.freeze({
  family: shape({ ccrc_id: idOk, generation: isGen, project: (x) => typeof x === 'string', first_seen_ms: isMs }),
  'epoch-confirmed': shape({ ccrc_id: idOk, generation: isGen, cc_session_uuid: isUuid, cause: oneOf(EPOCH_CAUSES), declared_by: oneOf(DECLARED_BY), by: oneOf(CONFIRM_BY) }),
  'epoch-unconfirmed': shape({ ccrc_id: idOk, generation: isGen, cc_session_uuid: isUuid, superseded: (x) => typeof x === 'boolean' }),
  'epoch-chained': shape({ ccrc_id: idOk, generation: isGen, cc_session_uuid: isUuid, cause: (x) => x === 'clear' }),
  'generation-joined': shape({ ccrc_id: idOk, generation: isGen, via: oneOf(GENERATION_VIA) }),
  rekeyed: shape({ ccrc_id: idOk, generation: isUuid }),
  mapping: shape({ ccrc_id: idOk, generation: isGen, cc_session_uuid: isUuid, declared_by: oneOf(DECLARED_BY) }, { path: (x) => typeof x === 'string' && x.length > 0 }),
  bind: shape({ bind: oneOf(BIND_KINDS), writer: (x) => typeof x === 'string' && WRITER_RE.test(x) }),
  drained: shape({ file: drainingNameOk }),
});

/** Exactly the declared fields beyond `v`, `k`, `t`: none missing, none extra,
 *  each value in its grammar. */
function fieldsOk(o, base, s) {
  const req = { ...base, ...s.required };
  for (const [k, ok] of Object.entries(req)) if (!Object.hasOwn(o, k) || !ok(o[k])) return false;
  for (const k of Object.keys(o)) {
    if (k === 'v' || k === 'k' || k === 't' || Object.hasOwn(req, k)) continue;
    if (!Object.hasOwn(s.optional, k) || !s.optional[k](o[k])) return false;
  }
  return true;
}

/** One journal line, read by replay and the sweep's audit: `record` (with the
 *  parsed object), `malformed` (bad JSON, a torn line, a wrong field), `unknown`
 *  (a `k` outside JOURNAL_KINDS, or a verdict kind outside JOURNAL_VERDICTS),
 *  or `newer` (a `v` above JOURNAL_V). The four are never folded (O56). */
export function parseJournalRecord(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return { kind: 'malformed' };
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { kind: 'malformed' };
  if (!Number.isSafeInteger(o.v) || o.v < 1) return { kind: 'malformed' };
  if (o.v > JOURNAL_V) return { kind: 'newer' };
  if (typeof o.k !== 'string') return { kind: 'malformed' };
  if (!JOURNAL_KINDS.includes(o.k)) return { kind: 'unknown' };
  if (!isMs(o.t)) return { kind: 'malformed' };
  if (o.k === 'verdict') {
    if (typeof o.kind !== 'string') return { kind: 'malformed' };
    if (!JOURNAL_VERDICTS.includes(o.kind)) return { kind: 'unknown' };
    return fieldsOk(o, VERDICT_BASE, VERDICT_SHAPES[o.kind]) ? { kind: 'record', rec: o } : { kind: 'malformed' };
  }
  return fieldsOk(o, {}, RECORD_SHAPES[o.k]) ? { kind: 'record', rec: o } : { kind: 'malformed' };
}

/** One journal line, WITHOUT its `\n`: `{"v":1,"k":<kind>,"t":<t>,…fields}`.
 *  It is built only if parseJournalRecord would read it back as a record, so
 *  the writer can never append a line its own reader skips. */
export function journalRecord(kind, t, fields) {
  if (!JOURNAL_KINDS.includes(kind)) throw new TypeError(`journalRecord: ${JSON.stringify(kind)} is not a JOURNAL_KINDS member`);
  const line = JSON.stringify({ v: JOURNAL_V, k: kind, t, ...fields });
  const back = parseJournalRecord(line);
  if (back.kind !== 'record') throw new TypeError(`journalRecord: a ${kind} record with these fields reads back as ${back.kind}`);
  return line;
}

// ===========================================================================
// Planners and gates (spec §5.3, §6.2, §6.9, §6.11, §8.3, §8.4, §9.2, §9.3).
// Every function in this block is a DECISION over measured inputs passed in
// as data. None reads a file, a clock, the environment or a terminal: the
// sweep and the CLI (L4) measure and execute, this ring only answers. That is
// what lets O56 and DM41 pin them in-process, with no fixture HOME at all.
// ===========================================================================

/** Bytes in one GiB: the unit of the free-space floor (§9.3, "15 GiB") and,
 *  plan-chosen, of the cap file's integer (`history-max-gb`), so the two sizes
 *  doctor compares against the store are in one unit. */
const PLANNER_GIB = 1073741824;

/** A measured presence has three states, never two. `unreadable` is not
 *  `absent` (rev 3.2 review, IV5): a file that exists and cannot be read says
 *  nothing about whether a store existed, so every decision below refuses on
 *  it rather than reading it as absence. */
function presenceUnreadable(p) {
  return p.state === 'unreadable';
}
function presenceValue(p) {
  return p.state === 'value' ? p.value : null;
}
function refuseStoreOpen(word) {
  return { act: 'refuse', word };
}

/** The store-open decision the sweep takes before it opens or creates
 *  anything: §6.2's open-time rules, §6.9's binding table and §5.3's rows, in
 *  the spec's order — role, root, measurability, truncation, then the binding.
 *  `store-schema-missing` (a DB whose `meta.store_id` is absent) is the one
 *  plan-chosen word: the spec's "schema-less store" (§8.3, exit 5) needs a
 *  name in the sweep too, and folding it into `store-mismatch` would give a
 *  damaged file the two-stores remedy.
 *  D-4183 D-4186
 *  D-4184 D-4185
 *  D-4188 */
export function decideStoreOpen(f) {
  // A server box hosts no sessions: never create, never open. This is the
  // second of §6.9's three guards, the one that covers a stale shim a re-role
  // left behind.
  if (f.role === 'server') return refuseStoreOpen('store-create-refused-role');
  // A dangling db/ link is a volume that is not there: never mkdir over it.
  if (f.dbDir === 'dangling') return refuseStoreOpen('store-root-dangling');
  if (f.dbDir === 'unmeasured' || f.db === 'unmeasured') return refuseStoreOpen('store-unmeasured');
  if (presenceUnreadable(f.storeId) || presenceUnreadable(f.pending) || presenceUnreadable(f.writer)) return refuseStoreOpen('store-unmeasured');
  if (f.db === 'present' && presenceUnreadable(f.dbStoreId)) return refuseStoreOpen('store-unmeasured');
  // Creation goes through a temp and link(), so a 0-byte history.db can only
  // mean truncation: never open it as a fresh store (DM16).
  if (f.db === 'zero-byte') return refuseStoreOpen('store-zero-byte');
  const inDb = f.db === 'present' ? presenceValue(f.dbStoreId) : null;
  if (f.db === 'present' && inDb === null) return refuseStoreOpen('store-schema-missing');
  const marker = presenceValue(f.storeId);
  if (marker !== null) {
    if (f.db === 'absent') return refuseStoreOpen('store-missing');
    return inDb === marker ? { act: 'open' } : refuseStoreOpen('store-mismatch');
  }
  if (f.db === 'present') {
    // This box's own interrupted creation, restore or rebuild: finish it.
    // Anything else is a store nobody bound here, which only the operator's
    // `doctor --adopt` may bind (S13).
    return presenceValue(f.pending) === inDb ? { act: 'finish-pending' } : refuseStoreOpen('store-unbound');
  }
  // Both absent: a first install, unless something says a store existed (S15).
  if (f.wal || f.shm) return refuseStoreOpen('store-wal-orphaned');
  if (f.journalStoreDirs.length > 0 || f.backupsDb.length > 0) return refuseStoreOpen('store-recoverable');
  if (f.pending.state === 'value') return { act: 'drop-pending-create' };
  return { act: 'create' };
}

function refuseCli(reason) {
  return { exit: REASONS[reason], reason, read: false };
}

/** §8.3's "Which no-store answer" table, row by row, before any DB open.
 *  The reachability stat runs after the Darwin and role rows and before the
 *  rest (§8.3), so a hung volume answers `store-unreachable` whatever else is
 *  on disk. Exits 6 and 9 carry no reason (one meaning each); exit 5 carries
 *  its `REASONS` word, and its code is read from `REASONS`, never retyped.
 *  D-4183 D-4187
 *  D-4169 */
export function decideCliStore(f) {
  if (f.darwin) return { exit: EXIT.NO_STORE, read: false };
  if (f.role === 'server') return { exit: EXIT.NO_STORE, read: false };
  if (!f.statSettled) return refuseCli('store-unreachable');
  if (f.dbDir === 'dangling') return refuseCli('store-root-dangling');
  if (f.dbDir === 'unmeasured' || f.shim === 'unmeasured' || f.db === 'unmeasured') return refuseCli('store-unmeasured');
  // §5.3's "Binding reads" row names store.writer beside store.id and the
  // pending marker: the sweep holds on it (decideStoreOpen), so the CLI must
  // not read past it as healthy.
  if (presenceUnreadable(f.storeId) || presenceUnreadable(f.pending) || presenceUnreadable(f.writer)) return refuseCli('store-unmeasured');
  if (f.db === 'present' && presenceUnreadable(f.dbStoreId)) return refuseCli('store-unmeasured');
  const marker = presenceValue(f.storeId);
  if (marker === null && f.db === 'absent') {
    if (f.shim === 'absent') return { exit: EXIT.NO_STORE, read: false };
    if (f.wal || f.shm) return refuseCli('store-wal-orphaned');
    if (f.journalStoreDirs.length > 0 || f.backupsDb.length > 0) return refuseCli('store-recoverable');
    return { exit: EXIT.NOT_INDEXED, read: false };
  }
  if (f.db === 'zero-byte') return refuseCli('store-zero-byte');
  if (f.db === 'absent') return refuseCli('store-missing');
  const inDb = presenceValue(f.dbStoreId);
  if (inDb === null) return refuseCli('store-schema-missing');
  if (marker === null) {
    // The writer finishes a matching pending marker on its next tick: "not yet".
    return presenceValue(f.pending) === inDb ? { exit: EXIT.NOT_INDEXED, read: false } : refuseCli('store-unbound');
  }
  return inDb === marker ? { exit: EXIT.OK, read: true } : refuseCli('store-mismatch');
}

/** D-4599 (HI2 H-162): the ONE rule for a stored user_version no build writes: the writer creates every store at 1 or more,
 *  so anything below 1, or no safe integer, is damage or tampering. The reader (decideStatusRead) answers it as
 *  store-schema-missing, the writer's open (sweep's openStore) refuses it with the same word, and planMigration throws on it,
 *  so a v0 store is never migrated from MIGRATIONS[0] (the V1 DDL, which no migration runs) over tables that exist. */
export function storeVersionDamaged(v) {
  return !Number.isSafeInteger(v) || v < 1;
}

/** The verdict on a store the CLI measured through its read-only handle: §8.3's
 *  `store-not-wal` refusal (exit 5, a store the writer could not put in WAL) and
 *  the migration word the envelope carries. `cli.mjs` reads `PRAGMA journal_mode`,
 *  `user_version` and meta's `migration` and delivers this answer; it decides
 *  neither (Task 28F, ring rule: delivery measures, lib decides). A stored
 *  version newer than this build's is `refuse-newer` whatever the sweep recorded;
 *  otherwise the sweep's recorded word stands when it is a MIGRATION_VERDICTS
 *  member, and anything else is `none`. A version below 1 is `store-schema-missing`
 *  (D-4599). The two answers are independent. */
export function decideStatusRead({ userVersion, journalMode, recordedMigration }) {
  const recorded = MIGRATION_VERDICTS.includes(recordedMigration) ? recordedMigration : 'none';
  const migration = userVersion > SCHEMA_VERSION ? 'refuse-newer' : recorded;
  // D-4599 (history-read-refuses-a-missing-schema): the writer creates every store at user_version 1 or more, so a bound
  // store at 0 or below (or one SQLite did not answer with an integer) is damage or tampering. It is the store-damage word,
  // not a pending migration that would name tables the reader has just read. The recorded verdict stays as the sweep
  // wrote it: the arm answers the damage, it does not rewrite what a pass recorded (HI2 H-162).
  if (storeVersionDamaged(userVersion)) return { exit: REASONS['store-schema-missing'], reason: 'store-schema-missing', migration: recorded };
  if (journalMode !== 'wal') return { exit: REASONS['store-not-wal'], reason: 'store-not-wal', migration };
  return { exit: EXIT.OK, migration };
}

/** §8.3 (review 316 F11; D-4171, D-4313): what `status` answers when its read of a store the binding read admitted
 *  throws. `storeWord` is a StoreError's word (the reader's open refused: the DB went missing, 0 bytes or unmeasured
 *  since it was measured), else null; `sqliteError` says SQLite raised it. Answers {exit: 5, reason}, or null for a
 *  throw that is neither — a defect the caller lets escape as exit 1. Three answers, never folded. */
export function decideStatusReadFailure({ storeWord, sqliteError }) {
  if (storeWord !== null && REASONS[storeWord] === EXIT.DB) return { exit: EXIT.DB, reason: storeWord };
  if (sqliteError) return { exit: REASONS['store-read-failed'], reason: 'store-read-failed' };
  return null;
}

/** The one size-aware copy preflight (§6.11): free space must EXCEED the
 *  threshold plus the copy's size, so a copy can never push live transcript
 *  appends below the floor. `doctor --backup`, the pre-migration snapshot,
 *  `doctor --restore` and each export segment all call this, so they cannot
 *  disagree about room. An input that is not a finite, non-negative number
 *  was not measured, and an unmeasured input never admits a copy.
 *  D-4182 */
export function planCopy({ freeBytes, thresholdBytes, sizeBytes }) {
  const measured = [freeBytes, thresholdBytes, sizeBytes].every((n) => Number.isFinite(n) && n >= 0);
  if (!measured) return { admit: false, needBytes: null };
  const needBytes = thresholdBytes + sizeBytes;
  return { admit: freeBytes > needBytes, needBytes };
}

/** §9.3's threshold: min(15 GiB, 10% of the filesystem's size) plus one run's
 *  byte budget — disk-hygiene's FAIL floor with one run of headroom.
 *  D-4179 */
export function floorThreshold(fsSizeBytes, runBudgetBytes = RUN_BUDGET_BYTES) {
  const pct = Math.floor((fsSizeBytes * FLOOR_PCT) / 100);
  return Math.min(FLOOR_GIB * PLANNER_GIB, pct) + runBudgetBytes;
}

/** The cap file's text (null when the file is absent) to a cap in GiB. A
 *  value that is not one positive integer uses the default and says so, so
 *  doctor can WARN naming the file (§9.3). D-4166 */
export function capOf(text) {
  if (text === null) return { gb: CAP_DEFAULT_GB, malformed: false };
  const m = /^\s*([1-9][0-9]*)\s*$/.exec(text);
  const gb = m ? Number(m[1]) : Number.NaN;
  return Number.isSafeInteger(gb) ? { gb, malformed: false } : { gb: CAP_DEFAULT_GB, malformed: true };
}

/** A cap in GiB as bytes, the unit the store's measured size is in. */
export function capBytes(gb) {
  return gb * PLANNER_GIB;
}

/** §6.11's verdict, an arm of the run plan. `boundS` is the pass's wall-clock
 *  bound — `CARRIER_KILL_S` for a scheduled pass, null for an `--op` pass,
 *  which runs under no carrier — so a scheduled pass never starts a copy its
 *  carrier would kill. `copyBps` is `meta.copy_bps`, null before the first
 *  measured copy. D-4182 D-4180 */
export function planMigration(i) {
  // An executor guard, not a verdict (HI2 H-162, D-4599): openStore refuses a damaged version before any plan is made.
  if (storeVersionDamaged(i.stored)) throw new TypeError(`planMigration: stored version ${i.stored} is below 1 or no integer`);
  if (i.stored === i.code) return 'none';
  if (i.stored > i.code) return 'refuse-newer';
  if (!planCopy({ freeBytes: i.freeBytes, thresholdBytes: i.thresholdBytes, sizeBytes: i.sizeBytes }).admit) return 'refuse-low-disk';
  if (i.boundS !== null) {
    if (i.attempts >= MAX_INTERRUPTED_ATTEMPTS) return 'snapshot-needs-op';
    const rate = Number.isFinite(i.copyBps) && i.copyBps > 0 ? i.copyBps : DEFAULT_COPY_BPS;
    const estimateS = (i.sizeBytes * (i.heavy ? 2 : 1)) / rate;
    if (estimateS > i.boundS / 2) return 'snapshot-needs-op';
  }
  return 'snapshot-then-migrate';
}

/** One wall-clock and byte budget per run, never reset per file (§9.2 step 7). */
export function withinBudget({ elapsedMs, bytes, maxMs = RUN_BUDGET_MS, maxBytes = RUN_BUDGET_BYTES }) {
  return elapsedMs < maxMs && bytes < maxBytes;
}

function haltRun(arm, holdWord) {
  return { arm, holdWord, drain: false, ingest: false, pause: null };
}

/** The run plan (§9.2, §9.3, §6.11). The asymmetry is the point (O56): a HOLD
 *  (the store cannot be opened or written, or a migration or recovery owns the
 *  tick) stops the drain too, and only the journal half runs; a PAUSE (the cap,
 *  the floor) stops only ingest, so the drain and its epoch confirmations stay
 *  timely. `migration` is the caller's `planMigration` verdict, `'none'` for a
 *  store about to be created. A statfs that THREW pauses as `low-disk`, not as
 *  a word of its own: §9.10's failure table gives "Free space | below the
 *  floor, or `statfs` throws" one row and one direction (capture pauses,
 *  doctor FAIL); only a probe that does not settle is a hold. A recovery step
 *  below the floor pauses exactly as ingest does (§9.3): it stays on the
 *  recover arm, still holding the drain, and says the floor holds it, so B2's
 *  step counts `capture_paused_low_disk` and never `recovery-stalled`.
 *  The hold order is off, then a statfs that never settled, then a store
 *  refusal: the probe pauses capture BEFORE the DB is opened (§5.3, §9.3), and
 *  a store verdict's facts (lstat and reads under db/) cannot be measured on a
 *  mount whose statfs never settled. Today L4 decides the off, store-refusal
 *  and refuse-newer-by-store arms itself, in this same order (the sweep's
 *  scheduledPass holds off, role, the probe, then openStore) and passes
 *  `historyOff:false, store:{act:'open'}, recovering:false` here, so this
 *  function carries the migration verdict arms and the importRoom probe hold
 *  live and the others as the order B2's recovery arm must keep.
 *  D-4187 D-4179
 *  D-4182 */
export function planRun(i) {
  if (i.historyOff) return haltRun('off', null);
  if (i.free.state === 'unsettled') return haltRun('hold', 'store-unreachable');
  if (i.store.act === 'refuse') return haltRun('hold', i.store.word);
  if (!MIGRATION_VERDICTS.includes(i.migration)) throw new TypeError(`planRun: migration verdict outside MIGRATION_VERDICTS: ${String(i.migration)}`);
  if (i.migration === 'refuse-newer') return haltRun('hold', 'schema-newer');
  if (i.migration === 'refuse-low-disk') return haltRun('hold', 'migration-refused');
  if (i.migration === 'snapshot-needs-op') return haltRun('hold', 'migration-needs-op');
  if (i.migration === 'snapshot-then-migrate') return haltRun('migrate', null);
  const lowDisk = i.free.state === 'threw' || i.free.bytes < floorThreshold(i.free.fsSize);
  if (i.recovering) return { ...haltRun('recover', null), pause: lowDisk ? 'low-disk' : null };
  let pause = null;
  if (i.sizeBytes >= capBytes(i.capGb)) pause = 'at-cap';
  else if (lowDisk) pause = 'low-disk';
  return { arm: 'run', holdWord: null, drain: true, ingest: pause === null, pause };
}

/** The file planner (§9.2 step 3): resume only with proof that the cursor row
 *  and the file on disk are one file. Identity first — the path's uuid, then
 *  the birth time where the filesystem reports one on both sides, else the
 *  first line's sha — and only then the size and the tail sha. A mismatch of
 *  identity means the inode was freed and reused: the row is RETIRED, never
 *  rescanned onto (DM45). Birth times are compared as BigInt, because a
 *  nanosecond epoch is past 2^53 and two Numbers may round to one.
 *  D-4178 */
export function planFileRead({ row, stat, pathUuid, headSha, tailShaAtOffset }) {
  if (stat === null) return 'skip';
  if (row === null) return 'rescan';
  if (pathUuid !== row.transcriptUuid) return 'retire';
  const births = row.birthNs != null && stat.birthNs != null;
  if (births && BigInt(row.birthNs) !== BigInt(stat.birthNs)) return 'retire';
  if (!births && row.headSha !== null && headSha !== null && row.headSha !== headSha) return 'retire';
  if (stat.size < row.offset) return 'rescan';
  if (tailShaAtOffset !== row.tailSha) return 'rescan';
  return 'resume';
}

/** What `formOf` answers for an `--op` verb the sweep does not know. It is
 *  never a `WRITING_FORMS` key, so `decideOpGate` refuses it `bad-args`; it is
 *  never null, which means a dry run (no overloaded null at a seam). */
export const UNKNOWN_OP_FORM = 'unknown-op';

/** An `--op` verb and its arguments to its `WRITING_FORMS` key, or null for a
 *  dry run (§8.4: dry run by default). `import --session <id> --file <path>
 *  --apply` is its own, irreversible form (rev 3.2 review, SE7). */
export function formOf(op, args) {
  const has = (flag) => args.includes(flag);
  switch (op) {
    case 'import':
      if (!has('--apply')) return null;
      return has('--session') || has('--file') ? 'import-session-apply' : 'import-apply';
    case 'prune':
      return has('--apply') ? 'prune-apply' : null;
    case 'reparse':
      return has('--apply') ? 'reparse-apply' : null;
    case 'recall-off':
      return has('--clear-all') ? 'recall-off-clear-all' : 'recall-off';
    case 'repair': case 'backup': case 'migrate': case 'adopt': case 'restore': case 'rebuild':
      return op;
    default:
      return UNKNOWN_OP_FORM;
  }
}

/** RB6 with RB12-RB14 (W1-B2): whether a writing form still runs while a ('recover', ms) step is registered. Every
 *  other form is refused `recovering` by decideOpGate's row below. D-4698 (history-ops-refused-while-recovering)
 *  - restore and rebuild replace the step (RB6);
 *  - W2's recall-off forms move no cursor: a privacy switch (RB12);
 *  - migrate, only while the stored user_version is a measured value other than the code's (RB13): a restored older
 *    backup migrates first, or it would wait on its own step, which runs only at the code's version;
 *  - adopt, only on an unbound store, store.id absent (RB14): no pass opens such a store until it is bound.
 *  The facts are measured by Task 19's two halves. One that was not measured never exempts (IV5): an absent or
 *  unreadable version, no code version, or a store.id that is unreadable rather than absent keeps the refusal. */
function recoveryExempt(op, env) {
  switch (op) {
    case 'restore': case 'rebuild': return true;
    case 'recall-off': return true;
    case 'migrate':
      return Number.isSafeInteger(env.codeVersion) && env.storedVersion?.state === 'value'
        && env.storedVersion.value !== env.codeVersion;
    case 'adopt': return env.storeId?.state === 'absent';
    default: return false;
  }
}

function refuseGate(reason) {
  return { ok: false, rc: EXIT.REFUSED, reason };
}

/** The speed bumps, decided once and executed twice: the CLI runs this before
 *  it spawns the shim, and the sweep's `--op` dispatch runs it again from its
 *  own `CLAUDECODE`, `isatty(0)` and bounded tmux read (§8.4). Speed bumps,
 *  not walls: `env -u CLAUDECODE` defeats the first. A dry run (null) passes
 *  every bump; the three binding verbs alone pass under `history-off`, which
 *  is how the operator holds capture while recovering.
 *  D-4181 */
export function decideOpGate(form, env, isTTY, paneName) {
  if (form === null) return { ok: true };
  if (!Object.hasOwn(WRITING_FORMS, form)) return refuseGate('bad-args');
  const f = WRITING_FORMS[form];
  if (env.claudecode) return refuseGate('apply-in-session');
  if (f.irreversible && !isTTY) return refuseGate('needs-tty');
  if (f.irreversible && typeof paneName === 'string' && paneName.startsWith('cc-')) return refuseGate('irreversible-in-pane');
  if (env.historyOff && !f.binding) return refuseGate('history-off');
  // RB6 (W1-B2): while a ('recover', ms) step is registered, a writing form is refused unless recoveryExempt (above)
  // exempts it: restore and rebuild (RB6), W2's recall-off forms (RB12), migrate on a store whose version is not the
  // code's (RB13), adopt on an unbound store (RB14). Task 19 measures `recovering` and those facts read-only in both
  // halves: the CLI's pre-check spawns nothing, and the sweep's is authoritative.
  // D-4698 (history-ops-refused-while-recovering)
  if (env.recovering === true && !recoveryExempt(f.op, env)) return refuseGate('recovering');
  return { ok: true };
}

// ===========================================================================
// Epochs and families (spec §6.1, §9.2 step 1, §9.14 Holds). These are the
// ONE implementation of the confirmation rules: the drain calls them, and
// replay (B2) calls the same functions, so a recovered store decides exactly
// as the live one did. None reads $REG. The registry facts arrive as the
// observation the sweep wrote beside a draining file at its rename (§9.2).
// ===========================================================================

/** The generation a line joins (§6.1). A line's own `gen` wins. A gen-less
 *  line of any kind joins the generation the observation read from
 *  `$REG/<id>.generation`; only when the registry has none does it join the
 *  legacy `''` family (`family_gen_absent`). A generation the observation
 *  could not read, or read in a shape that is not a uuid, is UNREADABLE and
 *  joins `''` too, counted apart (`family_gen_unreadable`), never folded into
 *  absent (rev 3.2 review, IV5). D-4193
 *  D-4192 */
export function joinGeneration({ lineGen, observedGen }) {
  if (typeof lineGen === 'string' && UUID_RE.test(lineGen)) return { generation: lineGen, via: 'line' };
  if (observedGen.state === 'absent') return { generation: '', via: 'absent' };
  if (observedGen.state === 'value' && UUID_RE.test(observedGen.value)) return { generation: observedGen.value, via: 'registry' };
  return { generation: '', via: 'unreadable' };
}

/** Whether `o` is an observation sidecar as `observe` writes it (D-4347 (history-planted-entries-never-wedge)): the WHOLE grammar, so every reader
 *  (`readSidecar`, status) judges a sidecar by one predicate and no caller dereferences a missing field.
 *  - `v` is 1 and `observedMs` a non-negative safe integer;
 *  - `uuid`, `generation`, `project` and `workdir` are Presences, `value` carrying a string;
 *  - `late` is null or a re-read (`observedMs` and the four presences), `journalT` null or a non-negative safe integer;
 *  - `journaled` is null or `{t, bytes, storeId, writer}` on their grammars, `heldMatches` an object of non-negative safe integers.
 *  Unknown extra keys are allowed, so a later build's sidecar stays readable. Pure. */
export function observationOk(o) {
  const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const nat = (x) => Number.isSafeInteger(x) && x >= 0;
  const presence = (x) => obj(x) && (x.state === 'absent' || x.state === 'unreadable' || (x.state === 'value' && typeof x.value === 'string'));
  const four = (x) => presence(x.uuid) && presence(x.generation) && presence(x.project) && presence(x.workdir);
  if (!obj(o) || o.v !== 1 || !nat(o.observedMs) || !four(o)) return false;
  if (o.late !== null && !(obj(o.late) && nat(o.late.observedMs) && four(o.late))) return false;
  if (o.journalT !== null && !nat(o.journalT)) return false;
  if (o.journaled !== null) {
    const j = o.journaled;
    if (!(obj(j) && nat(j.t) && nat(j.bytes) && typeof j.storeId === 'string' && UUID_RE.test(j.storeId)
      && typeof j.writer === 'string' && WRITER_RE.test(j.writer))) return false;
  }
  return obj(o.heldMatches) && Object.values(o.heldMatches).every(nat);
}

/** What the drain does with one epoch line (§6.1, §9.2 step 1).
 *  - startup/resume, and fork from W1-B2 (D-4734 (history-fork-spooled)): confirmed on its own evidence first — its `reg` equals
 *    its `sid` (CT6: ccd writes `.uuid` before it spawns, so every ccd start
 *    carries it) — else the `.uuid` observed at the rename, else the first
 *    match recorded while held; otherwise it waits as a candidate. A nested
 *    `claude -p` books its own sid beside the pane's `reg`, so it never
 *    confirms here.
 *  - clear: chained at drain in line order, confirmed when the observation
 *    or a held match names its sid, else chained UNCONFIRMED (out of every
 *    scope until a later tick or the location rule confirms it, SE5).
 *  D-4190 D-4189
 *  D-4175 */
export function decideEpochLine(line, obs) {
  const observed = obs.uuid.state === 'value' && obs.uuid.value === line.sid;
  const held = Object.hasOwn(obs.heldMatches, line.sid);
  if (line.src === 'clear') {
    return { kind: 'chain', confirmedBy: observed ? 'observed' : held ? 'held-match' : null };
  }
  if (line.src !== 'startup' && line.src !== 'resume' && line.src !== 'fork') {
    throw new TypeError(`decideEpochLine: src outside SPOOL_SOURCES: ${String(line.src)}`);
  }
  if (typeof line.reg === 'string' && line.reg === line.sid) return { kind: 'confirm', by: 'reg' };
  if (observed) return { kind: 'confirm', by: 'observed' };
  if (held) return { kind: 'confirm', by: 'held-match' };
  return { kind: 'candidate' };
}

/** A waiting candidate at a later tick (§6.1): confirmed when `.uuid` names
 *  its sid within `EPOCH_CONFIRM_WINDOW_MS` of the line's journaling, dropped
 *  after it (`epoch_unconfirmed`, or `epoch_unconfirmed_superseded` when
 *  `.uuid` AT THE DROP names ANY clear epoch of the same id, §14 risk 24; not
 *  only a later clear line's sid, since the v1 `epoch_candidates` row keeps no
 *  observation and no line order, D-4190). The parameter keeps its older name
 *  `supersededByLaterClearOfSameId`: every caller passes it by name. An
 *  unreadable `.uuid` neither confirms nor drops early. D-4190 */
export function decideCandidate({ sid, journaledMs, nowMs, currentUuid, supersededByLaterClearOfSameId }) {
  if (nowMs - journaledMs > EPOCH_CONFIRM_WINDOW_MS) return { kind: 'drop', superseded: supersededByLaterClearOfSameId === true };
  if (currentUuid.state === 'value' && currentUuid.value === sid) return { kind: 'confirm', by: 'later-tick' };
  return { kind: 'wait' };
}

/** §6.1's location rule for a clear epoch `.uuid` no longer names (two quick
 *  `/clear`s): its transcript's first uuid row's `cwd` against `.workdir` as
 *  the caller read it (observed at drain; the registry's at a later tick,
 *  D-4189). Realpaths decide when both resolved; verbatim strings decide
 *  when either no longer resolves. An absent or unreadable `.workdir`, or a
 *  row with no `cwd`, never confirms. D-4189
 *  D-4191 */
export function locationMatches({ cwd, cwdReal, workdir, workdirReal }) {
  if (workdir.state !== 'value' || typeof cwd !== 'string' || cwd === '') return false;
  if (typeof cwdReal === 'string' && typeof workdirReal === 'string') return cwdReal === workdirReal;
  return cwd === workdir.value;
}

/** Re-keying is a MERGE (§6.1, DI4): when a generation reads for an id whose
 *  `''` family holds a confirmed uuid of the same row-life, that family merges
 *  into (id, G). A generation is minted only on absence, so the shared uuid
 *  proves one row-life. The executor (the drain) moves the epochs and keeps
 *  `merged_into`; this only decides. D-4194 */
export function decideRekey({ observedGeneration, uuid, emptyFamilyUuids }) {
  return UUID_RE.test(observedGeneration) && emptyFamilyUuids.has(uuid) ? 'merge' : 'none';
}

// ===========================================================================
// Row extraction (spec §2, §6.1, §6.2). Pure functions over ONE parsed
// transcript row. The sweep (L4) reads and parses lines, asks
// `isBoundaryLine` from ../compact-card.mjs (which only L4 files import, so
// this file stays `node:crypto`-only) and hands the results in.
// ===========================================================================

function rowObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function rowString(v) {
  return typeof v === 'string' ? v : null;
}
/** The last instant a JS Date holds, in ms: the top of the window a row's timestamp may be stored in. */
const ROW_TS_MAX_MS = 8.64e15;

/** A row's `timestamp` (ISO-8601 in every row Claude Code writes) as epoch
 *  ms; null when absent, unparseable or outside 0 <= ms <= ROW_TS_MAX_MS, never 0 and never "now". A number
 *  is truncated to whole ms first.
 *  D-4341 (history-row-ts-safe-range): the window is the one place a row's time is made a stored integer. A numeric
 *  `timestamp` of 1e17 or -2^60 used to pass (any finite number did) and was bound as a double, which SQLite's INTEGER
 *  affinity stores past 2^53, and node:sqlite cannot read such an integer back: every plain read of it throws, so
 *  the census, `min(ts_ms)` and `status` failed every pass for good. A value outside the window is "no timestamp". */
function rowTsMs(v) {
  let ms;
  if (typeof v === 'number') ms = Math.trunc(v);
  else if (typeof v === 'string') ms = Date.parse(v);
  else return null;
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= ROW_TS_MAX_MS ? ms + 0 : null;   // + 0: a truncated -0.5 is 0, never -0
}

/** G13: a row with no uuid is metadata (33.5-36% of rows), and some such rows
 *  (`bridge-session`) carry account and organisation identifiers, so it is
 *  counted by type and never stored. D-4199 */
export function isStoredRow(row) {
  const o = rowObject(row);
  return o !== null && typeof o.uuid === 'string' && o.uuid !== '';
}

/** The `<type>` of an unstored row's counter (`uuidless:<type>`). A type that
 *  is not a short identifier counts as `unknown`, so a garbled or hostile row
 *  can never mint an arbitrary counter name. */
export function uuidlessTypeOf(row) {
  const t = rowObject(row)?.type;
  return typeof t === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(t) ? t : 'unknown';
}

const DROPPED_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);

/** What a blob holds (§6.2), one rule per row type: user and assistant rows
 *  their `message.content` with thinking blocks removed (decision: thinking
 *  is not stored, §2); system rows their `content`; attachment rows their
 *  `attachment` object; any other type its `content`. Sidecars are file
 *  bytes and never come through here. */
export function blobBodyOf(row) {
  if (row.type === 'user' || row.type === 'assistant') {
    const c = rowObject(row.message)?.content;
    if (Array.isArray(c)) return c.filter((b) => !(rowObject(b) !== null && DROPPED_BLOCK_TYPES.has(b.type)));
    return c === undefined ? null : c;
  }
  if (row.type === 'attachment') return row.attachment === undefined ? null : row.attachment;
  return row.content === undefined ? null : row.content;
}

/** The named structure columns of one stored row (§6.2 `entries`). `model` is
 *  an assistant row's `message.model` verbatim, NULL on every other row
 *  (RG9); the backend is derived at read time by `backendOf`, never stored.
 *  `apiBlockIndex` is not in the row: the sweep passes the row's 0-based
 *  ordinal among the rows of its `requestId` in the file it is reading.
 *  D-4198 */
export function entryOf(row, ctx = {}) {
  const msg = rowObject(row.message);
  const type = typeof row.type === 'string' ? row.type : 'unknown';
  let toolName = null;
  if (type === 'assistant' && Array.isArray(msg?.content)) {
    const use = msg.content.find((b) => rowObject(b) !== null && b.type === 'tool_use' && typeof b.name === 'string');
    if (use !== undefined) toolName = use.name;
  }
  return {
    uuid: row.uuid,
    type,
    subtype: rowString(row.subtype),
    role: rowString(msg?.role),
    model: type === 'assistant' ? rowString(msg?.model) : null,
    parentUuid: rowString(row.parentUuid),
    tsMs: rowTsMs(row.timestamp),
    requestId: rowString(row.requestId),
    apiBlockIndex: Number.isSafeInteger(ctx.apiBlockIndex) ? ctx.apiBlockIndex : null,
    msgId: rowString(msg?.id),
    sourceToolUseId: rowString(row.sourceToolUseID),
    toolName,
    isCompactSummary: row.isCompactSummary === true ? 1 : 0,
  };
}

/** A compact_boundary row's metadata (§6.1 span rule, §6.2 `boundaries`), read
 *  from `compactMetadata.{trigger, preTokens, postTokens, durationMs}`,
 *  `.preservedSegment.{headUuid, anchorUuid, tailUuid}` and
 *  `.preservedMessages.allUuids`. A field that is absent or of the wrong
 *  shape is NULL and named in `missing` (the sweep counts
 *  `boundary_field_missing`), never a throw: the format is Claude Code's,
 *  undocumented, and has varied by version. Null when the row is not a
 *  boundary by structure. */
export function boundaryOf(row) {
  const o = rowObject(row);
  if (o === null || o.type !== 'system' || o.subtype !== 'compact_boundary') return null;
  const meta = rowObject(o.compactMetadata);
  const seg = rowObject(meta?.preservedSegment);
  const kept = rowObject(meta?.preservedMessages);
  const missing = [];
  const take = (name, v, ok) => {
    if (ok(v)) return v;
    missing.push(name);
    return null;
  };
  const isText = (v) => typeof v === 'string' && v !== '';
  const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
  const all = kept?.allUuids;
  const allUuids = Array.isArray(all) && all.every(isText) ? all : null;
  if (allUuids === null) missing.push('allUuids');
  return {
    trigger: take('trigger', meta?.trigger, isText),
    headUuid: take('headUuid', seg?.headUuid, isText),
    anchorUuid: take('anchorUuid', seg?.anchorUuid, isText),
    tailUuid: take('tailUuid', seg?.tailUuid, isText),
    allUuids,
    preTokens: take('preTokens', meta?.preTokens, isCount),
    postTokens: take('postTokens', meta?.postTokens, isCount),
    durationMs: take('durationMs', meta?.durationMs, isCount),
    missing,
  };
}

/** Is this Bash command a recall: its first word `ccrc` or a path ending in
 *  `/ccrc` (one pair of surrounding quotes stripped), and its second word
 *  `history`? Structure only (§6.2): never a sentinel in any body. The first
 *  two words come from one anchored match, never a split of the whole command:
 *  an 8-million-word command split held about 273 MiB to read two words
 *  (review 316 F7). */
export function isHistoryCommand(command) {
  const m = /^\s*(\S+)\s+(\S+)/.exec(command);
  if (m === null) return false;
  const first = m[1].replace(/^(["'])(.*)\1$/, '$2');
  return (first === 'ccrc' || first.endsWith('/ccrc')) && m[2] === 'history';
}

/** The text a user row's content begins with: the string itself, or its
 *  first text block's text. */
function leadText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const t = content.find((b) => rowObject(b) !== null && b.type === 'text' && typeof b.text === 'string');
  return t === undefined ? '' : t.text;
}

/** Provenance from structured fields, never from text (§6.2). Assistant rows
 *  are `model`; a summary row is `summary`; a tool's result is `tool`, or
 *  `recall-echo` when its paired `tool_use` is a Bash `ccrc history` command;
 *  typed user text is `operator`. Everything else — attachments, system rows,
 *  the G16 `<local-command-stdout>` echo, user rows Claude Code marks
 *  `isMeta` (injected, not typed: plan-chosen), unknown types — is `harness`.
 *  `ccrc-injected` is not produced by B1's ingest; it is excluded from
 *  default search exactly as `harness` is. The caller pairs a `tool_result`
 *  with its `tool_use` and passes `{name, command}`.
 *  D-4197 */
export function provenanceOf(row, ctx) {
  if (row.type === 'assistant') return 'model';
  if (row.type !== 'user') return 'harness';
  if (row.isCompactSummary === true) return 'summary';
  const content = rowObject(row.message)?.content;
  if (leadText(content).trimStart().startsWith('<local-command-stdout>')) return 'harness';
  if (row.isMeta === true) return 'harness';
  if (Array.isArray(content) && content.some((b) => rowObject(b) !== null && b.type === 'tool_result')) {
    const p = ctx.pairedToolUse;
    return p !== null && p.name === 'Bash' && typeof p.command === 'string' && isHistoryCommand(p.command) ? 'recall-echo' : 'tool';
  }
  return 'operator';
}

/** Every string leaf of a value, depth-first in key order, with an explicit
 *  stack: a tool input is the model's JSON, and its depth is not ours to
 *  bound by recursion. */
function stringLeaves(value, out) {
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
    else if (rowObject(v) !== null) {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i -= 1) stack.push(v[keys[i]]);
    }
  }
}

/** The FTS body: extracted plain text, never the JSON (RV3). Text blocks,
 *  the string leaves of `tool_use.input`, the text of `tool_result` content
 *  and `system` content, joined with `\n`; a sidecar's is `sidecarIndexText`'s
 *  cut, unredacted here. Redaction is the caller's next step, `redactForIndex` (§6.2: the index
 *  sees redacted text only; a sidecar's caller uses `sidecarIndexText` with
 *  its pair index, which redacts BEFORE the cut).
 *  D-4195 */
export function ftsTextOf(body, kind) {
  if (kind === 'sidecar') return sidecarIndexText(body instanceof Uint8Array ? body : new Uint8Array(0), null);
  const parts = [];
  if (typeof body === 'string') parts.push(body);
  else if (Array.isArray(body)) {
    for (const b of body) {
      if (typeof b === 'string') { parts.push(b); continue; }
      const o = rowObject(b);
      if (o === null) continue;
      if (o.type === 'text' && typeof o.text === 'string') parts.push(o.text);
      else if (o.type === 'tool_use') stringLeaves(o.input, parts);
      else if (o.type === 'tool_result') {
        if (typeof o.content === 'string') parts.push(o.content);
        else if (Array.isArray(o.content)) {
          for (const x of o.content) if (rowObject(x) !== null && x.type === 'text' && typeof x.text === 'string') parts.push(x.text);
        }
      }
    }
  }
  return parts.join('\n');
}

/** Is this pair of text blocks ccd's `_sanitize_anthropic` shape: the same
 *  block but for `text`, one side empty or whitespace (or missing) and the
 *  other exactly `...`? */
function sanitizedPair(a, b) {
  const x = rowObject(a);
  const y = rowObject(b);
  if (x === null || y === null || x.type !== 'text' || y.type !== 'text') return false;
  const blank = (t) => t === undefined || (typeof t === 'string' && t.trim() === '');
  const shapeMatches = (blank(x.text) && y.text === '...') || (blank(y.text) && x.text === '...');
  if (!shapeMatches) return false;
  const { text: _xText, ...xr } = x;
  const { text: _yText, ...yr } = y;
  return canonicalJson(xr) === canonicalJson(yr);
}

/** The cause of a variant (§6.1): `ccd-sanitize` when the two bodies differ
 *  only in text blocks ccd's sanitiser fills with `...` on a gateway to
 *  Anthropic carry (9,791 of 510,153 shared rows, every one that shape, M);
 *  `unknown` otherwise. D-4200 */
export function variantCauseOf(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 'unknown';
  let sanitized = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (canonicalJson(a[i]) === canonicalJson(b[i])) continue;
    if (!sanitizedPair(a[i], b[i])) return 'unknown';
    sanitized += 1;
  }
  return sanitized > 0 ? 'ccd-sanitize' : 'unknown';
}

/** A row's backend, from its model name alone (§6.2, `BACKENDS`). A name
 *  starting `claude` is `anthropic`; NULL, empty, or angle-bracketed
 *  (`<synthetic>`: Claude Code's own notices, no backend's output) is
 *  `unknown`; any other name is `other`. Nothing is read from the roster.
 *  D-4196 */
export function backendOf(model) {
  if (typeof model !== 'string' || model === '') return 'unknown';
  if (model.startsWith('<') && model.endsWith('>')) return 'unknown';
  return model.startsWith('claude') ? 'anthropic' : 'other';
}

/** The producer of a boundary (§6.2): the backend of the first assistant row
 *  AFTER its summary row, in the copy that holds it, whose backend is not
 *  `unknown`. A swap landing compacts on the TARGET backend, so the last row
 *  before the boundary is the wrong witness. D-4196 */
export function producerOf(modelsAfterSummary) {
  for (const m of modelsAfterSummary) {
    const b = backendOf(m);
    if (b !== 'unknown') return b;
  }
  return 'unknown';
}

/** `producerOf` over a copy's rows in file order, given the summary row's
 *  index: only assistant rows after it are witnesses. */
export function producerOfCopy(rows, summaryIndex) {
  const after = [];
  for (let i = summaryIndex + 1; i < rows.length; i += 1) if (rows[i].type === 'assistant') after.push(rows[i].model);
  return producerOf(after);
}

// ===========================================================================
// Redaction (spec §8.3 Redaction, §6.2 "the body is redacted before
// indexing"). Three layers — values, context, shapes — in one function the
// FTS index (B1), the regex worker and every CLI field (B2) all call. Only
// (length, sha256) pairs are ever kept: a value is hashed and dropped, never
// stored, journaled or logged. D-4203
// ===========================================================================

/** ccrc's own secret-bearing files, HOME-relative: the frozen half of the
 *  value layer's sources. The other half, every account's declared
 *  `exec.secretsFile`, arrives at runtime from the roster (the shim's
 *  `--secrets`), so no account list is in source. `exec.authDir` is never
 *  named: nothing in ccrc opens it.
 *  D-4205 D-4201 */
export const SECRET_SOURCES = Object.freeze([
  Object.freeze({ glob: '.cc-secrets/*' }),
  Object.freeze({ glob: '.ccrc/*.token' }),
  Object.freeze({ path: '.ccrc/exposure.env' }),
  Object.freeze({ glob: '.ccrc/codex/*/runtime.env' }),
  Object.freeze({ path: '.ccrc/ccrc.env', identifierKeysOnly: true }),
  Object.freeze({ path: '.ccrc/agent.env', identifierKeysOnly: true }),
  Object.freeze({ path: '.ccrc/sessions.json', sessionHashes: true }),
]);

/** A secret file's kind by its name: `*.token` its value lines (D-4587: after
 *  dropping blank and `#` lines, (a) the first remaining line with all whitespace
 *  removed and (b) the remaining lines joined and trimmed, when that differs from
 *  (a), so a value spanning two lines learns two values), `*.json`
 *  its string leaves, anything else (`*.env`, a declared `secretsFile`, which
 *  its wrapper sources as bash) an env file. */
export function kindOfPath(p) {
  if (p.endsWith('.token')) return 'token';
  if (p.endsWith('.json')) return 'json';
  return 'env';
}

/** The identifier-name pattern of the context layer and of the env files read
 *  for identifier keys only (upstream `PROMPT_RECALL_SENSITIVE_IDENTIFIER_PATTERN`, :23).
 *  derived from lossless-claw src/prompt-recall.ts @ e05d8d3, MIT, see LICENSE.lossless-claw */
export const IDENTIFIER_RE = /(?:^|[^A-Za-z0-9])(?:ACCESS_?KEY|API_?KEY|AUTH|CREDENTIALS?|DEPLOY_?KEY|KEY|PASS(?:WORD)?|PRIVATE_?KEY|SECRET|TOKEN)(?=$|[^A-Za-z0-9])/i;

/** The one name the env-identifier filter loads beyond `IDENTIFIER_RE`: the
 *  whole word `PRIVATE`. A `both` box's `ccrc.env` carries
 *  `CCRC_VAPID_PRIVATE`, the web-push private key (`ccd/ccrc:1343-1346`),
 *  which upstream's `PRIVATE_?KEY` never matches. Not upstream, and not used
 *  by the context layer. D-4204 */
const ENV_SECRET_NAME_RE = /(?:^|[^A-Za-z0-9])PRIVATE(?=$|[^A-Za-z0-9])/i;

/** The shape layer (upstream `PROMPT_RECALL_SENSITIVE_VALUE_PATTERN`, :26-27).
 *  derived from lossless-claw src/prompt-recall.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
 *  Upstream's one detection pattern split into its arms and made global for replacement, both the `-` and `_`
 *  arms of sk|rk|pk kept; the PEM arm widened from the header line to the
 *  whole block (a header alone would leave the key printed). This list holds
 *  upstream's arms only, every one a plain regex and linear-time on any input
 *  (audited, D-4306). The JWT shape `eyJ….….…` (not upstream) is NOT in it:
 *  as a regex it backtracks quadratically on a long run of dotless `eyJ`
 *  starts, so the linear `jwtSpans` finds the same matches by a scan
 *  and `redactLayers` unions its spans with this list's. D-4306 (history-redaction-shapes-linear) */
export const SECRET_SHAPE_RES = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{10,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{10,}\b/gi,
  /\b(?:sk|rk|pk)_[A-Za-z0-9_]{10,}\b/gi,
]);

/** What replaces a secret. It holds no `"`, `\`, `<`, `>` or `&`, so a
 *  `--json` string stays valid and the recall envelope's escaping is not
 *  disturbed (§8.3). */
export const REDACTED_MARK = '[redacted]';

const ENV_LINE_RE = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** One env line's value, as bash would read a simple assignment: one pair of
 *  matching quotes stripped, else the word up to the first whitespace (which
 *  drops a trailing `# comment`). */
function envValue(raw) {
  const v = raw.trim();
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) return v.slice(1, -1);
  return v.split(/\s/)[0];
}

/** The values a secret file holds, by kind (§8.3 "What a value is"): an env
 *  file yields each `[export ]NAME=value` line's VALUE, never its name, so a
 *  23-char key name is never redacted; `env-identifier` yields only values
 *  whose NAME matches `IDENTIFIER_RE` or `ENV_SECRET_NAME_RE` (`ccrc.env`,
 *  `agent.env`); a token file the value line with its whitespace removed (a) and, when it differs, the
 *  remaining lines joined (b) (whole blank and `#` lines dropped; D-4587
 *  (history-token-file-comments-not-values)); a JSON file its
 *  string leaves. D-4206
 *  D-4204 */
export function extractSecretValues(text, kind) {
  if (kind === 'token') {
    // D-4587 (history-token-file-comments-not-values): a token file's blank
    // and `#` lines are not values (ccrc's own box-token file is a `#`
    // preamble above one value line). The values are the first remaining
    // line with all whitespace removed (`server/src/coord/token.ts`
    // `extractToken`'s rule) and, when it differs, the remaining lines joined
    // and trimmed. No remaining line yields none.
    const kept = [];
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (t !== '' && !t.startsWith('#')) kept.push(raw);
    }
    if (kept.length === 0) return [];
    const first = kept[0].trim().replace(/\s+/g, '');
    const joined = kept.join('\n').trim();
    return joined === first ? [first] : [first, joined];
  }
  if (kind === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const out = [];
    const stack = [parsed];
    while (stack.length > 0) {
      const v = stack.pop();
      if (typeof v === 'string') { if (v !== '') out.push(v); }
      // One at a time, never `push(...v)`: a spread of a 200,000-element array
      // overflows the call stack (RangeError), and a secrets file may hold one.
      else if (Array.isArray(v)) for (let i = 0; i < v.length; i += 1) stack.push(v[i]);
      else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) stack.push(x);
    }
    return out;
  }
  const out = [];
  for (const line of text.split('\n')) {
    // A blank line or a `#` comment never matches ENV_LINE_RE, which is
    // anchored on a NAME at the line's start.
    const t = line.replace(/\r$/, '').trimStart();
    const m = ENV_LINE_RE.exec(t);
    if (m === null) continue;
    if (kind === 'env-identifier' && !IDENTIFIER_RE.test(m[1]) && !ENV_SECRET_NAME_RE.test(m[1])) continue;
    const v = envValue(m[2]);
    if (v !== '') out.push(v);
  }
  return out;
}

/** Values to (length, sha256) pairs (§8.3). Only values of `SECRET_MIN_LEN`
 *  chars or more load. A value that is one `[A-Za-z0-9_-]+` run is one pair;
 *  any other value can never be one run, so each of its runs of
 *  `SECRET_SEGMENT_MIN` chars or more is a pair of its own (72 bits and up,
 *  so a digest is no offline oracle), and a value with none counts
 *  `unsegmentable`. D-4206 */
export function secretPairs(values) {
  const seen = new Map();
  let unsegmentable = 0;
  const add = (s) => {
    const key = `${s.length}:${sha256Hex(s)}`;
    if (!seen.has(key)) seen.set(key, { len: s.length, sha256: sha256Hex(s) });
  };
  for (const v of values) {
    if (v.length < SECRET_MIN_LEN) continue;
    const units = secretUnits(v);
    if (units.length === 0) { unsegmentable += 1; continue; }
    for (const s of units) add(s);
  }
  return { pairs: [...seen.values()], unsegmentable };
}

/** The texts `secretPairs` registers a pair for, for one value: the value itself when it is one
 *  `[A-Za-z0-9_-]+` run, else each of its runs of `SECRET_SEGMENT_MIN` chars or more. Empty for a
 *  value under `SECRET_MIN_LEN`, or one with no such run. This is the one place the segment rule
 *  lives: the late-pair re-index searches the index by each unit, because redaction matches by
 *  unit, never by the whole value (D-4311, history-reindex-by-units-and-complete-loads). */
export function secretUnits(value) {
  if (value.length < SECRET_MIN_LEN) return [];
  if (/^[A-Za-z0-9_-]+$/.test(value)) return [value];
  return (value.match(/[A-Za-z0-9_-]+/g) ?? []).filter((s) => s.length >= SECRET_SEGMENT_MIN);
}

/** `~/.ccrc/sessions.json`'s records as pairs: each `idHash` is already
 *  `sha256(token)` of a 43-char base64url session token, so it loads as a
 *  (43, idHash) pair as is, never hashed again (§8.3, rev 3.2 review, SE3).
 *  D-4201 */
export function sessionHashPairs(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const r of parsed) {
    if (r !== null && typeof r === 'object' && typeof r.idHash === 'string' && /^[0-9a-f]{64}$/.test(r.idHash)) {
      out.push({ len: 43, sha256: r.idHash });
    }
  }
  return out;
}

/** The pairs, indexed by length, so the value layer hashes only runs whose
 *  length some pair has. */
export function makePairIndex(pairs, belt = null) {
  const byLen = new Map();
  for (const p of pairs) {
    if (!byLen.has(p.len)) byLen.set(p.len, new Set());
    byLen.get(p.len).add(p.sha256);
  }
  return { byLen, belt };
}

/** A pair index that answers exactly as makePairIndex(pairs) and counts, in probe.hits, every value-layer match on
 *  an OWED pair: one whose redact_hashes rowid lies above `mark` (D-4344, history-reindex-mark-by-rederivation).
 *
 *  Why a count of owed hits proves a stored index row complete. An index text depends on the pair set only through
 *  `byLen.get(len)?.has(sha)`: `entryIndexText` (`redactForIndex` over a window the text alone fixes, its joined belt
 *  and its decode readings included, then a cut the redacted text alone places, D-4419) is a deterministic function of
 *  those answers. A stored row was computed with its own pair set Q. By the mark's
 *  invariant every pair at or below the mark is in Q, and Q is a subset of all pairs. Take a recomputation with all
 *  pairs that recorded no owed hit. Every query it answered yes was a non-owed pair, so it is in Q. Every query it
 *  answered no is also no in Q. So both computations asked the same queries and got the same answers, and the stored
 *  row already equals the full redaction: it needs no rewrite. A recomputation that did record an owed hit is the
 *  row to rewrite. The test is by hash, with the redaction's own code, so it holds for a value glued to a
 *  neighbour that no quoted phrase finds, and for a pair that has no value (sessions.json's idHash). W1-B2 Task 7A: under `beltAll` every layer-4 and glue-window hit counts too, because both depend on the loaded values and on BELT_VERSION's code, which the argument above does not cover; and the glue windows' budget depends on the SET of registered lengths, not only on the answers, so a probe without `beltAll` is no completeness proof once a glue window can run: every re-derivation passes `beltAll: true` (Task 7B). */
export function makeProbeIndex(pairs, mark, { belt = null, beltAll = false } = {}) {
  const all = [...pairs];
  const base = makePairIndex(all);
  const owed = makePairIndex(all.filter((p) => p.rid > mark));
  const probe = { hits: 0 };
  const byLen = new Map();
  for (const [len, shas] of base.byLen) {
    const os = owed.byLen.get(len);
    byLen.set(len, os === undefined ? shas : {
      has: (sha) => { if (!shas.has(sha)) return false; if (os.has(sha)) probe.hits += 1; return true; },
    });
  }
  return { byLen, probe, belt, beltAll };
}

/** meta fts_rederive's grammar, `<target> <cursor> <end>`; anything else (undefined included) is null
 *  (D-4344, history-reindex-mark-by-rederivation). */
export function parseRederiveState(text) {
  const m = /^([0-9]{1,15}) ([0-9]{1,15}) ([0-9]{1,15})( b)?$/.exec(text ?? '');
  return m === null ? null : { target: Number(m[1]), cursor: Number(m[2]), end: Number(m[3]), ...(m[4] === undefined ? {} : { belt: true }) };
}
export function formatRederiveState(s) {
  return `${s.target} ${s.cursor} ${s.end}${s.belt === true ? ' b' : ''}`;
}
/** Whether a re-derivation generation is open: its saved target lies above the mark (D-4344,
 *  history-reindex-mark-by-rederivation). The one test of it, read by rederivePlan and phraseValues. */
function rederiveOpen(mark, state) {
  return state !== null && (state.target > mark || state.belt === true);
}
/** Continue a generation whose target lies above the mark; else start one when a pair lies above it; else nothing.
 *  A malformed state restarts from 0, which is conservative (D-4344, history-reindex-mark-by-rederivation). */
export function rederivePlan(mark, top, maxBlobId, state, beltDue = false, restart = false) {
  // `restart` (decideBelt's, R-version): the belt is due and the open generation carries no record of its units under
  // this BELT_VERSION (one opened under another version, by a build without the belt, or whose record a due record
  // cleared), so its walk is begun again rather than finished under a stamp it could not earn.
  if (rederiveOpen(mark, state) && !restart) return state;
  // A belt generation (§6.2 "The belt", decideBelt) re-derives every indexed blob with no new pair; it is open at its
  // own mark until its completion writes the state without ` b`.
  if (top > mark || beltDue) return { target: Math.max(top, mark), cursor: 0, end: maxBlobId, ...(beltDue ? { belt: true } : {}) };
  return null;
}
/** The values the same-tick phrase fast path searches (D-4344, history-reindex-mark-by-rederivation; review 344 F2):
 *  every value the tick loaded while no generation is open, and while one is, only `fresh`, the values whose pairs
 *  the tick itself recorded. An open generation re-derives every indexed blob up to its end, so a search on each of
 *  its ticks only re-indexed, every tick until it ended, each blob a phrase still found: a value glued to a
 *  neighbour by `_` or `-`, which §8.3's run grammar leaves in place. A pair recorded while a generation is open
 *  keeps its recording-tick search; one a dead pass recorded, or one recorded on a tick with no FTS (which runs no
 *  search), waits for the next tick no generation is open. */
export function phraseValues(mark, state, values, fresh) {
  return rederiveOpen(mark, state) ? fresh : values;
}

/** The JWT shape arm, `\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`
 *  as a regex, found by a linear scan with that regex's own matches (leftmost,
 *  non-overlapping, the third segment greedy). The regex backtracks
 *  quadratically on a long run of dotless starts (`'eyJ-'.repeat(65536)`
 *  measured 57 s over 256 KiB): each start's first segment runs to the end of
 *  its `.`-free stretch, fails for want of a `.`, and gives back one character
 *  at a time. One synchronous `replace` over a large tool_result would then
 *  outlive the carrier's kill on every tick, and `redactRun`'s RangeError
 *  catch cannot help, because this is time, not stack. A match lies wholly
 *  inside one maximal run of `[A-Za-z0-9_.-]`, so the callback sees a run and
 *  walks its `.`-separated segments left to right, never revisiting a
 *  character. The regex's first segment is a whole segment (the class has no
 *  `.`, so giving characters back never yields a dot), hence all `eyJ` starts
 *  in one segment share their tail conditions and only the first start that
 *  has a word boundary before it matters: it has the longest first segment.
 *  D-4306 (history-redaction-shapes-linear) */
function jwtSpansOfRun(run, base, add) {
  let j = run.indexOf('eyJ');
  if (j === -1) return;
  let segStart = 0;
  for (;;) {
    const segEnd = run.indexOf('.', segStart);
    if (segEnd === -1) break; // the last segment has no `.` after it: no match can start in it
    // The first `eyJ` in this segment with a word boundary before it: at the
    // segment's start (the run's start or a `.` precedes) or after a `-`.
    // `j` only moves forward, so the `eyJ` search is one pass over the run.
    if (j !== -1 && j < segStart) j = run.indexOf('eyJ', segStart);
    while (j !== -1 && j < segEnd && j !== segStart && run[j - 1] !== '-') j = run.indexOf('eyJ', j + 1);
    if (j !== -1 && j < segEnd && segEnd - (j + 3) >= 5) {
      const s2Start = segEnd + 1;
      const s2End = run.indexOf('.', s2Start);
      if (s2End !== -1 && s2End - s2Start >= 5) {
        const s3Start = s2End + 1;
        const found = run.indexOf('.', s3Start);
        const s3End = found === -1 ? run.length : found;
        if (s3End - s3Start >= 5) {
          add(base + j, base + s3End);
          segStart = s3End + 1;
          continue;
        }
      }
    }
    segStart = segEnd + 1;
  }
}

/** Every JWT-shaped match of `s` as a span (see `jwtSpansOfRun`; D-4614, round 7: layer 3 contributes spans, it does
 *  not rewrite the text). */
function jwtSpans(s, add) {
  const re = /[A-Za-z0-9_.-]+/g;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) jwtSpansOfRun(m[0], m.index, add);
}

/** REDACTED_MARK as regex source (D-4307: no sequence ever takes a mark's first character). */
const MARK_RE_SRC = REDACTED_MARK.replace(/[[\]\\^$.|?*+(){}]/g, '\\$&');
/** A control byte a terminal executes or ignores inside an escape sequence without ending it (D-4307, review 316
 *  M1): every C0 byte except the five whitespace ones (0x09-0x0D), CAN, SUB and ESC, plus DEL. CAN and SUB abort a
 *  sequence and ESC starts another; a whitespace byte is left out because a cut-off sequence (`cut -c`, `head -c`)
 *  followed by a line break is far likelier than a sequence holding one, and taking it would glue the next line on. */
const SEQ_FILL_SRC = '\\x00-\\x08\\x0e-\\x17\\x19\\x1c-\\x1f\\x7f';
/** An ANSI escape sequence (D-4307, amended by review 316 F1 and M1). Three arms, tried in this order:
 *  - a CSI (`ESC [` or the 8-bit 0x9B) or a DCS header (`ESC P` or the 8-bit 0x90): parameter bytes 0x30-0x3F,
 *    then intermediate bytes 0x20-0x2F, then one final byte 0x40-0x7E, with C0 controls (SEQ_FILL_SRC) among the
 *    parameter and intermediate bytes and between a 7-bit `ESC` and its `[` or `P` (a DCS's data string after its
 *    header is text);
 *  - a single shift (SS2/SS3: `ESC N`, `ESC O`, or the 8-bit 0x8E, 0x8F) and the one character 0x20-0x7E it shifts,
 *    with C0 controls between a 7-bit `ESC` and its `N` or `O` and between the shift and its character;
 *  - any other `ESC`-introduced sequence: intermediate bytes 0x20-0x2F, then one final byte 0x30-0x7E (`ESC(B`,
 *    `ESC7`, `ESC_`).
 *  The CSI's `[`, every final byte and a shifted character are never the first character of a redaction mark, so a
 *  mark the raw pass wrote after an escape is never split. Linear (D-4306): in each arm every class is disjoint from
 *  the class after it (the intermediates and their fill form one optional group that must open with an
 *  intermediate; the fill after a 7-bit `ESC` is followed only by `[`, `P`, `N` or `O`, and the fill after a single
 *  shift only by a printable character) and each lookahead is a fixed-length literal, so a failed start costs its
 *  own bytes a bounded number of times. Written as escape text, never the raw byte (source-bytes.test.ts). */
const ANSI_ESCAPE_RE = new RegExp(
  `(?:\\x1b[${SEQ_FILL_SRC}]*(?:(?!${MARK_RE_SRC})\\[|P)|[\\x9b\\x90])[0-?${SEQ_FILL_SRC}]*(?:[ -/][ -/${SEQ_FILL_SRC}]*)?(?!${MARK_RE_SRC})[@-~]`
  + `|(?:\\x1b[${SEQ_FILL_SRC}]*[NO]|[\\x8e\\x8f])[${SEQ_FILL_SRC}]*(?!${MARK_RE_SRC})[ -~]`
  + `|\\x1b[ -/]*(?!${MARK_RE_SRC})[0-~]`,
  'g',
);
/** One byte of SEQ_FILL_SRC (leadPrefixes skips the fill after a 7-bit `ESC`). */
const SEQ_FILL_RE = new RegExp(`[${SEQ_FILL_SRC}]`);
/** A field holding none of these bytes has no escape sequence and takes the plain path. */
const ESCAPE_INTRODUCER_RE = /[\x1b\x8e\x8f\x90\x9b]/;
/** The most distinct lead prefixes tried in front of one span (D-4307; security review of ee55098c2). Stacked
 *  colour codes give a few (`ESC[0m` `ESC[01;34m` gives three); past this many the span is marked unread instead
 *  (fail closed), which bounds the lead reading's cost to a fixed multiple of the field. An offset with no span
 *  text after it is never marked: its prefixes alone cost no more than its sequences (security review of
 *  2a8c791bf). */
export const LEAD_PREFIXES_MAX = 8;
/** The most readings of one span the lead reading tests (D-4307; security review of 2a8c791bf). A span's readings
 *  are every combination of one reading per sequence in it (spanReadings), a product; past this many, the span's
 *  plain sequences (PLAIN_SEQ_RE) are read two ways only, all stripped or all cut, and past this many readings of
 *  the others the span is marked unread (fail closed). The readings of a span are each about the span's length, so
 *  this bounds their cost to a fixed multiple of the field. */
export const LEAD_READINGS_MAX = 16;
/** A plain sequence, the kind colour and cursor output emits (D-4307; security review of 2a8c791bf): a CSI (`ESC [`
 *  with nothing between them, or the 8-bit 0x9B) with neither a C0 control nor an intermediate byte, or an `ESC`
 *  sequence that opens with an intermediate byte other than a space (a charset designation, `ESC(B`). A stray `ESC`
 *  right before a word is not plain: it reads as a bare `ESC` and a final byte, a single shift or a DCS header. */
const PLAIN_SEQ_RE = /^(?:\x1b\[|\x9b)[0-?]*[@-~]$|^\x1b[!-/][ -/]*[0-~]$/;

/** Layer 2's rules (the context layer), one definition each, built twice: `field` is the field pass, `final` the second
 *  belt's structure-safe form, D-4613 (history-final-belt-layer2-structure-safe) (§8.3, whole-branch review: the final
 *  pass runs over a serialised `--json` envelope and over the human page's frame). In the final form no value class
 *  consumes a backslash (a JSON escape is never split, so an escaped quote ends a value instead of being left bare),
 *  a line break (`\n`, `\r`: a value never crosses a line), `<` or `>` (nor a frame tag) or `&`; the JSON-form rule's value
 *  has no escape alternative, so an escaped quote ends it. The final form is the PER-SEGMENT primitive of the
 *  structure-aware belt (redactFinalText, redactFinalJson): it is never run over serialised structure, so it needs no
 *  rule about a closing quote or a closer (round 2's `]` and `}` exclusion was that, and it made the form
 *  non-idempotent on the field pass's own marks: `TOKEN=[redacted]` read as `[redacted` and was masked again). The
 *  field form is today's, byte for byte. */
function contextRules(final) {
  const stop = final ? String.raw`\\<>&` : '';
  return Object.freeze({
    json: new RegExp(String.raw`"([A-Za-z_][A-Za-z0-9_.-]{0,255})"(\s*:\s*)"(${final ? String.raw`[^"\\\n\r<>&]+` : String.raw`(?:[^"\\]|\\.)+`})"`, 'g'),
    // D-4614 (history-context-rule-rescans-after-a-plain-name): the named rule is TWO patterns scanned by hand
    // (namedSpans). `namedHead` finds `NAME=` or `NAME: ` and the optional quote; `namedValue` (sticky) takes the value
    // from there. The value is read only for a secret NAME, so a plain name never consumes its value and the scan
    // resumes right after the separator: a context key inside it is seen, and a run of `a=a=a=` stays linear.
    namedHead: new RegExp(String.raw`\b([A-Za-z_][A-Za-z0-9_.-]{0,255})(=|:[ \t]+)`, 'g'),
    // The NAME a value ends in (`namedSpans`' tail head): `NAME=` or `NAME:` at the end of a slice of at most 258 characters.
    namedTail: new RegExp(String.raw`\b([A-Za-z_][A-Za-z0-9_.-]{0,255})(=|:)$`),
    namedValue: new RegExp(String.raw`(["']?)([^\s"'` + '`' + String.raw`,;&${final ? String.raw`\\<>` : ''}]+)`, 'y'),
    bearer: new RegExp(String.raw`(Authorization:[ \t]*Bearer[ \t]+)([^\s"'${stop}]+)`, 'gi'),
    mailToken: new RegExp(String.raw`(x-ccrc-mail-token:[ \t]*)([^\s"'${stop}]+)`, 'gi'),
    bearerSticky: new RegExp(String.raw`(Authorization:[ \t]*Bearer[ \t]+)([^\s"'${stop}]+)`, 'iy'),
    mailTokenSticky: new RegExp(String.raw`(x-ccrc-mail-token:[ \t]*)([^\s"'${stop}]+)`, 'iy'),
    query: new RegExp(String.raw`([?&]token=)([^&\s"'#${final ? String.raw`\\<>` : ''}]+)`, 'gi'),
  });
}
const CONTEXT_RULES = Object.freeze({ field: contextRules(false), final: contextRules(true) });

/** What a secret value that ends where it could hide a further head of its own rule hands on (D-4614, whole-branch fix
 *  round 7). A rule scanned left to right and not overlapping resumes AFTER a value, so a head that STARTS inside the
 *  value and ends at its edge or past it is never read: a named value `V…API_KEY=` is followed by the quote and value
 *  of the head it ends in (`ACCESS_KEY: VDDSRokpmmwjAPI_KEY="VUnr…"`), `key:` is followed, after a space, by the value of
 *  the head `key: ` (`auth=key: VrtkzAsEaKdA}SECRET='V…'`), and a header value `VaYk…authorization:` is followed by
 *  `bearer V4Fun…`. This reads that tail head, once per value and bounded by the head's own 256-character NAME, and
 *  returns the span of the value the head owns, or null. `kind` is 'named', 'bearer' or 'mail'. */
function tailHead(s, R, valueStart, end, kind) {
  const next = end < s.length ? s[end] : '';
  if (kind === 'named') {
    const last = s.charCodeAt(end - 1);
    if (!(last === 0x3d || (last === 0x3a && (next === ' ' || next === '\t')))) return null;
    const c = R.namedTail.exec(s.slice(Math.max(valueStart, end - 258), end));
    if (c === null || !IDENTIFIER_RE.test(c[1])) return null;
    let at = end;
    while (s[at] === ' ' || s[at] === '\t') at += 1;
    R.namedValue.lastIndex = at;
    const v = R.namedValue.exec(s);
    if (v === null || v[2] === REDACTED_MARK) return null;
    return [at + v[1].length, at + v[0].length];
  }
  // The value's tail against a FULL nested head (D-4614, whole-branch fix round 8). A value holds no whitespace, so a
  // head with no space after its colon ends INSIDE it: `Vabcauthorization:Bearer` (then ` SECRET`) and
  // `Vabcx-ccrc-mail-token:` (then the next value, whatever follows). A Bearer head also ends the value at its bare word
  // `authorization:` when a space or tab follows (the head's own space is the next character). The sticky rule re-runs
  // from where the head starts and decides whether it is one.
  const tail = s.slice(Math.max(valueStart, end - 20), end).toLowerCase();
  let headLen = 0;
  if (kind === 'bearer') {
    if (tail.endsWith('authorization:bearer')) headLen = 20;
    else if (tail.endsWith('authorization:') && (next === ' ' || next === '\t')) headLen = 14;
  } else if (tail.endsWith('x-ccrc-mail-token:')) {
    headLen = 18;
  }
  if (headLen === 0) return null;
  const re = kind === 'bearer' ? R.bearerSticky : R.mailTokenSticky;
  re.lastIndex = end - headLen;
  const m = re.exec(s);
  return m === null || m[2] === REDACTED_MARK ? null : [m.index + m[1].length, m.index + m[0].length];
}

/** `add` the value span [start, end) and each tail head's value after it (see `tailHead`); returns where the last ends. */
function addChain(s, R, start, end, kind, add) {
  add(start, end);
  for (let h = tailHead(s, R, start, end, kind); h !== null; h = tailHead(s, R, start, end, kind)) {
    [start, end] = h;
    add(start, end);
  }
  return end;
}

/** Layer 2's named rule (`NAME=value`, `NAME: value`), D-4614 (history-context-rule-rescans-after-a-plain-name; whole-branch
 *  fix rounds 5 and 7): a scan by hand that contributes the VALUE spans of the secret names to `add`, so a NAME that is not
 *  a secret (or a value that is already the mark) does not use up its value. The scan resumes RIGHT AFTER THE SEPARATOR,
 *  and a context key inside the value (`level=[INFO]password=x`, a CLI prefix `internal error: TOKEN=x`) is seen. A
 *  secret NAME's value is taken, then the tail head it may end in (`addChain`), and the scan resumes after it. The rule
 *  reads the SAME text every other rule reads (round 7): it masks nothing itself, the caller masks the union of every
 *  rule's spans. */
function namedSpans(s, R, add) {
  const head = R.namedHead;
  const val = R.namedValue;
  head.lastIndex = 0;
  for (let m = head.exec(s); m !== null; m = head.exec(s)) {
    const sepEnd = m.index + m[0].length;
    val.lastIndex = sepEnd;
    const v = IDENTIFIER_RE.test(m[1]) ? val.exec(s) : null;
    if (v === null || v[2] === REDACTED_MARK) {
      head.lastIndex = sepEnd;
      continue;
    }
    head.lastIndex = addChain(s, R, sepEnd + v[1].length, sepEnd + v[0].length, 'named', add);
  }
}

/** The anchor rules' value spans (D-4614, round 7): the Bearer header, the box-token header and `?token=`. The two header
 *  rules scan by hand so a value that ends in the next header's own word (`authorization: bearer V…authorization: bearer S`)
 *  hands on to it (`addChain`); `?token=` cannot hide a head of its own (its value class stops at `&`). */
function anchorSpans(s, R, add) {
  for (const [re, kind] of [[R.bearer, 'bearer'], [R.mailToken, 'mail']]) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m !== null; m = re.exec(s)) {
      if (m[2] !== REDACTED_MARK) re.lastIndex = addChain(s, R, m.index + m[1].length, m.index + m[0].length, kind, add);
    }
  }
  for (const m of s.matchAll(R.query)) add(m.index + m[1].length, m.index + m[0].length);
}

/** The JSON-form rule's value spans (D-4614, round 7): a scan by hand like the named rule. After a secret pair it
 *  resumes AT the closing quote (a value that ends in an escaped quote, `"a": "x\""token": "S"`, reads as one string whose
 *  closing quote is the next pair's opening one), and after a pair that masks nothing (a plain name, or a value already
 *  the mark) it resumes one character in, so a pair inside that pair's value is seen (`"name": "API_KEY="v": "token": "S"`). */
function jsonSpans(s, R, add) {
  const json = R.json;
  json.lastIndex = 0;
  for (let m = json.exec(s); m !== null; m = json.exec(s)) {
    if (IDENTIFIER_RE.test(m[1]) && m[3] !== REDACTED_MARK) {
      const start = m.index + 1 + m[1].length + 1 + m[2].length + 1;
      add(start, start + m[3].length);
      json.lastIndex = m.index + m[0].length - 1;
    } else {
      json.lastIndex = m.index + 1;
    }
  }
}

/** Layer 3's spans: every `SECRET_SHAPE_RES` match and the JWT reading, whole. */
function shapeSpans(s, add) {
  for (const re of SECRET_SHAPE_RES) {
    for (const m of s.matchAll(re)) add(m.index, m.index + m[0].length);
  }
  jwtSpans(s, add);
}

/** The JSON-form rule's SECOND reading, for the final form only (D-4614, whole-branch fix round 8). The final form's JSON
 *  value class stops at a line break, `<`, `>`, `&` and a backslash, so `"password": "hunter2<PEM block>"` is not one
 *  value to the first reading: the shape masks the block and `hunter2` stays printed. This reads the text with every
 *  shape span collapsed to the mark (no line break, `<` or `&` is left inside it), runs the JSON-form scan on that, and
 *  maps each value span it finds back to the original text, where it covers the shape spans inside it: the whole
 *  value up to its closing quote is the mark. The field form needs no second reading (its value class crosses all of
 *  those). `shapes` are `[start, end)` pairs of `s`, in any order. Chosen over extending a value's span in place
 *  because it reuses `jsonSpans` unchanged (one definition of what a JSON-form value is) and cannot disagree with it.
 *  Linear: one sort and merge of the shape spans, one copy, one scan, one binary search per span found. */
function jsonSpansCollapsed(s, R, shapes, add) {
  if (shapes.length === 0) return;
  shapes.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const plain = []; // the plain stretches of s: [start in s, end in s, start in the collapsed reading]
  let c = '';
  let copied = 0;
  let a = shapes[0][0];
  let b = shapes[0][1];
  for (let i = 1; i <= shapes.length; i += 1) {
    if (i < shapes.length && shapes[i][0] <= b) {
      if (shapes[i][1] > b) b = shapes[i][1];
      continue;
    }
    plain.push([copied, a, c.length]);
    c += s.slice(copied, a) + REDACTED_MARK;
    copied = b;
    if (i < shapes.length) [a, b] = shapes[i];
  }
  plain.push([copied, s.length, c.length]);
  c += s.slice(copied);
  // the original position of a position of c: the last plain stretch starting at or before it (a position at the start
  // of a mark is the end of the stretch before it, which is where the shape starts; one just after a mark is the start
  // of the stretch after it, which is where the shape ends)
  const back = (p) => {
    let lo = 0;
    let hi = plain.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (plain[mid][2] <= p) lo = mid;
      else hi = mid - 1;
    }
    return plain[lo][0] + (p - plain[lo][2]);
  };
  jsonSpans(c, R, (x, y) => {
    if (c.slice(x, y) !== REDACTED_MARK) add(back(x), back(y));
  });
}

/** The union of spans (D-4614, whole-branch fix round 7): `spans` holds `[start, end)` pairs of `s` in any order;
 *  overlapping or touching pairs merge, and each maximal merged span is replaced by ONE mark. One sort and one pass. */
function maskSpans(s, spans) {
  if (spans.length === 0) return s;
  spans.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let out = '';
  let copied = 0;
  let a = spans[0][0];
  let b = spans[0][1];
  for (let i = 1; i <= spans.length; i += 1) {
    if (i < spans.length && spans[i][0] <= b) {
      if (spans[i][1] > b) b = spans[i][1];
      continue;
    }
    out += s.slice(copied, a) + REDACTED_MARK;
    copied = b;
    if (i < spans.length) [a, b] = spans[i];
  }
  return out + s.slice(copied);
}

/** One run through all three layers, failing closed. V8 runs these patterns
 *  by backtracking on a bounded stack, so over a run of several MiB `replace`
 *  throws `RangeError: Maximum call stack size exceeded`: measured on Node
 *  22.13.0 and 24.14.1, the `sk-` shape arm on a 6 MiB run and the JSON-form
 *  context rule on an 8 MiB value, while a stored line can be LINE_MAX (16 MiB).
 *  Escaping, it would fail the caller's chunk on every tick. A run the engine
 *  cannot finish is replaced whole by the mark (§8.3 is fail-closed), never
 *  printed or indexed unredacted. The catch spans every layer, not the shape
 *  loop alone, because the JSON-form throw is layer 2's. Only a RangeError is
 *  caught: any other throw is a defect and propagates. `context` false skips
 *  layer 2, for the lead reading's candidates (D-4307; security review of
 *  2a8c791bf): they hold only `[A-Za-z0-9_.-]` and `\n`, and every layer-2
 *  pattern needs a `"`, `=`, `:`, `?` or `&`, so it can match nothing there,
 *  while on a span of short dotted words it is the costliest layer. `context`
 *  `'final'` runs layer 2 in redactFinal's structure-safe form (D-4613). */
function redactRun(segment, idx, context = true) {
  try {
    return redactLayers(segment, idx, context);
  } catch (e) {
    if (e instanceof RangeError) return REDACTED_MARK;
    throw e;
  }
}

function redactLayers(segment, idx, context) {
  // Layer 1: values, by (length, sha256) of each [A-Za-z0-9_-]+ run. A value
  // glued to other run characters (`<secret>_file`) is not a run and is not
  // matched here: that is §8.3's chosen grammar, since a substring search
  // would hash every window of every stored length. The context and shape
  // layers are the belt there.
  const s = segment.replace(/[A-Za-z0-9_-]+/g, (run) => {
    const shas = idx.byLen.get(run.length);
    return shas !== undefined && shas.has(sha256Hex(run)) ? REDACTED_MARK : glueRedact(run, idx);
  });
  // Layer 2: context. The value after NAME=, NAME: or "name": " when NAME is
  // an identifier name; after a bearer header and the box-token header; and
  // a token query parameter. NAME is bounded at 256 chars: unbounded, every
  // word boundary inside a long run of [A-Za-z0-9_.-] rescans to the run's
  // end, which is quadratic (a 2 MiB base64url blob measured 90.8 s, bounded
  // 139 ms), and one large tool_result would outlive the carrier's kill.
  // UNION (D-4614, whole-branch fix round 7): every context rule (bearer, box-token header, `?token=`, the JSON-form
  // rule, the named rule) and every layer-3 shape (SECRET_SHAPE_RES and the JWT reading) is matched against THIS text,
  // layer 1's output, independently, and contributes the span of characters it would replace (a context rule its VALUE
  // only: its name, separator, quote and header stay; the JSON-form rule the value inside the quotes; a shape its whole
  // match). The union of the spans is masked in one pass, each maximal merged span by ONE mark. Any sequential order
  // loses something, measured: the named rule first lets a greedy NAME value swallow a glued anchor or shape
  // (`mode=auth: abcdefAuthorization: Bearer S`), anchors and shapes first lets a shape or anchor value swallow a glued
  // NAME (`sk-…api_key: "V"`), so no rule may read what another has rewritten. Every pattern and value class is
  // unchanged. A span whose text already is the mark is not a span (idempotence).
  const R = context ? (context === 'final' ? CONTEXT_RULES.final : CONTEXT_RULES.field) : null;
  const spans = [];
  const add = (a, b) => {
    if (b > a && !(b - a === REDACTED_MARK.length && s.startsWith(REDACTED_MARK, a))) spans.push([a, b]);
  };
  if (R !== null) {
    anchorSpans(s, R, add);
    jsonSpans(s, R, add);
    namedSpans(s, R, add);
  }
  if (R === CONTEXT_RULES.final) {
    const shapes = [];
    shapeSpans(s, (x, y) => {
      add(x, y);
      shapes.push([x, y]);
    });
    jsonSpansCollapsed(s, R, shapes, add);
  } else {
    shapeSpans(s, add);
  }
  return maskSpans(s, spans);
}

/** A byte of the `[A-Za-z0-9_.-]` span class, the JWT run class (the unit the lead reading extends and marks). */
const isSpanByte = (b) => isRunByte(b) || b === 0x2e;

/** The span-class characters a sequence may have taken from the text after it (D-4307; security review of
 *  ee55098c2): the longest `[A-Za-z0-9_.-]` suffix of the sequence after its 7-bit `ESC` or 8-bit introducer, that
 *  suffix after the `[`, `P`, `N` or `O` that follows a 7-bit `ESC` and its C0 fill, and the final character alone,
 *  each kept once and only when non-empty. */
function leadPrefixes(seq) {
  const tail = (from) => {
    let k = seq.length;
    while (k > from && isSpanByte(seq.charCodeAt(k - 1))) k -= 1;
    return seq.slice(k);
  };
  let k = 1;
  if (seq.charCodeAt(0) === 0x1b) while (k < seq.length && SEQ_FILL_RE.test(seq[k])) k += 1;
  const two = k + 1 < seq.length && seq.charCodeAt(0) === 0x1b && '[PNO'.includes(seq[k]) ? k + 1 : 1;
  return [tail(1), tail(two), tail(seq.length - 1)].filter((p, i, all) => p !== '' && all.indexOf(p) === i);
}

/** The end of the `[A-Za-z0-9_.-]` span of `s` that starts at `p`. */
function spanEnd(s, p) {
  let e = p;
  while (e < s.length && isSpanByte(s.charCodeAt(e))) e += 1;
  return e;
}

/** How many characters of lead candidates are tested in one pass (D-4307): the bound on the candidates' TEXT held at
 *  once, not on everything a batch holds. Each candidate also carries a closure and two array slots, a fixed cost
 *  `size` does not count, so a batch of tiny candidates holds more than this many characters' worth. FU1S's critic
 *  measured the whole cost on one 16 MiB field with no secrets (load average about 16): `ESC 7 a ` repeated took
 *  15.6 s and 1,685 MB maxRSS at the base and 24.5 s and 2,097 MB with the lead reading, `a ESC 7 b ESC 8 c `
 *  repeated 15.5 s and 1,572 MB against 53.7 s and 1,719 MB (3.5x; each span is under the cap and yields 15
 *  candidates); a 1 GB-plus RSS is already the base's (final review 316 B4M11). */
const LEAD_BATCH_CHARS = 1 << 20;

/** The end of the `[A-Za-z0-9_-]` run of `s` that starts at `p` (the value layer's unit). */
function runEnd(s, p) {
  let e = p;
  while (e < s.length && isRunByte(s.charCodeAt(e))) e += 1;
  return e;
}

/** Test every combination of `lists` (one reading per sequence, at `offs`) as one candidate, the span `plain[a..b]`
 *  with each sequence replaced by its reading (D-4307; security review of 2a8c791bf). A sequence whose only reading
 *  is stripped joins its neighbours and is not a position. `skipFirst` skips the combination of every first reading.
 *  A candidate that redacts is flagged at the offset of `plain` its first redacted character came from: a character
 *  a sequence put back came from that sequence's offset. */
function readCombinations(plain, a, b, offs0, lists0, skipFirst, test) {
  const keep = lists0.map((l) => l.length > 1 || l[0] !== '');
  const offs = offs0.filter((_, m) => keep[m]);
  const lists = lists0.filter((_, m) => keep[m]);
  const total = lists.reduce((n, l) => n * l.length, 1);
  for (let r = skipFirst ? 1 : 0; r < total; r += 1) {
    let rest = r;
    const ins = lists.map((l) => {
      const x = l[rest % l.length];
      rest = Math.floor(rest / l.length);
      return x;
    });
    let c = '';
    let at = a;
    for (let n = 0; n < ins.length; n += 1) {
      c += plain.slice(at, offs[n]) + ins[n];
      at = offs[n];
    }
    test(c + plain.slice(at, b), (q) => {
      let pos = 0;
      let from = a;
      for (let n = 0; n < ins.length; n += 1) {
        if (q < pos + offs[n] - from) return from + q - pos;
        pos += offs[n] - from;
        from = offs[n];
        if (q < pos + ins[n].length) return from;
        pos += ins[n].length;
      }
      return Math.min(from + q - pos, b);
    });
  }
}

/** The readings of one span (D-4307; security review of 2a8c791bf): `plain[a..b]`, a maximal `[A-Za-z0-9_.-]` span
 *  of the stripped text, and the sequences at offsets `a` to `b` (`leads[i..j]`, flat as in leadOffsets). Each
 *  sequence is read one of these ways: stripped; as a cut (`\n`, the per-fragment reading); as one of its lead
 *  prefixes (leadPrefixes) put back in the text; or as a cut and then one of them (the sequence's other bytes a
 *  boundary). A reading the span's ends make identical to another is not listed: the first sequence at `a` takes
 *  no cut, the last at `b` no bare cut. Every combination is one candidate, the whole span, so the value and shape
 *  layers apply their own boundaries inside it (a value after a `.` is a run of its own there). The all-stripped
 *  candidate is the joined reading's own text, so it is skipped. Over LEAD_READINGS_MAX combinations, the plain
 *  sequences (PLAIN_SEQ_RE) are read two ways only, all stripped or all cut, each with every combination of the
 *  others (all cut with the others stripped is no other reading's text, so it is tested); over LEAD_READINGS_MAX
 *  combinations of the others, the span is flagged at `a`, untested (fail closed). */
function spanReadings(plain, raw, leads, i, j, a, b, test, flagged) {
  const offs = [];
  const lists = [];
  const plainSeq = [];
  for (let k = i; k < j; k += 3) {
    const seq = raw.slice(leads[k + 1], leads[k + 2]);
    const P = leadPrefixes(seq);
    const cuts = P.map((x) => `\n${x}`);
    offs.push(leads[k]);
    lists.push(k === i && leads[k] === a ? ['', ...P] : k + 3 === j && leads[k] === b ? ['', ...P, ...cuts] : ['', '\n', ...P, ...cuts]);
    plainSeq.push(P.length === 0 || PLAIN_SEQ_RE.test(seq));
  }
  const product = (ls) => ls.reduce((n, l) => Math.min(n * l.length, LEAD_READINGS_MAX + 1), 1);
  if (product(lists) <= LEAD_READINGS_MAX) { readCombinations(plain, a, b, offs, lists, true, test); return; }
  const others = lists.map((l, m) => (plainSeq[m] ? [''] : l));
  const readings = product(others);
  if (readings > LEAD_READINGS_MAX) { flagged.add(a); return; }
  // With plain sequences alone, the two readings are the joined and the per-fragment ones, both read already.
  if (readings === 1) return;
  readCombinations(plain, a, b, offs, others, true, test);
  readCombinations(plain, a, b, offs, lists.map((l, m) => (plainSeq[m] ? ['\n'] : l)), false, test);
}

/** The lead reading (D-4307; security review of ee55098c2 and of 2a8c791bf): the offsets of `plain` (the stripped
 *  text) whose span a sequence's own trailing characters complete into something redaction removes. `leads` is
 *  flat, three numbers per sequence: its offset in `plain`, then its start and end in `raw`. Two passes.
 *  - Each offset alone: every distinct prefix of the sequences at one offset (leadPrefixes) is tried in front of
 *    the span up to the next sequence (the sequence read as a separator) and, when that span reaches the next
 *    sequence, in front of the rest of the span (from a span's start) or of the rest of the `[A-Za-z0-9_-]` run
 *    (from a run's start inside a span, after a `.`), every later sequence stripped. Only a span's or a run's start
 *    reads past the next sequence, and spans and runs are disjoint, so the candidates total at most
 *    LEAD_PREFIXES_MAX times three times `plain` plus the sequences. An offset with span text after it and more
 *    than LEAD_PREFIXES_MAX distinct prefixes is flagged untested (fail closed); with none after it, its candidates
 *    are its prefixes alone, which total at most three times its sequences' length, so it is never flagged unread
 *    (a spinner's stack of cursor and colour sequences before its glyph).
 *  - Each span: every combination of its sequences' readings (spanReadings), fewer than twice LEAD_READINGS_MAX
 *    candidates of the span's length plus its sequences' bytes each, spans disjoint.
 *  So the candidates are linear in `plain` plus the sequences. A candidate holds only span-class characters and
 *  `\n`, a boundary no layer reads across, so candidates are tested LEAD_BATCH_CHARS at a time, joined by `\n`,
 *  each alone only when its batch redacts, and without the context layer, which can match nothing in them
 *  (redactRun). A sequence at an offset with a non-span character on both sides belongs
 *  to no span and is read by the first pass alone. Returned ascending, each offset once. */
function leadOffsets(plain, raw, leads, idx) {
  const flagged = new Set();
  let batch = [];
  let size = 0;
  const flush = () => {
    const all = batch.filter((_, k) => k % 2 === 0).join('\n');
    if (redactRun(all, idx, false) !== all) {
      for (let k = 0; k < batch.length; k += 2) {
        const c = batch[k];
        const r = redactRun(c, idx, false);
        if (r === c) continue;
        let q = 0;
        while (q < c.length && c.charCodeAt(q) === r.charCodeAt(q)) q += 1;
        flagged.add(batch[k + 1](q));
      }
    }
    batch = [];
    size = 0;
  };
  const test = (c, flagAt) => {
    batch.push(c, flagAt);
    size += c.length + 1;
    if (size >= LEAD_BATCH_CHARS) flush();
  };
  for (let i = 0; i < leads.length;) {
    const p = leads[i];
    const prefixes = new Set();
    let j = i;
    for (; j < leads.length && leads[j] === p; j += 3) for (const x of leadPrefixes(raw.slice(leads[j + 1], leads[j + 2]))) prefixes.add(x);
    const next = j < leads.length ? leads[j] : plain.length;
    i = j;
    if (prefixes.size === 0) continue;
    let fragEnd = p;
    while (fragEnd < next && isSpanByte(plain.charCodeAt(fragEnd))) fragEnd += 1;
    // With no span character after it, an offset's candidates are its prefixes alone, as long as the sequences.
    if (prefixes.size > LEAD_PREFIXES_MAX && fragEnd > p) { flagged.add(p); continue; }
    const atSpanStart = p === 0 || !isSpanByte(plain.charCodeAt(p - 1));
    const atRunStart = atSpanStart || !isRunByte(plain.charCodeAt(p - 1));
    const far = fragEnd < next ? fragEnd : atSpanStart ? spanEnd(plain, fragEnd) : atRunStart ? runEnd(plain, p) : fragEnd;
    const at = () => p;
    for (const x of prefixes) {
      test(x + plain.slice(p, fragEnd), at);
      if (far > fragEnd) test(x + plain.slice(p, far), at);
    }
  }
  for (let i = 0; i < leads.length;) {
    const o = leads[i];
    if (!(o > 0 && isSpanByte(plain.charCodeAt(o - 1))) && !(o < plain.length && isSpanByte(plain.charCodeAt(o)))) { i += 3; continue; }
    let a = o;
    while (a > 0 && isSpanByte(plain.charCodeAt(a - 1))) a -= 1;
    const b = spanEnd(plain, o);
    let j = i;
    while (j < leads.length && leads[j] <= b) j += 3;
    spanReadings(plain, raw, leads, i, j, a, b, test, flagged);
    i = j;
  }
  if (batch.length > 0) flush();
  return [...flagged].sort((x, y) => x - y);
}

/** `flagged` (ascending) with every offset of `carried` (ascending: where a fragment that ends in the mark ends) that has
 *  a span character after it, ascending, each once (D-4307; final review 316 FP4). The joined text is built from the
 *  per-fragment results, so a key a sequence split after its shape's or its pair's first characters reads
 *  `[redacted]<rest>` there and no layer matches the rest; the mark is carried across the sequence to the end of the
 *  span instead (fail closed: span characters glued right after a token coloured in whole are marked with it). */
function carriedMarks(plain, carried, flagged) {
  const at = carried.filter((o) => o < plain.length && isSpanByte(plain.charCodeAt(o)));
  if (at.length === 0) return flagged;
  return [...new Set([...flagged, ...at])].sort((x, y) => x - y);
}

/** `plain` with the span at each flagged offset replaced by the mark (an empty span gets the mark inserted). */
function markSpansAt(plain, offsets) {
  let out = '';
  let last = 0;
  for (const p of offsets) {
    if (p < last) continue;
    out += plain.slice(last, p) + REDACTED_MARK;
    last = spanEnd(plain, p);
  }
  return out + plain.slice(last);
}

/** Redact one field's FULL raw text, before any cut, cap, escape or
 *  serialisation (§8.3: JSON escaping glues `\n` onto the next run, and a cut
 *  leaves a prefix no pair matches). Runs are split at ANSI escape sequences
 *  (`ANSI_ESCAPE_RE`: every ECMA-48 CSI and DCS header, 7-bit or 8-bit, a single
 *  shift with its shifted character, and every other two-character or
 *  intermediate-led `ESC` sequence) first, so a coloured token is still one run;
 *  the sequences themselves are kept. D-4202
 *
 *  A field holding an escape introducer is read four ways and the union of
 *  their redactions is returned. The RAW reading redacts the text whole, the
 *  sequence bytes being ordinary text: it catches a value whose first
 *  character a sequence would take for its final byte (`ESC[` then `abc...`
 *  reads as `ESC[a` + `bc...` to the per-fragment and joined readings) when
 *  nothing else splits it. The PER-FRAGMENT reading splits the raw reading's
 *  output at the sequences and redacts each fragment, so a token coloured in
 *  WHOLE is one run. A token coloured in PART (`grep --color=always`, a
 *  word-diff, a highlighter) is split across fragments, and no layer sees it
 *  whole, so the JOINED reading takes the per-fragment result `A`, its
 *  sequences removed (`P`, accumulated from the fragments themselves, never by
 *  re-matching an escape in `A`), and runs the layers once more (`C`). The
 *  LEAD reading (leadOffsets) puts back what a sequence may have taken from
 *  the text after it, its trailing span-class characters, one offset at a
 *  time and, per span, in every combination of its sequences' readings
 *  (spanReadings), so a value two sequences each took a character of, or one
 *  right after a `.`, is read whole: a bare `ESC` before a secret coloured in
 *  part (`ESC` + `S` + `ECR` + a CSI + `ET`) loses its `S` to the joined
 *  reading and keeps the CSI's remnant glued on in the raw one, a DCS header
 *  or a single shift takes a value's first characters. Text the lead reading
 *  finds is marked in `P`, from its first character to its span's end, and so
 *  is the rest of a span after a sequence that a fragment's mark ends right
 *  before (a key grep highlights in part after its shape's first characters,
 *  final review 316 FP4), before `C` is computed. `C === P` (nothing new, no lead found) returns `A`
 *  with its colours; otherwise `C` is returned, the sequences dropped from
 *  that one field's output (presentation only, the stored blob stays
 *  verbatim). A field with no escape introducer takes the plain path alone,
 *  at no extra cost.
 *
 *  The mark rule: the raw reading may leave a mark after `ESC`, after
 *  `ESC[1;`, after `ESC(`, after a C0 control inside a sequence or after an
 *  8-bit introducer, and a sequence match over that text would read the mark's
 *  `[` as a CSI opener, a final byte or a shifted character and split the
 *  mark. `ANSI_ESCAPE_RE` therefore never takes a mark's first character as
 *  any of them.
 *  D-4307 (history-redaction-csi-joined-belt, amended: review 316 F1 and M1, security reviews of ee55098c2 and 2a8c791bf) */
/** The complete field redaction. Layer 4 allocates per-field buffers too, so its RangeError shares layers 1-3's
 * fail-closed contract while non-RangeError defects remain visible. */
export function redactField(text, idx) {
  return redactFieldIn(text, idx, true);
}

/** redactField's body, with layer 2's mode (`true` the field form, `'final'` redactFinal's structure-safe form). */
function redactFieldIn(text, idx, context) {
  const layered = redactLayered(text, idx, context);
  try {
    return beltMask(layered, idx.belt, true, beltHit(idx));
  } catch (e) {
    if (e instanceof RangeError) return REDACTED_MARK;
    throw e;
  }
}

/** redactField's three layers over its readings, before the belt: B1's redactField body, unchanged. */
function redactLayered(text, idx, context = true) {
  if (!ESCAPE_INTRODUCER_RE.test(text)) return redactRun(text, idx, context);
  const raw = redactRun(text, idx, context);
  let out = '';
  let plain = '';
  let last = 0;
  let sawCsi = false;
  const leads = [];
  const carried = [];
  ANSI_ESCAPE_RE.lastIndex = 0;
  for (let m = ANSI_ESCAPE_RE.exec(raw); m !== null; m = ANSI_ESCAPE_RE.exec(raw)) {
    const frag = redactRun(raw.slice(last, m.index), idx, context);
    out += frag + m[0];
    plain += frag;
    if (frag.endsWith(REDACTED_MARK)) carried.push(plain.length);
    leads.push(plain.length, m.index, m.index + m[0].length);
    last = m.index + m[0].length;
    sawCsi = true;
  }
  const tail = redactRun(raw.slice(last), idx, context);
  const perFragment = out + tail;
  if (!sawCsi) return perFragment;
  // `plain` is accumulated from the fragments, never rebuilt by re-matching an escape in `perFragment`: a redaction can
  // create an escape shape (a bare ESC before `[redacted]` reads as `ESC[r...`), and a re-strip would eat the mark.
  plain += tail;
  const flagged = carriedMarks(plain, carried, leadOffsets(plain, raw, leads, idx));
  const joined = redactRun(flagged.length === 0 ? plain : markSpansAt(plain, flagged), idx, context);
  return joined === plain ? perFragment : joined;
}

const JSON_ESCAPE_RE = /\\(?:([nrtbf"\\/])|u([0-9a-fA-F]{4}))/g;
const JSON_ESCAPE_CHAR = Object.freeze({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' });

/** A sidecar's text with its JSON string escapes undone (D-4336, history-sidecar-index-text-unescaped; spec §6.2,
 *  §8.3: the index never holds text redaction would remove). Claude Code writes `tool-results/*.json` too, and
 *  inside a JSON string every line break is the two characters backslash and `n`, which glue an `n` onto the next
 *  run and defeat the pair layer and the `\b`-anchored shapes. One left-to-right pass, so an escaped backslash
 *  followed by `n` stays a backslash and an `n`, never re-read. A malformed or truncated escape is left as written.
 *  The decoded text is search-only (the blob is stored verbatim), so this is applied to every sidecar.
 *  One level per call; redactForIndex reads the deeper levels (D-4343). */
function unescapeJsonText(text) {
  if (!text.includes('\\')) return text;
  return text.replace(JSON_ESCAPE_RE, (_m, c, u) => (c !== undefined ? JSON_ESCAPE_CHAR[c] : String.fromCharCode(parseInt(u, 16))));
}

/** Every maximal span of `[A-Za-z0-9_.-]` characters and backslashes that holds both, as the mark: redactForIndex's
 *  exhaustion rule (D-4343). One class, greedy, so the scan is linear (D-4306). The class is the JWT run class
 *  plus the backslash, so a JWT glued to an escape is marked whole, its payload and signature too. */
function markEscapeGluedSpans(s) {
  return s.replace(/[A-Za-z0-9_.\\-]+/g, (span) => (span.includes('\\') && /[A-Za-z0-9_-]/.test(span) ? REDACTED_MARK : span));
}

/** An index text: `text` redacted through every JSON-escape reading, so no term of it holds a secret that an escape
 *  letter glued on (D-4343 (history-index-escape-readings-to-fixpoint), review 316 F2).
 *
 *  Every reading is redacted raw-first, D-4336's union: a mark holds no backslash, so a decode never alters one.
 *  The text returned is the latest reading whose redaction removed something, else the text as it came. A deeper
 *  reading that redacts nothing is not indexed, because decoding text that is not JSON damages search (backslash-begin
 *  would index as `egin`, a Windows path as `ew_folder`). That is sound: a secret glued to an escape letter at one
 *  level is separated, and so redacted, at a deeper level, which then counts as removing something. At the bound
 *  (`INDEX_UNESCAPE_PASSES` decodes without a fixpoint) the last reading is indexed with every span that touches a
 *  backslash marked (`markEscapeGluedSpans`), so no part of a secret a further decode would separate is indexed.
 *  `idx` is required: `sidecarIndexText(…, null)` never calls this. */
export function redactForIndex(text, idx) {
  let t = redactIndexReading(text, idx);
  let keep = t;
  for (let pass = 0; pass < INDEX_UNESCAPE_PASSES; pass += 1) {
    const u = unescapeJsonText(t);
    if (u === t) return keep;
    t = redactIndexReading(u, idx);
    if (t !== u) keep = t;
  }
  return markEscapeGluedSpans(t);
}

/** A byte of the `[A-Za-z0-9_-]` run class (the unit a pair or a shape can match). */
const isRunByte = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x2d;

/** `s` without its trailing `[A-Za-z0-9_-]` run, by a backward scan (D-4312; FR1-b: the unanchored `/[A-Za-z0-9_-]+$/`
 *  it replaces is quadratic in the length of an EARLIER run, one crafted sidecar costing minutes under the write
 *  lock). Same result as that regex on every input; linear. */
function dropTrailingRun(s) {
  let k = s.length;
  while (k > 0 && isRunByte(s.charCodeAt(k - 1))) k -= 1;
  return k === s.length ? s : s.slice(0, k);
}

/** A sidecar's index text (§6.2, §8.3; D-4312, history-sidecar-redact-before-cut): the first
 *  `SIDECAR_FTS_BYTES` bytes of its REDACTED text. At most `SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN`
 *  bytes are decoded, redacted raw, their JSON string escapes undone and redacted again (D-4336), and only then cut
 *  to `SIDECAR_FTS_BYTES` UTF-8 bytes, or, when the raw window was filled, to at most the redacted text's length
 *  minus `SIDECAR_REDACT_MARGIN` (an unescape shrinks the text, FR1 round 1) (a cut multi-byte character dropped). A secret that straddles the cut was
 *  matched whole in the window, so no prefix of it reaches the index; a PEM block that starts before the
 *  cut matches to the window's end. When a cut happened (the redacted text ran past the cut, or
 *  `bytes` filled the window, so more of the file may follow) and it fell inside a
 *  `[A-Za-z0-9_-]` run, that trailing partial run is dropped, because a run cut in half is a
 *  prefix no pair or shape can match. `idx` null redacts nothing (`ftsTextOf` calls it so: one cut
 *  rule). `bytes` is the file's first bytes, never more than the window is read. The window and the cut are
 *  `windowText` and `cutIndexText`, which an entry's index text shares (D-4419). */
export function sidecarIndexText(bytes, idx) {
  const w = windowText(bytes, SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN);
  let text = w.text;
  // D-4336 (history-sidecar-index-text-unescaped): redacted RAW, decoded, then redacted again. Decoding first is a
  // parser differential of its own (it can JOIN a secret's registered segments into one run no pair matches, and
  // `\"` changes where the JSON-form context rule sees a value end), so the raw pass runs first; every mark it
  // writes is REDACTED_MARK, which holds no backslash, so the decode cannot alter one. The second pass catches what
  // an escape letter glued onto a secret hid from the first. The union of both readings is redacted. Deeper readings
  // are redactForIndex's (D-4343): a nested JSON level or a backslash-u-005c chain glues an escape letter onto a
  // secret one decode later, and the last redaction below reads every remaining level, keeping a deeper reading only
  // when it redacted something.
  if (idx !== null) text = redactIndexReading(text, idx);
  text = unescapeJsonText(text);
  if (idx !== null) text = redactForIndex(text, idx);
  return cutIndexText(text, w.windowCut, SIDECAR_FTS_BYTES, SIDECAR_REDACT_MARGIN);
}

/** The first `window` bytes of `bytes` decoded as UTF-8, and whether they filled the window: the window half of the one
 *  cut rule both index texts share (D-4312, D-4419). A window cut inside a multi-byte character decodes to one U+FFFD,
 *  which is dropped. */
function windowText(bytes, window) {
  const windowCut = bytes.length >= window;
  const part = bytes.length > window ? bytes.subarray(0, window) : bytes;
  const text = new TextDecoder('utf-8').decode(part);
  return { text: windowCut ? text.replace(/\uFFFD$/, '') : text, windowCut };
}

/** The cut half of that one rule (D-4312, D-4336; D-4419 for an entry's text): `text`, already redacted, cut to `ftsBytes`
 *  UTF-8 bytes, or, when its raw window was filled, to at most its length minus `margin`, a cut multi-byte character
 *  dropped; a cut inside a `[A-Za-z0-9_-]` run drops that trailing partial run, because a run cut in half is a prefix
 *  no pair or shape can match. */
function cutIndexText(text, windowCut, ftsBytes, margin) {
  const enc = new TextEncoder().encode(text);
  // The window is raw bytes but `text` is the unescaped, redacted text, which an escape-dense JSON sidecar shrinks
  // by a byte per escape. A full window is the only case that can end in a secret redaction saw a prefix of, so the
  // cut keeps `margin` bytes of redacted text behind it: min(cut, length - margin) (D-4336, D-4312;
  // FR1 round 1 F1: a JWT straddling the raw window end leaked its header and payload past a cut that sat inside it).
  const cutAt = windowCut ? Math.max(0, Math.min(ftsBytes, enc.length - margin)) : ftsBytes;
  if (enc.length <= cutAt) return text;
  let out = new TextDecoder('utf-8').decode(enc.subarray(0, cutAt)).replace(/\uFFFD$/, '');
  if (cutAt > 0 && isRunByte(enc[cutAt - 1]) && isRunByte(enc[cutAt])) out = dropTrailingRun(out);
  return out;
}

/** Every FTS index text the sweep writes or re-derives (D-4419, history-entry-index-text-windowed; final review 316 FP2,
 *  FP7): `redactForIndex` over the text's first ENTRY_FTS_BYTES + ENTRY_REDACT_MARGIN UTF-8 bytes, then cut to
 *  ENTRY_FTS_BYTES by the sidecar's rule (`cutIndexText`), so one text's redaction reads at most the window, whatever
 *  the line's length. ingest's indexBlob, the backfill, the phrase fast path and the re-derivation all call it, so they
 *  index one text (D-4344's premise). A sidecar's text, `sidecarIndexText`'s, is shorter than the window and is
 *  redacted whole. Text past the cut is not searchable. */
export function entryIndexText(text, idx) {
  const window = ENTRY_FTS_BYTES + ENTRY_REDACT_MARGIN;
  // Every UTF-16 code unit is at least one UTF-8 byte, so the window's bytes lie in the text's first `window` units.
  const w = windowText(new TextEncoder().encode(text.length > window ? text.slice(0, window) : text), window);
  return cutIndexText(redactForIndex(w.text, idx), w.windowCut, ENTRY_FTS_BYTES, ENTRY_REDACT_MARGIN);
}

/** The second belt (§8.3), per-segment primitive: the field pass's layers once more over ONE piece of text that has no
 *  structure of its own to protect, with layer 2 in its structure-safe final form, D-4613
 *  (history-final-belt-layer2-structure-safe) (CONTEXT_RULES: no value class consumes a backslash, a line break, `<`,
 *  `>` or `&`). It is idempotent on the field pass's marks (`TOKEN=[redacted]` is returned as it came). It must
 *  NEVER be run over serialised `--json` or over a whole human page: a pass over serialised structure cannot be made
 *  safe by value classes (the escape-stripped reading can run an ANSI-shaped span across a quote, a frame tag or a
 *  line, rounds 1 and 2). The callers are `redactFinalJson` (every string leaf of the envelope value, in the FIELD
 *  form) and `redactFinalText` (each line segment and each frame-tag attribute value, in this form). */
export function redactFinal(text, idx) {
  return redactFieldIn(text, idx, 'final');
}

/** The final belt over a `--json` envelope, D-4613 (whole-branch fix round 3): the VALUE is deep-mapped BEFORE it is
 *  serialised, so no pass ever reads serialised structure. Every string leaf goes through BOTH passes, `redactFinal(
 *  redactField(leaf))` (fix round 5: a raw string has no structure to protect, so the final form is safe on it, and the
 *  field form's value class can run through `<` or `>` and past a context key that the final form's stops still see:
 *  `see: <a>password=x</a>`); numbers, booleans and null pass through;
 *  object KEYS are never touched (they are field and counter names fixed in code). The caller serialises the result
 *  with `JSON.stringify`, so the envelope's escaping is the serialiser's own and `--json` is valid whatever a leaf
 *  holds. Residuals: a secret an object KEY would carry is not masked (no key is data); a leaf the field form cannot
 *  mask is no worse than the field pass was. */
export function redactFinalJson(value, idx) {
  if (typeof value === 'string') return redactFinal(redactField(value, idx), idx);
  if (Array.isArray(value)) return value.map((v) => redactFinalJson(v, idx));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactFinalJson(v, idx)]));
  }
  return value;
}

/** The final belt over lines the CLI never framed (an error line, a relayed operator line, a refusal line), D-4613
 *  (whole-branch fix round 6), D-5021 (fix round 1, review 441 F2): the field pass and then ONE whole-text `redactFinal`
 *  pass, `redactFinal(redactField(text))`, as `redactFinalJson` runs them per string leaf, with no line split and no
 *  frame-tag split. Unframed text has no structure to protect, so nothing here needs a cut: a JSON-form pair whose value
 *  is on the next line and a PEM block that spans lines are matched whole (round 5's per-line split lost both), and text
 *  that merely looks like a frame tag (`<ccrc-recall TOKEN="x">`) is plain text whose context key is seen with its
 *  quoted value. The final form's value classes never cross a line, so no rule runs a value over a break; but they
 *  also stop at `<`, `>`, `&`, `"` and a backslash, so a secret holding one of those printed its tail (`"token": "ab<cd"`
 *  came back unchanged). This is the only redaction such text receives, so it must mask whatever `redactField`
 *  masks: the field pass runs first. Every caller treats its result as text for a person and never parses it (the relay
 *  holds back and parses the sweep's `{"rc"` line from the RAW line, before any emit), so over-masking by the field
 *  form's wider value classes costs a reader a few characters and breaks no structure. It is idempotent on the field
 *  pass's marks. `redactFinalText` (tag-aware) stays for the human page, which recallEnvelope frames. */
export function redactFinalLines(text, idx) {
  return redactFinal(redactField(text, idx), idx);
}

/** A frame tag of the recalled-text envelope (recallEnvelope's opening and closing tag). escapeXmlAttr has escaped every
 *  attribute value, so a real tag holds no raw `>` or `"` inside a value. */
const FRAME_TAG_RE = /<\/?ccrc-recall\b[^>]*>/g;

/** The final belt over human text (a page, one stderr line, one relayed line), D-4613 (whole-branch fix rounds 3 and 4): the
 *  text is split at each `\n` (the break itself is never given to a pass) and, within a line, around frame tags; every non-tag segment
 *  goes through `redactFinal` on its own, and so does every part of a tag: each quoted attribute value (already escaped
 *  by `escapeXmlAttr`, so no raw quote inside) and each run of text between them, the tag's name and attribute names
 *  included, so no character of the line escapes every pass (a forged `<ccrc-recall password: x>` in an error line or a
 *  relayed line is masked). A real tag's names and spaces match no rule and come back unchanged. No segment spans a
 *  line or a tag, so neither an ANSI-shaped span nor a context value can cross one: the frame lines, the tags,
 *  `shown K of N` and the `next:` line survive whatever a field holds. A fixed point on a page built from the field
 *  pass's output. Residual: a secret split by a line break or a tag is masked only by the field pass, which saw it
 *  whole. */
export function redactFinalText(text, idx) {
  return text.split('\n').map((line) => {
    let out = '';
    let last = 0;
    for (const m of line.matchAll(FRAME_TAG_RE)) {
      out += redactFinal(line.slice(last, m.index), idx);
      let at = 0;
      for (const q of m[0].matchAll(/"([^"]*)"/g)) {
        out += `${redactFinal(m[0].slice(at, q.index), idx)}"${redactFinal(q[1], idx)}"`;
        at = q.index + q[0].length;
      }
      out += redactFinal(m[0].slice(at), idx);
      last = m.index + m[0].length;
    }
    return out + redactFinal(line.slice(last), idx);
  }).join('\n');
}

// ===========================================================================
// The harness table and the export's horizon (spec §6.10 item 3, §9.15).
// B1 ships the due rule and its census so doctor reports the gap before the
// export writer (B4) exists; nothing here reads a file — the sweep measures
// each settings file as `absent`, `unreadable` or its text, and passes it in.
// ===========================================================================

/** Claude Code's retention default when no file sets `cleanupPeriodDays`
 *  ("default: 30", M), and the value of a home never measured. */
export const CLAUDE_CODE_DEFAULT_RETENTION_DAYS = 30;

const EXPORT_DAY_MS = 86400000;

/** One settings file's `cleanupPeriodDays`: absent (no file, or no key), a
 *  positive integer, or bad (unparseable JSON, a non-object, or a value that
 *  is not a positive integer — Claude Code's schema says "Minimum 1"). */
function retentionKey(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    return { state: 'bad' };
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { state: 'bad' };
  if (!Object.hasOwn(o, 'cleanupPeriodDays')) return { state: 'absent' };
  const v = o.cleanupPeriodDays;
  return Number.isSafeInteger(v) && v >= 1 ? { state: 'days', days: v } : { state: 'bad' };
}

/** Claude Code's `retention` reader (§9.15): the smallest `cleanupPeriodDays`
 *  over the home's `settings.json` and every system managed-settings file
 *  (`managed-settings.json` and each `managed-settings.d/*.json`), because
 *  whichever source Claude Code's merge ranks first, the minimum is never
 *  later than it. No file setting the key means the default. An unreadable
 *  file, or a bad value in any of them, is `unmeasured`: the home keeps its
 *  last measured value (`lastDays`), and only a home never measured counts as
 *  the default — Claude Code itself skips its cleanup on such a file, so
 *  keeping the last value errs no later than Claude Code does.
 *  D-4210 */
export function claudeCodeRetention({ home, managed, lastDays }) {
  const values = [];
  for (const f of [home, ...managed]) {
    if (f.state === 'absent') continue;
    const k = f.state === 'text' ? retentionKey(f.text) : { state: 'bad' };
    if (k.state === 'bad') return { days: lastDays ?? CLAUDE_CODE_DEFAULT_RETENTION_DAYS, state: 'unmeasured' };
    if (k.state === 'days') values.push(k.days);
  }
  if (values.length === 0) return { days: CLAUDE_CODE_DEFAULT_RETENTION_DAYS, state: 'default' };
  return { days: Math.min(...values), state: 'measured' };
}

/** The harness table (§6.10 item 3): one frozen row per harness, keyed by
 *  name; `HARNESSES` is derived from its keys, never declared apart (the
 *  `PR_REASONS` precedent). W1 ships one row, `claude-code`, holding one
 *  member, `retention`: the arm's other six members stay text until the first
 *  adapter dispatches through them (rev 3.2 review, FE19).
 *  D-4209 */
export const HARNESS_TABLE = Object.freeze({
  'claude-code': Object.freeze({ retention: claudeCodeRetention }),
});
export const HARNESSES = Object.freeze(Object.keys(HARNESS_TABLE));

/** The smallest retention over the harness's rostered homes; the default when
 *  no home was measured at all. */
export function shortestRetention(homeRetentionDays) {
  const v = Object.values(homeRetentionDays);
  return v.length === 0 ? CLAUDE_CODE_DEFAULT_RETENTION_DAYS : Math.min(...v);
}

/** The home a file's due date is read against when several rostered homes' `projects/` trees contain it (two homes
 *  whose `projects/` resolve to one real tree): the one with the SHORTEST retention, the first listed on a tie, and
 *  null when none contains it. The home that deletes the file soonest is the one the export must beat, so a roster that
 *  lists a longer home first can no longer push the due date past the shorter home's deletion. A home with no measured
 *  retention reads as Claude Code's 30-day default, as `fileDueMs` does.
 *  D-4612 (history-export-file-home-shortest-of-containing) */
export function shortestRetentionHome(containing, homeRetentionDays) {
  let best = null;
  let bestDays = Infinity;
  for (const h of containing) {
    const days = homeRetentionDays[h] ?? CLAUDE_CODE_DEFAULT_RETENTION_DAYS;
    if (days < bestDays) { best = h; bestDays = days; }
  }
  return best;
}

/** The reducers `planExport` may take (§9.15). A reducer answers, for one candidate row, the time in ms since the
 *  epoch at which it falls due: the row is due exactly when that time is before now, and `-Infinity` means nothing
 *  holds it back. B1's reducers answered a retention in days against one row clock, which the per-copy rule cannot
 *  be: it reads each holding file's own clock. The TypeScript type and `planExport`'s signature are B1's, unchanged
 *  (ruled Q15, rev 3.4: one reducer, no signature change).
 *  - `perCopy`, the default from W1-B2 (D-4735 (history-export-due-per-copy)): the latest due date over the row's holding
 *    files on disk, each file's mtime plus its OWN home's horizon. A file gone from disk has passed its date, and a
 *    row with no holding file on record has no clock, so is due at once. It never reads the row's own time.
 *  - `shortestHome`, B1's default and now history: the row clock plus the horizon of the shortest retention over
 *    every rostered home, whatever homes hold the row. Kept as a CONTROL, here and in W1-B4. */
export const EXPORT_REDUCERS = Object.freeze({
  shortestHome: (c, homeRetentionDays) => rowClockMs(c) + exportHorizonDays(shortestRetention(homeRetentionDays)) * EXPORT_DAY_MS,
  perCopy: perCopyDueMs,
});

/** The horizon: retention minus `EXPORT_MARGIN_DAYS`, floored at 0. */
export function exportHorizonDays(retentionDays) {
  return Math.max(0, retentionDays - EXPORT_MARGIN_DAYS);
}

/** The row clock (§9.15, history since W1-B2; D-4208): the row's `ts_ms`, or, when that
 *  is NULL, the mtime of the newest file holding it — deliberately the opposite of prune, where NULL is "never old":
 *  here "never" would never copy it. A row with no time and no holding file has no clock at all, `-Infinity`: the
 *  export errs early, never late (plan-chosen). `shortestHome` alone reads it. */
function rowClockMs(c) {
  if (c.tsMs !== null) return c.tsMs;
  if (c.files.length === 0) return Number.NEGATIVE_INFINITY;
  return Math.max(...c.files.map((f) => f.mtimeMs));
}

/** One holding file's due date (§9.15): its mtime plus its own home's horizon; a home not measured reads as Claude
 *  Code's 30-day default, the overdue test's own fallback. */
function fileDueMs(f, homeRetentionDays) {
  return f.mtimeMs + exportHorizonDays(homeRetentionDays[f.home] ?? CLAUDE_CODE_DEFAULT_RETENTION_DAYS) * EXPORT_DAY_MS;
}

/** `EXPORT_REDUCERS.perCopy` (§9.15 "A row is due"; D-4735 (history-export-due-per-copy), ruled Q15): a row is due when
 *  every one of its holding files has passed its due date. Its holding files are B1's per-row set, its
 *  transcript's (D-4248), which the ruling keeps. */
function perCopyDueMs(c, homeRetentionDays) {
  let at = Number.NEGATIVE_INFINITY;   // no holding file on disk or on record: nothing holds the row back
  for (const f of c.files) {
    if (!f.present) continue;   // a file gone from disk has passed its date
    at = Math.max(at, fileDueMs(f, homeRetentionDays));
  }
  return at;
}

/** The export's due and overdue sets (§9.15). A blob is DUE when every referrer is: the reducer's due time is
 *  before now (default: the per-copy rule since W1-B2). It is OVERDUE — measured source loss, doctor's FAIL — when it
 *  is due and every holding file of every referrer is gone from disk or past its own deletion date by the file clock
 *  (its mtime plus its home's retention). A blob with no referrer is neither. `horizonDays` stays the shortest
 *  home's horizon, which `status` prints and the default rule no longer reads.
 *  D-4207 */
export function planExport({ nowMs, homeRetentionDays, blobs, reducer = EXPORT_REDUCERS.perCopy }) {
  const due = [];
  const overdue = [];
  let oldestDueSinceMs = null;
  for (const blob of blobs) {
    if (blob.referrers.length === 0) continue;
    const isDue = blob.referrers.every((r) => reducer(r, homeRetentionDays) < nowMs);
    if (!isDue) continue;
    due.push(blob.key);
    // W1-B4: when this blob fell due — when its LAST referrer fell due, by the reducer's own due time (B2's per-copy
    // default, B2's D-4735 (history-export-due-per-copy)), a referrer due from the start dated by its recorded files — and the
    // earliest over every DATED due blob, which doctor's wait rule reads from the census (§9.15 "The gap guard",
    // "How long a due blob has waited"). A blob with an undated referrer dates by its dated ones (the early side);
    // one with none stays due and counted, undated, and never stands in for the epoch.
    let since = null;
    for (const r of blob.referrers) {
      const t = dueSinceMs(r, homeRetentionDays, reducer);
      if (t !== null && (since === null || t > since)) since = t;
    }
    if (since !== null && (oldestDueSinceMs === null || since < oldestDueSinceMs)) oldestDueSinceMs = since;
    const gone = blob.referrers.every((r) => r.files.every((f) => !f.present || fileDeletionMs(f, homeRetentionDays) < nowMs));
    if (gone) overdue.push(blob.key);
  }
  return { horizonDays: exportHorizonDays(shortestRetention(homeRetentionDays)), due, overdue, oldestDueSinceMs };
}

/** The file clock (§9.15): when Claude Code's own cleanup deletes a holding file, its mtime plus ITS home's
 *  retention (the default for a home never measured). The one definition of that rule: `planExport`'s overdue test
 *  and `exportDates` both read it. */
function fileDeletionMs(f, homeRetentionDays) {
  return f.mtimeMs + (homeRetentionDays[f.home] ?? CLAUDE_CODE_DEFAULT_RETENTION_DAYS) * EXPORT_DAY_MS;
}

/** One W1-k holder's date (§9.15 "If B4 slips"): its due time by the reducer, or, when the reducer answers
 *  `-Infinity` (nothing on disk holds it back: every holding file gone, or none on record), a real clock on the early
 *  side rather than a sentinel. That is the last write any of its RECORDED files saw (a gone file keeps its recorded
 *  mtime), since it cannot have fallen due before then; with no file on record, its oldest unexported row's time.
 *  For the date only: the holder stays due. Null for a holder with neither, which ingest cannot make (every row
 *  arrives through a file). */
function holderDueDateMs(h, homeRetentionDays, reducer) {
  const at = reducer(h, homeRetentionDays);
  if (at !== Number.NEGATIVE_INFINITY) return at;
  if (h.files.length > 0) return Math.max(...h.files.map((f) => f.mtimeMs));
  return h.tsMs;
}

/** The census's W1-k dates (§9.15), decided here so the sweep only delivers them (Task 26F item 7):
 *  - `firstDueMs`: the earliest holder date (holderDueDateMs), by the reducer (default: the per-copy rule since
 *    W1-B2), over the HOLDERS: one candidate per transcript that holds an unexported row (its oldest such row's time,
 *    and its holding files). Rounded to a whole millisecond; null when no holder has a clock (no unexported row).
 *    Never 0 for "due since an unknown time": that value would sit beside real dates in one field.
 *  - `firstDeletionMs`: the earliest deletion date by the FILE clock over the files still present, rounded to a
 *    whole millisecond; null when none is present. A file that is gone has no deletion date: it is already lost.
 *  `files` is every holding file the census measured, each already assigned its home. */
export function exportDates({ homeRetentionDays, holders, files, reducer = EXPORT_REDUCERS.perCopy }) {
  let first = null;
  for (const f of files) {
    if (!f.present) continue;
    const at = fileDeletionMs(f, homeRetentionDays);
    if (first === null || at < first) first = at;
  }
  let due = null;
  for (const h of holders) {
    const at = holderDueDateMs(h, homeRetentionDays, reducer);
    if (at === null) continue;
    if (due === null || at < due) due = at;
  }
  return {
    firstDueMs: due === null ? null : Math.round(due),
    firstDeletionMs: first === null ? null : Math.round(first),
  };
}

/** The census's candidate prefilter (§9.15; D-4735 (history-export-due-per-copy)): the keys of the transcripts whose
 *  rows can be due now. A row's holding files are its transcript's
 *  (D-4248), and the per-copy rule never reads a row's own time, so every row
 *  of one transcript falls due at one instant, its transcript's; a blob none of whose referrers sits in a due
 *  transcript cannot be due. Exact for any reducer that reads no row time; planExport still decides each blob. */
export function dueTranscriptKeys({ nowMs, homeRetentionDays, transcripts, reducer = EXPORT_REDUCERS.perCopy }) {
  const out = [];
  for (const t of transcripts) if (reducer({ tsMs: null, files: t.files }, homeRetentionDays) < nowMs) out.push(t.key);
  return out;
}

/** Doctor's `retention-lowered` input (§9.15): when the homes disagree, the
 *  home that sets the node's minimum (the first by name on a tie), its value,
 *  and the next value above it. Null when no home's value is above the
 *  minimum (one home, or all agree): nothing was lowered relative to anything. */
export function retentionLowered(homeRetentionDays) {
  const entries = Object.entries(homeRetentionDays).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const days = Math.min(...entries.map(([, d]) => d));
  const above = entries.map(([, d]) => d).filter((d) => d > days);
  if (above.length === 0) return null;
  const home = entries.find(([, d]) => d === days)[0];
  return { home, days, othersMin: Math.min(...above) };
}

/** What each schema version added (§6.11, BK13): its tables, each with the
 *  columns it added in declaration order, and whether its migration is heavy
 *  (backfills or indexes a large table, so `planMigration` counts the copy
 *  twice). v1 is the whole schema. A later version lists only what it adds —
 *  migrations are additive only — and the CLI builds its named-column queries
 *  for a store's own version from the union up to it. Spelled once, here;
 *  history-store.test.ts holds it equal to the DDL store.mjs runs. */
export const SCHEMA_ADDED = Object.freeze({
  1: Object.freeze({
    heavy: false,
    tables: Object.freeze({
      meta: Object.freeze(['k', 'v']),
      sessions: Object.freeze(['session_pk', 'ccrc_id', 'generation', 'project', 'first_seen_ms', 'merged_into']),
      epochs: Object.freeze(['session_pk', 'seq', 'cc_session_uuid', 'cause', 'declared_by', 'started_ms', 'cwd',
        'git_branch', 'cwd_real', 'confirmed_ms']),
      epoch_candidates: Object.freeze(['cc_session_uuid', 'ccrc_id', 'generation', 'cause', 'ts_ms', 'first_seen_ms']),
      transcripts: Object.freeze(['transcript_pk', 'cc_session_uuid', 'harness', 'agent_id', 'parent_tool_use_id',
        'workflow_run_id', 'agent_type']),
      ingest_files: Object.freeze(['file_id', 'dev', 'ino', 'source_key', 'transcript_pk', 'size', 'mtime_ns',
        'birth_ns', 'head_sha256', 'offset', 'tail_sha256', 'status', 'eof_ms', 'retry_attempts', 'next_attempt_ms',
        'last_error_code', 'last_error_offset', 'parser_version']),
      file_paths: Object.freeze(['path', 'file_id', 'last_seen_ms']),
      blobs: Object.freeze(['blob_id', 'sha256', 'codec', 'z', 'raw_len', 'fts_indexed', 'pruned_ms', 'exported_ms',
        'exported_seg']),
      entries: Object.freeze(['entry_id', 'uuid', 'transcript_pk', 'type', 'subtype', 'role', 'model', 'parent_uuid',
        'ts_ms', 'request_id', 'api_block_index', 'msg_id', 'source_tool_use_id', 'tool_name', 'is_compact_summary',
        'provenance', 'prov_version', 'parse_state', 'struct_rank_ns', 'struct_file_id', 'exported_ms', 'exported_seg',
        'blob_id']),
      memberships: Object.freeze(['file_id', 'entry_id', 'line']),
      entry_variants: Object.freeze(['entry_id', 'blob_id', 'first_file_id', 'first_seen_ms', 'cause']),
      boundaries: Object.freeze(['entry_id', 'transcript_pk', 'ord', 'trigger', 'head_uuid', 'anchor_uuid', 'tail_uuid',
        'kept_blob_id', 'pre_tokens', 'post_tokens', 'duration_ms']),
      sidecars: Object.freeze(['transcript_pk', 'name', 'blob_id', 'entry_id', 'first_seen_ms']),
      sidecar_seen: Object.freeze(['path', 'size', 'mtime_ns', 'blob_id']),
      nodes: Object.freeze(['node_id', 'session_pk', 'epoch_seq', 'transcript_pk', 'kind', 'depth', 'status', 'gist',
        'topics', 'summary_blob_id', 'boundary_entry_id', 'span_start_uuid', 'earliest_ms', 'latest_ms', 'src_chars',
        'desc_count', 'desc_chars', 'directive_flag', 'capped', 'parser_version', 'created_ms']),
      node_sources: Object.freeze(['node_id', 'entry_id', 'ord']),
      node_children: Object.freeze(['node_id', 'child_id', 'ord']),
      node_refs: Object.freeze(['node_id', 'kind', 'value', 'origin']),
      redact_hashes: Object.freeze(['len', 'sha256', 'first_seen_ms']),
      spool_receipts: Object.freeze(['event_key', 'payload_sha', 'received_ms', 'ts_ms', 'ts_source']),
      ticks: Object.freeze(['tick_id', 'ts_ms', 'lag_ms', 'bytes', 'files_behind', 'bytes_behind']),
      recall_calls: Object.freeze(['event_key', 'ccrc_id', 'generation', 'ts_ms', 'verb', 'rc', 'ms', 'arm']),
      steer_receipts: Object.freeze(['event_key', 'ccrc_id', 'cc_session_uuid', 'leaf_id', 'ts_ms']),
      derivation_state: Object.freeze(['step', 'version', 'cursor', 'completed_ms']),
      breaker: Object.freeze(['key', 'consecutive_fail', 'open_until_ms']),
      counters: Object.freeze(['name', 'n']),
      journal_outbox: Object.freeze(['seq', 'rec']),
    }),
  }),
  // D-5015, D-5019, D-5020: no table, no column. Its one migration (store.mjs MIGRATIONS[1]) is four index builds: the owed-row partial
  // index on blobs, the covering entries(blob_id, provenance) index, and the two node indexes derivation used to make unversioned.
  // `heavy: true` is coordinator ruling 5012, under §6.11's definition ("backfills or indexes a large table"): v2 indexes blobs and
  // entries, and the builds read every blob row, so `planMigration` counts the copy twice. It was first ruled light (mail 4901), on the
  // builds reading the very tables the pre-migration snapshot copy has just read, so that they find them in the page cache. That holds
  // only while the cache holds the store. The builds do not write "a small share" of a healthy store: the partial index holds every blob
  // still unindexed with bytes, about half of a real store (harness rows alone are 48-57% of real transcripts' rows), and
  // entries_blob_prov one row per entry. MEASURED, cache held the store: a 479 MB store (review 441): copy 7.1 s, builds and commit
  // 1.75 s; a 351 MB store here: copy 5.2-6.3 s, the whole migration 5.9-6.9 s, 351 MB read. MEASURED, cache did NOT hold it (a 657 MB
  // store on a loaded box): copy 34-36 s, the whole migration 101-180 s, 1.46-2.25 GB read against the copy's 0.75 GB, because the
  // partial index re-reads every blob row (fts_indexed sits after the z BLOB, so the overflow chains are walked) and entries_blob_prov
  // scans entries. Against the default-rate estimate a first migration uses (no recorded copy_bps), that run took 1.5-2.7x the
  // estimate counted once, which a heavy v2 doubles. The consequence is intended: a store over about 1.5 GB answers snapshot-needs-op
  // on a scheduled pass, and the operator's `ccrc history doctor --migrate` runs it once, under --op, with no carrier kill.
  2: Object.freeze({ heavy: true, tables: Object.freeze({}) }),
});

/** The heavy versions a migration from `stored` to `code` crosses (§6.11, ruling 5012): every version above the stored one up to the
 *  code's whose SCHEMA_ADDED entry is `heavy`. `planMigration` doubles its copy estimate when there is one, and sweep's
 *  `migrationVerdict` finds them by the same walk; doctor's `migration-needs-op` line calls this, so the estimate it prints is the
 *  one the verdict used and no factor is hand-kept. An unmeasured stored version (null) crosses none: nothing is said of it. */
export function heavyVersionsBetween(stored, code, schemaAdded = SCHEMA_ADDED) {
  const out = [];
  if (!Number.isInteger(stored)) return out;
  for (let v = stored + 1; v <= code; v += 1) if (schemaAdded[v]?.heavy === true) out.push(v);
  return out;
}

/** The schema version this code writes and reads: SCHEMA_ADDED's highest key,
 *  so a store's creation stamp, the writer's verdicts and the CLI's reads agree
 *  by construction. history-store.test.ts holds `MIGRATIONS.length` (the
 *  migrations the writer can run) equal to it. */
export const SCHEMA_VERSION = Math.max(...Object.keys(SCHEMA_ADDED).map(Number));

/** What a pass that does NOT run its tick prints and exits with (§5.3, §9.10;
 *  rev 3.2 review, IV2): `history-sweep: <word>` and an exit code.
 *
 *  Exit 0 for a pass that ended as designed — the switch, the server role (no
 *  store is ever made there), an unreachable volume, a journal that could not
 *  be written while no DB was open — and for EVERY migration hold, so a timer
 *  unit stays green through a pause it cannot help. `migration-refused` clears
 *  once there is room; `migration-needs-op` waits on the operator's
 *  `ccrc history doctor --migrate`, and doctor, not the unit's exit, carries
 *  that FAIL and its remedy (§6.11). Exit 5 (EXIT.DB) for a store the writer
 *  refuses until the OPERATOR repairs it: a binding refusal, a newer schema, a
 *  store that will not take WAL. A held migration prints its own word (doctor
 *  reads the same word from the store's meta). Any other word is a bug in the
 *  caller, so it throws. */
export function passOutcome(word) {
  switch (word) {
    case 'off':
    case 'held':
    case 'store-create-refused-role':
    case 'store-unreachable':
    case 'journal-unwritable':
      return { word, exit: EXIT.OK };
    case 'migrated':             // a pass that migrated did its whole work (Task 24)
    case 'migration-refused':
    case 'migration-needs-op':   // waits on the operator, but doctor carries it, not the exit
      return { word, exit: EXIT.OK };
    default:
      if (PASS_WORDS.includes(word)) return { word, exit: EXIT.DB };
      throw new Error(`passOutcome: '${word}' is not a pass word`);
  }
}

// ---------------------------------------------------------------------------------------------
// Row-shape helpers the ingest needs (§9.2 step 4; plan task 19). Pure: the sweep reads files,
// these read the parsed rows it hands them.
// ---------------------------------------------------------------------------------------------

/** The row types `blobBodyOf` has a rule for (§6.2 "What a blob holds"). A stored row of any
 *  other type is kept, provenance `harness`, and counted `unknown_type` (§6.5, DM24). */
export const ROW_TYPES = Object.freeze(['user', 'assistant', 'system', 'attachment']);

/** `entries.parse_state`, by name: a row parsed into its columns, or a line stored raw (malformed,
 *  not an object, or longer than LINE_MAX), which never fails or wedges its file (§9.2 step 4).
 *  DERIVED from Task 3's ENTRY_PARSE_STATES, the one spelling of the two words (O14). */
export const PARSE_STATE = Object.freeze({ ok: ENTRY_PARSE_STATES[0], rawOnly: ENTRY_PARSE_STATES[1] });

/** The columns of a raw-only row: no type of its own, `harness` provenance (never searchable,
 *  §6.2), and the raw-only parse state. */
export const RAW_ROW = Object.freeze({ type: '', provenance: 'harness', parseState: PARSE_STATE.rawOnly });

/** `entries.prov_version`: the version of the provenance rules a row was classified under, so a
 *  change to `provenanceOf` can find the rows it has not re-read (§6.2, §11 L9). */
export const PROV_VERSION = 1;

/** A streaming sha256, for the adapter that hashes what it never holds whole (store.mjs's
 *  compressFdRange). lib is the ring's node:crypto importer, so the hash comes from here. */
export function newSha256() {
  return createHash('sha256');
}

/** The tool_use blocks of a content array (an assistant row's blob body): id, name, and the
 *  command when `input.command` is a string — what provenanceOf's recall-echo rule reads. */
export function toolUsesOf(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (b === null || typeof b !== 'object' || b.type !== 'tool_use' || typeof b.id !== 'string') continue;
    const u = { id: b.id, name: typeof b.name === 'string' ? b.name : '' };
    if (b.input !== null && typeof b.input === 'object' && typeof b.input.command === 'string') u.command = b.input.command;
    out.push(u);
  }
  return out;
}

/** The `tool_use_id`s that a content array's tool_result blocks answer. */
export function toolResultIdsOf(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (b !== null && typeof b === 'object' && b.type === 'tool_result' && typeof b.tool_use_id === 'string') out.push(b.tool_use_id);
  }
  return out;
}

/** The row key of a line stored raw-only. It carries no uuid of its own, so it is keyed by its
 *  transcript and the sha256 of its bytes (§6.10 item 2's `'x' + 32 hex` form, domain
 *  `ccrc-raw/v1`), never by a line ordinal: two identical malformed lines in one transcript are
 *  one row with one membership per copy. */
export function rawRowKey(ccSessionUuid, rawShaHex) {
  return `x${digestText('ccrc-raw/v1', [ccSessionUuid, rawShaHex]).slice(0, 32)}`;
}

/** An epoch's launch facts, kept once from its first uuid row (§2: `cwd` and `gitBranch` once per
 *  epoch; §6.2 `epochs`). */
export function launchFactsOf(row) {
  const o = row !== null && typeof row === 'object' ? row : {};
  return {
    cwd: typeof o.cwd === 'string' ? o.cwd : null,
    gitBranch: typeof o.gitBranch === 'string' ? o.gitBranch : null,
  };
}

/** A tick's lag (ticks.lag_ms; W1-b's series, §10.7): how long the oldest message this tick
 *  captured for the FIRST time had waited, from its own timestamp to the tick's start. The sweep
 *  passes only resumed files' timestamps (a first read is discovery, not capture lag; plan task
 *  20). 0 when the tick captured nothing new; null (unmeasured) when it captured rows none of
 *  which carried a timestamp it passes. Never negative: a row stamped ahead of the box's clock
 *  reads 0. */
export function lagOfTick({ tickStartMs, newEntries, minNewTsMs }) {
  if (newEntries === 0) return 0;
  if (minNewTsMs === null) return null;
  return Math.max(0, tickStartMs - minNewTsMs);
}

/** The largest sidecar read whole (§9.2 step 4). Of 103,068 sidecars on the reference box the
 *  largest was exactly 67,108,864 bytes (M, review). A larger one is streamed through Brotli
 *  and a streaming sha256 rather than refused, up to SIDECAR_MAX_BYTES (D-4310). */
export const SIDECAR_WHOLE_MAX = 67108864;

/** The largest sidecar captured at all (D-4310, history-sidecar-size-cap): twice the largest measured
 *  (SIDECAR_WHOLE_MAX). A larger one is decided from its stat, never opened, and counted
 *  `sidecar_too_large`, because the streamed arm holds the whole compressed blob in memory and one
 *  oversized file would OOM every pass under the carrier's MemoryMax. */
export const SIDECAR_MAX_BYTES = 134217728;

/** The entry a sidecar belongs to (§9.2 step 4; history-sidecar-ingest-rules, D-4239): the tool_result
 *  whose text names the file; else the one answering the tool_use whose id is the `toolu_…` name
 *  (any extension dropped); else null, which is counted `sidecar_unlinked`. An unlinked sidecar is
 *  still stored, and still found through its transcript. Candidates come in entry order; the
 *  first match wins. */
export function linkSidecar(name, candidates) {
  for (const c of candidates) if (c.text.includes(name)) return c.entryId;
  const stem = name.replace(/\.[^.]*$/, '');
  if (stem.startsWith('toolu_')) {
    for (const c of candidates) if (c.toolUseIds.includes(stem)) return c.entryId;
  }
  return null;
}

/** How one secret-bearing file is read (§8.3 layer 1):
 *  - `sessions`: sessions.json's idHash records, loaded as (43, sha256) pairs and never as values;
 *  - `env-identifier`: a file the frozen list reads for its identifier-pattern keys only
 *    (ccrc.env, agent.env);
 *  - otherwise the file's own kind (kindOfPath).
 *  `source` is the SECRET_SOURCES entry the file came from, or null for a declared secretsFile. */
export function secretKindOf(source, path) {
  if (source !== null && source.sessionHashes === true) return 'sessions';
  if (source !== null && source.identifierKeysOnly === true) return 'env-identifier';
  return kindOfPath(path);
}

/** A value as ONE FTS5 quoted phrase, which FTS5 tokenises exactly as the index did. A bare MATCH
 *  of a value holding `-` is a syntax error ("no such column", M, 22.16.0; §6.2, SE4). An embedded
 *  `"` is doubled, FTS5's own escape. */
export function ftsPhrase(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** The op marker's one grammar (§9.6 op-running; Task 25): `~/.ccrc/history/op` holds `<verb> <pid> <start_ms>`.
 *  Anything else is null, which a pass treats as stale (it names no live pid) and status reports as no op. */
export function parseOpMarker(text) {
  const m = /^([a-z-]{1,32}) ([1-9][0-9]{0,9}) ([0-9]{1,16})\s*$/.exec(text);
  return m === null ? null : { verb: m[1], pid: Number(m[2]), startMs: Number(m[3]) };
}

/** The pass marker's one grammar (D-5016 `history-doctor-reads-a-live-pass`): `~/.ccrc/history/pass` holds
 *  `<pid> <start_ms> <proc_start> <boot_id>`, written by a scheduled pass under the lock when it starts and removed when
 *  it ends. `proc_start` is field 22 of `/proc/<pid>/stat` (the process's start time, in clock ticks since boot) and
 *  `boot_id` is `/proc/sys/kernel/random/boot_id`: a reused pid has another start time, and a pid from before a reboot
 *  another boot id, so neither can pass for the pass that wrote the marker. Anything else is null. */
export function parsePassMarker(text) {
  const m = /^([1-9][0-9]{0,9}) ([0-9]{1,16}) ([0-9]{1,20}) ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/.exec(text);
  return m === null ? null : { pid: Number(m[1]), startMs: Number(m[2]), procStart: m[3], bootId: m[4] };
}

/** The marker's text for a pass: the grammar above, newline-ended. */
export function formatPassMarker(pid, startMs, identity) {
  return `${pid} ${startMs} ${identity.procStart} ${identity.bootId}\n`;
}

/** The death record's one grammar (D-5026 `history-pass-death-record`): `~/.ccrc/history/pass-died` holds ONE line of JSON,
 *  `{"pid":<int|null>,"start_ms":<int>,"found_ms":<int>,"count":<int>}`. A scheduled pass writes it when it FINDS a pass marker
 *  with no live pass behind it (the dead pass ended without its `finally`: the carrier's kill at 10 min, the OOM killer, a
 *  SIGKILL), and by itself when its body throws (the exception ends it without a tick row), and a pass removes it once its own tick row
 *  is committed. `pid` and `start_ms` are the dead pass's own, from its
 *  marker (`pid` null and `start_ms` an upper bound, the finder's start, when the marker could not be parsed); `found_ms` is the
 *  finder's start; `count` is the deaths recorded since the record was last cleared. It normally equals the deaths since the last
 *  tick (a pass that writes a tick clears the record), and can over-count when a record outlives a tick: a clear that was cut off,
 *  or a death recorded for a pass that had already ticked (a throw after its tick row). The FAIL does not read it: only the record's
 *  start against the last tick decides that. Strict: every field present and typed, `count >= 1`, else null. */
export function parsePassDied(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const int = (x, min) => Number.isSafeInteger(x) && x >= min;
  if (!(v.pid === null || int(v.pid, 1)) || !int(v.start_ms, 0) || !int(v.found_ms, 0) || !int(v.count, 1)) return null;
  return { pid: v.pid, startMs: v.start_ms, foundMs: v.found_ms, count: v.count };
}

/** The record's text: the grammar above, newline-ended. */
export function formatPassDied(pid, startMs, foundMs, count) {
  return `${JSON.stringify({ pid, start_ms: startMs, found_ms: foundMs, count })}\n`;
}

/** A process's start time from the text of `/proc/<pid>/stat`: field 22, counted after the LAST `)` (the comm field in
 *  front of it may hold spaces and parentheses). A process in state `Z` (zombie) or `X` (dead) is not a running pass and
 *  answers null, as does any text that is not that shape. */
export function procStartOf(statText) {
  if (typeof statText !== 'string') return null;
  const close = statText.lastIndexOf(')');
  if (close < 0) return null;
  const fields = statText.slice(close + 1).trim().split(/\s+/);
  // fields[0] is field 3 (the state), so field 22 is fields[19].
  if (fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) || fields[0] === 'Z' || fields[0] === 'X') return null;
  return /^[0-9]{1,20}$/.test(fields[19]) ? fields[19] : null;
}

/** The boot id from the text of `/proc/sys/kernel/random/boot_id`, or null when it is not a UUID. */
export function bootIdOf(text) {
  if (typeof text !== 'string') return null;
  const v = text.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null;
}

/** Whether a pass marker names a pass that is running now (D-5016): ONLY when the marker parsed, the pid's identity was
 *  measured now (`identityNow` is null when it could not be: no /proc, a dead pid, a zombie, an unreadable file) and both
 *  its start time and the boot id equal the marker's. `kill(pid, 0)` is not this test: a reused pid answers it. */
export function decidePassLive(marker, identityNow) {
  return marker !== null && identityNow !== null && identityNow !== undefined
    && identityNow.procStart === marker.procStart && identityNow.bootId === marker.bootId;
}

// ── the health block: every §9.6 rule as a word (history spec §9.6) ───────────
// `status --json` MEASURES, this function DECIDES, and doctor's `_check_history`
// only RELAYS what it returns: the one place a verdict about this box's store
// is taken, so the CLI, doctor and the tests never disagree. Every word it
// emits is a HEALTH_WORDS member in the class HEALTH_WORDS gives it (O14), and
// every detail starts `store <store_id>: ` so per-node doctor output can be
// told apart (§9.6). Pure: no fs, no clock — `nowMs` is an input.
//
// PRECEDENCE, in order:
//   1. THE GRACE IS A PASS, NOT A WARN (D-4168 history-doctor-grace-pass). §9.6
//      step 3 WARNs within two periods of the shim's mtime. A fresh install
//      places the shim and ends with doctor before the timer's first
//      2-minute tick, so every fresh fleet/both install would end with a
//      WARN, and "a fresh install ends green" is an operator ruling
//      (ccrc-install.test.ts pins it). So within SHIM_GRACE_MS of the shim's
//      mtime, and ONLY while no tick has run yet (exit 6, or a bound store
//      with no ticks row), the answer is PASS `first-tick-pending` and
//      nothing else is judged. A box that has ticked is judged by its ticks
//      however fresh its shim (an update re-places it without -p), and the
//      grace never hides a binding refusal (exit 5 is step 2).
//   2. Binding and store refusals (exit 5): one FAIL, the refusal's own word.
//      Nothing else is measurable without the store.
//   3. The states in which no fresh tick is expected
//      (D-4251 history-doctor-state-words): off, recovering (FAIL recovery-stalled
//      when its cursor sat still for RECOVERY_STALL_TICKS while neither the
//      floor nor the off-switch held it), op-running, catching-up and
//      lag-unmeasured. Any of them suppresses the two freshness FAILs.
//   4. The remaining FAILs, then the WARNs, in §9.6's order.

/** Meta keys `status` reads whose WRITERS ship after B1: B2's recovery step
 *  keeps `recover_unmoved_ticks` (ticks since its cursor last moved) and B4's
 *  post-bind check keeps the two export ones. Spelled once, here, for the
 *  producer, the reader and the doctor fixtures that plant them. */
export const HEALTH_META = Object.freeze({
  recoverUnmovedTicks: 'recover_unmoved_ticks',
  exportSegmentNewer: 'export_segment_newer',
  exportSegmentMissing: 'export_segment_missing',
  exportPassMs: 'export_pass_ms',               // W1-B4: when the last export pass ran (doctor's last-pass rule)
  exportDueOldestMs: 'export_due_oldest_ms',    // W1-B4: the census's oldest due-since (doctor's wait rule)
  exportPaused: 'export_paused',                // W1-B4: the export's pause for room on the home filesystem
  // D-5027 (history-held-pass-is-fresh-for-tick-stale): the held arm of a scheduled pass stamps the time it ended (ms).
  heldPassMs: 'held_pass_ms',
});

/** Counters `status` reads for a health word, spelled once for the writer (sweep.mjs), the reader (cli.mjs) and the
 *  doctor fixtures that plant them. D-4346 (history-permanent-failures-classified). Like `blob_undecodable` and
 *  `drain_rejected`, `spool_displaced`, `spool_blocked` and `spool_unreadable` are never reset by the pass that counts them: W1-B2's re-measure resets or raises them (decideCounterResets, D-4723 (`history-counter-resets-after-cure`)). */
export const HEALTH_COUNTERS = Object.freeze({
  blobUndecodable: 'blob_undecodable',
  drainRejected: 'drain_rejected',
  spoolDisplaced: 'spool_displaced',   // D-4347 (history-planted-entries-never-wedge)
  spoolBlocked: 'spool_blocked',
  spoolUnreadable: 'spool_unreadable',   // FU8 (FP5): a draining file or sidecar a drain could not read, skipped for that pass
});

/** The meta key prefix of each rostered home's retention verdict, `retention_state:<home>` (§9.15): the census writes it,
 *  reconcileRetentionState removes it for a home that left the roster (review 316 F13), and status reads it (cli.mjs
 *  `retention.unmeasured`). Spelled once, here. */
export const RETENTION_STATE_META = 'retention_state:';

const MODE_CHECKED_FILE_ROOTS = Object.freeze(['db', 'card', 'steer', 'journal', EXPORT_DIR]);

/** The mode §9.6 wants for one entry under ~/.ccrc/history, by its
 *  root-relative path (`.` is the root itself): every directory 0700; a file
 *  under db/ (the DB, its sidecars, the writer's temps, backups/), card/,
 *  steer/, journal/ or export/ 0600; anything else unjudged (null) — spool
 *  files, which the hook writes without a fork and the 0700 spool/ protects
 *  (D-4233), and the small binding files. */
export function modeWantOf(rel, kind) {
  if (kind === 'dir') return '0700';
  return MODE_CHECKED_FILE_ROOTS.includes(rel.split('/')[0]) ? '0600' : null;
}

/** Each measured entry whose mode is not the one `modeWantOf` wants. `shown`
 *  is the path to name: for `db/` behind a link, the link's TARGET (§9.3 —
 *  a symlink's own mode always reads 777 and is never judged). */
export function modesWrongOf(entries) {
  const out = [];
  for (const e of entries) {
    const want = modeWantOf(e.rel, e.kind);
    if (want === null) continue;
    const got = (e.mode & 0o777).toString(8).padStart(4, '0');
    if (got !== want) out.push({ path: e.shown, want, got });
  }
  return out;
}

/** `journal-unwritable` measured by its consequence (§9.6: "drained spool
 *  files are being held"): the oldest observation sidecar whose records never
 *  reached the journal is older than TICK_STALE_MS. A file is journaled within
 *  its own drain, so an ordinary one is minutes old at most. cli.mjs measures
 *  the oldest such sidecar's observedMs (null when there is none); this
 *  threshold is the decision, so it lives here (L1), not in the L4 reader. */
export function journalHeldTooLong(oldestUnjournaledMs, nowMs) {
  return oldestUnjournaledMs !== null && nowMs - oldestUnjournaledMs > TICK_STALE_MS;
}

const SWEEP_LOG = 'journalctl --user -u ccd-history-sweep -n 50';

/** One remedy per warn and fail word (§9.6: "every non-PASS line carries a
 *  remedy"). The words whose remedy needs the measured values (a path, a
 *  store id, an estimate) are computed in `remedyFor` below; the text here is
 *  their fallback. No switch name and no store directory is typed here:
 *  SWITCHES and STORE_DB_REL are their one spellings (O13, O14), so a text
 *  naming the store's directory interpolates `~/${STORE_DB_REL}`. */
export const HEALTH_REMEDIES = Object.freeze({
  off: `remove ~/${SWITCHES.off} when capture should resume`,
  recovering: 'none needed: the recovery step runs within each tick\'s budget, and FAILs recovery-stalled if its cursor stops moving',
  'op-running': 'none needed: an operator pass holds the sweep lock, and ticks resume when it exits',
  'catching-up': 'none needed: the backlog is falling every tick',
  'lag-unmeasured': 'none needed: lag is measured once every file has reached its end once',
  'tick-stale': `read the sweep: ${SWEEP_LOG}, and systemctl --user status ccd-history-sweep.timer`,
  'lag-high': `read the sweep: ${SWEEP_LOG}; a backlog drains within each run's budget, a stuck file shows the same lag every tick`,
  'at-cap': 'raise the cap (an integer, in GB), or the operator frees space with ccrc history prune --older-than <age> --apply, from a terminal outside any session',
  'capture-paused-low-disk': 'free space on the store\'s filesystem; capture resumes by itself above the floor',
  'mode-wrong': 'chmod each named path to the mode it wants',
  'schema-newer': 'update this box to the build that wrote the store (ccrc update); this build still reads what it knows',
  'store-not-wal': 'the writer could not put the store in WAL mode: check the store\'s filesystem supports shared memory (a network mount does not), then systemctl --user start ccd-history-sweep',
  'store-unmeasured': 'make store.id, store.id.pending, store.writer and the DB under ~/.ccrc/history readable by this user; nothing is created, adopted or restored meanwhile',
  'recovery-stalled': `read the sweep: ${SWEEP_LOG}`,
  'store-root-dangling': `mount the volume behind ~/${STORE_DB_REL}, or remove the dangling link so the next tick stores on the home filesystem`,
  'store-missing': `the operator runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild, from a terminal outside any session (a leftover history.db-wal or history.db-shm is moved aside first); capture stays held and the journal keeps everything drained meanwhile: do not copy a backup over history.db by hand (that skips the journal replay --restore does and makes --restore refuse)`,
  'store-mismatch': 'this DB belongs to another store (its meta.store_id is not store.id): put the right DB back, or move this one aside',
  'store-unbound': `if the store is another box's, remove the ~/${STORE_DB_REL} link or move the DB aside; if it is this box's, leave it in place and the operator runs ccrc history doctor --adopt, which binds it, from a terminal outside any session (capture stays held until then)`,
  'store-unreachable': `the store's filesystem did not answer: check the mount behind ~/${STORE_DB_REL}`,
  'store-recoverable': 'the operator runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild, which recover from what was found, from a terminal outside any session; or moves that evidence aside to start a new store',
  'store-wal-orphaned': 'move history.db-wal and history.db-shm (and any history.db) aside together; then let the next tick create a store, or restore one',
  'store-zero-byte': `the DB was truncated: ccrc history doctor --restore and --rebuild both refuse while history.db stands, so the operator moves history.db, history.db-wal and history.db-shm aside together, from a terminal outside any session, and then runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild; capture stays held and the journal keeps everything drained meanwhile (do not copy a backup over history.db by hand: that skips the journal replay --restore does)`,
  'store-schema-missing': `the DB has no meta.store_id, so it is not a history store this build can bind: capture stays held and the journal keeps everything drained meanwhile; ccrc history doctor --restore and --rebuild both refuse while history.db is present, so the operator moves history.db, history.db-wal and history.db-shm aside together, from a terminal outside any session, and then runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild (do not copy a backup over history.db by hand: that skips the journal replay --restore does)`,
  'migration-refused': 'free space on the store\'s filesystem: the pre-migration snapshot needs a store\'s size above the floor',
  'migration-needs-op': 'the operator runs ccrc history doctor --migrate, from a terminal outside any session: it runs under no carrier timeout, which a scheduled pass does not',
  'journal-unwritable': 'free space on the home filesystem, or make ~/.ccrc/history/journal writable: drained spool files are held until the journal append succeeds',
  'export-segment-newer': 'update this box to the build that wrote the segment (ccrc update)',
  'export-overdue': 'the store may be the only copy of this text: keep ~/.ccrc/history (never --purge-history), and raise cleanupPeriodDays in each home\'s settings.json (or the managed settings) so Claude Code keeps transcripts until the export writer ships (W1-B4)',
  'status-unreadable': `run ccrc history status --json by hand, and read the sweep: ${SWEEP_LOG}`,
  'fts-unavailable': 'none needed for capture; run Node >= 22.16.0 for FTS5 search',
  'cap-malformed': `write a positive integer (GB) into the cap file, or remove it for the default of ${CAP_DEFAULT_GB}`,
  'redact-source-unreadable': 'make the named secret files readable by this user; a value never yet seen in them goes unredacted meanwhile',
  'cap-near': 'raise the cap before capture pauses at it, or the operator frees space with ccrc history prune --older-than <age> --apply, from a terminal outside any session',
  'breaker-open': `none needed: the breaker closes by itself; read the sweep for why it opened: ${SWEEP_LOG}`,
  'roster-unreadable': 'make ~/.ccrc/accounts.sh readable (ccrc install regenerates it)',
  'root-is-symlink': 'make ~/.ccrc/history a real 0700 directory: only its db/ may be a link',
  'export-due': 'the export writer arrives with W1-B4: until then the text stays on disk until its retention passes, and raising cleanupPeriodDays in each home\'s settings.json keeps transcripts longer',
  'export-paused-low-disk': 'free space on the home filesystem',
  'retention-unmeasured': 'make cleanupPeriodDays readable in the named homes\' settings.json',
  'retention-lowered': 'set cleanupPeriodDays in the named home\'s settings.json to at least the others\' value',
  'export-segment-missing': 'carry the export directory from the box the store came from, or let the rows export again',
  'journal-record-skipped': `none needed if the journal came from a newer build; otherwise read the sweep: ${SWEEP_LOG} (no operator verb clears this count: the journal audit recounts it from the journal each time it runs)`,
  'journal-growth': `read the sweep: ${SWEEP_LOG}; the journal grows faster than twice its estimate`,
  'blob-undecodable': `the store's copy of that text is damaged (storage corruption) and nothing repairs it in place: keep ~/.ccrc/history as it is; the operator runs ccrc history doctor --repair, which checks the store's integrity and re-reads every blob to re-measure this count, from a terminal outside any session`,
  'drain-rejected': `the files are kept in ~/.ccrc/history/spool/.draining/rejected/ and their lines in the journal, and nothing in this build drains them again; the refusal is in the sweep's log: ${SWEEP_LOG}`,
  // D-4347 (history-planted-entries-never-wedge). Re-measured by doctor --repair and a recovery's close, like drain-rejected and blob-undecodable (W1-B2, D-4723 (`history-counter-resets-after-cure`)).
  'spool-planted': `remove a link or file that stands at ~/.ccrc/history/spool itself (the next pass makes the directory again), any FIFO, link, directory or other non-regular node that stands at ~/.ccrc/history/spool/<id>.jsonl (that id spools again once it is gone), and the planted entries under ~/.ccrc/history/spool/.draining/ (each drain's set-asides are under planted/<tickMs>.<pid>/, and their files are kept there undrained); nothing in this build drains a displaced file again; a file the sweep cannot read stays in .draining/ with its .obs sidecar until both are readable by this user (chmod 600, or chown them) or removed, and its id's later files drain once it does; the sweep's log names each one: ${SWEEP_LOG}`,
});

const minutesOf = (ms) => Math.round(ms / 60_000);

/** What the refusal evidence was, for store-recoverable's remedy. */
function evidenceOf(h) {
  const found = [...h.journalStoreDirs.map((d) => `journal/${d}`), ...h.backupsDb.map((b) => `db/backups/${b}`)];
  return found.length > 0 ? found.join(', ') : 'the evidence the refusal found';
}

function remedyFor(word, h) {
  switch (word) {
    case 'at-cap':
      return `raise the cap in ${h.capFile} (an integer, in GB); capture resumes below the cap; or the operator frees space with ccrc history prune --older-than <age> --apply, from a terminal outside any session`;
    case 'cap-near':
      return `raise the cap in ${h.capFile} (an integer, in GB) before capture pauses at it, or the operator frees space with ccrc history prune --older-than <age> --apply, from a terminal outside any session`;
    case 'cap-malformed':
      return `write a positive integer (GB) into ${h.capFile}, or remove the file for the default of ${CAP_DEFAULT_GB}`;
    case 'capture-paused-low-disk':
      return `free space on the filesystem holding ${h.dbPath}; capture resumes by itself once it is above the floor`;
    case 'mode-wrong':
      return h.modesWrong.map((m) => `chmod ${m.want} ${m.path}`).join('; ');
    case 'store-root-dangling':
      return `mount the volume behind ${h.dbPath}, or remove the dangling link ~/${STORE_DB_REL} so the next tick stores on the home filesystem`;
    case 'store-schema-missing':
      return h.userVersion !== null
        ? `the DB holds a store_id but its user_version is below 1, so this build will not read or migrate it as a history store: capture stays held and the journal keeps everything drained meanwhile; ccrc history doctor --restore and --rebuild both refuse while history.db is present, so the operator moves history.db, history.db-wal and history.db-shm aside together, from a terminal outside any session, and then runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild (do not copy a backup over history.db by hand: that skips the journal replay --restore does)`
        : HEALTH_REMEDIES['store-schema-missing'];
    case 'store-missing':
      return h.backupsDb.length > 0
        ? `the operator runs ccrc history doctor --restore ${h.backupsDb[0]} (db/backups holds ${h.backupsDb.join(', ')}; keep them) or ccrc history doctor --rebuild, from a terminal outside any session (a leftover history.db-wal or history.db-shm is moved aside first); capture stays held and the journal keeps everything drained meanwhile: do not copy a backup over history.db by hand (that skips the journal replay --restore does and makes --restore refuse)`
        : 'the operator runs ccrc history doctor --rebuild, which rebuilds from the journal, from a terminal outside any session (a leftover history.db-wal or history.db-shm is moved aside first); capture stays held and the journal keeps everything drained meanwhile (do not copy a backup over history.db by hand: that skips the journal replay --restore does)';
    case 'store-unbound':
      return `if store ${h.storeId ?? '(unknown)'} is another box's, remove the ~/${STORE_DB_REL} link or move the DB aside; if it is this box's, leave it in place and the operator runs ccrc history doctor --adopt, which binds it, from a terminal outside any session (capture stays held until then)`;
    case 'store-recoverable':
      return `the operator runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild, which recover from ${evidenceOf(h)}, from a terminal outside any session; or moves that evidence aside to start a new store`;
    case 'migration-refused':
      return h.thresholdBytes !== null && h.sizeBytes !== null
        ? `free space on the filesystem holding ${h.dbPath} until more than ${h.thresholdBytes + h.sizeBytes} bytes are free (the snapshot needs the store's size above the floor)`
        : HEALTH_REMEDIES['migration-refused'];
    case 'redact-source-unreadable':
      return `make ${h.redactUnreadable.join(', ')} readable by this user; a value never yet seen in them goes unredacted meanwhile`;
    case 'retention-unmeasured':
      return `make cleanupPeriodDays readable in the settings.json of ${h.retentionUnmeasured.join(', ')}`;
    case 'retention-lowered':
      return h.retentionLowered !== null
        ? `set cleanupPeriodDays in ${h.retentionLowered.home}/settings.json to at least ${h.retentionLowered.othersMin}`
        : HEALTH_REMEDIES['retention-lowered'];
    case 'export-due':
      return exportDueRemedy(h);
    default:
      return HEALTH_REMEDIES[word] ?? '';
  }
}

/** The detail of a binding refusal (exit 5), by its word. */
function bindingDetail(word, h) {
  switch (word) {
    case 'store-root-dangling': return `~/${STORE_DB_REL} is a dangling link (to ${h.dbPath})`;
    case 'store-missing': return 'store.id names a store, and history.db is absent';
    case 'store-mismatch': return 'history.db\'s meta.store_id is not the one store.id names';
    case 'store-unbound': return `history.db is present with no store.id beside it (its meta.store_id is ${h.storeId ?? 'unreadable'})`;
    case 'store-unreachable': return 'the store\'s filesystem did not answer a stat within its deadline';
    case 'store-recoverable': return `store.id and history.db are absent, but ${evidenceOf(h)} says a store existed`;
    case 'store-wal-orphaned': return 'history.db-wal or history.db-shm is present without history.db';
    case 'store-zero-byte': return 'history.db is 0 bytes';
    case 'store-schema-missing':
      // D-4599: the status read's v0 arm measured a user_version, so the DB holds its store_id; the binding refusal has none.
      return h.userVersion !== null
        ? `history.db holds meta.store_id but its user_version is ${h.userVersion}, below 1 (damage or tampering)`
        : 'history.db is present and holds no meta.store_id';
    case 'store-unmeasured': return 'a binding file, or the DB\'s presence, could not be read';
    case 'store-not-wal': return 'the store is not in WAL mode, and the writer could not set it';
    default: return `status refused: ${word}`;
  }
}

export function deriveHealth(h) {
  const tag = `store ${h.storeId ?? '(none)'}: `;
  const warn = [];
  const fail = [];
  const item = (word, detail) => ({ word, detail: tag + detail, remedy: remedyFor(word, h) });
  const result = () => ({ pass: warn.length === 0 && fail.length === 0 ? 'ok' : null, warn, fail });

  // 1. the grace — only while no tick has run.
  const noTickYet = h.exit === EXIT.NOT_INDEXED || (h.exit === EXIT.OK && h.lastTickMs === null);
  if (noTickYet && h.shimMtimeMs !== null) {
    const age = h.nowMs - h.shimMtimeMs;
    if (age >= 0 && age < SHIM_GRACE_MS) return { pass: 'first-tick-pending', warn, fail };
  }

  // 2. a refusal answers alone.
  if (h.exit === EXIT.DB) {
    if (h.reason !== null && HEALTH_WORDS[h.reason] === 'fail') fail.push(item(h.reason, bindingDetail(h.reason, h)));
    else fail.push(item('status-unreadable', `status answered exit 5 (${h.reason ?? 'no reason'})`));
    return result();
  }
  // Exit 9: this box keeps no store (Darwin, a server role, or no shim, store.id or DB). Nothing is judged:
  // no item and no pass word, so doctor's relay answers SKIP (Task 32), never a FAIL about a store that
  // was never meant to exist.
  if (h.exit === EXIT.NO_STORE) return { pass: null, warn, fail };
  if (h.exit !== EXIT.OK && h.exit !== EXIT.NOT_INDEXED) {
    fail.push(item('status-unreadable', `status answered exit ${h.exit}${h.reason !== null ? ` (${h.reason})` : ''}`));
    return result();
  }

  // 3. the states in which no fresh tick is expected.
  if (h.historyOff) warn.push(item('off', `capture is off: ~/${SWITCHES.off} exists, so no tick runs`));
  if (h.recovering !== null) {
    const held = h.historyOff || h.capturePause === 'low-disk';
    if (!held && h.recovering.cursorUnmovedTicks >= RECOVERY_STALL_TICKS) {
      fail.push(item('recovery-stalled', `the recovery step ${h.recovering.step} has not moved from ${h.recovering.cursor || 'its start'} in ${h.recovering.cursorUnmovedTicks} ticks`));
    } else {
      warn.push(item('recovering', `a recovery step (${h.recovering.step}) is running at ${h.recovering.cursor || 'its start'}; drain and ingest wait for it`));
    }
  }
  const opLive = h.op !== null && h.op.alive === true;
  if (opLive) warn.push(item('op-running', `an operator pass (${h.op.verb}, pid ${h.op.pid}) holds the sweep lock; no tick runs meanwhile`));
  // D-4314 (history-doctor-states-need-a-fresh-tick): catching-up and recovering hold the freshness FAILs only
  // while the last tick is fresh. Their evidence (the last three ticks rows; recover_unmoved_ticks, which grows
  // only while ticks run) stops changing when the sweep dies, so a timer dead mid-backfill would read as a WARN
  // for ever (§9.6 step 4; FE3: a RUNNING sweep in catch-up is not stale). `off` and `op-running` are an
  // operator switch and a live marker, not tick evidence, so they hold regardless, and they hold D-5026's death line back too
  // (below): no scheduled pass runs under either, so nothing new can die, and the next pass after them either ticks, which clears the
  // record, or is killed, which is recorded.
  const tickAge = h.lastTickMs === null ? null : h.nowMs - h.lastTickMs;
  // D-5016 (history-doctor-reads-a-live-pass): the ticks row is stamped with the pass START but written at its END, so a
  // healthy pass that runs longer than the timer's period shows an old tick while it runs. A pass the marker proves
  // LIVE (its identity measured equal; lib's decidePassLive) that started within TICK_STALE_MS is a fresh tick, for
  // every rule that reads tickFresh: catching-up and recovering (FE3; under a live pass their evidence is the last ticks rows, which
  // may be old, and the hold lasts at most TICK_STALE_MS from the pass's start), lag-unmeasured (a running pass has not yet
  // reached every file's end), and the stale-tick FAIL itself. A held state also holds lag-high back, as a fresh tick does. A pass that has
  // run past TICK_STALE_MS is hung, and FAILs below. No live pass reads as it always did.
  // A start more than PASS_FUTURE_SLACK_MS PAST nowMs means the wall clock stepped back since the marker was written (or
  // the marker is forged): its age would be negative for as long as the step lasts, and the pass would read as fresh
  // that long. Such a pass is not read at all, so the verdict is the one a box with no live pass gets (fix round 1,
  // tick-stale review T3). `tickAge` below keeps the same weakness; it predates B2 and is left as it was.
  // The hung arm is for a pass the kill does not end. The ending that occurs in production is another one (fix round 2, review 462
  // F1): the carrier kills a scheduled pass at CARRIER_KILL_S (600 s, the unit's TimeoutStartSec=10min), and the marker is written
  // after the unit starts, so a killed pass never reaches TICK_STALE_MS of marker age; the next pass, within the timer's 30 s accuracy,
  // overwrites the marker and its fresh live marker would re-arm every hold above. D-5026 answers that: the next pass records the
  // death (`pass-died`, `h.passDied`) before it overwrites the marker, and an OPEN death FAILs below whatever a live pass, catching-up or lag-unmeasured say (the off switch and an operator pass hold it, as they hold every freshness FAIL).
  const passLive = h.pass !== null && h.pass !== undefined && h.pass.live === true && h.pass.startMs - h.nowMs <= PASS_FUTURE_SLACK_MS;
  const passAge = passLive ? h.nowMs - h.pass.startMs : null;
  const passFresh = passLive && passAge <= TICK_STALE_MS;
  const passHung = passLive && passAge > TICK_STALE_MS;
  const tickFresh = (tickAge !== null && tickAge <= TICK_STALE_MS) || passFresh;
  const b = h.bytesBehindLast3;
  const catching = tickFresh && b.length === CATCHING_UP_TICKS && b.every((v, i) => i === 0 || b[i - 1] > v);
  if (catching) warn.push(item('catching-up', `the backlog is falling: ${b[b.length - 1]} bytes behind, from ${b[0]} ${CATCHING_UP_TICKS} ticks ago`));
  const lagUnmeasured = h.lagS === null && tickFresh;
  if (lagUnmeasured) warn.push(item('lag-unmeasured', 'lag is unmeasured: not every file has reached its end once yet'));
  const stateHeld = h.historyOff || (h.recovering !== null && tickFresh) || opLive || catching || lagUnmeasured;

  // D-5026 (history-pass-death-record): a pass that ended without its tick. OPEN while the record's start is after the last tick (or
  // there is no tick): a pass that wrote its tick has a ticks row stamped at or after its marker's start (the tick is stamped with a
  // clock read made after the marker's), so a record of a pass that ticked, or one left by a removal that was cut off, is closed by
  // this comparison alone. A leftover marker that is parsed, NOT live and started after the last tick is the same death with no record
  // (the pass that found it could not write one, and left the marker standing); it counts beside a record when it is another pass than
  // the record's (a later start). Held-pass freshness (D-5027) does not close it: only a tick does.
  const afterLastTick = (ms) => h.lastTickMs === null || ms > h.lastTickMs;
  const rec = h.passDied ?? null;
  const recOpen = rec !== null && afterLastTick(rec.startMs);
  const leftover = h.pass !== null && h.pass !== undefined && h.pass.live !== true && afterLastTick(h.pass.startMs)
    && (!recOpen || h.pass.startMs > rec.startMs) ? h.pass : null;
  const death = recOpen || leftover !== null
    ? {
      count: (recOpen ? rec.count : 0) + (leftover !== null ? 1 : 0),
      pid: leftover !== null ? leftover.pid : rec.pid,
      startMs: leftover !== null ? leftover.startMs : rec.startMs,
    }
    : null;
  // D-5027 (history-held-pass-is-fresh-for-tick-stale): a held pass that ended within TICK_STALE_MS (and not past PASS_FUTURE_SLACK_MS
  // in the future, the same step-back guard) ran and ended as designed. It answers for the tick-stale FAIL ONLY: the held node shows its
  // own FAIL (migration-needs-op, migration-refused), and not a second one that points at the timer. It is not a tick:
  // tickFresh, catching-up, lag-unmeasured and lag-high do not read it, so lag-high joins 30 minutes (LAG_FAIL_MS) after the last
  // zero-behind tick (capture is paused while the hold stands, so the lag is real). schema-newer is NOT covered (review 466 F1): a
  // scheduled pass on a newer store is refused at openStore, before the held arm, and leaves through holdPass, which opens no
  // database and stamps nothing (DM17: no write on a newer store), so tick-stale keeps standing beside schema-newer; planRun's
  // refuse-newer arm is defensive on a scheduled pass.
  const heldFresh = h.heldPassMs !== null && h.heldPassMs !== undefined
    && h.nowMs - h.heldPassMs <= TICK_STALE_MS && h.heldPassMs - h.nowMs <= PASS_FUTURE_SLACK_MS;

  // 4. the FAILs.
  // D-5026: the off switch and an operator pass hold the death line back, as D-4314 says they hold every freshness FAIL (no scheduled pass
  // runs under either); a live scheduled pass, catching-up and lag-unmeasured do NOT (ruling 5049 F1).
  if (death !== null && !h.historyOff && !opLive) {
    fail.push(item('tick-stale', `the sweep has recorded ${death.count} scheduled pass(es) that ended without writing a tick since its last clear; the last (pid ${death.pid === null ? 'unknown' : death.pid}) started ${Math.max(0, minutesOf(h.nowMs - death.startMs))} min ago (the carrier kills a pass at ${minutesOf(CARRIER_KILL_S * 1000)} min; the OOM killer or a SIGKILL also ends one)`));
  }
  if (passHung) {
    fail.push(item('tick-stale', `the scheduled pass (pid ${h.pass.pid}) started ${minutesOf(passAge)} min ago and is still running (hung past ${minutesOf(TICK_STALE_MS)} min)`));
  }
  if (!stateHeld) {
    if (passLive) {
      // A live pass answers for the tick: fresh above, or the hung FAIL just pushed.
    } else if (death !== null) {
      // The death FAIL above answers for the tick: no second tick-stale line.
    } else if (heldFresh) {
      // A held pass that ended recently answers for the tick (D-5027): the hold's own FAIL names the cause.
    } else if (tickAge === null) {
      fail.push(item('tick-stale', h.shimMtimeMs !== null
        ? `no tick has run, and the shim was placed ${minutesOf(h.nowMs - h.shimMtimeMs)} min ago`
        : 'no tick has run'));
    } else if (tickAge > TICK_STALE_MS) {
      fail.push(item('tick-stale', `the last tick ran ${minutesOf(tickAge)} min ago (stale past ${minutesOf(TICK_STALE_MS)} min)`));
    }
    if (h.lagS !== null && h.lagS * 1000 > LAG_FAIL_MS) {
      fail.push(item('lag-high', `lag is ${h.lagS} s, over ${LAG_FAIL_MS / 1000} s`));
    }
  }
  if (h.capturePause === 'at-cap') fail.push(item('at-cap', `capture is paused: the store is at its cap of ${h.capGb} GB`));
  if (h.capturePause === 'low-disk') fail.push(item('capture-paused-low-disk', `capture is paused: free space on the filesystem holding ${h.dbPath} is below the floor`));
  if (h.modesWrong.length > 0) fail.push(item('mode-wrong', h.modesWrong.map((m) => `${m.path} is ${m.got}, wants ${m.want}`).join('; ')));
  if (h.migration === 'refuse-newer' || (h.userVersion !== null && h.userVersion > h.codeVersion)) {
    fail.push(item('schema-newer', `the store is schema v${h.userVersion ?? '?'}, newer than this build's v${h.codeVersion}`));
  }
  if (h.migration === 'refuse-low-disk') {
    fail.push(item('migration-refused', `a migration to v${h.codeVersion} was refused for room: ${h.freeBytes ?? 'unmeasured'} bytes free on the filesystem holding ${h.dbPath}`));
  }
  if (h.migration === 'snapshot-needs-op') {
    // The estimate planMigration compared with half the carrier's bound: the store's size at the copy rate, counted twice when a
    // version between the stored one and this build's is heavy (ruling 5012), so the number printed is the one that made the verdict.
    const heavy = heavyVersionsBetween(h.userVersion, h.codeVersion);
    const est = Math.ceil(((h.sizeBytes ?? 0) * (heavy.length > 0 ? 2 : 1)) / (h.copyBps ?? DEFAULT_COPY_BPS));
    const why = heavy.length > 0 ? ` (the copy counted twice: ${heavy.map((v) => `v${v}`).join(' and ')} backfills or indexes a large table)` : '';
    // planMigration answers this verdict by two arms, the interrupted attempts first (whatever the size) and the estimate past half the
    // bound. The attempts count and its read state reach here through status (`migrationAttempts` and `migrationAttemptsUnmeasured`,
    // read with store's measureAttempts), so the line names the arm that decided: an estimate is never called too long when the
    // attempts decided it. An absent count reads as none.
    const attempts = h.migrationAttempts ?? 0;
    if (attempts >= MAX_INTERRUPTED_ATTEMPTS && h.migrationAttemptsUnmeasured === true) {
      // The count is the cap because the marker could not be measured (readAttempts fails closed), not because two attempts were counted.
      fail.push(item('migration-needs-op', `the attempt marker for the migration to v${h.codeVersion} could not be read, so a scheduled pass treats the migration as interrupted (it stops after ${MAX_INTERRUPTED_ATTEMPTS}), whatever the size; its copy is about ${est} s${why}`));
    } else if (attempts >= MAX_INTERRUPTED_ATTEMPTS) {
      fail.push(item('migration-needs-op', `a migration to v${h.codeVersion} was started and interrupted ${attempts} times (a scheduled pass stops after ${MAX_INTERRUPTED_ATTEMPTS}), whatever the size; its copy is about ${est} s${why}`));
    } else {
      fail.push(item('migration-needs-op', `a migration to v${h.codeVersion} needs a copy of about ${est} s${why}, too long for a scheduled pass`));
    }
  }
  // Task 28F: an input status could not read kept its healthy default; it is named here and never judged healthy
  // (the no-overloaded-null rule). An existing word, so no HEALTH_WORDS entry is added.
  if (h.extrasUnmeasured.length > 0) {
    fail.push(item('status-unreadable', `status could not read ${h.extrasUnmeasured.join(', ')}; the checks that depend on it were not judged`));
  }
  if (h.journalUnwritable) fail.push(item('journal-unwritable', 'the journal cannot be appended: drained spool files are held in spool/.draining'));
  if (h.exportSegmentNewer.length > 0) fail.push(item('export-segment-newer', `export segment(s) ${h.exportSegmentNewer.join(', ')} are in a newer format than this build reads`));
  // D-4207 (history-export-due-escalates): the overdue FAIL on measured source loss, and export-due below.
  if (h.exportOverdue > 0) fail.push(item('export-overdue', `${h.exportOverdue} unexported blob(s) whose source text is gone or past its deletion date: the store may be their only copy`));

  // 5. the WARNs.
  if (h.fts === 'fts5-absent' || h.fts === 'probe-failed') warn.push(item('fts-unavailable', `search unavailable (${h.fts}); capture continues`));
  if (h.capMalformed) warn.push(item('cap-malformed', `the cap file ${h.capFile} is not a positive integer, so the cap is ${CAP_DEFAULT_GB} GB`));
  if (h.redactUnreadable.length > 0) warn.push(item('redact-source-unreadable', `secret source(s) could not be read: ${h.redactUnreadable.join(', ')}`));
  if (h.sizeBytes !== null && h.capturePause !== 'at-cap' && h.sizeBytes * 100 >= capBytes(h.capGb) * CAP_WARN_PCT) {
    warn.push(item('cap-near', `the store is ${h.sizeBytes} bytes, ${Math.floor((h.sizeBytes * 100) / capBytes(h.capGb))}% of its ${h.capGb} GB cap`));
  }
  if (h.breakerOpen) warn.push(item('breaker-open', 'a breaker is open'));
  if (h.rosterUnreadable) warn.push(item('roster-unreadable', '~/.ccrc/accounts.sh cannot be read, so no account home is discovered'));
  if (h.rootIsSymlink) warn.push(item('root-is-symlink', '~/.ccrc/history is itself a symlink'));
  const exportGap = exportGapArm(h);   // W1-B4 Task 9: the gap guard's arms (§9.15), decided at the end of this file
  if (exportGap !== null) warn.push(item('export-due', exportDueDetail(exportGap, h)));
  if (h.exportPausedLowDisk) warn.push(item('export-paused-low-disk', 'the export is paused for room on the home filesystem'));
  if (h.retentionUnmeasured.length > 0) warn.push(item('retention-unmeasured', `the retention of ${h.retentionUnmeasured.join(', ')} could not be read; each keeps its last measured value`));
  if (h.retentionLowered !== null) {
    warn.push(item('retention-lowered', `${h.retentionLowered.home} keeps ${h.retentionLowered.days} days, under the others' ${h.retentionLowered.othersMin}; rows held only in its files fall due ${exportHorizonDays(h.retentionLowered.days)} days after their file's last write (a reminder: each row is measured against its own files' homes)`));
  }
  if (h.exportSegmentMissing > 0) warn.push(item('export-segment-missing', `${h.exportSegmentMissing} export mark(s) named a segment not on this box and were cleared`));
  if (h.journalSkipped > 0) warn.push(item('journal-record-skipped', `${h.journalSkipped} journal record(s) were skipped as malformed or of an unknown kind`));
  if (h.journalGrowth30d > JOURNAL_GROWTH_BYTES) {
    warn.push(item('journal-growth', `the journal grew ${h.journalGrowth30d} bytes in 30 days (over ${JOURNAL_GROWTH_BYTES})`));
  }
  // D-4346 (history-permanent-failures-classified): a stored blob whose bytes no longer decode was passed over, counted once.
  if (h.blobUndecodable > 0) warn.push(item('blob-undecodable', `${h.blobUndecodable} stored blob(s) did not decode, so their text is out of search and cannot be read back`));
  // D-4346 (history-permanent-failures-classified): a spool file the store refused was set aside, counted once.
  if (h.drainRejected > 0) warn.push(item('drain-rejected', `${h.drainRejected} spool file(s) were set aside in .draining/rejected/ because the store refused their rows`));
  // D-4347 (history-planted-entries-never-wedge): a displaced spool file's lines are out of the store, as a rejected one's are.
  // FU8 (FP5): a file the sweep could not read waits in place with its id's later files behind it, and is counted apart.
  // FU8 (FP3): a link or a file at spool/ itself stops the hook and the drain alike; status measures it (no counter), so the
  // clause clears when the entry goes.
  // FR2c (review 344 F3; D-4418 (history-spool-append-regular-file-only)): a node the hook refuses at spool/<id>.jsonl is
  // measured by status's own lstat (no counter), so its clause clears when the node goes, as FP3's spool/ clause does.
  if (h.spoolNotDirectory || h.spoolNodesRefused > 0 || h.spoolDisplaced + h.spoolBlocked + h.spoolUnreadable > 0) {
    const parts = [];
    if (h.spoolNotDirectory) parts.push('spool/ is not a real directory (a link or a file stands there), so no hook spools a line and no pass drains one while it stands');
    if (h.spoolNodesRefused > 0) parts.push(`${h.spoolNodesRefused} node(s) at spool/<id>.jsonl are not regular files (${SPOOL_NODE_KINDS}), so the hook spools no line for that id while one stands`);
    if (h.spoolDisplaced + h.spoolBlocked > 0) parts.push(`${h.spoolDisplaced} spool file(s) set aside under .draining/planted/ and ${h.spoolBlocked} skipped drain(s) of a file whose sidecar name is blocked, because of entries planted in .draining/`);
    if (h.spoolUnreadable > 0) parts.push(`${h.spoolUnreadable} skipped drain(s) of a draining file or its sidecar the sweep could not read, whose id's later files wait behind it`);
    warn.push(item('spool-planted', parts.join('; ')));
  }
  return result();
}

// ===========================================================================
// W1-B2 recall, Task 1: identity, scope and ids (spec §8.2, §6.1, §6.9,
// §6.10, §8.4 describe, §8.6, §9.7). The CLI measures (the bounded tmux read,
// the registry files) and these functions decide; none reads a file, a
// process or the environment. Every registry fact arrives as a Presence, the
// three states the store-open table already takes, so a file that exists but
// cannot be read is never answered as absent (rev 3.2 review, IV5).
// ===========================================================================

/** The scope a read verb answers in (§8.2, the §8.3 header). Plan-chosen
 *  spelling of the three kinds the spec's header names. */
export const SCOPE_KINDS = Object.freeze(['family', 'project', 'workspace']);

/** The fewest hex digits a displayed node id keeps after its `L` or `N`,
 *  chosen (§6.1). Counted in hex digits so every display prefix passes the
 *  card's grammar gate, `L[0-9a-f]{6,20}` (§8.6). Prefixes are unique within
 *  the scope, never across it; `--json` always prints the full id. */
export const NODE_ID_DISPLAY_MIN = 6;

/** A full node id: `L` (leaf) or `N` (parent) plus 20 hex (§6.1). */
export const HISTORY_NODE_ID_RE = /^[LN][0-9a-f]{20}$/;

/** The directory under the history root that holds the eval control arm's
 *  per-id files (§9.7). Spelled once; the W2 verb writes it, B2 only reads. */
export const RECALL_OFF_DIR = 'recall-off';

/** `tmux display-message` prints `#S`; ccd names every session `cc-<id>`, and
 *  the hook requires the same prefix (spec §8.2). decideOpGate's pane test
 *  spells the prefix too, for a different decision (an irreversible form). */
const TMUX_SESSION_PREFIX = 'cc-';
const PANE_RE = /^%[0-9]+$/;

function refuseScope(reason) {
  return { ok: false, rc: EXIT.REFUSED, reason };
}

/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The
 *  caller ran `tmux display-message -p -t "$TMUX_PANE" '#S'` bounded at
 *  TMUX_DEADLINE_MS, ALWAYS with `-t`, and passes what came back; `tmux` is
 *  null when it never ran (no valid pane). A pane that is not `%<n>`, a run
 *  that did not settle or failed, or a name that is not `cc-<something>`
 *  answers `no-identity`; never "the most recent session". The stripped id
 *  then passes idOk before any path is formed from it, else `bad-id`
 *  (D-4170). */
export function decideIdentity({ pane, tmux }) {
  if (typeof pane !== 'string' || !PANE_RE.test(pane)) return refuseScope('no-identity');
  if (tmux === null || tmux.settled !== true || tmux.status !== 0 || typeof tmux.stdout !== 'string') {
    return refuseScope('no-identity');
  }
  const name = tmux.stdout.replace(/\r?\n$/, '');
  if (!name.startsWith(TMUX_SESSION_PREFIX) || name.length === TMUX_SESSION_PREFIX.length) return refuseScope('no-identity');
  const id = name.slice(TMUX_SESSION_PREFIX.length);
  return idOk(id) ? { ok: true, id } : refuseScope('bad-id');
}

/** The family's generation (§8.2, D-4192): the
 *  session's `CCRC_SESSION_GENERATION` when it has the uuid grammar, else
 *  `$REG/<id>.generation` read-only when IT has the grammar, else the id's
 *  newest family (§8.8: an unreadable or malformed file falls back too,
 *  because the generation only narrows a scope the id already bounds). */
export function resolveGeneration({ envGen, regGen }) {
  if (typeof envGen === 'string' && UUID_RE.test(envGen)) return { value: envGen, via: 'env' };
  if (regGen.state === 'value' && UUID_RE.test(regGen.value.trim())) return { value: regGen.value.trim(), via: 'registry' };
  return { value: null, via: 'newest' };
}

/** The harness check every read verb runs after the identity (§6.10 item 4,
 *  D-4679 (history-harness-unsupported-refused)). `$REG/<id>.harness` absent is
 *  Claude Code, today's only harness, which is HARNESSES' first row; a value
 *  with no HARNESS_TABLE row is `harness-unsupported`, never "not indexed
 *  yet"; a file that exists but cannot be read is `harness-unreadable`, never
 *  read as the default. */
export function decideHarness(p) {
  if (p.state === 'absent') return { ok: true, harness: HARNESSES[0] };
  if (p.state !== 'value') return refuseScope('harness-unreadable');
  const v = p.value.trim();
  return Object.hasOwn(HARNESS_TABLE, v) ? { ok: true, harness: v } : refuseScope('harness-unsupported');
}

/** A registry file's trimmed text, or null when it holds none: absent, empty,
 *  or unreadable. A decision that treats unreadable apart asks B1's
 *  module-private `presenceUnreadable` (beside `decideStoreOpen`) first
 *  (IV5), so this null never stands for two things it must tell apart. */
const presenceText = (p) => (p !== null && p.state === 'value' && p.value.trim() !== '' ? p.value.trim() : null);

/** Every scope decision a read verb takes (§8.2), in one place:
 *  - the scope source is DATA (`SCOPE_SOURCES`, D-4167):
 *    a source outside it is refused `no-identity`, never defaulted to tmux.
 *    W1 holds `tmux` only; W2 adds `env` with the headless seam;
 *  - `--project` with `--workspace`, or either with `--session`, is
 *    `bad-args`: each names a different scope;
 *  - `--session <id>` passes idOk (`bad-id`) and must share this session's
 *    project: a `.project` on either side that exists but cannot be read is
 *    `project-unreadable`; otherwise both must be present and equal, so an
 *    absent or empty one, which can never be shown equal, is
 *    `cross-project` like a different one (§8.2). Its generation is left to
 *    the caller (null);
 *  - `--project` needs this session's project (`project-unreadable`, absent
 *    or empty folded in on purpose: REASONS has no absent word, and an
 *    absent project widens nothing; D-4677 (history-recall-all-lanes));
 *  - `--workspace` needs this session's workdir AND project; either
 *    unreadable, absent or empty is `workspace-unreadable`, never a wider or
 *    narrower scope (D-4676 (history-workspace-scope));
 *  - otherwise the family (id, generation), the generation null when the
 *    caller must take the id's newest family. */
export function decideScope(i) {
  if (!SCOPE_SOURCES.includes(i.source)) return refuseScope('no-identity');
  if (!idOk(i.id)) return refuseScope('bad-id');
  const { project, workspace, session } = i.flags;
  if ((project ? 1 : 0) + (workspace ? 1 : 0) + (session !== null ? 1 : 0) > 1) return refuseScope('bad-args');
  const ownProject = presenceText(i.reg.project);
  const verdict = (kind, o) => ({
    ok: true, kind, source: i.source, id: i.id, generation: i.generation.value, project: ownProject, workdir: null, ...o,
  });
  if (session !== null) {
    if (!idOk(session)) return refuseScope('bad-id');
    const theirsFile = i.reg.sessionProject ?? { state: 'absent' };
    if (presenceUnreadable(i.reg.project) || presenceUnreadable(theirsFile)) return refuseScope('project-unreadable');
    const theirs = presenceText(theirsFile);
    if (ownProject === null || theirs !== ownProject) return refuseScope('cross-project');
    return verdict('family', { id: session, generation: session === i.id ? i.generation.value : null });
  }
  if (project) {
    if (ownProject === null) return refuseScope('project-unreadable');
    return verdict('project', {});
  }
  if (workspace) {
    const workdir = presenceText(i.reg.workdir);
    if (workdir === null || ownProject === null) return refuseScope('workspace-unreadable');
    return verdict('workspace', { workdir });
  }
  return verdict('family', {});
}

/** The shortest prefix of each id, its letter plus at least
 *  NODE_ID_DISPLAY_MIN hex digits, that no other id in THE SAME SET shares (§6.1: unique within the scope). The
 *  sorted neighbours bound it: an id needs one char past its longest common
 *  prefix with either neighbour. */
export function displayPrefixes(ids) {
  const sorted = [...new Set(ids)].sort();
  const lcp = (a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    return n;
  };
  const out = new Map();
  sorted.forEach((id, k) => {
    const shared = Math.max(k > 0 ? lcp(id, sorted[k - 1]) : 0, k + 1 < sorted.length ? lcp(id, sorted[k + 1]) : 0);
    out.set(id, id.slice(0, Math.min(id.length, Math.max(1 + NODE_ID_DISPLAY_MIN, shared + 1))));
  });
  return out;
}

/** An id or display prefix the session typed, resolved INSIDE its scope
 *  (§8.2, RV19; D-4678 (history-scope-on-every-verb)): exactly one in-scope match
 *  wins even when ids outside the scope share the prefix; none inside but
 *  some outside is `out-of-scope` (exit 2), never `not-found` (exit 3);
 *  several inside is `ambiguous`, which the CLI answers exit 2 `bad-args`
 *  with the candidates as a hint. */
export function resolveScopedId({ wanted, inScope, outOfScope }) {
  if (typeof wanted !== 'string' || !/^[LN][0-9a-f]{6,20}$/.test(wanted)) return { kind: 'bad' };
  const hits = [...new Set(inScope.filter((id) => id.startsWith(wanted)))];
  if (hits.length === 1) return { kind: 'ok', id: hits[0] };
  if (hits.length > 1) return { kind: 'ambiguous', candidates: hits.sort() };
  return outOfScope.some((id) => id.startsWith(wanted)) ? { kind: 'out-of-scope' } : { kind: 'not-found' };
}

// derived from lossless-claw src/tools/lcm-describe-id.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const NODE_BARE_RE = /^[LN][0-9a-f]{6,20}…?$/;
const NODE_TOKEN_RE = /(?<![A-Za-z0-9])[LN][0-9a-f]{6,20}(?![A-Za-z0-9])/g;
const NODE_LOOSE_RE = /(?<![A-Za-z0-9])[LN][0-9A-Fa-f]{6,}(?![A-Za-z0-9])/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NODE_CARD_RE = new RegExp(`^${escapeRe(CARD_PREFIX)}node (L[0-9a-f]{6,20})…?(?=\\s|$)`);

/** `describe <id | pasted line>` (§8.4, §11 P28): a bare id or display
 *  prefix (the card's trailing ellipsis tolerated), or a pasted card line,
 *  whose structural id is the one right after `History: node ` (§8.6: the
 *  same node is named again as the describe argument, and a parent beside
 *  it, so counting mentions would refuse every card line). Free text is
 *  refused rather than guessed: several distinct ids, an uppercase or
 *  malformed one, or one id in prose each answer an error the CLI prints as
 *  exit 2 `bad-args`. An all-zero body is never an id. The error text echoes
 *  the input, so the CLI redacts it like any recalled field. */
export function extractNodeId(raw) {
  const trimmed = String(raw).trim();
  if (NODE_BARE_RE.test(trimmed)) return validNodeId(trimmed.replace(/…$/, ''));
  const card = NODE_CARD_RE.exec(trimmed);
  if (card !== null) return validNodeId(card[1]);
  const tokens = [...new Set(trimmed.match(NODE_TOKEN_RE) ?? [])];
  if (tokens.length > 1) {
    return { ok: false, error: `input names several node ids (${tokens.join(', ')}); give one bare id or one pasted ${CARD_PREFIX.trim()} line` };
  }
  const loose = NODE_LOOSE_RE.exec(trimmed)?.[0];
  if (loose === undefined) return { ok: false, error: `not a node id: ${raw}` };
  const checked = validNodeId(loose);
  if (!checked.ok) return checked;
  if (!/^[LN][0-9a-f]{6,20}$/.test(loose)) {
    return { ok: false, error: `malformed node id: ${loose}; an id is L or N plus 6 to 20 lowercase hex` };
  }
  return {
    ok: false, error: `not a node id or a card line: ${raw}`,
    hint: `give the bare id (${loose}) or paste the whole ${CARD_PREFIX.trim()} line`,
  };
}

function validNodeId(id) {
  return /^[LN]0+$/.test(id) ? { ok: false, error: `a node id cannot be all zeros: ${id}` } : { ok: true, id };
}

/** `~/.ccrc/history/recall-off/<id>` (§9.7). The id passes idOk BEFORE the
 *  path exists, so `../x` can never name a file outside the store
 *  (D-4170, C66). */
export function recallOffPath(home, id) {
  if (!idOk(id)) throw new TypeError(`recallOffPath: not a session id: ${JSON.stringify(id)}`);
  return `${historyPaths(home).root}/${RECALL_OFF_DIR}/${id}`;
}

/** Whether `recall-off/<id>` holds this family (§9.7,
 *  D-4680 (history-recall-off-generation)). Its content is the generation it was
 *  assigned to (`''` for a legacy family): equal to the resolved generation
 *  is `off` (exit 8, counted); another generation is `stale` (the id was
 *  purged and reused: recall proceeds and the drain counts
 *  `recall_off_stale`); absent is `none`. A file that exists but cannot be
 *  read is `off`: the id WAS assigned an arm, so answering it as the
 *  treatment arm would mix the eval's arms, while exit 8 only withholds
 *  recall. `generation` is the RESOLVED family's: when resolveGeneration
 *  answers `via: 'newest'`, the caller finds the id's newest family first
 *  and passes ITS generation: `''` only when that family is legacy or the
 *  store holds no family of the id, never resolveGeneration's unresolved
 *  `value ?? ''` before the family is known (§8.2, §8.8, §9.7). */
export function decideRecallOff({ file, generation }) {
  if (file.state === 'absent') return 'none';
  if (file.state !== 'value') return 'off';
  return file.value.trim() === generation ? 'off' : 'stale';
}


// ===========================================================================
// W1-B2 recall, Task 2: search primitives (spec §8.4 grep, §11 V2, P1, P8,
// P9, P10). Pure text and SQL-fragment decisions: the CLI runs the query and
// the regex worker runs the match. Task 1's module-private `escapeRe` is
// reused here.
// ===========================================================================

// derived from lossless-claw src/store/fts5-sanitize.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
/** The FTS5 MATCH text for plain `grep <words>` (§8.4, §11 P1). Every token
 *  is quoted, so FTS5 operators (`OR`, `NOT`, `NEAR(`), column filters and
 *  punctuation are literal text, and the terms are joined by spaces, which
 *  FTS5 reads as AND. A quoted phrase stays one phrase. ccrc's change: a token
 *  or phrase ENDING in `*` (inside or right after its closing quote) becomes
 *  a quoted term followed by `*`, an FTS5 prefix query, so `a0860d1f*` finds a
 *  SHA by its prefix with no trigram index; upstream kept the star inside the
 *  quotes, where it matches nothing. Porter stems a prefix query too, so a
 *  prefix cut inside a word's stem can miss (`runn*` does not find
 *  `running`, measured); a hex prefix is never stemmed. An empty query is
 *  `""`, which matches nothing and never errors. */
export function sanitizeFtsQuery(raw) {
  const text = String(raw);
  const parts = [];
  const bare = (chunk) => {
    for (const t of chunk.split(/\s+/).filter(Boolean)) parts.push(quoteFtsTerm(t.replace(/"/g, '')));
  };
  const phraseRe = /"([^"]+)"(\*?)/g;
  let last = 0;
  for (let m = phraseRe.exec(text); m !== null; m = phraseRe.exec(text)) {
    bare(text.slice(last, m.index));
    const phrase = m[1].replace(/"/g, '').trim();
    if (phrase) parts.push(quoteFtsTerm(m[2] === '*' ? `${phrase}*` : phrase));
    last = m.index + m[0].length;
  }
  bare(text.slice(last));
  return parts.length > 0 ? parts.join(' ') : '""';
}

/** One quoted FTS5 term. A trailing run of stars moves outside the quotes as
 *  one star; a term that is nothing but stars stays a quoted literal. */
function quoteFtsTerm(t) {
  const m = /^([\s\S]*?[^*\s])\s*\*+$/.exec(t);
  return m === null ? `"${t}"` : `"${m[1]}"*`;
}

// derived from lossless-claw src/store/full-text-fallback.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const RAW_TERM_RE = /"([^"]+)"(\*?)|(\S+)/g;
const EDGE_PUNCTUATION_RE = /^[`'"()[\]{}<>.,:;!?*_+=|\\/-]+|[`'"()[\]{}<>.,:;!?*_+=|\\/-]+$/g;

function normalizeQueryTerm(raw) {
  return typeof raw === 'string' ? stripQueryEdges(raw).toLowerCase() : '';
}

/** The edge-stripped term with its raw code points: no case conversion, normalization or other folding, which the
 *  snippet locator leaves to its frozen unicode61 helpers (W1-B2 Task 12 breaker correction, F2). */
function stripQueryEdges(raw) {
  return typeof raw === 'string' ? raw.trim().replace(EDGE_PUNCTUATION_RE, '') : '';
}

/** Whether a token (or a phrase's inside) ends in the FTS5 prefix marker exactly as quoteFtsTerm reads it: a star run
 *  after at least one character that is neither a star nor a space. */
const PREFIX_MARKED_RE = /[^*\s]\s*\*+$/;

/** The one lexer behind queryTerms and snippetTerms, the raw query's words as sanitizeFtsQuery splits them: each
 *  normalized term with whether the query made it a prefix (a star right after a phrase's closing quote, or
 *  ending the token or the phrase's inside, which is what sanitizeFtsQuery turns into an FTS5 prefix query),
 *  once per (term, prefix) pair. */
function lexQueryTerms(raw, normalize = normalizeQueryTerm) {
  const text = String(raw);
  const out = [];
  const add = (term, prefix) => {
    if (term.length > 0 && !out.some((x) => x.term === term && x.prefix === prefix)) out.push({ term, prefix });
  };
  for (const m of text.matchAll(RAW_TERM_RE)) {
    const inner = m[1] ?? m[3] ?? '';
    add(normalize(inner), m[2] === '*' || PREFIX_MARKED_RE.test(inner.replace(/"/g, '')));
  }
  if (out.length === 0) add(normalize(text), false);
  return out;
}

/** The plain words of a query, lowercased, edge punctuation (a trailing `*`
 *  included) stripped, each once: the snippet window's needles (§11 P9). */
export function queryTerms(raw) {
  return [...new Set(lexQueryTerms(raw).map((x) => x.term))];
}

/** queryTerms for snippet localization: the same words, each once (by raw code points: host case conversion would
 *  turn U+104B0 into U+104D8, which unicode61 keeps apart, so every fold is left to snippetSpan), but a term the query made a prefix keeps one
 *  terminal `*`, which snippetSpan reads as FTS5's prefix marker (W1-B2 Task 12 fix round 1, finding F1). queryTerms
 *  strips that star for its display callers, so grep's snippet cannot be located from it. `stud` and `stud*` are
 *  different needles and both stay. */
export function snippetTerms(raw) {
  return lexQueryTerms(raw, stripQueryEdges).map(({ term, prefix }) => (prefix ? `${term}*` : term));
}

// derived from lossless-claw src/tools/lcm-grep-tool.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
/** Clear regex syntax in a plain query, which would make FTS5 miss silently
 *  (§8.4, §11 V2): grep refuses it with exit 2 `regex-syntax` and a hint,
 *  WITHOUT querying. Conservative on purpose, not a parser: nothing inside
 *  double quotes counts, `.` counts only before `*`, `+` or `?`, and `^` or
 *  `$` only at a word edge. */
export function regexSyntaxIn(pattern) {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (escaped) {
      escaped = false;
      if (!inQuote && char && /[bBdDsSwW]/.test(char)) return 'regex character escape';
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (char === '|') return 'alternation';
    if (char === '.' && (next === '*' || next === '+' || next === '?')) return 'wildcard';
    if (char === '[') {
      const closing = pattern.indexOf(']', index + 1);
      if (closing > index + 1) return 'character class';
    }
    if (char === '^' && (index === 0 || /\s/.test(pattern[index - 1] ?? ''))) return 'anchor';
    if (char === '$' && (index === pattern.length - 1 || /\s/.test(next ?? ''))) return 'anchor';
  }
  return null;
}

/** The `hint:` line that goes with exit 2 `regex-syntax`. The caller redacts
 *  and escapes the echoed pattern like any field it prints. */
export function regexSyntaxHint(pattern, syntax) {
  return `hint: grep searches words, not a regex (${syntax}): use --regex for \`${pattern}\`, or rewrite it as 1-3 literal terms or one quoted phrase`;
}

/** The longest `--regex` pattern admitted (upstream's bound, §11 P10). */
export const REGEX_MAX_LEN = 500;
/** The regex worker's wall-clock kill, chosen (§8.4). */
export const REGEX_BUDGET_MS = 5000;

// derived from lossless-claw src/store/search-regex.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const REGEX_QUANTIFIER = String.raw`(?:[+*?]|\{\d+(?:,\d*)?\})`;
const NESTED_QUANTIFIER_RE = new RegExp(`${REGEX_QUANTIFIER}\\)${REGEX_QUANTIFIER}`);
const QUANTIFIED_ALTERNATION_RE = /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)(?:[+*?]|\{\d)/;

/** The `--regex` guard (§8.4, §11 P10): a DISCRIMINATED refusal, never a
 *  null that reads as "no match". `too-long` past REGEX_MAX_LEN; `invalid`
 *  when it does not compile; `nested` for upstream's two shapes and for
 *  ccrc's structural rule (`repeatsVariableGroup`), which refuted candidate 1
 *  needs: upstream admits `(.*a){8}$`, which backtracks for seconds on 30
 *  characters. A refused pattern spawns no worker. The worker compiles
 *  `source` with no flags. */
export function guardRegex(pattern) {
  if (typeof pattern !== 'string') return { ok: false, why: 'invalid' };
  if (pattern.length > REGEX_MAX_LEN) return { ok: false, why: 'too-long' };
  try {
    new RegExp(pattern);
  } catch {
    return { ok: false, why: 'invalid' };
  }
  if (NESTED_QUANTIFIER_RE.test(pattern) || QUANTIFIED_ALTERNATION_RE.test(pattern)) return { ok: false, why: 'nested' };
  if (repeatsVariableGroup(pattern)) return { ok: false, why: 'nested' };
  return { ok: true, source: pattern };
}

/** A quantifier starting at `k`, as {len, min, max}, or null. */
function regexQuantifierAt(p, k) {
  const c = p[k];
  if (c === '*') return { len: 1, min: 0, max: Infinity };
  if (c === '+') return { len: 1, min: 1, max: Infinity };
  if (c === '?') return { len: 1, min: 0, max: 1 };
  if (c !== '{') return null;
  const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(k, k + 24));
  if (m === null) return null;
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
  return { len: m[0].length, min, max };
}

/** ccrc's structural ReDoS rule: a group repeated more than once (a
 *  quantifier whose maximum exceeds 1) whose body can match in more than one
 *  way, through a variable quantifier or an alternation anywhere inside it,
 *  nested groups included. Escapes and character classes are skipped, and a
 *  group's own `(?:`, `(?=`, `(?<name>` prefix is not a quantifier. It
 *  refuses some harmless patterns (`(a|b){2}`) to refuse every catastrophic
 *  one of that shape; the refusal names `--regex` and the pattern, so the
 *  session rewrites it. */
function repeatsVariableGroup(p) {
  const open = [];
  let i = 0;
  const skipQuantifier = (q) => {
    i += q.len;
    if (p[i] === '?') i += 1;
  };
  while (i < p.length) {
    const c = p[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') {
      i += 1;
      while (i < p.length && p[i] !== ']') i += p[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '(') {
      open.push(false);
      i += 1;
      if (p[i] === '?') {
        i += 1;
        if (p[i] === '<' && p[i + 1] !== '=' && p[i + 1] !== '!') {
          while (i < p.length && p[i] !== '>') i += 1;
          i += 1;
        } else {
          i += p[i] === '<' ? 2 : 1;
        }
      }
      continue;
    }
    if (c === '|') {
      if (open.length > 0) open[open.length - 1] = true;
      i += 1;
      continue;
    }
    if (c === ')') {
      const variable = open.pop() === true;
      i += 1;
      const q = regexQuantifierAt(p, i);
      if (q !== null && q.max > 1 && variable) return true;
      if (open.length > 0 && (variable || (q !== null && q.min !== q.max))) open[open.length - 1] = true;
      if (q !== null) skipQuantifier(q);
      continue;
    }
    const q = regexQuantifierAt(p, i);
    if (q !== null) {
      if (q.min !== q.max && open.length > 0) open[open.length - 1] = true;
      skipQuantifier(q);
      continue;
    }
    i += 1;
  }
  return false;
}

/** The FTS prefilter `--regex` runs before its worker (§8.4), or null for a
 *  full scan of the scope. It must never drop a true hit, so it names only a
 *  WHOLE-WORD literal every match contains: a top-level run of 3 or more
 *  ASCII letters or digits, each unquantified, bounded on both sides by an
 *  unquantified anchor (`^`, `$`), literal whitespace (` `, `\s`, `\t`,
 *  `\n`, `\r`) or literal ASCII punctuation, in a pattern with no top-level
 *  alternation. Those bounds are FTS5 separators, so the run is one whole
 *  token, and an exact-token query (no star) finds it: porter stems the query
 *  and the index alike. A prefix query (`"runn"*` misses `running`) and
 *  `\b` (which can sit beside a non-ASCII letter FTS5 keeps in the token)
 *  never make one. The longest such run wins; FTS5 folds case, so the
 *  prefilter is a superset of a case-sensitive pattern. */
export function regexPrefilter(pattern) {
  const atoms = [];
  for (let i = 0; i < pattern.length;) {
    const c = pattern[i];
    if (c === '|') return null;
    if (c === '\\') {
      const n = pattern[i + 1] ?? '';
      // A named backreference is one regex atom, not the literal group name.
      // Treating `<name>` as word characters would prefilter away its matches.
      if (n === 'k' && pattern[i + 2] === '<') {
        const close = pattern.indexOf('>', i + 3);
        if (close === -1) return null;
        atoms.push({ t: 'other' });
        i = close + 1;
      } else {
        atoms.push(/[stnr]/.test(n) || /[!-/:-@[-`{-~]/.test(n) ? { t: 'sep' } : { t: 'other' });
        i += 2;
      }
    } else if (c === '[') {
      i += 1;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      i += 1;
      atoms.push({ t: 'other' });
    } else if (c === '(') {
      let depth = 0;
      for (; i < pattern.length; i += 1) {
        if (pattern[i] === '\\') { i += 1; continue; }
        if (pattern[i] === '[') {
          i += 1;
          while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
          continue;
        }
        if (pattern[i] === '(') depth += 1;
        if (pattern[i] === ')' && --depth === 0) break;
      }
      i += 1;
      atoms.push({ t: 'other' });
    } else if (regexQuantifierAt(pattern, i) !== null) {
      const q = regexQuantifierAt(pattern, i);
      if (atoms.length > 0) atoms[atoms.length - 1] = { t: 'other' };
      i += q.len;
      if (pattern[i] === '?') i += 1;
    } else {
      if (/[A-Za-z0-9]/.test(c)) atoms.push({ t: 'word', ch: c });
      else if (c === '^' || c === '$' || c === ' ' || (/[!-/:-@[-`{-~]/.test(c) && c !== '.')) atoms.push({ t: 'sep' });
      else atoms.push({ t: 'other' });
      i += 1;
    }
  }
  let best = '';
  for (let k = 0; k < atoms.length;) {
    if (atoms[k].t !== 'word') { k += 1; continue; }
    let e = k;
    while (e < atoms.length && atoms[e].t === 'word') e += 1;
    const run = atoms.slice(k, e).map((a) => a.ch).join('');
    const bounded = k > 0 && atoms[k - 1].t === 'sep' && e < atoms.length && atoms[e].t === 'sep';
    if (bounded && run.length >= 3 && run.length > best.length) best = run;
    k = e;
  }
  return best === '' ? null : `"${best}"`;
}

/** The sorts `grep --sort` takes (§8.4); `recency` is the default. */
export const GREP_SORTS = Object.freeze(['recency', 'relevance', 'hybrid']);
/** `--limit` (§8.4): at most 100; 20 when not given, chosen. */
export const GREP_LIMIT_MAX = 100;
export const GREP_LIMIT_DEFAULT = 20;
/** Every grep sort ranks and pages over the top 2,000 in-scope matches; §8.4 gives the pool to hybrid only (D-4681 (history-grep-pages-end-at-rank-pool)). */
export const RANK_POOL = 2000;
/** The hybrid sort's age decay per hour: upstream's AGE_DECAY_RATE (§11 P8). */
export const HYBRID_AGE_DECAY = 0.001;

// derived from lossless-claw src/store/full-text-sort.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
/** The ORDER BY of a ranked grep query (§8.4, §11 P8). `rank` is FTS5's
 *  BM25, lower is better. `hybrid` divides it by an age term in HOURS taken
 *  from the integer `ts_ms` and the statement's bound `:now_ms` parameter:
 *  upstream's `julianday(<ts>)` is NULL for an integer (measured, refuted
 *  candidate 2), which silently degrades the sort to recency. A NULL
 *  timestamp counts as the oldest, so it sorts last, never first; a
 *  timestamp ahead of the clock ages 0. `tsExpr` is interpolated into SQL,
 *  so only a (qualified) column name is accepted. */
export function ftsOrderBy(sort, tsExpr) {
  if (typeof tsExpr !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(tsExpr)) {
    throw new TypeError(`ftsOrderBy: not a column name: ${JSON.stringify(tsExpr)}`);
  }
  switch (sort) {
    case 'recency':
      return `${tsExpr} DESC`;
    case 'relevance':
      return `rank ASC, ${tsExpr} DESC`;
    case 'hybrid':
      return `(rank / (1 + (MAX(0, :now_ms - COALESCE(${tsExpr}, 0)) / 3600000.0) * ${HYBRID_AGE_DECAY})) ASC, ${tsExpr} DESC`;
    default:
      throw new TypeError(`ftsOrderBy: sort outside GREP_SORTS: ${String(sort)}`);
  }
}

/** FTS5's Porter stemmer, reproduced for snippet candidate selection. The FTS
 *  tokenizer applies unicode61 first; this function receives its lowercased
 *  ASCII word portion, so non-ASCII words conservatively remain literal. */
function porterStem(word) {
  if (!/^[a-z]{3,}$/.test(word)) return word;
  let stem = word;
  const isVowel = (i) => 'aeiou'.includes(stem[i]) || (stem[i] === 'y' && i > 0 && !isVowel(i - 1));
  const measure = (end = stem.length) => {
    let pairs = 0;
    let priorVowel = false;
    for (let i = 0; i < end; i += 1) {
      const currentVowel = isVowel(i);
      if (priorVowel && !currentVowel) pairs += 1;
      priorVowel = currentVowel;
    }
    return pairs;
  };
  const hasVowel = (end) => {
    for (let i = 0; i < end; i += 1) if (isVowel(i)) return true;
    return false;
  };
  const cvc = (end) => end >= 3 && !isVowel(end - 3) && isVowel(end - 2) && !isVowel(end - 1) && !'wxy'.includes(stem[end - 1]);
  const ends = (suffix) => stem.endsWith(suffix);
  const replace = (suffix, replacement) => { stem = `${stem.slice(0, -suffix.length)}${replacement}`; };

  if (ends('sses')) replace('sses', 'ss');
  else if (ends('ies')) replace('ies', 'i');
  else if (!ends('ss') && ends('s')) replace('s', '');

  if (ends('eed')) {
    if (measure(stem.length - 3) > 0) replace('eed', 'ee');
  } else {
    const suffix = ends('ed') ? 'ed' : ends('ing') ? 'ing' : null;
    if (suffix !== null && hasVowel(stem.length - suffix.length)) {
      stem = stem.slice(0, -suffix.length);
      if (ends('at')) replace('at', 'ate');
      else if (ends('bl')) replace('bl', 'ble');
      else if (ends('iz')) replace('iz', 'ize');
      else if (stem.length >= 2 && stem.at(-1) === stem.at(-2) && !isVowel(stem.length - 1) && !'lsz'.includes(stem.at(-1))) stem = stem.slice(0, -1);
      else if (measure() === 1 && cvc(stem.length)) stem += 'e';
    }
  }
  if (ends('y') && hasVowel(stem.length - 1)) replace('y', 'i');

  const step2 = {
    a: [['ational', 'ate'], ['tional', 'tion']],
    c: [['enci', 'ence'], ['anci', 'ance']], e: [['izer', 'ize']], g: [['logi', 'log']],
    l: [['bli', 'ble'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous']],
    o: [['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate']],
    s: [['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'], ['ousness', 'ous']],
    t: [['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble']],
  };
  const step3 = {
    a: [['ical', 'ic']], s: [['ness', '']], t: [['icate', 'ic'], ['iciti', 'ic']],
    u: [['ful', '']], v: [['ative', '']], z: [['alize', 'al']],
  };
  for (const table of [step2, step3]) {
    const rules = table[stem.at(-2)];
    if (rules === undefined) continue;
    for (const [suffix, replacement] of rules) {
      if (!ends(suffix)) continue;
      if (measure(stem.length - suffix.length) > 0) replace(suffix, replacement);
      break;
    }
  }
  for (const suffix of ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize']) {
    if (!ends(suffix)) continue;
    const end = stem.length - suffix.length;
    if (measure(end) > 1 && (suffix !== 'ion' || stem[end - 1] === 's' || stem[end - 1] === 't')) stem = stem.slice(0, end);
    break;
  }
  if (ends('e')) {
    const end = stem.length - 1;
    if (measure(end) > 1 || (measure(end) === 1 && !cvc(end))) stem = stem.slice(0, end);
  } else if (ends('ll') && measure(stem.length - 1) > 1) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

/** The combining marks FTS5 unicode61 drops inside a token at remove_diacritics 1, the default B1's `porter unicode61`
 *  tables use: U+0300-0304, U+0306-030C, U+030F, U+0311, U+031B, U+0323-0328, U+032D-032E, U+0330-0331. Measured
 *  against node:sqlite on every code point U+0080..U+2FFFF (the case `beltFold is unicode61's own fold`); every other
 *  mark is a boundary to unicode61, so it is one to the belt and to the snippet locator (Task 12 fix round 3, F2). The
 *  ONE definition: beltFold, foldToken and the token scanner below all read it. */
const isDroppedMark = (c) => (c >= 0x300 && c <= 0x304) || (c >= 0x306 && c <= 0x30c) || c === 0x30f || c === 0x311
  || c === 0x31b || (c >= 0x323 && c <= 0x328) || c === 0x32d || c === 0x32e || c === 0x330 || c === 0x331;

/** The Unicode61 policy FTS5's `porter unicode61` tables (remove_diacritics=1, the default B1 uses) apply to one code point,
 *  FROZEN here as two generated tables, so the snippet locator reads the same token membership and the same fold as
 *  SQLite does on every host: no `\p{L}`, `toLowerCase`, `toUpperCase`, `normalize` or any other host Unicode data is consulted
 *  (they disagree with SQLite's table in both directions: Task 12 fix round 4, F2). Provenance: SQLite's public-domain,
 *  machine-generated `ext/fts5/fts5_unicode2.c` (the copy read: 780 lines, sha256 b2defbe5df532c8fa646f8e4d3044f00cd59c1d3ffe715e6ca49ae7657a72308),
 *  ported once, outside this tree, into a scratch generator and run over every non-surrogate code point U+0000..U+10FFFF.
 *  Generation semantics: a code point is a TOKEN character iff the default tokenchars `L* N* Co` select its
 *  `sqlite3Fts5UnicodeCategory` (the unmapped category 0 included, which is why unassigned and private-use code points tokenize),
 *  except U+0000 (never a token) and U+FFFE / U+FFFF (the UTF-8 reader turns them into U+FFFD, a symbol); its FOLD is
 *  `sqlite3Fts5UnicodeFold(cp, 1)`: ASCII A-Z + 32; the case-fold entries of that function (`aEntry`, `aiOff`; none above U+FFFF
 *  but U+10400-U+10427 + 40); then, below U+10000, `fts5_remove_diacritic` in mode 1 (the simple cases only). The 25 marks
 *  `isDroppedMark` names are not token characters (they continue one and fold to nothing). Cross-checked against runtime
 *  node:sqlite (SQLite 3.51.2): zero mismatches in membership or folded term over all 1,112,064 non-surrogate code points,
 *  and the test file does that again on every run, from SQLite itself, never from these arrays.
 *  COUNTS: 1,104,042 token code points in 403 ranges; 1,218 token code points fold to a different single code point, in 532
 *  rules (436 of them one code point); no token folds to several code points or to nothing.
 *  INVARIANTS (the lookups' binary searches rely on them): both tables are flat, sorted ascending by their first field and
 *  non-overlapping; TOKEN_RANGES holds [lo, hi] pairs, inclusive, each maximal over the non-surrogate code points (the surrogate block
 *  U+D800-U+DFFF is a gap that is not a character, so a range stops at U+D7FF and the next starts at U+E000) and none touching a surrogate; FOLD_RULES holds [start, end, step, delta] quads: the rule folds start, start + step, ... up to end
 *  to code point + delta, step >= 1, delta != 0, and every code point a rule folds is a token character. */
const UNICODE61_TOKEN_RANGES = [
  0x30,0x39, 0x41,0x5a, 0x61,0x7a, 0xaa,0xaa, 0xb2,0xb3, 0xb5,0xb5, 0xb9,0xba, 0xbc,0xbe,
  0xc0,0xd6, 0xd8,0xf6, 0xf8,0x2c1, 0x2c6,0x2d1, 0x2e0,0x2e4, 0x2ec,0x2ec, 0x2ee,0x2ee, 0x370,0x374,
  0x376,0x37d, 0x37f,0x383, 0x386,0x386, 0x388,0x3f5, 0x3f7,0x481, 0x48a,0x559, 0x560,0x588, 0x58b,0x58e,
  0x590,0x590, 0x5c8,0x5f2, 0x5f5,0x5ff, 0x605,0x605, 0x61c,0x61d, 0x620,0x64a, 0x660,0x669, 0x66e,0x66f,
  0x671,0x6d3, 0x6d5,0x6d5, 0x6e5,0x6e6, 0x6ee,0x6fc, 0x6ff,0x6ff, 0x70e,0x70e, 0x710,0x710, 0x712,0x72f,
  0x74b,0x7a5, 0x7b1,0x7ea, 0x7f4,0x7f5, 0x7fa,0x815, 0x81a,0x81a, 0x824,0x824, 0x828,0x828, 0x82e,0x82f,
  0x83f,0x858, 0x85c,0x85d, 0x85f,0x8e3, 0x8ff,0x8ff, 0x904,0x939, 0x93d,0x93d, 0x950,0x950, 0x958,0x961,
  0x966,0x96f, 0x971,0x980, 0x984,0x9bb, 0x9bd,0x9bd, 0x9c5,0x9c6, 0x9c9,0x9ca, 0x9ce,0x9d6, 0x9d8,0x9e1,
  0x9e4,0x9f1, 0x9f4,0x9f9, 0x9fc,0xa00, 0xa04,0xa3b, 0xa3d,0xa3d, 0xa43,0xa46, 0xa49,0xa4a, 0xa4e,0xa50,
  0xa52,0xa6f, 0xa72,0xa74, 0xa76,0xa80, 0xa84,0xabb, 0xabd,0xabd, 0xac6,0xac6, 0xaca,0xaca, 0xace,0xae1,
  0xae4,0xaef, 0xaf2,0xb00, 0xb04,0xb3b, 0xb3d,0xb3d, 0xb45,0xb46, 0xb49,0xb4a, 0xb4e,0xb55, 0xb58,0xb61,
  0xb64,0xb6f, 0xb71,0xb81, 0xb83,0xbbd, 0xbc3,0xbc5, 0xbc9,0xbc9, 0xbce,0xbd6, 0xbd8,0xbf2, 0xbfb,0xc00,
  0xc04,0xc3d, 0xc45,0xc45, 0xc49,0xc49, 0xc4e,0xc54, 0xc57,0xc61, 0xc64,0xc7e, 0xc80,0xc81, 0xc84,0xcbb,
  0xcbd,0xcbd, 0xcc5,0xcc5, 0xcc9,0xcc9, 0xcce,0xcd4, 0xcd7,0xce1, 0xce4,0xd01, 0xd04,0xd3d, 0xd45,0xd45,
  0xd49,0xd49, 0xd4e,0xd56, 0xd58,0xd61, 0xd64,0xd78, 0xd7a,0xd81, 0xd84,0xdc9, 0xdcb,0xdce, 0xdd5,0xdd5,
  0xdd7,0xdd7, 0xde0,0xdf1, 0xdf5,0xe30, 0xe32,0xe33, 0xe3b,0xe3e, 0xe40,0xe46, 0xe50,0xe59, 0xe5c,0xeb0,
  0xeb2,0xeb3, 0xeba,0xeba, 0xebd,0xec7, 0xece,0xf00, 0xf20,0xf33, 0xf40,0xf70, 0xf88,0xf8c, 0xf98,0xf98,
  0xfbd,0xfbd, 0xfcd,0xfcd, 0xfdb,0x102a, 0x103f,0x1049, 0x1050,0x1055, 0x105a,0x105d, 0x1061,0x1061, 0x1065,0x1066,
  0x106e,0x1070, 0x1075,0x1081, 0x108e,0x108e, 0x1090,0x1099, 0x10a0,0x10fa, 0x10fc,0x135c, 0x1369,0x138f, 0x139a,0x13ff,
  0x1401,0x166c, 0x166f,0x167f, 0x1681,0x169a, 0x169d,0x16ea, 0x16ee,0x1711, 0x1715,0x1731, 0x1737,0x1751, 0x1754,0x1771,
  0x1774,0x17b3, 0x17d7,0x17d7, 0x17dc,0x17dc, 0x17de,0x17ff, 0x180f,0x18a8, 0x18aa,0x191f, 0x192c,0x192f, 0x193c,0x193f,
  0x1941,0x1943, 0x1946,0x19af, 0x19c1,0x19c7, 0x19ca,0x19dd, 0x1a00,0x1a16, 0x1a1c,0x1a1d, 0x1a20,0x1a54, 0x1a5f,0x1a5f,
  0x1a7d,0x1a7e, 0x1a80,0x1a9f, 0x1aa7,0x1aa7, 0x1aae,0x1aff, 0x1b05,0x1b33, 0x1b45,0x1b59, 0x1b7d,0x1b7f, 0x1b83,0x1ba0,
  0x1bae,0x1be5, 0x1bf4,0x1bfb, 0x1c00,0x1c23, 0x1c38,0x1c3a, 0x1c40,0x1c7d, 0x1c80,0x1cbf, 0x1cc8,0x1ccf, 0x1ce9,0x1cec,
  0x1cee,0x1cf1, 0x1cf5,0x1dbf, 0x1de7,0x1dfb, 0x1e00,0x1fbc, 0x1fbe,0x1fbe, 0x1fc2,0x1fcc, 0x1fd0,0x1fdc, 0x1fe0,0x1fec,
  0x1ff0,0x1ffc, 0x1fff,0x1fff, 0x2065,0x2069, 0x2070,0x2079, 0x207f,0x2089, 0x208f,0x209f, 0x20ba,0x20cf, 0x20f1,0x20ff,
  0x2102,0x2102, 0x2107,0x2107, 0x210a,0x2113, 0x2115,0x2115, 0x2119,0x211d, 0x2124,0x2124, 0x2126,0x2126, 0x2128,0x2128,
  0x212a,0x212d, 0x212f,0x2139, 0x213c,0x213f, 0x2145,0x2149, 0x214e,0x214e, 0x2150,0x218f, 0x23f4,0x23ff, 0x2427,0x243f,
  0x244b,0x249b, 0x24ea,0x24ff, 0x2700,0x2700, 0x2776,0x2793, 0x2b4d,0x2b4f, 0x2b5a,0x2ce4, 0x2ceb,0x2cee, 0x2cf2,0x2cf8,
  0x2cfd,0x2cfd, 0x2d00,0x2d6f, 0x2d71,0x2d7e, 0x2d80,0x2ddf, 0x2e2f,0x2e2f, 0x2e3c,0x2e7f, 0x2e9a,0x2e9a, 0x2ef4,0x2eff,
  0x2fd6,0x2fef, 0x2ffc,0x2fff, 0x3005,0x3007, 0x3021,0x3029, 0x3031,0x3035, 0x3038,0x303c, 0x3040,0x3098, 0x309d,0x309f,
  0x30a1,0x30fa, 0x30fc,0x318f, 0x3192,0x3195, 0x31a0,0x31bf, 0x31e4,0x31ff, 0x321f,0x3229, 0x3248,0x324f, 0x3251,0x325f,
  0x3280,0x3289, 0x32b1,0x32bf, 0x32ff,0x32ff, 0x3400,0x4dbf, 0x4e00,0xa48f, 0xa4c7,0xa4fd, 0xa500,0xa60c, 0xa610,0xa66e,
  0xa67f,0xa69e, 0xa6a0,0xa6ef, 0xa6f8,0xa6ff, 0xa717,0xa71f, 0xa722,0xa788, 0xa78b,0xa801, 0xa803,0xa805, 0xa807,0xa80a,
  0xa80c,0xa822, 0xa82c,0xa835, 0xa83a,0xa873, 0xa878,0xa87f, 0xa882,0xa8b3, 0xa8c5,0xa8cd, 0xa8d0,0xa8df, 0xa8f2,0xa8f7,
  0xa8fb,0xa925, 0xa930,0xa946, 0xa954,0xa95e, 0xa960,0xa97f, 0xa984,0xa9b2, 0xa9ce,0xa9dd, 0xa9e0,0xaa28, 0xaa37,0xaa42,
  0xaa44,0xaa4b, 0xaa4e,0xaa5b, 0xaa60,0xaa76, 0xaa7a,0xaa7a, 0xaa7c,0xaaaf, 0xaab1,0xaab1, 0xaab5,0xaab6, 0xaab9,0xaabd,
  0xaac0,0xaac0, 0xaac2,0xaadd, 0xaae0,0xaaea, 0xaaf2,0xaaf4, 0xaaf7,0xabe2, 0xabee,0xd7ff, 0xe000,0xfb1d, 0xfb1f,0xfb28,
  0xfb2a,0xfbb1, 0xfbc2,0xfd3d, 0xfd40,0xfdfb, 0xfdfe,0xfdff, 0xfe1a,0xfe1f, 0xfe27,0xfe2f, 0xfe53,0xfe53, 0xfe67,0xfe67,
  0xfe6c,0xfefe, 0xff00,0xff00, 0xff10,0xff19, 0xff21,0xff3a, 0xff41,0xff5a, 0xff66,0xffdf, 0xffe7,0xffe7, 0xffef,0xfff8,
  0x10000,0x100ff, 0x10103,0x10136, 0x10140,0x10178, 0x1018a,0x1018f, 0x1019c,0x101cf, 0x101fe,0x1039e, 0x103a0,0x103cf, 0x103d1,0x10856,
  0x10858,0x1091e, 0x10920,0x1093e, 0x10940,0x10a00, 0x10a04,0x10a04, 0x10a07,0x10a0b, 0x10a10,0x10a37, 0x10a3b,0x10a3e, 0x10a40,0x10a4f,
  0x10a59,0x10a7e, 0x10a80,0x10b38, 0x10b40,0x10fff, 0x11003,0x11037, 0x1104e,0x1107f, 0x11083,0x110af, 0x110c2,0x110ff, 0x11103,0x11126,
  0x11135,0x1113f, 0x11144,0x1117f, 0x11183,0x111b2, 0x111c1,0x111c4, 0x111c9,0x116aa, 0x116b8,0x1246f, 0x12474,0x16f50, 0x16f7f,0x16f8e,
  0x16f93,0x1cfff, 0x1d0f6,0x1d0ff, 0x1d127,0x1d128, 0x1d1de,0x1d1ff, 0x1d246,0x1d2ff, 0x1d357,0x1d6c0, 0x1d6c2,0x1d6da, 0x1d6dc,0x1d6fa,
  0x1d6fc,0x1d714, 0x1d716,0x1d734, 0x1d736,0x1d74e, 0x1d750,0x1d76e, 0x1d770,0x1d788, 0x1d78a,0x1d7a8, 0x1d7aa,0x1d7c2, 0x1d7c4,0x1eeef,
  0x1eef2,0x1efff, 0x1f02c,0x1f02f, 0x1f094,0x1f09f, 0x1f0af,0x1f0b0, 0x1f0bf,0x1f0c0, 0x1f0d0,0x1f0d0, 0x1f0e0,0x1f10f, 0x1f12f,0x1f12f,
  0x1f16c,0x1f16f, 0x1f19b,0x1f1e5, 0x1f203,0x1f20f, 0x1f23b,0x1f23f, 0x1f249,0x1f24f, 0x1f252,0x1f2ff, 0x1f321,0x1f32f, 0x1f336,0x1f336,
  0x1f37d,0x1f37f, 0x1f394,0x1f39f, 0x1f3c5,0x1f3c5, 0x1f3cb,0x1f3df, 0x1f3f1,0x1f3ff, 0x1f43f,0x1f43f, 0x1f441,0x1f441, 0x1f4f8,0x1f4f8,
  0x1f4fd,0x1f4ff, 0x1f53e,0x1f53f, 0x1f544,0x1f54f, 0x1f568,0x1f5fa, 0x1f641,0x1f644, 0x1f650,0x1f67f, 0x1f6c6,0x1f6ff, 0x1f774,0xe0000,
  0xe0002,0xe001f, 0xe0080,0xe00ff, 0xe01f0,0x10ffff,
];
const UNICODE61_FOLD_RULES = [
  0x41,0x5a,1,32, 0xb5,0xb5,1,775, 0xc0,0xc0,1,-95, 0xc1,0xc1,1,-96,
  0xc2,0xc2,1,-97, 0xc3,0xc3,1,-98, 0xc4,0xc4,1,-99, 0xc5,0xc5,1,-100,
  0xc6,0xc6,1,32, 0xc7,0xc7,1,-100, 0xc8,0xc8,1,-99, 0xc9,0xc9,1,-100,
  0xca,0xca,1,-101, 0xcb,0xcb,1,-102, 0xcc,0xcc,1,-99, 0xcd,0xcd,1,-100,
  0xce,0xce,1,-101, 0xcf,0xcf,1,-102, 0xd0,0xd0,1,32, 0xd1,0xd2,1,-99,
  0xd3,0xd3,1,-100, 0xd4,0xd4,1,-101, 0xd5,0xd5,1,-102, 0xd6,0xd6,1,-103,
  0xd8,0xd8,1,32, 0xd9,0xd9,1,-100, 0xda,0xda,1,-101, 0xdb,0xdb,1,-102,
  0xdc,0xdc,1,-103, 0xdd,0xdd,1,-100, 0xde,0xde,1,32, 0xe0,0xe0,1,-127,
  0xe1,0xe1,1,-128, 0xe2,0xe2,1,-129, 0xe3,0xe3,1,-130, 0xe4,0xe4,1,-131,
  0xe5,0xe7,2,-132, 0xe8,0xe8,1,-131, 0xe9,0xe9,1,-132, 0xea,0xea,1,-133,
  0xeb,0xeb,1,-134, 0xec,0xec,1,-131, 0xed,0xed,1,-132, 0xee,0xee,1,-133,
  0xef,0xef,1,-134, 0xf1,0xf2,1,-131, 0xf3,0xf3,1,-132, 0xf4,0xf4,1,-133,
  0xf5,0xf5,1,-134, 0xf6,0xf6,1,-135, 0xf9,0xf9,1,-132, 0xfa,0xfa,1,-133,
  0xfb,0xfb,1,-134, 0xfc,0xfc,1,-135, 0xfd,0xfd,1,-132, 0xff,0xff,1,-134,
  0x100,0x100,1,-159, 0x101,0x101,1,-160, 0x102,0x102,1,-161, 0x103,0x103,1,-162,
  0x104,0x104,1,-163, 0x105,0x105,1,-164, 0x106,0x106,1,-163, 0x107,0x107,1,-164,
  0x108,0x108,1,-165, 0x109,0x109,1,-166, 0x10a,0x10a,1,-167, 0x10b,0x10b,1,-168,
  0x10c,0x10c,1,-169, 0x10d,0x10e,1,-170, 0x10f,0x10f,1,-171, 0x110,0x110,1,1,
  0x112,0x112,1,-173, 0x113,0x113,1,-174, 0x114,0x114,1,-175, 0x115,0x115,1,-176,
  0x116,0x116,1,-177, 0x117,0x117,1,-178, 0x118,0x118,1,-179, 0x119,0x119,1,-180,
  0x11a,0x11a,1,-181, 0x11b,0x11b,1,-182, 0x11c,0x11c,1,-181, 0x11d,0x11d,1,-182,
  0x11e,0x11e,1,-183, 0x11f,0x11f,1,-184, 0x120,0x120,1,-185, 0x121,0x121,1,-186,
  0x122,0x122,1,-187, 0x123,0x124,1,-188, 0x125,0x125,1,-189, 0x126,0x126,1,1,
  0x128,0x128,1,-191, 0x129,0x129,1,-192, 0x12a,0x12a,1,-193, 0x12b,0x12b,1,-194,
  0x12c,0x12c,1,-195, 0x12d,0x12d,1,-196, 0x12e,0x12e,1,-197, 0x12f,0x12f,1,-198,
  0x130,0x130,1,-199, 0x132,0x132,1,1, 0x134,0x134,1,-202, 0x135,0x136,1,-203,
  0x137,0x137,1,-204, 0x139,0x139,1,-205, 0x13a,0x13a,1,-206, 0x13b,0x13b,1,-207,
  0x13c,0x13c,1,-208, 0x13d,0x13d,1,-209, 0x13e,0x13e,1,-210, 0x13f,0x141,2,1,
  0x143,0x143,1,-213, 0x144,0x144,1,-214, 0x145,0x145,1,-215, 0x146,0x146,1,-216,
  0x147,0x147,1,-217, 0x148,0x148,1,-218, 0x14a,0x14a,1,1, 0x14c,0x14c,1,-221,
  0x14d,0x14d,1,-222, 0x14e,0x14e,1,-223, 0x14f,0x14f,1,-224, 0x150,0x150,1,-225,
  0x151,0x151,1,-226, 0x152,0x152,1,1, 0x154,0x154,1,-226, 0x155,0x155,1,-227,
  0x156,0x156,1,-228, 0x157,0x157,1,-229, 0x158,0x158,1,-230, 0x159,0x15a,1,-231,
  0x15b,0x15b,1,-232, 0x15c,0x15c,1,-233, 0x15d,0x15d,1,-234, 0x15e,0x15e,1,-235,
  0x15f,0x15f,1,-236, 0x160,0x160,1,-237, 0x161,0x162,1,-238, 0x163,0x163,1,-239,
  0x164,0x164,1,-240, 0x165,0x165,1,-241, 0x166,0x166,1,1, 0x168,0x168,1,-243,
  0x169,0x169,1,-244, 0x16a,0x16a,1,-245, 0x16b,0x16b,1,-246, 0x16c,0x16c,1,-247,
  0x16d,0x16d,1,-248, 0x16e,0x16e,1,-249, 0x16f,0x16f,1,-250, 0x170,0x170,1,-251,
  0x171,0x171,1,-252, 0x172,0x172,1,-253, 0x173,0x173,1,-254, 0x174,0x174,1,-253,
  0x175,0x175,1,-254, 0x176,0x176,1,-253, 0x177,0x177,1,-254, 0x178,0x179,1,-255,
  0x17a,0x17a,1,-256, 0x17b,0x17b,1,-257, 0x17c,0x17c,1,-258, 0x17d,0x17d,1,-259,
  0x17e,0x17e,1,-260, 0x17f,0x17f,1,-268, 0x181,0x181,1,210, 0x182,0x184,2,1,
  0x186,0x186,1,206, 0x187,0x187,1,1, 0x189,0x18a,1,205, 0x18b,0x18b,1,1,
  0x18e,0x18e,1,79, 0x18f,0x18f,1,202, 0x190,0x190,1,203, 0x191,0x191,1,1,
  0x193,0x193,1,205, 0x194,0x194,1,207, 0x196,0x196,1,211, 0x197,0x197,1,209,
  0x198,0x198,1,1, 0x19c,0x19c,1,211, 0x19d,0x19d,1,213, 0x19f,0x19f,1,214,
  0x1a0,0x1a0,1,-305, 0x1a1,0x1a1,1,-306, 0x1a2,0x1a4,2,1, 0x1a6,0x1a6,1,218,
  0x1a7,0x1a7,1,1, 0x1a9,0x1a9,1,218, 0x1ac,0x1ac,1,1, 0x1ae,0x1ae,1,218,
  0x1af,0x1af,1,-314, 0x1b0,0x1b0,1,-315, 0x1b1,0x1b2,1,217, 0x1b3,0x1b5,2,1,
  0x1b7,0x1b7,1,219, 0x1b8,0x1b8,1,1, 0x1bc,0x1bc,1,1, 0x1c4,0x1c4,1,2,
  0x1c5,0x1c5,1,1, 0x1c7,0x1c7,1,2, 0x1c8,0x1c8,1,1, 0x1ca,0x1ca,1,2,
  0x1cb,0x1cb,1,1, 0x1cd,0x1cd,1,-364, 0x1ce,0x1ce,1,-365, 0x1cf,0x1cf,1,-358,
  0x1d0,0x1d0,1,-359, 0x1d1,0x1d1,1,-354, 0x1d2,0x1d2,1,-355, 0x1d3,0x1d3,1,-350,
  0x1d4,0x1d4,1,-351, 0x1d5,0x1db,2,1, 0x1de,0x1e4,2,1, 0x1e6,0x1e6,1,-383,
  0x1e7,0x1e7,1,-384, 0x1e8,0x1e8,1,-381, 0x1e9,0x1e9,1,-382, 0x1ea,0x1ea,1,-379,
  0x1eb,0x1eb,1,-380, 0x1ec,0x1ee,2,1, 0x1f0,0x1f0,1,-390, 0x1f1,0x1f1,1,2,
  0x1f2,0x1f2,1,1, 0x1f4,0x1f4,1,-397, 0x1f5,0x1f5,1,-398, 0x1f6,0x1f6,1,-97,
  0x1f7,0x1f7,1,-56, 0x1f8,0x1f8,1,-394, 0x1f9,0x1f9,1,-395, 0x1fa,0x1fe,2,1,
  0x200,0x200,1,-415, 0x201,0x201,1,-416, 0x202,0x202,1,-417, 0x203,0x203,1,-418,
  0x204,0x204,1,-415, 0x205,0x205,1,-416, 0x206,0x206,1,-417, 0x207,0x207,1,-418,
  0x208,0x208,1,-415, 0x209,0x209,1,-416, 0x20a,0x20a,1,-417, 0x20b,0x20b,1,-418,
  0x20c,0x20c,1,-413, 0x20d,0x20d,1,-414, 0x20e,0x20e,1,-415, 0x20f,0x20f,1,-416,
  0x210,0x210,1,-414, 0x211,0x211,1,-415, 0x212,0x212,1,-416, 0x213,0x213,1,-417,
  0x214,0x214,1,-415, 0x215,0x215,1,-416, 0x216,0x216,1,-417, 0x217,0x217,1,-418,
  0x218,0x218,1,-421, 0x219,0x21a,1,-422, 0x21b,0x21b,1,-423, 0x21c,0x21c,1,1,
  0x21e,0x21e,1,-438, 0x21f,0x21f,1,-439, 0x220,0x220,1,-130, 0x222,0x224,2,1,
  0x226,0x226,1,-453, 0x227,0x227,1,-454, 0x228,0x228,1,-451, 0x229,0x229,1,-452,
  0x22a,0x22c,2,1, 0x22e,0x22e,1,-447, 0x22f,0x22f,1,-448, 0x230,0x230,1,1,
  0x232,0x232,1,-441, 0x233,0x233,1,-442, 0x23a,0x23a,1,10795, 0x23b,0x23b,1,1,
  0x23d,0x23d,1,-163, 0x23e,0x23e,1,10792, 0x241,0x241,1,1, 0x243,0x243,1,-195,
  0x244,0x244,1,69, 0x245,0x245,1,71, 0x246,0x24e,2,1, 0x370,0x372,2,1,
  0x376,0x376,1,1, 0x386,0x386,1,38, 0x388,0x38a,1,37, 0x38c,0x38c,1,64,
  0x38e,0x38f,1,63, 0x391,0x3a1,1,32, 0x3a3,0x3ab,1,32, 0x3c2,0x3c2,1,1,
  0x3cf,0x3cf,1,8, 0x3d0,0x3d0,1,-30, 0x3d1,0x3d1,1,-25, 0x3d5,0x3d5,1,-15,
  0x3d6,0x3d6,1,-22, 0x3d8,0x3ee,2,1, 0x3f0,0x3f0,1,-54, 0x3f1,0x3f1,1,-48,
  0x3f4,0x3f4,1,-60, 0x3f5,0x3f5,1,-64, 0x3f7,0x3f7,1,1, 0x3f9,0x3f9,1,-7,
  0x3fa,0x3fa,1,1, 0x3fd,0x3ff,1,-130, 0x400,0x40f,1,80, 0x410,0x42f,1,32,
  0x460,0x480,2,1, 0x48a,0x4be,2,1, 0x4c0,0x4c0,1,15, 0x4c1,0x4cd,2,1,
  0x4d0,0x526,2,1, 0x531,0x556,1,48, 0x10a0,0x10c5,1,7264, 0x10c7,0x10c7,1,7264,
  0x10cd,0x10cd,1,7264, 0x1e00,0x1e00,1,-7583, 0x1e01,0x1e02,1,-7584, 0x1e03,0x1e03,1,-7585,
  0x1e04,0x1e04,1,-7586, 0x1e05,0x1e05,1,-7587, 0x1e06,0x1e06,1,-7588, 0x1e07,0x1e07,1,-7589,
  0x1e08,0x1e08,1,1, 0x1e0a,0x1e0a,1,-7590, 0x1e0b,0x1e0b,1,-7591, 0x1e0c,0x1e0c,1,-7592,
  0x1e0d,0x1e0d,1,-7593, 0x1e0e,0x1e0e,1,-7594, 0x1e0f,0x1e0f,1,-7595, 0x1e10,0x1e10,1,-7596,
  0x1e11,0x1e11,1,-7597, 0x1e12,0x1e12,1,-7598, 0x1e13,0x1e13,1,-7599, 0x1e14,0x1e16,2,1,
  0x1e18,0x1e18,1,-7603, 0x1e19,0x1e19,1,-7604, 0x1e1a,0x1e1a,1,-7605, 0x1e1b,0x1e1b,1,-7606,
  0x1e1c,0x1e1c,1,1, 0x1e1e,0x1e1e,1,-7608, 0x1e1f,0x1e20,1,-7609, 0x1e21,0x1e22,1,-7610,
  0x1e23,0x1e23,1,-7611, 0x1e24,0x1e24,1,-7612, 0x1e25,0x1e25,1,-7613, 0x1e26,0x1e26,1,-7614,
  0x1e27,0x1e27,1,-7615, 0x1e28,0x1e28,1,-7616, 0x1e29,0x1e29,1,-7617, 0x1e2a,0x1e2a,1,-7618,
  0x1e2b,0x1e2c,1,-7619, 0x1e2d,0x1e2d,1,-7620, 0x1e2e,0x1e2e,1,1, 0x1e30,0x1e30,1,-7621,
  0x1e31,0x1e31,1,-7622, 0x1e32,0x1e32,1,-7623, 0x1e33,0x1e33,1,-7624, 0x1e34,0x1e34,1,-7625,
  0x1e35,0x1e36,1,-7626, 0x1e37,0x1e37,1,-7627, 0x1e38,0x1e38,1,1, 0x1e3a,0x1e3a,1,-7630,
  0x1e3b,0x1e3b,1,-7631, 0x1e3c,0x1e3c,1,-7632, 0x1e3d,0x1e3e,1,-7633, 0x1e3f,0x1e3f,1,-7634,
  0x1e40,0x1e40,1,-7635, 0x1e41,0x1e41,1,-7636, 0x1e42,0x1e42,1,-7637, 0x1e43,0x1e44,1,-7638,
  0x1e45,0x1e45,1,-7639, 0x1e46,0x1e46,1,-7640, 0x1e47,0x1e47,1,-7641, 0x1e48,0x1e48,1,-7642,
  0x1e49,0x1e49,1,-7643, 0x1e4a,0x1e4a,1,-7644, 0x1e4b,0x1e4b,1,-7645, 0x1e4c,0x1e52,2,1,
  0x1e54,0x1e54,1,-7652, 0x1e55,0x1e55,1,-7653, 0x1e56,0x1e56,1,-7654, 0x1e57,0x1e57,1,-7655,
  0x1e58,0x1e58,1,-7654, 0x1e59,0x1e59,1,-7655, 0x1e5a,0x1e5a,1,-7656, 0x1e5b,0x1e5b,1,-7657,
  0x1e5c,0x1e5c,1,1, 0x1e5e,0x1e5e,1,-7660, 0x1e5f,0x1e60,1,-7661, 0x1e61,0x1e61,1,-7662,
  0x1e62,0x1e62,1,-7663, 0x1e63,0x1e63,1,-7664, 0x1e64,0x1e68,2,1, 0x1e6a,0x1e6a,1,-7670,
  0x1e6b,0x1e6b,1,-7671, 0x1e6c,0x1e6c,1,-7672, 0x1e6d,0x1e6d,1,-7673, 0x1e6e,0x1e6e,1,-7674,
  0x1e6f,0x1e6f,1,-7675, 0x1e70,0x1e70,1,-7676, 0x1e71,0x1e72,1,-7677, 0x1e73,0x1e73,1,-7678,
  0x1e74,0x1e74,1,-7679, 0x1e75,0x1e75,1,-7680, 0x1e76,0x1e76,1,-7681, 0x1e77,0x1e77,1,-7682,
  0x1e78,0x1e7a,2,1, 0x1e7c,0x1e7c,1,-7686, 0x1e7d,0x1e7d,1,-7687, 0x1e7e,0x1e7e,1,-7688,
  0x1e7f,0x1e80,1,-7689, 0x1e81,0x1e81,1,-7690, 0x1e82,0x1e82,1,-7691, 0x1e83,0x1e83,1,-7692,
  0x1e84,0x1e84,1,-7693, 0x1e85,0x1e85,1,-7694, 0x1e86,0x1e86,1,-7695, 0x1e87,0x1e87,1,-7696,
  0x1e88,0x1e88,1,-7697, 0x1e89,0x1e8a,1,-7698, 0x1e8b,0x1e8b,1,-7699, 0x1e8c,0x1e8c,1,-7700,
  0x1e8d,0x1e8e,1,-7701, 0x1e8f,0x1e90,1,-7702, 0x1e91,0x1e91,1,-7703, 0x1e92,0x1e92,1,-7704,
  0x1e93,0x1e93,1,-7705, 0x1e94,0x1e94,1,-7706, 0x1e95,0x1e95,1,-7707, 0x1e96,0x1e96,1,-7726,
  0x1e97,0x1e97,1,-7715, 0x1e98,0x1e98,1,-7713, 0x1e99,0x1e99,1,-7712, 0x1e9b,0x1e9b,1,-7720,
  0x1e9e,0x1e9e,1,-7615, 0x1ea0,0x1ea0,1,-7743, 0x1ea1,0x1ea1,1,-7744, 0x1ea2,0x1ea2,1,-7745,
  0x1ea3,0x1ea3,1,-7746, 0x1ea4,0x1eb6,2,1, 0x1eb8,0x1eb8,1,-7763, 0x1eb9,0x1eb9,1,-7764,
  0x1eba,0x1eba,1,-7765, 0x1ebb,0x1ebb,1,-7766, 0x1ebc,0x1ebc,1,-7767, 0x1ebd,0x1ebd,1,-7768,
  0x1ebe,0x1ec6,2,1, 0x1ec8,0x1ec8,1,-7775, 0x1ec9,0x1ec9,1,-7776, 0x1eca,0x1eca,1,-7777,
  0x1ecb,0x1ecb,1,-7778, 0x1ecc,0x1ecc,1,-7773, 0x1ecd,0x1ecd,1,-7774, 0x1ece,0x1ece,1,-7775,
  0x1ecf,0x1ecf,1,-7776, 0x1ed0,0x1ee2,2,1, 0x1ee4,0x1ee4,1,-7791, 0x1ee5,0x1ee5,1,-7792,
  0x1ee6,0x1ee6,1,-7793, 0x1ee7,0x1ee7,1,-7794, 0x1ee8,0x1ef0,2,1, 0x1ef2,0x1ef2,1,-7801,
  0x1ef3,0x1ef3,1,-7802, 0x1ef4,0x1ef4,1,-7803, 0x1ef5,0x1ef5,1,-7804, 0x1ef6,0x1ef6,1,-7805,
  0x1ef7,0x1ef7,1,-7806, 0x1ef8,0x1ef8,1,-7807, 0x1ef9,0x1ef9,1,-7808, 0x1efa,0x1efe,2,1,
  0x1f08,0x1f0f,1,-8, 0x1f18,0x1f1d,1,-8, 0x1f28,0x1f2f,1,-8, 0x1f38,0x1f3f,1,-8,
  0x1f48,0x1f4d,1,-8, 0x1f59,0x1f5f,2,-8, 0x1f68,0x1f6f,1,-8, 0x1f88,0x1f8f,1,-8,
  0x1f98,0x1f9f,1,-8, 0x1fa8,0x1faf,1,-8, 0x1fb8,0x1fb9,1,-8, 0x1fba,0x1fbb,1,-74,
  0x1fbc,0x1fbc,1,-9, 0x1fbe,0x1fbe,1,-7173, 0x1fc8,0x1fcb,1,-86, 0x1fcc,0x1fcc,1,-9,
  0x1fd8,0x1fd9,1,-8, 0x1fda,0x1fdb,1,-100, 0x1fe8,0x1fe9,1,-8, 0x1fea,0x1feb,1,-112,
  0x1fec,0x1fec,1,-7, 0x1ff8,0x1ff9,1,-128, 0x1ffa,0x1ffb,1,-126, 0x1ffc,0x1ffc,1,-9,
  0x2126,0x2126,1,-7517, 0x212a,0x212a,1,-8383, 0x212b,0x212b,1,-8394, 0x2132,0x2132,1,28,
  0x2160,0x216f,1,16, 0x2183,0x2183,1,1, 0x2c00,0x2c2e,1,48, 0x2c60,0x2c60,1,1,
  0x2c62,0x2c62,1,-10743, 0x2c63,0x2c63,1,-3814, 0x2c64,0x2c64,1,-10727, 0x2c67,0x2c6b,2,1,
  0x2c6d,0x2c6d,1,-10780, 0x2c6e,0x2c6e,1,-10749, 0x2c6f,0x2c6f,1,-10783, 0x2c70,0x2c70,1,-10782,
  0x2c72,0x2c72,1,1, 0x2c75,0x2c75,1,1, 0x2c7e,0x2c7f,1,-10815, 0x2c80,0x2ce2,2,1,
  0x2ceb,0x2ced,2,1, 0x2cf2,0x2cf2,1,1, 0xa640,0xa66c,2,1, 0xa680,0xa696,2,1,
  0xa722,0xa72e,2,1, 0xa732,0xa76e,2,1, 0xa779,0xa77b,2,1, 0xa77d,0xa77d,1,-35332,
  0xa77e,0xa786,2,1, 0xa78b,0xa78b,1,1, 0xa78d,0xa78d,1,-42280, 0xa790,0xa792,2,1,
  0xa7a0,0xa7a8,2,1, 0xa7aa,0xa7aa,1,-42308, 0xff21,0xff3a,1,32, 0x10400,0x10427,1,40,
];

/** The index of the last record of the flat `table` (`width` numbers a record, sorted by the first) that starts at or before `cp`, or -1. */
function unicode61Seek(table, width, cp) {
  let lo = 0;
  let hi = table.length / width - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid * width] <= cp) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Whether code point `cp` is a standalone unicode61 token character, by the frozen table (never by host Unicode properties). */
function isUnicode61Token(cp) {
  const at = unicode61Seek(UNICODE61_TOKEN_RANGES, 2, cp);
  return at >= 0 && cp <= UNICODE61_TOKEN_RANGES[at * 2 + 1];
}

/** The code point unicode61 (remove_diacritics=1) folds token character `cp` to, WITHOUT context, by the frozen table. */
function unicode61Fold(cp) {
  const at = unicode61Seek(UNICODE61_FOLD_RULES, 4, cp) * 4;
  return at >= 0 && cp <= UNICODE61_FOLD_RULES[at + 1] && (cp - UNICODE61_FOLD_RULES[at]) % UNICODE61_FOLD_RULES[at + 2] === 0 ? cp + UNICODE61_FOLD_RULES[at + 3] : cp;
}

/** The comparison form of one unicode61 token candidate, as FTS5's default `porter unicode61` (remove_diacritics=1)
 *  compares it: a dropped mark removed, every other code point folded alone by the frozen table (never by the host's case or
 *  normalization rules). It is a comparison value only: the candidate's span in the source text is never rebuilt from it
 *  (Task 12 fix round 1, F2; round 2, F2; round 3, F2; round 4, F2). */
function foldToken(word) {
  let out = '';
  for (const ch of word) {
    const cp = ch.codePointAt(0);
    if (!isDroppedMark(cp)) out += String.fromCodePoint(unicode61Fold(cp));
  }
  return out;
}

/** Unicode61 token candidates with their original code-unit spans, lazily. A candidate is OPENED only by a token character (the
 *  frozen table) and continues over token characters and the marks unicode61 drops: a dropped mark belongs to the token it FOLLOWS,
 *  as in FTS5, so a decomposed `e` + U+0301 is one candidate, but a mark can never open one. A leading or mark-only run of dropped
 *  marks is skipped, no token, as runtime SQLite's highlight() measures (U+0301 then `a` hits at the `a`; Task 12 fix round 5, F2). Every
 *  other code point, a lone surrogate included, is a boundary. Spans stay in the source's UTF-16 code units. */
function* unicode61Words(text) {
  let at = -1;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (isUnicode61Token(cp)) {
      if (at < 0) at = i;
    } else if (at >= 0 && !isDroppedMark(cp)) {
      yield { text: text.slice(at, i), at, end: i };
      at = -1;
    }
    i += cp > 0xffff ? 2 : 1;
  }
  if (at >= 0) yield { text: text.slice(at), at, end: text.length };
}

/** A slice end that never splits a surrogate pair. */
function cutBefore(s, n) {
  if (n <= 0) return 0;
  if (n >= s.length) return s.length;
  const code = s.charCodeAt(n);
  return code >= 0xdc00 && code <= 0xdfff ? n - 1 : n;
}

// derived from lossless-claw src/store/full-text-fallback.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
/** The grep snippet (§8.4, §11 P9): a window of 24 characters before and 40
 *  after the earliest hit, `...` at a cut end; no hit gives the first 80. A
 *  contentless FTS5 table has no snippet() (it answers NULL, measured), so
 *  this is the only path, and the caller hands it REDACTED text (§8.3):
 *  redact, then cut. For a longer body that text is a window around the
 *  hit plus ENTRY_REDACT_MARGIN on each side, redacted and cut back to the
 *  window, never the whole body (Task 12's displaySnippet, which hitSnippet
 *  calls; snippetWindow's search is Task 12's snippetSpan; spec §8.3 and
 *  §8.4, the plan's Global Constraints R2). Each unicode61 candidate is
 *  compared using the same Porter stem FTS5 uses. A trailing `*` is the plain
 *  query prefix marker and matches the candidate's pre-stem lowercased text.
 *  The search preserves candidate spans, so case folding never drifts the
 *  displayed window's indices. */
export function snippetWindow(text, terms) {
  const content = String(text);
  const { at, len } = snippetSpan(content, terms);
  if (at === -1) {
    const head = content.trim();
    return head.length <= 80 ? head : `${head.slice(0, cutBefore(head, 77)).trimEnd()}...`;
  }
  let start = Math.max(0, at - 24);
  if (start > 0 && cutBefore(content, start) !== start) start -= 1;
  const end = cutBefore(content, Math.min(content.length, at + Math.max(len, 1) + 40));
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

/** `--since` / `--before` (§8.4), plan-chosen grammar: `<n>d`, `<n>h` or
 *  `<n>min` before now, or an ISO-8601 date (UTC midnight) or date-time with
 *  `Z` or an offset. A date-time without a zone would depend on the box's
 *  timezone, and an impossible date (`2026-02-30`) would roll over, so both
 *  are null, which the CLI answers exit 2 `bad-args`. Minutes are `min`,
 *  never `m`, which `prune --older-than` reads as months. */
export function parseTimeBound(s, nowMs) {
  const t = String(s).trim();
  const rel = /^([1-9][0-9]{0,6})(d|h|min)$/.exec(t);
  if (rel !== null) return nowMs - Number(rel[1]) * { d: 86_400_000, h: 3_600_000, min: 60_000 }[rel[2]];
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(t);
  if (m === null) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.getUTCFullYear() !== Number(m[1]) || day.getUTCMonth() !== Number(m[2]) - 1 || day.getUTCDate() !== Number(m[3])) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}


// ===========================================================================
// W1-B2 recall, Task 3: output primitives (spec §8.3, §8.4 describe and
// expand, §11 P11, P12, P13, P17, P30). Task 2's module-private `cutBefore`
// makes every cut here surrogate-safe. Recalled fields reach these already
// redacted; these primitives then cut, escape, count and serialise.
// ===========================================================================
export const OUTPUT_CAP = 20000;
export const EXPLORE_CUT = 2000;
export const DESCRIBE_EXCERPT = 4000;
export const DELEGATE_FACTOR = 3;
export const SNIPPET_MAX = 200;
export const EXPLORE_JSON_MAX = 4 * 1024 * 1024;
export const HISTORY_CMD = '"$HOME/.local/bin/ccrc" history';
export const SHIM_LOCK_HELD = 75;
export const RECALL_SRCS = Object.freeze([...new Set([...PROVENANCE, 'node', 'summary', 'sidecar', 'unknown'])]);

const REASON_EXITS = new Set(Object.values(REASONS));

// derived from lossless-claw src/assembler.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
export function escapeXmlAttr(value) {
  // Every line separator is escaped too (D-4597 (history-read-names-and-echoes-display-redacted)): a stored id holding one
  // cannot forge a line. Beside \n and \r that is U+0085 (NEL), U+2028 and U+2029, which a reader that splits lines on
  // Unicode separators (and JS's `^` under /m, for the last two) takes as a line start.
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\u0085/g, '&#133;').replace(/\u2028/g, '&#8232;').replace(/\u2029/g, '&#8233;');
}

export function escapeXmlText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One recalled field in its untrusted-content envelope. `family` (optional) names the family a hit belongs to under
 *  a widened scope: `{ id, generation, firstSeenMs }`, the two strings already display strings (W1-B2 whole-branch fix
 *  round 1, item B; spec §8.2: under --workspace each hit prints its family). Absent, the envelope is byte for byte
 *  what it was; present, `family`, `generation` and `first-seen` sit between `role` and `trust`. */
export function recallEnvelope({ src, id, ts, role, text, family }) {
  const word = RECALL_SRCS.includes(src) ? src : 'unknown';
  const when = typeof ts === 'number' && Number.isFinite(ts) && Math.abs(ts) <= 8.64e15 ? new Date(ts).toISOString() : '';
  const fam = family === undefined ? ''
    : ` family="${escapeXmlAttr(String(family.id))}" generation="${escapeXmlAttr(String(family.generation))}" first-seen="${escapeXmlAttr(
      Number.isFinite(family.firstSeenMs) && Math.abs(family.firstSeenMs) <= 8.64e15 ? new Date(family.firstSeenMs).toISOString() : '')}"`;
  return `<ccrc-recall src="${escapeXmlAttr(word)}" id="${escapeXmlAttr(String(id))}" ts="${escapeXmlAttr(when)}" role="${escapeXmlAttr(role ?? '')}"${fam} trust="untrusted">${escapeXmlText(String(text))}</ccrc-recall>`;
}

// derived from lossless-claw src/tools/lcm-grep-tool.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
export function snippetLine(text, max = SNIPPET_MAX) {
  const single = String(text).replace(/\n/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, cutBefore(single, max - 3))}...`;
}

/** What a stored uuid, type, role or raw key looks like: every real one. */
const DISPLAY_TOKEN_RE = /^[A-Za-z0-9._:/-]{1,128}$/;

/** A stored identifier as ONE display string (D-4597 (history-read-names-and-echoes-display-redacted); D-4596
 *  (history-read-fixed-fields-fit-the-cap)). A uuid, type, role or key that has the shape of every real one is returned as
 *  it is. Anything else (a crafted transcript or an operator import can store any string) is redacted on its raw text,
 *  folded to one line (every whitespace, control and line-separator character, U+0085 included, becomes a space), cut at
 *  SNIPPET_MAX and quoted as a JSON string. It is NOT XML-escaped: the sink escapes it, once, for its own context
 *  (escapeXmlText in a text line, escapeXmlAttr in an attribute, JSON.stringify in --json), so no context escapes it
 *  twice. The output is at most 6 * SNIPPET_MAX + 2 characters: folding leaves no control character to JSON-quote at six
 *  characters, and what is left that costs six is a surrogate half with no pair; `"` and `\` cost two. */
export function displayToken(value, idx) {
  const s = String(value);
  if (DISPLAY_TOKEN_RE.test(s)) return s;
  return JSON.stringify(snippetLine(foldOneLine(redactForDisplay(s, idx))));
}

/** One line: every run of whitespace, control and line-separator characters (the set DISPLAY_FOLD_RE names) becomes one
 *  space. It runs AFTER redaction (§8.3: redact the raw text, fold, cut), so folding exposes nothing, and every read verb's
 *  one-line echo (a hint, a sidecar name, a child's stderr) folds through it (D-4597). */
export function foldOneLine(text) {
  return String(text).replace(DISPLAY_FOLD_RE, ' ');
}

/** What displayToken folds to one space: whitespace (JS `\s`, which has U+2028 and U+2029), every C0 and C1 control
 *  character (U+0085, NEL, is C1 and is not in `\s`) and DEL. */
const DISPLAY_FOLD_RE = /[\s\u0000-\u001f\u007f-\u009f]+/g;

export function capOutput(blocks, reserve, cap = OUTPUT_CAP) {
  const budget = cap - reserve;
  const kept = [];
  let used = 0;
  for (const block of blocks) {
    const cost = block.length + 1;
    if (used + cost > budget) break;
    kept.push(block);
    used += cost;
  }
  return { kept, shown: kept.length };
}

export function shownLine(shown, total) {
  if (!Number.isSafeInteger(shown) || !Number.isSafeInteger(total) || shown < 0 || shown > total) throw new TypeError(`shownLine: shown ${String(shown)} of ${String(total)} is not a count`);
  return `shown ${shown} of ${total}`;
}

const SHELL_SAFE_RE = /^[A-Za-z0-9_./:=@%+,-]+$/;
export function nextLine(args) {
  const quoted = args.map((a) => (SHELL_SAFE_RE.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`));
  return `next: ${HISTORY_CMD} ${quoted.join(' ')}`;
}

export function headerLine(h) {
  if (!SCOPE_KINDS.includes(h.kind)) throw new TypeError(`headerLine: kind outside SCOPE_KINDS: ${String(h.kind)}`);
  const scope = h.kind === 'family' ? `family(${h.id}, ${h.transcripts} transcripts)` : `${h.kind}(${h.project}, ${h.families} families)`;
  const through = h.indexedThroughMs === null ? 'unmeasured' : new Date(h.indexedThroughMs).toISOString();
  const lag = h.lagS === null ? 'unmeasured' : `${h.lagS}s`;
  return `scope=${scope} coverage=${COVERAGE[0]} indexed-through=${through} lag=${lag}`;
}

export function scopeLag({ eofMs, nowMs, recovering }) {
  if (recovering || eofMs.length === 0) return { indexedThroughMs: null, lagS: null };
  let oldest = Infinity;
  for (const e of eofMs) {
    if (typeof e !== 'number' || !Number.isFinite(e)) return { indexedThroughMs: null, lagS: null };
    if (e < oldest) oldest = e;
  }
  return { indexedThroughMs: oldest, lagS: Math.max(0, Math.floor((nowMs - oldest) / 1000)) };
}

export function readEnvelope(o) {
  if (!Object.values(EXIT).includes(o.exit)) throw new TypeError(`readEnvelope: ${String(o.exit)} is not an EXIT value`);
  if (REASON_EXITS.has(o.exit)) {
    if (typeof o.reason !== 'string' || !Object.hasOwn(REASONS, o.reason) || REASONS[o.reason] !== o.exit) throw new TypeError(`readEnvelope: exit ${o.exit} needs a reason word of its own code, got ${String(o.reason)}`);
  } else if (o.reason !== undefined) {
    throw new TypeError(`readEnvelope: exit ${o.exit} carries no reason, got ${String(o.reason)}`);
  }
  if (!Number.isSafeInteger(o.shown) || !Number.isSafeInteger(o.total) || o.shown < 0 || o.shown > o.total) throw new TypeError(`readEnvelope: shown ${String(o.shown)} of ${String(o.total)} is not a count`);
  // D-4595 (history-json-envelope-carries-hint): a verb's hint rides --json as it rides the human form, so a refusal's
  // detail (a regex child's failure, the reach line, a stale cursor) is not lost. Additive: absent when there is none.
  if (o.hint !== undefined && typeof o.hint !== 'string') throw new TypeError(`readEnvelope: a hint is a string, got ${typeof o.hint}`);
  return { v: 1, exit: o.exit, ...(o.reason === undefined ? {} : { reason: o.reason }), store_id: o.storeId, coverage: COVERAGE[0], scope: o.scope, indexed_through_ms: o.header === null ? null : o.header.indexedThroughMs, lag_s: o.header === null ? null : o.header.lagS, items: o.items.map((item) => ({ ...item, trust: 'untrusted' })), shown: o.shown, total: o.total, next: o.next, ...(o.hint === undefined ? {} : { hint: o.hint }) };
}

export const CURSOR_RESOURCES = Object.freeze(['grep', 'describe', 'expand']);
const CURSOR_MAX = 2048;
const CURSOR_TEXT_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const CURSOR_FIELDS = Object.freeze({
  grep: Object.freeze(['v', 'resource', 'q', 'pos']),
  describe: Object.freeze(['v', 'resource', 'node', 'off']),
  expand: Object.freeze(['v', 'resource', 't', 'i', 'o']),
});

function cursorIdOk(v) {
  return typeof v === 'string' && CURSOR_TEXT_RE.test(v);
}

function cursorOffsetOk(v) {
  return Number.isSafeInteger(v) && v >= 0;
}

/** Cursor fields are resource schemas, not an extensible object. This keeps
 *  recalled text out of both values and object keys before it reaches next:. */
function cursorShapeOk(c) {
  if (c === null || typeof c !== 'object' || Array.isArray(c) || c.v !== 1 || !CURSOR_RESOURCES.includes(c.resource)) return false;
  const fields = CURSOR_FIELDS[c.resource];
  const keys = Object.keys(c);
  if (keys.length !== fields.length || !fields.every((field) => Object.hasOwn(c, field))) return false;
  if (c.resource === 'grep') return cursorIdOk(c.q) && cursorOffsetOk(c.pos);
  if (c.resource === 'describe') return cursorIdOk(c.node) && cursorOffsetOk(c.off);
  return cursorIdOk(c.t) && cursorOffsetOk(c.i) && cursorOffsetOk(c.o);
}
// derived from lossless-claw src/cli/args.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
export function encodeCursor(c) {
  if (!cursorShapeOk(c)) throw new TypeError('encodeCursor: a cursor holds v: 1, a CURSOR_RESOURCES word, and ids or integers only');
  const s = Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
  if (s.length > CURSOR_MAX) throw new TypeError(`encodeCursor: ${s.length} characters, over ${CURSOR_MAX}`);
  return s;
}
export function decodeCursor(s, resource) {
  if (typeof s !== 'string' || s.length === 0 || s.length > CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  let c;
  try { c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; }
  return cursorShapeOk(c) && c.resource === resource ? c : null;
}

export function decideRelay({ status, signal, lastLine }) {
  const internal = { exit: EXIT.INTERNAL };
  if (signal !== null) return internal;
  if (status === SHIM_LOCK_HELD) return { exit: EXIT.WRITER_BUSY, reason: 'writer-busy' };
  if (typeof lastLine !== 'string') return internal;
  let r;
  try { r = JSON.parse(lastLine); } catch { return internal; }
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return internal;
  const keys = Object.keys(r).sort().join(',');
  if (keys !== 'rc' && keys !== 'rc,reason') return internal;
  if (!Object.values(EXIT).includes(r.rc) || r.rc !== status) return internal;
  if (REASON_EXITS.has(r.rc)) return typeof r.reason === 'string' && Object.hasOwn(REASONS, r.reason) && REASONS[r.reason] === r.rc ? { exit: r.rc, reason: r.reason } : internal;
  return r.reason === undefined ? { exit: r.rc } : internal;
}

// derived from lossless-claw src/large-files.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const EXPLORE_CODE_EXTENSIONS = new Set(['c', 'cc', 'cpp', 'cs', 'go', 'h', 'hpp', 'java', 'js', 'jsx', 'kt', 'm', 'php', 'py', 'rb', 'rs', 'scala', 'sh', 'sql', 'swift', 'ts', 'tsx']);
const READ_PREFIX_RE = /^\s*(\d+)(?:→|\t)/;
export function stripReadPrefix(text) {
  const lines = String(text).split('\n');
  let prev = null;
  let k = 0;
  for (; k < lines.length; k += 1) {
    const m = READ_PREFIX_RE.exec(lines[k]);
    if (m === null || (prev !== null && Number(m[1]) !== prev + 1)) break;
    prev = Number(m[1]);
    lines[k] = lines[k].slice(m[0].length);
  }
  return k === 0 ? String(text) : lines.join('\n');
}
function fileNameExtension(fileName) {
  if (typeof fileName !== 'string' || fileName === '') return undefined;
  const base = fileName.trim().split(/[\\/]/).pop() ?? '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return undefined;
  const ext = base.slice(idx + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : undefined;
}
export function exploreKindOf(path) {
  const ext = fileNameExtension(path);
  if (ext === 'json' || ext === 'csv' || ext === 'tsv') return ext;
  return ext !== undefined && EXPLORE_CODE_EXTENSIONS.has(ext) ? 'code' : null;
}
function normalizeTextForLine(text, maxLen) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLen ? compact : `${compact.slice(0, cutBefore(compact, maxLen))}...`;
}
function uniqueOrdered(values) {
  const seen = new Set(); const out = [];
  for (const value of values) if (!seen.has(value)) { seen.add(value); out.push(value); }
  return out;
}
function exploreJson(content) {
  const parsed = JSON.parse(content);
  const describe = (value, depth = 0) => {
    if (depth >= 2) return '...';
    if (Array.isArray(value)) { const sample = value.slice(0, 3).map((item) => describe(item, depth + 1)); return `array(len=${value.length}${sample.length > 0 ? `, sample=[${sample.join(', ')}]` : ''})`; }
    if (!value || typeof value !== 'object') return typeof value;
    const keys = Object.keys(value); const preview = keys.slice(0, 10).join(', ');
    return `object(keys=${keys.length}${preview ? `: ${preview}` : ''})`;
  };
  return ['Structured summary (JSON):', `Top-level type: ${Array.isArray(parsed) ? 'array' : typeof parsed}.`, `Shape: ${describe(parsed)}.`].join('\n');
}
function parseDelimitedLine(line, delimiter) { return line.split(delimiter).map((item) => item.trim()).filter((item) => item.length > 0); }
function exploreDelimited(content, delimiter, kind) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return `Structured summary (${kind}): no rows found.`;
  const headers = parseDelimitedLine(lines[0], delimiter); const rowCount = Math.max(0, lines.length - 1); const firstData = lines[1] ? normalizeTextForLine(lines[1], 180) : '(no data rows)';
  return [`Structured summary (${kind}):`, `Rows: ${rowCount.toLocaleString('en-US')}.`, `Columns (${headers.length}): ${headers.join(', ') || '(none detected)'}.`, `First row sample: ${firstData}.`].join('\n');
}
function exploreCode(content, fileName) {
  const lines = content.split(/\r?\n/);
  const imports = uniqueOrdered(lines.filter((line) => /^\s*(import\s+|from\s+\S+\s+import\s+|const\s+\w+\s*=\s*require\()/.test(line)).map((line) => normalizeTextForLine(line, 180)).slice(0, 12));
  const signatures = uniqueOrdered(lines.map((line) => line.trim()).filter((line) => /^(export\s+)?(async\s+)?(function|class|interface|type|const\s+\w+\s*=\s*\(|def\s+\w+\(|struct\s+\w+)/.test(line)).map((line) => normalizeTextForLine(line, 200)).slice(0, 24));
  return [`Code exploration summary${fileName ? ` (${fileName})` : ''}:`, `Lines: ${lines.length.toLocaleString('en-US')}.`, `Imports/dependencies (${imports.length}): ${imports.join(' | ') || 'none detected'}.`, `Top-level definitions (${signatures.length}): ${signatures.join(' | ') || 'none detected'}.`].join('\n');
}
function exploreCounts(content) { return ['Structured summary:', `Characters: ${content.length.toLocaleString('en-US')}.`, `Lines: ${content.split(/\r?\n/).length.toLocaleString('en-US')}.`].join('\n'); }
export function explore(text, kind, fileName) {
  const content = stripReadPrefix(String(text));
  switch (kind) {
    case 'json': if (content.length > EXPLORE_JSON_MAX) return exploreCounts(content); try { return exploreJson(content); } catch { return 'Structured summary (JSON): failed to parse as valid JSON.'; }
    case 'csv': return exploreDelimited(content, ',', 'CSV');
    case 'tsv': return exploreDelimited(content, '\t', 'TSV');
    case 'code': return exploreCode(content, fileName);
    default: throw new TypeError(`explore: kind outside json, csv, tsv and code: ${String(kind)}`);
  }
}
export function costRow(chars, cap = OUTPUT_CAP) { return { chars, fits: chars <= cap ? 'in' : 'over' }; }
export function pickExpandBody({ primary, variants }) {
  for (const v of variants) {
    if (v.cause !== 'ccd-sanitize' || variantCauseOf(primary, v.body) !== 'ccd-sanitize') continue;
    return sanitizedSideOf(primary, v.body) === 'a' ? v.body : primary;
  }
  return primary;
}
function sanitizedSideOf(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (canonicalJson(a[i]) === canonicalJson(b[i])) continue;
    return a[i] !== null && typeof a[i] === 'object' && a[i].text === '...' ? 'a' : 'b';
  }
  return 'b';
}


// ===========================================================================
// W1-B2 recall, Task 4: pure parser decisions over one boundary summary.
// The card's heading utilities are injected; this L1 module never imports them.
// Every native field is redacted before it is capped.
// ===========================================================================

// derived from lossless-claw src/summarize.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
export const EXPAND_LABEL = 'Expand for details about:';
export const BLOCK_RE_SOURCE = String.raw`<ccrc-(leaf|node)\s+([^>\n]*)>\n?([\s\S]*?)<\/ccrc-\1>`;
export const GIST_MAX = 1200;
export const NATIVE_GIST_MAX = 600;
export const GIST_MIN = 40;
export const TOPICS_MAX = 16;
export const TOPIC_CHARS = 80;
export const REFS_MAX = 40;
export const NODE_PARSER_VERSION = 1;
export const REF_KINDS = Object.freeze(['path', 'path:symbol', 'sha', 'issue', 'd-number', 'url', 'test']);
export const BLOCK_REASONS = Object.freeze([
  'no-receipt', 'no-block', 'gist-short', 'carried-copy', 'id-mismatch', 'topics-missing', 'refs-missing',
]);

/** A surrogate-safe field cut that reports the cap separately from its text. */
export function capText(text, max) {
  const s = String(text);
  return s.length <= max ? { text: s, capped: false } : { text: s.slice(0, cutBefore(s, max)), capped: true };
}

export function capTopics(items) {
  const seen = new Set();
  const topics = [];
  let capped = false;
  for (const raw of items) {
    const one = capText(String(raw).replace(/\s+/g, ' ').trim(), TOPIC_CHARS);
    if (one.text === '' || seen.has(one.text)) continue;
    if (topics.length === TOPICS_MAX) { capped = true; break; }
    seen.add(one.text);
    topics.push(one.text);
    capped ||= one.capped;
  }
  return { topics, capped };
}

/** Hash precisely the stored representation, including its cap normalization. */
export function gistSha(gist) {
  return sha256Hex(capText(String(gist).trim(), GIST_MAX).text.trimEnd());
}

const BLOCK_ATTR_RE = /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g;
const BLOCK_KEY_RE = /^([a-z][a-z0-9_-]*):[ \t]?(.*)$/;

function analysisRanges(s) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const open = s.indexOf('<analysis>', from);
    if (open < 0) return ranges;
    const close = s.indexOf('</analysis>', open);
    const end = close < 0 ? s.length : close + '</analysis>'.length;
    ranges.push([open, end]);
    from = end;
  }
}

/** Parse every steer block in a row, treating lower-case unknown keys as fields. */
export function parseBlocks(text) {
  const s = String(text);
  const analysis = analysisRanges(s);
  const out = [];
  for (const m of s.matchAll(new RegExp(BLOCK_RE_SOURCE, 'g'))) {
    const attrs = {};
    let attrCount = 0;
    for (const a of m[2].matchAll(BLOCK_ATTR_RE)) { attrs[a[1]] = a[2]; attrCount += 1; }
    if (attrCount === 0) continue;
    const fields = { gist: null, expand: null, refs: null };
    let current = null;
    for (const line of m[3].split('\n')) {
      let key = null;
      let value = '';
      if (line.startsWith(EXPAND_LABEL)) {
        key = 'expand';
        value = line.slice(EXPAND_LABEL.length);
      } else {
        const k = BLOCK_KEY_RE.exec(line);
        if (k !== null) {
          key = k[1] === 'gist' || k[1] === 'refs' ? k[1] : 'ignored';
          value = k[2];
        }
      }
      if (key !== null) {
        current = key;
        if (key !== 'ignored') fields[key] = value.trim();
        continue;
      }
      if (current === null || current === 'ignored' || line.trim() === '') continue;
      fields[current] = fields[current] === '' ? line.trim() : `${fields[current]}\n${line.trim()}`;
    }
    const refsNone = fields.refs !== null && /^none$/i.test(fields.refs);
    out.push({
      kind: m[1], attrs, gist: fields.gist, expand: fields.expand,
      refs: fields.refs === null ? null : refsNone ? [] : fields.refs.split(/[\s,]+/).filter(Boolean),
      refsNone,
      inAnalysis: analysis.some(([a, b]) => m.index >= a && m.index < b),
    });
  }
  return out;
}

export function selectBlock({ blocks, kind, computedId, generic }) {
  const usable = blocks.filter((b) => b.kind === kind && !b.inAnalysis);
  const exact = usable.filter((b) => (generic ? !Object.hasOwn(b.attrs, 'id') : b.attrs.id === computedId));
  if (exact.length > 0) return { block: exact[exact.length - 1], idMismatch: false };
  if (usable.length > 0) return { block: usable[usable.length - 1], idMismatch: true };
  return { block: null, idMismatch: false };
}

export function blockStatus({ receipt, block, idMismatch, priorGistShas }) {
  if (!receipt) return { status: 'not-requested', reason: 'no-receipt' };
  if (block === null) return { status: 'absent', reason: 'no-block' };
  if (block.gist === null || block.gist.trim().length < GIST_MIN) return { status: 'invalid', reason: 'gist-short' };
  if (priorGistShas.has(gistSha(block.gist))) return { status: 'invalid', reason: 'carried-copy' };
  if (idMismatch) return { status: 'degraded', reason: 'id-mismatch' };
  if (block.expand === null || block.expand.trim() === '') return { status: 'degraded', reason: 'topics-missing' };
  if (block.refs === null || (block.refs.length === 0 && !block.refsNone)) return { status: 'degraded', reason: 'refs-missing' };
  return { status: 'ok', reason: null };
}

export function summaryParts(text) {
  const s = String(text);
  let opens = 0;
  let last = -1;
  for (let i = s.indexOf('<summary>'); i >= 0; i = s.indexOf('<summary>', i + 1)) {
    opens += 1;
    last = i;
  }
  return {
    bodyStart: last < 0 ? 0 : last + '<summary>'.length,
    opens,
    unclosed: last >= 0 && s.indexOf('</summary>', last) < 0,
    analysisSurvives: s.includes('<analysis>'),
  };
}

export function summaryRowFor({ boundaryUuid, anchorUuid, rows }) {
  if (typeof anchorUuid !== 'string' || anchorUuid === '') return { uuid: null, anchorIsBoundary: false };
  if (anchorUuid === boundaryUuid) {
    const at = rows.findIndex((r) => r.uuid === boundaryUuid);
    for (let k = at < 0 ? rows.length : at + 1; k < rows.length; k += 1) {
      if (rows[k].isCompactSummary && !rows[k].isEcho) return { uuid: rows[k].uuid, anchorIsBoundary: true };
    }
    return { uuid: null, anchorIsBoundary: true };
  }
  const row = rows.find((r) => r.uuid === anchorUuid);
  return { uuid: row !== undefined && !row.isEcho ? row.uuid : null, anchorIsBoundary: false };
}

const GIST_PAIRS = Object.freeze({
  current: Object.freeze(['current work', 'optional next step']),
  completed: Object.freeze(['work completed', 'context for continuing work']),
});

/** Return numbered sections at the smallest indentation outside code fences. */
function sectionsOf(body, kit) {
  const flags = kit.HEADING_RE.flags.includes('g') ? kit.HEADING_RE.flags : `${kit.HEADING_RE.flags}g`;
  const { ranges } = kit.fencedRanges(body);
  const found = [];
  let fence = 0;
  for (const m of body.matchAll(new RegExp(kit.HEADING_RE.source, flags))) {
    while (fence < ranges.length && m.index >= ranges[fence][1]) fence += 1;
    if (fence < ranges.length && m.index >= ranges[fence][0]) continue;
    const num = /(\d+)\./.exec(m[0]);
    found.push({
      start: m.index, end: m.index + m[0].length, title: m[1].trim(), num: num === null ? null : Number(num[1]),
      indent: /^[ \t]*/.exec(m[0])[0].length,
    });
  }
  const floor = found.reduce((lo, h) => Math.min(lo, h.indent), Infinity);
  const heads = found.filter((h) => h.indent === floor);
  return heads.map((h, k) => ({ ...h, stop: k + 1 < heads.length ? heads[k + 1].start : body.length }));
}

function lastSection(sections, body, name) {
  for (let k = sections.length - 1; k >= 0; k -= 1) {
    const t = sections[k].title;
    const low = t.toLowerCase();
    if (low === name || low.startsWith(`${name}:`)) {
      const inline = low === name ? '' : t.slice(name.length + 1);
      return { at: sections[k].start, label: t.slice(0, name.length), text: `${inline} ${body.slice(sections[k].end, sections[k].stop)}` };
    }
  }
  return null;
}

function summaryBody(redacted, kit) {
  const { bodyStart } = summaryParts(redacted);
  const tail = redacted.slice(bodyStart);
  const close = tail.lastIndexOf('</summary>');
  if (close < 0) return tail;
  const heads = sectionsOf(tail, kit);
  return close > (heads.length === 0 ? -1 : heads[heads.length - 1].start) ? tail.slice(0, close) : tail;
}

function pickNativeGist(redacted, direction, kit) {
  const body = summaryBody(redacted, kit);
  const sections = sectionsOf(body, kit);
  const found = (pair) => GIST_PAIRS[pair].map((name) => lastSection(sections, body, name));
  const latest = (pair) => Math.max(-1, ...found(pair).filter((s) => s !== null).map((s) => s.at));
  const order = direction === 'up_to' ? ['completed', 'current']
    : direction === 'from' ? ['current', 'completed']
      : ['current', 'completed'].sort((a, b) => latest(b) - latest(a));
  const pair = order.find((p) => latest(p) >= 0);
  if (pair === undefined) return null;
  const text = found(pair).filter((s) => s !== null).map((s) => `${s.label}: ${s.text.replace(/\s+/g, ' ').trim()}`).join('\n');
  return { text, pair };
}

export function nativeGist({ text, direction }, kit, idx) {
  const picked = pickNativeGist(redactField(String(text), idx), direction, kit);
  if (picked === null) return { gist: null, capped: false, pair: null };
  const out = capText(picked.text, NATIVE_GIST_MAX);
  return { gist: out.text, capped: out.capped, pair: picked.pair };
}

function topicItemsOf(text, kit, idx) {
  if (text === null) return [];
  const body = summaryBody(redactField(String(text), idx), kit);
  const sections = sectionsOf(body, kit);
  const { ranges } = kit.fencedRanges(body);
  const items = [];
  for (const num of [2, 3]) {
    const s = [...sections].reverse().find((x) => x.num === num);
    if (s === undefined) continue;
    let offset = s.end;
    for (const line of body.slice(s.end, s.stop).split('\n')) {
      const fenced = ranges.some(([a, b]) => offset >= a && offset < b);
      const m = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (!fenced && m !== null) items.push(m[1].replace(/\s+/g, ' ').trim());
      offset += line.length + 1;
    }
  }
  return items;
}

export function nativeTopics({ text, prevText }, kit, idx) {
  const before = new Set(topicItemsOf(prevText, kit, idx));
  return capTopics(topicItemsOf(text, kit, idx).filter((item) => !before.has(item)));
}

export function classifyRef(v) {
  const s = String(v).trim();
  if (s === '' || s.length > 512) return null;
  if (/^https?:\/\/\S+$/.test(s)) return 'url';
  if (/^D-[0-9]+$/.test(s)) return 'd-number';
  if (/^#[0-9]+$/.test(s)) return 'issue';
  if (/^[\w./-]*[\w-]\.(?:test|spec)\.[cm]?[jt]sx?$/.test(s)) return 'test';
  if (/^[\w./-]*\.[A-Za-z][A-Za-z0-9]{0,7}:[A-Za-z_$][\w$.]*$/.test(s)) return 'path:symbol';
  if (/^(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}$/.test(s)) return 'sha';
  if (/^[\w.-]*(?:\/[\w.-]+)+(?::[0-9]+(?:-[0-9]+)?)?$/.test(s)) return 'path';
  if (/^[\w-]+(?:\.[\w-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}(?::[0-9]+(?:-[0-9]+)?)?$/.test(s)) return 'path';
  return null;
}

export function capRefs(refs) {
  const seen = new Set();
  const out = [];
  let capped = false;
  for (const r of refs) {
    const key = `${r.kind}\0${r.value}`;
    if (seen.has(key)) continue;
    if (out.length === REFS_MAX) { capped = true; break; }
    seen.add(key);
    out.push({ kind: r.kind, value: r.value, origin: r.origin });
  }
  return { refs: out, capped };
}

// derived from lossless-claw src/summary-fallback.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const OPTIONAL_DIRECTIVE_SCOPE_PREFIX = String.raw`(?:all\s+)?(?:of\s+)?(?:(?:the|your|my|any|these|those)\s+)?`;
const DIRECTIVE_SCOPE = String.raw`(?:(?:previous|prior|above|earlier)(?:\s+(?:system|developer))?|(?:system|developer))`;
const UNSCOPED_DIRECTIVE_TARGET = String.raw`(?:(?:all|any)\s+)?(?:of\s+)?(?:(?:the|your|my|these|those|current|existing|original)\s+)?(?:instructions?|prompts?|rules?)`;
const ANSWER_DAN_OBJECT = String.raw`(?:(?:me|us)|(?:(?:(?:the|this|that|your|my|any|these|those|all|every)\s+)?(?:future\s+)?(?:users?|requests?|questions?|prompts?|messages?)))`;
const DAN_PERSONA_DIRECTIVE_PREFIX = String.raw`(?:^\s*|^\s*[A-Za-z][A-Za-z0-9 _/-]{0,40}:\s*)`;
const DIRECTIVE_SHAPED_PATTERNS = Object.freeze([
  new RegExp([
    String.raw`\b(ignore|disregard|forget|override)\s+${OPTIONAL_DIRECTIVE_SCOPE_PREFIX}${DIRECTIVE_SCOPE}\s+(instructions?|prompts?|rules?)\b`,
    String.raw`\b(ignore|disregard|forget|override)\s+${UNSCOPED_DIRECTIVE_TARGET}\s*(?:$|[.,;:!?]|\s+(?:and|then|now|before|after|instead|to|with|from)\b)`,
    String.raw`\byou\s+are\s+now\b`, String.raw`\bfrom\s+now\s+on\b`, String.raw`\breply\s+only\s+with\b`,
    String.raw`\b(reveal|print|show|dump|exfiltrate|provide|give|send)\s+(?:me\s+)?(?:(?:the|your|my|any)\s+)?(system|developer)\s+prompt\b`,
    String.raw`\bjailbreak\s+(?:mode|prompt|instructions?|the\s+model|the\s+assistant)\b`,
  ].join('|'), 'i'),
  /\bdan\s+mode\b/i, /\byou\s+are\s+dan\b/i,
  new RegExp(String.raw`\banswer\s+${ANSWER_DAN_OBJECT}\s+as\s+dan\b`, 'i'),
  new RegExp(String.raw`${DAN_PERSONA_DIRECTIVE_PREFIX}(?:act\s+as|pretend\s+to\s+be)\s+dan\b`, 'i'),
  /\b(?:[Aa][Cc][Tt]\s+[Aa][Ss]|[Pp][Rr][Ee][Tt][Ee][Nn][Dd]\s+[Tt][Oo]\s+[Bb][Ee])\s+(?!Dan\b)[Dd][Aa][Nn]\b/,
  /\b(?:[Ee][Nn][Aa][Bb][Ll][Ee]|[Aa][Cc][Tt][Ii][Vv][Aa][Tt][Ee]|[Uu][Nn][Ll][Oo][Cc][Kk]|[Ee][Nn][Tt][Ee][Rr]|[Ss][Tt][Aa][Rr][Tt]|[Uu][Ss][Ee])\s+(?!Dan\b)[Dd][Aa][Nn]\b/,
]);

export function directiveFlag(text) {
  const s = String(text);
  const units = s.match(/\n+|[^\n.!?]+[.!?]*\s*/g) ?? [s];
  return units.some((unit) => !/^\n+$/.test(unit) && DIRECTIVE_SHAPED_PATTERNS.some((p) => p.test(unit)));
}

// ===========================================================================
// Spans, leaf ids, readiness, fan-in and parent rollups (spec §6.1 "Span
// rule: an exact partition" and "Two forks after one head"; §6.3; W1-B2
// Task 5). Pure: derive.mjs (L4) reads ONE copy's rows in file order
// (memberships.line, a byte offset) with its boundaries' metadata and hands
// them in; nothing here reads the store. D-4687 (history-span-exact-partition)
// D-4688 (history-span-per-boundary-copy) D-4689 (history-leaf-id-fork-qualified)
// ===========================================================================

/** The leaves one copy's boundaries make, and its live tail (§6.1).
 *  `rows` are the copy's stored rows in any order: they are sorted by `pos`, the row's byte offset in that copy.
 *  `boundaries` are the SAME copy's boundary rows, each with:
 *  - `headUuid` (preservedSegment.headUuid);
 *  - `kept` (the members of preservedMessages.allUuids; a member absent from the copy is never tested);
 *  - `summaryUuid` (the summary row the parser chose, or null).
 *  Leaf N covers [head(N-1), boundary(N)), an epoch's first leaf from the copy's first row, minus:
 *  - boundary and summary rows;
 *  - the rows of [head(N-1), boundary(N-1)) absent from kept(N-1). Leaf N-1 claimed them: compaction N-1
 *    summarised them although they sit after its head (G12, ruled Q5);
 *  - the rows of [head(N), boundary(N)) in kept(N). Compaction N kept them verbatim: they belong to leaf N+1.
 *  The live tail is what no leaf covers yet: the last compaction's kept rows and every row after it.
 *  logicalParentUuid is never an input: it names the preserved tail's END (§6.1, M). A head absent from the copy
 *  (or, against every measurement, after its boundary) makes the boundary itself the edge, flagged `headMissing`,
 *  and the leaf's span start still names head(N-1): ids never change. */
export function planSpans({ rows, boundaries }) {
  const order = [...rows].sort((a, b) => a.pos - b.pos);
  const at = new Map(order.map((r, i) => [r.uuid, i]));
  const summaries = new Set(boundaries.map((b) => b.summaryUuid).filter((u) => typeof u === 'string'));
  const structural = (r) => r.isBoundary || r.isSummary || summaries.has(r.uuid);
  const bs = boundaries.filter((b) => at.has(b.uuid)).sort((x, y) => at.get(x.uuid) - at.get(y.uuid));
  // A boundary's preserved-tail window [head, boundary), or null when its head is not before it in this copy.
  const windowOf = (b) => {
    const to = at.get(b.uuid);
    const from = typeof b.headUuid === 'string' ? at.get(b.headUuid) : undefined;
    return from === undefined || from > to ? null : { from, to };
  };
  const leaves = [];
  for (let k = 0; k < bs.length; k += 1) {
    const b = bs[k];
    const prev = k === 0 ? null : bs[k - 1];
    const prevWin = prev === null ? null : windowOf(prev);
    const own = windowOf(b);
    // Leaf N starts at head(N-1): the rows compaction N-1 kept verbatim are its own.
    const start = prev === null ? 0 : prevWin === null ? at.get(prev.uuid) : prevWin.from;
    const sources = [];
    for (let i = start; i < at.get(b.uuid); i += 1) {
      const r = order[i];
      if (structural(r)) continue;
      // Leaf N-1 claimed these (G12).
      if (prevWin !== null && i < prevWin.to && !prev.kept.has(r.uuid)) continue;
      // Compaction N keeps these verbatim: leaf N+1's.
      if (own !== null && i >= own.from && b.kept.has(r.uuid)) continue;
      sources.push(r.uuid);
    }
    leaves.push({
      boundaryUuid: b.uuid,
      spanStartUuid: prev === null ? order[0].uuid : (prev.headUuid ?? prev.uuid),
      sources,
      headMissing: prev !== null && prevWin === null,
    });
  }
  const last = bs.length === 0 ? null : bs[bs.length - 1];
  const lastWin = last === null ? null : windowOf(last);
  const tailFrom = last === null ? 0 : lastWin === null ? at.get(last.uuid) + 1 : lastWin.from;
  const liveTail = [];
  for (let i = tailFrom; i < order.length; i += 1) {
    const r = order[i];
    if (structural(r)) continue;
    if (lastWin !== null && i < lastWin.to && !last.kept.has(r.uuid)) continue;
    liveTail.push(r.uuid);
  }
  return { leaves, liveTail };
}

/** A leaf's id (§6.1 "Two forks after one head"). The plain id hashes (ccrc id, cc uuid, span start). When that
 *  id is already bound to ANOTHER boundary (two forked copies each compacted after the same head), the first bound
 *  keeps it, as "the first claim stands" does for uuids, and this boundary's leaf takes the boundary-qualified id
 *  (`leaf_id_forked`). */
export function decideLeafId({ ccrcId, ccUuid, spanStartUuid, boundaryUuid, plainBoundOther }) {
  if (plainBoundOther) return { id: leafId(ccrcId, ccUuid, spanStartUuid, boundaryUuid), forked: true };
  return { id: leafId(ccrcId, ccUuid, spanStartUuid), forked: false };
}

/** How long after a boundary's own time a file read to its end proves the boundary has no summary row coming.
 *  Claude Code appends the summary within moments of the boundary; a tick that read in between must not make
 *  the leaf raw for good. *Chosen*. D-4690 (history-raw-leaf-grace) */
export const RAW_LEAF_GRACE_MS = 5 * 60 * 1000;

/** Whether the file holding a boundary was read to its end late enough to say its summary row is missing. `eofMs`
 *  is the holding file's ingest_files.eof_ms: the start of the last tick that left its cursor at end-of-file.
 *  `boundaryTsMs` is the boundary's time; derive.mjs passes the newest stamped row before a boundary that has none
 *  of its own. With no time known at all the answer is false: end-of-file alone is exactly the race the grace
 *  closes, so such a boundary waits rather than going raw for good. */
export function eofAfterBoundary({ eofMs, boundaryTsMs }) {
  if (eofMs === null || boundaryTsMs === null) return false;
  return eofMs >= boundaryTsMs + RAW_LEAF_GRACE_MS;
}

/** A leaf is derived once it is final (§7.4 item 1, §6.3 "only leaves whose status is final"): its summary row is
 *  stored (native, or steered from W3), or its file shows it never will be (a raw leaf). Never earlier: a raw
 *  leaf is never written while it could still be a native one. */
export function leafReady({ summaryStored, fileAtEofAfterBoundary }) {
  return summaryStored === true || fileAtEofAfterBoundary === true;
}

/** The plugin's tested fan-in (§6.3, §11 P23; the 2 is a pressure arm ccrc has no consumer for): 8 leaves make a
 *  depth-1 parent, 4 nodes make each level above. */
export const FAN_IN = Object.freeze({ leaf: 8, condensed: 4 });

/** The groups of `width` slots that become parents now (§6.3). `slots` are ONE holding copy's nodes of one depth
 *  within one epoch, in boundaries.ord order (RB4): fan-in never crosses a /clear epoch and a parent never mixes
 *  forks. A slot is `nodeId: null` while its node does not exist yet (a boundary not ready), `final: false` while
 *  it may still change, `parented` once a parent holds it.
 *  Grouping starts at the first unparented slot and stops at the first group holding a null, non-final or
 *  parented slot: the nodes after a gap wait for it. */
export function planFanIn({ slots, width }) {
  if (!Number.isSafeInteger(width) || width < 2) throw new TypeError(`planFanIn: width must be an integer of at least 2, got ${String(width)}`);
  const groups = [];
  let i = slots.findIndex((s) => !s.parented);
  if (i < 0) return groups;
  while (i + width <= slots.length) {
    const g = slots.slice(i, i + width);
    if (g.some((s) => s.nodeId === null || !s.final || s.parented)) break;
    groups.push(g.map((s) => s.nodeId));
    i += width;
  }
  return groups;
}

/** A gist's first sentence (§6.3): up to and including the first `.`, `!` or `?` that ends the text or is
 *  followed by whitespace, else up to the first newline, else the whole gist; trimmed. So `v1.2` stays inside it. */
export function firstSentence(text) {
  const t = String(text ?? '').trim();
  const m = /[.!?](?=\s|$)|\n/.exec(t);
  if (m === null) return t;
  return t.slice(0, m[0] === '\n' ? m.index : m.index + 1).trim();
}

/** A parent from its children (§6.3), deterministic and rebuildable (a W3 steered <ccrc-node> gist replaces only
 *  the gist):
 *  - gist: each child's first sentence, joined with a space, cut at GIST_MAX by capText; null when no child has
 *    one (the leaves' own spelling of "no gist", never '');
 *  - topics: the union in first-seen order through capTopics (each once, at most TOPICS_MAX of at most TOPIC_CHARS);
 *  - refs: the union through capRefs (each (kind, value) once, the first origin kept, at most REFS_MAX);
 *  - time: the earliest child start to the latest child end;
 *  - srcChars: the children's; descCount: every descendant node; descChars: the descendants' gist chars.
 *  The three caps are Task 4's, the ones a leaf is cut by, so a parent and a leaf never disagree about a cut.
 *  A cut sets `capped`; no marker is ever inserted. D-4691 (history-node-char-counts) */
export function parentRollup(children) {
  const sentences = [];
  for (const c of children) {
    const s = typeof c.gist === 'string' ? firstSentence(c.gist) : '';
    if (s !== '') sentences.push(s);
  }
  const joined = sentences.join(' ');
  const gist = capText(joined, GIST_MAX);
  const topics = capTopics(children.flatMap((c) => c.topics));
  const cut = capRefs(children.flatMap((c) => c.refs));
  let earliestMs = null;
  let latestMs = null;
  let srcChars = 0;
  let descCount = 0;
  let descChars = 0;
  for (const c of children) {
    if (c.earliestMs !== null && (earliestMs === null || c.earliestMs < earliestMs)) earliestMs = c.earliestMs;
    if (c.latestMs !== null && (latestMs === null || c.latestMs > latestMs)) latestMs = c.latestMs;
    srcChars += c.srcChars;
    descCount += c.descCount + 1;
    descChars += c.descChars + (typeof c.gist === 'string' ? c.gist.length : 0);
  }
  return {
    gist: joined === '' ? null : gist.text, topics: topics.topics, refs: cut.refs, earliestMs, latestMs, srcChars, descCount, descChars,
    capped: gist.capped || topics.capped || cut.capped,
  };
}

// ===========================================================================
// Operator-verb decisions (spec §6.6, §6.9, §8.3 "Which no-store answer",
// §8.4; W1-B2 Task 6). Pure: the CLI's door and the sweep's --op dispatch
// both call them, so the two doors answer the same words (C64).
// D-4692 (history-adopt-verb) D-4693 (history-restore-verb) D-4694 (history-rebuild-verb)
// ===========================================================================

/** A restorable backup's bare name under db/backups/ (§8.4, §6.11): doctor --backup's `<ts>.db` or the
 *  writer's `pre-v<N>.db`. A `/`, a dot-prefixed temp, a `.tmp` or any other name never matches. */
const RESTORE_NAME_RE = /^(?:[0-9]{8}T[0-9]{6}Z|pre-v[1-9][0-9]*)\.db$/;

/** argv after `--op <verb>`, read against `spec` (flag -> 'bool' | 'value'): each flag at most once, a value
 *  flag followed by its value, anything not starting with `-` a positional. null on an unknown or repeated
 *  flag, or a value flag with nothing after it. */
function readOpFlags(args, spec) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!Object.hasOwn(spec, a)) {
      if (typeof a !== 'string' || a.startsWith('-')) return null;
      positional.push(a);
      continue;
    }
    if (Object.hasOwn(flags, a)) return null;
    if (spec[a] === 'bool') { flags[a] = true; continue; }
    if (i + 1 >= args.length) return null;
    i += 1;
    flags[a] = args[i];
  }
  return { flags, positional };
}

/** One operator verb's argv (§8.4), as both doors read it. `import` keeps B1's grammar (`--apply`, and
 *  `--session <id> --file <path>` both or neither, the session an idOk id and the file a `<uuid>.jsonl`).
 *  `prune` needs `--older-than <dur>` at or above PRUNE_FLOOR_DAYS. `reparse` takes `--node <full id>` (Task 1's
 *  HISTORY_NODE_ID_RE, the one spelling of a full node id) or `--session <id>`, never both
 *  D-4697 (history-reparse-targets). `restore` takes one bare backup name, refused
 *  `restore-refused` when it is not one (C57). `rebuild` takes `--store-id <uuid>`. A verb B2 does not run
 *  (recall-off is W2's) is `bad-args`. */
export function parseOpVerbArgs(op, args) {
  const refuse = (reason) => ({ ok: false, reason });
  const ok = (a) => ({ ok: true, args: Object.freeze(a) });
  switch (op) {
    case 'import': {
      const r = readOpFlags(args, { '--apply': 'bool', '--session': 'value', '--file': 'value' });
      if (r === null || r.positional.length > 0) return refuse('bad-args');
      const session = r.flags['--session'] ?? null;
      const file = r.flags['--file'] ?? null;
      if ((session === null) !== (file === null)) return refuse('bad-args');
      if (session !== null) {
        if (!idOk(session)) return refuse('bad-id');
        const base = file.slice(file.lastIndexOf('/') + 1);
        if (!base.endsWith('.jsonl') || !UUID_RE.test(base.slice(0, -'.jsonl'.length))) return refuse('bad-args');
      }
      return ok({ op, apply: r.flags['--apply'] === true, session, file });
    }
    case 'migrate':
    case 'repair':
    case 'backup':
    case 'adopt':
      return args.length === 0 ? ok({ op }) : refuse('bad-args');
    case 'prune': {
      const r = readOpFlags(args, { '--apply': 'bool', '--older-than': 'value' });
      if (r === null || r.positional.length > 0 || r.flags['--older-than'] === undefined) return refuse('bad-args');
      const days = parseDuration(r.flags['--older-than']);
      if (days === null) return refuse('bad-args');
      if (days < PRUNE_FLOOR_DAYS) return refuse('older-than-floor');
      return ok({ op, days, apply: r.flags['--apply'] === true });
    }
    case 'reparse': {
      const r = readOpFlags(args, { '--apply': 'bool', '--node': 'value', '--session': 'value' });
      if (r === null || r.positional.length > 0) return refuse('bad-args');
      const node = r.flags['--node'] ?? null;
      const session = r.flags['--session'] ?? null;
      if (node !== null && session !== null) return refuse('bad-args');
      if (node !== null && !HISTORY_NODE_ID_RE.test(node)) return refuse('bad-args');
      if (session !== null && !idOk(session)) return refuse('bad-id');
      return ok({ op, node, session, apply: r.flags['--apply'] === true });
    }
    case 'restore': {
      const r = readOpFlags(args, {});
      if (r === null || r.positional.length !== 1) return refuse('bad-args');
      const name = r.positional[0];
      if (!restoreNameOk(name)) return refuse('restore-refused');
      return ok({ op, name });
    }
    case 'rebuild': {
      const r = readOpFlags(args, { '--store-id': 'value' });
      if (r === null || r.positional.length > 0) return refuse('bad-args');
      const storeId = r.flags['--store-id'] ?? null;
      if (storeId !== null && !UUID_RE.test(storeId)) return refuse('bad-args');
      return ok({ op, storeId });
    }
    default:
      return refuse('bad-args');
  }
}

/** The no-store table's answers a writing verb keeps as they are: what could not be measured or reached. */
const DOOR_UNMEASURED = Object.freeze(['store-unreachable', 'store-root-dangling', 'store-unmeasured']);

/** Which no-store answer a WRITING verb gets before the CLI spawns the shim (§8.3's table, its writing-verb
 *  row), over exactly decideCliStore's input, so "is there a store here" is decided by that one table, from
 *  store.id and the DB, never from whether ~/.ccrc/history exists:
 *  - macOS or a recorded server role is 9, whatever is on disk;
 *  - a shim present goes on to decideOpGate and the shim's own pass, which decides the store rows itself;
 *  - otherwise the table answers. Its 9 (no store.id and no DB: never installed) stays 9. Its unreachable,
 *    dangling and unmeasured words (5) stand: an input that could not be measured is never read as absent (IV5).
 *    Any other answer means a store exists, and a writing verb with no shim is 2 `writer-absent`, never 9 (a
 *    plain uninstall kept the data). D-4183 */
export function decideOpDoor(f) {
  if (f.darwin || f.role === 'server') return { ok: false, exit: EXIT.NO_STORE };
  if (f.shim === 'present') return { ok: true };
  const t = decideCliStore(f);
  if (t.exit === EXIT.NO_STORE) return { ok: false, exit: EXIT.NO_STORE };
  if (t.exit === EXIT.DB && DOOR_UNMEASURED.includes(t.reason)) return { ok: false, exit: EXIT.DB, reason: t.reason };
  return { ok: false, exit: EXIT.REFUSED, reason: 'writer-absent' };
}

// derived from lossless-claw src/prune.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const PRUNE_DURATION_RE = /^(\d+)\s*(d|day|days|w|week|weeks|m|month|months|y|year|years)$/i;
const PRUNE_UNIT_DAYS = Object.freeze({
  d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7, m: 30, month: 30, months: 30, y: 365, year: 365, years: 365,
});

/** A human duration (`90d`, `3m`, `1y`) as days, or null when it is not one (§11 P15, upstream's grammar: a month
 *  is 30 days, a year 365). */
export function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  const match = PRUNE_DURATION_RE.exec(trimmed);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = PRUNE_UNIT_DAYS[unit];
  if (multiplier == null || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount * multiplier;
}

/** `prune --older-than` under this many days is refused `older-than-floor` (§6.6, *chosen*). */
export const PRUNE_FLOOR_DAYS = 30;

/** doctor --backup's file name for the UTC second `nowMs` (§8.4): `YYYYMMDDTHHMMSSZ.db`, the form `--op backup`
 *  publishes under db/backups/ and `doctor --restore` takes. D-4695 (history-backup-preflight-and-rename) */
export function backupNameOf(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError(`backupNameOf: a time in ms, got ${String(nowMs)}`);
  const iso = new Date(nowMs).toISOString();
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z.db`;
}

/** Whether `name` is a bare backup name `doctor --restore` may open under db/backups/ (§8.4). */
export function restoreNameOk(name) {
  return typeof name === 'string' && RESTORE_NAME_RE.test(name);
}

const BIND_REFUSALS = Object.freeze({ adopt: 'adopt-refused', restore: 'restore-refused', rebuild: 'rebuild-refused' });

/** The binding verbs' preconditions (§8.4, §6.9; the "which also decides the binding verbs' preconditions" arm
 *  of the store-open decision, §6.4). `f` is the store's measured facts (B1's StoreFacts) plus what the verb
 *  names: the code's schema version, history.db's own user_version (`storedVersion`), a --store-id, the journal
 *  directories with whether every head in each names that directory's store, and, for restore, the backup. Before
 *  anything kind-specific, an input that could not be measured answers 5 `store-unmeasured` (C67): store.id, its
 *  pending marker, store.writer, db/, history.db. A db/ link to nothing answers 5 `store-root-dangling`. Then:
 *  - adopt: history.db present with a readable meta.store_id, and store.id absent (equal is nothing to adopt,
 *    different is two stores claiming this box), and not this box's own interrupted binding (a pending marker
 *    naming the same store, which the next tick finishes). Last, its user_version: one that is not a measured value
 *    is 5 `store-unmeasured`, one below 1 or no integer (storeVersionDamaged) is refused as damage (H-223, D-4599), and
 *    one above the code's is refused before anything is written, as openStore refuses
 *    it before its writer's open (G9; DM17 "no write"). That refusal is decided here, never in the L4 arm (RB17);
 *  - restore: no history.db, no leftover -wal or -shm (SQLite would replay it into the restored file), a regular
 *    backup with a readable uuid store_id, store.id absent or naming that store, the backup's user_version not
 *    newer than the code's, not below 1 (storeVersionDamaged; H-223) and its integrity_check not failed. Before the copy, version and integrity may be
 *    null (not measured yet), and they pass;
 *  - rebuild: no history.db and no leftover -wal or -shm. Its store_id is store.id's; else the one journal
 *    directory whose heads agree; else --store-id, which must name one of several. store.id's own directory, when
 *    journal/ holds one, is read on that path too (H-218, D-4605): foreign or disagree refuse, unreadable is exit 5.
 *    A directory with no month file (`empty`, H-227) is nothing to replay and reads as `agree` on those two paths
 *    (the crash window between appendJournal's mkdir and its first month file leaves one); alone and unnamed, it names no store.
 *    A --store-id disagreeing with
 *    store.id, naming no directory, or naming one whose heads name another store is refused, with the
 *    candidates named. The two refusals a --store-id cures (several directories unnamed, a --store-id naming no
 *    directory) also carry `remedy: 'store-id'`, so the arm offers the flag only where it helps
 *    (D-4606 (history-rebuild-store-id-hint-where-it-cures)). A directory whose `heads` is `foreign` holds an entry
 *    at a month-file name that is no regular file, a measured and permanent condition: it is refused (exit 2) naming
 *    that, and carries no remedy, where `unreadable` is exit 5 and cured by a retry or a chmod (H-178, D-4605).
 *  D-4188 D-4185 D-4186 */
export function decideBind(kind, f) {
  if (!Object.hasOwn(BIND_REFUSALS, kind)) throw new TypeError(`decideBind: kind outside BIND_KINDS: ${String(kind)}`);
  const unmeasured = (detail) => ({ ok: false, rc: EXIT.DB, reason: 'store-unmeasured', detail });
  const refuse = (detail) => ({ ok: false, rc: EXIT.REFUSED, reason: BIND_REFUSALS[kind], detail });
  const foreignEntry = (id) => `journal/${id}/ holds an entry at a month-file name that is no regular file (a link, socket, FIFO or directory); the operator puts the regular month file back, or removes the entry, from a terminal outside any session, and runs the rebuild again`;
  if (f.dbDir === 'dangling') return { ok: false, rc: EXIT.DB, reason: 'store-root-dangling', detail: 'db/ is a link to nothing: recreate its target or remove the link' };
  if (f.dbDir === 'unmeasured' || f.db === 'unmeasured') return unmeasured('db/ or history.db could not be measured');
  if (presenceUnreadable(f.storeId)) return unmeasured('store.id exists and cannot be read');
  if (presenceUnreadable(f.pending)) return unmeasured('store.id.pending exists and cannot be read');
  if (presenceUnreadable(f.writer)) return unmeasured('store.writer exists and cannot be read');
  const marker = presenceValue(f.storeId);
  if (kind === 'adopt') {
    if (f.db !== 'present') return refuse(f.db === 'zero-byte' ? 'history.db is 0 bytes: there is no store to adopt' : 'there is no history.db to adopt');
    const inDb = presenceValue(f.dbStoreId);
    if (f.dbStoreId.state === 'unreadable') return unmeasured("history.db's meta.store_id cannot be read");
    if (inDb === null) return refuse('history.db has no readable meta.store_id');
    if (marker !== null) return refuse(marker === inDb ? 'store.id already names this store: nothing to adopt' : `store.id names ${marker} and history.db is ${inDb}: two stores claim this box`);
    if (presenceValue(f.pending) === inDb) return refuse("store.id.pending names this store: it is this box's own interrupted binding, which the next tick finishes");
    const stored = presenceValue(f.storedVersion);
    if (stored === null) return unmeasured("history.db's user_version cannot be read");
    // H-223 (D-4599): a stored version below 1 is damage, refused here as the reader and the writer refuse it (storeVersionDamaged).
    if (storeVersionDamaged(stored)) return refuse(`history.db's user_version ${stored} is below 1 or no integer: it is damaged and is not adopted; ccrc history doctor --restore and --rebuild both refuse while history.db stands, so the operator moves history.db, history.db-wal and history.db-shm aside together, from a terminal outside any session, and then runs ccrc history doctor --restore <backup> or ccrc history doctor --rebuild`);
    if (stored > f.codeVersion) return refuse(`history.db is schema ${stored}; this build knows ${f.codeVersion}: adopt it with the build that wrote it`);
    return { ok: true, storeId: inDb };
  }
  if (kind === 'restore') {
    if (f.db === 'present' || f.db === 'zero-byte') return refuse("history.db is present: a live store is never overwritten; move the old store's three files aside together first");
    if (f.wal || f.shm) return refuse("a history.db-wal or -shm is left with no history.db: SQLite would replay it into the restored file; move the old store's three files aside together");
    const bk = f.backup;
    if (bk === null || !bk.regular) return refuse('the backup is not a regular file under db/backups/');
    const bkId = presenceValue(bk.storeId);
    if (bkId === null || !UUID_RE.test(bkId)) return refuse(bk.storeId.state === 'unreadable' ? "the backup's meta.store_id cannot be read" : 'the backup has no meta.store_id');
    if (marker !== null && marker !== bkId) return refuse(`store.id names ${marker}; the backup is ${bkId}`);
    // H-223 (D-4599): the bind-time half of the one rule for a version below 1 (storeVersionDamaged): a backup at user_version 0 would
    // be linked as history.db and then refused by openStore (exit 5), and restore and rebuild would both refuse the present file.
    if (bk.userVersion !== null && storeVersionDamaged(bk.userVersion)) return refuse(`the backup's user_version ${bk.userVersion} is below 1 or no integer: it is damaged; restore another backup`);
    if (bk.userVersion !== null && bk.userVersion > f.codeVersion) return refuse(`the backup is schema ${bk.userVersion}; this build knows ${f.codeVersion}`);
    if (bk.integrityOk === false) return refuse("the backup's integrity_check is not ok");
    return { ok: true, storeId: bkId };
  }
  if (f.db === 'present' || f.db === 'zero-byte') return refuse('history.db is present: rebuild recreates a lost database only');
  if (f.wal || f.shm) return refuse("a history.db-wal or -shm is left with no history.db: move the old store's three files aside together");
  if (f.journalStoreDirs.includes('(unlistable)')) return unmeasured('journal/ could not be listed');
  const dirs = f.journalDirs;
  const names = dirs.length === 0 ? 'none' : dirs.map((d) => d.storeId).join(', ');
  const arg = f.storeIdArg;
  if (arg !== null) {
    if (marker !== null && marker !== arg) return refuse(`store.id names ${marker}; --store-id names ${arg}`);
    const d = dirs.find((x) => x.storeId === arg);
    if (d === undefined) return { ...refuse(`--store-id ${arg} names no journal directory (journal directories: ${names})`), remedy: 'store-id' };
    // D-4605 (history-rebuild-unreadable-journal-is-unmeasured): a directory the sweep could not read is unmeasured (exit 5), never a refusal.
    if (d.heads === 'unreadable') return unmeasured(`journal/${arg}/ could not be read`);
    if (d.heads === 'foreign') return refuse(foreignEntry(arg));
    // H-227 (D-4605 refined): `empty` (no month file) is nothing to replay, as `agree` is; only a head that names another store refuses.
    if (d.heads !== 'agree' && d.heads !== 'empty') return refuse(`journal/${arg}/ holds head records naming another store`);
    return { ok: true, storeId: arg };
  }
  if (marker !== null) {
    // H-218 (D-4605): store.id names the store, but its own journal directory is still read, so a month file replaced by a link,
    // FIFO or directory (foreign) or heads naming another store (disagree) refuse here as on the --store-id path, instead of
    // being listed, counted and never read by a recovery whose redact records then go unapplied. No directory is today's ok.
    const own = dirs.find((x) => x.storeId === marker);
    if (own === undefined || own.heads === 'agree' || own.heads === 'empty') return { ok: true, storeId: marker };
    if (own.heads === 'unreadable') return unmeasured(`journal/${marker}/ could not be read`);
    if (own.heads === 'foreign') return refuse(foreignEntry(marker));
    return refuse(`journal/${marker}/ holds head records naming another store`);
  }
  if (dirs.length === 0) return refuse('nothing names a store_id: no store.id and no journal directory');
  if (dirs.length > 1) return { ...refuse(`several journal directories: name one with --store-id (journal directories: ${names})`), remedy: 'store-id' };
  if (dirs[0].heads === 'unreadable') return unmeasured(`journal/${dirs[0].storeId}/ could not be read`);
  if (dirs[0].heads === 'foreign') return refuse(foreignEntry(dirs[0].storeId));
  // H-227: a lone directory with no month file names a store nothing ever journaled into, and no store.id or --store-id names it: nothing to rebuild from.
  if (dirs[0].heads === 'empty') return refuse(`journal/${dirs[0].storeId}/ holds no month file: there is nothing to rebuild from`);
  if (dirs[0].heads !== 'agree') return refuse(`journal/${dirs[0].storeId}/ holds head records naming another store`);
  return { ok: true, storeId: dirs[0].storeId };
}

/** reparse's preflight (§8.4, §11 L8): more than REPARSE_MAX_TARGETS leaves is `reparse-too-many`, and any target
 *  with a tombstoned source or summary is `span-pruned` (§6.6). Either refuses the whole run, so nothing is
 *  rewritten. */
export function decideReparse({ targets, prunedSpans }) {
  if (targets > REPARSE_MAX_TARGETS) return { ok: false, reason: 'reparse-too-many' };
  if (prunedSpans > 0) return { ok: false, reason: 'span-pruned' };
  return { ok: true };
}

// ===========================================================================
// Recovery and repair decisions (spec §9.14 "Recovery", "Journal replay",
// "Only drained files replay", "Unknown records"; §9.6 recovery-stalled;
// §8.4 doctor --repair; §11 P21, P24; W1-B2 Task 7). Pure: the sweep's
// recovery step (Task 25) streams the journal and applies every action
// replayStep answers, deciding nothing of its own (the tick bounds included);
// planReplay is the same order over a whole journal in memory, which O56 pins;
// Task 25's tests pin the executor's agreement with it over the cases they
// name.
// D-4699 (history-recovery-replay) D-4230
// D-4241 D-4190
// D-4701 (history-replay-skips-post-bind-ticks)
// ===========================================================================

/** The recovery step's phases, in order (§9.14). `index` applies the redact records and indexes drain-time
 *  verdicts and drained files; `apply` replays the journal; `reindex` re-runs the FTS derivation when the index
 *  pass learned a pair the store lacked. `export-blobs`, `export-stubs` and `export-rows` (W1-B4) replay the export's
 *  segments between `apply` and `reindex` (§9.14 "Export replay"): this list is that seam. `export-blobs` applies every
 *  segment's blobs that carry bytes and `export-stubs` every segment's stubs (D-5397), both insert-or-ignore, so a stub an
 *  earlier segment carries can never swallow bytes a later one carries. D-4700 (history-b4-after-b2) */
export const RECOVER_PHASES = Object.freeze(['index', 'apply', 'export-blobs', 'export-stubs', 'export-rows', 'reindex']);

/** The phases that read the journal, and so carry a journal file and position in their cursor: the first two of
 *  RECOVER_PHASES. The sweep's executor fails these while a journal file cannot be read (D-4592), and the cursor grammar
 *  below is built from this list, so the word is spelled once. */
export const RECOVER_JOURNAL_PHASES = Object.freeze(['index', 'apply']);

const RECOVER_JOURNAL_CURSOR_RE = new RegExp(
  `^(${RECOVER_JOURNAL_PHASES.join('|')})(?::([0-9]{4}-(?:0[1-9]|1[0-2])\\.[0-9a-f]{8}\\.jsonl):(0|[1-9][0-9]{0,15})(?:\\/([1-9][0-9]{0,15}))?)?(\\+pairs)?$`);
const RECOVER_REINDEX_CURSOR_RE = /^reindex(?::(0|[1-9][0-9]{0,15}))?(\+pairs)?$/;
// W1-B4: an export phase names a segment (lib parseSegmentName's grammar, checked apart so it is spelled once) and a
// position in it: a blobs rowid in export-blobs and export-stubs, a row ord in export-rows (§9.14 "Recovery": "then an
// export phase and segment"; D-5397 for export-stubs).
const RECOVER_EXPORT_CURSOR_RE = /^(export-blobs|export-stubs|export-rows)(?::([^:+]+):(0|[1-9][0-9]{0,15}))?(\+pairs)?$/;

/** The recovery step's cursor as derivation_state ('recover', <bind ms>) keeps it and status prints it (§9.14):
 *  `<phase>` at a phase's start, `index:<YYYY-MM>.<writer>.jsonl:<position>/<n>` or `apply:…` inside the journal,
 *  `export-blobs:<seq>.<writer>.db:<blobs rowid>`, `export-stubs:<seq>.<writer>.db:<blobs rowid>` or
 *  `export-rows:<seq>.<writer>.db:<row ord>` inside the export's segments (W1-B4: `file` is the segment's name, `offset`
 *  the last blobs rowid applied in export-blobs and export-stubs and the last row `ord` applied in export-rows, and there
 *  is no `/<n>`), `reindex:<blob_id>` inside the FTS re-derivation, then
 *  `+pairs` once the index pass learned a pair the store lacked. It is advanced in the same transaction as the records
 *  it applies.
 *  D-4607 (history-recover-cursor-records-group-shape): the position is a byte offset into a group of one file and an
 *  ordinal into a merge group's merged list, so the cursor records the group's file count `n` beside it. The executor
 *  resumes only a group whose size still equals `n`; a cursor with no `/<n>` (written before the size was kept, or
 *  `groupSize` null or absent) restarts its group from its start. A `groupSize` that is none of null, absent or a positive safe
 *  integer throws a TypeError (H-182): parseRecoverCursor answers null to such a text, so it would stall the step for good.
 *  So does a `groupSize` set beside a phase outside RECOVER_JOURNAL_PHASES (W1-B4): only the journal phases' grammar has a
 *  `/<n>`, and an export or reindex cursor written with one would be a text parseRecoverCursor refuses, the same stall. */
export function formatRecoverCursor(c) {
  if (!RECOVER_PHASES.includes(c.phase)) throw new TypeError(`formatRecoverCursor: phase outside RECOVER_PHASES: ${String(c.phase)}`);
  let s = c.phase;
  // H-182 (D-4607): only a group size parseRecoverCursor reads back is written: a positive safe integer, and only beside
  // a journal phase's position, the one grammar with a `/<n>` part. A size set beside an export or reindex phase would
  // print a cursor the parser refuses, which the step then waits on for good.
  const g = c.groupSize;
  if (g !== undefined && g !== null && !(Number.isSafeInteger(g) && g >= 1)) {
    throw new TypeError(`formatRecoverCursor: groupSize is not a positive safe integer: ${String(g)}`);
  }
  if (g !== undefined && g !== null && !RECOVER_JOURNAL_PHASES.includes(c.phase)) {
    throw new TypeError(`formatRecoverCursor: groupSize is set beside phase ${c.phase}, which has no group: ${String(g)}`);
  }
  if (c.phase === 'reindex') {
    if (c.blobId !== null) s += `:${c.blobId}`;
  } else if (c.file !== null) {
    s += `:${c.file}:${c.offset}`;
    if (c.groupSize !== undefined && c.groupSize !== null) s += `/${c.groupSize}`;
  }
  return c.pairsAdded ? `${s}+pairs` : s;
}

/** The cursor back, or null when it is not one: never a guess at where to resume. A NULL column (a step just
 *  registered by a binding verb) is the step's start. */
export function parseRecoverCursor(s) {
  if (s === null) return { phase: RECOVER_PHASES[0], file: null, offset: 0, blobId: null, groupSize: null, pairsAdded: false };
  if (typeof s !== 'string') return null;
  const j = RECOVER_JOURNAL_CURSOR_RE.exec(s);
  if (j !== null) {
    const offset = j[3] === undefined ? 0 : Number(j[3]);
    if (!Number.isSafeInteger(offset)) return null;
    const groupSize = j[4] === undefined ? null : Number(j[4]);
    if (groupSize !== null && !Number.isSafeInteger(groupSize)) return null;
    return { phase: j[1], file: j[2] ?? null, offset, blobId: null, groupSize, pairsAdded: j[5] !== undefined };
  }
  const r = RECOVER_REINDEX_CURSOR_RE.exec(s);
  if (r !== null) {
    const blobId = r[1] === undefined ? null : Number(r[1]);
    if (blobId !== null && !Number.isSafeInteger(blobId)) return null;
    return { phase: 'reindex', file: null, offset: 0, blobId, groupSize: null, pairsAdded: r[2] !== undefined };
  }
  const x = RECOVER_EXPORT_CURSOR_RE.exec(s);
  if (x !== null) {
    if (x[2] !== undefined && parseSegmentName(x[2]) === null) return null;
    const offset = x[3] === undefined ? 0 : Number(x[3]);
    if (!Number.isSafeInteger(offset)) return null;
    return { phase: x[1], file: x[2] ?? null, offset, blobId: null, groupSize: null, pairsAdded: x[4] !== undefined };
  }
  return null;
}

const journalCmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const journalCmpHead = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);
const journalFileOrder = (a, b) => journalCmpText(a.month, b.month) || journalCmpHead(a.headT, b.headT) || journalCmpText(a.name, b.name);

/** The journal files' apply order (§9.14 "Journal replay"): by the month in the name, then by the head
 *  record's time, then by name (code-unit order, never the locale's: DM8). Files of one month whose
 *  [headT, lastT] ranges overlap (a store run on two boxes at once, against §6.9's rule) form ONE group, which
 *  the caller merges by record time. A file with no readable head sorts last in its month, alone. */
export function orderJournalFiles(files) {
  const groups = [];
  let cur = null;
  for (const f of [...files].sort(journalFileOrder)) {
    const hi = f.lastT ?? f.headT;
    if (cur !== null && cur.month === f.month && f.headT !== null && cur.hi !== null && f.headT <= cur.hi) {
      cur.names.push(f.name);
      if (hi !== null && hi > cur.hi) cur.hi = hi;
      continue;
    }
    cur = { month: f.month, hi, names: [f.name] };
    groups.push(cur);
  }
  return groups.map((g) => g.names);
}

/** The first pass over one record (§9.14): a `redact` pair, a drain-time verdict (one keyed to its spool line's
 *  event_key) to apply at that line, or a `drained` record naming a file whose spool records may replay. */
export function indexRecord(r) {
  if (r.kind !== 'record') return {};
  const rec = r.rec;
  if (rec.k === 'redact') return { redact: { len: rec.len, sha256: rec.sha256, t: rec.t } };
  if (rec.k !== 'verdict') return {};
  if (rec.kind === 'drained') return { drainedFile: rec.file };
  if (rec.kind === 'bind' || rec.event_key === 'none') return {};
  return { verdictKey: rec.event_key };
}

/** The second pass over one record (§9.14). It never reads $REG and never re-decides: a spool record of a
 *  drained file becomes a receipt carrying the verdicts the drain took from it, in journal order, which the
 *  executor applies through decideEpochLine and the drain's own receipt functions; a verdict keyed to a line
 *  waits for that line; a verdict keyed `none` (a later confirmation, a backfill mapping, an operator's import)
 *  applies at its own position. A spool record whose file has no `drained` record is skipped: the file is still
 *  in .draining/ with its sidecar, and the live drain decides it after the step, or B1 set it aside after journaling
 *  it, into .draining/rejected/ or .draining/planted/<area>/, where nothing drains it; either way the lost store held
 *  none of its lines (the executor, Task 25's undrainedFileKept, tells a kept file from a gone one). A tick at or before the newest
 *  tick the store held when the step began (`ticksAfter`) is already there; one at or after the step's bind ms
 *  (`ticksBefore`, when it is a number) is a recovery pass's own record, journaled after the bind
 *  D-4701 (history-replay-skips-post-bind-ticks). A line that does not parse, or a `v` newer than
 *  this build, counts journal_line_malformed; an unknown kind journal_record_unknown; a head naming another
 *  store journal_head_mismatch. Nothing here throws on a record. */
export function replayStep(state, r) {
  if (r.kind === 'malformed' || r.kind === 'newer') return { state, actions: [{ do: 'skip', counter: 'journal_line_malformed' }] };
  if (r.kind === 'unknown') return { state, actions: [{ do: 'skip', counter: 'journal_record_unknown' }] };
  const rec = r.rec;
  switch (rec.k) {
    case 'head':
      if (rec.store_id !== state.storeId) return { state: { ...state, file: null }, actions: [{ do: 'skip', counter: 'journal_head_mismatch' }] };
      return { state: { ...state, file: null }, actions: [] };
    case 'file':
      return { state: { ...state, file: rec.name, recvMs: rec.t }, actions: [{ do: 'file', name: rec.name, t: rec.t }] };
    case 'spool': {
      if (state.file === null) return { state, actions: [{ do: 'skip', counter: 'journal_line_malformed' }] };
      if (!state.drained.has(state.file)) return { state, actions: [{ do: 'skip-undrained', file: state.file }] };
      const key = eventKey(state.file, rec.ord);
      return { state, actions: [{ do: 'receipt', key, ord: rec.ord, rec: rec.rec, recvMs: state.recvMs, verdicts: [...(state.verdictsByKey.get(key) ?? [])] }] };
    }
    case 'verdict':
      if (rec.kind === 'bind' || rec.kind === 'drained') return { state, actions: [] };
      if (rec.event_key !== 'none') return { state, actions: [] };
      return { state, actions: [{ do: 'verdict', rec }] };
    case 'redact':
      return { state, actions: [] };
    case 'tick': {
      const before = typeof state.ticksBefore !== 'number' || rec.t < state.ticksBefore;
      return { state, actions: rec.t > state.ticksAfter && before ? [{ do: 'tick', t: rec.t, lagMs: rec.lag_ms }] : [] };
    }
    default:
      return { state, actions: [{ do: 'skip', counter: 'journal_record_unknown' }] };
  }
}

/** One merge group's items by their time `t`, each file's own order kept, a tie to the earlier file in the group.
 *  `files` is one array of items per file, each item carrying a numeric `t`; the answer is the items themselves, merged.
 *  A journal block (a `file` record and its `spool` records) shares one `t`, so a block is never split. The ONE merge
 *  both planReplay (items `{ read, t }`) and sweep.mjs's recovery executor (items `{ raw, t }`, W1-B2 Task 25) use, so
 *  the order O56 pins is the order the executor applies (R-T25-1). */
export function mergeJournalByTime(files) {
  const pos = files.map(() => 0);
  const out = [];
  for (;;) {
    let pick = -1;
    for (let f = 0; f < files.length; f += 1) {
      if (pos[f] >= files[f].length) continue;
      if (pick < 0 || files[f][pos[f]].t < files[pick][pos[pick]].t) pick = f;
    }
    if (pick < 0) return out;
    out.push(files[pick][pos[pick]]);
    pos[pick] += 1;
  }
}

/** The whole replay of one store's journal, in memory (§9.14; the O56 pin). A file whose head names another
 *  store is dropped, counted once. The rest run in orderJournalFiles' order, each group merged by record time. A
 *  first pass indexes every redact pair (applied before anything else: "Redaction first"), every drain-time
 *  verdict by event_key (an identical re-appended verdict once) and every drained file; the second runs
 *  replayStep over the same stream. Duplicate receipts are left to the executor's receipt upsert. `ticksBefore`
 *  (the step's bind ms) defaults to null, no upper tick bound. */
export function planReplay({ storeId, files, ticksAfter, ticksBefore = null }) {
  const skips = [];
  const kept = [];
  for (const f of files) {
    const recs = [];
    let headT = null;
    let lastT = null;
    let foreign = false;
    for (const line of f.lines) {
      if (line === '') continue;
      const read = parseJournalRecord(line);
      if (recs.length === 0 && read.kind === 'record' && read.rec.k === 'head') {
        if (read.rec.store_id !== storeId) { foreign = true; break; }
        headT = read.rec.t;
      }
      const t = read.kind === 'record' ? read.rec.t : (lastT ?? headT ?? 0);
      if (read.kind === 'record') lastT = lastT === null ? t : Math.max(lastT, t);
      recs.push({ read, t });
    }
    if (foreign) {
      skips.push({ do: 'skip', counter: 'journal_head_mismatch' });
      continue;
    }
    kept.push({ name: f.name, month: f.month, writer: f.writer, headT, lastT, recs });
  }
  const byName = new Map(kept.map((f) => [f.name, f]));
  const stream = orderJournalFiles(kept).flatMap((g) => mergeJournalByTime(g.map((n) => byName.get(n).recs)).map((x) => x.read));
  const redacts = [];
  const seenPairs = new Set();
  const seenVerdicts = new Set();
  const verdictsByKey = new Map();
  const drained = new Set();
  for (const read of stream) {
    const ix = indexRecord(read);
    if (ix.redact !== undefined) {
      const pair = `${ix.redact.len}:${ix.redact.sha256}`;
      if (!seenPairs.has(pair)) {
        seenPairs.add(pair);
        redacts.push({ do: 'redact', ...ix.redact });
      }
    }
    if (ix.drainedFile !== undefined) drained.add(ix.drainedFile);
    if (ix.verdictKey !== undefined) {
      const same = canonicalJson(read.rec);
      if (!seenVerdicts.has(same)) {
        seenVerdicts.add(same);
        const list = verdictsByKey.get(ix.verdictKey) ?? [];
        list.push(read.rec);
        verdictsByKey.set(ix.verdictKey, list);
      }
    }
  }
  let state = { storeId, file: null, recvMs: 0, drained, verdictsByKey, ticksAfter, ticksBefore };
  const applied = [];
  for (const read of stream) {
    const step = replayStep(state, read);
    state = step.state;
    applied.push(...step.actions);
  }
  return [...skips, ...redacts, ...applied];
}

/** The recovery step's unmoved-tick count, kept in meta HEALTH_META.recoverUnmovedTicks (§9.6: FAIL
 *  recovery-stalled at RECOVERY_STALL_TICKS). A moved cursor resets it; a tick the floor or history-off held
 *  leaves it; any other tick adds one. */
export function nextUnmovedTicks({ prev, moved, held }) {
  if (moved) return 0;
  return held ? prev : prev + 1;
}

// derived from lossless-claw src/plugin/lcm-doctor-rollover-splits.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
const foreignKeyKey = (row) => [row.table ?? '', row.rowid ?? '', row.parent ?? '', row.fkid ?? ''].join('\0');

/** doctor --repair's foreign-key proof (§8.4, P21): the violations `PRAGMA foreign_key_check` reports at the
 *  repair's completion, against the baseline taken ONCE before its first chunk and persisted with its resumable
 *  cursor, so a resumed repair diffs against the original baseline (RB7; Task 23 runs the check twice per repair,
 *  never per chunk). A violation is keyed by (table, rowid, parent, fkid); one
 *  outside the baseline is NEW, and a repair that made one is refused. No v1 table is WITHOUT ROWID, so rowid is
 *  never NULL for a v1 row. */
export function diffForeignKeys(baseline, current) {
  const base = new Set(baseline.map(foreignKeyKey));
  const newViolations = [];
  let preExisting = 0;
  for (const row of current) {
    if (base.has(foreignKeyKey(row))) preExisting += 1;
    else newViolations.push(row);
  }
  return { newViolations, preExisting };
}

// derived from lossless-claw src/db/migration.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
/** Each FTS table's shadow tables, listed per table (P24): the contentless blobs_fts (content='',
 *  contentless_delete=1) has no `_content` shadow, so a list naming one for every table would read a healthy
 *  index as broken and rebuild it on every repair. */
export const FTS_SHADOWS = Object.freeze({
  blobs_fts: Object.freeze(['blobs_fts_config', 'blobs_fts_data', 'blobs_fts_docsize', 'blobs_fts_idx']),
  nodes_fts: Object.freeze(['nodes_fts_config', 'nodes_fts_content', 'nodes_fts_data', 'nodes_fts_docsize', 'nodes_fts_idx']),
});
/** Each FTS table's columns, as B1's FTS_DDL creates them. */
export const FTS_COLUMNS = Object.freeze({
  blobs_fts: Object.freeze(['body']),
  nodes_fts: Object.freeze(['gist', 'topics', 'refs']),
});

/** Whether each FTS table is whole (§8.4 doctor --repair's self-heal, P24): the table, every shadow it should
 *  have, and every column. The store adapter measures `tables` (sqlite_master) and `columns` (pragma_table_info);
 *  the repair rebuilds a table this answers false for. */
export function ftsTablesHealthy({ tables, columns }) {
  const healthy = (t) => tables.has(t) && FTS_SHADOWS[t].every((s) => tables.has(s))
    && FTS_COLUMNS[t].every((c) => (columns[t] ?? []).includes(c));
  return { blobs: healthy('blobs_fts'), nodes: healthy('nodes_fts') };
}

// ===========================================================================
// The substring belt (spec §8.3 layer 4 and layer 1's glue windows, §6.2 "The belt"; rev 3.5; W1-B2 Task 7A;
// coordinator rulings 4019 and 4043, reviews 344 F9 and 351). Layer 1 matches a registered unit only as a whole
// `[A-Za-z0-9_-]` run, so a unit glued to a neighbour (`ab_<v>`, `ab<v>`) or a run an escape sequence took a character
// of (`ESC[` + `P…`) kept most of a secret as one FTS term and printed it (B1's D-4344
// (history-reindex-mark-by-rederivation) and D-4307 (history-redaction-csi-joined-belt) name both limits). Two repairs,
// both inside redactField so every caller has them:
// layer 1's glue windows (by hash, so a rotated value and a sessions.json hash are covered), and layer 4, which masks
// every stretch sharing beltWidth(unit) or more consecutive characters, folded, with a unit this process loaded.
// ===========================================================================

/** The belt's derivation version (meta fts_belt's `v`). A store whose recorded version differs, a B1 store's absent
 *  state included, re-derives its whole index once (decideBelt, rederivePlan); a generation open across a bump is
 *  restarted, and a completion stamps the version its walk ran under (`gv`, ruling R-version). Bump it with any change
 *  to layer 4, to the glue windows, to beltWidth, to beltFold or to the seed rule. */
export const BELT_VERSION = 1;
/** The bits a matched stretch must carry in its unit's folded alphabet: SECRET_SEGMENT_MIN base64url characters'
 *  72 bits, the bound §8.3 already sets on a segment. */
export const BELT_BITS = 72;
/** The widths the belt scans at, ascending; the floor is SECRET_SEGMENT_MIN, the shortest unit. */
export const BELT_K_LADDER = Object.freeze([12, 14, 16, 18, 21]);
/** The most grams one belt holds (about 15 MiB); a unit past it stays in layer 1 only and is counted. */
export const BELT_GRAMS_MAX = 65536;
/** meta key: the belt state, formatBeltState's JSON (rowids only, never a value). */
export const BELT_META = 'fts_belt';
/** The derivation step that re-redacts every node's stored fields when a re-derivation generation opens. */
export const BELT_NODES_STEP = 'nodes-belt';
/** meta key: the declared secretsFile paths the last tick read (JSON array, paths only). */
export const REDACT_SOURCES_META = 'redact_sources';
/** The belt's counter words (sweep.mjs writes them). */
export const BELT_COUNTERS = Object.freeze({ overflow: 'redact_belt_overflow', generations: 'redact_belt_generations' });
/** The glue windows one run may hash before it is replaced whole (fail closed): this plus a quarter of its length. */
const GLUE_HASH_FLOOR = 64;
/** The window characters one run may hash before it is replaced whole (fail closed): this plus 4 × its length, each
 *  window charged its length before it is hashed (spec §8.3, review R69; *chosen*). A count bound alone costs
 *  (64 + n/4) × the longest registered pair. */
const GLUE_HASH_BYTES_FLOOR = 64 * 1024;

/** A character's belt code: 1-38 for `[a-z0-9_-]` (an upper-case letter folds to its lower case), 0 for any other
 *  ASCII character, a boundary no gram crosses. */
const BELT_CODE = (() => {
  const t = new Uint8Array(128);
  let c = 1;
  for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789_-') { t[ch.charCodeAt(0)] = c; c += 1; }
  for (let u = 0x41; u <= 0x5a; u += 1) t[u] = t[u + 0x20];
  return t;
})();
const FOLD_MEMO = new Map();
const FOLD_MEMO_MAX = 4096;
const isAsciiAlnum = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);

/** A non-ASCII code point's belt code, exactly as FTS5 unicode61 (remove_diacritics 1) folds it inside a token
 *  (coordinator ruling R-fold): one of the marks it drops is dropped (-1); a character whose canonical decomposition is
 *  an ASCII letter or digit alone, or that and one dropped mark, folds to that character's code; U+017F and U+1E9B
 *  (long s, and long s with a dot above) fold to `s`, as unicode61's case fold takes them; anything else is a
 *  boundary (0), a letter with two marks included, which unicode61 keeps as itself. Memoised per code point
 *  (bounded), so CJK-dense text costs one lookup a character. */
export function beltFold(cp) {
  const hit = FOLD_MEMO.get(cp);
  if (hit !== undefined) return hit;
  let c = 0;
  if (isDroppedMark(cp)) c = -1;
  else if (cp === 0x17f || cp === 0x1e9b) c = BELT_CODE[0x73];
  else {
    const d = String.fromCodePoint(cp).normalize('NFD');
    const b = d.charCodeAt(0);
    if (isAsciiAlnum(b) && (d.length === 1 || (d.length === 2 && isDroppedMark(d.charCodeAt(1))))) c = BELT_CODE[b];
  }
  if (FOLD_MEMO.size < FOLD_MEMO_MAX) FOLD_MEMO.set(cp, c);
  return c;
}

/** The width a unit is masked at: the stretch its folded alphabet needs to carry BELT_BITS, never more than the unit,
 *  rounded DOWN to BELT_K_LADDER (rounding down only masks more). */
export function beltWidth(unit) {
  const u = unit.toLowerCase();
  let size;
  if (/^[0-9]+$/.test(u)) size = 10;
  else if (/^[0-9a-f]+$/.test(u)) size = 16;
  else size = (/[0-9]/.test(u) ? 10 : 0) + (/[a-z]/.test(u) ? 26 : 0) + (u.includes('_') ? 1 : 0) + (u.includes('-') ? 1 : 0);
  const need = size < 2 ? u.length : Math.min(u.length, Math.ceil(BELT_BITS / Math.log2(size)));
  let w = BELT_K_LADDER[0];
  for (const s of BELT_K_LADDER) if (s <= need) w = s;
  return w;
}

/** Whether the gram of `unit` at `off`, `w` long, may seed a mask: at least a third of its folded characters are
 *  distinct (a padding run seeds nothing), and it holds a digit or both an upper- and a lower-case letter. So a
 *  snake_case, kebab-case or CONSTANT_CASE word, or the wordy part of a token (`claude-sonnet-`), seeds nothing. The
 *  price depends on the unit's alphabet (measured, 2000 random 40-character values each, and 5.4M base64url grams):
 *  a token's gram fails this about once in 10^4 when it is mixed-case, about once in 5 × 10^4 when it is base64url
 *  (measured 2.07e-5), but a one-case `[a-z0-9]` token's about once in 100 and
 *  a base32 `[A-Z2-7]` one's about once in 18. A print that holds any seeding gram is still masked to its run; a
 *  partial print of a one-case unit's digit-free window alone is left (spec §8.3 "What it cannot see"). A value of
 *  one-case letters only is left to layer 1 (its pair and its glue windows). */
function beltSeeds(unit, off, w) {
  let digit = false;
  let lower = false;
  let upper = false;
  const seen = new Set();
  for (let k = off; k < off + w; k += 1) {
    const c = unit.charCodeAt(k);
    if (c >= 0x30 && c <= 0x39) digit = true;
    else if (c >= 0x61 && c <= 0x7a) lower = true;
    else if (c >= 0x41 && c <= 0x5a) upper = true;
    seen.add(BELT_CODE[c]);
  }
  if (seen.size * 3 < w) return false;
  return digit || (lower && upper);
}

const BELT_BASE = 0x01000193;
function beltPow(e) {
  let r = 1;
  for (let i = 0; i < e; i += 1) r = Math.imul(r, BELT_BASE);
  return r;
}
function beltSame(a, ai, b, bi, w) {
  for (let k = 0; k < w; k += 1) if (a[ai + k] !== b[bi + k]) return false;
  return true;
}

/** The units the belt masks for `values`: secretUnits' rule, so layer 4, layer 1 and the late-pair search agree. */
export function beltUnits(values) {
  return [...new Set([...values].flatMap((v) => secretUnits(v)))];
}

/** The belt over `units` (secretUnits' runs of `[A-Za-z0-9_-]`, SECRET_SEGMENT_MIN or more). Each width holds a table
 *  from a seeding gram's 32-bit rolling hash (high 30 bits) to the grams with it; every candidate is compared code by
 *  code, so a collision never changes an answer. Units are taken in sorted order until BELT_GRAMS_MAX; the rest are
 *  counted in `overflow`. Held in this process's memory only; `texts` is what the --regex child is handed. */
export function makeBelt(units) {
  const codesOf = [];
  const texts = [];
  const byWidth = new Map();
  let grams = 0;
  let overflow = 0;
  for (const unit of [...new Set(units)].sort()) {
    const w = beltWidth(unit);
    const n = unit.length - w + 1;
    if (n < 1 || !/^[A-Za-z0-9_-]+$/.test(unit)) continue;
    const codes = new Uint8Array(unit.length);
    for (let i = 0; i < unit.length; i += 1) codes[i] = BELT_CODE[unit.charCodeAt(i)];
    const existing = byWidth.get(w);
    const pw = existing === undefined ? beltPow(w - 1) : existing.pw;
    const staged = [];
    let h = 0;
    for (let i = 0; i < unit.length; i += 1) {
      if (i >= w) h = (h - Math.imul(codes[i - w], pw)) | 0;
      h = (Math.imul(h, BELT_BASE) + codes[i]) | 0;
      if (i < w - 1) continue;
      const off = i - w + 1;
      if (!beltSeeds(unit, off, w)) continue;
      const key = h >>> 2;
      const prior = existing?.table.get(key);
      if (prior !== undefined && prior.some((g) => beltSame(codesOf[g.unit], g.off, codes, off, w))) continue;
      if (staged.some((g) => g.key === key && beltSame(codes, g.off, codes, off, w))) continue;
      staged.push({ key, off });
    }
    if (grams + staged.length > BELT_GRAMS_MAX) { overflow += 1; continue; }
    const at = codesOf.length;
    codesOf.push(codes);
    texts.push(unit);
    let t = existing;
    if (t === undefined) {
      t = { w, pw, table: new Map() };
      byWidth.set(w, t);
    }
    for (const { key, off } of staged) {
      const list = t.table.get(key);
      if (list === undefined) t.table.set(key, [{ unit: at, off }]);
      else list.push({ unit: at, off });
    }
    grams += staged.length;
  }
  return { units: codesOf, texts, widths: [...byWidth.values()].sort((a, b) => a.w - b.w), grams, overflow };
}

/** A reading of a text: a string and, per UTF-16 unit of it, the range of the text it came from (null: itself). */
const readFrom = (r, i) => (r.from === null ? i : r.from[i]);
const readTo = (r, i) => (r.to === null ? i + 1 : r.to[i]);

/** `r` with every match of `re` (global) replaced by `fn(match)`, each replacement character mapped to the match. */
function mapReading(r, re, fn) {
  const parts = [];
  const from = [];
  const to = [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(r.s); m !== null; m = re.exec(r.s)) {
    for (let i = last; i < m.index; i += 1) { from.push(readFrom(r, i)); to.push(readTo(r, i)); }
    parts.push(r.s.slice(last, m.index));
    const rep = fn(m);
    const a = readFrom(r, m.index);
    const b = readTo(r, m.index + m[0].length - 1);
    for (let i = 0; i < rep.length; i += 1) { from.push(a); to.push(b); }
    parts.push(rep);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last === 0 && parts.length === 0) return r;
  for (let i = last; i < r.s.length; i += 1) { from.push(readFrom(r, i)); to.push(readTo(r, i)); }
  parts.push(r.s.slice(last));
  return { s: parts.join(''), from: Int32Array.from(from), to: Int32Array.from(to) };
}

/** The bytes of one escape sequence that introduce it: a 7-bit ESC, its fill and the `[`, `P`, `N` or `O` after it
 *  when a byte follows that, or the one 8-bit introducer. The rest (parameters, intermediates, the final byte) is what
 *  a stray introducer may have taken from a value. */
function introducerLen(seq) {
  if (seq.charCodeAt(0) !== 0x1b) return 1;
  let k = 1;
  while (k < seq.length && SEQ_FILL_RE.test(seq[k])) k += 1;
  return k < seq.length - 1 && '[PNO'.includes(seq[k]) ? k + 1 : k;
}

/** Scan one reading: every window equal to a seeding gram of its width adds its source range to `cover` (a difference
 *  array over the masked text) and calls `onHit` (the re-derivation's probe). Linear per width. */
function scanReading(r, belt, cover, onHit) {
  const s = r.s;
  const codes = new Uint8Array(s.length);
  const from = new Int32Array(s.length);
  const to = new Int32Array(s.length);
  let n = 0;
  for (let i = 0; i < s.length;) {
    const u = s.charCodeAt(i);
    let len = 1;
    let c;
    if (u < 0x80) c = BELT_CODE[u];
    else {
      const cp = s.codePointAt(i);
      if (cp > 0xffff) len = 2;
      c = beltFold(cp);
    }
    if (c >= 0) {
      codes[n] = c;
      if (r.from === null) { from[n] = i; to[n] = i + len; } else { from[n] = r.from[i]; to[n] = r.to[i + len - 1]; }
      n += 1;
    }
    i += len;
  }
  for (const t of belt.widths) {
    const w = t.w;
    let h = 0;
    let run = 0;
    for (let i = 0; i < n; i += 1) {
      const c = codes[i];
      if (c === 0) { run = 0; h = 0; continue; }
      if (run >= w) h = (h - Math.imul(codes[i - w], t.pw)) | 0;
      else run += 1;
      h = (Math.imul(h, BELT_BASE) + c) | 0;
      if (run < w) continue;
      const list = t.table.get(h >>> 2);
      if (list === undefined) continue;
      if (!list.some((x) => beltSame(belt.units[x.unit], x.off, codes, i - w + 1, w))) continue;
      cover[from[i - w + 1]] += 1;
      cover[to[i]] -= 1;
      if (onHit !== null) onHit();
    }
  }
}

/** Layer 4 (spec §8.3): `text` with every stretch sharing a seeding gram with a unit of `belt` replaced by
 *  REDACTED_MARK. Readings: the text, and when it holds an escape introducer, the text with every ANSI sequence removed
 *  and the text with every sequence's introducer removed (what a stray `ESC[` took stays in place); with `decode`, the
 *  same three of each JSON-escape decode, up to INDEX_UNESCAPE_PASSES, stopping at the first that changes nothing. Each
 *  reading is folded (ASCII case, unicode61's diacritics, beltFold) and maps every character back to the range of
 *  `text` it came from. The masked ranges are their union, each widened to the `[A-Za-z0-9_-]` run around it but never
 *  over a JSON escape's letter or hex digit, then each replaced by one mark; a span that starts inside an escape takes
 *  the whole escape, so no mark follows a bare backslash. A mark holds no unit's width of run characters, so the result
 *  is a fixed point. Cost: at most 3 * (1 + INDEX_UNESCAPE_PASSES) readings, each scanned once per width
 *  (BELT_K_LADDER.length at most) with an exact comparison of at most the width per hash hit, and one widening pass
 *  that reads each character at most once (a cover inside an already widened span joins it, ruling R-linear): O(text),
 *  pinned by the case `the widening is linear`. `onHit` (or null) is called once per matched window. */
export function beltMask(text, belt, decode, onHit = null) {
  if (belt === null || belt === undefined || belt.widths.length === 0 || text.length < BELT_K_LADDER[0]) return text;
  const cover = new Int32Array(text.length + 1);
  let r = { s: text, from: null, to: null };
  for (let level = 0; ; level += 1) {
    scanReading(r, belt, cover, onHit);
    if (ESCAPE_INTRODUCER_RE.test(r.s)) {
      scanReading(mapReading(r, ANSI_ESCAPE_RE, () => ''), belt, cover, onHit);
      scanReading(mapReading(r, ANSI_ESCAPE_RE, (m) => m[0].slice(introducerLen(m[0]))), belt, cover, onHit);
    }
    if (!decode || level >= INDEX_UNESCAPE_PASSES || !r.s.includes('\\')) break;
    const d = mapReading(r, JSON_ESCAPE_RE, (m) => (m[1] !== undefined ? JSON_ESCAPE_CHAR[m[1]] : String.fromCharCode(parseInt(m[2], 16))));
    if (d === r || d.s === r.s) break;
    r = d;
  }
  // The masked spans: each union of covered ranges, widened to the `[A-Za-z0-9_-]` run around it. The widening is
  // linear (ruling R-linear): a cover that starts at or before the end the last span was widened to joins that span,
  // so no character is widened over twice. (A cover inside an already widened run used to push a span of its own and
  // rescan the rest of the run, quadratic in it.) A left widening never takes a JSON escape's letter or hex digit, and
  // a span that starts inside an escape takes the whole escape, so no mark follows a bare backslash and a `--json`
  // string stays valid, as REDACTED_MARK promises (finding R31).
  const n = text.length;
  const spans = [];
  let depth = 0;
  for (let i = 0; i < n; i += 1) {
    const was = depth;
    depth += cover[i];
    if (depth > 0) {
      const last = spans.length === 0 ? null : spans[spans.length - 1];
      if (was === 0 && (last === null || i > last[1])) {
        const floor = last === null ? 0 : last[1];
        let s = i;
        while (s > floor && isRunByte(text.charCodeAt(s - 1)) && jsonEscapeAt(text, s - 1) < 0) s -= 1;
        if (last !== null && s === floor) last[1] = i + 1;
        else spans.push([s, i + 1]);
      } else if (i + 1 > last[1]) last[1] = i + 1;
    } else if (was > 0) widenRun(text, spans[spans.length - 1]);
  }
  if (spans.length === 0) return text;
  widenRun(text, spans[spans.length - 1]);
  let out = '';
  let last = 0;
  for (const [s0, e] of spans) {
    if (e <= last) continue;
    const at = jsonEscapeAt(text, s0);
    const s = at < 0 ? s0 : at;
    out += text.slice(last, Math.max(s, last)) + REDACTED_MARK;
    last = e;
  }
  return out + text.slice(last);
}

/** A span's right widening over the `[A-Za-z0-9_-]` run after it. A backslash ends it, so it never enters an escape. */
function widenRun(text, sp) {
  while (sp[1] < text.length && isRunByte(text.charCodeAt(sp[1]))) sp[1] += 1;
}

const isHexByte = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);

/** The index of the backslash of the JSON escape whose letter or hex digit `text[k]` is (`\n`, `A`), or -1. A
 *  backslash opens an escape only after an even number of backslashes (`\\n` is an escaped backslash, then a letter).
 *  Cost: at most five characters back, and the backslash run there. */
function jsonEscapeAt(text, k) {
  for (let b = k - 1; b >= 0 && b >= k - 5; b -= 1) {
    if (text.charCodeAt(b) !== 0x5c) continue;
    let r = b;
    while (r > 0 && text.charCodeAt(r - 1) === 0x5c) r -= 1;
    if ((b - r) % 2 === 1) return -1;
    if (k === b + 1) return JSON_ESCAPE_CHAR[text[k]] !== undefined || text[k] === 'u' ? b : -1;
    if (text[b + 1] !== 'u') return -1;
    for (let h = b + 2; h <= k; h += 1) if (!isHexByte(text.charCodeAt(h))) return -1;
    return b;
  }
  return -1;
}

/** The probe callback of a re-derivation index (makeProbeIndex with beltAll): every layer-4 and glue-window hit is an
 *  owed hit, because both depend on the loaded values and on BELT_VERSION's code, which the owed-pair argument does
 *  not cover. Null for every other index. */
function beltHit(idx) {
  return idx.beltAll === true && idx.probe !== undefined ? () => { idx.probe.hits += 1; } : null;
}

/** One index reading's redaction (redactForIndex's readings, the sidecar's raw pass): the three layers, then the belt
 *  over the literal and escape readings only. An FTS term is a run of the literal text, and redactForIndex decodes
 *  the deeper levels itself, each through this. */
function redactIndexReading(text, idx) {
  return beltMask(redactLayered(text, idx), idx.belt, false, beltHit(idx));
}

const isGlueSep = (c) => c === 0x5f || c === 0x2d;
const GLUE_SEP_RE = /[_-]/;

/** `text` with each maximal union of the [start, end) pairs in `iv` (non-empty) replaced by the mark. */
function maskIntervals(text, iv) {
  const pairs = [];
  for (let k = 0; k < iv.length; k += 2) pairs.push([iv[k], iv[k + 1]]);
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let out = '';
  let at = 0;
  let a = pairs[0][0];
  let b = pairs[0][1];
  for (let k = 1; k < pairs.length; k += 1) {
    if (pairs[k][0] <= b) { b = Math.max(b, pairs[k][1]); continue; }
    out += text.slice(at, a) + REDACTED_MARK;
    at = b;
    a = pairs[k][0];
    b = pairs[k][1];
  }
  return out + text.slice(at, a) + REDACTED_MARK + text.slice(b);
}

/** Layer 1's glue windows (§8.3, rev 3.5): in a `[A-Za-z0-9_-]` run that is not itself a pair, every window that starts
 *  at the run's start or at or right after a `_` or `-`, ends at the run's end or at or right before one, holds a
 *  letter or digit, and has a length some pair has, is tested by (length, sha256) as a run is. A value glued by `_` or
 *  `-` (which unicode61 splits off as its own terms) is matched by its pair alone, a rotated value and a sessions.json
 *  hash included. One run takes at most GLUE_HASH_FLOOR plus a quarter of its length in hashes, and hashes at most
 *  GLUE_HASH_BYTES_FLOOR plus 4 × its length in window characters, each window charged before it is hashed; past
 *  either budget it is replaced whole, fail closed. One run's glue cost is then linear in its length plus a constant,
 *  whatever the registered lengths. */
function glueRedact(run, idx) {
  const n = run.length;
  if (n <= SECRET_SEGMENT_MIN || idx.byLen.size === 0 || !GLUE_SEP_RE.test(run)) return run;
  const starts = [];
  const isEnd = new Uint8Array(n + 1);
  const alnum = new Int32Array(n + 1);
  isEnd[n] = 1;
  for (let k = 0; k < n; k += 1) {
    const sep = isGlueSep(run.charCodeAt(k));
    alnum[k + 1] = alnum[k] + (sep ? 0 : 1);
    if (k === 0 || sep || isGlueSep(run.charCodeAt(k - 1))) starts.push(k);
    if (sep) { isEnd[k] = 1; isEnd[k + 1] = 1; }
  }
  const hit = beltHit(idx);
  let budget = GLUE_HASH_FLOOR + (n >>> 2);
  let bytes = GLUE_HASH_BYTES_FLOOR + 4 * n;
  const iv = [];
  for (const [len, shas] of idx.byLen) {
    if (len >= n) continue;
    for (const i of starts) {
      const j = i + len;
      if (j > n) break;
      if (isEnd[j] === 0 || alnum[j] === alnum[i]) continue;
      budget -= 1;
      bytes -= len;
      if (budget < 0 || bytes < 0) {
        if (hit !== null) hit();
        return REDACTED_MARK;
      }
      if (shas.has(sha256Hex(run.slice(i, j)))) {
        iv.push(i, j);
        if (hit !== null) hit();
      }
    }
  }
  return iv.length === 0 ? run : maskIntervals(run, iv);
}

/** fts_belt's witness is a short JSON array (sweep's beltWitness); a longer string is no state. */
const BELT_WITNESS_MAX = 512;

/** meta fts_belt's grammar: `{"v":<int>,"rids":[<rid>…],"gen":null|[<rid>…]}`, then `"gv":<int>` exactly when `gen` is
 *  a list (the BELT_VERSION the open generation opened under, ruling R-version), then optionally `"w":"<witness>"`
 *  (sweep's beltWitness when a belt-aware pass last wrote the state, ruling R-rollback). Every rid is a positive
 *  integer. Anything else (undefined included) is null, which decideBelt reads as due. */
export function parseBeltState(text) {
  let o;
  try { o = JSON.parse(text ?? ''); } catch { return null; }
  const rids = (a) => Array.isArray(a) && a.every((x) => Number.isSafeInteger(x) && x > 0);
  if (o === null || typeof o !== 'object' || !Number.isSafeInteger(o.v) || !rids(o.rids)) return null;
  if (o.gen === null ? o.gv !== undefined : !(rids(o.gen) && Number.isSafeInteger(o.gv))) return null;
  if (o.w !== undefined && !(typeof o.w === 'string' && o.w.length <= BELT_WITNESS_MAX)) return null;
  return { v: o.v, rids: [...o.rids], gen: o.gen === null ? null : [...o.gen], ...(o.gen === null ? {} : { gv: o.gv }), ...(o.w === undefined ? {} : { w: o.w }) };
}
/** The text parseBeltState reads back: `gv` only beside a list `gen`, `w` only when set, so the due record
 *  `{ v: 0, rids: [], gen: null }` (Tasks 21 and 23 write it) is `{"v":0,"rids":[],"gen":null}` exactly. */
export function formatBeltState(s) {
  return JSON.stringify({ v: s.v, rids: s.rids, gen: s.gen, ...(s.gen === null ? {} : { gv: s.gv }), ...(s.w === undefined ? {} : { w: s.w }) });
}

/** The belt's decision for one tick (§6.2 "The belt"). `live`: the redact_hashes rowids of the units this tick's belt
 *  holds. `rids`: the units every indexed row is known to carry the belt of, at version `v`. `gen`: the units live at
 *  every tick of the open generation, which opened under version `gv`.
 *  - A unit no longer live leaves `rids` and `gen`: a row indexed while its value is not loaded lacks its belt.
 *  - Due: the version differs (a B1 store's absent state, and the `v: 0` due record, included), or a live unit at or
 *    below the mark is not in `rids` (its file readable again). A unit above the mark is the pair generation's.
 *  - Restart (ruling R-version): when due, an open generation whose `gen` is absent (one a build without the belt
 *    opened, or one a due record cleared) or was recorded under another BELT_VERSION covers nothing this version can
 *    stamp, so rederivePlan begins its walk again from cursor 0 rather than finishing one that ran partly under other
 *    code.
 *  `next` is the state to write, without `w` (the sweep adds it). Pure. */
export function decideBelt(state, live, mark) {
  if (state === null) return { due: true, restart: true, next: { v: 0, rids: [], gen: null } };
  const L = new Set(live);
  const keep = (a) => a.filter((r) => L.has(r));
  const genOk = state.gen !== null && state.gv === BELT_VERSION;
  const next = { v: state.v, rids: state.v === BELT_VERSION ? keep(state.rids) : [], gen: genOk ? keep(state.gen) : null, ...(genOk ? { gv: BELT_VERSION } : {}) };
  const covered = new Set(next.rids);
  const due = state.v !== BELT_VERSION || live.some((r) => r <= mark && !covered.has(r));
  return { due, restart: due && !genOk, next };
}
/** The state a completed generation leaves: the units live at every one of its ticks (`gen`), at the version its walk
 *  ran under (`gv`, which decideBelt keeps only when it is BELT_VERSION). A generation with no `gen` (one a B1 pass
 *  opened, or one whose record a due record cleared) covers nothing new, so the belt stays due. */
export function beltAfterGeneration(next) {
  return next.gen === null ? { v: next.v, rids: next.rids, gen: null } : { v: next.gv, rids: [...next.gen].sort((a, b) => a - b), gen: null };
}
/** Whether a build that writes index rows without the belt (B1, after a rollback) wrote since a belt-aware pass last
 *  recorded the store's witness (ruling R-rollback): `witness` (sweep's beltWitness, measured now) differs from the
 *  state's `w`. A state with no `w` (none recorded yet, or the due record Tasks 21 and 23 write) claims nothing: it is
 *  due already, or about to be stamped. Pure. */
export function beltWitnessMoved(state, witness) {
  return state !== null && state.w !== undefined && state.w !== witness;
}

/** The shared source-list bound: the sweep persists only an admitted list, and the CLI accepts only one. */
export const REDACT_SOURCES_MAX = 256;

/** Normalize source paths in stable first-seen order, then admit the bounded absolute-path list; anything else names none. */
export function normalizeRedactSources(paths) {
  if (!Array.isArray(paths)) return null;
  const seen = new Set();
  const normalized = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith('/') || p.length >= 4096 || p.includes('\0')) return null;
    if (!seen.has(p)) { seen.add(p); normalized.push(p); }
  }
  return normalized.length <= REDACT_SOURCES_MAX ? normalized : null;
}

/** meta redact_sources: a normalized, bounded absolute source list; malformed data names none. */
export function parseRedactSources(text) {
  let parsed;
  try { parsed = JSON.parse(text ?? '[]'); } catch { return []; }
  return normalizeRedactSources(parsed) ?? [];
}

// ===========================================================================
// The index's escape readings for display and nodes_fts (spec §8.3 "Where it runs", §6.2 `nodes_fts`, rev 3.5;
// W1-B2 Task 7A; B1's D-4343 and D-4419,
// and B1's run 302 notes to B2). The belt's decoded readings find only a unit this process loaded; a value held as a
// pair alone (a rotated value, a sessions.json hash) glued to a literal escape is separated only by redactForIndex's
// readings. So a read verb shows a field as the index holds it, and nodes_fts indexes what blobs_fts would.
// ===========================================================================

/** The longest field redactForDisplay reads through every escape reading, in UTF-16 units: the window an entry's index
 *  text is redacted over (B1's D-4419). */
export const DISPLAY_READINGS_MAX = ENTRY_FTS_BYTES + ENTRY_REDACT_MARGIN;

/** A recalled field as a read verb shows it, so no output shows a value the index masked (§8.3's field pass, with the
 *  escape readings B1 gave the index).
 *  - Up to DISPLAY_READINGS_MAX it IS redactForIndex: the field as it came, redacted, unless a deeper JSON-escape
 *    reading removed something; then that reading is shown, decoded. A field whose escapes hide nothing is shown
 *    exactly as redactField shows it.
 *  - Past it (expand reads a sidecar up to SIDECAR_WHOLE_MAX), the field is redacted once, and each maximal span of
 *    `[A-Za-z0-9_.-]` characters and backslashes that holds a backslash and a run character (the spans B1's
 *    exhaustion rule marks) is read through redactForIndex alone and replaced by the mark when any of its readings
 *    removed something. The cost stays linear, and a long JSON text's ordinary escapes print as they are. Residual,
 *    past the bound only: a value only the context layer sees after a decode, with no backslash touching it.
 *  It calls nothing but redactField and redactForIndex (whose readings are redactIndexReading's, the belt included),
 *  so it fails closed as they do (R2). */
export function redactForDisplay(text, idx) {
  if (text.length <= DISPLAY_READINGS_MAX) return redactForIndex(text, idx);
  const t = redactField(text, idx);
  if (!t.includes('\\')) return t;
  return t.replace(/[A-Za-z0-9_.\\-]+/g, (span) => (span.includes('\\') && /[A-Za-z0-9_-]/.test(span) && redactForIndex(span, idx) !== span ? REDACTED_MARK : span));
}

/** A node's `topics` column as a list (HA2 H-14). The writer stores a JSON array of strings; a column that is not
 *  one reads as one topic per line. The ONE reader: derive.mjs (which writes the column) and recall.mjs (which shows
 *  it) both import it, so a change to how the column is written is a change to one reader. */
export function topicsOfColumn(text) {
  if (text === null || text === undefined || text === '') return [];
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  } catch {
    // not JSON: one topic per line, below
  }
  return String(text).split('\n').map((t) => t.trim()).filter((t) => t !== '');
}

/** A nodes_fts row's three column texts (§6.2): the gist, each topic and each ref value through entryIndexText (B1's
 *  escape readings and window, the belt included), topics and refs then joined one per line, as Tasks 8 and 9 index
 *  them. Every nodes_fts writer calls it (Task 8's indexNode, Task 9's insertNodeFts, Task 29's redactNodeFields), so
 *  a row is a function of its node's stored fields and the pair index's answers alone, which Task 29's node step
 *  recomputes and compares. */
export function nodeIndexTexts(fields, idx) {
  const one = (s) => entryIndexText(String(s), idx);
  return {
    gist: fields.gist === null || fields.gist === undefined ? '' : one(fields.gist),
    topics: (fields.topics ?? []).map(one).join('\n'),
    refs: (fields.refs ?? []).map(one).join('\n'),
  };
}


// ===========================================================================
// Leaf helpers derive.mjs composes (spec §6.1 "The copy", §7.4 items 2-8;
// W1-B2 Task 8). Pure.
// ===========================================================================

/** A summary row's `summarizeMetadata.direction` (§7.4 item 8): `from` or `up_to`, else null. derive.mjs reads
 *  the row from the line it came from, because the store keeps a summary row's message only.
 *  D-4704 (history-summary-direction-from-source-line) */
export function directionOfSummaryRow(row) {
  const meta = row !== null && typeof row === 'object' && !Array.isArray(row) ? row.summarizeMetadata : undefined;
  const d = meta !== null && typeof meta === 'object' ? meta.direction : undefined;
  return d === 'from' || d === 'up_to' ? d : null;
}

/** A selected block's stored fields (§7.4 items 3, 6, 7). The block was parsed from REDACTED text, so every cut
 *  below lands on redacted text (§8.3, SE1):
 *  - the gist, trimmed, cut at GIST_MAX by Task 4's capText, then trimmed at its end again: the form Task 4's
 *    gistSha hashes, so a later block carrying this gist word for word is a carried copy even past the cap; empty
 *    is null;
 *  - topics: the `Expand for details about:` field split on commas, through capTopics (each once, at most
 *    TOPICS_MAX of at most TOPIC_CHARS);
 *  - refs: the `refs:` values classifyRef recognises, origin `model` (capRefs runs over the leaf's union).
 *  Both cuts are surrogate-safe. A cut sets `capped`; no marker is ever inserted. */
export function blockFields(block) {
  const gist = capText(typeof block.gist === 'string' ? block.gist.trim() : '', GIST_MAX);
  const topics = capTopics((typeof block.expand === 'string' ? block.expand : '').split(','));
  const refs = [];
  for (const v of Array.isArray(block.refs) ? block.refs : []) {
    const kind = typeof v === 'string' ? classifyRef(v) : null;
    if (kind !== null) refs.push({ kind, value: v, origin: 'model' });
  }
  const text = gist.text.trimEnd();
  return { gist: text === '' ? null : text, topics: topics.topics, refs, capped: gist.capped || topics.capped };
}

/** The steer receipt a leaf's span carries (§7.4 item 2): the receipt naming this leaf's id, else a generic one
 *  (leafId '') received after the previous boundary and no later than this one; null when neither. An epoch's
 *  first leaf has no lower bound. D-4685 (history-steer-receipt) */
export function pickReceipt(receipts, { id, afterMs, uptoMs }) {
  const exact = receipts.find((r) => r.leafId === id);
  if (exact !== undefined) return exact;
  return receipts.find((r) => r.leafId === '' && (afterMs === null || r.tsMs > afterMs) && (uptoMs === null || r.tsMs <= uptoMs)) ?? null;
}

/** The copy that holds a boundary (§6.1 "The copy"): among a transcript's files that have the boundary row as a
 *  member, a live one (source_key '') before a retired or exported one, then the smallest file_id; null when no file
 *  holds it. derive.mjs measures `live` and `holds`; Task 9's fan-in splits its slots by this same answer.
 *  D-4688 (history-span-per-boundary-copy) */
export function pickHoldingCopy(files) {
  let best = null;
  for (const f of files) {
    if (!f.holds) continue;
    if (best === null || (f.live && !best.live) || (f.live === best.live && f.fileId < best.fileId)) best = f;
  }
  return best === null ? null : best.fileId;
}

/** A main transcript's fork counts (§6.1), from what derive.mjs measured over its LIVE copies: each copy's row
 *  count, the rows in any of them, the rows in a copy that holds one of its leaves' boundaries, and how many copies
 *  hold one. `unspanned` is how many rows no holding copy has: they join no leaf (none while no copy holds a leaf,
 *  when every row is still live tail). `forked` is true when two or more live copies exist and none holds every row
 *  (no uuid-superset). */
export function forkCounts({ liveSizes, unionSize, coveredSize, holdingCopies }) {
  return {
    unspanned: holdingCopies === 0 ? 0 : Math.max(0, unionSize - coveredSize),
    forked: liveSizes.length > 1 && !liveSizes.some((n) => n === unionSize),
  };
}

// ── recall: the read verbs' arguments, selects by store version, recall-off's B2 refusals (W1-B2 Task 10) ──
//
// THE ARGUMENT WHITELIST is one table per read verb: §8.2 builds the whitelist from that one list. These are
// exit 2 bad-args before anything is measured:
//   - an option the table does not name;
//   - a repeated option;
//   - an option missing its value;
//   - a value off its grammar.
// `--` ends the options, so a word that starts with `--` is still searchable (`grep -- --force`; slug
// history-read-args-terminator, NEW). Ids are not checked here: the id grammar is decideScope's (idOk), which
// runs before any path is formed from one.
export function paneOk(pane) { return typeof pane === 'string' && PANE_RE.test(pane); }

export const TREE_DEPTH_DEFAULT = 2;
export const TREE_DEPTH_MAX = 8;
/** expand --around's window on each side (chosen: §8.4 names the option, not its bound). */
export const AROUND_DEFAULT = 5;
export const AROUND_MAX = 50;

const readOpt = (kind, key, extra = {}) => Object.freeze({ kind, key, ...extra });
/** Options every read verb takes (§8.2). `--project` and `--workspace` both given is decideScope's bad-args. */
const COMMON_READ_OPTIONS = Object.freeze({
  '--json': readOpt('flag', 'json'),
  '--session': readOpt('value', 'session'),
  '--project': readOpt('flag', 'project'),
  '--workspace': readOpt('flag', 'workspace'),
});
/** The most families a `--json` scope object names (§8.3's cap; chosen). A `--project` or `--workspace` scope can
 *  hold hundreds of families, and the envelope is part of every call's 20,000 chars: three objects keep the whole
 *  frame near 700 chars, inside the frame reserve each paging verb holds back. `families_total` counts them all. */
export const SCOPE_FAMILIES_JSON_MAX = 3;
const ANY_COUNT = Number.POSITIVE_INFINITY;
export const READ_OPTIONS = Object.freeze({
  grep: Object.freeze({
    options: Object.freeze({
      ...COMMON_READ_OPTIONS,
      '--regex': readOpt('value', 'regex'),
      '--role': readOpt('value', 'role'),
      '--tool': readOpt('value', 'tool'),
      '--since': readOpt('value', 'since'),
      '--before': readOpt('value', 'before'),
      '--node': readOpt('value', 'node'),
      '--sort': readOpt('enum', 'sort', { values: GREP_SORTS }),
      '--limit': readOpt('int', 'limit', { min: 1, max: GREP_LIMIT_MAX }),
      '--cursor': readOpt('value', 'cursor'),
      '--include-recall': readOpt('flag', 'includeRecall'),
    }),
    defaults: Object.freeze({
      regex: null, role: null, tool: null, since: null, before: null, node: null,
      sort: GREP_SORTS[0], limit: GREP_LIMIT_DEFAULT, cursor: null, includeRecall: false,
    }),
    positional: Object.freeze({ min: 0, max: ANY_COUNT }),
  }),
  describe: Object.freeze({
    options: Object.freeze({
      ...COMMON_READ_OPTIONS,
      '--full': readOpt('flag', 'full'),
      '--cursor': readOpt('value', 'cursor'),
      '--node': readOpt('value', 'node'),
    }),
    defaults: Object.freeze({ full: false, cursor: null, node: null }),
    positional: Object.freeze({ min: 0, max: ANY_COUNT }),
  }),
  expand: Object.freeze({
    options: Object.freeze({
      ...COMMON_READ_OPTIONS,
      '--around': readOpt('value', 'around'),
      '--before': readOpt('int', 'before', { min: 0, max: AROUND_MAX }),
      '--after': readOpt('int', 'after', { min: 0, max: AROUND_MAX }),
      '--cursor': readOpt('value', 'cursor'),
    }),
    defaults: Object.freeze({ around: null, before: AROUND_DEFAULT, after: AROUND_DEFAULT, cursor: null }),
    positional: Object.freeze({ min: 0, max: ANY_COUNT }),
  }),
  tree: Object.freeze({
    options: Object.freeze({
      ...COMMON_READ_OPTIONS,
      '--depth': readOpt('int', 'depth', { min: 1, max: TREE_DEPTH_MAX }),
    }),
    defaults: Object.freeze({ depth: TREE_DEPTH_DEFAULT }),
    positional: Object.freeze({ min: 0, max: 0 }),
  }),
});
/** The read verbs (§8.2): derived from the whitelist, never listed twice. `touched` joins in W4. */
export const READ_VERBS = Object.freeze(Object.keys(READ_OPTIONS));

const BAD_READ_ARGS = Object.freeze({ ok: false, reason: 'bad-args' });

/** A read verb's argv (after the verb) against its whitelist. Every key the verb's table names has a value in
 *  `opts` (its default when not given), plus json, session, project and workspace. */
export function parseReadArgs(verb, argv) {
  if (typeof verb !== 'string' || !Object.hasOwn(READ_OPTIONS, verb) || !Array.isArray(argv)) return BAD_READ_ARGS;
  const spec = READ_OPTIONS[verb];
  const opts = { json: false, session: null, project: false, workspace: false, ...spec.defaults };
  const positional = [];
  const seen = new Set();
  let rest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (typeof a !== 'string') return BAD_READ_ARGS;
    if (rest || !a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    if (a === '--') {
      rest = true;
      continue;
    }
    if (!Object.hasOwn(spec.options, a) || seen.has(a)) return BAD_READ_ARGS;
    seen.add(a);
    const o = spec.options[a];
    if (o.kind === 'flag') {
      opts[o.key] = true;
      continue;
    }
    const v = argv[i + 1];
    if (typeof v !== 'string' || v === '') return BAD_READ_ARGS;
    i += 1;
    if (o.kind === 'value') {
      opts[o.key] = v;
      continue;
    }
    if (o.kind === 'enum') {
      if (!o.values.includes(v)) return BAD_READ_ARGS;
      opts[o.key] = v;
      continue;
    }
    if (!/^[0-9]{1,6}$/.test(v)) return BAD_READ_ARGS;
    const n = Number(v);
    if (n < o.min || n > o.max) return BAD_READ_ARGS;
    opts[o.key] = n;
  }
  if (positional.length < spec.positional.min || positional.length > spec.positional.max) return BAD_READ_ARGS;
  if (verb === 'grep' && positional.length === 0 && opts.regex === null) return BAD_READ_ARGS;
  if (verb === 'describe' && positional.length === 0 && opts.node === null) return BAD_READ_ARGS;
  if (verb === 'expand' && positional.length === 0 && opts.around === null && opts.cursor === null) return BAD_READ_ARGS;
  return { ok: true, verb, positional: Object.freeze(positional), opts: Object.freeze(opts) };
}

/** A select list naming only the columns the store's version has (§6.11, DM44). A column a later version added
 *  reads `NULL AS <col>`, so a store older than the code answers with that field null and never a SQL error.
 *  A table that version lacks throws, and so does a column no version declares (a typo, not an old store).
 *  The verbs that need a newer table refuse first with migration-pending. */
export function selectColumns(version, table, cols, schema = SCHEMA_ADDED, alias = null) {
  const have = new Set();
  const everywhere = new Set();
  let known = false;
  for (const [v, entry] of Object.entries(schema)) {
    const t = entry.tables[table];
    if (t === undefined) continue;
    for (const c of t) everywhere.add(c);
    if (Number(v) > version) continue;
    known = true;
    for (const c of t) have.add(c);
  }
  if (!known) throw new TypeError(`selectColumns: table ${table} is not in schema version ${version}`);
  const q = alias === null ? '' : `${alias}.`;
  return cols.map((c) => {
    if (!everywhere.has(c)) throw new TypeError(`selectColumns: ${table}.${c} is in no schema version`);
    return have.has(c) ? `${q}${c}` : `NULL AS ${c}`;
  }).join(', ');
}

/** `recall-off` in B2 (slug history-recall-off-preflight-b2, NEW): the verb that writes recall-off/<id> ships
 *  with W2 (§8.10), and B2 answers only its refusals, in this order:
 *   - an argv off `<id> [--clear]` or `--clear-all` is bad-args;
 *   - an id off ccd's grammar is bad-id, before any path is formed from it (C66);
 *   - then the caller reads $REG/<id>.generation (`generation` null asks it to): unreadable is
 *     generation-unreadable (C67);
 *   - anything else is bad-args, naming W2. */
export function decideRecallOffPreflight(i) {
  const a = i.args;
  const done = (reason) => ({ done: true, exit: EXIT.REFUSED, reason });
  if (a.length === 1 && a[0] === '--clear-all') return done('bad-args');
  const shapeOk = a.length >= 1 && a.length <= 2 && typeof a[0] === 'string' && !a[0].startsWith('--')
    && (a.length === 1 || a[1] === '--clear');
  if (!shapeOk) return done('bad-args');
  if (!idOk(a[0])) return done('bad-id');
  if (i.generation === null) return { done: false, id: a[0] };
  if (i.generation.state === 'unreadable') return done('generation-unreadable');
  return done('bad-args');
}


// ── grep: arguments and the index gate (W1-B2 Task 12; spec §8.4, §9.1) ──────────────────────────────

/** What the sweep indexes and grep may search: the searchable provenances plus recall-echo. Default grep
 *  filters to SEARCHABLE_PROVENANCE at query time; `--include-recall` widens it to this list (§8.4
 *  "Recall echoes … are stored, excluded from default search, and found with --include-recall").
 *  D-4712 (history-recall-echo-indexed) */
export const INDEXED_PROVENANCE = Object.freeze([...SEARCHABLE_PROVENANCE, 'recall-echo']);

/** derivation_state's FTS step (§9.1): the sweep creates and backfills the FTS tables under ('fts', 1), and
 *  grep's index gate reads the same row. Spelled once, here. */
export const FTS_STEP = 'fts';

/** A byte count as SEARCH_REACH spells it: whole MiB, else whole KiB, else bytes. */
export function reachSize(n) {
  if (n % 1048576 === 0) return `${n / 1048576} MiB`;
  if (n % 1024 === 0) return `${n / 1024} KiB`;
  return `${n} bytes`;
}

/** How far grep reaches. Grep's exit 3 prints these words on its hint line (recall.mjs `grepNotFound`), and the skill
 *  (section 9) and README's history section quote them verbatim (spec §6.2 and §8.4, rev 3.5). The index holds at
 *  most an entry's first ENTRY_FTS_BYTES and a sidecar's first SIDECAR_FTS_BYTES of redacted text (B1's
 *  history-entry-index-text-windowed and history-sidecar-redact-before-cut), and --regex scans that same text (Task 14,
 *  spec §8.4), so no grep form finds a word past it. The sentence is built from the two
 *  constants, so changing a window changes it, and the skill's and README's pins go red until their text follows.
 *  "At most": the cut can fall short of the window (cutIndexText's margin and trailing-run rules), and a read verb
 *  never decompresses a sidecar past SIDECAR_WHOLE_MAX (D-4713 (history-read-skips-oversize-sidecar)). */
export const SEARCH_REACH = `grep reaches at most the first ${reachSize(ENTRY_FTS_BYTES)} of each message's redacted text and the first ${reachSize(SIDECAR_FTS_BYTES)} of each tool output Claude Code saved to its own file; text past that is stored but not searched`;

/** grep's index gate (§9.1, §8.3 exit 7), over what the reader measured:
 *  - a probe that THREW is 5 probe-failed, never folded into absent;
 *  - an absent module is 7 fts5-absent;
 *  - no blobs_fts yet, or a backfill ('fts', 1) that has not completed, is 7 fts-pending, so a partial index
 *    never answers 3 for text the store holds but has not indexed yet.
 *  - an open FTS_REBUILD_STEP row (doctor --repair, W1-B2 Task 23) is 7 fts-pending too: the recreated tables hold only what the rebuild has re-indexed so far.
 *  D-4714 (history-grep-pending-until-backfilled) */
export function decideGrepIndex({ probe, table, completed, rebuilding = false }) {
  if (probe === 'threw') return { ok: false, exit: EXIT.DB, reason: 'probe-failed' };
  if (probe !== 'present') return { ok: false, exit: EXIT.FTS_UNAVAILABLE, reason: 'fts5-absent' };
  if (!table || !completed || rebuilding) return { ok: false, exit: EXIT.FTS_UNAVAILABLE, reason: 'fts-pending' };
  return { ok: true };
}

/** grep's option grammar (§8.4), over the argv after the verb word. Every value is checked here, before any
 *  identity or store read. The scope flags (--project, --workspace, --session <id>) are consumed and passed
 *  over: readContext decides them (Task 10). `--` ends the options, so a word that begins with `--` can be
 *  searched. With --regex there are no positional words and no rank to sort by (Task 14). */
export function parseGrepArgs(argv, nowMs) {
  const a = {
    words: [], regex: null, role: null, tool: null, sinceMs: null, beforeMs: null, node: null,
    sort: 'recency', limit: GREP_LIMIT_DEFAULT, cursor: null, includeRecall: false, json: false,
  };
  const bad = { ok: false, reason: 'bad-args' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--') { a.words.push(...argv.slice(i + 1)); break; }
    if (!t.startsWith('--')) { a.words.push(t); continue; }
    if (seen.has(t)) return bad;
    seen.add(t);
    if (t === '--json') { a.json = true; continue; }
    if (t === '--include-recall') { a.includeRecall = true; continue; }
    if (t === '--project' || t === '--workspace') continue;
    if (i + 1 >= argv.length) return bad;
    i += 1;
    const v = argv[i];
    switch (t) {
      case '--session': break;
      case '--regex': a.regex = v; break;
      case '--role': if (!/^[a-z]{1,16}$/.test(v)) return bad; a.role = v; break;
      case '--tool': if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(v)) return bad; a.tool = v; break;
      case '--since': a.sinceMs = parseTimeBound(v, nowMs); if (a.sinceMs === null) return bad; break;
      case '--before': a.beforeMs = parseTimeBound(v, nowMs); if (a.beforeMs === null) return bad; break;
      case '--node': a.node = v; break;
      case '--sort': if (!GREP_SORTS.includes(v)) return bad; a.sort = v; break;
      case '--limit': {
        if (!/^[1-9][0-9]{0,5}$/.test(v) || Number(v) > GREP_LIMIT_MAX) return bad;
        a.limit = Number(v);
        break;
      }
      case '--cursor': a.cursor = v; break;
      default: return bad;
    }
  }
  if (a.regex === null ? a.words.length === 0 : a.words.length > 0 || a.sort !== 'recency') return bad;
  return { ok: true, args: a };
}

// ── a window of a longer text, redacted for display (W1-B2 Task 12; coordinator rulings R-display-window, R-window2) ──
// A read verb that shows a window of a longer text (grep's snippet, describe's excerpt and --full page, expand's cut,
// page and outline input) redacts that window and ENTRY_REDACT_MARGIN on each side of it, never the whole text, so
// one snippet's or one page's cost is bounded by the window, whatever the field's length: B1's D-4419
// (`history-entry-index-text-windowed`) bound, carried to display (spec §8.3 and §8.4, rev 3.5).

/** Where grep's snippet sits (§8.4, §11 P9): the earliest FTS5-compatible Porter-stem or explicit-prefix hit.
 *  `at` is -1 when no term is found. The locator is Task 2's search, moved here so snippetWindow and
 *  displaySnippet have one spelling and preserve raw code-unit spans. */
export function snippetSpan(text, terms) {
  const content = String(text);
  let at = -1;
  let len = 0;
  const phraseTokens = (term) => [...unicode61Words(String(term).replace(/\*+$/, ''))].map(({ text }) => foldToken(text)).filter((t) => t.length > 0);
  // The source's candidates, folded on demand; one folded to nothing (removed marks only) is no token, as in FTS5.
  const source = unicode61Words(content);
  const words = [];
  const wordAt = (i) => {
    while (words.length <= i) {
      const next = source.next();
      if (next.done) return null;
      const folded = foldToken(next.value.text);
      if (folded.length > 0) words.push({ ...next.value, folded });
    }
    return words[i];
  };
  for (const term of terms) {
    const raw = String(term);
    // FTS5 reads a terminal star as a prefix on the phrase's LAST token (`"error hand"*`), never on the first.
    const prefix = raw.endsWith('*');
    const needles = phraseTokens(raw);
    if (needles.length === 0) continue;
    const stems = needles.map(porterStem);
    // Whether the candidate (already folded) is needle `k`. FTS5's `porter unicode61` stems the query token and the indexed
    // token alike and applies prefix semantics to the stems, so the last needle of a prefix term is a stem-prefix test
    // (`runn*` rejects `running`, stem run; `runs*`, stem run, finds it) and every other needle is Porter-stem equality.
    const is = (folded, k) => (prefix && k === needles.length - 1 ? porterStem(folded).startsWith(stems[k]) : porterStem(folded) === stems[k]);
    for (let i = 0; wordAt(i) !== null; i += 1) {
      const first = wordAt(i);
      if (!is(first.folded, 0)) continue;
      let last = first;
      let matches = true;
      for (let offset = 1; offset < needles.length; offset += 1) {
        const next = wordAt(i + offset);
        if (next === null || !is(next.folded, offset)) {
          matches = false;
          break;
        }
        last = next;
      }
      if (!matches) continue;
      const matchAt = first.at;
      const matchLen = last.end - matchAt;
      if (at === -1 || matchAt < at || (matchAt === at && matchLen > len)) {
        at = matchAt;
        len = matchLen;
      }
      // This term's first matching candidate is its earliest; later starts cannot improve the global hit.
      break;
    }
  }
  return { at, len };
}

/** The longest window redactDisplayWindow cuts from its redacted context: with ENTRY_REDACT_MARGIN on each side, the
 *  text read is at most DISPLAY_READINGS_MAX, where redactForDisplay IS redactForIndex (Task 7A). Every caller's
 *  window is far shorter (EXPLORE_READ_MAX, 256 KiB, is the longest); a longer one is shown inexact, unless it is the
 *  whole text (displayWindow's step 0). */
export const DISPLAY_WINDOW_MAX = DISPLAY_READINGS_MAX - 2 * ENTRY_REDACT_MARGIN;

/** How many characters that are not a mark a window edge's cut may sit short of a margin's own reading and still
 *  count as exact (*chosen*). A JSON escape the edge splits (`\` on one side, `n` or `u0041` on the other, once per
 *  decode level) is decoded in the read text but stays as written in the margin read alone; measured on the
 *  prototype, 0 left 118 of 120 such page edges inexact and 32 left none. */
export const DISPLAY_EDGE_SLACK = 32;

/** The one line an inexact window is shown under (spec §8.3; coordinator ruling R-window2). It holds no `"`, `\`,
 *  `<`, `>` or `&`, as REDACTED_MARK holds none, so it prints as it is in every form. */
export const DISPLAY_INEXACT_NOTE = '[window redacted alone: every word of 8 or more characters masked]';

/** A mark, or a maximal span of `[A-Za-z0-9_-]` characters, backslashes and ANSI sequences: the unit an inexact
 *  window masks (coordinator ruling on final-check W1). A mark is matched first and kept whole. Each arm opens on a
 *  character no other arm opens on, so the scan is linear (D-4306). */
const DISPLAY_SPAN_RE = new RegExp(`${MARK_RE_SRC}|(?:[A-Za-z0-9_\\\\-]|(?:${ANSI_ESCAPE_RE.source}))+`, 'g');

/** A run of 8 or more `[A-Za-z0-9_-]` characters: a word an inexact window masks. */
const DISPLAY_WORD_RE = /[A-Za-z0-9_-]{8,}/;

/** Whether a DISPLAY_SPAN_RE span holds a word of 8 or more characters in any of the readings redactForDisplay takes:
 *  the span with its ANSI sequences removed (B1's joined reading), then each JSON-escape decode of that, up to
 *  INDEX_UNESCAPE_PASSES, its sequences removed again. A value printed one coloured character at a time, or as one
 *  JSON unicode escape per character, is a word only in those readings (final-check W1: the raw text's runs were 5
 *  characters or fewer, and 30 of a value's 48 showed). Linear in the span, once per pass. */
function spanHoldsWord(span) {
  let s = span.replace(ANSI_ESCAPE_RE, '');
  if (DISPLAY_WORD_RE.test(s)) return true;
  for (let pass = 0; pass < INDEX_UNESCAPE_PASSES; pass += 1) {
    const u = unescapeJsonText(s);
    if (u === s) return false;
    s = u.replace(ANSI_ESCAPE_RE, '');
    if (DISPLAY_WORD_RE.test(s)) return true;
  }
  return false;
}

/** A break between token spans: whitespace, or one of `"`, `'`, `` ` ``, `,`, `;` and `&`, the characters that end
 *  a value in layer 2's `NAME=` form (coordinator ruling on final-check W2). */
const TOKEN_BREAK_RE = /[\s"'`,;&]/;

/** A code unit of a token span (`[^\s"'`,;&]`): a margin's far end moves off one, and a partial one that reaches the
 *  window is dropped. Every `[A-Za-z0-9_-]` run lies inside one, and so does a `NAME=` value with `+` or `/` in it,
 *  a dotted Bearer token or JWT, and a `?token=` value. */
function isTokenByte(c) {
  return !TOKEN_BREAK_RE.test(String.fromCharCode(c));
}

/** What ends an inexact window's edge drop: whitespace, or one of `"`, `'`, `` ` ``, `,` and `&`. */
const INEXACT_EDGE_BREAK_RE = /[\s"'`,&]/;

/** A code unit an inexact window's edge drop reads as part of a span: every run byte, the backslash, ESC and every
 *  other character a colour sequence holds (`;` among its parameters), so an edge that cuts a word a sequence or an
 *  escape split drops the window's part of it, however few of its characters are inside (final-check W1 and W3).
 *  A superset of the readings spanHoldsWord takes, so the drop fails closed. */
function isInexactEdgeByte(c) {
  return !INEXACT_EDGE_BREAK_RE.test(String.fromCharCode(c));
}

/** `s` without its leading run of `pred` code units, by a forward scan (linear; B1's dropTrailingRun, mirrored). */
function dropLeadingWhile(s, pred) {
  let k = 0;
  while (k < s.length && pred(s.charCodeAt(k))) k += 1;
  return k === 0 ? s : s.slice(k);
}

/** `s` without its trailing run of `pred` code units, by a backward scan (linear, as B1's dropTrailingRun). */
function dropTrailingWhile(s, pred) {
  let k = s.length;
  while (k > 0 && pred(s.charCodeAt(k - 1))) k -= 1;
  return k === s.length ? s : s.slice(0, k);
}

/** `k` moved back off the low half of a surrogate pair, so no slice at `k` splits the pair. */
function pairStart(t, k) {
  if (k <= 0 || k >= t.length) return k;
  const c = t.charCodeAt(k);
  const p = t.charCodeAt(k - 1);
  return c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff ? k - 1 : k;
}

/** `s`'s length without its marks: the characters of `s` that came from text, not from a redaction. */
function unmarkedLength(s) {
  let n = s.length;
  for (let k = s.indexOf(REDACTED_MARK); k !== -1; k = s.indexOf(REDACTED_MARK, k + REDACTED_MARK.length)) n -= REDACTED_MARK.length;
  return n;
}

/** redactForDisplay's reading of `text` (at most DISPLAY_READINGS_MAX long, where redactForDisplay IS redactForIndex),
 *  with the reading it chose: `levels` JSON-escape decodes, and `bound` when it reached INDEX_UNESCAPE_PASSES and
 *  marked the escape-glued spans. redactForIndex's own loop, step for step, so the window knows which reading it is
 *  cut from; Step 1's case `a whole text's window is redactForDisplay's, …` pins the two equal on every reading, through
 *  each text's window inside a longer one (a whole text's window no longer reaches this function). */
function displayReading(text, idx) {
  let t = redactIndexReading(text, idx);
  let keep = t;
  let levels = 0;
  for (let pass = 0; pass < INDEX_UNESCAPE_PASSES; pass += 1) {
    const deeper = unescapeJsonText(t);
    if (deeper === t) return { text: keep, levels, bound: false };
    t = redactIndexReading(deeper, idx);
    if (t !== deeper) {
      keep = t;
      levels = pass + 1;
    }
  }
  return { text: markEscapeGluedSpans(t), levels: INDEX_UNESCAPE_PASSES, bound: true };
}

/** `text` read through exactly the reading displayReading chose for the text around it: the same decodes, each
 *  redacted, and the escape-glued spans marked when that reading marked them. A margin read so is comparable with the
 *  read text whichever reading the read text's content chose (finding V15: a margin read through its own choice stays
 *  raw while the read text is shown decoded). */
function readingAt(text, idx, levels, bound) {
  let t = redactIndexReading(text, idx);
  for (let pass = 0; pass < levels; pass += 1) t = redactIndexReading(unescapeJsonText(t), idx);
  return bound ? markEscapeGluedSpans(t) : t;
}

/** A margin's reading, and the same with its ANSI sequences removed when that differs. B1's redactField returns its
 *  joined reading, every sequence of the text removed, when that reading finds something anywhere in the text, so the
 *  read text can drop a margin's sequences that the margin read alone keeps (finding V18). ANSI_ESCAPE_RE never takes a
 *  mark's first character, so the removal leaves every mark whole. */
function marginReadings(m) {
  if (!ESCAPE_INTRODUCER_RE.test(m)) return [m];
  const plain = m.replace(ANSI_ESCAPE_RE, '');
  return plain === m ? [m] : [m, plain];
}

/** Where the window starts in `d`, the read text's reading, given the left margin's readings. Rank 1: the end of the
 *  longest prefix `d` shares with one of them, when that is the whole margin. Otherwise the reading whose shared prefix
 *  reaches furthest decides, when it is either of: rank 2, the start of the mark `d` holds where the two part, so a
 *  match straddling the edge shows as its whole mark; rank 3, the end of the shared prefix, when what the margin has
 *  left past it is at most DISPLAY_EDGE_SLACK characters and no mark (an escape the edge split). -1 when none holds:
 *  the cut cannot be shown exact. */
function windowStart(d, lefts) {
  let best = -1;
  let reach = -1;
  for (const l of lefts) {
    const n = Math.min(d.length, l.length);
    let s = 0;
    while (s < n && d.charCodeAt(s) === l.charCodeAt(s)) s += 1;
    if (s === l.length) return s;
    if (s <= reach) continue;
    const j = d.lastIndexOf(REDACTED_MARK, s);
    if (j !== -1 && j + REDACTED_MARK.length > s) {
      best = j;
      reach = s;
    } else if (l.length - s <= DISPLAY_EDGE_SLACK && l.indexOf(REDACTED_MARK, s) === -1) {
      best = s;
      reach = s;
    }
  }
  return best;
}

/** Where the window ends in `d`, at or past `s`, given the right margin's readings: windowStart's rule, mirrored, over
 *  the longest shared suffix. -1 when none holds. */
function windowEnd(d, rights, s) {
  let best = -1;
  let reach = -1;
  for (const r of rights) {
    const n = Math.min(d.length - s, r.length);
    let k = 0;
    while (k < n && d.charCodeAt(d.length - 1 - k) === r.charCodeAt(r.length - 1 - k)) k += 1;
    const e = d.length - k;
    if (k === r.length) return e;
    if (k <= reach) continue;
    const j = e > 0 ? d.lastIndexOf(REDACTED_MARK, e - 1) : -1;
    if (j !== -1 && j + REDACTED_MARK.length >= e && j + REDACTED_MARK.length > s) {
      best = j + REDACTED_MARK.length;
      reach = k;
    } else if (r.length - k <= DISPLAY_EDGE_SLACK && r.lastIndexOf(REDACTED_MARK, r.length - k - 1) === -1) {
      best = e;
      reach = k;
    }
  }
  return best;
}

/** An inexact window (coordinator ruling R-window2, the fail-closed display, and the ruling on final-check W1):
 *  `text[lo, hi)` alone, the span either window edge cuts dropped (isInexactEdgeByte, so a word joined across
 *  sequences or escapes at the edge goes with it), through redactForDisplay, then every span (DISPLAY_SPAN_RE) that
 *  holds a word of 8 or more characters in its own readings (spanHoldsWord) replaced by the mark. It reads the window
 *  and the one character beyond each edge, and nothing else. */
function inexactWindow(t, lo, hi, idx) {
  let w = t.slice(lo, hi);
  if (lo > 0 && isInexactEdgeByte(t.charCodeAt(lo - 1)) && isInexactEdgeByte(t.charCodeAt(lo))) w = dropLeadingWhile(w, isInexactEdgeByte);
  if (hi < t.length && hi > 0 && isInexactEdgeByte(t.charCodeAt(hi - 1)) && isInexactEdgeByte(t.charCodeAt(hi))) w = dropTrailingWhile(w, isInexactEdgeByte);
  return { text: redactForDisplay(w, idx).replace(DISPLAY_SPAN_RE, (s) => (s !== REDACTED_MARK && spanHoldsWord(s) ? REDACTED_MARK : s)), exact: false };
}

/** text[from, to) as a read verb shows it, and whether it was cut exactly (spec §8.3 and §8.4; coordinator rulings
 *  R-display-window and R-window2). In order:
 *  0. A window of the whole text (`from` at or before 0, `to` at or past its length) has no margin: it is
 *     redactForDisplay's reading of the text, exact, whatever its length (final-check W4). Any other window longer
 *     than DISPLAY_WINDOW_MAX is shown inexact.
 *  1. The margins. [a, b) is the window widened by ENTRY_REDACT_MARGIN each way, each end moved off a token span
 *     (`[^\s"'`,;&]`, isTokenByte) before anything is redacted, so the text read never starts or ends inside one: B1's
 *     cut rule (D-4419's cutIndexText), widened from `[A-Za-z0-9_-]` runs to token spans (final-check W2), so a
 *     `NAME=` value with `+` or `/`, a dotted Bearer token or JWT and a `?token=` value are read whole or not at all.
 *     A token span longer than the margin stops the move at the window's edge, and that partial span is dropped from
 *     what is shown, as B1's cut drops a trailing run. A match that is not one token span (it holds whitespace or a
 *     break: a PEM body, a quoted value) and begins more than ENTRY_REDACT_MARGIN before the window is read only from
 *     a break inside it: spec §8.3's residual.
 *  2. The read text's reading. [a, b) is read through redactForDisplay's reading (displayReading), so every layer and
 *     reading (the pairs, the belt, the context forms and their JSON-escaped form, the shapes, the escape readings,
 *     the joined reading) sees the margins with the window. What is shown is a slice of that reading and nothing
 *     else: a match straddling an edge was made whole there, so it shows only as its whole mark.
 *  3. The cut back. Each margin is read alone through the SAME reading (readingAt: the decodes the read text took),
 *     and also with its ANSI sequences removed (marginReadings). The window is what the read text leaves between the
 *     longest prefix it shares with a left reading and the longest suffix it shares with a right one (windowStart,
 *     windowEnd; of the readings, the one whose shared part reaches furthest). The cut is exact when that shared part
 *     is the whole margin, or ends at a mark the read text holds there, or leaves at most DISPLAY_EDGE_SLACK
 *     characters of an escape the edge split; and the slice then holds at
 *     most (to - from) + 2 × DISPLAY_EDGE_SLACK characters that are not a mark, since a redaction, a decode and a
 *     removed sequence each leave at most one character per character read.
 *  4. Otherwise the cut cannot be shown exact (B1's redactField is not local: its joined reading returns the whole
 *     text without its sequences), and the window is shown inexact (inexactWindow), never margin text.
 *  Each reading reads at most (to - from) + 2 × ENTRY_REDACT_MARGIN characters, through at most
 *  INDEX_UNESCAPE_PASSES + 1 redactions; an inexact window reads the window once more. No slice splits a surrogate
 *  pair. `idx` is the read's pair index, with its belt (Task 7A). */
function displayWindow(text, from, to, idx) {
  const t = String(text);
  const lo = pairStart(t, Math.max(0, Math.min(from, t.length)));
  const hi = Math.max(lo, pairStart(t, Math.max(0, Math.min(to, t.length))));
  if (lo === 0 && hi === t.length) return { text: redactForDisplay(t, idx), exact: true };
  if (hi - lo > DISPLAY_WINDOW_MAX) return inexactWindow(t, lo, hi, idx);
  let a = pairStart(t, Math.max(0, lo - ENTRY_REDACT_MARGIN));
  while (a > 0 && a < lo && isTokenByte(t.charCodeAt(a - 1)) && isTokenByte(t.charCodeAt(a))) a += 1;
  let b = pairStart(t, Math.min(t.length, hi + ENTRY_REDACT_MARGIN));
  while (b < t.length && b > hi && isTokenByte(t.charCodeAt(b - 1)) && isTokenByte(t.charCodeAt(b))) b -= 1;
  const leadCut = a > 0 && isTokenByte(t.charCodeAt(a - 1)) && isTokenByte(t.charCodeAt(a));
  const tailCut = b < t.length && b > 0 && isTokenByte(t.charCodeAt(b - 1)) && isTokenByte(t.charCodeAt(b));
  const read = displayReading(t.slice(a, b), idx);
  const d = read.text;
  const lefts = lo > a ? marginReadings(readingAt(t.slice(a, lo), idx, read.levels, read.bound)) : [''];
  const rights = b > hi ? marginReadings(readingAt(t.slice(hi, b), idx, read.levels, read.bound)) : [''];
  const s0 = windowStart(d, lefts);
  const e0 = s0 === -1 ? -1 : windowEnd(d, rights, s0);
  if (s0 === -1 || e0 === -1) return inexactWindow(t, lo, hi, idx);
  const s = pairStart(d, s0);
  const e = Math.max(s, pairStart(d, e0));
  let out = d.slice(s, e);
  if (leadCut) out = dropLeadingWhile(out, isTokenByte);
  if (tailCut) out = dropTrailingWhile(out, isTokenByte);
  if (unmarkedLength(out) > (hi - lo) + 2 * DISPLAY_EDGE_SLACK) return inexactWindow(t, lo, hi, idx);
  return { text: out, exact: true };
}

/** text[from, to) as a read verb shows it (displayWindow): the exact cut of its redacted context, or an inexact window
 *  under DISPLAY_INEXACT_NOTE's one line. Describe's excerpt and --full pages (Task 15) and expand's cuts, pages and
 *  outline input (Task 16) call it; grep's snippet calls displayWindow itself. A window of the whole text
 *  (`from` at or before 0, `to` at or past its length) has no margin, so it is always exact and IS redactForDisplay's
 *  reading, whatever its length (displayWindow's step 0, ahead of the DISPLAY_WINDOW_MAX guard). */
export function redactDisplayWindow(text, from, to, idx) {
  const w = displayWindow(text, from, to, idx);
  return w.exact ? w.text : `${DISPLAY_INEXACT_NOTE}\n${w.text}`;
}

/** How far past the snippet's hit, each way, grep's snippet reads its RAW window (*chosen*): SNIPPET_MAX, more than
 *  snippetWindow's 24 before and 40 after, so a mark that shortens the text near the hit still leaves snippetWindow
 *  its whole window. */
const SNIPPET_READ = SNIPPET_MAX;

/** grep's snippet over a body or sidecar of any length (§8.4, §11 P9; §8.3, rev 3.5):
 *  the earliest hit is found in the RAW text (snippetSpan), the window around it is cut from its redacted context by
 *  displayWindow, and snippetWindow cuts that window, `...` marking a cut at either end of the text. With no hit the
 *  text's first 2 × SNIPPET_READ characters are read, and snippetWindow takes its first 80 of them. An inexact window
 *  is shown with DISPLAY_INEXACT_NOTE ahead of the snippet, on the snippet's one line. */
export function displaySnippet(text, terms, idx) {
  const content = String(text);
  const { at, len } = snippetSpan(content, terms);
  const from = at === -1 ? 0 : Math.max(0, at - SNIPPET_READ);
  const to = at === -1 ? Math.min(content.length, 2 * SNIPPET_READ) : Math.min(content.length, at + Math.max(len, 1) + SNIPPET_READ);
  const w = displayWindow(content, from, to, idx);
  const shown = snippetWindow(w.text, terms);
  const prefix = from > 0 && !shown.startsWith('...') ? '...' : '';
  const suffix = to < content.length && !shown.endsWith('...') ? '...' : '';
  return `${w.exact ? '' : `${DISPLAY_INEXACT_NOTE} `}${prefix}${shown}${suffix}`;
}

// ── describe: arguments (W1-B2 Task 15; spec §8.4) ────────────────────────────────────────────────────

/** describe's option grammar, over the argv after the verb word. The target is one of:
 *  - a full id, a display prefix or a pasted card line. A pasted line's words are joined with one space, so an
 *    unquoted line still reads (extractNodeId takes it apart);
 *  - `--node <id>`.
 *  `--full` pages the native summary, and `--cursor` continues a page, so it is valid only with --full. The scope
 *  flags (--project, --workspace, --session <id>) are consumed and passed over, as grep's are: readContext decides
 *  them. */
export function parseDescribeArgs(argv) {
  const a = { target: '', full: false, cursor: null, json: false };
  const bad = { ok: false, reason: 'bad-args' };
  const words = [];
  const seen = new Set();
  let node = null;
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--') { words.push(...argv.slice(i + 1)); break; }
    if (!t.startsWith('--')) { words.push(t); continue; }
    if (seen.has(t)) return bad;
    seen.add(t);
    if (t === '--json') { a.json = true; continue; }
    if (t === '--full') { a.full = true; continue; }
    if (t === '--project' || t === '--workspace') continue;
    if (i + 1 >= argv.length) return bad;
    i += 1;
    const v = argv[i];
    if (t === '--session') continue;
    if (t === '--node') { node = v; continue; }
    if (t === '--cursor') { a.cursor = v; continue; }
    return bad;
  }
  if ((node === null) === (words.length === 0)) return bad;
  if (a.cursor !== null && !a.full) return bad;
  a.target = node ?? words.join(' ');
  return { ok: true, args: a };
}

// ── expand (W1-B2 Task 16) ─────────────────────────────────────────────────────────────────────────────
// The decisions recall.mjs's expand delivers (spec §8.4 "expand", §8.3 "Redaction" and "Cap", §6.1 variants,
// §11 P17): what a page costs and where a page or a cut ends, which target an argument names, whether an
// entry is in scope, which items are cut, a cursor's validity, the delegate hint, a tool_result's paired path,
// the ONE rendering of a row's RAW text (every window of which recall.mjs shows through Task 12's
// redactDisplayWindow, before any cut or escape), and a cut item's outline over at most EXPLORE_READ_MAX of it.

/** What one page of expand text may cost (textCost): the cap less 2,000 for the header, the item lines, the
 *  shown and next lines and the hint (*chosen*). */
export const PAGE_TEXT_BUDGET = OUTPUT_CAP - 2000;
/** The cost ceiling of each half of a cut item (its first EXPLORE_CUT characters, its outline), so a cut item
 *  fits an empty page whatever it escapes to (*chosen*). */
export const CUT_TEXT_BUDGET = 8000;
/** The page budget left that lets a whole item which does not fit start here as a partial, when it is not the
 *  page's first item (*chosen*): below it the item waits to be first on the next page. */
export const EXPAND_MIN_PARTIAL = 4000;

/** One UTF-16 code unit's cost on a page: the longest form it escapes to. XML text turns `&` into `&amp;` and
 *  `<`/`>` into 4; JSON turns `"`, `\` and \b \f \n \r \t into 2, any other control character into 6, and a
 *  surrogate half is charged 6 too (a lone one is). So a page fits the cap in the human form and in --json
 *  alike, and a cursor's offsets mean the same in both. */
export function charCost(code) {
  if (code === 0x26) return 5;
  if (code === 0x3c || code === 0x3e) return 4;
  if (code === 0x22 || code === 0x5c) return 2;
  if (code < 0x20) return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
  if (code >= 0xd800 && code <= 0xdfff) return 6;
  return 1;
}

/** The cost of text[start, end). */
export function textCost(text, start = 0, end = text.length) {
  let n = 0;
  for (let i = start; i < end; i += 1) n += charCost(text.charCodeAt(i));
  return n;
}

const isHighSurrogate = (text, k) => {
  const c = text.charCodeAt(k);
  return c >= 0xd800 && c <= 0xdbff;
};

/** Where a page of `text` that starts at `start` ends (exclusive) under `budget`. A page always moves (one
 *  character, or one surrogate pair, at least) and never splits a surrogate pair. */
export function pageEnd(text, start, budget) {
  if (start >= text.length) return text.length;
  let n = 0;
  let i = start;
  while (i < text.length) {
    const c = charCost(text.charCodeAt(i));
    if (n + c > budget) break;
    n += c;
    i += 1;
  }
  if (i === start) i = start + 1;
  if (i < text.length && isHighSurrogate(text, i - 1)) i = i - 1 > start ? i - 1 : i + 1;
  return i;
}

/** The first at most `maxChars` characters of `text` whose cost stays under `budget`, whole pairs only. */
export function cutText(text, maxChars, budget) {
  let n = Math.min(pageEnd(text, 0, budget), maxChars, text.length);
  if (n > 0 && n < text.length && isHighSurrogate(text, n - 1)) n -= 1;
  return text.slice(0, n);
}

/** A node id or its prefix (6 to 20 hex, §6.1's display minimum) — the grammar Task 12's resolveNodeInScope resolves. */
const EXPAND_NODE_RE = /^[LN][0-9a-f]{6,20}$/;
/** A raw-only row's key: B1's rawRowKey (`x` + 32 hex), the uuid an unparsable line is stored under. */
const EXPAND_RAW_RE = /^x[0-9a-f]{32}$/;

/** What an expand argument names. */
export function expandTargetOf(s) {
  if (typeof s !== 'string') return 'bad';
  if (EXPAND_NODE_RE.test(s)) return 'node';
  if (UUID_RE.test(s) || EXPAND_RAW_RE.test(s)) return 'entry';
  return 'bad';
}

/** expand's arguments from Task 10's parseReadArgs answer, whose `expand` row has checked every option's grammar:
 *  at most one target, and never a target with --around. --before/--after mean something only with --around and
 *  are ignored otherwise. Neither target nor --around leaves a bare --cursor, which names its own target. */
export function expandArgsOf(parsed) {
  const pos = parsed.positional;
  const o = parsed.opts;
  if (pos.length > 1) return { ok: false, reason: 'bad-args' };
  const target = pos.length === 1 ? pos[0] : null;
  const around = typeof o.around === 'string' ? o.around : null;
  if (target !== null && around !== null) return { ok: false, reason: 'bad-args' };
  return {
    ok: true,
    args: {
      target, around, before: Number.isSafeInteger(o.before) ? o.before : AROUND_DEFAULT,
      after: Number.isSafeInteger(o.after) ? o.after : AROUND_DEFAULT, cursor: typeof o.cursor === 'string' ? o.cursor : null,
    },
  };
}

/** What a decoded expand cursor names, for `expand --cursor <c>` given alone: its key is the target, or
 *  `around:<uuid>:<before>:<after>`. null when the key names nothing expand could resolve. */
export function expandResumeOf(cursor) {
  if (cursor === null || typeof cursor.t !== 'string') return null;
  const m = /^around:([^:]+):([0-9]{1,2}):([0-9]{1,2})$/.exec(cursor.t);
  if (m !== null) {
    const before = Number(m[2]);
    const after = Number(m[3]);
    return before > AROUND_MAX || after > AROUND_MAX ? null : { target: null, around: m[1], before, after };
  }
  return expandTargetOf(cursor.t) === 'bad' ? null : { target: cursor.t, around: null, before: AROUND_DEFAULT, after: AROUND_DEFAULT };
}

/** An entry named by uuid: outside the scope is out-of-scope, never not-found (§8.2). */
export function entryScopeVerdict({ found, inScope }) {
  if (!found) return 'not-found';
  return inScope ? 'ok' : 'out-of-scope';
}

/** Whether an item is cut to EXPLORE_CUT with an outline: a tool output or a sidecar, outside a message expansion
 *  (which shows its row whole, paged). */
export function expandCuts({ whole, kind, provenance }) {
  if (whole) return false;
  return kind === 'sidecar' || provenance === 'tool' || provenance === 'recall-echo';
}

/** A decoded expand cursor against this expansion: its key must be this target's, its item inside the list, its
 *  offset a non-negative integer. No cursor starts at the top. */
export function decideExpandCursor({ cursor, key, total }) {
  if (cursor === null) return { ok: true, i: 0, o: 0 };
  const { t, i, o } = cursor;
  if (t !== key || !Number.isSafeInteger(i) || !Number.isSafeInteger(o) || i < 0 || o < 0 || i >= total) return { ok: false };
  return { ok: true, i, o };
}

/** §8.4: more than DELEGATE_FACTOR times the cap is a `hint: delegate` line (cli.mjs prints `hint: ` before it). */
export function delegateHint(chars) {
  if (!(chars > DELEGATE_FACTOR * OUTPUT_CAP)) return null;
  return `delegate: this expansion holds about ${Math.ceil(chars / 1000)}k characters, more than ${DELEGATE_FACTOR} times `
    + `the ${OUTPUT_CAP / 1000}k cap; hand it to a subagent with the skill's delegation template`;
}

/** expand may decompress a blob of `rawLen` bytes in one call only up to SIDECAR_WHOLE_MAX (*chosen*): the size the
 *  scale case measures the 1 GiB RSS bound at. B1 streams a larger sidecar into one blob; decompressed whole it
 *  would pass that bound, and past ~512 MiB Node's string limit. Such a blob prints one fixed line instead. */
export function expandBlobFits(rawLen) {
  return rawLen <= SIDECAR_WHOLE_MAX;
}

/** The file a tool_use named, by its id, from an assistant row's content (P17 dispatches the outline on its
 *  extension): `file_path` (Read, Edit, Write), `notebook_path`, then `path` (Grep, Glob). `found` tells the
 *  paired tool_use that names no file (a Bash call: the walk up the chain stops there) from no paired tool_use in
 *  this content (the walk goes on): two conditions, two answers. */
export function toolUseInputPath(content, toolUseId) {
  if (!Array.isArray(content)) return { found: false };
  for (const b of content) {
    if (b === null || typeof b !== 'object' || b.type !== 'tool_use' || b.id !== toolUseId) continue;
    const input = b.input;
    if (input === null || typeof input !== 'object') return { found: true, path: null };
    for (const k of ['file_path', 'notebook_path', 'path']) if (typeof input[k] === 'string' && input[k] !== '') return { found: true, path: input[k] };
    return { found: true, path: null };
  }
  return { found: false };
}

/** A stored row's RAW text as expand prints it: text blocks, `[tool_use <name>] <input as JSON>`, a tool_result's
 *  content bare (so the outline reads the tool's own output), `[<type>]` for any other block. Nothing is redacted
 *  here (spec §8.3 and §8.4; coordinator ruling R-display-window): recall.mjs shows every window of
 *  this text through redactDisplayWindow, whose escape readings separate a value that JSON rendering glued an escape
 *  letter onto, in a string leaf or in an object KEY, which a replacer over leaves never sees (review finding R38).
 *  Redacting each leaf here instead would cost a whole 16 MiB leaf per page (R36, R37). */
export function renderEntryText(body) {
  const json = (v) => JSON.stringify(v === undefined ? null : v) ?? 'null';
  const block = (b) => {
    if (typeof b === 'string') return b;
    if (b === null || typeof b !== 'object') return String(b);
    switch (b.type) {
      case 'text': return typeof b.text === 'string' ? b.text : '';
      case 'tool_use': return `[tool_use ${typeof b.name === 'string' ? b.name : ''}] ${json(b.input)}`;
      case 'tool_result':
        if (typeof b.content === 'string') return b.content;
        return Array.isArray(b.content) ? b.content.map(block).join('\n') : json(b.content);
      default: return `[${typeof b.type === 'string' ? b.type : 'block'}]`;
    }
  };
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  if (Array.isArray(body)) return body.map(block).join('\n');
  if (typeof body === 'object') return json(body);
  return String(body);
}

/** How much of a cut item an outline reads (*chosen*: 256 Ki characters, under EXPLORE_JSON_MAX): up to it the
 *  explorer reads redactDisplayWindow's window of the whole item, past it the outline is counts only. An outline's
 *  explorers read the whole text they are given, so without the bound one cut 64 MiB sidecar would be redacted
 *  whole for its outline (spec §8.3 and §8.4). */
export const EXPLORE_READ_MAX = 256 * 1024;

/** exploreCounts(stripReadPrefix(t)) in one pass with no split: a counts-only outline must cost the item's length, not
 *  a copy of it per line (a 64 MiB newline-dense sidecar split twice peaked at 2 GiB; spec §8.4's bound is 1 GiB).
 *  Stripping a Read prefix removes characters inside a line, never a newline, so the line count is the raw text's. */
function exploreCountsOnePass(t) {
  const prefix = /[^\S\n]*(\d+)(?:→|\t)/y;   // READ_PREFIX_RE at a line start; [^\S\n] is \s without crossing the line's end
  let stripped = 0;
  let prev = null;
  for (let at = 0; at <= t.length;) {
    prefix.lastIndex = at;
    const m = prefix.exec(t);
    if (m === null || (prev !== null && Number(m[1]) !== prev + 1)) break;
    prev = Number(m[1]);
    stripped += m[0].length;
    const nl = t.indexOf('\n', at);
    if (nl === -1) break;
    at = nl + 1;
  }
  let lines = 1;
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) lines += 1;
  return ['Structured summary:', `Characters: ${(t.length - stripped).toLocaleString('en-US')}.`,
    `Lines: ${lines.toLocaleString('en-US')}.`].join('\n');
}

/** A cut item's outline (§8.4, §11 P17): `explore` over the item's redacted window when the item is at most
 *  EXPLORE_READ_MAX characters, else Task 3's counts-only summary over the raw text, computed in one pass
 *  (exploreCountsOnePass; characters and lines: numbers, never content). The caller cuts the result to EXPLORE_CUT
 *  and CUT_TEXT_BUDGET. */
export function exploreOutline(text, kind, fileName, idx) {
  const t = String(text);
  if (t.length > EXPLORE_READ_MAX) return exploreCountsOnePass(t);
  return explore(redactDisplayWindow(t, 0, t.length, idx), kind, fileName);
}

// ── version-aware reads (W1-B2 Task 17) ─────────────────────────────────────────────────────────────────
// Spec §6.11 "The CLI keeps answering" (slug history-cli-reads-store-version): the CLI reads user_version first
// and builds its named-column queries for THAT version from SCHEMA_ADDED. A column the store lacks is selected
// as NULL (Task 10's selectColumns; a join reads a versioned() derived table in recall.mjs; a few v1-only reads — the scope's families and transcripts, eofOf, scopeHeader, tree's epochs, store.mjs's childrenOf/parentOf/LINEAGE_SQL and regex-worker.mjs — still name literal v1 columns, which every version keeps because migrations are additive), and a verb that cannot answer without a
// newer table answers exit 5 migration-pending. Migrations are additive only, so an older store's columns are
// always a subset (DM44); schemaAdditive is the test that refuses one that is not.

/** What every read verb reads before its own statements: the scope (sessions, epochs, transcripts and the entries
 *  that say a transcript holds rows), the header (ingest_files' end-of-file marks, derivation_state's recover step),
 *  and cli.mjs's context (the store id in meta, the redaction index's redact_hashes). They are an inventory, not a
 *  guard: cli.mjs's readContext reads meta, redact_hashes, sessions, epochs, transcripts and entries before any
 *  executor's pendingFor runs (a missing one answers store-read-failed), and emitResult reads the header again
 *  after it. A version that adds a table to this list must add its check to readContext (hardening item H-21). */
const READ_CONTEXT_TABLES = Object.freeze(['meta', 'redact_hashes', 'sessions', 'epochs', 'transcripts', 'entries', 'ingest_files', 'derivation_state']);

/** Every table each read verb's path reads (recall.mjs, the store.mjs functions it calls, and grep --regex's
 *  child, regex-worker.mjs): the shared context above plus the verb's own statements. All are v1 tables today;
 *  a version that adds a table a verb needs adds it here, in the same PR. blobs_fts is a virtual table the sweep
 *  creates, not a SCHEMA_ADDED one: grep's index gate answers its absence as fts-pending. */
export const VERB_TABLES = Object.freeze({
  grep: Object.freeze([...READ_CONTEXT_TABLES, 'blobs', 'entry_variants', 'sidecars', 'nodes', 'node_sources', 'node_children']),
  describe: Object.freeze([...READ_CONTEXT_TABLES, 'nodes', 'node_refs', 'node_sources', 'node_children', 'blobs', 'boundaries', 'memberships']),
  expand: Object.freeze([...READ_CONTEXT_TABLES, 'nodes', 'node_children', 'node_sources', 'blobs', 'entry_variants', 'sidecars', 'memberships']),
  tree: Object.freeze([...READ_CONTEXT_TABLES, 'nodes', 'node_children']),
});

/** The tables a store at `version` has: every SCHEMA_ADDED entry at or below it. A newer store has all this
 *  build knows. */
function tablesThrough(version, schema) {
  const have = new Set();
  for (const [v, entry] of Object.entries(schema)) if (Number(v) <= version) for (const t of Object.keys(entry.tables)) have.add(t);
  return have;
}

/** The tables `verb` needs that a store at `version` lacks; [] when it can answer. */
export function missingTablesAt(version, verb, schema = SCHEMA_ADDED, verbTables = VERB_TABLES) {
  if (!Object.hasOwn(verbTables, verb)) throw new TypeError(`missingTablesAt: ${JSON.stringify(verb)} is not a read verb`);
  const have = tablesThrough(version, schema);
  return verbTables[verb].filter((t) => !have.has(t));
}

/** Whether a SCHEMA_ADDED is additive only (slug history-schema-additive-measured, NEW). Its shape: versions
 *  1..N, each exactly {heavy, tables}, no column listed twice. Given `measured` (B1's schemaOf after each
 *  migration, by version), each version must build exactly what SCHEMA_ADDED declares up to it: a rename or a
 *  drop shows as a column `lost`, a column nothing declared as `undeclared`. */
export function schemaAdditive(schema, measured) {
  const lost = [];
  const versions = Object.keys(schema).map(Number).sort((a, b) => a - b);
  if (versions.some((v, i) => v !== i + 1)) lost.push('versions are not 1..N');
  const cum = new Map();
  const cumAt = new Map();
  for (const v of versions) {
    const entry = schema[v];
    // H-164: a declared version entry that is no object is named, never thrown on (Object.keys(null) is a TypeError).
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { lost.push(`v${v} is no object`); continue; }
    const keys = Object.keys(entry).sort();
    if (keys.join(',') !== 'heavy,tables' || typeof entry.heavy !== 'boolean') lost.push(`v${v} has keys ${keys.join(',')}`);
    for (const [t, cols] of Object.entries(entry.tables ?? {})) {
      if (!Array.isArray(cols)) { lost.push(`${t} at v${v} lists no array of columns`); continue; }
      const have = cum.get(t) ?? new Set();
      for (const c of cols) {
        if (have.has(c)) lost.push(`${t}.${c} re-listed at v${v}`);
        have.add(c);
      }
      cum.set(t, have);
    }
    cumAt.set(v, new Map([...cum].map(([t, set]) => [t, new Set(set)])));
  }
  for (const [vs, tables] of Object.entries(measured ?? {})) {
    const v = Number(vs);
    const want = cumAt.get(v);
    if (want === undefined) { lost.push(`v${v} measured but not declared`); continue; }
    // H-164: a measured version entry that is no table map is named, never thrown on (Object.entries(null) is a TypeError).
    if (tables === null || typeof tables !== 'object' || Array.isArray(tables)) { lost.push(`v${v} measured no table map`); continue; }
    // H-25: a measured column set that is no array is named FIRST; the lost loop then reads it as empty, so it never
    // throws on an object or matches a string by substring.
    for (const [t, cols] of Object.entries(tables)) if (!Array.isArray(cols)) lost.push(`${t} at v${v} lists no array of columns`);
    const listed = (t) => (Array.isArray(tables[t]) ? tables[t] : []);
    for (const [t, cols] of want) for (const c of cols) if (!listed(t).includes(c)) lost.push(`${t}.${c} lost at v${v}`);
    for (const [t, cols] of Object.entries(tables)) {
      if (!Array.isArray(cols)) continue;
      for (const c of cols) if (!(want.get(t)?.has(c) ?? false)) lost.push(`${t}.${c} undeclared at v${v}`);
    }
  }
  if (measured != null) {
    for (const v of versions) if (!Object.hasOwn(measured, String(v))) lost.push(`v${v} declared but not measured`);
  }
  return lost.length === 0 ? { ok: true } : { ok: false, lost };
}

// ── the operator door's pane read (W1-B2 Task 19) ──────────────────────────────────────────────────────────
/** Whether an --op form's gate needs the pane's tmux session name (§8.2, §8.4 speed bumps): only an irreversible
 *  WRITING_FORMS form needs it, and only from a pane id of PANE_RE's grammar. Both doors ask this ONE rule before
 *  their own bounded tmux read: B1's paneNameFor in the sweep, opPaneName in the CLI. */
export function paneReadWanted(form, pane) {
  return form !== null && Object.hasOwn(WRITING_FORMS, form) && WRITING_FORMS[form].irreversible === true
    && typeof pane === 'string' && PANE_RE.test(pane);
}

// ── doctor --repair's rebuild step (W1-B2 Task 23; spec §8.4, §9.1) ───────────────────────────────

/** derivation_state step of the resumable FTS rebuild (doctor --repair, and the recovery step's reindex phase);
 *  its version is the ms the job started. The sweep writes it; grep's index gate reads it, so grep answers
 *  7 fts-pending while one is open (history-grep-pending-until-backfilled). Spelled once, here. */
export const FTS_REBUILD_STEP = 'fts-rebuild';

// ── B1's health counters, re-measured after a cure (W1-B2 Task 23; D-4723 (history-counter-resets-after-cure)) ─────

/** How each of B1's HEALTH_COUNTERS counts, so a re-measure knows what it may write. `item`: each standing thing once
 *  (a blob, a set-aside file), so a standing count above the stored one raises it (a restored or rebuilt store lost
 *  the count). `pass`: every drain that meets the condition again, so only its cure writes. Spelled once, here. */
export const COUNTER_STANDING = Object.freeze({
  [HEALTH_COUNTERS.blobUndecodable]: 'item',
  [HEALTH_COUNTERS.drainRejected]: 'item',
  [HEALTH_COUNTERS.spoolDisplaced]: 'item',
  [HEALTH_COUNTERS.spoolBlocked]: 'pass',
  [HEALTH_COUNTERS.spoolUnreadable]: 'pass',
});

/** What a re-measure writes (D-4723 (history-counter-resets-after-cure)). For each name in `standing` (how many of what it
 *  counts stand now; null = unmeasured, never 0) against `counters[name]` (0 when absent): unmeasured writes nothing;
 *  0 resets a non-zero counter to 0, because the condition is cured; an `item` counter is raised to a larger standing
 *  count; anything else writes nothing (an item count is never lowered while any stands, and a `pass` count keeps its
 *  history while the condition stands, the next drain counting it again). A name outside COUNTER_STANDING, or a count
 *  that is not a non-negative integer, throws: no other counter is reset by a re-measure. */
export function decideCounterResets(counters, standing) {
  const writes = [];
  for (const [name, m] of Object.entries(standing)) {
    const kind = Object.hasOwn(COUNTER_STANDING, name) ? COUNTER_STANDING[name] : undefined;
    if (kind === undefined) throw new TypeError(`decideCounterResets: ${name} is not one of HEALTH_COUNTERS`);
    const have = Number(counters[name] ?? 0);
    if (m === null) continue;
    if (!Number.isSafeInteger(m) || m < 0) throw new TypeError(`decideCounterResets: ${name} measured ${String(m)}`);
    if (m === 0) { if (have !== 0) writes.push({ name, n: 0 }); continue; }
    if (kind === 'item' && m > have) writes.push({ name, n: m });
  }
  return writes;
}

// ── doctor --repair's integrity gate (W1-B2 Task 23 fix round 1; D-4591 (history-repair-heals-index-integrity-rows)) ──
/** An integrity_check row that names one of the store's own FTS5 tables: FTS5's xIntegrity (SQLite 3.44+) reports a
 *  damaged inverted index or data blob this way, and the repair's drop-and-rebuild replaces exactly those tables. */
const INDEX_DAMAGE_RE = /(?:\bFTS5 table main\.|\bfrom table ")(?:blobs_fts|nodes_fts)\b/;
/** What PRAGMA integrity_check's rows decide for doctor --repair: `ok` (exactly ['ok']); `index` when every row names
 *  blobs_fts or nodes_fts (the rebuild heals them, D-4591); `store` for anything else, a mix included (no index
 *  rebuild can fix it). Pure: the caller runs the pragma. */
export function decideIntegrity(rows) {
  if (rows.length === 1 && rows[0] === 'ok') return { verdict: 'ok', rows: [] };
  const bad = rows.filter((r) => r !== 'ok');
  if (bad.length > 0 && bad.every((r) => INDEX_DAMAGE_RE.test(r))) return { verdict: 'index', rows: bad };
  return { verdict: 'store', rows: bad.length > 0 ? bad : rows };
}

// ===========================================================================
// The card line (spec 2026-10-05 §8.6, §5.1, §5.2, §9.4; W1-B3 plan Tasks 1-3). Pure. The sweep's card.mjs (L4)
// measures the store, the registry and the history root's files and hands the facts in; the hook spells the
// grammar, the cap and the two directory names once more in bash, bound to these by single-definition.test.ts
// (W1-B3 Task 11). Every id that becomes a path passes idOk first, and every uuid UUID_RE
// (D-4170).
// ===========================================================================

/** `~/.ccrc/history/card/<id>/<uuid>.txt`: the sweep's one-line predictions (§5.2, §8.6). */
export const CARD_DIR = 'card';
/** `~/.ccrc/history/scope/<id>`: the PreCompact scope markers the hook writes (§5.1). */
export const SCOPE_DIR = 'scope';
/** The longest card line the hook serves, in characters: it reads 513 and refuses more than 512 (§8.6, C21), and
 *  the render reserves CARD_LINE_MAX + 1 (C38). The grammar's own longest line is 145 characters; the cap is the
 *  spec's and is not tightened here. D-4736 (history-card-fold-and-reserve) */
export const CARD_LINE_MAX = 512;
/** The command the card names, as the grammar spells it: the literal `~/.local/bin/ccrc`, which bash expands at the
 *  start of a word. B2's `next:` lines keep their own spelling, HISTORY_CMD. B2's D-4682 (history-skill-literal-path) */
export const CARD_DESCRIBE_CMD = '~/.local/bin/ccrc history describe';
/** The card line's one positive grammar (§8.6), character for character, built from CARD_PREFIX and
 *  CARD_DESCRIBE_CMD so neither is spelled twice. The ellipsis and the middle dot are U+2026 and U+00B7, written as
 *  themselves. */
export const CARD_LINE_PATTERN = `^${escapeRe(CARD_PREFIX)}node L[0-9a-f]{6,20}… \\(this compaction\\)( · parent N[0-9a-f]{6,20}…)? · ${escapeRe(CARD_DESCRIBE_CMD)} L[0-9a-f]{6,20}$`;
export const CARD_LINE_RE = new RegExp(CARD_LINE_PATTERN);
/** How long a purged session's scope marker and card directory stay (§9.4: "the files of purged sessions after
 *  7 days"). */
export const PURGED_FILES_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function cardIdOk(fn, id) {
  if (!idOk(id)) throw new TypeError(`${fn}: not a session id: ${JSON.stringify(id)}`);
}

/** `~/.ccrc/history/card/<id>`. The id passes idOk before the path exists (C66's shape). */
export function cardDirOf(home, id) {
  cardIdOk('cardDirOf', id);
  return `${historyPaths(home).root}/${CARD_DIR}/${id}`;
}

/** `~/.ccrc/history/card/<id>/<uuid>.txt`: one session's prediction, keyed on the uuid the hook reads as `psid`. */
export function cardFileOf(home, id, uuid) {
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid)) throw new TypeError(`cardFileOf: not a session uuid: ${JSON.stringify(uuid)}`);
  return `${cardDirOf(home, id)}/${uuid}.txt`;
}

/** `~/.ccrc/history/scope/<id>`: one session's PreCompact scope marker (§5.1). */
export function scopeMarkerOf(home, id) {
  cardIdOk('scopeMarkerOf', id);
  return `${historyPaths(home).root}/${SCOPE_DIR}/${id}`;
}

/** The card line for a leaf display prefix and, when one is named, a parent's (§8.6 Shape). Only a line the grammar
 *  takes is ever answered: a leaf that is not `L` plus 6 to 20 lowercase hex, a parent that is not `N` plus the
 *  same, or anything else the grammar refuses throws, so no caller can write a line the hook would refuse. */
export function cardLine({ leaf, parent = null }) {
  const line = `${CARD_PREFIX}node ${String(leaf)}… (this compaction)${parent === null ? '' : ` · parent ${String(parent)}…`} · ${CARD_DESCRIBE_CMD} ${String(leaf)}`;
  if (!CARD_LINE_RE.test(line)) throw new TypeError(`cardLine: not a card line: ${JSON.stringify(line)}`);
  return line;
}

/** The boundary the next compaction will write, as planSpans is shown it: a uuid no transcript row carries. */
const CARD_NEXT_BOUNDARY = 'card-prediction:next-boundary';

/** The span start of the leaf the next compaction of one copy will become (§6.1), taken from planSpans itself so
 *  the rule is never spelled twice: a copy of two rows, its last boundary (or, with none, its first stored row) and
 *  a synthetic next boundary. The answer is the last boundary's head, its own uuid when it has none, or the copy's
 *  first row; null for a copy with no rows. B2's D-4688 (history-span-per-boundary-copy) */
export function predictedSpanStart({ firstRowUuid, lastBoundary }) {
  const rows = [];
  const boundaries = [];
  if (lastBoundary !== null) {
    rows.push({ uuid: lastBoundary.uuid, pos: 0, isBoundary: true, isSummary: false });
    boundaries.push({ uuid: lastBoundary.uuid, headUuid: lastBoundary.headUuid, kept: new Set(), summaryUuid: null });
  } else if (firstRowUuid !== null) {
    rows.push({ uuid: firstRowUuid, pos: 0, isBoundary: false, isSummary: false });
  } else {
    return null;
  }
  rows.push({ uuid: CARD_NEXT_BOUNDARY, pos: 1, isBoundary: true, isSummary: false });
  boundaries.push({ uuid: CARD_NEXT_BOUNDARY, headUuid: null, kept: new Set(), summaryUuid: null });
  const next = planSpans({ rows, boundaries }).leaves.find((l) => l.boundaryUuid === CARD_NEXT_BOUNDARY);
  return next === undefined ? null : next.spanStartUuid;
}

const isNodeIdOf = (kind, id) => typeof id === 'string' && HISTORY_NODE_ID_RE.test(id) && id[0] === kind;

/** What the card for one session's next compaction says (§8.6), or why there is none. The sweep measures the inputs
 *  over the copy the next boundary will be written to, within the epoch and family that copy's transcript belongs to.
 *  - No confirmed, unmerged epoch of this id names the uuid (`ccrcId` null): skip `no-epoch`.
 *  - The copy holds no row: skip `no-rows`.
 *  - The plain id is already bound to another boundary: decideLeafId would qualify this leaf with a boundary uuid that
 *    does not exist yet, so no line can name it: skip `fork-qualified` (B2's D-4689 (history-leaf-id-fork-qualified)). The skip
 *    carries that plain id, so decideCardFile can still count a prediction the boundary before it consumed.
 *  - Otherwise the leaf is the plain id. Its parent is the depth-1 parent planFanIn groups it into when it is the 8th
 *    final, unparented slot of this copy's run (`predicted`, parentId over that group: grouping starts at the first
 *    unparented slot and stops at a slot not yet final, RB4); else the epoch's newest condensed node when that is a
 *    well-formed N id (`newest-condensed`); else none.
 *  Both print as displayPrefixes over the family's node ids and themselves: at least NODE_ID_DISPLAY_MIN hex digits,
 *  unique within the family the reader's default scope is (RB2). */
export function planCardPrediction(i) {
  if (i.ccrcId === null) return { act: 'skip', reason: 'no-epoch' };
  const start = predictedSpanStart(i);
  if (start === null) return { act: 'skip', reason: 'no-rows' };
  const d = decideLeafId({
    ccrcId: i.ccrcId, ccUuid: i.ccUuid, spanStartUuid: start, boundaryUuid: CARD_NEXT_BOUNDARY, plainBoundOther: i.plainBoundOther,
  });
  if (d.forked) return { act: 'skip', reason: 'fork-qualified', plainLeafId: leafId(i.ccrcId, i.ccUuid, start) };
  const leaf = d.id;
  const slots = [
    ...i.slots.map((x) => ({ nodeId: x.nodeId, final: x.nodeId !== null, parented: x.parented })),
    { nodeId: leaf, final: true, parented: false },
  ];
  const group = planFanIn({ slots, width: FAN_IN.leaf }).find((g) => g.includes(leaf));
  let parent = null;
  let parentKind = null;
  if (group !== undefined) {
    parent = parentId(group);
    parentKind = 'predicted';
  } else if (isNodeIdOf('N', i.newestCondensed)) {
    parent = i.newestCondensed;
    parentKind = 'newest-condensed';
  }
  const shown = displayPrefixes([...i.familyIds, leaf, ...(parent === null ? [] : [parent])]);
  return {
    act: 'write', line: cardLine({ leaf: shown.get(leaf), parent: parent === null ? null : shown.get(parent) }),
    leafId: leaf, parentId: parent, parentKind,
  };
}

const CARD_LEAF_RE = new RegExp(`^${escapeRe(CARD_PREFIX)}node (L[0-9a-f]{6,20})…`);

/** The leaf display prefix a grammar-valid card line names, or null for any other text. */
function cardLeafOf(text) {
  return CARD_LINE_RE.test(text) ? CARD_LEAF_RE.exec(text)[1] : null;
}

/** What to do with one session's card file (§8.6 Timing). `current` is the file as read: absent, unreadable, or its
 *  text (one trailing LF is the writer's and is not part of the line). A new line is written only at end-of-file; a
 *  file whose leaf the prediction no longer names was CONSUMED by the boundary ingested since, and goes off
 *  end-of-file rather than wait; a file that is no card line, or cannot be read, is replaced at end-of-file and
 *  removed otherwise; a skip removes any file. A fork skip names the plain id the next leaf would have had, so a
 *  file whose leaf no longer prefixes it was consumed too, and is counted (W1-e's denominator,
 *  D-4738 (history-card-consumed-counter)); a no-epoch or no-rows skip names no leaf and counts nothing.
 *    absent                      → write at end-of-file, else none;
 *    the same line               → keep;
 *    the same leaf, re-rendered  → write at end-of-file, else keep (its parent or prefix moved, the leaf did not);
 *    another leaf                → consumed: write at end-of-file, else delete;
 *    no card line, unreadable    → write at end-of-file, else delete;
 *    a skip                      → delete; consumed when it is a fork skip whose plain id the file's leaf no
 *                                  longer prefixes. */
export function decideCardFile({ current, prediction, atEof }) {
  const present = current.state !== 'absent';
  const text = current.state === 'value' ? current.value.replace(/\n$/, '') : null;
  const was = text === null ? null : cardLeafOf(text);
  if (prediction.act !== 'write') {
    const moved = was !== null && typeof prediction.plainLeafId === 'string' && !prediction.plainLeafId.startsWith(was);
    return { act: present ? 'delete' : 'none', consumed: moved };
  }
  if (!present) return { act: atEof ? 'write' : 'none', consumed: false };
  if (text === prediction.line) return { act: 'keep', consumed: false };
  if (was === null) return { act: atEof ? 'write' : 'delete', consumed: false };
  if (!prediction.leafId.startsWith(was)) return { act: atEof ? 'write' : 'delete', consumed: true };
  return { act: atEof ? 'write' : 'keep', consumed: false };
}

/** The generation record beside a prediction, `card/<id>/<uuid>.gen` (spec §9.7, §8.2, C68; coordinator ruling
 *  R-recalloff-parity). The hook cannot read the store: when neither CCRC_SESSION_GENERATION nor $REG/<id>.generation
 *  resolves a generation, it compares recall-off/<id> with this record, which holds the generation B2's CLI resolves
 *  then (the id's newest family's: '' for a legacy family or none), and with no usable record it withholds the line.
 *  `card` is decideCardFile's act and `mayWrite` the write gate decideCardFile was given (end-of-file and budget).
 *  The record's text is the generation and one LF.
 *    a prediction stands (write or keep), the record equal      → keep;
 *    it stands, the record absent, another or unreadable       → write when a write is allowed, else delete (none
 *                                                                 when absent): never a stale record (fail closed);
 *    no prediction stands (delete or none)                      → none: the hook reads the record only beside one. */
export function decideCardGenFile({ current, generation, card, mayWrite }) {
  if (card !== 'write' && card !== 'keep') return 'none';
  if (current.state === 'value' && current.value === `${generation}\n`) return 'keep';
  if (mayWrite) return 'write';
  return current.state === 'absent' ? 'none' : 'delete';
}

/** `~/.ccrc/history/card/<id>/<uuid>.gen`: the generation record the sweep writes beside a session's prediction (see
 *  decideCardGenFile). Checked like cardFileOf (id by idOk, uuid by UUID_RE, before any path is formed), so the
 *  record's name is spelled once, here. D-5049 (history-card-gen-path-helper) */
export function cardGenFileOf(home, id, uuid) {
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid)) throw new TypeError(`cardGenFileOf: not a session uuid: ${JSON.stringify(uuid)}`);
  return `${cardDirOf(home, id)}/${uuid}.gen`;
}

/** The rows after a boundary, in its holding copy, that the delivery measure reads for the SessionStart attachment
 *  (chosen: RV17 found it within 40 rows of the boundary for 75 of 75 boundaries, M). D-4739 (history-card-measure-window) */
export const CARD_MEASURE_ROWS = 40;
/** How long after its leaf was derived a delivery window may stay open (chosen). A copy that stops being read (its
 *  home left the roster, its file unreadable) never closes its window any other way, and the measure's cursor waits
 *  on the oldest open window. */
export const CARD_MEASURE_MAX_WAIT_MS = 24 * 60 * 60 * 1000;
/** The largest attachment body the delivery measure decodes, by the blob's stored `raw_len` (the bytes of its JSON;
 *  chosen). The hook clips its whole SessionStart output at CARD_TOTAL_MAX_CHARS characters, a few bytes each once
 *  JSON-escaped, so a SessionStart attachment stays far below this even beside other hooks' context. A larger body,
 *  such as a re-attached file of many MiB, is skipped unread rather than decompressed only to read its `type`.
 *  D-4739 (history-card-measure-window) */
export const CARD_ATTACHMENT_MAX_BYTES = 1024 * 1024;

const CARD_ID_IN_TEXT_RE = new RegExp(`${escapeRe(CARD_PREFIX)}node (L[0-9a-f]{6,20})(?![0-9A-Za-z])`, 'g');

/** The leaf display prefixes a SessionStart attachment names (§8.6 RV17): every `History: node L…` in the string
 *  leaves of a `hook_additional_context` attachment, wherever it sits in a string, because `_hook_emit_context` joins
 *  the standing cards and the compact subject with one space. Any other attachment type, or a value that is not an
 *  object, names none. Sorted, each once. */
export function cardIdsIn(attachment) {
  if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) return [];
  if (attachment.type !== 'hook_additional_context') return [];
  const ids = new Set();
  const stack = [attachment];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') {
      for (const m of v.matchAll(CARD_ID_IN_TEXT_RE)) ids.add(m[1]);
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else if (v !== null && typeof v === 'object') {
      for (const x of Object.values(v)) stack.push(x);
    }
  }
  return [...ids].sort();
}

/** Whether a leaf's delivery window is closed, so no History line can still arrive in it: CARD_MEASURE_ROWS rows read
 *  after its boundary; the next boundary of its copy reached; its copy read to the end at least RAW_LEAF_GRACE_MS
 *  after the boundary (`eofAfter`, lib eofAfterBoundary); its copy no longer live (gone, retired, exported, or none);
 *  or CARD_MEASURE_MAX_WAIT_MS since the leaf was derived. D-4739 (history-card-measure-window) */
export function cardWindowComplete({ live, rowsSeen, nextBoundary, eofAfter, waitedMs }) {
  return !live || nextBoundary || rowsSeen >= CARD_MEASURE_ROWS || eofAfter || waitedMs >= CARD_MEASURE_MAX_WAIT_MS;
}

/** One leaf's delivery (§8.6, W1-e): `served` when a History line in its window names a prefix of it; `mismatch`
 *  when History lines there name only other leaves (a stale or a mispredicted card); `none` when the window closed
 *  with no History line; `wait` while it is open. D-4737 (history-card-measured-from-transcript) */
export function decideCardDelivery({ ids, leafId, windowComplete }) {
  if (ids.some((p) => leafId.startsWith(p))) return 'served';
  if (ids.length > 0) return 'mismatch';
  return windowComplete ? 'none' : 'wait';
}

/** A purged session's scope marker or card directory (§9.4): removed once the registry no longer names the session
 *  (`$REG/<id>.uuid` absent) and its newest write is more than PURGED_FILES_GRACE_MS old. A registry entry that
 *  could not be measured is never read as absent, and an entry with no measured time is kept. */
export function decidePurgedEntry({ reg, newestMtimeMs, nowMs }) {
  if (reg !== 'absent' || newestMtimeMs === null) return 'keep';
  return nowMs - newestMtimeMs > PURGED_FILES_GRACE_MS ? 'remove' : 'keep';
}

// ── The consumption's scope (ruling RC3) ───────────────────────────────────────────────────────────────────────────
/** How long a PreCompact scope marker speaks for the compaction it was written at, in ms: the hook's
 *  COMPACT_CARD_MAX_AGE (1200 s), the age within which its reader serves a `main` marker (§8.6). The hook cannot
 *  import lib, so single-definition.test.ts binds the two (W1-B3 Task 11). D-4738 (history-card-consumed-counter) */
export const SCOPE_MARKER_MAX_AGE_MS = 1200 * 1000;
/** The words a consumption is counted under, `card_consumed:<word>`. W1-e's served share is over `main` and
 *  `unknown`; `other` is reported beside it (ruling RC3). */
export const CARD_CONSUMED_SCOPES = Object.freeze(['main', 'other', 'unknown']);
/** The scope words the hook writes into a marker (§5.1: `_hook_compact_scope`'s verdicts). */
const SCOPE_MARKER_WORDS = Object.freeze(['main', 'subagent', 'ambiguous']);

/** A marker's one line, `<scope> <uuid> <ms>` (one trailing LF is the hook's), or null for any other text. The uuid
 *  is compared with the consumed file's own, which passed UUID_RE before it became a path, so it needs no grammar
 *  of its own here. */
function parseScopeMarker(text) {
  const m = /^([a-z]+) (\S+) ([1-9][0-9]{0,15})$/.exec(text.replace(/\n$/, ''));
  if (m === null || !SCOPE_MARKER_WORDS.includes(m[1])) return null;
  return { scope: m[1], uuid: m[2], ms: Number(m[3]) };
}

/** The time of the boundary that consumed a card file (ruling RC3): of one copy's boundaries, in order, the one
 *  whose leaf, by the span rule (predictedSpanStart over the boundary before it, or the copy's first row for the
 *  first), the file's printed leaf prefixes. Walked newest first, where the consuming boundary almost always is. Its
 *  `tsMs`, or null when the file prints no card line or no boundary there matches. A null `ccrcId` (no epoch names
 *  the session) answers null before any hash: no epoch means no consumed boundary, and decideConsumedScope then
 *  folds a null time to `unknown` (RC3). D-5050 (history-card-consumed-ts-no-epoch) */
export function consumedBoundaryTs({ current, ccrcId, ccUuid, firstRowUuid, boundaries }) {
  const was = current.state === 'value' ? cardLeafOf(current.value.replace(/\n$/, '')) : null;
  // D-5050: leafId hashes every part and a null ccrcId would throw, so a session with no epoch answers null here.
  if (was === null || ccrcId === null) return null;
  for (let k = boundaries.length - 1; k >= 0; k -= 1) {
    const start = predictedSpanStart({ firstRowUuid, lastBoundary: k === 0 ? null : boundaries[k - 1] });
    if (start !== null && leafId(ccrcId, ccUuid, start).startsWith(was)) return boundaries[k].tsMs;
  }
  return null;
}

/** The scope a consumed prediction is counted under (W1-e's denominator, ruling RC3). `marker` is scope/<id> as
 *  read: absent, unreadable, or its text. `uuid` is the consumed file's, and `boundaryTsMs` the consumed boundary's
 *  time, null when it is not known:
 *    main     the marker reads `main <uuid> <ms>`, its ms not after the boundary and within SCOPE_MARKER_MAX_AGE_MS of
 *             it: the hook scoped THIS compaction main, so a line was due;
 *    other    it reads `subagent` or `ambiguous` for this uuid in the same window: no line was ever due;
 *    unknown  anything else: no marker, unreadable, emptied, another uuid, or a ms outside the window (overwritten by a
 *             later PreCompact, or older than this compaction). Unknown stays in W1-e's denominator, so it can only
 *             lower the served share. D-4738 (history-card-consumed-counter) */
export function decideConsumedScope({ marker, uuid, boundaryTsMs }) {
  if (marker.state !== 'value') return 'unknown';
  const m = parseScopeMarker(marker.value);
  if (m === null || m.uuid !== uuid) return 'unknown';
  const age = boundaryTsMs === null ? null : boundaryTsMs - m.ms;
  // D-5051 (history-scope-age-at-most): a marker exactly SCOPE_MARKER_MAX_AGE_MS old still serves (spec 8.6 says "younger than").
  if (age === null || age < 0 || age > SCOPE_MARKER_MAX_AGE_MS) return 'unknown';
  return m.scope === 'main' ? 'main' : 'other';
}

// ── The withdrawal (ruling RC2: fail closed) ───────────────────────────────────────────────────────────────────────
/** The words a withdrawal is counted under, `card_withdrawn:<word>`: one per way a scheduled pass can run without a
 *  card step over a caught-up ingest, and one, `copy-skipped`, that is a per-session withdrawal on a pass whose card
 *  step ran and kept the rest (D-5061). */
export const CARD_WITHDRAW_REASONS = Object.freeze([
  'at-cap', 'low-disk', 'floor-stop', 'roster-unreadable', 'budget', 'recovering', 'migrating', 'held', 'unreachable',
  'refused', 'unbound', 'copy-skipped',
]);

const withdrawFor = (reason) => ({ act: 'withdraw', reason });

/** Whether a scheduled pass withdraws every card prediction, and under which word (ruling RC2: fail closed). A
 *  prediction is consumed only by a card step that sees the boundary that consumed it. So a pass that runs none, or
 *  whose ingest may have stopped short of that boundary, withdraws them all rather than leave a stale line for the
 *  next compaction (the one exception in kind is the `copy` arm, which withdraws one session's and keeps the rest):
 *    hold     `store-unbound` → unbound; `store-unreachable` → unreachable; any other word passOutcome answers with
 *             EXIT.DB (a refusal that waits on the operator) → refused; the rest (held, a migration held for room or
 *             time) → held;
 *    migrate  → migrating;   recover → recovering;
 *    run      a cap or floor pause → its own word (at-cap, low-disk); the per-chunk floor stopped the ingest →
 *             floor-stop; no ingest ran (an unreadable roster) → roster-unreadable; the run's budget spent before the
 *             card step → budget (the step still consumes and deletes; it only writes nothing); otherwise keep;
 *    copy     one session's prediction, on a pass that kept the rest: its uuid among the transcript copies the ingest
 *             could not read, admission refused or whose parse crashed this pass → copy-skipped (that copy may hold the boundary that
 *             consumes the standing line, and the pass cannot see it); any other uuid keep. D-5061
 *             (history-card-withdraw-on-a-skipped-copy)
 *  A pass that never reaches this (history-off, a server box, a pass no timer starts) withdraws nothing. The hook
 *  serves no line under the first two only WHILE the switch stands (history-off, or a box with no store): a
 *  prediction written before history-off survives it, and is served again once the switch is removed, until the id's
 *  next ingest consumes or replaces it. D-5062 (history-card-served-after-history-off) D-4740
 *  (history-card-withdrawn-when-not-ticking) */
export function decideCardWithdraw(p) {
  if (p.arm === 'hold') {
    if (p.word === 'store-unbound') return withdrawFor('unbound');
    if (p.word === 'store-unreachable') return withdrawFor('unreachable');
    return withdrawFor(passOutcome(p.word).exit === EXIT.DB ? 'refused' : 'held');
  }
  if (p.arm === 'migrate') return withdrawFor('migrating');
  if (p.arm === 'recover') return withdrawFor('recovering');
  if (p.arm === 'copy') return p.skipped.includes(p.uuid) ? withdrawFor('copy-skipped') : { act: 'keep' };
  if (p.arm !== 'run') throw new TypeError(`decideCardWithdraw: not a pass arm: ${JSON.stringify(p.arm)}`);
  if (p.pause === 'at-cap' || p.pause === 'low-disk') return withdrawFor(p.pause);
  if (p.floorStop) return withdrawFor('floor-stop');
  if (!p.ingested) return withdrawFor('roster-unreadable');
  if (!p.budgetLeft) return withdrawFor('budget');
  return { act: 'keep' };
}

// ===========================================================================
// The sole-copy export's decisions (spec §9.15 "The pass": Preflight, Write;
// §9.3 the floor; §6.2 ingest_files.source_key; W1-B4 Task 1). Pure: the sweep
// measures the export filesystem, lists export/<store_id>/ and reads meta, and
// passes what it saw; every verdict on those facts is taken here.
// D-4754 (history-sole-copy-export) D-4226
// B2's D-4695 (history-backup-preflight-and-rename) D-4179
// D-4755 (history-export-cadence-from-first-tick)
// ===========================================================================

/** A published segment's name (§9.15 "Write"): `<seq>.<writer>.db`, seq a positive decimal with no leading zero
 *  and at most 16 digits (then a safe integer), writer the binding's 8-hex token (WRITER_RE's grammar). */
const SEGMENT_NAME_RE = /^([1-9][0-9]{0,15})\.([0-9a-f]{8})\.db$/;

/** The name segment `seq` of `writer` is published under. A part off its grammar is a caller's bug and throws: no
 *  file name is ever formed from an unchecked part. */
export function segmentName({ seq, writer }) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError(`segmentName: seq must be a positive safe integer, got ${String(seq)}`);
  if (typeof writer !== 'string' || !WRITER_RE.test(writer)) throw new TypeError(`segmentName: writer must be 8 lowercase hex, got ${JSON.stringify(writer)}`);
  return `${seq}.${writer}.db`;
}

/** A segment name back to its parts, or null when it is not one: a temp, a stray file, a seq with a leading zero
 *  or past the safe integers. */
export function parseSegmentName(name) {
  if (typeof name !== 'string') return null;
  const m = SEGMENT_NAME_RE.exec(name);
  if (m === null) return null;
  const seq = Number(m[1]);
  return Number.isSafeInteger(seq) ? { seq, writer: m[2] } : null;
}

/** The temp a segment is built in before its link (§9.15: `.<seq>.<writer>.db.tmp`), a dot-name beside it, so it is
 *  never a published name. Only a segment name has one. */
export function segmentTempName(name) {
  if (parseSegmentName(name) === null) throw new TypeError(`segmentTempName: not a segment name: ${JSON.stringify(name)}`);
  return `.${name}.tmp`;
}

/** Segment names in the order replay applies them (§9.14 "Export replay": `(seq, writer)`): seq numerically, then
 *  the writer token in code-unit order, never the names' own lexical order (`10.…` before `9.…`). A name that is
 *  not a segment's is dropped. */
export function orderSegmentNames(names) {
  const parsed = [];
  for (const n of names) {
    const p = parseSegmentName(n);
    if (p !== null) parsed.push({ n, ...p });
  }
  parsed.sort((a, b) => a.seq - b.seq || (a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0));
  return parsed.map((p) => p.n);
}

/** The next segment number (§9.15 "Write"): one past the highest seq on disk under export/<store_id>/, of any
 *  writer, and past the one meta last recorded, so a restored or rebuilt store whose counter is behind, or a
 *  directory carried in from another box, never has a number reused. A recorded value that is not a positive safe
 *  integer was not recorded. */
export function nextSegmentSeq({ onDisk, recorded }) {
  let top = Number.isSafeInteger(recorded) && recorded > 0 ? recorded : 0;
  for (const s of onDisk) if (s > top) top = s;
  return top + 1;
}

/** Whether this tick runs the export pass (§9.15 "The pass": at most once an hour, chosen). The clock runs from the
 *  later of the last pass and the attempt clock (below) or, before either, from the store's first tick (D-4755
 *  (history-export-cadence-from-first-tick)): a new store writes no segment in its first hour. This is the cadence's
 *  clock alone: doctor's last-pass rule reads the last completed pass only (`lastPassMs`, which an attempt never moves),
 *  and never the attempt clock or the first tick, so the two no longer read one clock. A clock that
 *  went backwards (a last pass or first tick after now) runs the pass rather than wait for the clock to catch up:
 *  an early segment costs nothing, a late one widens the window in which the store is the only copy
 *  (D-4756 (history-export-cadence-clock-backwards)). No clock at all waits: the tick that asks has recorded its own
 *  ticks row, so the next tick has one. `intervalMs` is exportPassIntervalMs' answer: an hour, or longer after
 *  passes that published and could not mark (D-4757 (history-export-mark-failure-backs-off)).
 *  `lastAttemptMs` is the clock of a pass that failed with a caught error, or that the run's budget held before it wrote
 *  a segment (budgetHeldPass; D-5394 (history-export-select-due-transcripts)): it counts as a pass for the wait, so such a pass
 *  retries hourly, never every tick, while `lastPassMs` (doctor's last-pass clock) does not move. A completed pass deletes it. Which of the two clocks governs
 *  is this function's decision (RD2): the later one, a null being absent, so an attempt after the last pass keeps the wait
 *  running from the attempt, and a pass after the last attempt from the pass. Omitted, it is null, and the answers are exactly
 *  those of the pass clock alone. */
export function decideExportPass({ nowMs, lastPassMs, firstTickMs, lastAttemptMs = null, intervalMs = EXPORT_PASS_INTERVAL_MS }) {
  const last = lastPassMs === null ? lastAttemptMs : lastAttemptMs === null ? lastPassMs : Math.max(lastPassMs, lastAttemptMs);
  const since = last ?? firstTickMs;
  if (since === null) return 'wait';
  const age = nowMs - since;
  return age < 0 || age >= intervalMs ? 'run' : 'wait';
}

/** The longest the export waits between passes, however many passes in a row failed to mark (chosen: a day). */
export const EXPORT_MARK_BACKOFF_MAX_MS = 24 * EXPORT_PASS_INTERVAL_MS;

/** The export's interval after `markFails` passes in a row that published their segment and then failed to mark it
 *  (§9.15 "Mark"; Task 7 counts them in meta). Such a pass leaves its rows unmarked, so the next one publishes them
 *  again; while the store's own volume refuses the marks, an hourly retry would publish a copy every hour until the
 *  home filesystem's floor. The interval doubles per failure (1 h, 2 h, 4 h, …), at most EXPORT_MARK_BACKOFF_MAX_MS,
 *  and a count that is not a positive safe integer is no failure (D-4757 (history-export-mark-failure-backs-off)). */
export function exportPassIntervalMs(markFails) {
  const n = Number.isSafeInteger(markFails) && markFails > 0 ? Math.min(markFails, 5) : 0;
  return Math.min(EXPORT_PASS_INTERVAL_MS * 2 ** n, EXPORT_MARK_BACKOFF_MAX_MS);
}

/** The export's room verdict (§9.15 "Preflight"; rev 3.1 review, RC9). `free` is the sweep's statfsWithDeadline
 *  answer for ~/.ccrc/history/export, judged by planCopy with THAT filesystem's own threshold (§9.3's formula,
 *  floorThreshold) and the segment bound as the copy's size, so one segment can never take the home filesystem
 *  below its floor. A probe that threw is `low-disk`, as the store's own floor reads one (§9.10); a probe that never
 *  answered is `unsettled`, kept apart so the pass can say which. */
export function planExportRoom(free) {
  if (free.state === 'unsettled') return { admit: false, word: 'unsettled', needBytes: null };
  if (free.state !== 'ok') return { admit: false, word: 'low-disk', needBytes: null };
  const r = planCopy({ freeBytes: free.bytes, thresholdBytes: floorThreshold(free.fsSize), sizeBytes: EXPORT_SEGMENT_MAX_BYTES });
  return { admit: r.admit, word: r.admit ? 'ok' : 'low-disk', needBytes: r.needBytes };
}

const EXPORT_DECIMAL_RE = /^(0|[1-9][0-9]*)$/;

/** dev or ino in decimal: a number, a BigInt (statSync's `bigint: true`, past 2^53) or the decimal text of one. */
function exportDecimal(v, what) {
  if (typeof v === 'bigint' && v >= 0n) return v.toString();
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && EXPORT_DECIMAL_RE.test(v)) return v;
  throw new TypeError(`exportedSourceKey: ${what} must be a non-negative integer, got ${String(v)}`);
}

/** The source_key of the dead-file ingest_files row export replay puts a gone file's memberships on (§6.2; §9.15
 *  "Memberships of a gone file"): `exported:` plus hex(sha256(path ∖0 dev ∖0 ino)). It never equals a live row's
 *  key (''), so replay never lands on a live file, even one that now reuses that inode. dev and ino are rendered in
 *  decimal, so a BigInt past 2^53 keys exactly as the store holds it. A path holding a NUL could forge a separator,
 *  and no POSIX path holds one, so it throws. An empty path is a file the store knows no path for AND no source_key: it keys
 *  by (dev, ino) alone, and is still never a live key. It is NOT unique per (dev, ino) once generations accumulate: B1 retires
 *  a row exactly when a new file reuses its inode, so two retired generations of one inode would share this key. A file with
 *  no path left therefore exports with its store source_key as its path (B1's 'retired:<hex>', unique per generation), and
 *  '' is left to a row with neither (D-5393 (history-export-pathless-file-identity)). */
export function exportedSourceKey(path, dev, ino) {
  if (typeof path !== 'string' || path.includes('\0')) throw new TypeError(`exportedSourceKey: path must be a string without NUL, got ${JSON.stringify(path)}`);
  return `exported:${sha256Hex(`${path}\0${exportDecimal(dev, 'dev')}\0${exportDecimal(ino, 'ino')}`)}`;
}

/** The exact form of a dead-file source_key: `exported:` and 64 lowercase hex digits. */
const DEAD_FILE_KEY_RE = /^exported:[0-9a-f]{64}$/;

/** The source_key replay gives the dead-file row of the file a segment names by (path, dev, ino), the ONE rule the
 *  exporter's path and replay's key share (D-5393 (history-export-pathless-file-identity)). A carried path already of the
 *  exact form `exported:<64 lowercase hex>` IS a dead-file key: a replayed row exported again travels under its own
 *  source_key as its path, and keying that token through exportedSourceKey would give the one file a second row beside
 *  the one its older segment made. Every real path starts with '/', so none can match it. Any other path keys through
 *  exportedSourceKey, a near-miss included (63 digits, an uppercase digit, a trailing character). dev and ino are checked
 *  either way, so a malformed pair throws the same TypeError on both arms. */
export function deadFileSourceKey(path, dev, ino) {
  if (typeof path === 'string' && DEAD_FILE_KEY_RE.test(path)) {
    exportDecimal(dev, 'dev');
    exportDecimal(ino, 'ino');
    return path;
  }
  return exportedSourceKey(path, dev, ino);
}

// ── The marks' two decisions (§9.15 "Mark", "After a bind"; coordinator ruling RD2: L4 delivery is not allowed to
// decide). The sweep measures meta, the directory listing and the marked names, calls these and acts on the answer.
// D-4757 (history-export-mark-failure-backs-off) D-4226

/** The text meta export_mark_fails holds when it is a count: a decimal with no sign and no leading zero. */
const EXPORT_MARK_FAILS_RE = /^(0|[1-9][0-9]{0,15})$/;

/** The count meta export_mark_fails holds (Task 7 writes it), as the backoff reads it. Absent, torn or hand-edited
 *  text, or a number past the safe integers, is no failure: the export never waits longer on a value it cannot read. */
export function exportMarkFailsOf(recorded) {
  if (typeof recorded !== 'string' || !EXPORT_MARK_FAILS_RE.test(recorded)) return 0;
  const n = Number(recorded);
  return Number.isSafeInteger(n) ? n : 0;
}

/** What one pass's outcome does to the mark-failure backoff (D-4757 (history-export-mark-failure-backs-off)): whether the
 *  pass backs off, and the next wait. `outcome` is what the sweep saw: 'mark-failed' (its segment was linked, then the
 *  marks threw), 'marked' (the marks committed), 'mark-busy' (linked, then SQLITE_BUSY: the write lock's, not the
 *  volume's, so no backoff; RD3) or 'write-failed' (a throw before any link: nothing was published). `recorded` is
 *  meta export_mark_fails as read. Answers the count that stands, the meta text to write (null: leave meta as it is;
 *  a marked pass writes '0' only over another value, so a store that never failed a mark gains no key) and the wait
 *  the cadence then applies. Any other outcome is a caller's bug and throws. */
export function decideMarkOutcome({ outcome, recorded }) {
  const prev = exportMarkFailsOf(recorded);
  let markFails;
  let write = null;
  switch (outcome) {
    case 'mark-failed': markFails = prev + 1; write = String(markFails); break;
    case 'marked': markFails = 0; if (recorded !== null && recorded !== '0') write = '0'; break;
    case 'mark-busy':
    case 'write-failed': markFails = prev; break;
    default: throw new TypeError(`decideMarkOutcome: not an export outcome: ${JSON.stringify(outcome)}`);
  }
  return { markFails, write, intervalMs: exportPassIntervalMs(markFails) };
}

/** A bind fact's meta key: `bound:<ms>`, as B2's insertBindFacts writes one inside every adopt, restore and rebuild. */
const BIND_FACT_RE = /^bound:[0-9]{1,16}$/;

/** Whether this step checks the export's marks against the segments on this box (§9.15 "After a bind"), and what
 *  that check records as covered. `metaKeys` are the store's meta keys that may be bind facts; `checkedRecord` is what
 *  the last check recorded (a JSON list of keys) or null. A step checks when a bind fact exists that the record does
 *  not hold: by KEY, never by comparing a bind's clock with the check's, because the two may be two boxes' clocks (an
 *  adopt) or one clock either side of a step back. A record that does not parse, or is not a list, covers nothing, so
 *  the check runs rather than miss a bind. `record` is every fact this check covers, sorted, as the check writes it. */
export function decideMarkCheck({ metaKeys, checkedRecord }) {
  const facts = metaKeys.filter((k) => typeof k === 'string' && BIND_FACT_RE.test(k)).sort();
  let parsed;
  try { parsed = JSON.parse(checkedRecord ?? '[]'); } catch { parsed = []; }
  const have = new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  return { check: facts.some((k) => !have.has(k)), facts, record: JSON.stringify(facts) };
}

/** The segment names the store's marks give that export/<store_id>/ on this box does not hold, once each, sorted:
 *  their marks are cleared so their rows export again (§9.15 "After a bind"). `named` and `present` are the sweep's
 *  measurements: the marks' DISTINCT exported_seg values and listSegments' names. */
export function missingSegmentNames({ named, present }) {
  const here = new Set(present);
  return [...new Set(named)].filter((n) => !here.has(n)).sort();
}

/** Whether an entry may hold its export mark, from the states of the blobs it references as the store holds them now
 *  (D-5395 (history-export-mark-needs-its-blobs)): an entry references its own blob, its variants' blobs, its linked
 *  sidecars' blobs and its boundary's kept blob. It keeps its mark only while every one of them is `exported` (some
 *  segment holds its bytes) or `pruned` (a tombstone: a stub is all there is to export). A referenced blob that is
 *  neither is live and unmarked: its text is store-only, and a marked entry hides it from the pass, which offers only
 *  unmarked entries, so the census counts the blob due for good. The ingest asks it where an entry that already exists
 *  gains its boundary over a kept blob (no segment is in play there); replay asks segmentMayMarkEntry instead, which also
 *  needs the segment it marks with to carry a pruned blob (D-5396). The sweep clears the marks of the referrers of a blob it
 *  unmarks or revives (a bind check, a revived tombstone). No blob at all answers yes: nothing is owed, and it agrees with
 *  planSegment, which takes such a row carrying nothing and whose pass marks it (the schema gives every entry its own blob,
 *  so the sweep never asks it). */
export function entryMayHoldMark({ blobs }) {
  if (!Array.isArray(blobs)) throw new TypeError(`entryMayHoldMark: blobs must be a list, got ${typeof blobs}`);
  return blobs.every((b) => b.exported === true || b.pruned === true);
}

/** Whether replay may mark an entry with the segment it is replaying (D-5396 (history-export-bind-clears-pruned-referrers),
 *  refining D-5395), from the states of the blobs the entry references as the store holds them now, each with `carried`:
 *  whether THAT segment's blobs hold the blob, as bytes or as a stub. entryMayHoldMark's rule, narrowed where a mark names a
 *  segment. An `exported` blob has its bytes where its own mark names, so it licenses the mark whichever segment is replayed
 *  (the entry is marked by the first segment that carries it), and the loss of that segment clears the blob's referrers with
 *  it (a bind check). A `pruned` blob that is not exported has no mark of its own, and its stub is held only by the segments
 *  that carry it: the entry's mark is the one thing that names a segment holding it, so the blob licenses the mark only when
 *  this segment carries it, as the pass's does (planSegment stubs every pruned, unmarked blob the entry names in the segment
 *  that marks the entry). Without that, a mark naming a segment that lacks the stub outlives the loss of the segment that
 *  holds it, and a rebuild from the live segments cannot place the entry. A live, unmarked blob licenses nothing. `carried`
 *  is read only of a pruned blob that is not exported: the caller measures it there and says false of any other, whose answer
 *  does not depend on it, and a blob that does not say is refused rather than read as not carried. No blob at all answers
 *  yes, as entryMayHoldMark does. */
export function segmentMayMarkEntry({ blobs }) {
  if (!Array.isArray(blobs)) throw new TypeError(`segmentMayMarkEntry: blobs must be a list, got ${typeof blobs}`);
  for (const b of blobs) {
    if (typeof b?.carried !== 'boolean') throw new TypeError(`segmentMayMarkEntry: every blob says whether the segment carries it, got ${typeof b?.carried}`);
  }
  return blobs.every((b) => b.exported === true || (b.pruned === true && b.carried === true));
}

// ===========================================================================
// What one export segment carries (spec §9.15 "What is due", "Write"; W1-B4
// Task 2). Pure: the sweep pages its candidate rows, in the four runs its
// exportSelect describes: the rows with no time, by entry id; the young rows of
// each due transcript, by time; the older rows, by time; the unlinked sidecars,
// by blob id. The first three offer only the rows of the due transcripts (that
// still hold an unexported row), and the sidecar run is NOT filtered to them. It
// is one order within a run and not across them. Each candidate carries its
// time, its holding files and its blobs' export and prune state, and the sweep
// writes what this answers. Due-ness is the reducer's, B2's per-copy one by
// default (ruled Q15, rev 3.4), the census's own: one clock (RD1).
// D-4758 (history-export-row-carries-blob) B2's D-4735 (history-export-due-per-copy)
// D-4759 (history-export-pruned-row-stub) D-4760 (history-export-segment-bound-estimated)
// ===========================================================================

/** What one taken row is counted for in the segment bound, beside its new blob bytes: an estimate of its metadata in
 *  the file (its entry's named columns, its memberships, its share of the family, transcript, epoch and file rows).
 *  Chosen: a prototype of the format-1 tables measured 0.8–1.1 KiB per entry with one membership and about 0.2 KiB
 *  per further membership, over a fixed 56 KiB of schema pages. Counting it keeps a segment near
 *  EXPORT_SEGMENT_MAX_BYTES when rows are small beside their metadata, and bounds a segment's rows (at most about
 *  EXPORT_SEGMENT_MAX_BYTES / EXPORT_ROW_META_BYTES, some 175,000), so rows that bring no new bytes cannot grow one,
 *  or the pass's memory, without limit (D-4760 (history-export-segment-bound-estimated)). */
export const EXPORT_ROW_META_BYTES = 1536;

/** When a due candidate fell due, as a real clock, or null when it has none (W1-B4; §9.15 "How long a due blob has waited").
 *  The reducer's due time when it names one, the one clock, so due-ness and due-since never disagree. A candidate the
 *  reducer answers due from the start (-Infinity: under the per-copy rule, no holding file on disk) is dated by B2's
 *  own W1-k rule, holderDueDateMs, never by a sentinel: the last write its RECORDED files saw (it cannot have fallen
 *  due before that, so the date errs early, as the rule does), else its row's time. Null, undated, when it has
 *  neither, or when the only clock is not after the epoch (B1's transcriptFiles reads a NULL mtime_ns as 0): the
 *  candidate stays due and counted, and no 1970 due-since is ever answered for it (B2's D-4735 (history-export-due-per-copy)).
 *  Called only for a due candidate. */
function dueSinceMs(candidate, homeRetentionDays, reducer) {
  const at = holderDueDateMs(candidate, homeRetentionDays, reducer);
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

/** One segment's contents (§9.15). A row is DUE when the reducer's due time for it is before nowMs: by default B2's
 *  EXPORT_REDUCERS.perCopy, under which every file holding a copy of the row has passed its mtime plus its own home's
 *  retention, minus 30 days (ruled Q15, rev 3.4; B2's D-4735 (history-export-due-per-copy)), whatever its blobs' other referrers
 *  (rev 3.1 review, BK12; D-4758 (history-export-row-carries-blob)).
 *  A due row is taken with:
 *  - the bytes of every blob it references that is neither exported nor pruned (`carry`). A blob already exported
 *    is never carried again, and one shared by several taken rows is carried once;
 *  - a stub of every pruned blob it references that no segment carried before (`stubs`): its sha, codec and size
 *    with no bytes, so a rebuild keeps the row's structure (entries.blob_id is NOT NULL). A stub is never exported
 *    text and its size never counts toward the bound; its row's metadata does (D-4759 (history-export-pruned-row-stub)).
 *  Rows are taken in input order, until the next due row's counted bytes (its new blob bytes plus EXPORT_ROW_META_BYTES)
 *  would pass `boundBytes`; from there no later row is taken. The sweep's input order is its candidates' runs, in this
 *  order: the rows with no time by entry id, the young rows (at or past the cutoff) of each due transcript by time, the
 *  older rows by time, then the unlinked sidecars by blob id; the first three offer only the rows of the transcripts
 *  dueTranscriptKeys names that still hold an unexported row, the sidecars are not filtered to them (D-5394
 *  (history-export-select-due-transcripts)). It is one time order within a run and not
 *  across them, so a segment holds a prefix of the due rows in that offered order, not of the backlog by age: a due row
 *  left behind may be older than one taken (`oldestLeftDueSinceMs` is measured over the rows left, never assumed from
 *  the order). The first due row of the PASS is taken whatever its size, so every pass moves the export
 *  forward: `takenBefore` says an earlier call of the same pass (an earlier page) already took one, and then this
 *  call's first row must fit too. The due rows left behind are counted, with the earliest time any of them fell
 *  due. planExport's per-BLOB rule stays the census's; both ask the same reducer with the same default, so the pass
 *  and the census read one clock (RD1), and a rule is still one reducer and no signature (rev 3.2 review, FE13). */
export function planSegment({ nowMs, homeRetentionDays, rows, boundBytes, reducer = EXPORT_REDUCERS.perCopy, takenBefore = false }) {
  const take = [];
  const carry = [];
  const stubs = [];
  const carried = new Set();
  const stubbed = new Set();
  let bytes = 0;
  let leftDue = 0;
  let oldestLeftDueSinceMs = null;
  let full = false;
  for (const row of rows) {
    const dueAt = reducer(row, homeRetentionDays);
    if (!(dueAt < nowMs)) continue;
    const fresh = new Map();
    for (const b of row.blobs) if (!b.exported && !b.pruned && !carried.has(b.key)) fresh.set(b.key, b);
    let add = EXPORT_ROW_META_BYTES;
    for (const b of fresh.values()) add += b.zBytes;
    if (full || ((take.length > 0 || takenBefore) && bytes + add > boundBytes)) {
      full = true;
      leftDue += 1;
      const since = dueSinceMs(row, homeRetentionDays, reducer);
      if (since !== null && (oldestLeftDueSinceMs === null || since < oldestLeftDueSinceMs)) oldestLeftDueSinceMs = since;
      continue;
    }
    take.push(row.key);
    for (const b of fresh.values()) {
      carried.add(b.key);
      carry.push(b.key);
    }
    bytes += add;
    for (const b of row.blobs) {
      if (b.pruned && !b.exported && !stubbed.has(b.key)) {
        stubbed.add(b.key);
        stubs.push(b.key);
      }
    }
  }
  return { take, carry, stubs, bytes, leftDue, oldestLeftDueSinceMs };
}

/** Whether a pass the run's budget cut short is recorded as an attempt and reported (D-5394
 *  (history-export-select-due-transcripts)): the sweep writes the attempt clock and one stderr line, and the next step
 *  waits its interval, not the next tick. Two shapes, both a pass that wrote no segment and so moved nothing:
 *  - nothing taken and the selection did not run to its end (`taken` 0, `selectionComplete` false). The bound cannot end a
 *    selection before its first row, since planSegment takes a pass's first row whatever its size, so the budget is all
 *    that is left;
 *  - rows taken and none written, the writer finding the budget spent before its first row (`written` 0, `writeStopped`
 *    'budget'). The writer checks the budget before history-off, so a budget spent beside the operator's switch reads as
 *    the budget.
 *  Never history-off alone (`writeStopped` 'off': the operator's switch is not the budget's), never a selection that ran to
 *  its end with nothing due (that pass completes: it is a pass), never a pass that wrote a row (its segment is published
 *  and marked, whatever stopped the writer after that). Facts measured by the sweep, a decision made here (RD2). */
export function budgetHeldPass({ taken, selectionComplete, written, writeStopped }) {
  if (taken === 0) return selectionComplete === false;
  return written === 0 && writeStopped === 'budget';
}

// ===========================================================================
// Export replay's decisions (spec §9.14 "Export replay"; W1-B4 Task 3). Pure:
// the recovery step reads each segment's meta through store.mjs and passes
// what it saw; which segments replay, and in what order (lib
// orderSegmentNames), is taken here.
// B2's D-4699 (history-recovery-replay)
// ===========================================================================

/** What export replay does with one segment, from the two meta facts every format keeps (store.mjs segmentMeta):
 *  - `foreign` when its store_id is not this store's, whatever its format: another store's text is skipped and
 *    counted, never applied, and never a FAIL of this store's;
 *  - `newer` when its format is past the one this build reads: refused loudly (export-segment-newer, doctor FAIL)
 *    and skipped, never read through tables it may not have;
 *  - `replay` otherwise. A build that bumps EXPORT_SEGMENT_FORMAT adds here the arm for each older format it still
 *    reads. */
export function decideSegmentReplay({ meta, storeId }) {
  if (meta.storeId !== storeId) return 'foreign';
  return meta.format > EXPORT_SEGMENT_FORMAT ? 'newer' : 'replay';
}

// ── W1-B4 Task 9: export-due on a build with the export writer (spec §9.6, §9.15 "The gap guard") ──────────────
// B1 shipped the ruled arm for a build without the writer: WARN from the first due blob. With the writer (this
// build), rows cross the horizon continuously and the pass runs at most hourly, so a due count alone is the pass's
// ordinary cadence, not a gap. export-due then WARNs only when the last completed pass is older than two pass
// intervals, or the oldest due blob the census counted has waited longer than that (chosen: 2 h). Both clocks are
// the store's own (meta the pass and the census keep), never a calendar date (O41; D-4207).
// The census's due-since is its own measure of the rows, read at most one census interval late, which keeps a
// steady store under the threshold (§9.15 "How long a due blob has waited").
// The three helpers are function declarations: deriveHealth and remedyFor, above, call them at call time, and the
// constant they read (EXPORT_PASS_INTERVAL_MS, Task 1) is initialised by then.

/** Which arm of export-due fires, or null. `no-writer` is B1's ruled arm; `stale-pass` outranks `waited`. A clock
 *  that is not a time fires neither writer arm by itself: a last pass of null (none since this build landed), and a
 *  due-since of null (the census counted nothing due) or EXPORT_DUE_OLDEST_UNMEASURED (no census of this build has
 *  recorded one, or it could date none of the due blobs). `over` reads only a number. */
function exportGapArm(h) {
  if (!(h.exportDue > 0)) return null;
  if (!h.exportWriterLive) return 'no-writer';
  const gapMs = 2 * EXPORT_PASS_INTERVAL_MS;
  const over = (t) => typeof t === 'number' && h.nowMs - t > gapMs;
  if (over(h.exportLastPassMs)) return 'stale-pass';
  if (over(h.exportDueOldestMs)) return 'waited';
  return null;
}

/** export-due's detail, one per arm. B1's arm keeps B1's text verbatim. */
function exportDueDetail(arm, h) {
  const gapMin = minutesOf(2 * EXPORT_PASS_INTERVAL_MS);
  if (arm === 'stale-pass') {
    return `${h.exportDue} unexported blob(s) are due, and the last export pass completed ${minutesOf(h.nowMs - h.exportLastPassMs)} min ago (over ${gapMin} min)`;
  }
  if (arm === 'waited') {
    return `${h.exportDue} unexported blob(s) are due, the oldest for ${minutesOf(h.nowMs - h.exportDueOldestMs)} min (over ${gapMin} min, two export pass intervals)`;
  }
  return `${h.exportDue} unexported blob(s) are due by the horizon, and this build has no export writer`;
}

/** export-due's remedy, by arm: B1's for a build without the writer; the room first while the pass is paused for
 *  it; the sweep's log for a pass that stopped completing; nothing to do while a backlog drains. */
function exportDueRemedy(h) {
  const arm = exportGapArm(h);
  if (arm === null || arm === 'no-writer') return HEALTH_REMEDIES['export-due'];
  if (h.exportPausedLowDisk) return 'free space on the home filesystem: the export pass is paused for room there, and the due text waits for it';
  if (arm === 'stale-pass') return `read the sweep: ${SWEEP_LOG}; an export pass completes at least hourly, and none has for over two intervals`;
  return `none needed while the backlog drains at one segment an hour; if the count does not fall, read the sweep: ${SWEEP_LOG}`;
}

// The census's oldest due-since in meta (HEALTH_META.exportDueOldestMs), written and read back here only, so the sweep
// delivers and status relays, and neither decides (§9.15 "How long a due blob has waited"). Three values, never folded:
//   ''                            the census counted nothing due (read back: null);
//   a positive integer            when the oldest dated due blob fell due (read back: the number);
//   EXPORT_DUE_OLDEST_UNMEASURED  blobs are due and the census could date none (no clock on record, or only the part a
//                                 B1 pass started counted them); a key never written reads the same, never "nothing
//                                 due". No value at or before the epoch is a time: it would render as 1970 and the
//                                 wait arm would count some 29 million minutes from it.

/** The word for a due-since the census has not measured (status --json's due_oldest_ms, HealthInputs). */
export const EXPORT_DUE_OLDEST_UNMEASURED = 'unmeasured';

/** What the census writes on completion, from its due count and its oldest dated due-since (planExport's
 *  oldestDueSinceMs, min over chunks). A file clock's fraction of a ms is rounded. */
export function exportDueOldestMeta(due, dueOldestMs) {
  if (!(due > 0)) return '';
  const ms = typeof dueOldestMs === 'number' && Number.isFinite(dueOldestMs) ? Math.round(dueOldestMs) : 0;
  return ms > 0 ? String(ms) : EXPORT_DUE_OLDEST_UNMEASURED;
}

/** The census's due-since read back from meta: a time, null (nothing due), or EXPORT_DUE_OLDEST_UNMEASURED. */
export function readExportDueOldest(v) {
  if (v === undefined) return EXPORT_DUE_OLDEST_UNMEASURED;
  if (v === '') return null;
  return /^[1-9][0-9]*$/.test(v) ? Number(v) : EXPORT_DUE_OLDEST_UNMEASURED;
}
