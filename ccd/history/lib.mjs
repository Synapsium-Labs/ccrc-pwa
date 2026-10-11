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
    return shas !== undefined && shas.has(sha256Hex(run)) ? REDACTED_MARK : glueRedact(run, idx);
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
/** The complete field redaction. Layer 4 allocates per-field buffers too, so its RangeError shares layers 1-3's
 * fail-closed contract while non-RangeError defects remain visible. */
export function redactField(text, idx) {
  const layered = redactLayered(text, idx);
  try {
    return beltMask(layered, idx.belt, true, beltHit(idx));
  } catch (e) {
    if (e instanceof RangeError) return REDACTED_MARK;
    throw e;
  }
}

/** redactField's three layers over its readings, before the belt: B1's redactField body, unchanged. */
function redactLayered(text, idx) {
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
    if (h.spoolNodesRefused > 0) parts.push(`${h.spoolNodesRefused} node(s) at spool/<id>.jsonl are not regular files (a FIFO, a link, a directory or any other non-regular node), so the hook spools no line for that id while one stands`);
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
  return typeof raw === 'string' ? raw.trim().replace(EDGE_PUNCTUATION_RE, '').toLowerCase() : '';
}

/** Whether a token (or a phrase's inside) ends in the FTS5 prefix marker exactly as quoteFtsTerm reads it: a star run
 *  after at least one character that is neither a star nor a space. */
const PREFIX_MARKED_RE = /[^*\s]\s*\*+$/;

/** The one lexer behind queryTerms and snippetTerms, the raw query's words as sanitizeFtsQuery splits them: each
 *  normalized term with whether the query made it a prefix (a star right after a phrase's closing quote, or
 *  ending the token or the phrase's inside, which is what sanitizeFtsQuery turns into an FTS5 prefix query),
 *  once per (term, prefix) pair. */
function lexQueryTerms(raw) {
  const text = String(raw);
  const out = [];
  const add = (term, prefix) => {
    if (term.length > 0 && !out.some((x) => x.term === term && x.prefix === prefix)) out.push({ term, prefix });
  };
  for (const m of text.matchAll(RAW_TERM_RE)) {
    const inner = m[1] ?? m[3] ?? '';
    add(normalizeQueryTerm(inner), m[2] === '*' || PREFIX_MARKED_RE.test(inner.replace(/"/g, '')));
  }
  if (out.length === 0) add(normalizeQueryTerm(text), false);
  return out;
}

/** The plain words of a query, lowercased, edge punctuation (a trailing `*`
 *  included) stripped, each once: the snippet window's needles (§11 P9). */
export function queryTerms(raw) {
  return [...new Set(lexQueryTerms(raw).map((x) => x.term))];
}

/** queryTerms for snippet localization: the same words, each once, but a term the query made a prefix keeps one
 *  terminal `*`, which snippetSpan reads as FTS5's prefix marker (W1-B2 Task 12 fix round 1, finding F1). queryTerms
 *  strips that star for its display callers, so grep's snippet cannot be located from it. `stud` and `stud*` are
 *  different needles and both stay. */
export function snippetTerms(raw) {
  return lexQueryTerms(raw).map(({ term, prefix }) => (prefix ? `${term}*` : term));
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

/** The comparison form of one unicode61 token candidate, as FTS5's default `porter unicode61` (remove_diacritics)
 *  compares it: lowercased, canonically decomposed, combining diacritical marks (U+0300 to U+036F) removed. It is a
 *  comparison value only: the candidate's span in the source text is never rebuilt from it (Task 12 fix round 1, F2). */
function foldToken(word) {
  return word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Unicode61 token candidates with their original code-unit spans. Combining diacritical marks belong to the token
 *  they follow, as in FTS5, so a decomposed `e` + U+0301 is one candidate. */
function unicode61Words(text) {
  const words = [];
  const word = /[\p{L}\p{N}\u0300-\u036f]+/gu;
  for (let m = word.exec(text); m !== null; m = word.exec(text)) words.push({ text: m[0], at: m.index, end: m.index + m[0].length });
  return words;
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
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function recallEnvelope({ src, id, ts, role, text }) {
  const word = RECALL_SRCS.includes(src) ? src : 'unknown';
  const when = typeof ts === 'number' && Number.isFinite(ts) && Math.abs(ts) <= 8.64e15 ? new Date(ts).toISOString() : '';
  return `<ccrc-recall src="${escapeXmlAttr(word)}" id="${escapeXmlAttr(String(id))}" ts="${escapeXmlAttr(when)}" role="${escapeXmlAttr(role ?? '')}" trust="untrusted">${escapeXmlText(String(text))}</ccrc-recall>`;
}

// derived from lossless-claw src/tools/lcm-grep-tool.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
export function snippetLine(text, max = SNIPPET_MAX) {
  const single = String(text).replace(/\n/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, cutBefore(single, max - 3))}...`;
}

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
  return { v: 1, exit: o.exit, ...(o.reason === undefined ? {} : { reason: o.reason }), store_id: o.storeId, coverage: COVERAGE[0], scope: o.scope, indexed_through_ms: o.header === null ? null : o.header.indexedThroughMs, lag_s: o.header === null ? null : o.header.lagS, items: o.items.map((item) => ({ ...item, trust: 'untrusted' })), shown: o.shown, total: o.total, next: o.next };
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
 *    is 5 `store-unmeasured`, and one above the code's is refused before anything is written, as openStore refuses
 *    it before its writer's open (G9; DM17 "no write"). That refusal is decided here, never in the L4 arm (RB17);
 *  - restore: no history.db, no leftover -wal or -shm (SQLite would replay it into the restored file), a regular
 *    backup with a readable uuid store_id, store.id absent or naming that store, the backup's user_version not
 *    newer than the code's and its integrity_check not failed. Before the copy, version and integrity may be
 *    null (not measured yet), and they pass;
 *  - rebuild: no history.db and no leftover -wal or -shm. Its store_id is store.id's; else the one journal
 *    directory whose heads agree; else --store-id, which must name one of several. A --store-id disagreeing with
 *    store.id, naming no directory, or naming one whose heads name another store is refused, with the
 *    candidates named.
 *  D-4188 D-4185 D-4186 */
export function decideBind(kind, f) {
  if (!Object.hasOwn(BIND_REFUSALS, kind)) throw new TypeError(`decideBind: kind outside BIND_KINDS: ${String(kind)}`);
  const unmeasured = (detail) => ({ ok: false, rc: EXIT.DB, reason: 'store-unmeasured', detail });
  const refuse = (detail) => ({ ok: false, rc: EXIT.REFUSED, reason: BIND_REFUSALS[kind], detail });
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
    if (d === undefined) return refuse(`--store-id ${arg} names no journal directory (journal directories: ${names})`);
    if (!d.headsAgree) return refuse(`journal/${arg}/ holds head records naming another store`);
    return { ok: true, storeId: arg };
  }
  if (marker !== null) return { ok: true, storeId: marker };
  if (dirs.length === 0) return refuse('nothing names a store_id: no store.id and no journal directory');
  if (dirs.length > 1) return refuse(`several journal directories: name one with --store-id (journal directories: ${names})`);
  if (!dirs[0].headsAgree) return refuse(`journal/${dirs[0].storeId}/ holds head records naming another store`);
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
 *  pass learned a pair the store lacked. B4 inserts its export phases between `apply` and `reindex` (§9.14
 *  "Export replay"): this list is that seam. D-4700 (history-b4-after-b2) */
export const RECOVER_PHASES = Object.freeze(['index', 'apply', 'reindex']);

const RECOVER_JOURNAL_CURSOR_RE = /^(index|apply)(?::([0-9]{4}-(?:0[1-9]|1[0-2])\.[0-9a-f]{8}\.jsonl):(0|[1-9][0-9]{0,15}))?(\+pairs)?$/;
const RECOVER_REINDEX_CURSOR_RE = /^reindex(?::(0|[1-9][0-9]{0,15}))?(\+pairs)?$/;

/** The recovery step's cursor as derivation_state ('recover', <bind ms>) keeps it and status prints it (§9.14):
 *  `<phase>` at a phase's start, `index:<YYYY-MM>.<writer>.jsonl:<byte offset>` or `apply:…` inside the journal,
 *  `reindex:<blob_id>` inside the FTS re-derivation, then `+pairs` once the index pass learned a pair the store
 *  lacked. It is advanced in the same transaction as the records it applies. */
export function formatRecoverCursor(c) {
  if (!RECOVER_PHASES.includes(c.phase)) throw new TypeError(`formatRecoverCursor: phase outside RECOVER_PHASES: ${String(c.phase)}`);
  let s = c.phase;
  if (c.phase === 'reindex') {
    if (c.blobId !== null) s += `:${c.blobId}`;
  } else if (c.file !== null) {
    s += `:${c.file}:${c.offset}`;
  }
  return c.pairsAdded ? `${s}+pairs` : s;
}

/** The cursor back, or null when it is not one: never a guess at where to resume. A NULL column (a step just
 *  registered by a binding verb) is the step's start. */
export function parseRecoverCursor(s) {
  if (s === null) return { phase: RECOVER_PHASES[0], file: null, offset: 0, blobId: null, pairsAdded: false };
  if (typeof s !== 'string') return null;
  const j = RECOVER_JOURNAL_CURSOR_RE.exec(s);
  if (j !== null) {
    const offset = j[3] === undefined ? 0 : Number(j[3]);
    if (!Number.isSafeInteger(offset)) return null;
    return { phase: j[1], file: j[2] ?? null, offset, blobId: null, pairsAdded: j[4] !== undefined };
  }
  const r = RECOVER_REINDEX_CURSOR_RE.exec(s);
  if (r !== null) {
    const blobId = r[1] === undefined ? null : Number(r[1]);
    if (blobId !== null && !Number.isSafeInteger(blobId)) return null;
    return { phase: 'reindex', file: null, offset: 0, blobId, pairsAdded: r[2] !== undefined };
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

/** One merge group's records by record time, each file's own order kept, a tie to the earlier file in the group.
 *  A journal block (a `file` record and its `spool` records) shares one `t`, so a block is never split. */
function mergeJournalByTime(files) {
  const pos = files.map(() => 0);
  const out = [];
  for (;;) {
    let pick = -1;
    for (let f = 0; f < files.length; f += 1) {
      if (pos[f] >= files[f].recs.length) continue;
      if (pick < 0 || files[f].recs[pos[f]].t < files[pick].recs[pos[pick]].t) pick = f;
    }
    if (pick < 0) return out;
    out.push(files[pick].recs[pos[pick]].read);
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
  const stream = orderJournalFiles(kept).flatMap((g) => mergeJournalByTime(g.map((n) => byName.get(n))));
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
/** The combining marks FTS5 unicode61 drops inside a token at remove_diacritics 1, the default B1's `porter unicode61`
 *  tables use: U+0300-0304, U+0306-030C, U+030F, U+0311, U+031B, U+0323-0328, U+032D-032E, U+0330-0331. Measured
 *  against node:sqlite on every code point U+0080..U+2FFFF (the case `beltFold is unicode61's own fold`); every other
 *  mark is a boundary to unicode61, so it is one to the belt. */
const isDroppedMark = (c) => (c >= 0x300 && c <= 0x304) || (c >= 0x306 && c <= 0x30c) || c === 0x30f || c === 0x311
  || c === 0x31b || (c >= 0x323 && c <= 0x328) || c === 0x32d || c === 0x32e || c === 0x330 || c === 0x331;
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
    }),
    defaults: Object.freeze({ full: false, cursor: null }),
    positional: Object.freeze({ min: 1, max: ANY_COUNT }),
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
 *  D-4714 (history-grep-pending-until-backfilled) */
export function decideGrepIndex({ probe, table, completed }) {
  if (probe === 'threw') return { ok: false, exit: EXIT.DB, reason: 'probe-failed' };
  if (probe !== 'present') return { ok: false, exit: EXIT.FTS_UNAVAILABLE, reason: 'fts5-absent' };
  if (!table || !completed) return { ok: false, exit: EXIT.FTS_UNAVAILABLE, reason: 'fts-pending' };
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
  const phraseTokens = (term) => unicode61Words(String(term).replace(/\*+$/, '')).map(({ text }) => foldToken(text)).filter((t) => t.length > 0);
  for (const term of terms) {
    const raw = String(term);
    // FTS5 reads a terminal star as a prefix on the phrase's LAST token (`"error hand"*`), never on the first.
    const prefix = raw.endsWith('*');
    const needles = phraseTokens(raw);
    if (needles.length === 0) continue;
    const stems = needles.map(porterStem);
    // Whether the candidate (already folded) is needle `k`: the last needle of a prefix term by prefix, else by Porter stem.
    const is = (folded, k) => (prefix && k === needles.length - 1 ? folded.startsWith(needles[k]) : porterStem(folded) === stems[k]);
    const words = /[\p{L}\p{N}\u0300-\u036f]+/gu;
    for (let first = words.exec(content); first !== null; first = words.exec(content)) {
      if (!is(foldToken(first[0]), 0)) continue;
      // Probe the phrase with a separate cursor, so its later words remain candidate starts in the main scan.
      const phrase = /[\p{L}\p{N}\u0300-\u036f]+/gu;
      phrase.lastIndex = first.index + first[0].length;
      let last = first;
      let matches = true;
      for (let offset = 1; offset < needles.length; offset += 1) {
        const next = phrase.exec(content);
        if (next === null || !is(foldToken(next[0]), offset)) {
          matches = false;
          break;
        }
        last = next;
      }
      if (!matches) continue;
      const matchAt = first.index;
      const matchLen = last.index + last[0].length - matchAt;
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
