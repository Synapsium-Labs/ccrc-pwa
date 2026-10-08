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
  [EXIT.REFUSED, [
    'bad-args', 'regex-syntax', 'regex-refused', 'regex-timeout', 'cross-project', 'out-of-scope',
    'project-unreadable', 'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'no-identity',
    'bad-id', 'apply-in-session', 'needs-tty', 'irreversible-in-pane', 'history-off', 'span-pruned',
    'older-than-floor', 'reparse-too-many', 'workspace-unreadable', 'harness-unsupported',
    'harness-unreadable', 'generation-unreadable', 'writer-absent', 'adopt-refused', 'restore-refused',
    'rebuild-refused', 'migrate-refused',
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
export const PARSE_STATUS = Object.freeze(['ok', 'degraded', 'invalid', 'absent', 'not-requested']);
/** `entries.parse_state` (§6.2, §9.2 step 4). */
export const ENTRY_PARSE_STATES = Object.freeze(['ok', 'raw-only']);
export const PROVENANCE = Object.freeze(['operator', 'model', 'tool', 'summary', 'harness', 'ccrc-injected', 'recall-echo']);
/** The provenances the FTS index holds (§6.2). */
export const SEARCHABLE_PROVENANCE = Object.freeze(['operator', 'model', 'tool']);
/** Spool line kinds: the hook writes the first three, the CLI `recall` (B2),
 *  the hook `steer` (W3). */
export const SPOOL_EVENTS = Object.freeze(['Stop', 'PostCompact', 'SessionStart', 'recall', 'steer']);
/** The SessionStart sources that spool (ruled Q2; fork is outside, Q16). */
export const SPOOL_SOURCES = Object.freeze(['startup', 'resume', 'clear']);
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
// D-4175: `reg` rides startup and resume
// lines only. D-4173: `src` is one of SPOOL_SOURCES, so a
// `fork` source is a value rejection. D-4177: no key carries summary text or a
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
 *  missing or undeclared key, `reg` off a startup/resume line, no `ev`), then
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
  if (Object.hasOwn(o, 'reg') && o.src !== 'startup' && o.src !== 'resume') return { ok: false, why: 'keys' };
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

/** The verdict on a store the CLI measured through its read-only handle: §8.3's
 *  `store-not-wal` refusal (exit 5, a store the writer could not put in WAL) and
 *  the migration word the envelope carries. `cli.mjs` reads `PRAGMA journal_mode`,
 *  `user_version` and meta's `migration` and delivers this answer; it decides
 *  neither (Task 28F, ring rule: delivery measures, lib decides). A stored
 *  version newer than this build's is `refuse-newer` whatever the sweep recorded;
 *  otherwise the sweep's recorded word stands when it is a MIGRATION_VERDICTS
 *  member, and anything else is `none`. The two answers are independent. */
export function decideStatusRead({ userVersion, journalMode, recordedMigration }) {
  const migration = userVersion > SCHEMA_VERSION
    ? 'refuse-newer'
    : (MIGRATION_VERDICTS.includes(recordedMigration) ? recordedMigration : 'none');
  if (journalMode !== 'wal') return { exit: REASONS['store-not-wal'], reason: 'store-not-wal', migration };
  return { exit: EXIT.OK, migration };
}

/** §8.3 (review 316 F11; D-4171, D-4313): what `status` answers when its read of a store the binding read admitted throws.
 *  `storeWord` is a StoreError's word (the reader's open refused: the DB went missing, 0 bytes or unmeasured since it
 *  was measured), else null; `sqliteError` says SQLite raised it. Answers {exit: 5, reason}, or null for a throw
 *  that is neither — a defect the caller lets escape as exit 1. Three answers, never folded. */
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
 *  - startup/resume: confirmed on its own evidence first — its `reg` equals
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
  if (line.src !== 'startup' && line.src !== 'resume') {
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

/** A secret file's kind by its name: `*.token` its trimmed content, `*.json`
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
 *  starts, so the linear `redactJwtShapes` finds the same matches by a scan
 *  and `redactLayers` applies it after this list. D-4306 (history-redaction-shapes-linear) */
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
 *  `agent.env`); a token file its trimmed whole content; a JSON file its
 *  string leaves. D-4206
 *  D-4204 */
export function extractSecretValues(text, kind) {
  if (kind === 'token') {
    const t = text.trim();
    return t === '' ? [] : [t];
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
export function makePairIndex(pairs) {
  const byLen = new Map();
  for (const p of pairs) {
    if (!byLen.has(p.len)) byLen.set(p.len, new Set());
    byLen.get(p.len).add(p.sha256);
  }
  return { byLen };
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
 *  neighbour that no quoted phrase finds, and for a pair that has no value (sessions.json's idHash). */
export function makeProbeIndex(pairs, mark) {
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
  return { byLen, probe };
}

/** meta fts_rederive's grammar, `<target> <cursor> <end>`; anything else (undefined included) is null
 *  (D-4344, history-reindex-mark-by-rederivation). */
export function parseRederiveState(text) {
  const m = /^([0-9]{1,15}) ([0-9]{1,15}) ([0-9]{1,15})$/.exec(text ?? '');
  return m === null ? null : { target: Number(m[1]), cursor: Number(m[2]), end: Number(m[3]) };
}
export function formatRederiveState(s) {
  return `${s.target} ${s.cursor} ${s.end}`;
}
/** Whether a re-derivation generation is open: its saved target lies above the mark (D-4344,
 *  history-reindex-mark-by-rederivation). The one test of it, read by rederivePlan and phraseValues. */
function rederiveOpen(mark, state) {
  return state !== null && state.target > mark;
}
/** Continue a generation whose target lies above the mark; else start one when a pair lies above it; else nothing.
 *  A malformed state restarts from 0, which is conservative (D-4344, history-reindex-mark-by-rederivation). */
export function rederivePlan(mark, top, maxBlobId, state) {
  if (rederiveOpen(mark, state)) return state;
  if (top > mark) return { target: top, cursor: 0, end: maxBlobId };
  return null;
}
/** The values the same-tick phrase fast path searches (D-4344, history-reindex-mark-by-rederivation; review 344 F2):
 *  every value the tick loaded while no generation is open, and while one is, only `fresh`, the values whose pairs
 *  the tick itself recorded. An open generation re-derives every indexed blob up to its end, so a search on each of
 *  its ticks only re-indexed, every tick until it ended, each blob a phrase still found: a value glued to a
 *  neighbour by `_` or `-`, which §8.3's run grammar leaves in place. A pair recorded while a generation is open
 *  keeps its recording-tick search; one a dead pass recorded waits for the next tick no generation is open. */
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
function redactJwtRun(run) {
  let j = run.indexOf('eyJ');
  if (j === -1) return run;
  let out = '';
  let copied = 0;
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
          out += run.slice(copied, j) + REDACTED_MARK;
          copied = s3End;
          segStart = s3End + 1;
          continue;
        }
      }
    }
    segStart = segEnd + 1;
  }
  return copied === 0 ? run : out + run.slice(copied);
}

/** Every JWT-shaped match of `s` replaced by the mark (see `redactJwtRun`). */
function redactJwtShapes(s) {
  return s.replace(/[A-Za-z0-9_.-]+/g, redactJwtRun);
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
 *  while on a span of short dotted words it is the costliest layer. */
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
  let s = segment.replace(/[A-Za-z0-9_-]+/g, (run) => {
    const shas = idx.byLen.get(run.length);
    return shas !== undefined && shas.has(sha256Hex(run)) ? REDACTED_MARK : run;
  });
  // Layer 2: context. The value after NAME=, NAME: or "name": " when NAME is
  // an identifier name; after a bearer header and the box-token header; and
  // a token query parameter. NAME is bounded at 256 chars: unbounded, every
  // word boundary inside a long run of [A-Za-z0-9_.-] rescans to the run's
  // end, which is quadratic (a 2 MiB base64url blob measured 90.8 s, bounded
  // 139 ms), and one large tool_result would outlive the carrier's kill.
  if (context) {
    s = s.replace(/"([A-Za-z_][A-Za-z0-9_.-]{0,255})"(\s*:\s*)"((?:[^"\\]|\\.)+)"/g,
      (all, name, sep, value) => (IDENTIFIER_RE.test(name) && value !== REDACTED_MARK ? `"${name}"${sep}"${REDACTED_MARK}"` : all));
    s = s.replace(/\b([A-Za-z_][A-Za-z0-9_.-]{0,255})(=|:[ \t]+)(["']?)([^\s"'`,;&]+)/g,
      (all, name, sep, quote, value) => (IDENTIFIER_RE.test(name) && value !== REDACTED_MARK ? `${name}${sep}${quote}${REDACTED_MARK}` : all));
    s = s.replace(/(Authorization:[ \t]*Bearer[ \t]+)([^\s"']+)/gi, (all, head, value) => (value === REDACTED_MARK ? all : `${head}${REDACTED_MARK}`));
    s = s.replace(/(x-ccrc-mail-token:[ \t]*)([^\s"']+)/gi, (all, head, value) => (value === REDACTED_MARK ? all : `${head}${REDACTED_MARK}`));
    s = s.replace(/([?&]token=)([^&\s"'#]+)/gi, (all, head, value) => (value === REDACTED_MARK ? all : `${head}${REDACTED_MARK}`));
  }
  // Layer 3: shapes.
  for (const re of SECRET_SHAPE_RES) s = s.replace(re, REDACTED_MARK);
  return redactJwtShapes(s);
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
export function redactField(text, idx) {
  if (!ESCAPE_INTRODUCER_RE.test(text)) return redactRun(text, idx);
  const raw = redactRun(text, idx);
  let out = '';
  let plain = '';
  let last = 0;
  let sawCsi = false;
  const leads = [];
  const carried = [];
  ANSI_ESCAPE_RE.lastIndex = 0;
  for (let m = ANSI_ESCAPE_RE.exec(raw); m !== null; m = ANSI_ESCAPE_RE.exec(raw)) {
    const frag = redactRun(raw.slice(last, m.index), idx);
    out += frag + m[0];
    plain += frag;
    if (frag.endsWith(REDACTED_MARK)) carried.push(plain.length);
    leads.push(plain.length, m.index, m.index + m[0].length);
    last = m.index + m[0].length;
    sawCsi = true;
  }
  const tail = redactRun(raw.slice(last), idx);
  const perFragment = out + tail;
  if (!sawCsi) return perFragment;
  // `plain` is accumulated from the fragments, never rebuilt by re-matching an escape in `perFragment`: a redaction can
  // create an escape shape (a bare ESC before `[redacted]` reads as `ESC[r...`), and a re-strip would eat the mark.
  plain += tail;
  const flagged = carriedMarks(plain, carried, leadOffsets(plain, raw, leads, idx));
  const joined = redactRun(flagged.length === 0 ? plain : markSpansAt(plain, flagged), idx);
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
  let t = redactField(text, idx);
  let keep = t;
  for (let pass = 0; pass < INDEX_UNESCAPE_PASSES; pass += 1) {
    const u = unescapeJsonText(t);
    if (u === t) return keep;
    t = redactField(u, idx);
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
  if (idx !== null) text = redactField(text, idx);
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

/** The second belt (§8.3): the final rendered stdout, stderr or `--json`
 *  string gets the same three layers once more. It cannot replace the field
 *  pass (an escape letter glued to a run defeats it); it catches what a
 *  field pass was never given. */
export function redactFinal(text, idx) {
  return redactField(text, idx);
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

/** The reducers `planExport` may take: per candidate referrer, the retention
 *  its age is measured against. The ruled rule (Q6 e) is `shortestHome`, the
 *  node's shortest retention whatever homes hold the referrer; Q15, if ruled
 *  yes, adds a reducer reading the referrer's own files and changes no
 *  signature (rev 3.2 review, FE13). */
export const EXPORT_REDUCERS = Object.freeze({
  shortestHome: (_candidate, homeRetentionDays) => shortestRetention(homeRetentionDays),
});

/** The horizon: retention minus `EXPORT_MARGIN_DAYS`, floored at 0. */
export function exportHorizonDays(retentionDays) {
  return Math.max(0, retentionDays - EXPORT_MARGIN_DAYS);
}

/** A referrer's age (§9.15): now minus its row's `ts_ms`, or, when that is
 *  NULL, minus the mtime of the newest file holding it — deliberately the
 *  opposite of prune, where NULL is "never old": here "never" would never
 *  copy it. A referrer with no time and no holding file has no clock at all
 *  and counts as old: the export errs early, never late (plan-chosen).
 *  D-4208 */
function referrerAgeMs(r, nowMs) {
  if (r.tsMs !== null) return nowMs - r.tsMs;
  if (r.files.length === 0) return Number.POSITIVE_INFINITY;
  return nowMs - Math.max(...r.files.map((f) => f.mtimeMs));
}

/** The export's due and overdue sets (§9.15). A blob is DUE when every
 *  referrer is older than its horizon, the retention coming from the reducer
 *  (default: the ruled `shortestHome`). It is OVERDUE — measured source loss,
 *  doctor's FAIL — when it is due and every holding file of every referrer is
 *  gone from disk or past its own deletion date by the file clock (its mtime
 *  plus its home's retention). A blob with no referrer is neither.
 *  D-4207 */
export function planExport({ nowMs, homeRetentionDays, blobs, reducer = EXPORT_REDUCERS.shortestHome }) {
  const due = [];
  const overdue = [];
  for (const blob of blobs) {
    if (blob.referrers.length === 0) continue;
    const isDue = blob.referrers.every((r) => referrerAgeMs(r, nowMs) > exportHorizonDays(reducer(r, homeRetentionDays)) * EXPORT_DAY_MS);
    if (!isDue) continue;
    due.push(blob.key);
    const gone = blob.referrers.every((r) => r.files.every((f) => !f.present || fileDeletionMs(f, homeRetentionDays) < nowMs));
    if (gone) overdue.push(blob.key);
  }
  return { horizonDays: exportHorizonDays(shortestRetention(homeRetentionDays)), due, overdue };
}

/** The file clock (§9.15): when Claude Code's own cleanup deletes a holding file, its mtime plus ITS home's
 *  retention (the default for a home never measured). The one definition of that rule: `planExport`'s overdue test
 *  and `exportDates` both read it. */
function fileDeletionMs(f, homeRetentionDays) {
  return f.mtimeMs + (homeRetentionDays[f.home] ?? CLAUDE_CODE_DEFAULT_RETENTION_DAYS) * EXPORT_DAY_MS;
}

/** The census's W1-k dates (§9.15), decided here so the sweep only delivers them (Task 26F item 7):
 *  - `firstDueMs`: the oldest unexported row's due date by the ROW clock, its ts plus the horizon (the shortest
 *    retention over the homes, less the margin); null when no row is unexported (`oldestRowMs` null).
 *  - `firstDeletionMs`: the earliest deletion date by the FILE clock over the files still present, rounded to a
 *    whole millisecond; null when none is present. A file that is gone has no deletion date: it is already lost.
 *  `files` is every holding file the census measured, each already assigned its home. */
export function exportDates({ homeRetentionDays, oldestRowMs, files }) {
  let first = null;
  for (const f of files) {
    if (!f.present) continue;
    const at = fileDeletionMs(f, homeRetentionDays);
    if (first === null || at < first) first = at;
  }
  return {
    firstDueMs: oldestRowMs === null ? null : oldestRowMs + exportHorizonDays(shortestRetention(homeRetentionDays)) * EXPORT_DAY_MS,
    firstDeletionMs: first === null ? null : Math.round(first),
  };
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
});

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
});

/** Counters `status` reads for a health word, spelled once for the writer (sweep.mjs), the reader (cli.mjs) and the
 *  doctor fixtures that plant them. D-4346 (history-permanent-failures-classified). Like `blob_undecodable` and
 *  `drain_rejected`, `spool_displaced`, `spool_blocked` and `spool_unreadable` are never reset in B1 (B2's repair owns resets). */
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

const MODE_CHECKED_FILE_ROOTS = Object.freeze(['db', 'card', 'steer', 'journal', 'export']);

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
  'at-cap': 'raise the cap (an integer, in GB); ccrc history prune, which frees space, arrives with W1-B2',
  'capture-paused-low-disk': 'free space on the store\'s filesystem; capture resumes by itself above the floor',
  'mode-wrong': 'chmod each named path to the mode it wants',
  'schema-newer': 'update this box to the build that wrote the store (ccrc update); this build still reads what it knows',
  'store-not-wal': 'the writer could not put the store in WAL mode: check the store\'s filesystem supports shared memory (a network mount does not), then systemctl --user start ccd-history-sweep',
  'store-unmeasured': 'make store.id, store.id.pending, store.writer and the DB under ~/.ccrc/history readable by this user; nothing is created, adopted or restored meanwhile',
  'recovery-stalled': `read the sweep: ${SWEEP_LOG}`,
  'store-root-dangling': `mount the volume behind ~/${STORE_DB_REL}, or remove the dangling link so the next tick stores on the home filesystem`,
  'store-missing': `ccrc history doctor --restore and --rebuild arrive with W1-B2; until then capture stays held and the journal keeps everything drained meanwhile: do not copy a backup over history.db by hand (that skips the journal replay --restore does and makes --restore refuse)`,
  'store-mismatch': 'this DB belongs to another store (its meta.store_id is not store.id): put the right DB back, or move this one aside',
  'store-unbound': `if the store is another box's, remove the ~/${STORE_DB_REL} link or move the DB aside; if it is this box's, leave it in place: ccrc history doctor --adopt, which binds it, arrives with W1-B2 and capture stays held until then`,
  'store-unreachable': `the store's filesystem did not answer: check the mount behind ~/${STORE_DB_REL}`,
  'store-recoverable': 'ccrc history doctor --restore and --rebuild, which recover from what was found, arrive with W1-B2: keep that evidence until then, or move it aside to start a new store',
  'store-wal-orphaned': 'move history.db-wal and history.db-shm (and any history.db) aside together; then let the next tick create a store, or restore one',
  'store-zero-byte': `the DB was truncated: keep it where it is; ccrc history doctor --restore and --rebuild arrive with W1-B2, and until then capture stays held and the journal keeps everything drained meanwhile (do not copy a backup over history.db by hand: that skips the journal replay --restore does)`,
  'store-schema-missing': `the DB has no meta.store_id, so it is not a history store this build can bind: keep all three DB files where they are; ccrc history doctor --restore and --rebuild arrive with W1-B2, and until then capture stays held and the journal keeps everything drained meanwhile (do not copy a backup over history.db by hand: that skips the journal replay --restore does)`,
  'migration-refused': 'free space on the store\'s filesystem: the pre-migration snapshot needs a store\'s size above the floor',
  'migration-needs-op': 'run the migration by hand, under no carrier timeout: ~/.local/bin/ccd-history-sweep --op migrate (ccrc history doctor --migrate arrives with W1-B2)',
  'journal-unwritable': 'free space on the home filesystem, or make ~/.ccrc/history/journal writable: drained spool files are held until the journal append succeeds',
  'export-segment-newer': 'update this box to the build that wrote the segment (ccrc update)',
  'export-overdue': 'the store may be the only copy of this text: keep ~/.ccrc/history (never --purge-history), and raise cleanupPeriodDays in each home\'s settings.json (or the managed settings) so Claude Code keeps transcripts until the export writer ships (W1-B4)',
  'status-unreadable': `run ccrc history status --json by hand, and read the sweep: ${SWEEP_LOG}`,
  'fts-unavailable': 'none needed for capture; run Node >= 22.16.0 for FTS5 search',
  'cap-malformed': `write a positive integer (GB) into the cap file, or remove it for the default of ${CAP_DEFAULT_GB}`,
  'redact-source-unreadable': 'make the named secret files readable by this user; a value never yet seen in them goes unredacted meanwhile',
  'cap-near': 'raise the cap before capture pauses at it; ccrc history prune, which frees space, arrives with W1-B2',
  'breaker-open': `none needed: the breaker closes by itself; read the sweep for why it opened: ${SWEEP_LOG}`,
  'roster-unreadable': 'make ~/.ccrc/accounts.sh readable (ccrc install regenerates it)',
  'root-is-symlink': 'make ~/.ccrc/history a real 0700 directory: only its db/ may be a link',
  'export-due': 'the export writer arrives with W1-B4: until then the text stays on disk until its retention passes, and raising cleanupPeriodDays in each home\'s settings.json keeps transcripts longer',
  'export-paused-low-disk': 'free space on the home filesystem',
  'retention-unmeasured': 'make cleanupPeriodDays readable in the named homes\' settings.json',
  'retention-lowered': 'set cleanupPeriodDays in the named home\'s settings.json to at least the others\' value',
  'export-segment-missing': 'carry the export directory from the box the store came from, or let the rows export again',
  'journal-record-skipped': `none needed if the journal came from a newer build; otherwise ccrc history doctor --repair arrives with W1-B2, and until then read the sweep: ${SWEEP_LOG}`,
  'journal-growth': `read the sweep: ${SWEEP_LOG}; the journal grows faster than twice its estimate`,
  'blob-undecodable': `the store's copy of that text is damaged (storage corruption) and nothing repairs it in place: keep ~/.ccrc/history as it is; ccrc history doctor --repair, which detects storage corruption, arrives with W1-B2`,
  'drain-rejected': `the files are kept in ~/.ccrc/history/spool/.draining/rejected/ and their lines in the journal, and nothing in this build drains them again; the refusal is in the sweep's log: ${SWEEP_LOG}`,
  // D-4347 (history-planted-entries-never-wedge). Never reset in B1, like drain-rejected and blob-undecodable: B2's repair owns resets.
  'spool-planted': `remove a link or file that stands at ~/.ccrc/history/spool itself (the next pass makes the directory again), any FIFO, link or directory that stands at ~/.ccrc/history/spool/<id>.jsonl (that id spools again once it is gone), and the planted entries under ~/.ccrc/history/spool/.draining/ (each drain's set-asides are under planted/<tickMs>.<pid>/, and their files are kept there undrained); nothing in this build drains a displaced file again; a file the sweep cannot read stays in .draining/ with its .obs sidecar until both are readable by this user (chmod 600, or chown them) or removed, and its id's later files drain once it does; the sweep's log names each one: ${SWEEP_LOG}`,
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
      return `raise the cap in ${h.capFile} (an integer, in GB); capture resumes below the cap (ccrc history prune, which frees space, arrives with W1-B2)`;
    case 'cap-near':
      return `raise the cap in ${h.capFile} (an integer, in GB) before capture pauses at it (ccrc history prune, which frees space, arrives with W1-B2)`;
    case 'cap-malformed':
      return `write a positive integer (GB) into ${h.capFile}, or remove the file for the default of ${CAP_DEFAULT_GB}`;
    case 'capture-paused-low-disk':
      return `free space on the filesystem holding ${h.dbPath}; capture resumes by itself once it is above the floor`;
    case 'mode-wrong':
      return h.modesWrong.map((m) => `chmod ${m.want} ${m.path}`).join('; ');
    case 'store-root-dangling':
      return `mount the volume behind ${h.dbPath}, or remove the dangling link ~/${STORE_DB_REL} so the next tick stores on the home filesystem`;
    case 'store-missing':
      return h.backupsDb.length > 0
        ? `ccrc history doctor --restore ${h.backupsDb[0]} and --rebuild arrive with W1-B2 (db/backups holds ${h.backupsDb.join(', ')}; keep them); until then capture stays held and the journal keeps everything drained meanwhile: do not copy a backup over history.db by hand (that skips the journal replay --restore does and makes --restore refuse)`
        : 'ccrc history doctor --rebuild, which rebuilds from the journal, arrives with W1-B2; until then capture stays held and the journal keeps everything drained meanwhile (do not copy a backup over history.db by hand: that skips the journal replay --restore does)';
    case 'store-unbound':
      return `if store ${h.storeId ?? '(unknown)'} is another box's, remove the ~/${STORE_DB_REL} link or move the DB aside; if it is this box's, leave it in place: ccrc history doctor --adopt, which binds it, arrives with W1-B2 and capture stays held until then`;
    case 'store-recoverable':
      return `ccrc history doctor --restore and --rebuild, which recover from ${evidenceOf(h)}, arrive with W1-B2: keep that evidence until then, or move it aside to start a new store`;
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
    case 'store-schema-missing': return 'history.db is present and holds no meta.store_id';
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
  // operator switch and a live marker, not tick evidence, so they hold regardless.
  const tickAge = h.lastTickMs === null ? null : h.nowMs - h.lastTickMs;
  const tickFresh = tickAge !== null && tickAge <= TICK_STALE_MS;
  const b = h.bytesBehindLast3;
  const catching = tickFresh && b.length === CATCHING_UP_TICKS && b.every((v, i) => i === 0 || b[i - 1] > v);
  if (catching) warn.push(item('catching-up', `the backlog is falling: ${b[b.length - 1]} bytes behind, from ${b[0]} ${CATCHING_UP_TICKS} ticks ago`));
  const lagUnmeasured = h.lagS === null && tickFresh;
  if (lagUnmeasured) warn.push(item('lag-unmeasured', 'lag is unmeasured: not every file has reached its end once yet'));
  const stateHeld = h.historyOff || (h.recovering !== null && tickFresh) || opLive || catching || lagUnmeasured;

  // 4. the FAILs.
  if (!stateHeld) {
    if (tickAge === null) {
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
    const est = Math.ceil((h.sizeBytes ?? 0) / (h.copyBps ?? DEFAULT_COPY_BPS));
    fail.push(item('migration-needs-op', `a migration to v${h.codeVersion} needs a copy of about ${est} s, too long for a scheduled pass`));
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
  if (h.exportDue > 0 && !h.exportWriterLive) warn.push(item('export-due', `${h.exportDue} unexported blob(s) are due by the horizon, and this build has no export writer`));
  if (h.exportPausedLowDisk) warn.push(item('export-paused-low-disk', 'the export is paused for room on the home filesystem'));
  if (h.retentionUnmeasured.length > 0) warn.push(item('retention-unmeasured', `the retention of ${h.retentionUnmeasured.join(', ')} could not be read; each keeps its last measured value`));
  if (h.retentionLowered !== null) {
    warn.push(item('retention-lowered', `${h.retentionLowered.home} keeps ${h.retentionLowered.days} days, under the others' ${h.retentionLowered.othersMin}; the export horizon follows the shortest`));
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
    if (h.spoolNodesRefused > 0) parts.push(`${h.spoolNodesRefused} node(s) at spool/<id>.jsonl are not regular files (a FIFO, a link or a directory), so the hook spools no line for that id while one stands`);
    if (h.spoolDisplaced + h.spoolBlocked > 0) parts.push(`${h.spoolDisplaced} spool file(s) set aside under .draining/planted/ and ${h.spoolBlocked} skipped drain(s) of a file whose sidecar name is blocked, because of entries planted in .draining/`);
    if (h.spoolUnreadable > 0) parts.push(`${h.spoolUnreadable} skipped drain(s) of a draining file or its sidecar the sweep could not read, whose id's later files wait behind it`);
    warn.push(item('spool-planted', parts.join('; ')));
  }
  return result();
}
