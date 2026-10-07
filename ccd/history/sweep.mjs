// ccd/history/sweep.mjs — the history store's writer (L4 delivery, spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §5.1,
// §9.2): one pass, run by the bash shim ccd/ccd-history-sweep under its flock,
// on the 2-minute timer or from the operator's shell with `--op <verb>`.
//
// IT DELIVERS, IT DOES NOT DECIDE. Every verdict comes from lib.mjs (L1) over
// facts this file and store.mjs measure: `decideStoreOpen` (create, open,
// finish a pending creation, or refuse), `planMigration` and `planRun` (run,
// hold or pause), `passOutcome` (the word and exit of a pass that does not
// tick). The shim is the ONLY lock taker (RV13): this file never takes a lock,
// and it is never run except under the shim's — a direct run is a test's.
//
// THE ORDER OF A PASS, up to the tick:
//   history-off → role (CCRC_ROLE in ~/.ccrc/ccrc.env, readBoxEnvValue) →
//   the free-space probe on db/ (async, STATFS_DEADLINE_MS: a dead volume is a
//   pause BEFORE any synchronous read under db/ can block, RR15) → the store
//   facts → decideStoreOpen → stale temps → the stored version and
//   planMigration → planRun → create / finish / open → `tick`.
// `tick` is the bound store's whole tick (§9.2's order;
// D-4224); each later step is added there, and nothing above it
// changes for that.
//
// Reads exactly one environment variable, HOME, in `runPass` below
// (`deps.home ?? process.env.HOME`, integration contract 4) — the frozen
// allow-list single-definition.test.ts pins; tests reach every fault through a
// test-only preload, never a variable this file reads (§10.1 "Seams").
import fs, {
  chmodSync, closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync,
  readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CARRIER_KILL_S, EXIT, SCHEMA_ADDED, SCAN_INTERVAL_MS, STATFS_DEADLINE_MS, capOf, decideCandidate,
  decideEpochLine, decideRekey, decideStoreOpen, floorThreshold, locationMatches,
  UUID_RE, WRITER_RE, drainingNameOk, eventKey, historyPaths, idOk, joinGeneration, journalRecord, parseSpoolLine,
  passOutcome, planFileRead, planMigration, planRun, readBoxEnvValue, sha256Bytes, sha256Hex, splitSpoolText,
  CHUNK_BYTES, LINE_MAX, RUN_BUDGET_MS, RUN_BUDGET_BYTES, withinBudget, isStoredRow, uuidlessTypeOf, blobBodyOf, entryOf,
  boundaryOf, provenanceOf, variantCauseOf, canonicalJson, blobShaOfBytes, ROW_TYPES, PARSE_STATE, RAW_ROW, PROV_VERSION,
  toolUsesOf, toolResultIdsOf, rawRowKey, launchFactsOf, lagOfTick, SIDECAR_WHOLE_MAX, linkSidecar, ftsTextOf,
  SECRET_SOURCES, SECRET_MIN_LEN, extractSecretValues, secretPairs, sessionHashPairs, makePairIndex, secretKindOf,
  SEARCHABLE_PROVENANCE, SIDECAR_FTS_BYTES, ftsPhrase, redactField,
} from './lib.mjs';
import {
  MIGRATIONS, StoreError, bump, clearDoneMarkers, closeWriter, createStore, dropPending, finishPending, getMeta,
  measureStoreFacts, measuredSize, openReader, openWriter, readAttempts, removeStaleTemps, runMigration, setMeta,
  syncWriterMirror, userVersion, withTx,
  CODEC, brotli, unbrotli, compressFdRange, probeFts5, createFtsTables,
} from './store.mjs';
import { isBoundaryLine } from '../compact-card.mjs';

const USAGE = 'usage: sweep.mjs [--op <verb> <op-args...>] [--roster-unreadable] --secrets <file...> -- <home...>';

/** The shim's argv, exactly: `[--op <verb> <op-args…>] [--roster-unreadable]
 *  --secrets <file…> -- <home…>` (§5.1 step 5). An op's arguments run up to the
 *  first `--roster-unreadable` or `--secrets`. Anything else is `bad-args`. */
export function parseSweepArgv(argv) {
  let i = 0;
  let op = null;
  const opArgs = [];
  if (argv[0] === '--op') {
    op = argv[1] ?? '';
    if (!/^[a-z][a-z-]{0,31}$/.test(op)) return { error: 'bad-args' };
    i = 2;
    while (i < argv.length && argv[i] !== '--roster-unreadable' && argv[i] !== '--secrets') opArgs.push(argv[i++]);
  }
  let rosterUnreadable = false;
  if (argv[i] === '--roster-unreadable') { rosterUnreadable = true; i += 1; }
  if (argv[i] !== '--secrets') return { error: 'bad-args' };
  i += 1;
  const secrets = [];
  while (i < argv.length && argv[i] !== '--') secrets.push(argv[i++]);
  if (argv[i] !== '--') return { error: 'bad-args' };
  return { op, opArgs, rosterUnreadable, secrets, homes: argv.slice(i + 1) };
}

/** `fs.promises.statfs` raced against a deadline (§9.3; RR15;
 *  D-4187, D-4179). It FOLLOWS a
 *  db/ link, which is the point: the volume is what can be dead. `unsettled`
 *  means the probe never answered — its threadpool thread dies with the
 *  process, which the entry guard ends with `process.exit` rather than wait
 *  for it.
 *  `threw` (ENOENT on a dangling link, EIO) is reported apart: a dangling link
 *  is decided by the store facts, an erroring volume is a low-disk pause. */
export async function statfsWithDeadline(p, ms, statfs = (q) => fs.promises.statfs(q)) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'unsettled' }), ms); });
  const probe = Promise.resolve().then(() => statfs(p)).then(
    (s) => ({ state: 'ok', bytes: Number(s.bavail) * Number(s.bsize), fsSize: Number(s.blocks) * Number(s.bsize) }),
    () => ({ state: 'threw' }),
  );
  try {
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The cap file's text, or null when absent. An unreadable file is the empty
 *  string — malformed, so the default applies and doctor WARNs (§9.3). */
function capText(capPath) {
  try { return readFileSync(capPath, 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? null : '';
  }
}

// ── The journal (spec §9.14) ──────────────────────────────────────────────────────────────────────────────
//
// The second copy of what only the store holds: drained spool lines, the verdicts taken from registry state or an
// operator's argument, learned redaction pairs and tick records (D-4227, slug history-spool-journal-retained). It follows
// coord.db's doctrine, "the markdown ledger stays the disaster-recovery ground truth" (server/src/coord/db.ts:110).
// - It is append-only and sits in the real root on the home filesystem, never under db/, so a volume lost with the
//   store leaves it.
// - There is one file per UTC month and writer token, journal/<store_id>/<YYYY-MM>.<writer>.jsonl (slug
//   history-journal-writer-token; D-4226), so two boxes that ran one store in turn never write the same name.
// - The caller reads the token into `ids` from ~/.ccrc/history/store.writer only (D-4220, slug history-store-writer-file),
//   never from meta. The journal half must be able to name its file exactly when the DB is missing or must not be
//   opened.
// - Only this sweep writes here, under the shim's flock.

/** A journal append, its fsync, or a month file's creation that did not complete. The caller keeps the draining
 *  file in `.draining/` and runs no drain transaction for it (§9.2 "Journal first"). A verdict stays in the outbox.
 *  `code` is a closed word ('bad-name' | 'short-write' | 'append-failed'), never an OS message. */
export class JournalError extends Error {
  constructor(code, cause) {
    super(`journal: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'JournalError';
    this.code = code;
  }
}

const MONTH_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** The UTC month an append at `ms` lands in, 'YYYY-MM'. UTC, so a box's timezone never splits one month in two. */
export function monthOf(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The one place a journal file's name is spelled. The guard matters: `storeId` and `writer` become path segments,
 *  and a value that is not a store id or a writer token must never name a file. A `..` would leave the store's own
 *  directory. */
export function journalFilePath(home, storeId, writer, month) {
  if (!UUID_RE.test(storeId) || !WRITER_RE.test(writer) || !MONTH_RE.test(month)) throw new JournalError('bad-name');
  return `${historyPaths(home).journalDir}/${storeId}/${month}.${writer}.jsonl`;
}

/** fsync a directory, so a link(), rename or unlink inside it survives a power loss. */
export function fsyncDir(dir) {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Remove this month's and this writer's month-file temps (`.<month>.<writer>.jsonl.<pid>.tmp`), never another
 *  writer's or month's. A kill between createMonthFile's link() and its unlink() leaves one that is a hard link to
 *  the LIVE month file: it shares the inode, grows with every append and outlives any later removal of the month
 *  file. */
function removeStaleMonthTemps(dir, ids, month) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith(`.${month}.${ids.writer}.jsonl.`) && n.endsWith('.tmp')) unlinkSync(`${dir}/${n}`);
  }
}

/** A month file is born holding its `head` (rev 3.2 review, DI14):
 *  - the head goes into a fsynced temp;
 *  - the temp is link()ed to the month's name;
 *  - the directory is fsynced.
 *  So wherever a kill lands, the month file either does not exist or opens with its head. A temp left by a killed
 *  pass is removed first. Its name starts with a dot and ends in `.tmp`, so nothing that lists `*.jsonl` ever reads
 *  it. */
function createMonthFile(dir, file, ids, month, nowMs) {
  removeStaleMonthTemps(dir, ids, month);
  const tmp = `${dir}/.${month}.${ids.writer}.jsonl.${process.pid}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    const head = Buffer.from(`${journalRecord('head', nowMs, { store_id: ids.storeId, month, writer: ids.writer })}\n`, 'utf8');
    if (writeSync(fd, head) !== head.length) throw new JournalError('short-write');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  linkSync(tmp, file);
  unlinkSync(tmp);
  fsyncDir(dir);
}

/** Append `lines` (each one record, with no newline) to this month's file for this store and writer, in ONE write,
 *  then fsync.
 *  - A torn last line: if the file's last byte is not `\n` (a short write under a full filesystem), the same write
 *    adds `\n` first. That is an append, never a rewrite, so the torn line stays one malformed line that replay
 *    skips, and the next record starts clean (§9.14 "A torn last line", RC4).
 *  - Modes are explicit (0700 directories, 0600 files), so an inherited umask never decides them.
 *  - Any failure throws JournalError. It never retries by itself. */
export function appendJournal(home, ids, lines, nowMs) {
  const month = monthOf(nowMs);
  const file = journalFilePath(home, ids.storeId, ids.writer, month);
  if (lines.length === 0) return;
  const dir = `${historyPaths(home).journalDir}/${ids.storeId}`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // D-4308 (history-journal-temp-swept-every-append): swept on EVERY append, before the existence check, not only
    // when the month file is first created. A kill between createMonthFile's link and its unlink leaves the month
    // file in place with a temp link to it, which the creation-only sweep never reached. One readdir per call;
    // appendJournal is the batch entry point (callers hand it a whole block).
    removeStaleMonthTemps(dir, ids, month);
    if (!existsSync(file)) createMonthFile(dir, file, ids, month, nowMs);
    const fd = openSync(file, 'a+', 0o600);
    try {
      let lead = '';
      const size = fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) lead = '\n';
      }
      const buf = Buffer.from(`${lead}${lines.map((l) => `${l}\n`).join('')}`, 'utf8');
      if (writeSync(fd, buf) !== buf.length) throw new JournalError('short-write');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (e instanceof JournalError) throw e;
    throw new JournalError('append-failed', e);
  }
}

// ── The outbox (§9.14 "The order of writes"; D-4225, slug history-journal-outbox) ─────────────────────────────────
// A verdict is inserted into journal_outbox under synchronous=FULL, in the transaction that makes it. It reaches the
// journal through here: appended and fsynced as one block, and only then deleted. A crash between the two leaves the
// rows, and the next tick appends them again before anything else. That costs a duplicate record, which replay
// absorbs; it never loses one.

/** Append every outbox row, in seq order, as one journal block. Returns the highest seq appended (0 when none) and
 *  how many rows. The caller deletes them only after whatever must follow the append has happened (a drain's
 *  unlink, §9.14 steps 5 and 6). */
export function appendOutbox(db, home, ids, nowMs) {
  const rows = db.prepare('SELECT seq, rec FROM journal_outbox ORDER BY seq').all();
  if (rows.length === 0) return { upto: 0, count: 0 };
  appendJournal(home, ids, rows.map((r) => r.rec), nowMs);
  return { upto: rows[rows.length - 1].seq, count: rows.length };
}

/** Delete the outbox rows that a journal append already holds. */
export function deleteOutbox(db, uptoSeq) {
  if (uptoSeq <= 0) return;
  withTx(db, 'NORMAL', () => { db.prepare('DELETE FROM journal_outbox WHERE seq <= ?').run(uptoSeq); });
}

/** Append and fsync, then delete. Used for a later confirmation, for a mapping, and as the tick's own first act
 *  (§9.2 "First, the outbox"). Returns how many rows reached the journal. A failed append throws JournalError with
 *  every row still in the outbox. */
export function flushOutbox(db, home, ids, nowMs) {
  const out = appendOutbox(db, home, ids, nowMs);
  deleteOutbox(db, out.upto);
  return out.count;
}

/** A counter bumped outside any other transaction. A database too busy to take it now is no reason to fail the pass
 *  that noticed: the condition it counts recurs, and so does the count. */
export function countOutside(db, name) {
  try { withTx(db, 'NORMAL', () => bump(db, name)); } catch { /* recounted on the next tick that meets it */ }
}

// ── The spool drain, two-phase (spec §9.2 step 1, §9.14 "The order of writes") ──────────────────────────────
//
// At tick N each spool/<id>.jsonl is renamed to spool/.draining/<id>.<tickMs>.<pid>.jsonl (so a name is never reused)
// and observed. It is read at tick N+1. A hook that opened the old inode just before the rename still lands its line.
// Every per-file step below follows §9.14's order:
//   1. the observation sidecar;
//   2. the `file` and `spool` records, one write, fsynced, then the sidecar's journaled mark;
//   3. the drain transaction under synchronous=FULL, holding its verdicts and one `drained` outbox row;
//   4. the verdict append, fsynced;
//   5. the unlink of the file and its sidecar;
//   6. the outbox delete.
// So a drained file's lines and the verdicts taken from them are both in the fsynced journal before the file goes.

/** Registry values ccd writes are a few dozen bytes; anything larger was not written by ccd. */
const REG_VALUE_MAX = 4096;
/** A sidecar is one observation plus the first-match times of its held lines. */
const SIDECAR_MAX = 64 * 1024;
/** The absent and unreadable Presences. `ABSENT` is this Presence object; Task 22's set of absent-file error codes
 *  is a different value under its own name, `ABSENT_CODES`, so the module never declares `ABSENT` twice. */
const ABSENT = Object.freeze({ state: 'absent' });
const UNREADABLE = Object.freeze({ state: 'unreadable' });
const DRAINING_RE = /^(.+)\.([0-9]+)\.([0-9]+)\.jsonl$/;

/** `<id>.<tickMs>.<pid>.jsonl`. At SPOOL_ID_MAX (224) with a 7-digit pid, it is 252 bytes, within lib's
 *  DRAINING_NAME_MAX (253, D-4303); its sidecar is 250 and the sidecar's temp 254, under the 255-byte NAME_MAX (§5.1). */
export function drainingName(id, tickMs, pid) { return `${id}.${tickMs}.${pid}.jsonl`; }

/** The id is everything before the last three dot-components, so `a.b.c` drains under `a.b.c`. Anything not of
 *  this shape is not a draining file. The grammar is lib's `drainingNameOk` (an id passing idOk, a tick of at most
 *  16 digits, a pid of at most 10, DRAINING_NAME_MAX = 253 bytes in all, D-4303), the one the journal's `file` and `drained` records are checked
 *  against: a name it refuses is never listed, journaled or drained, so it can never make journalRecord throw
 *  mid-tick. DRAINING_RE only splits a name that grammar already admitted. */
export function parseDrainingName(name) {
  if (!drainingNameOk(name)) return null;
  const m = DRAINING_RE.exec(name);
  return { id: m[1], tickMs: Number(m[2]), pid: Number(m[3]) };
}

export function idOfDrainingName(name) {
  const p = parseDrainingName(name);
  return p === null ? null : p.id;
}

/** `.jsonl` replaced by `.obs`, not appended to it: `<file>.obs` would not fit 255 bytes at SPOOL_ID_MAX. */
export function sidecarName(name) { return `${name.slice(0, -'.jsonl'.length)}.obs`; }

/** Read a small regular file, with its type checked BEFORE the open. This is the `_reg_read` lesson
 *  (ccd/ccd:3238-3246): a FIFO with no writer blocks in open(2) forever, and a link to /dev/zero blocks in read(2).
 *  Absent and unreadable are two answers, never folded together (rev 3.2 review, IV5). */
function readSmall(path, max) {
  let st;
  try { st = statSync(path); } catch (e) { return e && e.code === 'ENOENT' ? ABSENT : UNREADABLE; }
  if (!st.isFile() || st.size > max) return UNREADABLE;
  try {
    return { state: 'value', value: readFileSync(path, 'utf8') };
  } catch (e) {
    return e && e.code === 'ENOENT' ? ABSENT : UNREADABLE;
  }
}

/** One registry field as a Presence. The value is trimmed: ccd writes `printf '%s'`, and the hook's `_ct_read`
 *  trims whitespace the same way. */
export function readRegPresence(path) {
  const p = readSmall(path, REG_VALUE_MAX);
  return p.state === 'value' ? { state: 'value', value: p.value.trim() } : p;
}

/** The four facts a drain decides from: `$REG/<id>.uuid`, `.generation`, `.project` and `.workdir`. */
export function readObservation(home, id, nowMs) {
  const reg = historyPaths(home).reg;
  return {
    observedMs: nowMs,
    uuid: readRegPresence(`${reg}/${id}.uuid`),
    generation: readRegPresence(`${reg}/${id}.generation`),
    project: readRegPresence(`${reg}/${id}.project`),
    workdir: readRegPresence(`${reg}/${id}.workdir`),
  };
}

function readSidecar(path) {
  const p = readSmall(path, SIDECAR_MAX);
  if (p.state !== 'value') return null;
  let o;
  try { o = JSON.parse(p.value); } catch { return null; }
  return o !== null && typeof o === 'object' && o.v === 1 && typeof o.observedMs === 'number' ? o : null;
}

/** Temp, fsync, rename, fsync the directory. The temp is `<sidecar>.tmp` (254 bytes at the bound), so no longer
 *  suffix fits. One lock holder at a time, so one temp name is enough. */
function writeSidecar(path, obs) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    const buf = Buffer.from(JSON.stringify(obs), 'utf8');
    if (writeSync(fd, buf) !== buf.length) throw new Error('sidecar: short write');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

/** The file's observation (slugs history-journal-observation-sidecar, D-4231; history-observe-at-rename, D-4232). The registry is
 *  read right after the rename and kept beside the file. Every decision the drain later takes uses this earliest
 *  observation, never the registry as it is then. An existing sidecar is reused, never re-read: a re-journal after a
 *  crash decides from the same facts. A sidecar that does not parse is observed again. */
export function observe(home, name, nowMs) {
  const side = `${historyPaths(home).draining}/${sidecarName(name)}`;
  const had = readSidecar(side);
  if (had !== null) return had;
  const obs = {
    v: 1, ...readObservation(home, idOfDrainingName(name), nowMs),
    late: null, journalT: null, journaled: null, heldMatches: {},
  };
  writeSidecar(side, obs);
  return obs;
}

/** A line whose `ts` is later than the rename's observation is a late append to the old inode. It is decided from
 *  the re-read taken when its file was journaled (§9.2: "re-reads only for lines whose ts is later"). */
export function obsForLine(obs, rec) {
  if (obs.late === null || typeof rec.ts !== 'number' || !(rec.ts > obs.observedMs)) return obs;
  return { ...obs, ...obs.late };
}

/** The draining files, in journaling order: tick ms, then pid, then name. That is the order their `file` records
 *  were written in, so a held clear never chains before an earlier held startup of the same id (rev 3.2 review, DI9).
 *  readdir order is a hash order, and lexical order puts tick 1000 before tick 900. Neither is used. */
export function listDraining(home) {
  let names;
  try { names = readdirSync(historyPaths(home).draining); } catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
  return names
    .map((n) => ({ n, p: parseDrainingName(n) }))
    .filter((x) => x.p !== null)
    .sort((a, b) => a.p.tickMs - b.p.tickMs || a.p.pid - b.p.pid || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
    .map((x) => x.n);
}

/** spool/ and spool/.draining/, 0700. Only a bound, open store makes them, and the hook spools only into an
 *  existing spool/ (§5.1), so capture starts with the first tick of a bound store. */
export function ensureSpoolDirs(home) {
  mkdirSync(historyPaths(home).draining, { recursive: true, mode: 0o700 });
}

/** Rename each regular spool/<id>.jsonl into .draining/ under a fresh name, chmod 0600 (uncounted, §9.2; the 0700
 *  directory is the protection, slug history-spool-mode-by-directory, D-4233). A name no hook writes (an id outside the
 *  grammar), a dot-file, a link or a FIFO stays where it is and is never read. */
export function renameSpoolFiles(home, tickMs, pid) {
  const P = historyPaths(home);
  let names;
  try { names = readdirSync(P.spool).sort(); } catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const n of names) {
    if (n.startsWith('.') || !n.endsWith('.jsonl')) continue;
    const id = n.slice(0, -'.jsonl'.length);
    if (!idOk(id)) continue;
    let st;
    try { st = lstatSync(`${P.spool}/${n}`); } catch { continue; }
    if (!st.isFile()) continue;
    mkdirSync(P.draining, { recursive: true, mode: 0o700 });
    const to = drainingName(id, tickMs, pid);
    try {
      renameSync(`${P.spool}/${n}`, `${P.draining}/${to}`);
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      throw e;
    }
    try { chmodSync(`${P.draining}/${to}`, 0o600); } catch { /* uncounted (§9.2): the 0700 directory protects it */ }
    out.push(to);
  }
  return out;
}

function renameAndObserve(home, tickMs, nowMs) {
  for (const n of renameSpoolFiles(home, tickMs, process.pid)) observe(home, n, nowMs);
}

/** A draining file's whole text. It is opened O_NOFOLLOW|O_NONBLOCK and must be a regular file, so a link or a FIFO
 *  planted in .draining/ is refused rather than followed or waited on. */
export function readDrainingText(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw Object.assign(new Error('draining file is not a regular file'), { code: 'NON_REGULAR' });
    const chunks = [];
    let pos = 0;
    for (;;) {
      const b = Buffer.alloc(64 * 1024);
      const n = readSync(fd, b, 0, b.length, pos);
      if (n === 0) break;
      chunks.push(b.subarray(0, n));
      pos += n;
    }
    const buf = Buffer.concat(chunks);
    return { text: buf.toString('utf8'), bytes: buf.length };
  } finally {
    closeSync(fd);
  }
}

/** The lines that pass parseSpoolLine AND name the file's own id. Only those are journaled and drained (slug
 *  history-journal-spool-grammar, D-4174; the fence that gives empty lines no ordinal, history-spool-line-fenced, D-4176). A line claiming another id would be decided from the wrong id's observation; only
 *  a stray same-user writer or a short write produces either kind of reject. Empty lines, which the fence leaves,
 *  take no ordinal (splitSpoolText). */
export function spoolRecordsOf(text, fileId) {
  const valid = [];
  let rejected = 0;
  for (const { ordinal, raw } of splitSpoolText(text)) {
    const p = parseSpoolLine(raw);
    if (!p.ok || p.rec.id !== fileId) { rejected += 1; continue; }
    valid.push({ ordinal, raw, rec: p.rec });
  }
  return { valid, rejected };
}

/** Steps 1 and 2 for one draining file. Returns the observation and the exact text journaled, which the drain then
 *  decides from.
 *  - Journaled once: a mark naming this store with the same byte count means nothing is written again. A drain under
 *    another store_id journals the file into its own directory first (rev 3.2 review, DI5).
 *  - The journaling time goes into the sidecar BEFORE the append, so a crash between the fsync and the mark
 *    re-journals with the same `t`. A line's receive time never changes (DI14).
 *  - Any late line takes a re-read of the registry, kept in the sidecar too. */
export function journalFile(home, ids, name, nowMs) {
  const P = historyPaths(home);
  const side = `${P.draining}/${sidecarName(name)}`;
  const obs = observe(home, name, nowMs);
  const { text, bytes } = readDrainingText(`${P.draining}/${name}`);
  const j = obs.journaled;
  if (j !== null && j.storeId === ids.storeId && j.bytes === bytes) return { obs, text };
  const { valid } = spoolRecordsOf(text, idOfDrainingName(name));
  let dirty = false;
  if (obs.journalT === null) { obs.journalT = nowMs; dirty = true; }
  if (obs.late === null && valid.some((v) => typeof v.rec.ts === 'number' && v.rec.ts > obs.observedMs)) {
    obs.late = readObservation(home, idOfDrainingName(name), nowMs);
    dirty = true;
  }
  if (dirty) writeSidecar(side, obs);
  const t = obs.journalT;
  appendJournal(home, ids, [
    journalRecord('file', t, { name }),
    ...valid.map((v) => journalRecord('spool', t, { ord: v.ordinal, rec: v.rec })),
  ], nowMs);
  obs.journaled = { t, storeId: ids.storeId, writer: ids.writer, bytes };
  writeSidecar(side, obs);
  return { obs, text };
}

/** What one fresh receipt does besides being received (slug history-event-tables-v1, D-4213; a CLI's counters are
 *  recall lines folded here, history-cli-counts-via-spool, D-4228).
 *  - recall: a recall_calls row (W1-f, the W2 gate).
 *  - steer: a steer_receipts row (written from W3; drained from day one, FE2).
 *  - Stop and PostCompact: a receipt and a discovery hint, nothing else. SessionStart declares epochs (applyEpochLine).
 *  A gen-less recall joins the observed generation, and that join is a verdict, because it read the registry
 *  (§9.14). */
export function applyEventLine(db, c, ev) {
  const { rec } = ev;
  if (rec.ev === 'SessionStart') return applyEpochLine(db, c, ev);
  if (rec.ev === 'recall') {
    const g = joinGeneration({ lineGen: rec.gen ?? null, observedGen: ev.obs.generation });
    db.prepare('INSERT INTO recall_calls (event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_key) DO NOTHING')
      .run(ev.key, rec.id, g.generation, ev.tsMs, rec.cmd, rec.rc, rec.ms, rec.arm ?? null);
    return g.via === 'line' ? [] : [journalRecord('verdict', c.now(), { event_key: ev.key, kind: 'generation-joined', ccrc_id: rec.id, generation: g.generation, via: g.via })];
  }
  if (rec.ev === 'steer') {
    db.prepare('INSERT INTO steer_receipts (event_key, ccrc_id, cc_session_uuid, leaf_id, ts_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_key) DO NOTHING')
      .run(ev.key, rec.id, rec.sid, rec.leaf, ev.tsMs);
    return [];
  }
  return [];
}

function unlinkIfPresent(path) {
  try { unlinkSync(path); } catch (e) { if (!(e && e.code === 'ENOENT')) throw e; }
}

/** Steps 3 to 6 for one journaled file (slugs history-drain-synchronous-full, D-4229; history-journal-drained-record,
 *  D-4230).
 *  - The receipts: event_key comes from the draining name and the ordinal, never a receive time (§9.14).
 *    received_ms is the journaling time; ts_ms is the line's ts ('line'), else received_ms ('received').
 *  - A duplicate key is a no-op. The same key with a different payload is counted and never throws.
 *  - Effects, verdicts and one `drained` outbox row all commit in the one FULL transaction.
 *  - Then the verdicts are appended, then the unlink, then the outbox delete. */
export function drainFile(db, c, name, obs, text) {
  const P = historyPaths(c.home);
  const { valid, rejected } = spoolRecordsOf(text, idOfDrainingName(name));
  const recvMs = obs.journaled.t;
  const nowMs = c.now();
  const hints = [];
  withTx(db, 'FULL', () => {
    const insert = db.prepare('INSERT INTO spool_receipts (event_key, payload_sha, received_ms, ts_ms, ts_source) VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_key) DO NOTHING');
    const prior = db.prepare('SELECT payload_sha FROM spool_receipts WHERE event_key = ?');
    const recs = [];
    for (const v of valid) {
      const key = eventKey(name, v.ordinal);
      const sha = sha256Bytes(v.raw);
      const fromLine = typeof v.rec.ts === 'number';
      const tsMs = fromLine ? v.rec.ts : recvMs;
      if (Number(insert.run(key, sha, recvMs, tsMs, fromLine ? 'line' : 'received').changes) === 0) {
        if (!Buffer.from(prior.get(key).payload_sha).equals(sha)) bump(db, 'receipt_collision');
        continue;   // a duplicate is a no-op: its effects were applied when its receipt was
      }
      recs.push(...applyEventLine(db, c, { key, rec: v.rec, recvMs, tsMs, obs: obsForLine(obs, v.rec) }));
      if (typeof v.rec.sid === 'string') hints.push(v.rec.sid);
    }
    if (rejected > 0) bump(db, 'spool_line_rejected', rejected);
    recs.push(journalRecord('verdict', nowMs, { event_key: 'none', kind: 'drained', file: name }));
    const put = db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)');
    for (const r of recs) put.run(r);
  });
  const flushed = appendOutbox(db, c.home, c.ids, nowMs);
  unlinkSync(`${P.draining}/${name}`);
  unlinkIfPresent(`${P.draining}/${sidecarName(name)}`);
  deleteOutbox(db, flushed.upto);
  return { hints };
}

/** While a file is held, re-read `.uuid` for its startup and resume lines whose sid the observation did not name.
 *  Record the first time each is named (§9.14 Holds), so a session that /clears during a hold keeps its earlier
 *  startup epoch. */
export function recordHeldMatches(home, name, nowMs) {
  const P = historyPaths(home);
  const side = `${P.draining}/${sidecarName(name)}`;
  const obs = readSidecar(side);
  if (obs === null) return;
  const id = idOfDrainingName(name);
  const named = obs.uuid.state === 'value' ? obs.uuid.value : null;
  const waiting = spoolRecordsOf(readDrainingText(`${P.draining}/${name}`).text, id).valid
    .filter((v) => v.rec.ev === 'SessionStart' && (v.rec.src === 'startup' || v.rec.src === 'resume')
      && v.rec.sid !== named && !Object.hasOwn(obs.heldMatches, v.rec.sid));
  if (waiting.length === 0) return;
  const now = readRegPresence(`${P.reg}/${id}.uuid`);
  if (now.state !== 'value' || !waiting.some((v) => v.rec.sid === now.value)) return;
  obs.heldMatches[now.value] = nowMs;
  writeSidecar(side, obs);
}

/** The journal half (§9.2; rev 3.1 review, BK2). It runs whenever the drain cannot: an unopenable or unwritable
 *  store, a refused or escalated migration, a newer schema, or a missing writer token. It renames, observes and,
 *  when `ids` names the store (store.id and store.writer both readable), journals each file, then holds it in
 *  .draining/. It never opens a DB and never counts, because no DB holds a counter here (IV2); the caller prints
 *  `journal-unwritable` on failure. */
export function journalHalf(home, ids, nowMs) {
  const held = [];
  let journalFailed = false;
  // Rename first, so this pass's spool files are observed and journaled in this same pass (§9.2: "renames,
  // observes and journals each spool file as step 1 does"). A line a hook lands on the old inode after this
  // grows the file, and the next pass re-journals it under the same `t` (journalFile compares byte counts).
  renameAndObserve(home, nowMs, nowMs);
  for (const name of listDraining(home)) {
    try {
      observe(home, name, nowMs);
      if (ids !== null && !journalFailed) {
        try {
          journalFile(home, ids, name, nowMs);
        } catch (e) {
          if (!(e instanceof JournalError)) throw e;
          journalFailed = true;
        }
      }
      recordHeldMatches(home, name, nowMs);
      held.push(name);
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ELOOP' || e.code === 'NON_REGULAR')) continue;
      throw e;
    }
  }
  return { held, journalFailed };
}

/** Step 1 with an open store: every draining file in journaling order, each journaled then drained; then this tick's
 *  renames. Returns the sids of the fresh lines (discovery's hints).
 *  - A journal failure stops here, and so does a commit that fails (busy, or the injected test seam). The rest wait,
 *    in order, so no id's later file drains before its earlier one.
 *  - A link or FIFO planted in .draining/ is removed and counted. */
export function drainSpool(db, c) {
  const tickMs = c.now();
  ensureSpoolDirs(c.home);
  const hints = [];
  for (const name of listDraining(c.home)) {
    let j;
    try {
      j = journalFile(c.home, c.ids, name, c.now());
    } catch (e) {
      if (e instanceof JournalError) { countOutside(db, 'journal_write_failed'); break; }
      if (e && (e.code === 'ELOOP' || e.code === 'NON_REGULAR')) {
        // journalFile observed before it read, so the planted name has a sidecar too. listDraining lists only
        // `*.jsonl`, so a sidecar left here would never be removed.
        unlinkIfPresent(`${historyPaths(c.home).draining}/${name}`);
        unlinkIfPresent(`${historyPaths(c.home).draining}/${sidecarName(name)}`);
        countOutside(db, 'non_regular');
        continue;
      }
      if (e && e.code === 'ENOENT') continue;
      throw e;
    }
    try {
      hints.push(...drainFile(db, c, name, j.obs, j.text).hints);
    } catch (e) {
      if (e instanceof JournalError) { countOutside(db, 'journal_write_failed'); break; }
      if (e && e.code === 'ERR_SQLITE_ERROR') { countOutside(db, 'drain_deferred'); break; }
      throw e;
    }
  }
  renameAndObserve(c.home, tickMs, c.now());
  return hints;
}

// ── Epochs and families (spec §6.1, §9.2 step 1, §9.14 verdicts) ──────────────────────────────────────────
//
// A family is one row-life of a ccrc id, (ccrc_id, generation) (D-4192, slug history-family-per-generation). The ccrc id is the
// box-local id (D-4234, slug history-family-box-local). An epoch is one Claude Code uuid in a family, numbered in line order.
// Every decision that attributes rows to a family AND reads registry state is a verdict: an outbox row inserted in the
// FULL transaction that makes it, flushed to the journal right after (D-4225, slug history-journal-outbox). The rules are lib's
// (decideEpochLine, decideCandidate, joinGeneration, locationMatches, decideRekey), which replay calls too (IV4). This
// section only applies them, and decides nothing from file timing (DM11).

const INSERT_CANDIDATE = 'INSERT INTO epoch_candidates (cc_session_uuid, ccrc_id, generation, cause, ts_ms, first_seen_ms) '
  + 'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (cc_session_uuid, ccrc_id) DO NOTHING';
const DELETE_CANDIDATE = 'DELETE FROM epoch_candidates WHERE cc_session_uuid = ? AND ccrc_id = ?';
/** The location rule needs only the first uuid row (§6.1). No more of a transcript than this is read for it. */
const FIRST_ROW_SCAN = 1024 * 1024;

function verdictRecord(nowMs, key, kind, fields) {
  return journalRecord('verdict', nowMs, { event_key: key, kind, ...fields });
}

/** The family row for (ccrc id, generation), made when absent. A `''` row a re-key merged answers with the family it
 *  was merged into, so a replayed `family(id, '')`, or an epoch verdict naming (id, ''), lands in (id, G) (DM18b). */
export function ensureFamily(db, ccrcId, generation, project, nowMs) {
  const row = db.prepare('SELECT session_pk, merged_into FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ccrcId, generation);
  if (row !== undefined && row.merged_into !== null) {
    const into = db.prepare('SELECT session_pk, generation FROM sessions WHERE session_pk = ?').get(row.merged_into);
    return { sessionPk: into.session_pk, created: false, generation: into.generation };
  }
  if (row !== undefined) return { sessionPk: row.session_pk, created: false, generation };
  const r = db.prepare('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, ?, ?, ?)').run(ccrcId, generation, project, nowMs);
  return { sessionPk: Number(r.lastInsertRowid), created: true, generation };
}

/** A re-key is a merge, never a rename (rev 3.2 review, DI4; D-4194, slug history-rekey-merges).
 *  - The `''` family's epochs move into (id, G) and are numbered first, because a generation is minted after them.
 *  - A uuid both families hold stays where (id, G) has it.
 *  - The `''` row stays, with merged_into naming (id, G).
 *  - Renumbering goes through negative seqs, so no statement collides with PRIMARY KEY (session_pk, seq).
 *  - The `''` family's recall rows follow it.
 *  Renaming the key in place throws under UNIQUE (ccrc_id, generation) as soon as (id, G) exists, and a replay over
 *  a backup that already holds the re-key could not repeat it. */
export function mergeFamily(db, fromPk, toPk) {
  db.prepare('DELETE FROM epochs WHERE session_pk = ? AND cc_session_uuid IN (SELECT cc_session_uuid FROM epochs WHERE session_pk = ?)').run(fromPk, toPk);
  const moving = db.prepare('SELECT seq FROM epochs WHERE session_pk = ? ORDER BY seq').all(fromPk);
  db.prepare('UPDATE epochs SET seq = -seq WHERE session_pk IN (?, ?)').run(fromPk, toPk);
  const place = db.prepare('UPDATE epochs SET seq = ? WHERE session_pk = ? AND seq = ?');
  moving.forEach((m, i) => { place.run(i + 1, fromPk, -m.seq); });
  db.prepare('UPDATE epochs SET seq = ? - seq WHERE session_pk = ? AND seq < 0').run(moving.length, toPk);
  db.prepare('UPDATE epochs SET session_pk = ? WHERE session_pk = ?').run(toPk, fromPk);
  const into = db.prepare('SELECT ccrc_id, generation FROM sessions WHERE session_pk = ?').get(toPk);
  db.prepare("UPDATE recall_calls SET generation = ? WHERE ccrc_id = ? AND generation = ''").run(into.generation, into.ccrc_id);
  db.prepare('UPDATE sessions SET merged_into = ? WHERE session_pk = ?').run(toPk, fromPk);
}

/** When generation G appears for an id whose unmerged `''` family holds `uuid` confirmed, that family is G's row-life:
 *  a generation is minted only on absence (§6.1). So it merges into (id, G), which is made when absent. */
function rekeyIfDue(db, ccrcId, generation, uuid, project, nowMs, v) {
  const legacy = db.prepare("SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = '' AND merged_into IS NULL").get(ccrcId);
  if (legacy === undefined) return;
  const confirmed = new Set(db.prepare('SELECT cc_session_uuid FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL')
    .all(legacy.session_pk).map((r) => r.cc_session_uuid));
  if (decideRekey({ observedGeneration: generation, uuid, emptyFamilyUuids: confirmed }) !== 'merge') return;
  const to = ensureFamily(db, ccrcId, generation, project, nowMs);
  if (to.created) v('family', { ccrc_id: ccrcId, generation, project, first_seen_ms: nowMs });
  mergeFamily(db, legacy.session_pk, to.sessionPk);
  bump(db, 'family_rekeyed');
  v('rekeyed', { ccrc_id: ccrcId, generation });
}

/** The family a line, candidate or mapping lands in.
 *  - A gen-less source joins the generation the registry reads when it takes effect (D-4193,
 *    slug history-genless-line-joins-registry-generation).
 *  - An absent generation joins `''`, counted family_gen_absent; an unreadable one joins `''` counted
 *    family_gen_unreadable, never folded into absent (IV5).
 *  - The join is a verdict when it read the registry (`joinVerdict`).
 *  - A new family takes the observed `.project`, as a `family` verdict. Absent or unreadable, it is ''. */
function joinFamily(db, c, j) {
  const nowMs = c.now();
  const g = joinGeneration({ lineGen: j.lineGen, observedGen: j.observedGen });
  if (g.via === 'absent') bump(db, 'family_gen_absent');
  if (g.via === 'unreadable') bump(db, 'family_gen_unreadable');
  if (j.joinVerdict && g.via !== 'line') j.v('generation-joined', { ccrc_id: j.ccrcId, generation: g.generation, via: g.via });
  const project = j.observedProject.state === 'value' ? j.observedProject.value : '';
  if (g.generation !== '') rekeyIfDue(db, j.ccrcId, g.generation, j.uuid, project, nowMs, j.v);
  const f = ensureFamily(db, j.ccrcId, g.generation, project, nowMs);
  if (f.created) j.v('family', { ccrc_id: j.ccrcId, generation: f.generation, project, first_seen_ms: nowMs });
  return f;
}

function claimedElsewhere(db, sessionPk, ccUuid) {
  return db.prepare('SELECT 1 AS x FROM epochs WHERE cc_session_uuid = ? AND session_pk <> ? AND confirmed_ms IS NOT NULL LIMIT 1')
    .get(ccUuid, sessionPk) !== undefined;
}

/** Chain `ccUuid` into a family at the next seq, in line order.
 *  - First claim stands: another family holding the uuid confirmed wins, and this claim is counted uuid_two_sessions
 *    (§6.5). An unconfirmed claim elsewhere (a planted clear line) blocks nobody.
 *  - A uuid this family already holds is not chained again; an unconfirmed one is confirmed when `confirmedMs` is
 *    given. */
export function chainEpoch(db, sessionPk, ccUuid, cause, declaredBy, confirmedMs) {
  if (claimedElsewhere(db, sessionPk, ccUuid)) { bump(db, 'uuid_two_sessions'); return null; }
  const mine = db.prepare('SELECT seq, confirmed_ms FROM epochs WHERE session_pk = ? AND cc_session_uuid = ?').get(sessionPk, ccUuid);
  if (mine !== undefined) {
    if (mine.confirmed_ms === null && confirmedMs !== null) {
      db.prepare('UPDATE epochs SET confirmed_ms = ? WHERE session_pk = ? AND seq = ?').run(confirmedMs, sessionPk, mine.seq);
      return { seq: mine.seq, created: false, confirmedNow: true };
    }
    return { seq: mine.seq, created: false, confirmedNow: false };
  }
  const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM epochs WHERE session_pk = ?').get(sessionPk).s;
  db.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionPk, seq, ccUuid, cause, declaredBy, confirmedMs);
  return { seq, created: true, confirmedNow: confirmedMs !== null };
}

/** Lexically under `$HOME/.claude*`: the first path segment below the user's HOME starts with `.claude`. This is the
 *  agent whitelist's glob (agent/src/whitelist.ts:47-53), applied to the rostered home's path as the shim passed it,
 *  so a home that is itself a symlink still qualifies (§5.2). */
function underClaudeGlob(home, userHome) {
  if (!home.startsWith(`${userHome}/`)) return false;
  return home.slice(userHome.length + 1).split('/')[0].startsWith('.claude');
}

function realOrNull(p) {
  try { return realpathSync(p); } catch { return null; }
}

/** A transcript's first whole uuid row, from its first FIRST_ROW_SCAN bytes: the parsed row, or undefined when no whole
 *  uuid row lies there. The one definition: the location rule (firstUuidRowCwdOf) and the epoch-facts backfill both read
 *  the row through it. */
function firstUuidRowOf(fd) {
  const b = Buffer.alloc(FIRST_ROW_SCAN);
  const n = readSync(fd, b, 0, b.length, 0);
  const lines = b.subarray(0, n).toString('utf8').split('\n');
  lines.pop();   // the last piece has no newline yet, so it is never a whole row
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row !== null && typeof row === 'object' && typeof row.uuid === 'string' && row.uuid !== '') return row;
  }
  return undefined;
}

/** The `cwd` of a transcript's first uuid row: a string, null for a uuid row without one, undefined for no whole uuid
 *  row in the first FIRST_ROW_SCAN bytes. */
function firstUuidRowCwdOf(fd) {
  const r = firstUuidRowOf(fd);
  return r === undefined ? undefined : (typeof r.cwd === 'string' ? r.cwd : null);
}

/** For the location rule (§6.1): the first uuid row's cwd of this uuid's transcript, across the rostered homes, read
 *  only through admission (O_NOFOLLOW, O_NONBLOCK, a regular file under a rostered root). Only that first row is
 *  read: until the epoch confirms, nothing else of the file is (SE5). A read that throws on an admitted file skips
 *  that file, as Task 17's did; it never fails the tick (D-4298, slug history-first-row-read-error-skips-file). */
export function firstUuidRowCwd(homes, userHome, uuid) {
  for (const f of discoverTranscripts(homes, [uuid])) {
    const a = admitFile(f.path, f.home, homes, userHome);
    if (!a.ok) continue;
    try {
      const cwd = firstUuidRowCwdOf(a.fd);
      if (cwd !== undefined) return cwd;
    } catch {
      continue;   // a read that fails on an admitted file: this file cannot place the epoch, the next may (Task 17's rule kept)
    } finally {
      closeSync(a.fd);
    }
  }
  return null;
}

/** A clear epoch confirms by location when its transcript's first uuid row's cwd resolves to the observed `.workdir`:
 *  both realpaths when both resolve, otherwise the verbatim strings (§6.1; D-4191, slug history-epoch-cwd-real). */
function locationConfirms(c, uuid, workdir) {
  if (workdir.state !== 'value') return false;
  const cwd = firstUuidRowCwd(c.homes, c.home, uuid);
  if (cwd === null) return false;
  return locationMatches({ cwd, cwdReal: realOrNull(cwd), workdir, workdirReal: realOrNull(workdir.value) });
}

/** One SessionStart line, inside its file's drain transaction. Returns its verdict lines.
 *  - startup/resume: confirmed by its own reg, by the observed `.uuid`, or by a first match while held. Otherwise it
 *    is a candidate, never chained (D-4190, slug history-epoch-confirmation).
 *  - clear: chained now, in line order. It is confirmed by `.uuid`, a held match or its location, else left
 *    unconfirmed with a candidate row to time its 7 days (D-4189, slug history-clear-epoch-confirmed).
 *  cause='clear' comes from nothing but this line (DM11). */
export function applyEpochLine(db, c, ev) {
  const { rec, obs, key } = ev;
  const nowMs = c.now();
  const out = [];
  const v = (kind, fields) => { out.push(verdictRecord(nowMs, key, kind, fields)); };
  const d = decideEpochLine(rec.reg === undefined ? { src: rec.src, sid: rec.sid } : { src: rec.src, sid: rec.sid, reg: rec.reg }, obs);
  if (d.kind === 'candidate') {
    db.prepare(INSERT_CANDIDATE).run(rec.sid, rec.id, rec.gen ?? '', rec.src, ev.tsMs, ev.recvMs);
    return out;
  }
  const fam = joinFamily(db, c, {
    ccrcId: rec.id, lineGen: rec.gen ?? null, observedGen: obs.generation, observedProject: obs.project,
    uuid: rec.sid, v, joinVerdict: true,
  });
  if (d.kind === 'confirm') {
    const r = chainEpoch(db, fam.sessionPk, rec.sid, rec.src, 'hook', nowMs);
    if (r !== null && (r.created || r.confirmedNow)) {
      db.prepare(DELETE_CANDIDATE).run(rec.sid, rec.id);
      v('epoch-confirmed', { ccrc_id: rec.id, generation: fam.generation, cc_session_uuid: rec.sid, cause: rec.src, declared_by: 'hook', by: d.by });
    }
    return out;
  }
  const by = d.confirmedBy ?? (locationConfirms(c, rec.sid, obs.workdir) ? 'location' : null);
  const r = chainEpoch(db, fam.sessionPk, rec.sid, 'clear', 'hook', by === null ? null : nowMs);
  if (r === null) return out;
  if (r.created) v('epoch-chained', { ccrc_id: rec.id, generation: fam.generation, cc_session_uuid: rec.sid, cause: 'clear' });
  if (by !== null && (r.created || r.confirmedNow)) {
    v('epoch-confirmed', { ccrc_id: rec.id, generation: fam.generation, cc_session_uuid: rec.sid, cause: 'clear', declared_by: 'hook', by });
  }
  if (r.created && by === null) db.prepare(INSERT_CANDIDATE).run(rec.sid, rec.id, fam.generation, 'clear', ev.tsMs, ev.recvMs);
  return out;
}

/** A verdict made outside a drain: one FULL transaction holding its outbox rows, flushed right after (§9.14). With no
 *  writer token the rows wait in the outbox for one. */
function verdictTx(db, c, fn) {
  withTx(db, 'FULL', () => {
    const put = db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)');
    for (const r of fn()) put.run(r);
  });
  if (c.ids === null) return;
  try {
    flushOutbox(db, c.home, c.ids, c.now());
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    countOutside(db, 'journal_write_failed');
  }
}

/** A clear epoch awaiting confirmation, at a later tick: `.uuid` naming it, or its location against the registry's
 *  `.workdir` now. Past the window it is counted epoch_unconfirmed and stays out of every scope; its epochs row is
 *  never deleted. Never confirmed while another family holds the uuid confirmed.
 *  - The 7-day rule is lib's decideCandidate, the same call a startup candidate takes, so the window is decided once
 *    (IV4): past it the candidate drops, even when `.uuid` or the location would match now.
 *  - The location check reads `.workdir` as the registry holds it at this tick, not as observed at the rename, as
 *    §6.1 words it: the v1 epoch_candidates row keeps no observation (D-4189). A pane's
 *    workdir is fixed for its row-life, so the two agree unless the row was replaced meanwhile. */
function confirmClear(db, c, k, currentUuid, nowMs) {
  const fam = db.prepare('SELECT session_pk, merged_into FROM sessions WHERE ccrc_id = ? AND generation = ?').get(k.ccrc_id, k.generation);
  const pk = fam === undefined ? null : (fam.merged_into ?? fam.session_pk);
  const ep = pk === null ? undefined
    : db.prepare('SELECT seq, confirmed_ms FROM epochs WHERE session_pk = ? AND cc_session_uuid = ?').get(pk, k.cc_session_uuid);
  if (ep !== undefined && ep.confirmed_ms !== null) {   // confirmed meanwhile, by a resume line or a registry mapping
    withTx(db, 'NORMAL', () => { db.prepare(DELETE_CANDIDATE).run(k.cc_session_uuid, k.ccrc_id); });
    return;
  }
  const d = decideCandidate({ sid: k.cc_session_uuid, journaledMs: k.first_seen_ms, nowMs, currentUuid, supersededByLaterClearOfSameId: false });
  let by = null;
  if (d.kind !== 'drop' && ep !== undefined && !claimedElsewhere(db, pk, k.cc_session_uuid)) {
    if (d.kind === 'confirm') by = 'later-tick';
    else if (locationConfirms(c, k.cc_session_uuid, readRegPresence(`${historyPaths(c.home).reg}/${k.ccrc_id}.workdir`))) by = 'location';
  }
  if (by === null && d.kind !== 'drop' && ep !== undefined) return;
  verdictTx(db, c, () => {
    const out = [];
    db.prepare(DELETE_CANDIDATE).run(k.cc_session_uuid, k.ccrc_id);
    const generation = pk === null ? k.generation : db.prepare('SELECT generation FROM sessions WHERE session_pk = ?').get(pk).generation;
    if (by !== null) {
      db.prepare('UPDATE epochs SET confirmed_ms = ? WHERE session_pk = ? AND seq = ?').run(nowMs, pk, ep.seq);
      out.push(verdictRecord(nowMs, 'none', 'epoch-confirmed', { ccrc_id: k.ccrc_id, generation, cc_session_uuid: k.cc_session_uuid, cause: 'clear', declared_by: 'hook', by }));
    } else {
      bump(db, 'epoch_unconfirmed');
      out.push(verdictRecord(nowMs, 'none', 'epoch-unconfirmed', { ccrc_id: k.ccrc_id, generation, cc_session_uuid: k.cc_session_uuid, superseded: false }));
    }
    return out;
  });
}

/** Every tick, after the drain: each candidate is confirmed, kept waiting, or dropped after 7 days of its journaling.
 *  - A startup or resume candidate confirms when `.uuid` names its sid. A gen-less one joins the generation the
 *    registry reads then.
 *  - A drop is superseded when `.uuid`, as the registry holds it at the drop, names any clear epoch of the same id
 *    (§14 risk 24). §9.2 words it as the candidate's OBSERVED `.uuid` naming a LATER clear line; the v1
 *    epoch_candidates row keeps no observation and no line order, so the tick reads the registry then
 *    (D-4190).
 *  - Each decision commits FULL in its own transaction and is flushed right after.
 *  The v1 DDL keeps no event_key on a candidate, so these verdicts carry `none` with their natural key, (ccrc_id,
 *  cc_session_uuid). */
export function confirmCandidates(db, c) {
  const P = historyPaths(c.home);
  const rows = db.prepare('SELECT cc_session_uuid, ccrc_id, generation, cause, first_seen_ms FROM epoch_candidates ORDER BY first_seen_ms, ccrc_id, cc_session_uuid').all();
  for (const k of rows) {
    const nowMs = c.now();
    const currentUuid = readRegPresence(`${P.reg}/${k.ccrc_id}.uuid`);
    if (k.cause === 'clear') { confirmClear(db, c, k, currentUuid, nowMs); continue; }
    const superseded = currentUuid.state === 'value' && db.prepare(
      "SELECT 1 AS x FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ? AND e.cause = 'clear' AND e.cc_session_uuid = ? LIMIT 1",
    ).get(k.ccrc_id, currentUuid.value) !== undefined;
    const d = decideCandidate({ sid: k.cc_session_uuid, journaledMs: k.first_seen_ms, nowMs, currentUuid, supersededByLaterClearOfSameId: superseded });
    if (d.kind === 'wait') continue;
    verdictTx(db, c, () => {
      const out = [];
      const v = (kind, fields) => { out.push(verdictRecord(nowMs, 'none', kind, fields)); };
      db.prepare(DELETE_CANDIDATE).run(k.cc_session_uuid, k.ccrc_id);
      if (d.kind === 'drop') {
        bump(db, 'epoch_unconfirmed');
        if (d.superseded) bump(db, 'epoch_unconfirmed_superseded');
        v('epoch-unconfirmed', { ccrc_id: k.ccrc_id, generation: k.generation, cc_session_uuid: k.cc_session_uuid, superseded: d.superseded });
        return out;
      }
      const reg = readObservation(c.home, k.ccrc_id, nowMs);
      const fam = joinFamily(db, c, {
        ccrcId: k.ccrc_id, lineGen: k.generation === '' ? null : k.generation, observedGen: reg.generation,
        observedProject: reg.project, uuid: k.cc_session_uuid, v, joinVerdict: true,
      });
      const r = chainEpoch(db, fam.sessionPk, k.cc_session_uuid, k.cause, 'hook', nowMs);
      if (r !== null && (r.created || r.confirmedNow)) {
        v('epoch-confirmed', { ccrc_id: k.ccrc_id, generation: fam.generation, cc_session_uuid: k.cc_session_uuid, cause: k.cause, declared_by: 'hook', by: 'later-tick' });
      }
      return out;
    });
  }
}

/** The periodic scan's backfill (§6.1 "Backfill"). Each $REG/<id>.uuid that names no epoch of its id and no confirmed
 *  epoch anywhere becomes a `mapping` verdict: cause 'import', declared_by 'registry', committed FULL in its own
 *  transaction before any ingest chunk can need it, and flushed. A forked session enters this way (Q16). A uuid this id's `''` family
 *  already holds is re-keyed instead, once the row reads a generation (§6.10, "A respawn that mints a missing
 *  generation"). */
export function registryBackfill(db, c) {
  const reg = historyPaths(c.home).reg;
  let names;
  try { names = readdirSync(reg).sort(); } catch { return; }
  for (const n of names) {
    if (n.startsWith('.') || !n.endsWith('.uuid')) continue;
    const id = n.slice(0, -'.uuid'.length);
    if (!idOk(id)) continue;
    const nowMs = c.now();
    const obs = readObservation(c.home, id, nowMs);
    if (obs.uuid.state !== 'value' || !UUID_RE.test(obs.uuid.value)) continue;
    const uuid = obs.uuid.value;
    const owner = db.prepare('SELECT s.ccrc_id, s.generation FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? AND e.confirmed_ms IS NOT NULL LIMIT 1').get(uuid);
    if (owner !== undefined) {
      const g = joinGeneration({ lineGen: null, observedGen: obs.generation });
      if (owner.ccrc_id !== id || owner.generation !== '' || g.generation === '') continue;
      const project = obs.project.state === 'value' ? obs.project.value : '';
      verdictTx(db, c, () => {
        const out = [];
        rekeyIfDue(db, id, g.generation, uuid, project, nowMs, (kind, fields) => { out.push(verdictRecord(nowMs, 'none', kind, fields)); });
        return out;
      });
      continue;
    }
    // A clear epoch still awaiting confirmation is confirmCandidates' to decide, or to drop past 7 days (IV4, spec §6.1;
    // D-4297, slug history-backfill-skips-unconfirmed-epoch); a registry mapping must not confirm it. Only a uuid with no
    // epoch row of this id is a backfill. Scoped to this id, so another family's planted unconfirmed clear line still
    // blocks nobody (chainEpoch's doc).
    if (db.prepare('SELECT 1 AS x FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? AND s.ccrc_id = ? AND e.confirmed_ms IS NULL LIMIT 1').get(uuid, id) !== undefined) continue;
    verdictTx(db, c, () => {
      const out = [];
      const v = (kind, fields) => { out.push(verdictRecord(nowMs, 'none', kind, fields)); };
      const fam = joinFamily(db, c, {
        ccrcId: id, lineGen: null, observedGen: obs.generation, observedProject: obs.project, uuid, v, joinVerdict: false,
      });
      const r = chainEpoch(db, fam.sessionPk, uuid, 'import', 'registry', nowMs);
      if (r !== null && (r.created || r.confirmedNow)) {
        db.prepare(DELETE_CANDIDATE).run(uuid, id);
        v('mapping', { ccrc_id: id, generation: fam.generation, cc_session_uuid: uuid, declared_by: 'registry' });
      }
      return out;
    });
  }
}

/** The periodic scan runs every SCAN_INTERVAL_MS (§9.2 step 2, *chosen* 30 min), timed by meta 'scan_ms'. A missing
 *  or unparseable mark means the scan is due. */
export function scanDue(db, nowMs) {
  const last = getMeta(db, 'scan_ms');
  return last === null || !(nowMs - Number(last) < SCAN_INTERVAL_MS);
}

export function markScan(db, nowMs) {
  withTx(db, 'NORMAL', () => { setMeta(db, 'scan_ms', String(nowMs)); });
}

// ── Discovery and file identity (spec §9.2 steps 2-3, §5.2 "Read only", §6.5 "A cursor row's file") ───────────
//
// The cursor is keyed on (dev, ino), proved by the file's identity: its path's uuid, its birth time where the
// filesystem reports one, and its first line's sha where it does not (slugs history-cursor-per-inode,
// history-cursor-file-identity).
// - Every path of an inode is an alias, a file_paths row.
// - An inode freed and reused (every swap carry unlinks before it writes; Claude Code's own cleanup frees inodes) is
//   caught by the identity check. The old row is retired, its paths re-pointed, and the new file gets its own row.
//   It is never resumed or rescanned onto the old row.
// - A rescan deletes nothing (G17).

/** ingest_files.parser_version for every row this build binds. */
export const PARSER_VERSION = 1;
/** A first line longer than this is identified by its first HEAD_MAX bytes: identity needs stability, not the whole
 *  line. */
const HEAD_MAX = 64 * 1024;
const READ_STEP = 64 * 1024;

/** realpath(<home>/projects) of each rostered home lexically under `$HOME/.claude*`. A home with no projects/ yet
 *  (a new account) has no root and is skipped silently. */
export function rosterRoots(homes, userHome) {
  const out = [];
  for (const h of homes) {
    if (!underClaudeGlob(h, userHome)) continue;
    try { out.push(realpathSync(`${h}/projects`)); } catch { /* no projects/ yet: nothing to admit under it */ }
  }
  return out;
}

/** Admission (§5.2, §9.2 step 2). A file is read only when all of these hold:
 *  - its home is rostered and lexically under `$HOME/.claude*`;
 *  - it opens O_NOFOLLOW, so a symlinked name is refused, even one pointing inside the roots;
 *  - it opens O_NONBLOCK, so a FIFO is refused at once and never waited on;
 *  - it is a regular file;
 *  - its realpath lies under one of the rostered projects/ roots.
 *  `missing` and `unreadable` are kept apart from `non_regular` and `outside-roots`, never folded. On `ok` the caller
 *  owns `fd` and must close it. */
export function admitFile(p, home, homes, userHome) {
  if (!homes.includes(home) || !underClaudeGlob(home, userHome)) return { ok: false, why: 'outside-roots' };
  let fd;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = e && e.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, why: 'missing' };
    if (code === 'ELOOP') return { ok: false, why: 'non_regular' };
    return { ok: false, why: 'unreadable' };
  }
  let keep = false;
  try {
    const st = fstatSync(fd, { bigint: true });
    if (!st.isFile()) return { ok: false, why: 'non_regular' };
    let real;
    try { real = realpathSync(p); } catch { return { ok: false, why: 'missing' }; }
    if (!rosterRoots(homes, userHome).some((r) => real.startsWith(`${r}/`))) return { ok: false, why: 'outside-roots' };
    keep = true;
    return { ok: true, fd, st };
  } finally {
    if (!keep) closeSync(fd);
  }
}

/** `<home>/projects/*\/<uuid>.jsonl` for every wanted uuid, across the rostered homes the shim passed. Paths come
 *  from directory entries, never from a uuid spliced into a path. A home with no projects/ is skipped silently. */
export function discoverTranscripts(homes, uuids) {
  const want = new Set(uuids);
  const out = [];
  if (want.size === 0) return out;
  for (const home of homes) {
    let slugs;
    try { slugs = readdirSync(`${home}/projects`).sort(); } catch { continue; }
    for (const slug of slugs) {
      let names;
      try { names = readdirSync(`${home}/projects/${slug}`).sort(); } catch { continue; }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const uuid = n.slice(0, -'.jsonl'.length);
        if (want.has(uuid)) out.push({ path: `${home}/projects/${slug}/${n}`, uuid, home });
      }
    }
  }
  return out;
}

/** The uuids the periodic scan resolves: every confirmed epoch's, and every `$REG/*.uuid` of the UUID grammar. An
 *  unconfirmed clear epoch and a candidate are not known: their files are never discovered for ingest (SE5). */
export function knownUuids(db, home) {
  const out = new Set(db.prepare('SELECT DISTINCT cc_session_uuid AS u FROM epochs WHERE confirmed_ms IS NOT NULL').all().map((r) => r.u));
  const reg = historyPaths(home).reg;
  let names = [];
  try { names = readdirSync(reg); } catch { /* no registry: only the store's epochs are known */ }
  for (const n of names) {
    if (n.startsWith('.') || !n.endsWith('.uuid') || !idOk(n.slice(0, -'.uuid'.length))) continue;
    const v = readRegPresence(`${reg}/${n}`);
    if (v.state === 'value' && UUID_RE.test(v.value)) out.add(v.value);
  }
  return out;
}

/** sha256 of the first line without its `\n`, or of the first HEAD_MAX bytes when no `\n` falls inside them. Null
 *  while a short file has no whole first line yet. */
export function headShaOf(fd, size) {
  const b = Buffer.alloc(Math.min(HEAD_MAX, size));
  const n = b.length === 0 ? 0 : readSync(fd, b, 0, b.length, 0);
  const nl = b.subarray(0, n).indexOf(0x0a);
  if (nl >= 0) return sha256Hex(b.subarray(0, nl));
  return n >= HEAD_MAX ? sha256Hex(b.subarray(0, n)) : null;
}

/** sha256 of the last whole line before `offset`, without its `\n`: the proof a resume needs (§9.2 step 3). Ingest
 *  stores exactly this as tail_sha256. Null when `offset` is 0, past the end, or not just after a `\n`, so a cursor
 *  that no longer sits on a line boundary is never proof. The line is streamed, so any length costs no more than
 *  READ_STEP of memory. */
export function lineShaBefore(fd, offset, size) {
  if (offset <= 0 || offset > size) return null;
  const one = Buffer.alloc(1);
  if (readSync(fd, one, 0, 1, offset - 1) !== 1 || one[0] !== 0x0a) return null;
  const buf = Buffer.alloc(READ_STEP);
  let start = 0;
  for (let pos = offset - 1; pos > 0;) {
    const len = Math.min(buf.length, pos);
    const from = pos - len;
    const n = readSync(fd, buf, 0, len, from);
    const i = buf.subarray(0, n).lastIndexOf(0x0a);
    if (i >= 0) { start = from + i + 1; break; }
    pos = from;
  }
  const h = createHash('sha256');
  for (let p = start; p < offset - 1;) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, offset - 1 - p), p);
    if (n === 0) break;
    h.update(buf.subarray(0, n));
    p += n;
  }
  return h.digest('hex');
}

/** The transcripts row of a Claude Code main-thread session: harness 'claude-code' and agent_id '' (the column
 *  defaults; slug history-harness-seam-named). The ONE definition in sweep.mjs: it runs inside its caller's
 *  transaction (bindFile's here), and Task 21's sidecar ingest calls this same function inside a withTx of its
 *  own rather than declaring a second one. */
function ensureTranscript(db, uuid) {
  db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?) ON CONFLICT (cc_session_uuid, agent_id) DO NOTHING').run(uuid);
  return db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''").get(uuid).transcript_pk;
}

/** After a retire: the old row's paths that now resolve to the new file move with it (§9.2). A path that resolves
 *  elsewhere, or nowhere, keeps naming the old row. */
function repointPaths(db, fromId, toId, st) {
  const move = db.prepare('UPDATE file_paths SET file_id = ? WHERE path = ?');
  for (const { path: p } of db.prepare('SELECT path FROM file_paths WHERE file_id = ?').all(fromId)) {
    let s;
    try { s = statSync(p, { bigint: true }); } catch { continue; }
    if (s.dev === st.dev && s.ino === st.ino) move.run(toId, p);
  }
}

const ROW_BY_INODE = 'SELECT i.file_id, i.dev, i.ino, i.transcript_pk, t.cc_session_uuid, i.birth_ns, i.head_sha256, i.offset, i.tail_sha256 '
  + "FROM ingest_files i JOIN transcripts t ON t.transcript_pk = i.transcript_pk WHERE i.dev = ? AND i.ino = ? AND i.source_key = ''";
const hexOf = (b) => (b === null ? null : Buffer.from(b).toString('hex'));

/** Bind one admitted file to its cursor row and say how to read it. This is lib's planFileRead, executed. The whole
 *  bind is one NORMAL transaction; identity is decided from the transcript alone, so it is not a verdict.
 *  - Identity first. A row whose transcript, birth time or (with no birth time) first-line sha differs is retired:
 *    its source_key becomes 'retired:' + hex(sha256(dev ∖0 ino ∖0 transcript_pk ∖0 retire_ms)), it is counted
 *    inode_recycled, and its paths are re-pointed. The file gets a fresh '' row, read from 0.
 *  - A shrink, or a tail sha that no longer matches, rescans from 0 (a shrink is counted source_shrank). It deletes
 *    nothing: memberships and entries stay.
 *  - Otherwise resume at the cursor.
 *  - Every path seen is an alias in file_paths.
 *  nanosecond columns are read as BigInt (setReadBigInts): as a JS number they throw ERR_OUT_OF_RANGE. */
export function bindFile(db, f, nowMs) {
  return withTx(db, 'NORMAL', () => {
    const transcriptPk = ensureTranscript(db, f.uuid);
    const birth = f.st.birthtimeNs > 0n ? f.st.birthtimeNs : null;
    const size = Number(f.st.size);
    const sel = db.prepare(ROW_BY_INODE);
    sel.setReadBigInts(true);
    const row = sel.get(f.st.dev, f.st.ino);
    const rowOffset = row === undefined ? 0 : Number(row.offset);
    const plan = planFileRead({
      row: row === undefined ? null : {
        transcriptUuid: row.cc_session_uuid,
        birthNs: row.birth_ns,   // a BigInt (setReadBigInts): Task 6's planFileRead compares birth times as BigInt
        // a row bound before its first line was whole has no head yet: the first whole one it shows is its own
        headSha: row.head_sha256 === null && rowOffset === 0 ? f.headSha : hexOf(row.head_sha256),
        offset: rowOffset,
        tailSha: hexOf(row.tail_sha256),
      },
      stat: { size, birthNs: birth },
      pathUuid: f.uuid,
      headSha: f.headSha,
      tailShaAtOffset: row === undefined ? null : lineShaBefore(f.fd, rowOffset, size),
    });
    const head = f.headSha === null ? null : Buffer.from(f.headSha, 'hex');
    let fileId;
    let action = plan;
    let offset = 0;
    let boundTranscript = transcriptPk;
    if (row === undefined || plan === 'retire') {
      if (plan === 'retire') {
        const key = `retired:${sha256Hex(`${row.dev}\0${row.ino}\0${row.transcript_pk}\0${nowMs}`)}`;
        db.prepare("UPDATE ingest_files SET source_key = ?, status = 'retired' WHERE file_id = ?").run(key, row.file_id);
        bump(db, 'inode_recycled');
      }
      fileId = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, size, mtime_ns, birth_ns, head_sha256, offset, tail_sha256, status, parser_version) VALUES (?, ?, '', ?, ?, ?, ?, ?, 0, NULL, 'live', ?)")
        .run(f.st.dev, f.st.ino, transcriptPk, size, f.st.mtimeNs, birth, head, PARSER_VERSION).lastInsertRowid);
      if (plan === 'retire') repointPaths(db, Number(row.file_id), fileId, f.st);
      if (row === undefined) action = 'rescan';
    } else {
      fileId = Number(row.file_id);
      boundTranscript = Number(row.transcript_pk);
      if (plan === 'rescan') {
        if (size < rowOffset) bump(db, 'source_shrank');
        db.prepare("UPDATE ingest_files SET offset = 0, tail_sha256 = NULL, size = ?, mtime_ns = ?, birth_ns = ?, head_sha256 = ?, status = 'live' WHERE file_id = ?")
          .run(size, f.st.mtimeNs, birth, head, fileId);
      } else {
        offset = rowOffset;
        db.prepare('UPDATE ingest_files SET size = ?, mtime_ns = ?, birth_ns = COALESCE(birth_ns, ?), head_sha256 = COALESCE(head_sha256, ?) WHERE file_id = ?')
          .run(size, f.st.mtimeNs, birth, head, fileId);
      }
    }
    db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET file_id = excluded.file_id, last_seen_ms = excluded.last_seen_ms')
      .run(f.path, fileId, nowMs);
    return { fileId, transcriptPk: boundTranscript, action, offset };
  });
}

/** The uuids a tick examines (§9.2 step 2):
 *  - spool hints whose sid is a confirmed epoch;
 *  - every live file still short of its end (a backlog drains over ticks);
 *  - at the periodic scan, every known uuid. */
export function examineUuids(db, home, hints, scan) {
  const out = new Set();
  const confirmed = db.prepare('SELECT 1 AS x FROM epochs WHERE cc_session_uuid = ? AND confirmed_ms IS NOT NULL LIMIT 1');
  for (const h of hints) if (confirmed.get(h) !== undefined) out.add(h);
  const behind = db.prepare("SELECT DISTINCT t.cc_session_uuid AS u FROM ingest_files i JOIN transcripts t ON t.transcript_pk = i.transcript_pk WHERE i.source_key = '' AND i.size > i.offset").all();
  for (const r of behind) out.add(r.u);
  if (scan) for (const v of knownUuids(db, home)) out.add(v);
  return [...out].sort();
}

/** Steps 2-3: discover, admit, bind and plan. One planned item per inode: a hardlinked alias binds as a path, and
 *  the cursor advances once (DM20). Refusals are counted:
 *  - non_regular for a link, a FIFO or a realpath outside the roots;
 *  - file_missing and file_unreadable apart;
 *  - a live file whose every path has gone is skipped and counted, with its cursor untouched (§9.10 "File missing").
 *  Each planned item carries the inode it was bound on, so ingest can re-check it. */
export function discoverAndPlan(db, c, uuids) {
  const planned = [];
  const seen = new Set();
  const found = new Set();
  for (const f of discoverTranscripts(c.homes, uuids)) {
    const a = admitFile(f.path, f.home, c.homes, c.home);
    if (!a.ok) {
      countOutside(db, a.why === 'missing' ? 'file_missing' : a.why === 'unreadable' ? 'file_unreadable' : 'non_regular');
      continue;
    }
    found.add(f.uuid);
    try {
      const b = bindFile(db, { path: f.path, uuid: f.uuid, fd: a.fd, st: a.st, headSha: headShaOf(a.fd, Number(a.st.size)) }, c.now());
      if (seen.has(b.fileId)) continue;
      seen.add(b.fileId);
      planned.push({ ...b, path: f.path, dev: a.st.dev, ino: a.st.ino });
    } finally {
      closeSync(a.fd);
    }
  }
  const live = db.prepare("SELECT 1 AS x FROM ingest_files i JOIN transcripts t ON t.transcript_pk = i.transcript_pk WHERE t.cc_session_uuid = ? AND i.source_key = '' LIMIT 1");
  for (const v of uuids) if (!found.has(v) && live.get(v) !== undefined) countOutside(db, 'file_missing');
  return planned;
}

/**
 * What one tick of a bound, open store carries. runPass builds it; tick and the steps below read it.
 * @typedef {object} TickCtx
 * @property {string} home  the HOME this pass serves
 * @property {object} paths  historyPaths(home) (Task 14; its tick reads `ctx.paths.spool`)
 * @property {object} parsed  parseSweepArgv's result (Task 14; its tick reads `ctx.parsed.rosterUnreadable`)
 * @property {{storeId: string, writer: string} | null} ids  store.id and store.writer as read from the home
 *   filesystem after the create/finish step (§9.14: never from meta); null when either is not a readable value of
 *   its grammar
 * @property {() => number} now  deps.now ?? Date.now
 * @property {string[]} homes  the rostered homes the shim passed after `--`
 * @property {boolean} rosterUnreadable  the shim passed --roster-unreadable
 * @property {(line: string) => void} out  the outcome-line printer (deps.out ?? one console.log line)
 * @property {string[]} [hints]  set by the drain: sids of this tick's fresh spool lines
 * @property {object[]} [planned]  set by Task 18's discovery step: the files bound this tick (Task 19's ingest
 *   discovers and binds per path instead, and leaves it unset)
 * @property {boolean} ingest  planRun's verdict: false under a cap or floor pause (Task 19)
 * @property {object} budget  the run's ONE budget, newBudget(now), spent by every step that reads the disk (Task 19)
 */
/** The bound store's tick (§9.2), handed an open writer connection. Steps are
 *  added here in §9.2's order by the tasks that ship them; what it runs now:
 *  - spool/ exists from a bound store's first tick on: the hook's gate is that
 *    directory, and the hook never makes it (§5.1), so a box with no bound
 *    store — Darwin, a server, a refused store — spools nothing;
 *  - an unreadable roster is counted, once per pass (FE4, O54). */
export async function tick(db, ctx) {
  // >>> history tick steps (spec §9.2; D-4224, slug history-tick-order) ──────────────────────────────────────────
  // First, the outbox. Verdict rows a crash left behind reach the journal before anything else, outside the run
  // budget. With no writer token the journal cannot be named, so the rows wait in the DB and nothing is lost.
  if (ctx.ids !== null) {
    try {
      flushOutbox(db, ctx.home, ctx.ids, ctx.now());
    } catch (e) {
      if (!(e instanceof JournalError)) throw e;
      countOutside(db, 'journal_write_failed');
    }
  }
  // The tick's one ingest context (Task 19), made once and shared by the secrets, the ingest, the launch facts and
  // the ticks row. It is built here, right after the outbox flush, so the secrets step can set its pairIdx (plan task 22).
  const ictx = makeIngestCtx(ctx.home, ctx.homes, ctx.now(), ctx.ids, floorProbeFor(ctx.paths.dbDir));
  // §9.2 "Then the secrets": every pair committed and journaled before any drain or FTS insert.
  const secrets = secretsStep(db, ictx, ctx.parsed.secrets);
  ictx.pairIdx = secrets.pairIdx;
  // §9.1 the probe at every open, then §6.2: every pair whose re-index is still owed (a pair learned this tick, or
  // one a dead pass committed) re-indexes before any FTS insert. Its values are every value this tick loaded.
  ictx.fts = ftsPrepare(db, ictx.nowMs).tables;
  reindexForValues(db, ictx, secrets.values);
  // Step 1, the drain: journal first, then the FULL drain transaction, then its verdicts, then the unlink (§9.14).
  // runPass never ticks without both binding names: a missing store.writer is a hold there (§9.10 "Writer token").
  ctx.hints = drainSpool(db, ctx);
  // Then the candidates: startup and resume lines awaiting `.uuid`, and clear epochs awaiting `.uuid` or their
  // location. Each is decided in its own FULL transaction and flushed right after (§9.2 step 1, §6.1).
  confirmCandidates(db, ctx);
  // The periodic scan (every SCAN_INTERVAL_MS): every $REG/<id>.uuid that names no epoch of its id and no confirmed
  // epoch anywhere becomes a registry mapping, committed FULL before any ingest chunk can need it (§6.1 "Backfill";
  // §9.2 step 4 "Every verdict commits first"; D-4297).
  const scan = scanDue(db, ctx.now());
  if (scan) registryBackfill(db, ctx);
  // Steps 2-3, discovery and the plan. The tick examines hinted confirmed sids, files left short of their end, and
  // at the scan every known uuid, across the rostered homes; each admitted file is bound to its cursor row by
  // identity. An unreadable roster skips discovery and leaves the scan due for the next readable pass (§9.2 step 2).
  // Steps 2-5 (Task 19): discover, admit and bind (Task 18's admitFile and bindFile, inside ingestPath), then
  // stream and write in chunks, under the run's ONE budget. Discovery and binding happen ONCE per tick, here;
  // an unreadable roster discovers nothing, as Task 18's line did (§9.2 step 2). The ingest probes the
  // free-space floor on db/ before every chunk (§9.3, BK17).
  // §9.2 steps 2-5 and 7: one budget for the run; a busy store ends the tick (O22).
  // §9.2 / §9.3 (Task 24): under a cap or floor pause ONLY ingest pauses — the drain above, the
  // confirmations and the tick row below still run, so epoch confirmation stays timely and the lag
  // series has no hole. The re-index above and the merge steps below run under any pause: a learned
  // pair's re-index obligation is durable (meta fts_reindex_rid), so a tick that cannot index leaves it
  // to the next tick that can, and a merge step frees space rather than takes it. The FTS backfill is
  // held with ingest, and when Task 19's per-chunk floor stopped this run's ingest (ing.paused): it
  // grows db/, which a store at its cap or a volume at its floor must not take
  // (D-4242).
  const ing = ctx.ingest && !ctx.rosterUnreadable ? await ingestTick(db, ictx, ctx.budget) : null;
  if (ing !== null && ing.busy) return;   // the write lock is another's: nothing more this tick
  // §6.2 epochs: launch facts an epoch chained after its transcript's first chunk missed (plan task 20).
  if (ing !== null) backfillEpochFacts(db, ictx);
  // Blobs this tick wrote but could not index (no FTS this tick) re-open the completed backfill.
  if (ing !== null && ing.bytes > 0 && ictx.fts !== true) resetFtsPending(db);
  // §9.1 derivation ('fts', 1)'s backfill, within what is left of the ONE budget. It grows db/, so a cap or floor
  // pause, or the per-chunk floor that stopped this run's ingest, holds it (D-4242).
  if (ctx.ingest && !(ing !== null && ing.paused)) deriveFts(db, ictx, ctx.budget);
  // §6.2's merge steps run under any pause (§9.2: only ingest pauses): they purge a late pair's deleted bytes and
  // free space rather than take it.
  mergeSteps(db, ictx, ctx.budget);
  // §9.2 step 6: the tick's row and journal record. A paused ingest records an unmeasured lag.
  recordTick(db, ictx, ing);
  if (scan && !ctx.rosterUnreadable) markScan(db, ctx.now());
  // <<< history tick steps
  mkdirSync(ctx.paths.spool, { recursive: true, mode: 0o700 });
  if (ctx.parsed.rosterUnreadable) bump(db, 'roster_unreadable');
}

// ── THE PASS (Task 24) ────────────────────────────────────────────────────────────────────────────
// One composition for the run, the pause and the hold (spec §9.2 "The order of a tick", §9.3, §9.14
// "Holds", §6.11; D-4224, slug history-tick-order). A scheduled pass decides in this order, and an earlier
// answer ends it:
//   history-off (§9.7) → the recorded role (§6.9) → the free-space probe, which is ALSO the
//   reachability probe and therefore runs before anything stats the volume (§9.3; slug
//   history-store-unreachable) → the binding (decideStoreOpen) → stale temps → create / finish /
//   open → a newer schema, refused with NO write (G9, DM17) → WAL (store-not-wal, §6.2) → the outbox,
//   first and outside the budget (§9.14) → the migration verdict (§6.11) → planRun's arm: migrate,
//   hold, or run with its cap or floor pause → the tick.
// "The journal half runs whenever the drain cannot" (§9.2; D-4231, slug history-journal-observation-sidecar):
// every hold renames, observes and journals the spool with the two names read from store.id and
// store.writer ON THE HOME FILESYSTEM, never from meta (DI5; D-4220, slug history-store-writer-file), so a held
// startup line keeps the registry facts of its rename (O46). Under a cap or floor PAUSE only ingest
// stops; the drain and its journal append still run, so epoch confirmation stays timely (§9.2).

/** Bytes of a file, trimmed, or null when it cannot be read. */
function readTrimmed(p) {
  try { return readFileSync(p, 'utf8').trim(); } catch { return null; }
}

/** A directory's entry names, or [] when it cannot be listed. */
function listNames(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** The journal's two names, read ONLY from the home filesystem (§9.14, DI5): store.id and store.writer.
 *  Either missing or off its grammar → null, and the journal half then observes only (§9.10 "Writer token"). */
export function idsFromFiles(P) {
  const storeId = readTrimmed(P.storeId);
  const writer = readTrimmed(P.writer);
  if (storeId === null || !UUID_RE.test(storeId) || writer === null || !WRITER_RE.test(writer)) return null;
  return { storeId, writer };
}

/** CCRC_ROLE exactly as doctor's _check_skills reads it (ccd/ccrc-doctor-checks:3016): a regular, readable
 *  file, one key, readBoxEnvValue's rules (pinned to _box_env_value by O53). Anything else is '' (not
 *  server), as an absent key is. */
export function readRole(P) {
  let text;
  try {
    if (!statSync(P.ccrcEnv).isFile()) return '';
    text = readFileSync(P.ccrcEnv, 'utf8');
  } catch { return ''; }
  const r = readBoxEnvValue(text, 'CCRC_ROLE');
  return r.found ? r.value : '';
}

/** Where the free-space probe looks: db/ when the name exists (a dangling link included, whose probe
 *  then throws and pauses while decideStoreOpen names the refusal), else the nearest existing ancestor,
 *  so a first install measures the filesystem db/ is about to be made on. */
export function probePath(P, home) {
  for (const p of [P.dbDir, P.root, join(home, '.ccrc'), home]) {
    try { lstatSync(p); return p; } catch { /* the next ancestor */ }
  }
  return home;
}

/** The stored user_version through a read-only handle: a newer store is refused before the writer's open,
 *  which would set WAL and touch meta (G9, DM17: "no write"). */
export function peekVersion(dbFile) {
  const ro = openReader(dbFile);
  try { return userVersion(ro); } finally { ro.close(); }
}

/** One counter's value, 0 when it has never been bumped. */
export function counterOf(db, name) {
  const row = db.prepare('SELECT n FROM counters WHERE name = ?').get(name);
  return row === undefined ? 0 : row.n;
}

/** A scheduled pass's exit for a hold word: 5 for a refusal that waits on the OPERATOR (a binding refusal, a
 *  newer schema, a store that will not take WAL), 0 for a hold that waits on the world (an unreachable volume,
 *  a migration held for room or time, a writer token still to come). The rule is lib's passOutcome (Task 14,
 *  L1), never a second list here: this L4 file only applies it. */
export function holdExit(word) {
  return passOutcome(word).exit;
}

/** The journal half (§9.2), its failure made a value: true when the append or its fsync failed. The
 *  held files stay in .draining/ with their sidecars either way; nothing is lost. */
export function runJournalHalf(home, ids, now) {
  try {
    // Task 16's journalHalf reports a failed append as `journalFailed` (it stops journaling and holds the
    // rest); it throws a JournalError only from a step outside that loop. Both are a failure here.
    return journalHalf(home, ids, now()).journalFailed === true;
  } catch (e) {
    if (e instanceof JournalError) return true;
    throw e;
  }
}

/** A hold: the journal half, the word, and its exit. Under a hold no DB is open, so nothing is counted
 *  (IV2): the word on stdout is the pass's whole record, and journal-unwritable joins it when the append
 *  failed too (§9.10 "Journal append"). */
export function holdPass(home, P, word, now, out) {
  const unwritable = runJournalHalf(home, idsFromFiles(P), now);
  out(`history-sweep: ${word}`);
  if (unwritable) out('history-sweep: journal-unwritable');
  return holdExit(word);
}

/** The journal half's outcome on a pass that HAS a DB open (a migration hold, the migrate arm): a failed append
 *  is counted and recorded exactly as the tick's own (§9.10 "Journal append": journal_write_failed +1, doctor
 *  FAIL through meta journal_unwritable), so a hold for room — when ENOSPC on the journal is likeliest — is never
 *  silent to doctor. IV2's "nothing is counted" is for the holds with no DB open (holdPass). */
export function noteJournalHalf(db, unwritable, now, out) {
  if (unwritable) {
    bump(db, 'journal_write_failed');
    setMeta(db, 'journal_unwritable', String(now()));
    out('history-sweep: journal-unwritable');
  } else {
    setMeta(db, 'journal_unwritable', '');
  }
}

/** The store open a scheduled and an --op pass share (§6.2, §6.9): the binding verdict, stale temps,
 *  creation, the version peek, the pending finish and WAL. It writes nothing but stale-temp removal, and
 *  creates only on `create`, before the peek says this build may; the pending finish waits for it (a newer
 *  store with a pending marker is refused with the marker left and nothing written: DM17, D-4301
 *  history-newer-store-refused-before-finish-pending). It answers {word} for every refusal. */
export function openStore(home, P, role, deps) {
  const facts = measureStoreFacts(home, role);
  let verdict = decideStoreOpen(facts);
  if (verdict.act === 'refuse') return { word: verdict.word };
  // removeStaleTemps propagates any readdir failure but an absent db/ (D-4305): the pass fails loudly, never folded.
  removeStaleTemps(home);
  if (verdict.act === 'drop-pending-create') {
    dropPending(home);
    verdict = { act: 'create' };
  }
  if (verdict.act === 'create') createStore(home);
  const code = (deps.migrations ?? MIGRATIONS).length;
  let stored;
  try {
    stored = peekVersion(P.dbFile);
  } catch (e) {
    if (e instanceof StoreError) return { word: e.word };
    throw e;
  }
  if (stored > code) return { word: 'schema-newer' };
  if (verdict.act === 'finish-pending') finishPending(home);
  let db;
  try {
    db = openWriter(P.dbFile);
  } catch (e) {
    if (e instanceof StoreError) return { word: e.word };
    throw e;
  }
  if (verdict.act === 'finish-pending') bump(db, 'store_creation_completed');
  syncWriterMirror(db, home);
  return { db, stored, code, ids: idsFromFiles(P) };
}

/** First, the outbox (§9.14): rows a crash left are appended and fsynced before anything else, outside
 *  the budget. A failed append keeps them for the next pass and is counted, never thrown. */
export function flushFirst(db, home, ids, now) {
  try {
    flushOutbox(db, home, ids, now());
    return true;
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    bump(db, 'journal_write_failed');
    return false;
  }
}

/** planMigration's inputs, measured (§6.11; D-4182 history-pre-migration-snapshot, D-4180 history-migrate-verb): the stored and code versions, this pass's free space and the
 *  floor's threshold, the store's size, the pass's wall-clock bound (CARRIER_KILL_S for a scheduled pass,
 *  null for --op migrate, which runs under no carrier), the last full copy's rate (meta copy_bps), the
 *  interrupted attempts, and whether any pending version is heavy. An unmeasured free space admits no
 *  copy: freeBytes 0 against an unreachable threshold answers refuse-low-disk. */
export function migrationVerdict(db, home, P, o) {
  if (o.stored === o.code) return 'none';
  let heavy = false;
  for (let v = o.stored + 1; v <= o.code; v += 1) if (o.schemaAdded[v]?.heavy === true) heavy = true;
  const bps = Number(getMeta(db, 'copy_bps'));
  const measured = o.free.state === 'ok';
  return planMigration({
    stored: o.stored,
    code: o.code,
    freeBytes: measured ? o.free.bytes : 0,
    thresholdBytes: measured ? floorThreshold(o.free.fsSize) : Number.MAX_SAFE_INTEGER,
    sizeBytes: o.sizeBytes,
    boundS: o.boundS,
    copyBps: Number.isFinite(bps) && bps > 0 ? bps : null,
    attempts: readAttempts(home, o.code),
    heavy,
  });
}

/** §9.10 "Mode drift" (O23): every store FILE found other than 0600 — the DB with its -wal and -shm (through
 *  db/'s link), backups/*, journal/<store_id>/* — is chmodded back and counted mode_drift. A symlink is
 *  never followed into a chmod. Directories are never chmodded here: a directory other than 0700, db/'s
 *  link target included, is doctor's FAIL to name through status (§9.3, §9.6), because a mode the
 *  operator set on a volume is not this writer's to undo. */
export function fixModes(db, P) {
  const files = [P.dbFile, P.wal, P.shm];
  for (const n of listNames(P.backups)) files.push(join(P.backups, n));
  for (const s of listNames(P.journalDir)) for (const n of listNames(join(P.journalDir, s))) files.push(join(P.journalDir, s, n));
  let fixed = 0;
  for (const f of files) {
    let st;
    try { st = lstatSync(f); } catch { continue; }
    if (!st.isFile() || (st.mode & 0o777) === 0o600) continue;
    try {
      chmodSync(f, 0o600);
      fixed += 1;
    } catch { /* left for doctor's mode check */ }
  }
  if (fixed > 0) bump(db, 'mode_drift', fixed);
  return fixed;
}

/** The context every tick step receives (Tasks 14–23 read these names; Task 26's census too). `pause` is
 *  planRun's ('at-cap' | 'low-disk' | null) and `ingest` its verdict on whether this pass may ingest;
 *  `budget` is the ONE run budget, Task 19's newBudget, never reset per file (§9.2 step 7). `parsed` stays
 *  for Task 14's own tick lines (`ctx.parsed.rosterUnreadable`, `ctx.parsed.secrets`). */
export function passCtx(o) {
  return {
    home: o.home,
    paths: o.P,
    parsed: o.parsed,
    ids: o.ids,
    now: o.now,
    out: o.out,
    deps: o.deps,
    homes: o.parsed.homes,
    secretFiles: o.parsed.secrets,
    rosterUnreadable: o.parsed.rosterUnreadable,
    pause: o.pause,
    ingest: o.ingest,
    budget: newBudget(o.now),
  };
}

/** One scheduled pass (no --op). Returns its exit: 0 for a run, a pause or a hold; 5 for a refusal. */
export async function scheduledPass(parsed, deps, out) {
  const home = deps.home;
  const P = historyPaths(home);
  const now = deps.now ?? Date.now;
  if (existsSync(P.off)) {
    out('history-sweep: off');
    return EXIT.OK;
  }
  const role = readRole(P);
  if (role === 'server') {
    out('history-sweep: store-create-refused-role');
    return EXIT.OK;
  }
  // D-4179 (history-free-space-floor): the ONE probe before the tick. deps.statfs is Task 14's in-process seam; undefined leaves statfsWithDeadline's own default.
  const free = await statfsWithDeadline(probePath(P, home), STATFS_DEADLINE_MS, deps.statfs);
  if (free.state === 'unsettled') return holdPass(home, P, 'store-unreachable', now, out);
  const opened = openStore(home, P, role, deps);
  if ('word' in opened) return holdPass(home, P, opened.word, now, out);
  const { db, stored, code, ids } = opened;
  try {
    if (ids === null) {
      // §9.10 "Writer token": the DB opens but store.writer cannot name a journal file, so nothing may be
      // drained (journal first) — the journal half observes only, until a binding writes the token.
      runJournalHalf(home, null, now);
      out('history-sweep: held');
      return EXIT.OK;
    }
    const failedAtStart = counterOf(db, 'journal_write_failed');
    flushFirst(db, home, ids, now);
    clearDoneMarkers(home, stored);
    const sizeBytes = (deps.measureSize ?? measuredSize)(db, P.dbFile);
    const migration = migrationVerdict(db, home, P, {
      stored, code, free, sizeBytes, boundS: CARRIER_KILL_S, schemaAdded: deps.schemaAdded ?? SCHEMA_ADDED,
    });
    // D-4166 (history-cap-file): the cap is the operator file. capText (Task 14): an unreadable cap file is '' — malformed, so the default applies AND doctor WARNs (§9.3).
    const cap = capOf(capText(P.cap));
    const run = planRun({ historyOff: false, store: { act: 'open' }, free, sizeBytes, capGb: cap.gb, migration, recovering: false });
    if (run.arm === 'migrate') {
      // §6.11: a pass that migrates does nothing else but the journal half; the drain resumes next tick
      // against a store at this build's version.
      runMigration(db, home, { verdict: migration, from: stored, to: code, migrations: deps.migrations ?? MIGRATIONS });
      setMeta(db, 'migration', 'none');
      const unwritable = runJournalHalf(home, ids, now);
      out('history-sweep: migrated');
      noteJournalHalf(db, unwritable, now, out);
      return EXIT.OK;
    }
    if (run.arm !== 'run') {
      // A migration refused for room or escalated as too long (§6.11): unlike at the cap the DRAIN stops
      // too, because the writer never writes a store at an older version (§9.2). Counted on the open DB.
      if (migration === 'refuse-low-disk') bump(db, 'migration_refused_low_disk');
      if (migration === 'snapshot-needs-op') bump(db, 'migration_needs_op');
      setMeta(db, 'migration', migration);
      const word = run.holdWord ?? 'held';
      const unwritable = runJournalHalf(home, ids, now);
      out(`history-sweep: ${word}`);
      noteJournalHalf(db, unwritable, now, out);
      return holdExit(word);
    }
    setMeta(db, 'migration', migration);
    setMeta(db, 'capture_pause', run.pause ?? '');
    if (run.pause === 'at-cap') bump(db, 'capture_paused_at_cap');
    if (run.pause === 'low-disk') bump(db, 'capture_paused_low_disk');
    fixModes(db, P);
    const ctx = passCtx({ home, P, ids, parsed, now, out, deps, pause: run.pause, ingest: run.ingest });
    let busy = false;
    try {
      await tick(db, ctx);
    } catch (e) {
      // SQLITE_BUSY past busy_timeout (Task 20's isBusy) ends the tick: every step committed its own
      // transaction, so nothing committed is lost, and the next tick retries (§9.10, O22). The tick's own last
      // journal append (its `tick` record) failing ends the tick too; the drain's per-file failures were
      // counted where they happened (Task 16). Nothing here is lost.
      if (isBusy(e)) busy = true;
      else {
        if (!(e instanceof JournalError)) throw e;
        bump(db, 'journal_write_failed');
      }
    }
    // A tick that met the lock ends the pass's writing too: each write below would wait out busy_timeout again
    // and then throw out of the pass, which O22 rules is the tick's end, not a failed pass. A lock met only here
    // (an ingest that returned busy rather than throwing) ends them the same way, through the catch.
    if (busy) return EXIT.OK;
    try {
      setMeta(db, 'journal_unwritable', counterOf(db, 'journal_write_failed') > failedAtStart ? String(now()) : '');
    } catch (e) {
      if (!isBusy(e)) throw e;
    }
    return EXIT.OK;
  } finally {
    closeWriter(db);
  }
}

/** The sweep's entry: argv as the shim passes it. Task 25 replaces the --op line with the --op pass. The
 *  home is `deps.home` when a caller injects one (in-process tests), else $HOME, and it must be absolute:
 *  Task 14's rule, kept, so no caller reaches a relative or empty home (integration contract 4). The umask is
 *  set for the pass and restored after it, as Task 14 did, so an in-process caller keeps its own. */
export async function runPass(argv, deps = {}) {
  const home = deps.home ?? process.env.HOME;
  if (typeof home !== 'string' || !home.startsWith('/')) {
    process.stderr.write('history-sweep: HOME is not an absolute path; nothing was swept\n');
    return EXIT.INTERNAL;
  }
  deps = { ...deps, home };
  const out = deps.out ?? ((line) => { process.stdout.write(`${line}\n`); });
  const prevUmask = process.umask(0o077);
  try {
    const parsed = parseSweepArgv(argv);
    if ('error' in parsed) {
      // Task 14's one spelling of the argv grammar; its argv case pins `usage: sweep.mjs`.
      process.stderr.write(`history-sweep: ${USAGE}\n`);
      return EXIT.REFUSED;
    }
    if (parsed.op !== null) {
      out(JSON.stringify({ rc: EXIT.REFUSED, reason: 'bad-args' }));
      return EXIT.REFUSED;
    }
    return await scheduledPass(parsed, deps, out);
  } finally {
    process.umask(prevUmask);
  }
}

/** Run as a script (the shim's `exec node … sweep.mjs`), never on import.
 *  runPass resolves the home itself (from $HOME here); a throw is exit 1. */
async function main() {
  try {
    return await runPass(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`history-sweep: internal error: ${e && e.message ? e.message : String(e)}\n`);
    return EXIT.INTERNAL;
  }
}

// ---------------------------------------------------------------------------------------------
// Ingest: stream, parse and write in chunks (§9.2 steps 4-5; plan task 19).
//
// Parsing and compression happen OUTSIDE any transaction. Each chunk is ONE `BEGIN IMMEDIATE`
// (synchronous NORMAL: its sources persist) carrying its blobs, entries, memberships, variants,
// boundaries and — in the same transaction — the cursor, so any throw rolls the chunk back and a
// partially ingested file is a normal state (history-ingest-by-cursor, D-4236). An integer that can pass
// 2^53 (mtime_ns, struct_rank_ns, birth_ns) is written as a BigInt and compared in SQL, never read
// back: node:sqlite throws a RangeError on such a value unless a statement opts into BigInt reads
// (measured, 22.16.0).
// ---------------------------------------------------------------------------------------------

/** How far the tool_use pairing walks up `parentUuid` in the store when the tool_use was written
 *  in an earlier tick. A bound on work, not a rule: parallel tool calls put a few rows between
 *  a tool_use and its result. */
const PAIR_WALK_HOPS = 16;
/** The read size when scanning past LINE_MAX for an over-long line's end. */
const SCAN_PIECE = 1 << 20;

/** One run's budget (§9.2 step 7): made ONCE when a tick starts and threaded through every file
 *  and step, never reset per file (O5). `limits` default to lib's RUN_BUDGET_MS, RUN_BUDGET_BYTES
 *  and CHUNK_BYTES. An in-process test passes smaller ones: an injected dependency, never an
 *  environment variable (history-test-seams-not-env). */
export function newBudget(now = Date.now, limits = {}) {
  return {
    startMs: now(), bytes: 0, now,
    maxMs: limits.maxMs ?? RUN_BUDGET_MS,
    maxBytes: limits.maxBytes ?? RUN_BUDGET_BYTES,
    chunkBytes: limits.chunkBytes ?? CHUNK_BYTES,
  };
}

/** Whether the run may start another chunk or file: lib's verdict on this budget. */
export function budgetLeft(budget) {
  return withinBudget({ elapsedMs: budget.now() - budget.startMs, bytes: budget.bytes, maxMs: budget.maxMs, maxBytes: budget.maxBytes });
}

/** Up to `n` bytes at `pos`, fewer only at end-of-file. */
function readAt(fd, pos, n) {
  const buf = Buffer.allocUnsafe(n);
  let got = 0;
  while (got < n) {
    const k = readSync(fd, buf, got, n - got, pos + got);
    if (k === 0) break;
    got += k;
  }
  return got === n ? buf : buf.subarray(0, got);
}

/** The complete lines in up to `want` bytes from `offset`, never past the last '\n', so a line
 *  Claude Code is still writing is never consumed (O2). When no '\n' lies within `want` bytes the
 *  read widens to LINE_MAX for that one line. A line longer than LINE_MAX is reported as
 *  `overLong` (its start) and is never read into memory: compressFdRange takes it. */
export function readLines(fd, offset, size, want) {
  const avail = size - offset;
  if (avail <= 0) return { lines: [], next: offset, overLong: null };
  let buf = readAt(fd, offset, Math.min(want, avail));
  let end = buf.lastIndexOf(0x0a);
  if (end < 0 && buf.length < avail) {
    buf = readAt(fd, offset, Math.min(LINE_MAX, avail));
    end = buf.indexOf(0x0a);
    if (end < 0) return { lines: [], next: offset, overLong: buf.length < avail ? offset : null };
  }
  if (end < 0) return { lines: [], next: offset, overLong: null };
  const lines = [];
  for (let start = 0; start <= end;) {
    const nl = buf.indexOf(0x0a, start);
    lines.push({ at: offset + start, bytes: buf.subarray(start, nl) });
    start = nl + 1;
  }
  return { lines, next: offset + end + 1, overLong: null };
}

/** The '\n' that ends the over-long line starting at `start` (no '\n' lies in its first LINE_MAX
 *  bytes), or null while it is still being written. */
function findLineEnd(fd, start, size) {
  for (let pos = start + LINE_MAX; pos < size;) {
    const piece = readAt(fd, pos, Math.min(SCAN_PIECE, size - pos));
    if (piece.length === 0) return null;
    const nl = piece.indexOf(0x0a);
    if (nl >= 0) return pos + nl;
    pos += piece.length;
  }
  return null;
}

const ENTRY_UPSERT = `INSERT INTO entries (uuid, transcript_pk, type, subtype, role, model, parent_uuid,
    ts_ms, request_id, api_block_index, msg_id, source_tool_use_id, tool_name, is_compact_summary,
    provenance, prov_version, parse_state, struct_rank_ns, struct_file_id, blob_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(uuid) DO UPDATE SET type = excluded.type, subtype = excluded.subtype, role = excluded.role,
    model = excluded.model, parent_uuid = excluded.parent_uuid, ts_ms = excluded.ts_ms,
    request_id = excluded.request_id, api_block_index = excluded.api_block_index, msg_id = excluded.msg_id,
    source_tool_use_id = excluded.source_tool_use_id, tool_name = excluded.tool_name,
    is_compact_summary = excluded.is_compact_summary, provenance = excluded.provenance,
    prov_version = excluded.prov_version, parse_state = excluded.parse_state,
    struct_rank_ns = excluded.struct_rank_ns, struct_file_id = excluded.struct_file_id
  WHERE excluded.struct_rank_ns > entries.struct_rank_ns
     OR (excluded.struct_rank_ns = entries.struct_rank_ns AND excluded.struct_file_id > entries.struct_file_id)`;

const INGEST_STMTS = new WeakMap();
/** The ingest's prepared statements, one set per connection. Each names its columns. */
function stmts(db) {
  let s = INGEST_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    blobId: db.prepare('SELECT blob_id, fts_indexed FROM blobs WHERE sha256 = ?'),
    blobIns: db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING'),
    blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),
    entrySel: db.prepare('SELECT entry_id, blob_id FROM entries WHERE uuid = ?'),
    entryUpsert: db.prepare(ENTRY_UPSERT),
    // D-4237: memberships.line is the line's BYTE OFFSET in the file, not a line number (a cursor resumes at an
    // offset and v1 keeps no line count). min() keeps the first position on a re-scan after a shrink and for a
    // duplicate uuid in one file.
    membership: db.prepare(`INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)
      ON CONFLICT(file_id, entry_id) DO UPDATE SET line = min(memberships.line, excluded.line)`),
    variantHas: db.prepare('SELECT 1 AS hit FROM entry_variants WHERE entry_id = ? AND blob_id = ?'),
    variantIns: db.prepare(`INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry_id, blob_id) DO NOTHING`),
    firstFile: db.prepare('SELECT min(file_id) AS f FROM memberships WHERE entry_id = ?'),
    boundaryIns: db.prepare(`INSERT INTO boundaries (entry_id, transcript_pk, ord, trigger, head_uuid,
        anchor_uuid, tail_uuid, kept_blob_id, pre_tokens, post_tokens, duration_ms)
      VALUES (?, ?, (SELECT coalesce(max(ord), 0) + 1 FROM boundaries WHERE transcript_pk = ?), ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id) DO NOTHING`),
    epochFacts: db.prepare(`UPDATE epochs SET started_ms = ?, cwd = ?, git_branch = ?, cwd_real = ?
      WHERE cc_session_uuid = ? AND started_ms IS NULL AND cwd IS NULL AND git_branch IS NULL`),
    cursor: db.prepare(`UPDATE ingest_files SET offset = ?, tail_sha256 = ?, size = ?, mtime_ns = ?,
        last_error_code = coalesce(?, last_error_code), last_error_offset = coalesce(?, last_error_offset)
      WHERE file_id = ?`),
    crash: db.prepare('UPDATE ingest_files SET last_error_code = ?, last_error_offset = ? WHERE file_id = ?'),
    pairSel: db.prepare(`SELECT e.parent_uuid AS parent_uuid, b.z AS z FROM entries e
      JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?`),
    pathRow: db.prepare('SELECT file_id FROM file_paths WHERE path = ?'),
    rowPaths: db.prepare('SELECT path FROM file_paths WHERE file_id = ?'),
    markGone: db.prepare("UPDATE ingest_files SET status = 'gone' WHERE file_id = ? AND source_key = '' AND status = 'live'"),
  };
  INGEST_STMTS.set(db, s);
  return s;
}

/** A stored body, parsed; null for a tombstone or a body that is not JSON. */
function storedBody(s, blobId) {
  const r = s.blobZ.get(blobId);
  if (r === undefined || r.z === null) return null;
  try { return JSON.parse(unbrotli(r.z).toString('utf8')); } catch { return null; }
}

/** The tool_use a tool_result answers, when it was written in an earlier tick: walked up the
 *  stored `parentUuid` chain, PAIR_WALK_HOPS at most. null when not found. provenanceOf then
 *  classifies the result as plain `tool`, the searchable side. */
function pairedFromStore(db, toolUseId, parentUuid) {
  const s = stmts(db);
  let uuid = parentUuid;
  for (let hop = 0; hop < PAIR_WALK_HOPS && typeof uuid === 'string'; hop += 1) {
    const r = s.pairSel.get(uuid);
    if (r === undefined) return null;
    if (r.z !== null) {
      try {
        const u = toolUsesOf(JSON.parse(unbrotli(r.z).toString('utf8'))).find((x) => x.id === toolUseId);
        if (u !== undefined) return u;
      } catch { /* a raw-only body pairs nothing */ }
    }
    uuid = r.parent_uuid;
  }
  return null;
}

/** A row's 0-based position among the rows of the same `requestId` read in this pass of this file: one API
 *  response written as several rows (Task 8's `apiBlockIndex`, entries.api_block_index). null for a row with
 *  no requestId. Counted in `st`, so a response split across two ticks restarts at 0 in the second read: the
 *  column orders blocks within a read, and the uuid stays the row's identity. */
function nextBlockIndex(st, row) {
  const rid = typeof row.requestId === 'string' ? row.requestId : null;
  if (rid === null) return null;
  const i = st.blockIdx.get(rid) ?? 0;
  st.blockIdx.set(rid, i + 1);
  return i;
}

/** A line kept raw-only: keyed by its transcript and bytes, its blob the bytes themselves. */
function rawRowOf(st, at, bytes, code) {
  const sha = blobShaOfBytes(bytes);
  return { kind: 'raw', at, key: rawRowKey(st.ccUuid, sha.toString('hex')), sha, bytes, z: null, rawLen: bytes.length, code };
}

/** Lines → prepared rows, OUTSIDE any transaction (§9.2 step 4). `st` is the per-file state
 *  ingestFile keeps across this file's chunks: the connection, the transcript's uuid, the
 *  tool_use pairs seen so far, and whether the file's first stored row is still to come.
 *  JSON.parse failures and non-objects become raw-only rows here. ANY OTHER THROW is the
 *  parser's own bug and propagates: ingestFile counts it parser_crash and holds the cursor (O2).
 *  Only ERROR_CODES words are recorded, never an error's message (DM34). */
export function prepareLines(lines, ctx, st) {
  const rows = [];
  const counts = new Map();
  const add = (name) => { counts.set(name, (counts.get(name) ?? 0) + 1); };
  let rawError = null;
  let first = null;
  for (const { at, bytes } of lines) {
    if (bytes.length === 0) continue;   // an empty line is no row and takes no position
    const text = bytes.toString('utf8');
    let row;
    try { row = JSON.parse(text); } catch {
      rows.push(rawRowOf(st, at, bytes, 'json-parse')); add('raw_only'); rawError = { code: 'json-parse', at };
      continue;
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      rows.push(rawRowOf(st, at, bytes, 'not-object')); add('raw_only'); rawError = { code: 'not-object', at };
      continue;
    }
    if (!isStoredRow(row)) { add(`uuidless:${uuidlessTypeOf(row)}`); continue; }   // history-uuidless-rows-not-stored, D-4199
    const body = blobBodyOf(row);
    for (const u of toolUsesOf(body)) st.toolUses.set(u.id, u);
    const answers = toolResultIdsOf(body);
    const paired = answers.length === 0 ? null
      : (st.toolUses.get(answers[0]) ?? pairedFromStore(st.db, answers[0], row.parentUuid));
    const isBoundary = text.includes('"compact_boundary"') && ctx.isBoundaryLine(text);
    const entry = entryOf(row, { apiBlockIndex: nextBlockIndex(st, row) });
    if (!ROW_TYPES.includes(entry.type)) add('unknown_type');
    // sha256 over the canonical JSON: blobShaOfBody's rule, computed once on the string this
    // chunk compresses (O21 asserts every stored sha equals sha256 of the blob's bytes).
    const json = canonicalJson(body);
    const boundary = isBoundary ? boundaryOf(row) : null;
    let kept = null;
    if (boundary !== null && boundary.allUuids !== null) {
      const keptJson = canonicalJson(boundary.allUuids);
      kept = { sha: sha256Bytes(keptJson), json: keptJson };
    }
    const provenance = provenanceOf(row, { pairedToolUse: paired });
    // The index text, only for a searchable row and only when this tick may index (§6.2). A recall echo is
    // classified by the paired tool_use in provenanceOf, never by its text (D-4197, history-recall-echo-by-structure).
    const ftsText = ctx.fts === true && SEARCHABLE_PROVENANCE.includes(provenance) ? ftsTextOf(body, 'entry') : null;
    rows.push({ kind: 'row', at, entry, provenance, sha: sha256Bytes(json), json, boundary, kept, ftsText });
    if (st.firstPending) {
      st.firstPending = false;
      const f = launchFactsOf(row);
      let cwdReal = null;
      if (f.cwd !== null) { try { cwdReal = realpathSync(f.cwd); } catch { add('cwd_unresolved'); } }
      first = { startedMs: entry.tsMs, cwd: f.cwd, gitBranch: f.gitBranch, cwdReal };
    }
  }
  return { rows, counts, rawError, first };
}

/** Every blob the chunk needs and the store lacks, compressed now, outside the transaction. A
 *  body already stored, in the store or earlier in this chunk, is never compressed again (DM3). */
function compressMissing(db, rows) {
  const s = stmts(db);
  const blobs = new Map();
  const need = (sha, make) => {
    const hex = sha.toString('hex');
    if (blobs.has(hex)) return;
    if (s.blobId.get(sha) !== undefined) { blobs.set(hex, { sha, z: null, rawLen: 0 }); return; }
    blobs.set(hex, { sha, ...make() });
  };
  const fromJson = (json) => () => { const b = Buffer.from(json, 'utf8'); return { z: brotli(b), rawLen: b.length }; };
  for (const r of rows) {
    if (r.kind === 'raw') {
      need(r.sha, () => (r.z !== null ? { z: r.z, rawLen: r.rawLen } : { z: brotli(r.bytes), rawLen: r.bytes.length }));
      continue;
    }
    need(r.sha, fromJson(r.json));
    if (r.kept !== null) need(r.kept.sha, fromJson(r.kept.json));
  }
  return blobs;
}

/** One chunk, ONE transaction (§9.2 step 5). It writes: blobs, insert-or-ignore by sha; entries,
 *  by the newest-rank upsert (history-structure-newest-rank, D-4238, DM4); memberships; variants with
 *  their cause (history-variant-cause, D-4200, DM2/DM2b); boundaries; the epoch's first-row facts; the
 *  counters; and THE CURSOR with its tail sha, so a throw anywhere leaves no row of the chunk and
 *  the cursor where it was (O1). `entries.blob_id` keeps the first body seen. Each further
 *  distinct body is a variant row, and the first body gets one too once a second appears.
 *  Returns how many entries were new, and the oldest timestamp among them. */
export function writeChunk(db, chunk) {
  const s = stmts(db);
  return withTx(db, 'NORMAL', () => {
    const blobIds = new Map();
    for (const [hex, b] of chunk.blobs) {
      if (b.z !== null) s.blobIns.run(b.sha, CODEC, b.z, b.rawLen);   // D-4211: codec br5, Brotli quality 5
      blobIds.set(hex, s.blobId.get(b.sha).blob_id);
    }
    const counts = new Map(chunk.counts);
    const add = (name) => { counts.set(name, (counts.get(name) ?? 0) + 1); };
    let newEntries = 0;
    let minNewTsMs = null;
    for (const r of chunk.rows) {
      const blobId = blobIds.get(r.sha.toString('hex'));
      const e = r.kind === 'row' ? r.entry : null;
      const uuid = e !== null ? e.uuid : r.key;
      const before = s.entrySel.get(uuid);
      const info = s.entryUpsert.run(uuid, chunk.transcriptPk,
        e !== null ? e.type : RAW_ROW.type, e?.subtype ?? null, e?.role ?? null, e?.model ?? null,   // D-4198: the producing model, verbatim
        e?.parentUuid ?? null, e?.tsMs ?? null, e?.requestId ?? null, e?.apiBlockIndex ?? null,
        e?.msgId ?? null, e?.sourceToolUseId ?? null, e?.toolName ?? null, e?.isCompactSummary ?? 0,
        e !== null ? r.provenance : RAW_ROW.provenance, PROV_VERSION,
        e !== null ? PARSE_STATE.ok : RAW_ROW.parseState,
        chunk.rankNs, chunk.fileId, blobId);
      const entryId = before !== undefined ? before.entry_id : Number(info.lastInsertRowid);
      if (before === undefined) {
        newEntries += 1;
        if (e !== null && e.tsMs !== null) minNewTsMs = minNewTsMs === null ? e.tsMs : Math.min(minNewTsMs, e.tsMs);
      } else if (e !== null && before.blob_id !== blobId && s.variantHas.get(entryId, blobId) === undefined) {
        const cause = variantCauseOf(storedBody(s, before.blob_id), JSON.parse(r.json));
        const firstFile = s.firstFile.get(entryId).f ?? chunk.fileId;
        s.variantIns.run(entryId, before.blob_id, firstFile, chunk.nowMs, cause);
        s.variantIns.run(entryId, blobId, chunk.fileId, chunk.nowMs, cause);
        add(`variants_${cause.replace(/^ccd-/, '')}`);
      }
      s.membership.run(chunk.fileId, entryId, r.at);   // r.at is a byte offset (D-4237)
      if (chunk.pairIdx !== null && r.kind === 'row' && r.ftsText !== null) {
        const b = s.blobId.get(r.sha);
        if (b.fts_indexed === 0) indexBlob(db, b.blob_id, r.ftsText, chunk.pairIdx);
      }
      if (r.kind === 'row' && r.boundary !== null) {
        const b = r.boundary;
        const keptId = r.kept === null ? null : blobIds.get(r.kept.sha.toString('hex'));
        const bi = s.boundaryIns.run(entryId, chunk.transcriptPk, chunk.transcriptPk, b.trigger, b.headUuid,
          b.anchorUuid, b.tailUuid, keptId, b.preTokens, b.postTokens, b.durationMs);
        if (bi.changes === 1 && b.missing.length > 0) add('boundary_field_missing');
      }
    }
    if (chunk.first !== null) {
      const f = chunk.first;
      s.epochFacts.run(f.startedMs, f.cwd, f.gitBranch, f.cwdReal, chunk.ccUuid);
    }
    s.cursor.run(chunk.cursor.offset, chunk.cursor.tailSha, chunk.size, chunk.mtimeNs,
      chunk.rawError?.code ?? null, chunk.rawError?.at ?? null, chunk.fileId);
    for (const [name, n] of counts) bump(db, name, n);
    return { newEntries, minNewTsMs };
  });
}

/** The parser's own throw: counted, the closed code recorded, the cursor held (O2, §9.10). */
function recordParserCrash(db, fileId, at) {
  withTx(db, 'NORMAL', () => {
    stmts(db).crash.run('parser-crash', at, fileId);
    bump(db, 'parser_crash');
  });
}

/** The free-space floor stopped a run: counted once, where it stopped (§9.3 "Below the threshold"). */
function countFloorPause(db) {
  withTx(db, 'NORMAL', () => { bump(db, 'capture_paused_low_disk'); });
}

/** One file from its cursor, chunk by chunk, until end-of-file, the budget, history-off, the
 *  free-space floor or a line still being written stops it (§9.2 steps 4-5, 7; §9.3). A malformed
 *  or over-long line never wedges the file (O2b); the parser's own bug holds the cursor (O2). A
 *  stop at a tail with no '\n' yet reports `tornAt` (Task 20 reads it); a stop at the floor
 *  reports the probe's word as `floor`. */
export async function ingestFile(db, ctx, file, budget) {
  const st = { db, ccUuid: file.ccUuid, toolUses: new Map(), blockIdx: new Map(), firstPending: file.offset === 0 };
  let offset = file.offset;
  let bytes = 0;
  let newEntries = 0;
  let minNewTsMs = null;
  const done = (atEof, extra = {}) => ({ bytes, atEof, offset, newEntries, minNewTsMs, ...extra });
  while (offset < file.size) {
    if (!budgetLeft(budget) || ctx.historyOff()) return done(false);
    // §9.3 (BK17): the floor is probed before EACH chunk, not only when the pass began. Below it the
    // cursor holds where the last chunk left it, as at the pass's start; an unsettled probe stops too,
    // uncounted (the next pass's own probe answers store-unreachable).
    const floor = await ctx.floorProbe();
    if (floor !== 'ok') {
      if (floor === 'low-disk') countFloorPause(db);
      return done(false, { floor });
    }
    const r = readLines(file.fd, offset, file.size, budget.chunkBytes);
    let rows; let counts = new Map(); let rawError = null; let first = null; let next; let tailSha;
    if (r.overLong !== null) {
      const end = findLineEnd(file.fd, offset, file.size);
      if (end === null) return done(false, { tornAt: offset });   // the over-long line is still being written
      const c = await compressFdRange(file.fd, offset, end);
      if (c === null) return done(false);              // the file shrank under the read: next tick
      rows = [{ kind: 'raw', at: offset, key: rawRowKey(file.ccUuid, c.sha.toString('hex')), sha: c.sha, z: c.z, rawLen: c.rawLen, code: 'line-too-long' }];
      counts.set('raw_only', 1);
      rawError = { code: 'line-too-long', at: offset };
      next = end + 1;
      tailSha = c.sha;
    } else if (r.lines.length === 0) {
      return done(false, { tornAt: offset });           // an unterminated tail: wait for its '\n'
    } else {
      let prep;
      try { prep = ctx.prepareLines(r.lines, ctx, st); } catch {
        recordParserCrash(db, file.fileId, offset);
        return done(false, { crashed: true });
      }
      ({ rows, counts, rawError, first } = prep);
      next = r.next;
      tailSha = sha256Bytes(r.lines[r.lines.length - 1].bytes);
    }
    const w = writeChunk(db, {
      fileId: file.fileId, transcriptPk: file.transcriptPk, ccUuid: file.ccUuid, rankNs: file.mtimeNs,
      nowMs: ctx.nowMs, rows, blobs: compressMissing(db, rows), counts, rawError, first, pairIdx: ctx.fts === true ? ctx.pairIdx : null,
      cursor: { offset: next, tailSha }, size: file.size, mtimeNs: file.mtimeNs,
    });
    bytes += next - offset;
    budget.bytes += next - offset;
    offset = next;
    newEntries += w.newEntries;
    if (w.minNewTsMs !== null) minNewTsMs = minNewTsMs === null ? w.minNewTsMs : Math.min(minNewTsMs, w.minNewTsMs);
  }
  return done(true);
}

/** The counter each admission refusal folds into (§6.5 `non_regular`; §9.10 a missing file). */
const ADMISSION_COUNTERS = Object.freeze({ missing: 'file_missing', non_regular: 'non_regular', 'outside-roots': 'non_regular', unreadable: 'file_unreadable' });
function countAdmission(db, why) {
  withTx(db, 'NORMAL', () => { bump(db, ADMISSION_COUNTERS[why] ?? 'file_unreadable'); });
}

/** A path admission answered `missing` for (§9.10 "File missing": skipped, counted, cursor untouched).
 *  Once NONE of the paths of the row it was bound to exists, that row is `gone`: it is no longer
 *  counted behind and no longer re-read every tick only to be counted missing again (Task 20). A
 *  row with another path still on disk stays live. Examination makes a gone row live again (Task
 *  20's recordExamined), so a file that reappears resumes at its cursor. */
function markGoneIfPathless(db, path) {
  const s = stmts(db);
  const b = s.pathRow.get(path);
  if (b === undefined) return;
  if (s.rowPaths.all(b.file_id).some((r) => existsSync(r.path))) return;
  withTx(db, 'NORMAL', () => { s.markGone.run(b.file_id); });
}

/** One discovered transcript path for this tick: admission (O_NOFOLLOW, a regular file under a
 *  rostered projects/ root), identity (bindFile: resume, rescan, retire or skip), then ingestFile
 *  from the cursor. null when the file was not admitted or was skipped. A busy database throws,
 *  and ingestTick ends the tick on it. `minNewTsMs` is reported only for a file bound as
 *  `resume`: a first read or a rescan captures rows that may have waited for days before this
 *  store knew the file, which is discovery, not capture lag (Task 20's ticks.lag_ms). */
export async function ingestPath(db, ctx, f, budget) {
  const a = admitFile(f.path, f.home, ctx.homes, ctx.home);
  if (!a.ok) {
    countAdmission(db, a.why);
    if (a.why === 'missing') markGoneIfPathless(db, f.path);
    return null;
  }
  try {
    const st = fstatSync(a.fd, { bigint: true });
    const size = Number(st.size);
    // Task 18's one head-sha function and its bindFile signature (the plan's integration contract 2): the
    // bind reads the cursor's tail proof through `fd` and keys a retire on the tick's `nowMs`.
    const bound = bindFile(db, { path: f.path, uuid: f.uuid, fd: a.fd, st: a.st, headSha: headShaOf(a.fd, size) }, ctx.nowMs);
    if (bound.action === 'skip') return null;
    const r = await ingestFile(db, ctx, {
      fileId: bound.fileId, transcriptPk: bound.transcriptPk, ccUuid: f.uuid, fd: a.fd,
      size, mtimeNs: st.mtimeNs, offset: bound.action === 'resume' ? bound.offset : 0,
    }, budget);
    return { fileId: bound.fileId, size, mtimeNs: st.mtimeNs, ...r, minNewTsMs: bound.action === 'resume' ? r.minNewTsMs : null };
  } finally {
    closeSync(a.fd);
  }
}

/** The ingest context's default floor probe: the floor always holds. An in-process caller therefore
 *  never reads the free space of the box running it; `tick` passes the real probe. */
const FLOOR_ALWAYS_OK = async () => 'ok';

/** The free-space probe `tick` hands the ingest (§9.3, BK17): `statfs` on `dir` (db/, a link
 *  followed) under STATFS_DEADLINE_MS. `ok` at or above floorThreshold; `low-disk` below it or when
 *  the probe threw, as planRun reads a pass's own probe (§9.10's failure table: "below the floor, or
 *  `statfs` throws" is one row); `unsettled` when it never answered. */
export function floorProbeFor(dir, statfs) {
  return async () => {
    const f = await statfsWithDeadline(dir, STATFS_DEADLINE_MS, statfs);
    if (f.state === 'unsettled') return 'unsettled';
    return f.state === 'ok' && f.bytes >= floorThreshold(f.fsSize) ? 'ok' : 'low-disk';
  };
}

/** What every ingest step reads: this pass's home and rostered homes, the tick's start, the
 *  binding's ids, and the injected parts a test may replace in-process: the boundary test from
 *  compact-card.mjs, the history-off probe, the parser, the free-space floor probe. pairIdx is this tick's
 *  redaction index; secretsStep's answer replaces the empty default. fts says whether this tick may index
 *  (ftsPrepare's tables). */
export function makeIngestCtx(home, homes, nowMs, ids, floorProbe = FLOOR_ALWAYS_OK) {
  const off = historyPaths(home).off;
  return { home, homes, nowMs, ids, isBoundaryLine, prepareLines, historyOff: () => existsSync(off), floorProbe, pairIdx: makePairIndex([]), fts: false };
}

// ---------------------------------------------------------------------------------------------
// The tick's ingest and its accounting (§9.2 steps 2, 6-7; plan task 20).
// ---------------------------------------------------------------------------------------------

/** The meta key holding when the periodic scan last examined every known uuid's files. */
const SCAN_META = 'scan_discover_ms';

/** SQLITE_BUSY (5) and its extended codes: another connection held the write lock past
 *  busy_timeout. The tick ends and is retried next tick (§9.10). */
export function isBusy(e) {
  return e !== null && typeof e === 'object' && typeof e.errcode === 'number' && (e.errcode & 0xff) === 5;
}

/** A tail with no '\n' in a file nobody has written for this long is not a line still being
 *  written: its bytes are no message a later tick can read, so they are not counted behind. */
const TORN_STALE_MS = SCAN_INTERVAL_MS;
/** Epochs per tick whose missed launch facts backfillEpochFacts fills in. */
const EPOCH_FACTS_MAX = 32;

const TICK_STMTS = new WeakMap();
function tickStmts(db) {
  let t = TICK_STMTS.get(db);
  if (t !== undefined) return t;
  t = {
    // The id's two most recently confirmed epochs: its current one, and the one a just-confirmed /clear replaced.
    epochsOfId: db.prepare(`SELECT e.cc_session_uuid AS u FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk
      WHERE s.ccrc_id = ? AND e.confirmed_ms IS NOT NULL ORDER BY e.confirmed_ms DESC LIMIT 2`),
    // "Behind" is a live row a path still names, short of its last measured size: bytes a later tick can read.
    behindPaths: db.prepare(`SELECT p.path AS path, t.cc_session_uuid AS uuid FROM ingest_files f
      JOIN file_paths p ON p.file_id = f.file_id JOIN transcripts t ON t.transcript_pk = f.transcript_pk
      WHERE f.source_key = '' AND f.status = 'live' AND f.size > f.offset ORDER BY p.path`),
    // Examination is proof the file is there: a gone row it finds again is live (Task 19's markGoneIfPathless).
    examined: db.prepare("UPDATE ingest_files SET size = ?, mtime_ns = ?, eof_ms = coalesce(?, eof_ms), status = 'live' WHERE file_id = ?"),
    // behindStats' rows: one per (live short row, path), for behindStats to filter by rostered home and count by file_id.
    behindRows: db.prepare(`SELECT f.file_id AS fileId, f.size - f.offset AS gap, p.path AS path FROM ingest_files f
      JOIN file_paths p ON p.file_id = f.file_id
      WHERE f.source_key = '' AND f.status = 'live' AND f.size > f.offset`),
    tickIns: db.prepare('INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, ?, ?, ?)'),
    factless: db.prepare(`SELECT e.cc_session_uuid AS uuid, min(p.path) AS path FROM epochs e
      JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid AND t.agent_id = ''
      JOIN ingest_files f ON f.transcript_pk = t.transcript_pk AND f.source_key = '' AND f.offset > 0
      JOIN file_paths p ON p.file_id = f.file_id
      WHERE e.confirmed_ms IS NOT NULL AND e.started_ms IS NULL AND e.cwd IS NULL AND e.git_branch IS NULL
      GROUP BY e.cc_session_uuid ORDER BY random() LIMIT ?`),
  };
  TICK_STMTS.set(db, t);
  return t;
}

/** The size recorded for an examined file: its measured size, except that a tail with no '\n' in a
 *  file unwritten for TORN_STALE_MS counts as read (the cursor, the end of its last whole line). The
 *  file is read again as soon as it changes: bindFile records the new size when it is bound. */
function examinedSize(r, nowMs) {
  if (r.tornAt === undefined) return r.size;
  return nowMs - Number(r.mtimeNs / 1_000_000n) >= TORN_STALE_MS ? r.tornAt : r.size;
}

/** Whether this tick's ingest runs the periodic discovery scan: never run, or SCAN_INTERVAL_MS since
 *  the last one that examined every candidate (a budget-cut scan runs again next tick). Its clock is
 *  meta `scan_discover_ms`; Task 17's exported `scanDue`/`markScan` keep `scan_ms` for the registry
 *  backfill, a separate clock, so the two names never collide in this module. */
function ingestScanDue(db, nowMs) {
  const last = getMeta(db, SCAN_META);
  return last === null || nowMs - Number(last) >= SCAN_INTERVAL_MS;
}

/** `$REG/<id>.uuid` when it holds a uuid, else null. A discovery hint only: no epoch is decided
 *  from it here (§9.2 step 1 decides from the observation sidecar). The read is type-checked before
 *  the open (readRegPresence, the `_reg_read` lesson, as knownUuids): a FIFO or a link to /dev/zero at
 *  a hinted id's path would otherwise block this pass in open(2) or read(2), which no run budget can
 *  interrupt, so a FIFO hints nothing (D-4299, slug history-reg-uuid-read-type-checked). */
function readRegUuid(home, id) {
  const v = readRegPresence(`${historyPaths(home).reg}/${id}.uuid`);
  return v.state === 'value' && UUID_RE.test(v.value) ? v.value : null;
}

/** The uuids the spool hints at this tick. These are every id with a file in `spool/.draining/`
 *  (renamed this tick, or held): that id's two most recently confirmed epochs, and its
 *  `$REG/<id>.uuid`. Not every epoch the id ever had: a long-lived id's older transcripts are
 *  done, or behind (behindFiles), and re-binding them all on every Stop line is waste. */
function hintedUuids(db, home) {
  let names;
  try { names = readdirSync(historyPaths(home).draining); } catch { return new Set(); }
  const uuids = new Set();
  const t = tickStmts(db);
  for (const n of names) {
    if (n.startsWith('.') || !n.endsWith('.jsonl')) continue;
    const id = idOfDrainingName(n);
    if (!idOk(id)) continue;
    for (const r of t.epochsOfId.all(id)) uuids.add(r.u);
    const reg = readRegUuid(home, id);
    if (reg !== null) uuids.add(reg);
  }
  return uuids;
}

/** Files a cursor left short of their last measured size, each under the rostered home that holds
 *  it. A path whose home is no longer rostered is not read. */
function behindFiles(db, homes) {
  const out = [];
  for (const r of tickStmts(db).behindPaths.all()) {
    const home = homes.find((h) => r.path.startsWith(`${h}/projects/`));
    if (home !== undefined) out.push({ path: r.path, uuid: r.uuid, home });
  }
  return out;
}

/** This tick's candidate files, in order: hinted (fresh activity, so the lowest lag), then behind
 *  (the backlog), then, at the periodic scan, every known uuid's files; each path once. `uuids` is
 *  the uuid set the files came from (task 21 takes their sidecars). */
export function candidateFiles(db, ctx, scan) {
  const hinted = hintedUuids(db, ctx.home);
  const uuids = new Set(hinted);
  const files = [];
  const seen = new Set();
  const take = (list) => {
    for (const f of list) {
      uuids.add(f.uuid);
      if (!seen.has(f.path)) { seen.add(f.path); files.push(f); }
    }
  };
  take(discoverTranscripts(ctx.homes, hinted));
  take(behindFiles(db, ctx.homes));
  if (scan) {
    const known = knownUuids(db, ctx.home);
    for (const u of known) uuids.add(u);
    take(discoverTranscripts(ctx.homes, known));
  }
  return { files, uuids };
}

/** Every examined file's measured size and mtime, `eof_ms` for those left at end-of-file, and the
 *  scan mark when this tick's scan examined every candidate: one transaction. */
function recordExamined(db, ctx, examined, scanDone) {
  const t = tickStmts(db);
  withTx(db, 'NORMAL', () => {
    for (const f of examined) t.examined.run(f.size, f.mtimeNs, f.atEof ? ctx.nowMs : null, f.fileId);
    if (scanDone) setMeta(db, SCAN_META, String(ctx.nowMs));
  });
}

/** One tick's ingest (§9.2 steps 2-5, 7; slug history-ingest-by-cursor, D-4236): the candidate
 *  transcripts in candidateFiles' order, then the caught-up uuids' sidecars (task 21), under the
 *  run's ONE budget, which is never reset per file (O5). A busy database ends the tick with no
 *  partial chunk (O22): every chunk is its own transaction, and the one that met the lock never
 *  began. The free-space floor (Task 19's per-chunk probe, and a sidecar's own) ends the run's
 *  ingest, transcripts or sidecars: `paused`. The scan is marked done only when both halves
 *  examined everything. */
export async function ingestTick(db, ctx, budget) {
  const scan = ingestScanDue(db, ctx.nowMs);
  const { files, uuids } = candidateFiles(db, ctx, scan);
  const examined = [];
  let bytes = 0;
  let newEntries = 0;
  let minNewTsMs = null;
  let complete = true;
  let paused = false;
  try {
    for (const f of files) {
      if (!budgetLeft(budget) || ctx.historyOff()) { complete = false; break; }
      const r = await ingestPath(db, ctx, f, budget);
      if (r === null) continue;
      examined.push({ fileId: r.fileId, size: examinedSize(r, ctx.nowMs), mtimeNs: r.mtimeNs, atEof: r.atEof });
      bytes += r.bytes;
      newEntries += r.newEntries;
      if (r.minNewTsMs !== null) minNewTsMs = minNewTsMs === null ? r.minNewTsMs : Math.min(minNewTsMs, r.minNewTsMs);
      if (r.floor !== undefined) { paused = true; complete = false; break; }
    }
    recordExamined(db, ctx, examined, false);
    if (complete) {
      const side = await ingestSidecars(db, ctx, budget, uuids);
      bytes += side.bytes;
      complete = side.complete;
      paused = side.paused;
    }
    if (scan && complete) recordExamined(db, ctx, [], true);
  } catch (e) {
    if (!isBusy(e)) throw e;
    return { busy: true, bytes, newEntries, minNewTsMs, paused };
  }
  return { busy: false, bytes, newEntries, minNewTsMs, paused };
}

/** Launch facts an epoch missed (§2, §6.2 `epochs`; slug history-epoch-cwd-real for `cwd_real`).
 *  A transcript's first chunk writes them only when its epochs row already exists, and a spool hint
 *  or a registry uuid can have the transcript read one tick before the drain chains the epoch. So,
 *  after the ingest, each confirmed epoch still holding no fact, whose transcript a cursor has read
 *  from, takes them from that file's first uuid row: read through admission, bounded to
 *  FIRST_ROW_SCAN bytes, EPOCH_FACTS_MAX epochs a tick in random order, so an epoch whose first row
 *  cannot be read never starves the rest. */
export function backfillEpochFacts(db, ctx) {
  const s = stmts(db);
  for (const r of tickStmts(db).factless.all(EPOCH_FACTS_MAX)) {
    const home = ctx.homes.find((h) => r.path.startsWith(`${h}/projects/`));
    if (home === undefined) continue;
    const a = admitFile(r.path, home, ctx.homes, ctx.home);
    if (!a.ok) continue;
    let row;
    try {
      row = firstUuidRowOf(a.fd);
    } catch {
      continue;   // a read that fails on an admitted file leaves its epoch factless and never fails the tick: the rest are tried (D-4298, slug history-first-row-read-error-skips-file)
    } finally {
      closeSync(a.fd);
    }
    if (row === undefined) continue;
    const f = launchFactsOf(row);
    let cwdReal = null;
    let unresolved = false;
    if (f.cwd !== null) { try { cwdReal = realpathSync(f.cwd); } catch { unresolved = true; } }
    withTx(db, 'NORMAL', () => {
      s.epochFacts.run(entryOf(row, { apiBlockIndex: null }).tsMs, f.cwd, f.gitBranch, cwdReal, r.uuid);
      if (unresolved) bump(db, 'cwd_unresolved');
    });
  }
}

/** Files and bytes behind, counted the way behindFiles selects them: a live row short of its measured
 *  size with at least one path under a rostered home's `projects/`, each row once however many paths
 *  name it. A row whose every path sits under a home that has left the roster is never read again (not
 *  by hint, scan or behindFiles), so counting it would hold files_behind above 0, freeze
 *  `last_zero_behind_ms` and fail doctor's lag for good (D-4309, slug history-behind-rostered-homes).
 *  No homes at all is an unreadable roster, not an empty one: nothing then says a path is un-rostered,
 *  so every path counts and the count is never reassuringly 0. */
export function behindStats(db, homes) {
  const gaps = new Map();
  for (const r of tickStmts(db).behindRows.all()) {
    if (homes.length > 0 && !homes.some((h) => r.path.startsWith(`${h}/projects/`))) continue;
    gaps.set(r.fileId, r.gap);
  }
  let bytes = 0;
  for (const g of gaps.values()) bytes += g;
  return { files: gaps.size, bytes };
}

/** The tick's `ticks` row and its journal `tick` record (§9.2 step 6; W1-b, doctor's catching-up; slug
 *  history-event-tables-v1, D-4213).
 *  `ing` is ingestTick's answer, or null when a cap or floor pause skipped ingest; the lag is then
 *  unmeasured (NULL), never a reassuring 0. Files and bytes behind count live rows that a path
 *  still names under a rostered home (behindStats), short of their last examined size (examinedSize):
 *  bytes a later tick can read.
 *  meta `last_zero_behind_ms` is the newest tick with none behind,
 *  and it is status's lag (task 27). A failed journal append is counted, never thrown: the tick
 *  record is a copy of this row, not the source of anything. */
export function recordTick(db, ctx, ing) {
  const t = tickStmts(db);
  const lagMs = ing === null ? null : lagOfTick({ tickStartMs: ctx.nowMs, newEntries: ing.newEntries, minNewTsMs: ing.minNewTsMs });
  withTx(db, 'NORMAL', () => {
    const behind = behindStats(db, ctx.homes);
    t.tickIns.run(ctx.nowMs, lagMs, ing === null ? 0 : ing.bytes, behind.files, behind.bytes);
    if (behind.files === 0) setMeta(db, 'last_zero_behind_ms', String(ctx.nowMs));
  });
  try {
    appendJournal(ctx.home, ctx.ids, [journalRecord('tick', ctx.nowMs, { lag_ms: lagMs })], ctx.nowMs);
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    withTx(db, 'NORMAL', () => { bump(db, 'journal_write_failed'); });
  }
}

// ---------------------------------------------------------------------------------------------
// Sidecars: <home>/projects/*/<uuid>/tool-results/* under EVERY rostered home, including homes that
// hold no <uuid>.jsonl, because _swap_carry_sidecars merges those trees between homes (§9.2 step 2,
// FE6; plan task 21; slug history-sidecar-ingest-rules, D-4239; slug history-sidecars-ingested, D-4240).
// A sidecar's blob is the file's bytes. A copy that differs is a row beside the other, never over it,
// and an unchanged (size, mtime_ns) is never read again.
// ---------------------------------------------------------------------------------------------

const SIDE_STMTS = new WeakMap();
function sideStmts(db) {
  let q = SIDE_STMTS.get(db);
  if (q !== undefined) return q;
  q = {
    seenSame: db.prepare('SELECT 1 AS hit FROM sidecar_seen WHERE path = ? AND size = ? AND mtime_ns = ?'),
    seenUpsert: db.prepare(`INSERT INTO sidecar_seen (path, size, mtime_ns, blob_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ns = excluded.mtime_ns, blob_id = excluded.blob_id`),
    sidecarIns: db.prepare(`INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(transcript_pk, name, blob_id) DO NOTHING`),
    // Not caught up as Task 20 counts behind: a live row a path still names, short of its measured size (or never
    // measured). One row per (file, path), for notCaughtUp to filter by rostered home, as behindStats does.
    notCaughtUp: db.prepare(`SELECT f.file_id AS fileId, p.path AS path FROM ingest_files f
      JOIN transcripts t ON t.transcript_pk = f.transcript_pk JOIN file_paths p ON p.file_id = f.file_id
      WHERE t.cc_session_uuid = ?
        AND f.source_key = '' AND f.status = 'live' AND (f.size IS NULL OR f.size > f.offset)`),
    toolResults: db.prepare(`SELECT e.entry_id AS entry_id, b.z AS z FROM entries e JOIN blobs b ON b.blob_id = e.blob_id
      WHERE e.transcript_pk = ? AND e.type = 'user' AND b.z IS NOT NULL ORDER BY e.entry_id`),
  };
  SIDE_STMTS.set(db, q);
  return q;
}

/** Whether a copy of this uuid's transcript is still short of its measured size, counted as behindStats
 *  counts it: a live row a path under a rostered home's `projects/` still names. A row whose every path sits
 *  under a home that has left the roster is never read again, so it cannot hold the uuid's sidecars back for
 *  good (D-4309, slug history-behind-rostered-homes, the second site of the predicate). No homes at all is an
 *  unreadable roster: nothing then says a path is un-rostered, so every path counts. */
function notCaughtUp(db, homes, uuid) {
  for (const r of sideStmts(db).notCaughtUp.all(uuid)) {
    if (homes.length === 0 || homes.some((h) => r.path.startsWith(`${h}/projects/`))) return true;
  }
  return false;
}

/** Every sidecar file of the given uuids, under every rostered home, in a stable order. Each
 *  `projects/<slug>/` is listed once and only its entries named by a wanted uuid are opened, as
 *  discoverTranscripts does: at a scan tick `uuids` is every known uuid, and one readdir per
 *  (home, project, uuid) would be millions of misses. Dot-names are skipped: they are temporaries,
 *  never Claude Code's own names. */
export function discoverSidecars(homes, uuids) {
  const want = new Set(uuids);
  const out = [];
  if (want.size === 0) return out;
  for (const home of homes) {
    let projects;
    try { projects = readdirSync(`${home}/projects`).sort(); } catch { continue; }
    for (const proj of projects) {
      let entries;
      try { entries = readdirSync(`${home}/projects/${proj}`).sort(); } catch { continue; }
      for (const uuid of entries) {
        if (!want.has(uuid)) continue;
        const dir = `${home}/projects/${proj}/${uuid}/tool-results`;
        let names;
        try { names = readdirSync(dir).sort(); } catch { continue; }
        for (const name of names) if (!name.startsWith('.')) out.push({ path: `${dir}/${name}`, uuid, home, name });
      }
    }
  }
  return out;
}

/** The transcript's tool_result rows, each as {entryId, text, toolUseIds}, built once per tick
 *  per transcript (the `cache`). linkSidecar decides from them. */
function toolResultCandidates(db, transcriptPk, cache) {
  const hit = cache.get(transcriptPk);
  if (hit !== undefined) return hit;
  const out = [];
  for (const r of sideStmts(db).toolResults.all(transcriptPk)) {
    let body;
    try { body = JSON.parse(unbrotli(r.z).toString('utf8')); } catch { continue; }
    const toolUseIds = toolResultIdsOf(body);
    if (toolUseIds.length > 0) out.push({ entryId: r.entry_id, text: ftsTextOf(body, 'entry'), toolUseIds });
  }
  cache.set(transcriptPk, out);
  return out;
}

/** One sidecar file (§9.2 step 4).
 *  - An unchanged (size, mtime_ns) is skipped before any open (DM47).
 *  - Otherwise it is admitted like a transcript (O_NOFOLLOW, a regular file under a rostered
 *    projects/ root).
 *  - It is read whole up to SIDECAR_WHOLE_MAX, else streamed through compressFdRange.
 *  - It is hashed and stored as a blob of its bytes, and linked by linkSidecar.
 *  - The `sidecars` row and the `sidecar_seen` mark commit in one transaction.
 *  - A file that has to be read is one ingest unit for §9.3's floor: the probe runs before it, as
 *    before an ingest chunk, and anything but `ok` stops the run's sidecars (`floor`).
 *  Returns null when the file was not taken. */
export async function ingestSidecar(db, ctx, s, budget, cache) {
  const q = sideStmts(db);
  let ls;
  try { ls = lstatSync(s.path, { bigint: true }); } catch { countAdmission(db, 'missing'); return null; }
  if (!ls.isFile()) { countAdmission(db, 'non_regular'); return null; }
  if (q.seenSame.get(s.path, ls.size, ls.mtimeNs) !== undefined) return { bytes: 0 };
  const floor = await ctx.floorProbe();
  if (floor !== 'ok') {
    if (floor === 'low-disk') countFloorPause(db);
    return { bytes: 0, floor };
  }
  const a = admitFile(s.path, s.home, ctx.homes, ctx.home);
  if (!a.ok) { countAdmission(db, a.why); return null; }
  try {
    const st = fstatSync(a.fd, { bigint: true });
    const size = Number(st.size);
    let sha;
    let head;
    let z = null;
    if (size <= SIDECAR_WHOLE_MAX) {
      const buf = readAt(a.fd, 0, size);
      if (buf.length < size) return null;                 // it shrank under the read: next tick
      sha = blobShaOfBytes(buf);
      head = buf;
      if (stmts(db).blobId.get(sha) === undefined) z = brotli(buf);
    } else {
      const c = await compressFdRange(a.fd, 0, size);
      if (c === null) return null;
      sha = c.sha;
      head = readAt(a.fd, 0, SIDECAR_FTS_BYTES);
      if (stmts(db).blobId.get(sha) === undefined) z = c.z;
    }
    // Task 18's ensureTranscript expects its caller's transaction (bindFile's); here it gets its own.
    const transcriptPk = withTx(db, 'NORMAL', () => ensureTranscript(db, s.uuid));
    const entryId = linkSidecar(s.name, toolResultCandidates(db, transcriptPk, cache));
    withTx(db, 'NORMAL', () => {
      if (z !== null) stmts(db).blobIns.run(sha, CODEC, z, size);
      const blobId = stmts(db).blobId.get(sha).blob_id;
      const ins = q.sidecarIns.run(transcriptPk, s.name, blobId, entryId, ctx.nowMs);
      if (ins.changes === 1 && entryId === null) bump(db, 'sidecar_unlinked');
      q.seenUpsert.run(s.path, st.size, st.mtimeNs, blobId);
      if (ctx.fts === true && stmts(db).blobId.get(sha).fts_indexed === 0) indexBlob(db, blobId, ftsTextOf(head, 'sidecar'), ctx.pairIdx);
    });
    budget.bytes += size;
    return { bytes: size };
  } finally {
    closeSync(a.fd);
  }
}

/** The sidecars of the given uuids whose transcript copies are all caught up. A sidecar is linked
 *  by the text of a tool_result the store already holds, so one taken early would stay unlinked
 *  for good. Bounded by the run's budget; `complete` is false when the budget, history-off or the
 *  free-space floor cut it short, and `paused` says it was the floor. */
export async function ingestSidecars(db, ctx, budget, uuids) {
  const due = [...uuids].filter((u) => !notCaughtUp(db, ctx.homes, u));
  const cache = new Map();
  let bytes = 0;
  for (const s of discoverSidecars(ctx.homes, due)) {
    if (!budgetLeft(budget) || ctx.historyOff()) return { bytes, complete: false, paused: false };
    const r = await ingestSidecar(db, ctx, s, budget, cache);
    if (r === null) continue;
    bytes += r.bytes;
    if (r.floor !== undefined) return { bytes, complete: false, paused: true };
  }
  return { bytes, complete: true, paused: false };
}

// ---------------------------------------------------------------------------------------------
// Secrets, every tick (§8.3 layer 1; §9.2 "Then the secrets"; plan task 22). They run before any
// drain, recovery replay or FTS insert. Each newly learned (len, sha256) pair commits under FULL
// with its `redact` outbox row and is flushed to the journal right after, as any verdict is
// (history-redaction-journaled, D-4241). Values live only in this process's memory for this tick: never
// logged, stored, journaled or printed. Under a hold no DB is open, so the secrets wait.
// ---------------------------------------------------------------------------------------------

/** Error codes that mean "nothing is there", as opposed to "something is there and unreadable".
 *  Not `ABSENT`: that name is Task 16's Presence object in this module. */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR']);

/** The largest secret file loadSecrets opens. sessions.json holds one idHash per session, so it needs
 *  headroom; anything larger is not a secret list. A stat before the open, as the _reg_read lesson
 *  (D-4300, history-secret-file-read-type-checked): a FIFO with no writer blocks in open(2) for good and
 *  a link to /dev/zero balloons in read(2), and secrets run first every tick. */
const SECRET_FILE_MAX = 4 * 1024 * 1024;

const SECRET_STMTS = new WeakMap();
function secretStmts(db) {
  let q = SECRET_STMTS.get(db);
  if (q !== undefined) return q;
  q = {
    redactHas: db.prepare('SELECT 1 AS hit FROM redact_hashes WHERE len = ? AND sha256 = ?'),
    redactIns: db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?) ON CONFLICT(len, sha256) DO NOTHING'),
    outboxIns: db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)'),
    allPairs: db.prepare('SELECT len, sha256 FROM redact_hashes'),
  };
  SECRET_STMTS.set(db, q);
  return q;
}

/** One segment of a SECRET_SOURCES glob as a matcher: `*` is any run of characters, nothing else
 *  is special. */
function globSegment(seg) {
  const body = seg.split('*').map((p) => p.replace(/[.+?^$()|[\]\\{}]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${body}$`);
}

/** The files one SECRET_SOURCES entry names under `home`. A `*` never matches a dot-name (the
 *  shell's rule). A directory that exists but cannot be listed goes to `unreadable`; an absent one
 *  names nothing. */
function expandSecretSource(home, src, unreadable) {
  if (src.path !== undefined) return [`${home}/${src.path}`];
  let paths = [home];
  for (const seg of src.glob.split('/')) {
    const next = [];
    for (const d of paths) {
      if (!seg.includes('*')) { next.push(`${d}/${seg}`); continue; }
      let names;
      try { names = readdirSync(d); } catch (e) {
        if (!ABSENT_CODES.has(e?.code)) unreadable.push(d);
        continue;
      }
      const re = globSegment(seg);
      for (const n of names.sort()) if (!n.startsWith('.') && re.test(n)) next.push(`${d}/${n}`);
    }
    paths = next;
  }
  return paths;
}

/** This tick's secret values and their (len, sha256) pairs (§8.3 layer 1): the frozen
 *  SECRET_SOURCES list under `home`, plus each declared secretsFile the shim passed (D-4205
 *  history-redaction-from-roster, D-4201 history-redaction-agent-env, D-4206 history-secret-value-grammar,
 *  D-4203 history-redaction-by-value).
 *  - An absent file names nothing, and a directory is skipped.
 *  - One that exists and cannot be read is listed `unreadable` (doctor WARN
 *    redact-source-unreadable); the pairs it gave before stay in redact_hashes.
 *  - A listed path that is not a regular file, or is over SECRET_FILE_MAX, is listed unreadable and
 *    never opened (D-4300).
 *  - A value under SECRET_MIN_LEN is never kept.
 *  - The list never names an account's exec.authDir (gpt-lane spec §4.1). */
export function loadSecrets(home, secretFiles) {
  const values = new Set();
  const pairs = new Map();
  const unreadable = [];
  let unsegmentable = 0;
  const take = (file, kind) => {
    let st;
    try { st = statSync(file); } catch (e) {
      if (!ABSENT_CODES.has(e?.code)) unreadable.push(file);
      return;
    }
    if (st.isDirectory()) return;
    if (!st.isFile() || st.size > SECRET_FILE_MAX) { unreadable.push(file); return; }
    let text;
    try { text = readFileSync(file, 'utf8'); } catch (e) {
      if (ABSENT_CODES.has(e?.code) || e?.code === 'EISDIR') return;
      unreadable.push(file);
      return;
    }
    if (kind === 'sessions') {
      for (const p of sessionHashPairs(text)) pairs.set(`${p.len}:${p.sha256}`, p);
      return;
    }
    const vs = extractSecretValues(text, kind);
    const sp = secretPairs(vs);
    for (const v of vs) if (v.length >= SECRET_MIN_LEN) values.add(v);
    for (const p of sp.pairs) pairs.set(`${p.len}:${p.sha256}`, p);
    unsegmentable += sp.unsegmentable;
  };
  for (const src of SECRET_SOURCES) for (const f of expandSecretSource(home, src, unreadable)) take(f, secretKindOf(src, f));
  for (const f of secretFiles) take(f, secretKindOf(null, f));
  return { values: [...values], pairs: [...pairs.values()], unreadable, unsegmentable };
}

/** The pairs not yet in redact_hashes, inserted with their `redact` outbox rows in ONE
 *  synchronous-FULL transaction, then flushed to the journal right away, never in the derive step,
 *  which a budget-bound tick may not reach (O34, DI8). A failed append is counted, and the rows
 *  stay in the outbox for the next tick's first flush. Returns the pairs that were new. */
export function recordPairs(db, home, ids, pairs, nowMs) {
  const q = secretStmts(db);
  const fresh = pairs.filter((p) => q.redactHas.get(p.len, Buffer.from(p.sha256, 'hex')) === undefined);
  if (fresh.length === 0) return [];
  withTx(db, 'FULL', () => {
    for (const p of fresh) {
      q.redactIns.run(p.len, Buffer.from(p.sha256, 'hex'), nowMs);
      q.outboxIns.run(journalRecord('redact', nowMs, { len: p.len, sha256: p.sha256 }));
    }
  });
  try {
    flushOutbox(db, home, ids, nowMs);
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    withTx(db, 'NORMAL', () => { bump(db, 'journal_write_failed'); });
  }
  return fresh;
}

/** The secrets step of a tick (§9.2, D-4224 history-tick-order), third after the outbox flush and the
 *  migration verdict. It returns this tick's redaction index (every pair ever recorded), the values
 *  whose pairs are new this tick (`newValues`), and every value this tick loaded (`values`), which
 *  task 23's re-index reads against its durable mark, so a pair committed by a pass that died
 *  before its re-index is still re-indexed by the next. The caller drops the values when the tick
 *  ends. */
export function secretsStep(db, ctx, secretFiles) {
  const loaded = loadSecrets(ctx.home, secretFiles);
  const fresh = new Set(recordPairs(db, ctx.home, ctx.ids, loaded.pairs, ctx.nowMs).map((p) => `${p.len}:${p.sha256}`));
  const newValues = loaded.values.filter((v) => secretPairs([v]).pairs.some((p) => fresh.has(`${p.len}:${p.sha256}`)));
  withTx(db, 'NORMAL', () => {
    if (loaded.unreadable.length > 0) bump(db, 'redact_source_unreadable', loaded.unreadable.length);
    if (loaded.unsegmentable > 0) bump(db, 'redact_value_unsegmentable', loaded.unsegmentable);
    setMeta(db, 'redact_unreadable', JSON.stringify(loaded.unreadable));
  });
  const all = secretStmts(db).allPairs.all().map((r) => ({ len: r.len, sha256: Buffer.from(r.sha256).toString('hex') }));
  return { pairIdx: makePairIndex(all), newValues, values: loaded.values };
}

// ---------------------------------------------------------------------------------------------
// The FTS index (§6.2 "FTS indexing", §9.1; plan task 23). The index is derived and blobs stay
// verbatim. Its body is extracted plain text (never JSON), redacted by redactField before it is a
// term, and only for blobs that a row of searchable provenance references. A pair learned after
// its text was indexed is re-indexed by quoted phrase before any FTS insert of that tick, and the
// obligation outlives the pass that learned it (meta fts_reindex_rid). The bytes a contentless
// delete leaves in blobs_fts_data are purged by bounded merge steps; a whole-table 'optimize'
// never runs in a scheduled pass.
// ---------------------------------------------------------------------------------------------

const FTS_STEP = 'fts';
const MERGE_STEP = 'fts-merge';
/** meta key: the highest redact_hashes rowid whose re-index has committed. */
const REINDEX_META = 'fts_reindex_rid';
/** Pages per merge step. Negative: FTS5 merges every b-tree level, including a single segment
 *  holding a deleted term (measured, 22.16.0); a positive N merges only levels holding usermerge
 *  segments. */
const MERGE_PAGES = 64;
/** Blobs per backfill transaction. */
const BACKFILL_BATCH = 256;

const DERIV_STMTS = new WeakMap();
function derivStmts(db) {
  let d = DERIV_STMTS.get(db);
  if (d !== undefined) return d;
  d = {
    sel: db.prepare('SELECT cursor, completed_ms FROM derivation_state WHERE step = ? AND version = ?'),
    ins: db.prepare('INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, ?, ?, NULL) ON CONFLICT(step, version) DO NOTHING'),
    cursor: db.prepare('UPDATE derivation_state SET cursor = ? WHERE step = ? AND version = ?'),
    done: db.prepare('UPDATE derivation_state SET completed_ms = ?, cursor = ? WHERE step = ? AND version = ?'),
    pending: db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, ?, NULL, NULL)
      ON CONFLICT(step, version) DO UPDATE SET completed_ms = NULL`),
    reopen: db.prepare('UPDATE derivation_state SET completed_ms = NULL WHERE step = ? AND version = ? AND completed_ms IS NOT NULL'),
    blobForFts: db.prepare(`SELECT z, EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = blobs.blob_id) AS is_sidecar
      FROM blobs WHERE blob_id = ?`),
    pairTop: db.prepare('SELECT max(rowid) AS rid FROM redact_hashes'),
    pairRid: db.prepare('SELECT rowid AS rid FROM redact_hashes WHERE len = ? AND sha256 = ?'),
  };
  DERIV_STMTS.set(db, d);
  return d;
}

const FTS_STMTS = new WeakMap();
/** Statements over the FTS tables. These are prepared only once ftsPrepare has made the tables:
 *  node:sqlite refuses to prepare against a table that does not exist. */
function ftsStmts(db) {
  let f = FTS_STMTS.get(db);
  if (f !== undefined) return f;
  const ph = SEARCHABLE_PROVENANCE.map(() => '?').join(', ');
  f = {
    ins: db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)'),
    del: db.prepare('DELETE FROM blobs_fts WHERE rowid = ?'),
    mark: db.prepare('UPDATE blobs SET fts_indexed = 1 WHERE blob_id = ?'),
    match: db.prepare('SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH ?'),
    merge: db.prepare("INSERT INTO blobs_fts (blobs_fts, rank) VALUES ('merge', ?)"),
    total: db.prepare('SELECT total_changes() AS n'),
    backfill: db.prepare(`SELECT b.blob_id AS blob_id, b.z AS z,
        EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = b.blob_id) AS is_sidecar
      FROM blobs b
      WHERE b.blob_id > ? AND b.fts_indexed = 0 AND b.z IS NOT NULL
        AND (EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = b.blob_id)
          OR EXISTS (SELECT 1 FROM entries e WHERE e.blob_id = b.blob_id AND e.provenance IN (${ph}))
          OR EXISTS (SELECT 1 FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
                     WHERE v.blob_id = b.blob_id AND e.provenance IN (${ph})))
      ORDER BY b.blob_id LIMIT ?`),
  };
  FTS_STMTS.set(db, f);
  return f;
}

/** A stored blob's index text: a sidecar's first SIDECAR_FTS_BYTES, or a body's plain text
 *  (D-4195, history-fts-body-plain-text). A body
 *  that does not parse indexes nothing. It is never thrown: the index is derived, and the blob
 *  stays. */
function ftsTextOfBlob(z, isSidecar) {
  const bytes = unbrotli(z);
  if (isSidecar) return ftsTextOf(bytes, 'sidecar');
  try { return ftsTextOf(JSON.parse(bytes.toString('utf8')), 'entry'); } catch { return ''; }
}

/** At a tick's start: the read-only probe (history-fts-probe-read-only), and, the first time it
 *  answers present, derivation ('fts', 1)'s first act, the two tables
 *  (D-4215, history-fts-tables-by-derivation). The probe is read-only (D-4214, history-fts-probe-read-only).
 *  - Absent: capture continues with no FTS (fts5-absent).
 *  - A throw of the probe itself: probe-failed, never folded into absent.
 *  - Writes meta `fts` (status reads it). `tables` says whether this tick may index. */
export function ftsPrepare(db, nowMs) {
  let probe;
  try { probe = probeFts5(db); } catch { probe = 'probe-failed'; }
  const d = derivStmts(db);
  let state;
  if (probe === 'present') {
    const row = d.sel.get(FTS_STEP, 1);
    if (row === undefined) {
      withTx(db, 'NORMAL', () => {
        createFtsTables(db);
        d.ins.run(FTS_STEP, 1, '0');
      });
    }
    state = row !== undefined && row.completed_ms !== null ? 'ready' : 'fts-pending';
  } else {
    state = probe === 'absent' ? 'fts5-absent' : 'probe-failed';
  }
  withTx(db, 'NORMAL', () => { setMeta(db, 'fts', state); });
  return { state, tables: probe === 'present' };
}

/** One blob into the index, inside the caller's transaction: its text REDACTED first
 *  (D-4243, history-fts-indexes-redacted-text; a secret known now is never a term, a prefix or an index
 *  byte), rowid = blob_id, and the blob marked indexed. */
export function indexBlob(db, blobId, text, pairIdx) {
  const f = ftsStmts(db);
  f.ins.run(blobId, redactField(text, pairIdx));
  f.mark.run(blobId);
}

/** Derivation ('fts', 1)'s backfill (§9.1). Every blob still unindexed that a searchable row (or a
 *  sidecar) references is indexed in BACKFILL_BATCH transactions from a cursor, within the run's
 *  budget. When none is left the step completes and meta `fts` reads ready. Under a cap or floor pause the
 *  tick does not call it (D-4242, history-fts-backfill-pauses-with-ingest). The EXISTS probes below search
 *  schema v1's referrer indexes (D-4217, history-referrer-indexes). */
export function deriveFts(db, ctx, budget) {
  if (ctx.fts !== true) return;
  const d = derivStmts(db);
  const row = d.sel.get(FTS_STEP, 1);
  if (row === undefined || row.completed_ms !== null) return;
  const f = ftsStmts(db);
  let cursor = Number(row.cursor ?? 0);
  while (budgetLeft(budget)) {
    const batch = f.backfill.all(cursor, ...SEARCHABLE_PROVENANCE, ...SEARCHABLE_PROVENANCE, BACKFILL_BATCH);
    const last = batch.length < BACKFILL_BATCH;
    withTx(db, 'NORMAL', () => {
      for (const b of batch) {
        indexBlob(db, b.blob_id, ftsTextOfBlob(b.z, b.is_sidecar === 1), ctx.pairIdx);
        cursor = b.blob_id;
        budget.bytes += b.z.length;
      }
      if (last) {
        d.done.run(ctx.nowMs, String(cursor), FTS_STEP, 1);
        setMeta(db, 'fts', 'ready');
      } else {
        d.cursor.run(String(cursor), FTS_STEP, 1);
      }
    });
    if (last) return;
  }
}

/** Re-open a completed ('fts', 1) backfill, keeping its cursor. Called when blobs were written that
 *  could not be indexed: by a tick whose probe answered fts5-absent or probe-failed while the tables
 *  exist, or by an `--op import --apply` pass, whose ingest context never indexes (Task 25). The
 *  next tick that has FTS backfills them through its full pair index. Blob ids only grow, so every
 *  such new blob lies past the cursor. A store whose tables were never made has no row to re-open:
 *  their first creation backfills from 0. */
export function resetFtsPending(db) {
  withTx(db, 'NORMAL', () => { derivStmts(db).reopen.run(FTS_STEP, 1); });
}

/** The re-index a learned pair owes the index (D-4245, history-redaction-reindex-merge, SE4), made DURABLE.
 *  Meta `fts_reindex_rid` is the highest redact_hashes rowid whose re-index has committed. `values`
 *  is every secret value this tick loaded; each whose pair lies above the mark has its blobs found
 *  by a QUOTED-PHRASE match, which FTS5 tokenises as the index did. In one transaction, each such
 *  blob's row is deleted and re-inserted with the now-complete index, merge steps are registered to
 *  purge the deleted bytes, and the mark advances to the top rowid. So a pass that died between
 *  committing a pair and re-indexing it, or a tick with no FTS, leaves the obligation to the next
 *  tick that has FTS rather than losing it. A pair with no loadable value (sessions.json's hash
 *  pairs, or a source removed since) is passed over by the mark. Values are never written anywhere.
 *  Returns how many blobs were re-indexed. */
export function reindexForValues(db, ctx, values) {
  if (ctx.fts !== true) return 0;
  const d = derivStmts(db);
  const mark = Number(getMeta(db, REINDEX_META) ?? 0);
  const top = d.pairTop.get().rid ?? 0;
  if (top <= mark) return 0;
  const owed = values.filter((v) => secretPairs([v]).pairs
    .some((p) => (d.pairRid.get(p.len, Buffer.from(p.sha256, 'hex'))?.rid ?? 0) > mark));
  const f = ftsStmts(db);
  const ids = new Set();
  for (const v of owed) for (const r of f.match.all(ftsPhrase(v))) ids.add(Number(r.rowid));
  withTx(db, 'NORMAL', () => {
    for (const id of ids) {
      f.del.run(id);
      const b = d.blobForFts.get(id);
      if (b === undefined || b.z === null) continue;   // a tombstone keeps no index row
      f.ins.run(id, redactField(ftsTextOfBlob(b.z, b.is_sidecar === 1), ctx.pairIdx));
    }
    if (ids.size > 0) d.pending.run(MERGE_STEP, 1);
    setMeta(db, REINDEX_META, String(top));
  });
  return ids.size;
}

/** Bounded FTS5 merge steps (§6.2), from derivation_state ('fts-merge', 1), within the run's
 *  budget, until FTS5 reports nothing left to merge: a total_changes() delta under 2. Only then
 *  does the guarantee on the index's bytes hold. */
export function mergeSteps(db, ctx, budget) {
  if (ctx.fts !== true) return;
  const d = derivStmts(db);
  const row = d.sel.get(MERGE_STEP, 1);
  if (row === undefined || row.completed_ms !== null) return;
  const f = ftsStmts(db);
  while (budgetLeft(budget)) {
    const before = f.total.get().n;
    withTx(db, 'NORMAL', () => { f.merge.run(-MERGE_PAGES); });
    if (f.total.get().n - before < 2) {
      withTx(db, 'NORMAL', () => { d.done.run(ctx.nowMs, null, MERGE_STEP, 1); });
      return;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The entry guard is ALWAYS the LAST statement of sweep.mjs, and nothing in this file awaits at top level.
  // main() runs while this module is still evaluating (its synchronous part runs at the call), so a
  // module-level const declared below this guard would still be uninitialised when the pass reads it: every
  // block a later task adds to this file is inserted ABOVE this guard, never appended after it.
  // The code is set as process.exitCode, and process.exit() then ends the process with it, never a drained
  // event loop: an unsettled statfs keeps a threadpool request alive, and the pass must end at its deadline,
  // not when the volume answers (O28). Writing '' first lets a piped stdout flush before the exit. main()
  // turns a throw into exit 1 itself; the .catch is the backstop for a rejection it could not report.
  main()
    .then((code) => { process.exitCode = code; process.stdout.write('', () => process.exit()); })
    .catch(() => { process.exitCode = EXIT.INTERNAL; process.exit(); });
}
