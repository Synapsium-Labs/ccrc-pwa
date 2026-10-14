#!/usr/bin/env node
// ccd/history/cli.mjs — `ccrc history`, reached by ONE dispatch line in ccd/ccrc
// (`history) exec node --no-warnings "$CCRC_HERE/history/cli.mjs" "$@" ;;`; spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §5.1, §8).
//
// `status [--json]` (§8.4) is a BOX verb: identity-free (§8.2; D-4249
// history-box-verbs-identity-free) — it reads no TMUX_PANE, runs no tmux and derives no session id — and it
// writes NO spool line (D-4250 history-box-verbs-no-counter-line), because doctor runs it on every `ccrc doctor`.
// W1-B2 adds the read verbs (READ_VERBS, in the dispatcher block that replaced `main`) and, from its Task 19, the operator verbs. An unknown verb answers exit 2 `bad-args` with the usage.
//
// Departures carried here: D-4167 (history-coverage-this-box: every answer carries store_id and coverage),
// D-4169 (history-exit-codes-4-and-9) and D-4171 (history-reasons-by-exit) for the exit words, D-4183
// (history-shim-role-gated: a server role answers 9), D-4184, D-4185, D-4186 and D-4188 (the pending, recoverable,
// unbound and wal-orphaned refusals, decided by lib's table), D-4187 (history-store-unreachable: the 2 s stat) and
// D-4212 (history-cli-reads-store-version: user_version first, v1 columns only).
//
// L4 delivery (§6.4): it MEASURES and hands what it measured to lib.mjs's decisions — decideCliStore, §8.3's
// no-store table, here; decideStatusRead, the store-not-wal refusal and the migration word (Task 28F); deriveHealth
// from Task 28. It decides nothing itself.
//
// THE HANDLE IS READ-ONLY (§8.1): store.mjs's openReader (readOnly + query_only). Before any open, after the
// Darwin and role rows (§8.3), it stats db/history.db asynchronously under CLI_STAT_DEADLINE_MS, so a dead
// volume answers exit 5 store-unreachable instead of hanging doctor (RR15). A stat that never settles pins a
// libuv thread, which would keep the event loop alive: the process therefore ends with an explicit exit.
//
// COST (the review's focus): status reads meta, counters, the newest three ticks rows by primary key, the
// recover step of derivation_state by primary key, the outbox's row count, and file and directory stats. It
// never scans entries, blobs or memberships. Every statement it prepares besides its PRAGMAs is in
// STATUS_SQL, which history-cli.test.ts runs through EXPLAIN QUERY PLAN against a seeded store.
//
// status prints no recalled text: ids, paths, counts and words only. The read verbs print recalled text: each
// field goes through redactField before any cut, and every output through the structure-aware final belt (§8.3, D-4613).
import { existsSync, lstatSync, readdirSync, realpathSync, statSync, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXIT, COVERAGE, SCHEMA_VERSION, UUID_RE, HARNESSES, CLI_STAT_DEADLINE_MS,
  historyPaths, readBoxEnvValue, decideCliStore, CONTROL_FILE_MAX, decideStatusRead, capOf, floorThreshold, exportHorizonDays, parseOpMarker,
  decideStatusReadFailure, RETENTION_STATE_META, decideGrepIndex, parsePassMarker, decidePassLive,
} from './lib.mjs';
import { StoreError, measureStoreFacts, openReader, userVersion, measuredSize, readBounded, FTS_GATE_SQL, ftsGateFactsOn } from './store.mjs';
// The health block's own imports (task 28). Namespace imports, so this block
// binds no name the status code above already imported.
import * as healthLib from './lib.mjs';
import * as healthStore from './store.mjs';
import * as healthFs from 'node:fs';
import * as healthPath from 'node:path';

// The read verbs' imports (W1-B2 Task 10). Names cli.mjs's earlier imports do not already bind. StoreError,
// openReader and userVersion are already bound by B1's './store.mjs' import above, and decideStatusRead and
// decideStatusReadFailure by B1's './lib.mjs' import: importing a binding twice is a SyntaxError.
// loadSecrets is imported statically: B1's ring census reds on any import() in a shipped module, and sweep.mjs's
// entry guard keys on process.argv[1], so importing it runs nothing.
import { closeSync, constants as FS, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  REASONS, TMUX_DEADLINE_MS, SCOPE_SOURCES, SCHEMA_ADDED, READ_VERBS, idOk, makePairIndex, redactFinalJson, redactFinalText, redactFinalLines, makeBelt, beltUnits,
  REDACT_SOURCES_META, parseRedactSources,
  decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, decideRecallOffPreflight, paneOk,
  decideRecallOff, recallOffPath, parseSpoolLine, SCOPE_FAMILIES_JSON_MAX,
  readEnvelope, shownLine, nextLine,
} from './lib.mjs';
import { loadSecrets, procIdentityOf } from './sweep.mjs';
import { runTree, grepVerb, describeVerb, expandVerb, familiesOf, transcriptsOf, scopeHeader } from './recall.mjs';
import { spawn as spawnOp } from 'node:child_process';
import { isatty as isattyOp } from 'node:tty';
import { recoverStepAt as opRecoverStepAt, storedVersionAt as opStoredVersionAt } from './store.mjs';

process.umask(0o077);

/** Every statement status prepares besides its PRAGMAs (the cost pin reads this object). */
export const STATUS_SQL = Object.freeze({
  meta: 'SELECT k, v FROM meta',
  counters: 'SELECT name, n FROM counters',
  ticks: 'SELECT tick_id, ts_ms, lag_ms, bytes, files_behind, bytes_behind FROM ticks ORDER BY tick_id DESC LIMIT 3',
  recover: "SELECT version, cursor FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL ORDER BY version DESC LIMIT 1",
  outbox: 'SELECT count(*) AS n FROM journal_outbox',
  // The grep gate's three statements are store.mjs's (H-163): one spelling, shared with recall.mjs's indexGate.
  ftsTable: FTS_GATE_SQL.table,
  ftsBackfill: FTS_GATE_SQL.backfill,
  ftsRebuild: FTS_GATE_SQL.rebuild,
  breaker: 'SELECT count(*) AS n FROM breaker WHERE open_until_ms > ?',
  metaKey: 'SELECT v FROM meta WHERE k = ?',
});

/** What a human reads for each non-zero exit (§8.3's table; the word itself is in `reason`). */
const EXIT_MEANING = Object.freeze({
  [EXIT.REFUSED]: 'refused',
  [EXIT.NOT_FOUND]: 'not found on this box (coverage=this-box)',
  [EXIT.DB]: 'store error',
  [EXIT.NOT_INDEXED]: 'not indexed yet: the first tick has not created the store, or this store has no rows yet',
  [EXIT.RECALL_OFF]: 'recall is off for this session (the eval control arm; counted)',
  [EXIT.NO_STORE]: 'no store on this box (macOS, a server role, or never installed): stop, do not retry',
});

/** The inputs §8.3's table does not reach on its first rows (Darwin, a server role, an unsettled stat):
 *  passed as unmeasured, so the table, not this file, decides every answer. */
function unmeasuredFacts(role) {
  const unread = { state: 'unreadable' };
  return {
    role, dbDir: 'unmeasured', storeId: unread, pending: unread, writer: unread, db: 'unmeasured',
    dbStoreId: unread, wal: false, shm: false, journalStoreDirs: [], backupsDb: [],
  };
}

/** Bytes of a file, trimmed, or null when it cannot be read: one bounded nonblocking open that refuses a link
 *  (store.mjs `readBounded`, D-4347 (history-planted-entries-never-wedge)), so a FIFO is never waited on. */
function readTrimmed(p) {
  const r = readBounded(p, CONTROL_FILE_MAX, false);
  return r.state === 'value' ? r.value.trim() : null;
}

function listNames(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** CCRC_ROLE exactly as doctor's _check_skills reads it (ccd/ccrc-doctor-checks:3016): a regular, readable
 *  file, one key, readBoxEnvValue's rules (O53); anything else is '' (not server). */
function readRole(P) {
  const f = readBounded(P.ccrcEnv, CONTROL_FILE_MAX, true);
  if (f.state !== 'value') return '';
  const r = readBoxEnvValue(f.value, 'CCRC_ROLE');
  return r.found ? r.value : '';
}

/** A name's presence, never folded (IV5): ENOENT is absent; any other failure is unmeasured. */
function presence(p) {
  try {
    lstatSync(p);
    return 'present';
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'ENOENT' ? 'absent' : 'unmeasured';
  }
}

/** A promise raced against a deadline: {settled:false} when it did not answer in time. */
function settleWithin(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ settled: false }), ms);
    promise.then(
      (value) => { clearTimeout(t); resolve({ settled: true, value }); },
      (error) => { clearTimeout(t); resolve({ settled: true, error }); },
    );
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'EPERM';
  }
}

function parseJsonOr(text, fallback) {
  if (text === undefined || text === null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

/** The envelope's full shape with nothing measured: every --json answer has every field (§8.3), and every
 *  answer carries store_id and coverage (§6.9, C45). */
function emptyEnvelope(P) {
  return {
    v: 1, exit: EXIT.OK, store_id: null, coverage: COVERAGE[0], role: '',
    user_version: null, code_version: SCHEMA_VERSION, migration: 'none',
    lag: 'unmeasured', indexed_through_ms: null, last_tick_ms: null, bytes_behind_last3: [],
    size_bytes: null, cap_gb: capOf(null).gb, cap_file: P.cap, cap_malformed: false, capture_pause: '',
    free_bytes: null, threshold_bytes: null, fts: null, snapshot_bytes: null,
    journal: { bytes: 0, newest_month: null, outbox: 0, growth_30d_bytes: 0, skipped: 0, unwritable: false, other_store_dirs: [] },
    export: {
      [HARNESSES[0]]: {
        horizon_days: null, retention_days: null, due_blobs: 0, overdue_blobs: 0, segments: 0, segment_bytes: 0,
        oldest_row_ms: null, first_due_ms: null, first_deletion_ms: null,
      },
    },
    retention: { lowered: null, unmeasured: [] },
    redact_unreadable: [],
    recovering: null, op: null, pass: null, history_off: false, shim_mtime_ms: null,
    counters: {},
    health: { pass: null, warn: [], fail: [] },
  };
}

function decided(env, d) {
  env.exit = d.exit;
  if (d.reason !== undefined) env.reason = d.reason;
  return env;
}

/** The facts on the home filesystem, measured whatever the store's state: the shim, the switch, the cap file
 *  (named, so doctor never spells it, O13) and the op marker. */
function boxFacts(env, P) {
  try { env.shim_mtime_ms = Math.trunc(lstatSync(P.shim).mtimeMs); } catch { env.shim_mtime_ms = null; }
  env.history_off = existsSync(P.off);
  // The sweep's capText rule (Task 14), spelled again because cli.mjs imports only loadSecrets from sweep.mjs, statically: absent is
  // null (the default, not malformed); an unreadable file is '' — malformed, so doctor WARNs (§9.3).
  const cr = readBounded(P.cap, CONTROL_FILE_MAX, true);
  const capRead = cr.state === 'absent' ? null : cr.state === 'value' ? cr.value : '';
  const cap = capOf(capRead);
  env.cap_gb = cap.gb;
  env.cap_malformed = cap.malformed;
  const text = readTrimmed(P.op);
  const m = text === null ? null : parseOpMarker(text);
  env.op = m === null ? null : { verb: m.verb, pid: m.pid, alive: pidAlive(m.pid), start_ms: m.startMs };
  // D-5016 (history-doctor-reads-a-live-pass): the scheduled pass's marker. `live` is the IDENTITY test (the pid's start
  // time and the boot id measured now equal the marker's), never `kill(pid, 0)`, which a reused pid answers; anything
  // unmeasurable (no /proc, a dead pid, an unreadable or malformed marker) is not live, and a malformed one is no marker.
  const pt = readTrimmed(P.pass);
  const pm = pt === null ? null : parsePassMarker(pt);
  env.pass = pm === null ? null : { pid: pm.pid, start_ms: pm.startMs, live: decidePassLive(pm, procIdentityOf(pm.pid)) };
}

/** This store's journal (bytes, newest UTC month) and every OTHER store's directory beside it, listed and
 *  never read (§9.10 "Journal directory"). */
function journalFacts(env, P) {
  const dirs = listNames(P.journalDir).filter((n) => UUID_RE.test(n));
  env.journal.other_store_dirs = dirs.filter((n) => n !== env.store_id).sort();
  if (env.store_id === null) return;
  const own = join(P.journalDir, env.store_id);
  let bytes = 0;
  let newest = null;
  for (const n of listNames(own)) {
    const m = /^([0-9]{4}-[0-9]{2})\.[0-9a-f]{8}\.jsonl$/.exec(n);
    if (m === null) continue;
    try { bytes += statSync(join(own, n)).size; } catch { /* removed meanwhile */ }
    if (newest === null || m[1] > newest) newest = m[1];
  }
  env.journal.bytes = bytes;
  env.journal.newest_month = newest;
}

/** Free space on db/'s filesystem and the floor's threshold (§9.3), under the CLI's own deadline; unsettled or
 *  failed reads leave both null. Doctor's pause FAILs read the sweep's recorded capture_pause, never this. */
async function freeSpace(env, P) {
  const r = await settleWithin(fsp.statfs(P.dbDir), CLI_STAT_DEADLINE_MS);
  if (!r.settled || r.value === undefined) return;
  env.free_bytes = r.value.bavail * r.value.bsize;
  env.threshold_bytes = floorThreshold(r.value.blocks * r.value.bsize);
}

/** The newest kept pre-migration snapshot's size (§6.11), or null. */
function snapshotBytes(P) {
  let best = null;
  for (const n of listNames(P.backups)) {
    const m = /^pre-v([0-9]+)\.db$/.exec(n);
    if (m !== null && (best === null || Number(m[1]) > best.v)) best = { v: Number(m[1]), n };
  }
  if (best === null) return null;
  try { return statSync(join(P.backups, best.n)).size; } catch { return null; }
}

/** The FTS word (§9.1): the three facts grep's index gate reads (recall.mjs's indexGate), through the same lib decision,
 *  so status and grep never disagree: the read-only probe, whether derivation has made the table, the backfill row
 *  ('fts', 1) with its completed_ms, and an open doctor --repair rebuild row. `ready` is the gate's ok; anything else is
 *  the word grep answers exit 7 or 5 by (fts5-absent, fts-pending, probe-failed). A probe that throws is probe-failed,
 *  never folded into absent. Only v1 columns are named (D-4604 history-status-fts-word-is-the-grep-gate). */
function ftsWord(db) {
  const gate = decideGrepIndex(ftsGateFactsOn(db));
  return gate.ok ? 'ready' : gate.reason;
}

/** A bound store, read through the read-only handle. user_version is read first, and only v1 columns are
 *  named: migrations are additive, so they exist at every later version (§6.11, DM44). */
function readStore(env, P, nowMs) {
  const db = openReader(P.dbFile);
  try {
    const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    const uv = userVersion(db);
    const meta = new Map(db.prepare(STATUS_SQL.meta).all().map((r) => [r.k, r.v]));
    const num = (k) => {
      const v = meta.get(k);
      return v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    env.store_id = meta.get('store_id') ?? env.store_id;
    env.user_version = uv;
    const read = decideStatusRead({ userVersion: uv, journalMode: mode, recordedMigration: meta.get('migration') });
    env.migration = read.migration;
    env.size_bytes = measuredSize(db, P.dbFile);
    const pause = meta.get('capture_pause');
    env.capture_pause = pause === 'at-cap' || pause === 'low-disk' ? pause : '';
    const zero = num('last_zero_behind_ms');
    env.indexed_through_ms = zero;
    env.lag = zero === null ? 'unmeasured' : Math.max(0, Math.floor((nowMs - zero) / 1000));
    const ticks = db.prepare(STATUS_SQL.ticks).all();
    env.last_tick_ms = ticks.length > 0 ? ticks[0].ts_ms : null;
    env.bytes_behind_last3 = ticks.map((t) => t.bytes_behind);
    env.counters = Object.fromEntries(db.prepare(STATUS_SQL.counters).all().map((r) => [r.name, r.n]));
    const rec = db.prepare(STATUS_SQL.recover).get();
    env.recovering = rec === undefined ? null : { step: `recover/${rec.version}`, cursor: rec.cursor ?? '' };
    env.journal.outbox = db.prepare(STATUS_SQL.outbox).get().n;
    env.journal.growth_30d_bytes = num('journal_growth_30d') ?? 0;
    env.journal.skipped = num('journal_skipped') ?? 0;
    env.journal.unwritable = (meta.get('journal_unwritable') ?? '') !== '';
    env.fts = ftsWord(db);
    const retention = num('retention_min');
    const ex = env.export[HARNESSES[0]];
    ex.retention_days = retention;
    ex.horizon_days = retention === null ? null : exportHorizonDays(retention);
    ex.due_blobs = num('export_due') ?? 0;
    ex.overdue_blobs = num('export_overdue') ?? 0;
    ex.oldest_row_ms = num('oldest_row_ms');
    ex.first_due_ms = num('first_due_ms');
    ex.first_deletion_ms = num('first_deletion_ms');
    env.retention.lowered = parseJsonOr(meta.get('retention_lowered'), null);
    env.retention.unmeasured = [...meta]
      .filter(([k, v]) => k.startsWith(RETENTION_STATE_META) && v === 'unmeasured')
      .map(([k]) => k.slice(RETENTION_STATE_META.length))
      .sort();
    const unreadable = parseJsonOr(meta.get('redact_unreadable'), []);
    env.redact_unreadable = Array.isArray(unreadable) ? unreadable.filter((x) => typeof x === 'string') : [];
    decided(env, read);
  } finally {
    db.close();
  }
}

/** readStore with its failure made an answer (§8.3: ONE envelope, exit 5, for a DB or schema error). The throw is
 *  MEASURED here (a StoreError's word; SQLite's ERR_SQLITE_ERROR) and lib's decideStatusReadFailure decides; the
 *  error's message goes to stderr. Anything else is a defect in this file and stays exit 1 (review 316 F11; D-4313). */
function readStoreAnswered(env, P, nowMs) {
  try {
    readStore(env, P, nowMs);
  } catch (e) {
    const d = decideStatusReadFailure({
      storeWord: e instanceof StoreError ? e.word : null,
      sqliteError: e !== null && typeof e === 'object' && e.code === 'ERR_SQLITE_ERROR',
    });
    if (d === null) throw e;
    errLine(`ccrc history: ${d.reason}: ${e.message}`);
    decided(env, d);
  }
}

/** What §8.3's no-store table reads, measured in the table's own order (W1-B2 Task 10: shared by status and the
 *  read verbs, so the two never measure a store differently):
 *   - Darwin and the recorded role first: they answer before anything else is touched;
 *   - then the 2 s reachability stat of db/history.db; one that never settles reads unsettled, and nothing
 *     behind it is measured;
 *   - then every presence input (measureStoreFacts), with the shim measured beside them. */
export async function measureReach(home) {
  const P = historyPaths(home);
  const darwin = process.platform === 'darwin';
  const role = readRole(P);
  if (darwin || role === 'server') return { darwin, role, facts: unmeasuredFacts(role), statSettled: true, shim: 'unmeasured' };
  const stat = await settleWithin(fsp.stat(P.dbFile), CLI_STAT_DEADLINE_MS);
  if (!stat.settled) return { darwin, role, facts: unmeasuredFacts(role), statSettled: false, shim: presence(P.shim) };
  return { darwin, role, facts: measureStoreFacts(home, role), statSettled: true, shim: presence(P.shim) };
}

/** decideCliStore's input from a reach measurement. */
function cliFactsOf(reach) {
  return { ...reach.facts, darwin: reach.darwin, statSettled: reach.statSettled, shim: reach.shim };
}

/** `status --json`'s envelope (§8.3, §8.4). The no-store answer is §8.3's table over measureReach. */
export async function statusEnvelope(home, nowMs) {
  const P = historyPaths(home);
  const env = emptyEnvelope(P);
  const reach = await measureReach(home);
  env.role = reach.role;
  const d = decideCliStore(cliFactsOf(reach));
  if (reach.darwin || reach.role === 'server') return decided(env, d);
  boxFacts(env, P);
  if (!reach.statSettled) {
    const id = readTrimmed(P.storeId);
    env.store_id = id !== null && UUID_RE.test(id) ? id : null;
    return decided(env, d);
  }
  const facts = reach.facts;
  if (facts.storeId.state === 'value') env.store_id = facts.storeId.value;
  else if (facts.dbStoreId.state === 'value') env.store_id = facts.dbStoreId.value;
  await freeSpace(env, P);
  env.snapshot_bytes = snapshotBytes(P);
  // B1's answering wrapper, never bare readStore: a failed read is ONE exit-5 envelope (review 316 F11).
  if (d.read) readStoreAnswered(env, P, nowMs);
  else decided(env, d);
  journalFacts(env, P);
  return env;
}

/** The human form: §8.3's header first, then one line per field group. */
export function render(env) {
  const lines = [];
  const through = env.indexed_through_ms === null ? 'unmeasured' : new Date(env.indexed_through_ms).toISOString();
  const lag = env.lag === 'unmeasured' ? 'unmeasured' : `${env.lag}s`;
  lines.push(`scope=box coverage=${env.coverage} store=${env.store_id ?? 'none'} indexed-through=${through} lag=${lag}`);
  if (env.exit !== EXIT.OK) {
    lines.push(`exit ${env.exit}${env.reason === undefined ? '' : ` ${env.reason}`}: ${EXIT_MEANING[env.exit] ?? 'see status --json'}`);
  }
  if (env.user_version !== null) {
    lines.push(`store: user_version=${env.user_version} code_version=${env.code_version} migration=${env.migration} `
      + `size=${env.size_bytes} cap=${env.cap_gb}GB (${env.cap_file}${env.cap_malformed ? ', malformed' : ''}) `
      + `pause=${env.capture_pause || 'none'} fts=${env.fts}`);
    lines.push(`disk: free=${env.free_bytes ?? 'unmeasured'} threshold=${env.threshold_bytes ?? 'unmeasured'} snapshot=${env.snapshot_bytes ?? 'none'}`);
    lines.push(`journal: bytes=${env.journal.bytes} newest=${env.journal.newest_month ?? 'none'} outbox=${env.journal.outbox} `
      + `growth_30d=${env.journal.growth_30d_bytes} other_stores=${env.journal.other_store_dirs.join(',') || 'none'}`);
    for (const [h, ex] of Object.entries(env.export)) {
      lines.push(`export(${h}): horizon=${ex.horizon_days ?? 'unmeasured'}d retention=${ex.retention_days ?? 'unmeasured'}d `
        + `due=${ex.due_blobs} overdue=${ex.overdue_blobs} segments=${ex.segments}`);
    }
  }
  const op = env.op === null ? 'none' : `${env.op.verb}/${env.op.pid}${env.op.alive ? '' : ' (dead)'}`;
  const recovering = env.recovering === null ? 'no' : `${env.recovering.step} ${env.recovering.cursor}`;
  lines.push(`op=${op} off=${env.history_off ? 'yes' : 'no'} recovering=${recovering}`);
  const names = Object.keys(env.counters).sort();
  if (names.length > 0) lines.push(`counters: ${names.map((n) => `${n}=${env.counters[n]}`).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

// ── W1-B2: the verb dispatcher and the read verbs' delivery (spec §8.1–§8.4, §8.8; W1-B2 Task 10) ──────────
//
// `ccrc history <verb>` answers two kinds of verb (§8.2):
//   - BOX verbs derive no identity: `status`; `recall-off`, which in B2 answers only its refusals (the verb that
//     writes ships with W2); and, from Task 19, the operator verbs.
//   - READ verbs (READ_VERBS) need one, from tmux. They run in this order, each step a lib decision over what
//     this file measured:
//     1. the argument whitelist (parseReadArgs; READ_OPTIONS is the one list per verb);
//     2. §8.3's Darwin and recorded-role rows (decideCliStore): 9 before any identity, so a server box needs no
//        pane;
//     3. the identity (decideIdentity over a bounded `tmux display-message -p -t "$TMUX_PANE" '#S'`);
//     4. the harness (decideHarness over $REG/<id>.harness: unsupported and unreadable are refusals, never 6);
//     5. the generation (resolveGeneration: CCRC_SESSION_GENERATION, then $REG/<id>.generation, then newest);
//     6. the rest of §8.3's table, after the 2 s reachability stat (measureReach); no DB open before it;
//     7. the read-only open (openReader), the journal mode (decideStatusRead: not WAL is store-not-wal), and the
//        store's own version;
//     8. the scope (decideScope), then its families and their transcripts; merged families and unconfirmed
//        epochs are never read;
//     9. the pair index and its belt (redact_hashes, plus the frozen list and the declared secretsFiles the last
//        tick recorded, read now) for output redaction (§8.3 layers 1 and 4).
//   A failed read of the admitted store, in any step from 7 on or in the verb's own read, is ONE exit-5 answer
//   (decideStatusReadFailure, as status gives); any other throw is a defect, exit 1.
//   The verbs' executors are recall.mjs's. This block decides nothing: it renders, and runs the second belt (§8.3,
//   D-4613) STRUCTURE-AWARE: redactFinalJson over a --json envelope's value before JSON.stringify serialises it,
//   redactFinalText over human text line by line and tag by tag. No pass reads serialised structure.

/** Every bad-args answer prints this on stderr. */
const USAGE = [
  'usage: ccrc history <verb> [options]',
  '  read verbs (in a cc- tmux pane): tree [--depth N] | grep <words> | describe <id | pasted line> | expand <id>',
  '    each also takes one of: --session <id> | --project | --workspace; and --json',
  '  box verbs: status [--json]',
  '  operator verbs: import | prune | reparse | doctor [--repair | --backup | --migrate | --adopt | --restore <file> | --rebuild [--store-id <uuid>]]',
  '  every exit code and reason: the ccrc-history skill',
].join('\n');

/** No pairs: a refusal prints no recalled text, but every output still takes the final belt's context and shape
 *  layers (§8.3). */
const NO_PAIRS = makePairIndex([]);

/** One stderr line carrying a thrown error's text, through redactFinalLines (D-4613 round 5: never framed, so no tag split) like every other output (§8.3, §12: the final
 *  stdout, stderr and --json each take one more pass). A SQLite message can quote a value, and the three sites that
 *  wrote `e.message` raw did not redact it (HA2 H-32). Every error text on stderr goes through here. */
function errLine(text, idx = NO_PAIRS) {
  process.stderr.write(redactFinalLines(`${text}\n`, idx));
}
const ABSENT = Object.freeze({ state: 'absent' });
const UNREADABLE = Object.freeze({ state: 'unreadable' });
/** A registry field or a recall-off file is a few dozen bytes; a read stops here. */
const FIELD_READ_MAX = 4096;

/** A small file as a Presence (§8.2; IV5: unreadable is never absent):
 *   - ENOENT is absent;
 *   - any other failure, a symlink (O_NOFOLLOW) or a non-regular file is unreadable;
 *   - a value is the trimmed text of the first FIELD_READ_MAX bytes.
 *  Callers form `p` only from an id idOk passed: no id becomes a path unchecked (slug history-id-grammar). */
function presenceOf(p) {
  let fd;
  try {
    fd = openSync(p, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'ENOENT' ? ABSENT : UNREADABLE;
  }
  try {
    if (!fstatSync(fd).isFile()) return UNREADABLE;
    const b = Buffer.alloc(FIELD_READ_MAX);
    const n = readSync(fd, b, 0, b.length, 0);
    return { state: 'value', value: b.subarray(0, n).toString('utf8').trim() };
  } catch {
    return UNREADABLE;
  } finally {
    closeSync(fd);
  }
}
const regPresence = (P, id, field) => presenceOf(`${P.reg}/${id}.${field}`);

/** The pane's tmux session name (§8.2; C3, C65). The call is bounded at TMUX_DEADLINE_MS and ALWAYS uses -t: a
 *  tmux call without -t answers for "the most recent session", which is some other pane. A tmux that does not
 *  answer in time is killed and reads unsettled. Whether the answer is an identity is decideIdentity's call. */
export function tmuxSession(pane) {
  const r = spawnSync('tmux', ['display-message', '-p', '-t', pane, '#S'], {
    encoding: 'utf8', timeout: TMUX_DEADLINE_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { settled: r.error === undefined && r.signal === null, status: r.status, stdout: typeof r.stdout === 'string' ? r.stdout : '' };
}

/** A read verb's answer when there is no ReadContext. `reason` rides only where §8.3 gives the exit one. `id`
 *  and `gen` are what the counter line names; both are null before the identity resolved. */
function refusal(exit, reason, storeId, id, gen) {
  return { exit, ...(reason === undefined ? {} : { reason }), storeId, id, gen };
}

/** The store_id an exit-5 or exit-6 answer names (§8.3: the store-unbound remedy needs no sqlite3). */
function refusalStoreId(reach, P) {
  if (reach.facts.storeId.state === 'value') return reach.facts.storeId.value;
  if (reach.facts.dbStoreId.state === 'value') return reach.facts.dbStoreId.value;
  if (!reach.statSettled) {
    const id = readTrimmed(P.storeId);
    return id !== null && UUID_RE.test(id) ? id : null;
  }
  return null;
}

/** The output redaction's index (§8.3 layers 1 and 4). Pairs: every (len, sha256) the sweep recorded in redact_hashes,
 *  which covers each account's declared secretsFile, plus the pairs of the files read now, so a value added since the
 *  last tick is redacted too. The belt (W1-B2 Task 7A): the units of the frozen list's and the declared secretsFiles'
 *  values read now; the declared paths are those the last tick recorded in meta redact_sources (Task 7B), because this
 *  process sources no bash. The values live only in this process's memory, inside the belt (and, for --regex, the
 *  child's stdin, Task 14): never printed, persisted or journaled. loadSecrets is the W1-B2 block's static import
 *  (never an import(): B1's ring census refuses one in a shipped module); Task 19's operator relay reuses this index. */
function pairIndexOf(db, home) {
  const recorded = db.prepare('SELECT len, sha256 FROM redact_hashes').all()
    .map((r) => ({ len: Number(r.len), sha256: Buffer.from(r.sha256).toString('hex') }));
  const sources = db.prepare('SELECT v FROM meta WHERE k = ?').get(REDACT_SOURCES_META);
  const loaded = loadSecrets(home, parseRedactSources(sources?.v));
  return makePairIndex([...recorded, ...loaded.pairs], makeBelt(beltUnits(loaded.values)));
}

/** A failed read of an admitted store as a read verb's refusal (§8.3: ONE answer, exit 5, for a DB or schema error),
 *  measured as B1's readStoreAnswered measures it and decided by lib's decideStatusReadFailure: a StoreError's word,
 *  SQLite's own error (ERR_SQLITE_ERROR: a missing table or column, a corrupt page, an I/O error) as
 *  store-read-failed, the error's message on stderr. Null for any other throw, a defect the caller rethrows, so it
 *  stays exit 1 with no answer (review 316 F11's rule; B1's slug history-import-refusal-words names the word). */
function readFailure(e, storeId, id, gen, idx = NO_PAIRS) {
  const f = decideStatusReadFailure({
    storeWord: e instanceof StoreError ? e.word : null,
    sqliteError: e !== null && typeof e === 'object' && e.code === 'ERR_SQLITE_ERROR',
  });
  if (f === null) return null;
  errLine(`ccrc history: ${f.reason}: ${e.message}`, idx);
  return refusal(f.exit, f.reason, storeId, id, gen);
}

/** The argv that reproduces this scope on a next: line. */
function scopeArgsOf(o) {
  if (typeof o.session === 'string') return ['--session', o.session];
  if (o.project === true) return ['--project'];
  if (o.workspace === true) return ['--workspace'];
  return [];
}

/** The CLI's one write (§8.1): `{v, ev:'recall', id, gen?, cmd, rc, ms, ts}`, fenced like the hook's lines.
 *  It carries no query text and no argument (G5). `gen` rides only when it has the UUID grammar. A line the
 *  spool grammar would reject (parseSpoolLine) is never written: the answer is null. */
export function recallLine(i) {
  const rec = { v: 1, ev: 'recall', id: i.id };
  if (typeof i.gen === 'string' && UUID_RE.test(i.gen)) rec.gen = i.gen;
  rec.cmd = i.cmd;
  rec.rc = i.rc;
  rec.ms = i.ms;
  rec.ts = i.ts;
  const line = JSON.stringify(rec);
  return parseSpoolLine(line).ok ? line : null;
}

/** Append `\n<line>\n` to spool/<id>.jsonl in ONE write on an O_APPEND descriptor (§5.1).
 *  It writes only into a pre-existing real spool directory and appends only to a regular file. O_NOFOLLOW and
 *  O_NONBLOCK reject a link or a swapped FIFO; any accounting failure leaves the read answer unchanged.
 *  The optional callbacks make the pre-open/post-open replacement and open-flag fixtures deterministic. */
export function writeRecallLine(home, id, line, afterPrecheck = null, afterOpen = null) {
  const P = historyPaths(home);
  try {
    if (!lstatSync(P.spool).isDirectory()) return;
    const p = `${P.spool}/${id}.jsonl`;
    let st = null;
    try {
      st = lstatSync(p);
    } catch (e) {
      if (!(e !== null && typeof e === 'object' && e.code === 'ENOENT')) return;
    }
    if (st !== null && !st.isFile()) return;
    if (typeof afterPrecheck === 'function') afterPrecheck(p);
    const flags = FS.O_WRONLY | FS.O_APPEND | FS.O_CREAT | FS.O_NOFOLLOW | FS.O_NONBLOCK;
    const fd = openSync(p, flags, 0o600);
    try {
      if (typeof afterOpen === 'function') afterOpen(fd, flags);
      if (!fstatSync(fd).isFile()) return;
      writeSync(fd, `\n${line}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Counter accounting is deliberately best-effort.
  }
}

/** One counter line per identity-resolved read call, whatever its exit. */
function countRecall(home, i) {
  if (existsSync(historyPaths(home).off)) return;
  const line = recallLine(i);
  if (line !== null) writeRecallLine(home, i.id, line);
}

function realOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** The read context: every step of the order above through the scope, or the refusal that stopped it.
 *  On success the caller owns `rc.db` and closes it. */
export async function readContext(home, verb, parsed, nowMs = Date.now()) {
  const P = historyPaths(home);
  if (process.platform === 'darwin' || readRole(P) === 'server') {
    const d = decideCliStore(cliFactsOf(await measureReach(home)));
    return refusal(d.exit, d.reason, null, null, null);
  }
  const pane = process.env.TMUX_PANE ?? null;
  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });
  if (!who.ok) return refusal(who.rc, who.reason, null, null, null);
  const id = who.id;
  const harness = decideHarness(regPresence(P, id, 'harness'));
  if (!harness.ok) return refusal(harness.rc, harness.reason, null, id, null);
  const generation = resolveGeneration({
    envGen: process.env.CCRC_SESSION_GENERATION ?? null, regGen: regPresence(P, id, 'generation'),
  });
  let gen = generation.value;
  const offFile = presenceOf(recallOffPath(home, id));
  const offNow = generation.value !== null || offFile.state !== 'value';
  if (offNow && decideRecallOff({ file: offFile, generation: generation.value ?? '' }) === 'off') {
    return refusal(EXIT.RECALL_OFF, undefined, null, id, gen);
  }
  const reach = await measureReach(home);
  const d = decideCliStore(cliFactsOf(reach));
  if (!d.read) return refusal(d.exit, d.reason, refusalStoreId(reach, P), id, gen);
  let db;
  try {
    db = openReader(P.dbFile);
  } catch (e) {
    const f = readFailure(e, refusalStoreId(reach, P), id, gen);
    if (f === null) throw e;
    return f;
  }
  let handed = false;
  let storeId = refusalStoreId(reach, P);
  try {
    const meta = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (meta !== undefined) storeId = meta.v;
    // lib's decideStatusRead decides the journal mode, as it does for status: this file only measures.
    const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    const version = userVersion(db);
    const rd = decideStatusRead({ userVersion: version, journalMode: mode, recordedMigration: undefined });
    if (rd.reason !== undefined) return refusal(rd.exit, rd.reason, storeId, id, gen);
    if (generation.value === null) {
      // 'newest' is a store fact. Use its actual family generation for recall-off and counter accounting.
      const own = familiesOf(db, { kind: 'family', id, generation: null, project: null, workdir: null, workdirReal: null });
      const ownGen = own.length === 1 ? own[0].generation : '';
      if (UUID_RE.test(ownGen)) gen = ownGen;
      if (!offNow && decideRecallOff({ file: offFile, generation: ownGen }) === 'off') {
        return refusal(EXIT.RECALL_OFF, undefined, storeId, id, gen);
      }
    }
    const o = parsed.opts;
    const session = typeof o.session === 'string' ? o.session : null;
    const scopeInputs = {
      source: SCOPE_SOURCES[0], id, generation,
      flags: { project: o.project === true, workspace: o.workspace === true, session },
      reg: {
        project: regPresence(P, id, 'project'),
        workdir: regPresence(P, id, 'workdir'),
        sessionProject: session === null ? null : (idOk(session) ? regPresence(P, session, 'project') : ABSENT),
      },
    };
    const verdict = decideScope(scopeInputs);
    if (!verdict.ok) return refusal(verdict.rc, verdict.reason, storeId, id, gen);
    // --session names another id's family: read with that id's own registry generation (§8.2).
    const famGen = session === null ? verdict.generation
      : resolveGeneration({ envGen: null, regGen: regPresence(P, verdict.id, 'generation') }).value;
    // The workspace match compares realpaths; a workdir that no longer resolves matches only verbatim.
    const workdirReal = verdict.kind === 'workspace' && typeof verdict.workdir === 'string' ? realOrNull(verdict.workdir) : null;
    const families = familiesOf(db, {
      kind: verdict.kind, id: verdict.id, generation: famGen, project: verdict.project, workdir: verdict.workdir, workdirReal,
    });
    if (session === null && verdict.kind === 'family' && families.length === 1 && UUID_RE.test(families[0].generation)) {
      gen = families[0].generation;
    }
    const transcriptPks = transcriptsOf(db, families.map((f) => f.sessionPk));
    if (transcriptPks.length === 0) return refusal(EXIT.NOT_INDEXED, undefined, storeId, id, gen);
    const rc = {
      db, version, schema: SCHEMA_ADDED, storeId, nowMs, home, id, gen,
      scope: {
        kind: verdict.kind, id: verdict.id, generation: families.length === 1 ? families[0].generation : null,
        project: verdict.project, workdir: verdict.workdir,
        sessionPks: families.map((f) => f.sessionPk), transcriptPks, families,
      },
      scopeArgs: scopeArgsOf(o),
      pairIdx: pairIndexOf(db, home),
    };
    handed = true;
    return rc;
  } catch (e) {
    // A read of this admitted store failed (the meta read, the PRAGMA, the scope's families and transcripts, the
    // pair index): ONE exit-5 answer, as status gives (review 316 F11). Anything else is a defect: exit 1.
    const f = readFailure(e, storeId, id, gen);
    if (f === null) throw e;
    return f;
  } finally {
    if (!handed) db.close();
  }
}

/** The recall.mjs runner each read verb calls. Each entry takes (rc, parsed, argv): `parsed` is parseReadArgs'
 *  answer (the whitelist), `argv` the verb's own words, which grep and describe re-read with their own value
 *  grammars. Tasks 12, 15 and 16 add grep, describe and expand in place. A verb not here answers bad-args before
 *  anything is measured. */
const READ_RUNNERS = Object.freeze({
  tree: (rc, p) => runTree(rc, { depth: Number(p.opts.depth) }),
  grep: (rc, p, argv) => grepVerb(rc, argv),
  describe: (rc, p, argv) => describeVerb(rc, argv),
  expand: (rc, p) => expandVerb(rc, p),
});

function refusalLine(exit, reason) {
  return `exit ${exit}${reason === undefined ? '' : ` ${reason}`}: ${EXIT_MEANING[exit] ?? 'see --json'}`;
}

/** A refusal, written once: one --json envelope (store_id and coverage always), or one human line. */
function emitRefusal(r, json, pairIdx) {
  const text = json
    ? JSON.stringify(redactFinalJson(readEnvelope({
      exit: r.exit, ...(r.reason === undefined ? {} : { reason: r.reason }), storeId: r.storeId ?? null,
      scope: null, header: null, items: [], shown: 0, total: 0, next: null,
    }), pairIdx))
    : redactFinalLines(refusalLine(r.exit, r.reason), pairIdx);
  process.stdout.write(`${text}\n`);
  return r.exit;
}

/** The --json scope object (§8.3). A widened scope names only a bounded prefix; `families_total` is complete. */
function scopeJson(rc) {
  return {
    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project,
    families: rc.scope.families.slice(0, SCOPE_FAMILIES_JSON_MAX)
      .map((f) => ({ ccrc_id: f.ccrcId, generation: f.generation, first_seen_ms: f.firstSeenMs })),
    families_total: rc.scope.families.length,
    transcripts: rc.scope.transcriptPks.length,
  };
}

/** A verb's result. Human form: the header, the body, `shown K of N`, the next: line, the hint. --json: one
 *  envelope. The second belt (§8.3, D-4613) is structure-aware: --json maps the envelope value through redactFinalJson before
 *  it is serialised, the human page goes through redactFinalText line by line and tag by tag. */
function emitResult(rc, res, json) {
  const h = scopeHeader(rc);
  let text;
  if (json) {
    text = `${JSON.stringify(redactFinalJson(readEnvelope({
      exit: res.exit, ...(res.reason === undefined ? {} : { reason: res.reason }), storeId: rc.storeId, scope: scopeJson(rc),
      header: { indexedThroughMs: h.indexedThroughMs, lagS: h.lagS }, items: res.items, shown: res.shown, total: res.total,
      next: res.next === null ? null : nextLine(res.next),
      // D-4595 (history-json-envelope-carries-hint): the human form prints res.hint below; --json carries it too.
      ...(res.hint === undefined ? {} : { hint: res.hint }),
    }), rc.pairIdx))}\n`;
  } else {
    // A runner's refusal (out-of-scope, regex-syntax, migration-pending, …) names its word under the header.
    const lines = [res.header ?? h.line, ...(res.reason === undefined ? [] : [refusalLine(res.exit, res.reason)]),
      ...res.blocks, shownLine(res.shown, res.total)];
    if (res.next !== null) lines.push(nextLine(res.next));
    if (res.hint !== undefined) lines.push(`hint: ${res.hint}`);
    text = redactFinalText(`${lines.join('\n')}\n`, rc.pairIdx);
  }
  process.stdout.write(text);
  return res.exit;
}

async function readVerb(home, verb, argv) {
  const t0 = Date.now();
  const parsed = parseReadArgs(verb, argv);
  const json = parsed.ok ? parsed.opts.json === true : argv.includes('--json');
  if (!parsed.ok) {
    process.stderr.write(`${USAGE}\n`);
    return emitRefusal({ exit: EXIT.REFUSED, reason: parsed.reason, storeId: null }, json, NO_PAIRS);
  }
  const runner = Object.hasOwn(READ_RUNNERS, verb) ? READ_RUNNERS[verb] : null;
  if (runner === null) {
    process.stderr.write(`ccrc history: ${verb} is not in this build\n${USAGE}\n`);
    return emitRefusal({ exit: EXIT.REFUSED, reason: 'bad-args', storeId: null }, json, NO_PAIRS);
  }
  const ctx = await readContext(home, verb, parsed, t0);
  let exit;
  if (!('db' in ctx)) {
    exit = emitRefusal(ctx, json, NO_PAIRS);
  } else {
    try {
      let res = null;
      let failed = null;
      try {
        res = runner(ctx, parsed, argv);
        // The header reads derivation_state and ingest_files. A runner may answer without reaching either (a refusal, a
        // not-found, describe of a depth>0 node), and then the first read of a damaged table would happen in emitResult,
        // outside this try. Priming it here puts that SQLite error through readFailure (exit 5), not the entry guard
        // (exit 1). scopeHeader caches per context, so emitResult reuses it (HA2 H-21; HI2 H-170).
        scopeHeader(ctx);
      } catch (e) {
        const f = readFailure(e, ctx.storeId, ctx.id, ctx.gen, ctx.pairIdx);
        if (f === null) throw e;
        failed = f;
      }
      exit = failed === null ? emitResult(ctx, res, json) : emitRefusal(failed, json, ctx.pairIdx);
    } finally {
      ctx.db.close();
    }
  }
  if (typeof ctx.id === 'string') countRecall(home, { id: ctx.id, gen: ctx.gen, cmd: verb, rc: exit, ms: Date.now() - t0, ts: Date.now() });
  return exit;
}

/** An unknown verb, or a box verb's argv off its grammar: B1's bad-args answer, the status-shaped envelope
 *  under --json (it carries store_id and coverage). */
function unknownVerb(home, json) {
  process.stderr.write(`${USAGE}\n`);
  if (json) process.stdout.write(`${JSON.stringify({ ...emptyEnvelope(historyPaths(home)), exit: EXIT.REFUSED, reason: 'bad-args' })}\n`);
  return EXIT.REFUSED;
}

async function statusVerb(home, args) {
  const json = args.includes('--json');
  if (args.some((a) => a !== '--json')) return unknownVerb(home, json);
  const env = await statusWithHealth(home, Date.now());
  process.stdout.write(json ? `${JSON.stringify(env)}\n` : `${render(env)}${formatHealth(env.health).map((l) => `${l}\n`).join('')}`);
  return env.exit;
}

/** `recall-off` in B2: its refusals only (decideRecallOffPreflight). The verb writes nothing and spawns
 *  nothing. */
function recallOffVerb(home, args) {
  const json = args.includes('--json');
  const a = args.filter((x) => x !== '--json');
  let d = decideRecallOffPreflight({ args: a, generation: null });
  if (!d.done) d = decideRecallOffPreflight({ args: a, generation: regPresence(historyPaths(home), d.id, 'generation') });
  if (d.reason === 'bad-args') process.stderr.write('ccrc history: recall-off writes its file from W2 (the replay eval); this build answers only its refusals\n');
  return emitRefusal({ exit: d.exit, reason: d.reason, storeId: null }, json, NO_PAIRS);
}

/** `ccrc history <verb> …` (§8.2): help, the box verbs, the read verbs; anything else is bad-args. */
export async function main(argv) {
  const home = process.env.HOME ?? '';
  const verb = argv[0] ?? '';
  const rest = argv.slice(1);
  if (verb === '-h' || verb === '--help' || verb === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.OK;
  }
  if (verb === 'status') return statusVerb(home, rest);
  if (verb === 'recall-off') return recallOffVerb(home, rest);
  if (READ_VERBS.includes(verb)) return readVerb(home, verb, rest);
  if (verb === 'doctor' || (!verb.startsWith('--') && Object.hasOwn(OP_OF_VERB, verb))) return operatorMain(home, argv);
  return unknownVerb(home, argv.includes('--json'));
}

// ── the health block (history spec §9.6; W1-B1 task 28) ─────────────────────
// `status` MEASURES and lib.mjs's `deriveHealth` DECIDES; doctor's
// `_check_history` only relays the result. Everything below is a reading:
// lstat/stat/readdir under ~/.ccrc/history, a bounded stat of the store's
// device, and indexed reads on a read-only handle — never a scan of a large
// table, so doctor's call under `_plat_timeout` stays cheap on any store.

/** Entries a mode walk visits at most: the tree is small (one journal file per
 *  month and writer, one card/steer file per session), so this bounds a
 *  pathological tree, never an ordinary one. */
const MODE_WALK_MAX = 20_000;

/** Every entry under ~/.ccrc/history that §9.6 judges, with its measured mode.
 *  `db/` is the ONE path that may be a link (§9.3): its mode is read at the
 *  link's TARGET (stat follows) and the target is the path named — a symlink
 *  always reads 777, so the link's own mode is never read. No other link is
 *  followed or judged. `skipDb` keeps the walk off a store whose filesystem
 *  did not answer (a stat there could block on a dead mount). */
function measureModeEntries(p, skipDb) {
  const entries = [];
  let budget = MODE_WALK_MAX;
  let rootSt;
  try { rootSt = healthFs.statSync(p.root); } catch { return entries; }
  if (!rootSt.isDirectory()) return entries;
  entries.push({ rel: '.', kind: 'dir', mode: rootSt.mode, shown: p.root });
  const walk = (dirAbs, relPrefix) => {
    let names;
    try { names = healthFs.readdirSync(dirAbs); } catch { return; }
    for (const name of names) {
      budget -= 1;
      if (budget < 0) return;
      const abs = healthPath.join(dirAbs, name);
      const rel = relPrefix === '' ? name : `${relPrefix}/${name}`;
      let st;
      try { st = healthFs.lstatSync(abs); } catch { continue; }
      if (rel === 'db' && skipDb) continue;
      if (rel === 'db' && st.isSymbolicLink()) {
        let target;
        try {
          target = healthPath.resolve(dirAbs, healthFs.readlinkSync(abs));
          st = healthFs.statSync(abs);
        } catch { continue; }
        if (!st.isDirectory()) continue;
        entries.push({ rel, kind: 'dir', mode: st.mode, shown: target });
        walk(abs, rel);
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        entries.push({ rel, kind: 'dir', mode: st.mode, shown: abs });
        walk(abs, rel);
      } else if (st.isFile()) {
        entries.push({ rel, kind: 'file', mode: st.mode, shown: abs });
      }
    }
  };
  walk(p.root, '');
  return entries;
}

/** The roster the shim sources (§5.1 step 4): readable, and defining the one
 *  function the shim requires. Measured here rather than read off the
 *  cumulative `roster_unreadable` counter, which never falls back to 0. */
const ROSTER_FILE_MAX = 1024 * 1024;
function rosterReadable(file) {
  const r = healthStore.readBounded(file, ROSTER_FILE_MAX, true);
  return r.state === 'value' && r.value.includes('_ccrc_cfg_dir()');
}

/** The observedMs of the oldest observation sidecar in spool/.draining whose
 *  records never reached the journal (`journaled` still null), and whether the
 *  directory or a sidecar could not be read. `oldest` is null when there is no
 *  such sidecar (an ABSENT directory or file is "no held file"); `unreadable`
 *  is true when a read failed for any other reason, so deriveHealth is told the
 *  input is unmeasured and never judges it healthy (the no-overloaded-null
 *  rule: absent and unreadable are not one null). A MEASUREMENT only: lib.mjs's
 *  journalHeldTooLong decides whether `oldest` is a hold (§9.6
 *  `journal-unwritable`). Read only while a bound store exists: a hold with no
 *  binding never reaches here (exit 5 answers first). A draining file the drain
 *  skips without a journal failure (a directory at its sidecar name, an open that
 *  fails, a sidecar it cannot read) is not a held file, and neither is any later
 *  file of its id, which the drain holds behind it (FU8). */
function oldestUnjournaledMs(p) {
  const absent = (e) => e !== null && typeof e === 'object' && e.code === 'ENOENT';
  let names;
  try { names = healthFs.readdirSync(p.draining); } catch (e) { return { oldest: null, unreadable: !absent(e) }; }
  let oldest = null;
  let unreadable = false;
  const present = new Set(names);
  // D-4347 (history-planted-entries-never-wedge) / FU3F review F2, FU6, FU8 (FPM13): a directory at a live file's sidecar or
  // sidecar-temp name is not a journal hold, so the file's sidecar is neither held nor unreadable. The next drain usually moves
  // that directory into its area (counted `non_regular`) and drains the file; only when the directory cannot be moved does it
  // displace the file (`spool_displaced`) or block it (`spool_blocked`), both under WARN spool-planted. Status cannot tell which
  // (it cannot know whether the directory or `planted/` will move, and judges no write), so it skips the file for all three;
  // the window is the time to the next drain, and a pass that only journals reports `journal-unwritable` itself where a DB is
  // open. (A directory at a name whose file is gone is not that condition.) Judge the stems first, so the answer holds
  // whatever order the listing names the two entries in. A name that cannot be lstat'd is left to the read below.
  const planted = new Set();
  for (const n of names) {
    const stem = n.endsWith('.obs.tmp') ? n.slice(0, -'.obs.tmp'.length) : n.endsWith('.obs') ? n.slice(0, -'.obs'.length) : null;
    if (stem === null || !present.has(`${stem}.jsonl`)) continue;   // a live file's names only: a directory at an orphan name stays unreadable
    try { if (healthFs.lstatSync(healthPath.join(p.draining, n)).isDirectory()) planted.add(stem); } catch { /* judged by the read below */ }
  }
  // FU8 (FP5; D-4347 (history-planted-entries-never-wedge)): the drain skips, never journals, a live file whose sidecar name
  // is planted (above), one it cannot open, and one whose sidecar it cannot read, and holds every later file of the same id
  // behind it, so the epoch chain keeps its order. None of those is a journal hold, so status walks the stems in the drain's
  // journaling order (lib's `drainingOrder`) and skips the rest of an id once it has such a file. A stem outside the draining
  // grammar is walked last and judged as before: its sidecar is still read, so a FIFO or a mode-000 one reads unreadable.
  const stems = new Set();
  for (const n of names) {
    if (n.endsWith('.obs')) stems.add(n.slice(0, -'.obs'.length));
    else if (healthLib.drainingNameParts(n) !== null) stems.add(n.slice(0, -'.jsonl'.length));
  }
  const walk = [...stems].map((s) => ({ s, name: `${s}.jsonl`, parts: healthLib.drainingNameParts(`${s}.jsonl`) }));
  const inGrammar = walk.filter((x) => x.parts !== null).sort(healthLib.drainingOrder);
  const outside = walk.filter((x) => x.parts === null).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  // The drain's own open (readDrainingText: nonblocking, never following a link). ENOENT and ELOOP are not a skipped file
  // (gone, or a link the drain removes and counts), so the sidecar read below decides those.
  const unopenable = (f) => {
    const C = healthFs.constants;
    try { healthFs.closeSync(healthFs.openSync(f, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK | C.O_NOCTTY)); return false; } catch (e) { return !(absent(e) || (e && e.code === 'ELOOP')); }
  };
  const waiting = new Set();
  for (const { s, name, parts } of [...inGrammar, ...outside]) {
    const id = parts === null ? null : parts.id;
    if (id !== null && waiting.has(id)) continue;
    const live = present.has(name);
    if (live && (planted.has(s) || (id !== null && unopenable(healthPath.join(p.draining, name))))) {
      if (id !== null) waiting.add(id);
      continue;
    }
    const n = `${s}.obs`;
    if (!present.has(n)) continue;
    const file = healthPath.join(p.draining, n);
    // ONE nonblocking open with the type judged on the descriptor, as the sweep's readSmall does (store.mjs
    // `readBounded`, the `_reg_read` lesson; D-4347 (history-planted-entries-never-wedge)): a FIFO named *.obs would block a plain read in open(2) for
    // ever, and status is a health read that must always return. A link is followed, as readSmall follows it. A
    // non-regular entry is unmeasured here, not "no held file": the sweep itself answers UNREADABLE for it (and
    // rewrites the sidecar), so no read of it can say whether a record was held.
    const r = healthStore.readBounded(file, healthLib.OBS_FILE_MAX, true);
    if (r.state === 'absent') continue;             // the sweep unlinked it between the listing and the read
    if (r.state === 'unreadable') {
      unreadable = true;
      if (live && id !== null) waiting.add(id);   // FU8: the drain skips this file and holds its id's later files behind it
      continue;
    }
    if (r.state === 'over-cap') continue;           // content the sweep re-observes, as it does unparseable content
    const text = r.value;
    // D-4347 (history-planted-entries-never-wedge): an orphan the sweep's next drain removes is not a held file. This is
    // judged AFTER the read, so a FIFO, directory or mode-000 sidecar still reads unreadable, as above.
    if (!live) continue;
    let o;
    try { o = JSON.parse(text); } catch { continue; }   // unparseable CONTENT the sweep's own reader also skips (readSidecar: null, then re-observed); a non-regular entry it does NOT skip, see above
    // The sweep's own predicate (lib's observationOk, D-4347 (history-planted-entries-never-wedge)): a sidecar the sweep would not use is not a held record;
    // the sweep rewrites it at its next journaling.
    if (healthLib.observationOk(o) && o.journaled === null
      && (oldest === null || o.observedMs < oldest)) oldest = o.observedMs;
  }
  return { oldest, unreadable };
}

/** How many names in spool/ that a hook spools to (lib's spoolFileIdOf) stand as something other than a regular file (a
 *  FIFO, a link, dangling or not, a directory, or any other node), by lstat, never followed or opened (FR2c, D-4418): the
 *  hook appends to none of them. 0 when spool/ is absent or not a directory (ENOENT, ENOTDIR); null for every other
 *  listing or lstat failure, which status names as unmeasured (absent is not unreadable). A name gone between the listing
 *  and its lstat is not counted. */
function refusedSpoolNodes(dir) {
  let names;
  try { names = healthFs.readdirSync(dir); } catch (e) { return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? 0 : null; }
  let n = 0;
  for (const name of names) {
    if (healthLib.spoolFileIdOf(name) === null) continue;
    try { if (!healthFs.lstatSync(healthPath.join(dir, name)).isFile()) n += 1; } catch (e) { if (!(e && e.code === 'ENOENT')) return null; }
  }
  return n;
}

/** Regular `*.db` files directly in db/backups/, for store-missing's remedy. */
function backupsOf(dir) {
  let names;
  try { names = healthFs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.db') && !n.startsWith('.') && (() => {
    try { return healthFs.lstatSync(healthPath.join(dir, n)).isFile(); } catch { return false; }
  })()).sort();
}

/** Whether the store's filesystem is the root filesystem's device, for doctor's
 *  PASS line (§9.3: "names the store's filesystem by device, as information").
 *  Bounded by CLI_STAT_DEADLINE_MS: a dead mount answers null, never a hang. */
async function storeDeviceOf(dbDir) {
  const probe = Promise.all([healthFs.promises.stat(dbDir), healthFs.promises.stat('/')])
    .then(([d, r]) => (d.dev === r.dev ? 'root' : 'own'), () => null);
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), healthLib.CLI_STAT_DEADLINE_MS); });
  try { return await Promise.race([probe, deadline]); } finally { clearTimeout(timer); }
}

const intOf = (v) => (v !== null && /^[0-9]+$/.test(v) ? Number(v) : 0);
const listOf = (v) => {
  if (v === null) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((s) => typeof s === 'string') : []; } catch { return []; }
};

/** The facts only the store holds that the envelope does NOT already carry,
 *  on a read-only handle (task 11's reader): an open breaker, and the meta
 *  keys whose writers ship later (HEALTH_META) or that task 13's executor
 *  keeps. Both statements are STATUS_SQL's, so task 27's cost pin covers
 *  them. The ticks, the recovery step, journal_skipped and redact_unreadable
 *  are the envelope's own readings: healthInputsOf takes them from it, so
 *  status never reads one fact twice or spells it two ways. A reading that
 *  throws is named in `unmeasured` (Task 28F: absent is not unreadable). */
function readStoreExtras(p, nowMs) {
  const x = { breakerOpen: false, recoverUnmovedTicks: 0, exportSegmentNewer: [], exportSegmentMissing: 0, copyBps: null, unmeasured: [] };
  let db;
  try { db = healthStore.openReader(p.dbFile); } catch { x.unmeasured.push('store'); return x; }
  // Each reading is its own try: one that fails is named in `unmeasured` and keeps its default, which
  // deriveHealth is told is NOT a measurement (it answers `status-unreadable`), never a healthy value.
  const read = (name, fn) => {
    try { fn(); } catch { x.unmeasured.push(name); }
  };
  try {
    const meta = (k) => {
      const r = db.prepare(STATUS_SQL.metaKey).get(k);
      return r === undefined ? null : String(r.v);
    };
    read('breaker', () => { x.breakerOpen = Number(db.prepare(STATUS_SQL.breaker).get(nowMs).n) > 0; });
    read(healthLib.HEALTH_META.recoverUnmovedTicks, () => { x.recoverUnmovedTicks = intOf(meta(healthLib.HEALTH_META.recoverUnmovedTicks)); });
    read(healthLib.HEALTH_META.exportSegmentNewer, () => { x.exportSegmentNewer = listOf(meta(healthLib.HEALTH_META.exportSegmentNewer)); });
    read(healthLib.HEALTH_META.exportSegmentMissing, () => { x.exportSegmentMissing = intOf(meta(healthLib.HEALTH_META.exportSegmentMissing)); });
    read('copy_bps', () => {                                            // task 13's executor
      const bps = intOf(meta('copy_bps'));
      x.copyBps = bps > 0 ? bps : null;
    });
  } finally {
    db.close();
  }
  return x;
}

/** Everything deriveHealth needs that the envelope does not carry. */
async function readHealthExtras(home, env, nowMs) {
  const p = healthLib.historyPaths(home);
  const unreachable = env.reason === 'store-unreachable';
  let rootIsSymlink = false;
  try { rootIsSymlink = healthFs.lstatSync(p.root).isSymbolicLink(); } catch { rootIsSymlink = false; }
  let dbPath = p.dbDir;
  try {
    if (healthFs.lstatSync(p.dbDir).isSymbolicLink()) dbPath = healthPath.resolve(healthPath.dirname(p.dbDir), healthFs.readlinkSync(p.dbDir));
  } catch { dbPath = p.dbDir; }
  const store = env.exit === healthLib.EXIT.OK
    ? readStoreExtras(p, nowMs)
    : { breakerOpen: false, recoverUnmovedTicks: 0, exportSegmentNewer: [], exportSegmentMissing: 0, copyBps: null, unmeasured: [] };
  // FU8 (FP3): a link or a file at spool/ is measured by lstat, never followed, and no spool/.draining is read through it.
  let spoolNotDirectory = false;
  try { spoolNotDirectory = !healthFs.lstatSync(p.spool).isDirectory(); } catch { spoolNotDirectory = false; }
  // FR2c (review 344 F3; D-4418 (history-spool-append-regular-file-only)): a node at spool/<id>.jsonl that is not a regular
  // file, by lstat and never followed or opened, as the hook and the sweep judge it. Only through a real spool/.
  const refusedNodes = spoolNotDirectory ? 0 : refusedSpoolNodes(p.spool);
  if (refusedNodes === null) store.unmeasured.push('spool/');
  const held = env.exit === healthLib.EXIT.OK && !spoolNotDirectory ? oldestUnjournaledMs(p) : { oldest: null, unreadable: false };
  if (held.unreadable) store.unmeasured.push('spool/.draining');
  return {
    ...store,
    modesWrong: healthLib.modesWrongOf(measureModeEntries(p, unreachable || env.reason === 'store-root-dangling')),
    rootIsSymlink,
    spoolNotDirectory,
    spoolNodesRefused: refusedNodes ?? 0,
    dbPath,
    rosterUnreadable: !rosterReadable(p.accountsSh),
    journalUnwritable: healthLib.journalHeldTooLong(held.oldest, nowMs),
    backupsDb: unreachable ? [] : backupsOf(p.backups),
    storeDevice: unreachable || env.exit === healthLib.EXIT.NO_STORE ? null : await storeDeviceOf(p.dbDir),
  };
}

/** The envelope and the extras, as deriveHealth's inputs. */
function healthInputsOf(env, x, nowMs) {
  const exp = (env.export && env.export['claude-code']) || {};
  return {
    nowMs,
    storeId: env.store_id ?? null,
    exit: env.exit,
    reason: env.reason ?? null,
    shimMtimeMs: env.shim_mtime_ms ?? null,
    lastTickMs: env.last_tick_ms ?? null,
    lagS: typeof env.lag === 'number' ? env.lag : null,
    sizeBytes: env.size_bytes ?? null,
    capGb: env.cap_gb,
    capMalformed: env.cap_malformed === true,
    capFile: env.cap_file,
    capturePause: env.capture_pause ?? '',
    migration: env.migration ?? 'none',
    userVersion: env.user_version ?? null,
    codeVersion: env.code_version,
    historyOff: env.history_off === true,
    // The step and cursor are the envelope's (task 27 spells the step `recover/<v>`); only the
    // unmoved-tick count, a meta key B2's recovery step keeps, comes from readStoreExtras.
    recovering: env.recovering
      ? { step: String(env.recovering.step), cursor: String(env.recovering.cursor ?? ''), cursorUnmovedTicks: x.recoverUnmovedTicks }
      : null,
    op: env.op ? { verb: env.op.verb, pid: env.op.pid, alive: env.op.alive === true } : null,
    pass: env.pass ? { pid: env.pass.pid, startMs: env.pass.start_ms, live: env.pass.live === true } : null,
    // The envelope lists the newest tick first; deriveHealth's catching-up rule reads oldest first.
    bytesBehindLast3: [...(env.bytes_behind_last3 ?? [])].map(Number).reverse(),
    fts: env.fts ?? null,
    modesWrong: x.modesWrong,
    rootIsSymlink: x.rootIsSymlink,
    redactUnreadable: env.redact_unreadable ?? [],
    breakerOpen: x.breakerOpen,
    rosterUnreadable: x.rosterUnreadable,
    // D-4207 (history-export-due-escalates): both counts are the sweep's census, read from the envelope.
    exportDue: exp.due_blobs ?? 0,
    exportOverdue: exp.overdue_blobs ?? 0,
    exportWriterLive: false,       // B4 sets it with the export writer
    exportPausedLowDisk: false,    // B4 sets it with the export writer
    retentionLowered: (env.retention && env.retention.lowered) ?? null,
    retentionUnmeasured: (env.retention && env.retention.unmeasured) ?? [],
    journalGrowth30d: (env.journal && env.journal.growth_30d_bytes) ?? 0,
    journalSkipped: (env.journal && env.journal.skipped) ?? 0,
    blobUndecodable: Number((env.counters && env.counters[healthLib.HEALTH_COUNTERS.blobUndecodable]) ?? 0),
    drainRejected: Number((env.counters && env.counters[healthLib.HEALTH_COUNTERS.drainRejected]) ?? 0),
    spoolDisplaced: Number((env.counters && env.counters[healthLib.HEALTH_COUNTERS.spoolDisplaced]) ?? 0),
    spoolBlocked: Number((env.counters && env.counters[healthLib.HEALTH_COUNTERS.spoolBlocked]) ?? 0),
    spoolUnreadable: Number((env.counters && env.counters[healthLib.HEALTH_COUNTERS.spoolUnreadable]) ?? 0),
    spoolNotDirectory: x.spoolNotDirectory,
    spoolNodesRefused: x.spoolNodesRefused,
    exportSegmentNewer: x.exportSegmentNewer,
    exportSegmentMissing: x.exportSegmentMissing,
    extrasUnmeasured: x.unmeasured,
    // Two measurements of one condition, either enough: the sweep's own record of a failed append on a
    // DB-open pass (Task 24's meta `journal_unwritable`, carried as `journal.unwritable` by Task 27), and
    // its consequence on disk, a held file never journaled (oldestUnjournaledMs, judged by lib.mjs's
    // journalHeldTooLong), which a hold with no DB open could not record.
    journalUnwritable: x.journalUnwritable || (env.journal && env.journal.unwritable) === true,
    dbPath: x.dbPath,
    freeBytes: env.free_bytes ?? null,
    thresholdBytes: env.threshold_bytes ?? null,
    copyBps: x.copyBps,
    backupsDb: x.backupsDb,
    journalStoreDirs: (env.journal && env.journal.other_store_dirs) ?? [],
  };
}

/** `statusEnvelope` with its `health` filled and the store's device named. */
export async function statusWithHealth(home, nowMs) {
  const env = await statusEnvelope(home, nowMs);
  const x = await readHealthExtras(home, env, nowMs);
  env.store_device = x.storeDevice;
  env.health = healthLib.deriveHealth(healthInputsOf(env, x, nowMs));
  return env;
}

/** The human status's health lines, in doctor's own shape. */
export function formatHealth(health) {
  const out = [];
  if (health.pass !== null) out.push(`health: PASS ${health.pass}`);
  for (const [cls, list] of [['FAIL', health.fail], ['WARN', health.warn]]) {
    for (const i of list) {
      out.push(`health: ${cls} ${i.word}: ${i.detail}`);
      out.push(`  remedy: ${i.remedy}`);
    }
  }
  return out;
}

// ── THE OPERATOR DOOR (W1-B2 Task 19) ─────────────────────────────────────────────────────────────────────
// `ccrc history import|prune|reparse …` and `ccrc history doctor --repair|--backup|--migrate|--adopt|
// --restore <file>|--rebuild [--store-id <uuid>]` (spec §8.4 "Operator verbs" and "Speed bumps", §8.3's no-store
// table, §5.1). A BOX verb: it derives no identity and writes no spool line. In order, each step a lib decision:
//   1. the verb and its arguments, by parseOpVerbArgs. A refusal here spawns nothing;
//   2. the door, by decideOpDoor over cliFactsOf(reach) (§8.3's one no-store table, decideCliStore, from store.id
//      and the DB). macOS, a recorded server role and a box that never installed answer 9; a store with no shim
//      answers 2 writer-absent (a plain uninstall kept the data); an unreachable or dangling store answers its 5;
//   3. THE GATE, decideOpGate, from this process's CLAUDECODE, isatty(0), a registered recovery step with the facts
//      its exemptions read (RB6, RB13, RB14; read only behind measureReach's settled stat) and, for an irreversible
//      form only, the bounded
//      `tmux display-message -p -t "$TMUX_PANE" '#S'` (Task 10's tmuxSession). The sweep runs the same gate again
//      from its own environment (slug history-op-gate-in-sweep): decided once, executed twice;
//   4. the shim, `~/.local/bin/ccd-history-sweep --op <op> <args…>`, as a child. stdin and stderr are inherited, so
//      the sweep's own isatty(0) is the operator's terminal. stdout is piped and relayed line by line as it arrives
//      (an import's dry run can list thousands of files). Its LAST line, the sweep's `{"rc":…}`, is held back for
//      decideRelay: 75 (the shim found the lock held) is exit 4 writer-busy, a well-formed result is its rc and
//      reason, and anything else is exit 1.
// It never runs sweep.mjs itself: the shim is the ONE lock taker (§5.1, RV13). It passes no env: the child inherits
// this process's, so the env allow-list holds.
// Bare `doctor` is the status health, read-only (slug history-bare-doctor-is-status-health, NEW: §8.4 lists the
// bare form without saying what it does; those lines are what doctor's history check relays).

/** A CLI operator verb, or a doctor flag, → the --op verb the sweep runs. */
export const OP_OF_VERB = Object.freeze({
  import: 'import', prune: 'prune', reparse: 'reparse',
  '--repair': 'repair', '--backup': 'backup', '--migrate': 'migrate', '--adopt': 'adopt', '--restore': 'restore', '--rebuild': 'rebuild',
});

/** What a human reads for an operator verb's non-zero exit without a word of its own (§8.3). */
const OP_EXIT_WORDS = Object.freeze({
  [EXIT.INTERNAL]: 'internal error: the history writer gave no result this CLI could relay',
  [EXIT.WRITER_BUSY]: 'writer-busy: another history pass holds the lock',
  [EXIT.NO_STORE]: 'no store on this box (macOS, a server role, or never installed): stop, do not retry',
});

/** What every non-zero line an operator verb prints ends with (R-X-OPERATOR): these forms are the operator's, never the
 *  reading session's, so a session that meets a speed bump reads whose call it is, not a precondition to work around. */
const OP_OPERATOR_NOTE = Object.freeze({
  [EXIT.WRITER_BUSY]: 'the operator runs it again, from a terminal outside any session, when that pass ends',
});
const OP_OPERATOR_NOTE_ANY = 'ccrc history\'s operator verbs are the operator\'s to run, from a terminal outside any session; a session does not retry or work around this';

/** {op, opArgs} for `<verb> <rest…>`, or null. A doctor flag comes first and alone names the op; what follows it
 *  is that op's arguments, which parseOpVerbArgs judges. */
function opFormOf(verb, rest) {
  if (verb === 'doctor') {
    const flag = rest[0];
    if (typeof flag !== 'string' || !flag.startsWith('--') || !Object.hasOwn(OP_OF_VERB, flag)) return null;
    return { op: OP_OF_VERB[flag], opArgs: rest.slice(1) };
  }
  if (verb.startsWith('--') || !Object.hasOwn(OP_OF_VERB, verb)) return null;
  return { op: OP_OF_VERB[verb], opArgs: [...rest] };
}

/** The pane an irreversible form runs in, read as the sweep reads it (§8.2, §8.4): whether to read it at all is
 *  lib's paneReadWanted, the one rule the sweep's paneNameFor asks too; the read is Task 10's bounded tmuxSession,
 *  always with -t. Anything else is null, and the TTY requirement still stands then. */
function opPaneName(form) {
  const pane = process.env.TMUX_PANE ?? '';
  if (!healthLib.paneReadWanted(form, pane)) return null;
  const t = tmuxSession(pane);
  return t.settled && t.status === 0 ? t.stdout.trim() : null;
}

/** The shim as a child: its stdout relayed line by line as it arrives, its LAST line held back for the relay. */
function opRelay(P, op, opArgs, emit) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let child;
    try {
      child = spawnOp(P.shim, ['--op', op, ...opArgs], { stdio: ['inherit', 'pipe', 'inherit'] });
    } catch {
      finish({ exit: EXIT.INTERNAL });
      return;
    }
    let buf = '';
    let held = null;
    const take = (line) => {
      if (held !== null) emit(held);
      held = line;
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i = buf.indexOf('\n'); i !== -1; i = buf.indexOf('\n')) {
        take(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.on('error', () => finish({ exit: EXIT.INTERNAL }));
    child.on('close', (status, signal) => {
      if (buf !== '') take(buf);
      let lastLine = null;
      if (held !== null && held.startsWith('{"rc"')) lastLine = held;
      else if (held !== null) emit(held);
      finish(healthLib.decideRelay({ status, signal, lastLine }));
    });
  });
}

/** The relay's redaction index (§8.3, layers 1 and 4): Task 10's pairIndexOf, the read verbs' own index, so a relayed
 *  sweep line is redacted as a recalled field is: the pairs the sweep recorded in redact_hashes, the frozen list's and
 *  the declared secretsFiles' pairs read now (the paths from meta redact_sources), and the belt of those values. It
 *  reads the store only where a read verb would (decideCliStore's `read`, so behind measureReach's settled stat), on
 *  a read-only handle closed before it returns, so the shim's op never runs beside this process's reader. Where the
 *  store cannot be read (no settled stat, no DB yet before a rebuild or a restore, or an open or a select that failed
 *  as a StoreError or SQLite's own error), the index is the files read now with their belt, never no index; any
 *  other throw is a defect and propagates (exit 1). */
function relayIndexOf(home, P, reach) {
  if (decideCliStore(cliFactsOf(reach)).read) {
    let db = null;
    try {
      db = openReader(P.dbFile);
      return pairIndexOf(db, home);
    } catch (e) {
      if (!(e instanceof StoreError) && !(e !== null && typeof e === 'object' && e.code === 'ERR_SQLITE_ERROR')) throw e;
    } finally {
      if (db !== null) db.close();
    }
  }
  const files = loadSecrets(home, []);
  return makePairIndex(files.pairs, makeBelt(beltUnits(files.values)));
}

/** One operator verb through the door. `emit` gets each line the sweep printed before its result, already through
 *  redactFinalLines with relayIndexOf's index, which is built only once the gate has passed, before the shim starts. */
export async function runOpVerb(home, verb, rest, emit) {
  const P = healthLib.historyPaths(home);
  const map = opFormOf(verb, rest);
  if (map === null) return { exit: EXIT.REFUSED, reason: 'bad-args' };
  const parsed = healthLib.parseOpVerbArgs(map.op, map.opArgs);
  if (!parsed.ok) return { exit: EXIT.REFUSED, reason: parsed.reason };
  const reach = await measureReach(home);
  const door = healthLib.decideOpDoor(cliFactsOf(reach));
  if (!door.ok) return door.reason === undefined ? { exit: door.exit } : { exit: door.exit, reason: door.reason };
  const form = healthLib.formOf(map.op, map.opArgs);
  // RB6 (slug history-ops-refused-while-recovering): the CLI's pre-check, so a refused form spawns nothing. It opens
  // the store read-only only behind measureReach's settled 2 s stat; an unsettled stat, or any answer but `open`,
  // leaves the call to the sweep's half, which is authoritative. While a step is open it also carries the facts lib's
  // recoveryExempt reads (RB13: the stored user_version against this build's; RB14: store.id's presence, as
  // measureReach read it), so it never refuses a form the sweep would let through.
  const recovering = form !== null && reach.statSettled && opRecoverStepAt(P.dbFile) === 'open';
  const recovery = recovering
    ? { storedVersion: opStoredVersionAt(P.dbFile), codeVersion: healthLib.SCHEMA_VERSION, storeId: reach.facts.storeId }
    : {};
  const gate = healthLib.decideOpGate(form, { claudecode: (process.env.CLAUDECODE ?? '') !== '', historyOff: healthFs.existsSync(P.off), recovering, ...recovery },
    isattyOp(0), opPaneName(form));
  if (!gate.ok) return { exit: gate.rc, reason: gate.reason };
  const idx = relayIndexOf(home, P, reach);
  return opRelay(P, map.op, map.opArgs, (line) => emit(redactFinalLines(line, idx)));
}

/** D-4600 (history-operator-door-survives-a-closed-pipe): `ccrc history import --apply | head -1` closes stdout under the
 *  CLI, and `… --json 2>&1 >/dev/null | head -1` closes stderr, the stream the relay writes the sweep's lines to under --json
 *  and the one the shim inherits. A write to either is an EPIPE 'error' event that, unhandled, kills the process with a
 *  stack; the relay then stops draining the shim, whose own next write crashes it mid-op, and the operator loses the result.
 *  The operator arm swallows EPIPE alone on BOTH streams, so the relay keeps draining, the op finishes and its exit is
 *  relayed. Any other stream error still throws. Installed once per process.
 *  The listener is `.on`, never `.once`, and that is load-bearing (HI2 H-199): after an EPIPE Node's stdio stream is NOT
 *  destroyed (stdio's dummyDestroy un-destroys it), so every later write retries the syscall and emits a fresh EPIPE
 *  (measured on Node 24.14.1: 49 events over 50 writes). A `.once` listener would swallow the first and crash on the second. */
let stdioGuarded = false;
function guardClosedStdio() {
  if (stdioGuarded) return;
  stdioGuarded = true;
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (e) => {
      if (e && e.code === 'EPIPE') return;
      throw e;
    });
  }
}

/** main's arm for `import`, `prune`, `reparse` and `doctor`: argv is main's own, the verb first, `--json` anywhere.
 *  Under --json, stdout is the envelope alone and the sweep's lines go to stderr; every relayed line arrives here
 *  already through redactFinalLines (runOpVerb's relayIndexOf). */
export async function operatorMain(home, argv) {
  guardClosedStdio();
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  const verb = rest[0] ?? '';
  if (verb === 'doctor' && rest.length === 1) {
    const env = await statusWithHealth(home, Date.now());
    process.stdout.write(json ? `${JSON.stringify(env)}\n` : formatHealth(env.health).map((l) => `${l}\n`).join(''));
    return env.exit;
  }
  const P = healthLib.historyPaths(home);
  const emit = (line) => {
    const text = `${line}\n`;
    if (json) process.stderr.write(text);
    else process.stdout.write(text);
  };
  // A throw out of the door that is neither a StoreError nor a SQLite error (relayIndexOf's rethrow) is a defect: exit 1.
  // Its line names the operator like every other non-zero line of an operator verb, and goes through errLine (R-X-OPERATOR;
  // HA2 H-37). It is the only line, so the exit-words line below is skipped.
  let thrown = false;
  let r;
  try {
    r = await runOpVerb(home, verb, rest.slice(1), emit);
  } catch (e) {
    thrown = true;
    r = { exit: EXIT.INTERNAL };
    errLine(`ccrc history ${verb}: internal error: ${e && e.message ? e.message : String(e)}; ${OP_OPERATOR_NOTE_ANY}`);
  }
  if (json) {
    const id = readTrimmed(P.storeId);
    const env = healthLib.readEnvelope({
      exit: r.exit, ...(r.reason === undefined ? {} : { reason: r.reason }),
      storeId: id !== null && healthLib.UUID_RE.test(id) ? id : null,
      scope: null, header: null, items: [], shown: 0, total: 0, next: null,
    });
    process.stdout.write(`${JSON.stringify(env)}\n`);
  } else if (r.exit !== EXIT.OK && !thrown) {
    const words = OP_EXIT_WORDS[r.exit] ?? `${r.exit === EXIT.REFUSED ? 'refused' : 'store error'}: ${r.reason ?? ''}`;
    process.stderr.write(`ccrc history ${verb}: ${words}; ${OP_OPERATOR_NOTE[r.exit] ?? OP_OPERATOR_NOTE_ANY}\n`);
  }
  return r.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The entry guard stays the LAST statement of cli.mjs. main() runs while this module is still evaluating (its
  // synchronous part runs at the call), so a module-level const declared below this guard would still be
  // uninitialised when main reads it: every later block (Task 28's health block) goes ABOVE it. No top-level await.
  // The code is set as process.exitCode, and process.exit() then ends the process with it, never a drained event
  // loop: a stat that never settled pins a libuv thread (above). Writing '' first lets a piped stdout flush before
  // the exit (a pipe is asynchronous on macOS, where the Darwin row answers 9). The .catch turns a throw out of
  // main into one stderr line and exit 1, never a raw unhandled rejection.
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; process.stdout.write('', () => process.exit()); })
    .catch((e) => {
      errLine(`ccrc history: internal error: ${e && e.message ? e.message : String(e)}`);
      process.exitCode = EXIT.INTERNAL;
      process.exit();
    });
}
