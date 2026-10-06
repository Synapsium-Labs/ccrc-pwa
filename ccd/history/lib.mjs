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
// `project-unreadable`, `store-zero-byte`, `store-schema-missing`.
const REASON_ROWS = [
  [EXIT.REFUSED, [
    'bad-args', 'regex-syntax', 'regex-refused', 'regex-timeout', 'cross-project', 'out-of-scope',
    'project-unreadable', 'headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'no-identity',
    'bad-id', 'apply-in-session', 'needs-tty', 'irreversible-in-pane', 'history-off', 'span-pruned',
    'older-than-floor', 'reparse-too-many', 'workspace-unreadable', 'harness-unsupported',
    'harness-unreadable', 'generation-unreadable', 'writer-absent', 'adopt-refused', 'restore-refused',
    'rebuild-refused', 'migrate-refused',
  ]],
  [EXIT.WRITER_BUSY, ['writer-busy']],
  [EXIT.DB, [
    'probe-failed', 'store-zero-byte', 'store-schema-missing', 'store-root-dangling', 'store-missing',
    'store-mismatch', 'store-unbound', 'store-unreachable', 'store-unmeasured', 'store-recoverable',
    'store-wal-orphaned', 'store-not-wal', 'migration-pending',
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
export const SPOOL_ID_MAX = 224;                    // `.draining/<id>.<ms>.<pid>.jsonl` fits 255
export const STATFS_DEADLINE_MS = 5000;             // the writer's free-space probe (§9.3)
export const CLI_STAT_DEADLINE_MS = 2000;           // the CLI's reachability stat (§8.1)
export const TMUX_DEADLINE_MS = 2000;               // `tmux display-message -p -t` (§8.2)
export const REPARSE_MAX_TARGETS = 500;
export const CARRIER_KILL_S = 600;                  // == the unit's TimeoutStartSec=10min (DM43)
export const EXPORT_MARGIN_DAYS = 30;
export const LINE_MAX = 16 * 1024 * 1024;           // a longer transcript line is stored raw-only
export const CHUNK_BYTES = 16 * 1024 * 1024;        // parsed lines per ingest transaction
export const RUN_BUDGET_MS = 90_000;                // one budget per run, never reset per file
export const RUN_BUDGET_BYTES = 512 * 1024 * 1024;
export const CAP_DEFAULT_GB = 50;
export const CAP_WARN_PCT = 80;
export const FLOOR_GIB = 15;
export const FLOOR_PCT = 10;
export const EPOCH_CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SCAN_INTERVAL_MS = 30 * 60 * 1000;
export const SIDECAR_FTS_BYTES = 512 * 1024;
export const SECRET_MIN_LEN = 20;
export const SECRET_SEGMENT_MIN = 12;
export const DEFAULT_COPY_BPS = 10_000_000;
export const MAX_INTERRUPTED_ATTEMPTS = 2;
export const SCHEMA_VERSION = 1;
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
export const EPOCH_CAUSES = Object.freeze(['startup', 'resume', 'clear', 'import']);
export const DECLARED_BY = Object.freeze(['hook', 'registry', 'journal', 'operator']);
/** `ingest_files.last_error_code`: a closed vocabulary, never `e.message`. */
export const ERROR_CODES = Object.freeze(['json-parse', 'not-object', 'line-too-long', 'read-failed', 'stat-failed', 'open-refused', 'parser-crash']);
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
/** The one word a scheduled pass prints as `history-sweep: <word>` when it
 *  ends without a tick (§5.3: no DB is open to count it in). Plan-chosen
 *  where the spec names the condition only: `schema-newer`, `held`. */
export const PASS_WORDS = Object.freeze([
  'store-create-refused-role', 'store-unreachable', 'journal-unwritable', 'store-recoverable',
  'store-wal-orphaned', 'store-missing', 'store-mismatch', 'store-unbound', 'store-unmeasured',
  'store-root-dangling', 'store-zero-byte', 'store-not-wal', 'schema-newer', 'migration-refused',
  'migration-needs-op', 'held', 'off',
]);
/** Every durability word `status --json` reports and doctor's `_check_history`
 *  prints (§9.6, O14), with its class. Plan-chosen spellings of conditions the
 *  spec names in prose: `first-tick-pending`, `tick-stale`, `lag-high`,
 *  `at-cap`, `capture-paused-low-disk`, `mode-wrong`, `schema-newer`,
 *  `cap-malformed`, `cap-near`, `breaker-open`, `roster-unreadable`,
 *  `root-is-symlink`, `fts-unavailable`, `status-unreadable`. */
const healthRows = (cls, words) => words.map((w) => [w, cls]);
const healthEntries = [
  // D-4168: within the shim's grace with no tick yet, doctor answers PASS, not §9.6 step 3's WARN.
  ...healthRows('pass', ['first-tick-pending']),
  ...healthRows('warn', [
    'off', 'recovering', 'op-running', 'catching-up', 'lag-unmeasured', 'fts-unavailable', 'cap-malformed',
    'redact-source-unreadable', 'cap-near', 'breaker-open', 'roster-unreadable', 'root-is-symlink',
    'export-due', 'export-paused-low-disk', 'retention-unmeasured', 'retention-lowered',
    'export-segment-missing', 'journal-record-skipped', 'journal-growth',
  ]),
  ...healthRows('fail', [
    'tick-stale', 'lag-high', 'at-cap', 'capture-paused-low-disk', 'mode-wrong', 'schema-newer',
    'store-not-wal', 'store-unmeasured', 'recovery-stalled', 'store-root-dangling', 'store-missing',
    'store-mismatch', 'store-unbound', 'store-unreachable', 'store-recoverable', 'store-wal-orphaned',
    'store-zero-byte', 'migration-refused', 'migration-needs-op', 'journal-unwritable',
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
