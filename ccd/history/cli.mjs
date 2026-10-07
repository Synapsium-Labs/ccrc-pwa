#!/usr/bin/env node
// ccd/history/cli.mjs — `ccrc history`, reached by ONE dispatch line in ccd/ccrc
// (`history) exec node --no-warnings "$CCRC_HERE/history/cli.mjs" "$@" ;;`; spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §5.1, §8).
//
// W1-B1 ships ONE verb, `status [--json]` (§8.4). It is a BOX verb: identity-free (§8.2; D-4249
// history-box-verbs-identity-free) — it reads no TMUX_PANE, runs no tmux and derives no session id — and it
// writes NO spool line (D-4250 history-box-verbs-no-counter-line), because doctor runs it on every `ccrc doctor`.
// Every other verb answers exit 2 `bad-args` until W1-B2 ships the read verbs and the operator verbs.
//
// Departures carried here: D-4167 (history-coverage-this-box: every answer carries store_id and coverage),
// D-4169 (history-exit-codes-4-and-9) and D-4171 (history-reasons-by-exit) for the exit words, D-4183
// (history-shim-role-gated: a server role answers 9), D-4184, D-4185, D-4186 and D-4188 (the pending, recoverable,
// unbound and wal-orphaned refusals, decided by lib's table), D-4187 (history-store-unreachable: the 2 s stat) and
// D-4212 (history-cli-reads-store-version: user_version first, v1 columns only).
//
// L4 delivery (§6.4): it MEASURES and hands what it measured to lib.mjs's decisions — decideCliStore, §8.3's
// no-store table, here; deriveHealth from Task 28. It decides nothing itself.
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
// It prints no recalled text — ids, paths, counts and words only — so no output redaction applies here
// (§8.3's layers run on recalled fields, which the read verbs of W1-B2 print).
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXIT, COVERAGE, MIGRATION_VERDICTS, SCHEMA_VERSION, UUID_RE, HARNESSES, CLI_STAT_DEADLINE_MS,
  historyPaths, readBoxEnvValue, decideCliStore, capOf, floorThreshold, exportHorizonDays, parseOpMarker,
} from './lib.mjs';
import { measureStoreFacts, openReader, userVersion, measuredSize, probeFts5 } from './store.mjs';

process.umask(0o077);

/** Every statement status prepares besides its PRAGMAs (the cost pin reads this object). */
export const STATUS_SQL = Object.freeze({
  meta: 'SELECT k, v FROM meta',
  counters: 'SELECT name, n FROM counters',
  ticks: 'SELECT tick_id, ts_ms, lag_ms, bytes, files_behind, bytes_behind FROM ticks ORDER BY tick_id DESC LIMIT 3',
  recover: "SELECT version, cursor FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL ORDER BY version DESC LIMIT 1",
  outbox: 'SELECT count(*) AS n FROM journal_outbox',
  ftsTable: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blobs_fts'",
});

/** What a human reads for each non-zero exit (§8.3's table; the word itself is in `reason`). */
const EXIT_MEANING = Object.freeze({
  [EXIT.REFUSED]: 'refused',
  [EXIT.DB]: 'store error',
  [EXIT.NOT_INDEXED]: 'not indexed yet: the first tick has not created the store, or this store has no rows yet',
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

function readTrimmed(p) {
  try { return readFileSync(p, 'utf8').trim(); } catch { return null; }
}

function listNames(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** CCRC_ROLE exactly as doctor's _check_skills reads it (ccd/ccrc-doctor-checks:3016): a regular, readable
 *  file, one key, readBoxEnvValue's rules (O53); anything else is '' (not server). */
function readRole(P) {
  let text;
  try {
    if (!statSync(P.ccrcEnv).isFile()) return '';
    text = readFileSync(P.ccrcEnv, 'utf8');
  } catch { return ''; }
  const r = readBoxEnvValue(text, 'CCRC_ROLE');
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
    recovering: null, op: null, history_off: false, shim_mtime_ms: null,
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
  // The sweep's capText rule (Task 14), spelled again because cli.mjs imports nothing from sweep.mjs: absent is
  // null (the default, not malformed); an unreadable file is '' — malformed, so doctor WARNs (§9.3).
  let capRead;
  try { capRead = readFileSync(P.cap, 'utf8'); } catch (e) {
    capRead = e !== null && typeof e === 'object' && e.code === 'ENOENT' ? null : '';
  }
  const cap = capOf(capRead);
  env.cap_gb = cap.gb;
  env.cap_malformed = cap.malformed;
  const text = readTrimmed(P.op);
  const m = text === null ? null : parseOpMarker(text);
  env.op = m === null ? null : { verb: m.verb, pid: m.pid, alive: pidAlive(m.pid), start_ms: m.startMs };
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

/** The FTS word (§9.1): the read-only probe, then whether derivation has made the table. A probe that throws
 *  is probe-failed, never folded into absent. */
function ftsWord(db) {
  let probe;
  try { probe = probeFts5(db); } catch { return 'probe-failed'; }
  if (probe === 'absent') return 'fts5-absent';
  return db.prepare(STATUS_SQL.ftsTable).get() === undefined ? 'fts-pending' : 'ready';
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
    const recorded = meta.get('migration');
    env.migration = uv > SCHEMA_VERSION ? 'refuse-newer' : (MIGRATION_VERDICTS.includes(recorded) ? recorded : 'none');
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
      .filter(([k, v]) => k.startsWith('retention_state:') && v === 'unmeasured')
      .map(([k]) => k.slice('retention_state:'.length))
      .sort();
    const unreadable = parseJsonOr(meta.get('redact_unreadable'), []);
    env.redact_unreadable = Array.isArray(unreadable) ? unreadable.filter((x) => typeof x === 'string') : [];
    if (mode !== 'wal') {
      env.exit = EXIT.DB;
      env.reason = 'store-not-wal';
    }
  } finally {
    db.close();
  }
}

/** `status --json`'s envelope (§8.3, §8.4). The no-store answer is §8.3's table in its own order: Darwin,
 *  the recorded role, the 2 s reachability stat, then every presence input measured (an unreadable one is
 *  store-unmeasured, never absent). */
export async function statusEnvelope(home, nowMs) {
  const P = historyPaths(home);
  const env = emptyEnvelope(P);
  const darwin = process.platform === 'darwin';
  const role = readRole(P);
  env.role = role;
  if (darwin || role === 'server') {
    return decided(env, decideCliStore({ ...unmeasuredFacts(role), darwin, statSettled: true, shim: 'unmeasured' }));
  }
  boxFacts(env, P);
  const stat = await settleWithin(fsp.stat(P.dbFile), CLI_STAT_DEADLINE_MS);
  if (!stat.settled) {
    const id = readTrimmed(P.storeId);
    env.store_id = id !== null && UUID_RE.test(id) ? id : null;
    return decided(env, decideCliStore({ ...unmeasuredFacts(role), darwin, statSettled: false, shim: presence(P.shim) }));
  }
  const facts = measureStoreFacts(home, role);
  if (facts.storeId.state === 'value') env.store_id = facts.storeId.value;
  else if (facts.dbStoreId.state === 'value') env.store_id = facts.dbStoreId.value;
  const d = decideCliStore({ ...facts, darwin, statSettled: true, shim: presence(P.shim) });
  await freeSpace(env, P);
  env.snapshot_bytes = snapshotBytes(P);
  if (d.read) readStore(env, P, nowMs);
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

/** `ccrc history <verb> …`. W1-B1: `status [--json]` only. */
export async function main(argv) {
  const home = process.env.HOME ?? '';
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  if (rest.length !== 1 || rest[0] !== 'status') {
    process.stderr.write('usage: ccrc history status [--json]   (W1-B1; the read and operator verbs arrive with W1-B2)\n');
    if (json) process.stdout.write(`${JSON.stringify({ ...emptyEnvelope(historyPaths(home)), exit: EXIT.REFUSED, reason: 'bad-args' })}\n`);
    return EXIT.REFUSED;
  }
  const env = await statusEnvelope(home, Date.now());
  process.stdout.write(json ? `${JSON.stringify(env)}\n` : render(env));
  return env.exit;
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
      process.stderr.write(`ccrc history: internal error: ${e && e.message ? e.message : String(e)}\n`);
      process.exitCode = EXIT.INTERNAL;
      process.exit();
    });
}
