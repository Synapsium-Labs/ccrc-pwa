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
  'store-root-dangling', 'store-zero-byte', 'store-schema-missing', 'store-not-wal', 'schema-newer', 'migration-refused',
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
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
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
 *  still a line — a partial one, which parseSpoolLine rejects. */
export function splitSpoolText(text) {
  const out = [];
  let ordinal = 0;
  for (const raw of String(text).split('\n')) {
    if (raw === '') continue;
    ordinal += 1;
    out.push({ ordinal, raw });
  }
  return out;
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
  if (typeof name !== 'string' || Buffer.byteLength(name, 'utf8') > DRAINING_NAME_MAX) return false;
  const m = /^(.+)\.([0-9]{1,16})\.([0-9]{1,10})\.jsonl$/.exec(name);
  return m !== null && idOk(m[1]);
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
export function withinBudget({ elapsedMs, bytes }) {
  return elapsedMs < RUN_BUDGET_MS && bytes < RUN_BUDGET_BYTES;
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
 *  D-4187 D-4179
 *  D-4182 */
export function planRun(i) {
  if (i.historyOff) return haltRun('off', null);
  if (i.store.act === 'refuse') return haltRun('hold', i.store.word);
  if (i.free.state === 'unsettled') return haltRun('hold', 'store-unreachable');
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
 *  after it (`epoch_unconfirmed`, or `epoch_unconfirmed_superseded` when the
 *  caller found the observed `.uuid` to be a later clear line's sid of the
 *  same id, §14 risk 24). An unreadable `.uuid` neither confirms nor drops
 *  early. D-4190 */
export function decideCandidate({ sid, journaledMs, nowMs, currentUuid, supersededByLaterClearOfSameId }) {
  if (nowMs - journaledMs > EPOCH_CONFIRM_WINDOW_MS) return { kind: 'drop', superseded: supersededByLaterClearOfSameId === true };
  if (currentUuid.state === 'value' && currentUuid.value === sid) return { kind: 'confirm', by: 'later-tick' };
  return { kind: 'wait' };
}

/** §6.1's location rule for a clear epoch `.uuid` no longer names (two quick
 *  `/clear`s): its transcript's first uuid row's `cwd` against the observed
 *  `.workdir`. Realpaths decide when both resolved; verbatim strings decide
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
