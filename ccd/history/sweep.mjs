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
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CARRIER_KILL_S, EXIT, SCHEMA_ADDED, SCHEMA_VERSION, STATFS_DEADLINE_MS, capOf, decideStoreOpen, floorThreshold,
  UUID_RE, WRITER_RE, drainingNameOk, eventKey, historyPaths, idOk, joinGeneration, journalRecord, parseSpoolLine,
  passOutcome, planMigration, planRun, readBoxEnvValue, sha256Bytes, splitSpoolText,
} from './lib.mjs';
import {
  StoreError, bump, closeWriter, createStore, dropPending, finishPending, getMeta, measureStoreFacts, openReader,
  openWriter, readAttempts, removeStaleTemps, syncWriterMirror, userVersion, withTx,
} from './store.mjs';

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

/** The role this box records, read as doctor's `_check_skills` reads it: a
 *  regular readable file, one key, `_box_env_value`'s rules (readBoxEnvValue,
 *  pinned to it by O53). Absent or unreadable is "not server", as there. A
 *  server box never gets a store, even from a shim a re-role left behind
 *  (D-4222, D-4183). */
function recordedRole(ccrcEnv) {
  let text;
  try {
    if (!statSync(ccrcEnv).isFile()) return '';
    text = readFileSync(ccrcEnv, 'utf8');
  } catch {
    return '';
  }
  const r = readBoxEnvValue(text, 'CCRC_ROLE');
  return r.found ? r.value : '';
}

/** What the probe runs on: db/ itself when it exists (a link is followed by
 *  statfs), else the nearest existing ancestor — the filesystem a first
 *  creation will put db/ on. Every path here is on the home filesystem. */
function probeTarget(P, home) {
  for (const d of [P.dbDir, P.root, `${home}/.ccrc`, home]) {
    try { lstatSync(d); return d; } catch { /* the next one up */ }
  }
  return home;
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
 *  - Stop and PostCompact: a receipt and a discovery hint, nothing else.
 *  A gen-less recall joins the observed generation, and that join is a verdict, because it read the registry
 *  (§9.14). */
export function applyEventLine(db, c, ev) {
  const { rec } = ev;
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
  // Step 1, the drain: journal first, then the FULL drain transaction, then its verdicts, then the unlink (§9.14).
  // runPass never ticks without both binding names: a missing store.writer is a hold there (§9.10 "Writer token").
  ctx.hints = drainSpool(db, ctx);
  // <<< history tick steps
  mkdirSync(ctx.paths.spool, { recursive: true, mode: 0o700 });
  if (ctx.parsed.rosterUnreadable) bump(db, 'roster_unreadable');
}

/** One pass. Resolves to its exit code (§13's EXIT; a scheduled pass's 0/5 from
 *  `passOutcome`). The home is `deps.home` when a caller injects one (an
 *  in-process test passes its fixture HOME), else $HOME — this file's one read
 *  of the environment — and it must be an absolute path, or nothing is swept
 *  and the pass exits 1 (integration contract 4). */
export async function runPass(argv, deps = {}) {
  const home = deps.home ?? process.env.HOME;
  if (typeof home !== 'string' || !home.startsWith('/')) {
    process.stderr.write('history-sweep: HOME is not an absolute path; nothing was swept\n');
    return EXIT.INTERNAL;
  }
  const out = deps.out ?? ((line) => { process.stdout.write(`${line}\n`); });
  const now = deps.now ?? Date.now;
  const statfs = deps.statfs ?? ((p) => fs.promises.statfs(p));
  const prevUmask = process.umask(0o077);
  try {
    const parsed = parseSweepArgv(argv);
    if ('error' in parsed) {
      process.stderr.write(`history-sweep: ${USAGE}\n`);
      return 2;
    }
    if (parsed.op !== null) {
      // The --op verbs arrive with their gate (§8.4; D-4181,
      // D-4221); until a verb is wired, an op pass is
      // refused whole, before it reads or writes anything.
      out(JSON.stringify({ rc: 2, reason: 'bad-args' }));
      return 2;
    }
    const P = historyPaths(home);
    const say = (word) => { const o = passOutcome(word); out(`history-sweep: ${o.word}`); return o.exit; };

    // history-off first (§9.2): before the role, before any probe, before the DB.
    if (existsSync(P.off)) return say('off');
    const role = recordedRole(P.ccrcEnv);

    const free = await statfsWithDeadline(probeTarget(P, home), STATFS_DEADLINE_MS, statfs);
    // A probe that never settled leaves db/ unmeasurable without risking a
    // read that blocks for good on the dead volume: the pass ends here, with no
    // DB opened (§9.3, O28) — doctor reads the same condition from the CLI.
    // This is the pass's ONE statfs before its first ingest chunk; Task 19's
    // HISTORY_TEST_STATFS_AFTER=1:… case counts on exactly one.
    if (free.state === 'unsettled') return say('store-unreachable');

    const facts = measureStoreFacts(home, role);
    const store = decideStoreOpen(facts);
    if (store.act !== 'refuse') removeStaleTemps(home);

    let sizeBytes = 0;
    let migration = 'none';
    if (store.act === 'open' || store.act === 'finish-pending') {
      sizeBytes = statSync(P.dbFile).size + (existsSync(P.wal) ? statSync(P.wal).size : 0);
      let r;
      try {
        r = openReader(P.dbFile);
      } catch (e) {
        if (e instanceof StoreError) return say(e.word);
        throw e;
      }
      let stored;
      let copyBps = null;
      try {
        stored = userVersion(r);
        const bps = Number(getMeta(r, 'copy_bps'));
        if (Number.isFinite(bps) && bps > 0) copyBps = bps;
      } finally {
        r.close();
      }
      const fsSize = free.state === 'ok' ? free.fsSize : 0;
      migration = planMigration({
        stored, code: SCHEMA_VERSION, freeBytes: free.state === 'ok' ? free.bytes : 0,
        thresholdBytes: floorThreshold(fsSize), sizeBytes, boundS: CARRIER_KILL_S, copyBps,
        attempts: readAttempts(home, SCHEMA_VERSION), heavy: SCHEMA_ADDED[SCHEMA_VERSION]?.heavy ?? false,
      });
    }
    const plan = planRun({
      historyOff: false, store, free, sizeBytes, capGb: capOf(capText(P.cap)).gb, migration, recovering: false,
    });
    if (plan.arm !== 'run') {
      // The journal half (§9.2): whenever the drain cannot run, rename, observe and, when store.id and
      // store.writer both read, journal each spool file. Each file is held in .draining/ for the drain that
      // follows the hold. Never on a server box, which spools nothing (§6.9); history-off never reaches here.
      if (plan.holdWord !== 'store-create-refused-role') {
        // store.id and store.writer as measured: both must be readable values of their grammars (StoreFacts).
        const holdIds = facts.storeId.state === 'value' && facts.writer.state === 'value'
          ? { storeId: facts.storeId.value, writer: facts.writer.value } : null;
        const half = journalHalf(home, holdIds, now());
        if (half.journalFailed) out('history-sweep: journal-unwritable');
      }
      return say(plan.arm === 'hold' ? plan.holdWord : 'held');
    }

    let finished = false;
    if (store.act === 'drop-pending-create') dropPending(home);
    if (store.act === 'create' || store.act === 'drop-pending-create') createStore(home);
    if (store.act === 'finish-pending') { finishPending(home); finished = true; }

    let db;
    try {
      db = openWriter(P.dbFile);
    } catch (e) {
      if (e instanceof StoreError) return say(e.word);
      throw e;
    }
    try {
      if (finished) bump(db, 'store_creation_completed');
      syncWriterMirror(db, home);
      // The journal's two names, read from the home filesystem AFTER the create/finish step, never from meta
      // (§9.14; D-4220, slug history-store-writer-file). `facts` cannot supply them: it was measured before
      // finishPending, when only store.id.pending held the id, so on the finish-pending arm it names no store.
      const token = (p, re) => {
        try { const v = readFileSync(p, 'utf8').trim(); return re.test(v) ? v : null; } catch { return null; }
      };
      const sid = token(P.storeId, UUID_RE);
      const writer = token(P.writer, WRITER_RE);
      const ids = sid !== null && writer !== null ? { storeId: sid, writer } : null;
      if (ids === null) {
        // store.writer (or store.id) cannot be read after the binding step, so no journal file can be named and
        // nothing may be drained: journal first (§9.2). The journal half observes only, as for an unbound store,
        // until a binding writes the token. Nothing is counted: this is a hold, not a failed append.
        journalHalf(home, null, now());
        return say('held');
      }
      await tick(db, {
        home, paths: P, parsed, plan, free, now,
        ids, homes: parsed.homes, rosterUnreadable: parsed.rosterUnreadable, out,
      });
    } finally {
      closeWriter(db);
    }
    return 0;
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The entry guard is ALWAYS the LAST statement of sweep.mjs, and nothing in
  // this file awaits at top level. main() runs while this module is still
  // evaluating (its synchronous part runs at the call), so a module-level
  // const declared below this guard would still be uninitialised when the
  // pass reads it: every block a later task adds to this file is inserted
  // ABOVE this guard, never appended after it.
  // The code is set as process.exitCode, and process.exit() then ends the
  // process with it, never a drained event loop: an unsettled statfs keeps a
  // threadpool request alive, and the pass must end at its deadline, not when
  // the volume answers (O28). main() turns a throw into exit 1 itself; the
  // .catch is the backstop for a rejection it could not report.
  main()
    .then((code) => { process.exitCode = code; process.exit(); })
    .catch(() => { process.exitCode = EXIT.INTERNAL; process.exit(); });
}
