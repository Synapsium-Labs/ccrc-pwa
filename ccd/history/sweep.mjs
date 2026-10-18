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
// THE ORDER OF A SCHEDULED PASS, up to the tick (`scheduledPass`; the --op pass's own is the block headed
// `THE --op PASS`, and `THE PASS` block below says what each answer is):
//   history-off → role (CCRC_ROLE in ~/.ccrc/ccrc.env, readBoxEnvValue) →
//   the free-space probe on db/ (async, STATFS_DEADLINE_MS: a dead volume is a
//   pause BEFORE any synchronous read under db/ can block, RR15) →
//   `openStore`: the store facts → decideStoreOpen (a refusal ends the pass) → stale temps → (drop a pending
//   creation →) create → the version peek, where a newer store is refused BEFORE finish-pending (D-4301) →
//   finish-pending → the writer open, which refuses a store not in WAL → the writer mirror and the stale op
//   marker → (store.writer unreadable: a `held` hold, the journal half observing only) → the outbox
//   (`flushFirst`, outside the budget) → `clearDoneMarkers` → the store's size → `migrationVerdict`, which first
//   removes every stale migration temp (D-4339) → planRun → migrate | hold | run (`fixModes`, then `tick`) →
//   after the tick, `periodicCensus` and meta `journal_unwritable`.
// `tick` is the bound store's whole tick (§9.2's order;
// D-4224); each later step is added there, and nothing above it
// changes for that.
//
// Reads exactly three environment variables: HOME, in `runPass` below
// (`deps.home ?? process.env.HOME`, integration contract 4), and CLAUDECODE and
// TMUX_PANE, in the --op gate (`runOpPass`, `paneNameFor`; Task 25, D-4247) — the frozen
// allow-list single-definition.test.ts pins; tests reach every fault through a
// test-only preload, never a variable this file reads (§10.1 "Seams").
import fs, {
  accessSync, chmodSync, closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readdirSync,
  readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import { pathToFileURL } from 'node:url';
import {
  CARRIER_KILL_S, EXIT, SPOOL_FILE_MAX, OBS_FILE_MAX, CONTROL_FILE_MAX, observationOk, SCHEMA_ADDED, SCHEMA_VERSION, SCAN_INTERVAL_MS, STATFS_DEADLINE_MS, capOf, decideCandidate,
  decideEpochLine, decideRekey, decideStoreOpen, floorThreshold, locationMatches,
  UUID_RE, WRITER_RE, drainingNameOk, drainingNameParts, drainingOrder, eventKey, historyPaths, idOk, spoolFileIdOf, joinGeneration, journalRecord, parseSpoolLine,
  heavyVersionsBetween, passOutcome, planFileRead, planMigration, planRun, storeVersionDamaged, readBoxEnvValue, sha256Bytes, sha256Hex, splitSpoolText, spoolLinesOverCap,
  SQLITE_CODES, decideDrainFailure, blobOverDecodeCap, CHUNK_BYTES, LINE_MAX, RUN_BUDGET_MS, RUN_BUDGET_BYTES, withinBudget, isStoredRow, uuidlessTypeOf, blobBodyOf, entryOf,
  boundaryOf, provenanceOf, variantCauseOf, canonicalJson, jsonWithinStructureBound, blobShaOfBytes, ROW_TYPES, PARSE_STATE, RAW_ROW, PROV_VERSION,
  toolUsesOf, toolResultIdsOf, rawRowKey, launchFactsOf, lagOfTick, SIDECAR_WHOLE_MAX, SIDECAR_MAX_BYTES, linkSidecar, ftsTextOf,
  SECRET_SOURCES, SECRET_MIN_LEN, extractSecretValues, secretPairs, secretUnits, sessionHashPairs, makePairIndex, secretKindOf,
  FTS_STEP, INDEXED_PROVENANCE, SIDECAR_FTS_BYTES, SIDECAR_REDACT_MARGIN, sidecarIndexText, ftsPhrase, entryIndexText, HEALTH_COUNTERS, RETENTION_STATE_META,
  makeProbeIndex, parseRederiveState, formatRederiveState, rederivePlan, phraseValues,
  makeBelt, beltUnits, BELT_META, BELT_NODES_STEP, BELT_COUNTERS, REDACT_SOURCES_META, normalizeRedactSources, parseBeltState, formatBeltState,
  decideBelt, beltAfterGeneration, BELT_VERSION, beltWitnessMoved,
  REDERIVE_SLICE_MS, REDERIVE_SLICE_BYTES,
  REASONS, TMUX_DEADLINE_MS, decideOpGate, formOf, parseOpMarker, formatPassMarker, parsePassMarker, decidePassLive, parsePassDied, formatPassDied, procStartOf, bootIdOf, parseOpVerbArgs, BIND_KINDS, paneReadWanted,
  HARNESS_TABLE, exportDates, dueTranscriptKeys, shortestRetentionHome, planExport, exportDueOldestMeta, retentionLowered, parseJournalRecord,
  decideRecallOff, recallOffPath, decideReparse, REPARSE_MAX_TARGETS, planCopy, STORE_DB_REL,
  diffForeignKeys, ftsTablesHealthy, FTS_REBUILD_STEP, decideCounterResets, decideIntegrity,
  RECOVER_PHASES, RECOVER_JOURNAL_PHASES, formatRecoverCursor, parseRecoverCursor, orderJournalFiles, indexRecord, replayStep, nextUnmovedTicks, HEALTH_META,
  mergeJournalByTime, decideBind, restoreNameOk,
  EXPORT_DIR, EXPORT_SEGMENT_MAX_BYTES, EXPORT_SEGMENT_FORMAT, segmentName, nextSegmentSeq, planSegment, CLAUDE_CODE_DEFAULT_RETENTION_DAYS,
  shortestRetention, exportHorizonDays, decideExportPass, planExportRoom, exportPassIntervalMs, exportMarkFailsOf, decideMarkOutcome,
  decideMarkCheck, missingSegmentNames, deadFileSourceKey, decideSegmentReplay, orderSegmentNames,
} from './lib.mjs';
import {
  MIGRATIONS, OWED_INDEX, StoreError, bump, clearDoneMarkers, closeWriter, createStore, dropPending, finishPending, getMeta,
  measureStoreFacts, measuredSize, openReader, openWriter, readAttempts, removeStaleMigrationTemps, removeStaleTemps, runMigration, setMeta,
  syncWriterMirror, userVersion, withTx, writeFileAtomic, removeEntry, readBounded, removeStaleAtomicTemps, mkdirDurable,
  CODEC, brotli, unbrotli, unbrotliPrefix, compressFdRange, probeFts5, createFtsTables, recoverStepAt, storedVersionAt,
  pruneApply, pruneDryRun, writeBackup, removeStaleBackupTemps,
  integrityCheck, foreignKeyRows, ftsMeasure, dropFtsTables, getStep, setStep, setCounter, adoptStore,
  peekStoreId, stageRestore, commitRestore, abortRestore,
  ensureSegmentDir, createSegment, segmentInserts, publishSegment, listSegments, removeStaleSegmentTemps, setSegmentSeq,
  openSegment, segmentMeta, segmentBlobsAfter, segmentRowsAfter,
} from './store.mjs';
import { isBoundaryLine } from '../compact-card.mjs';
import {
  deriveNodes, reparseTargets, reparseLeaves, clearLeafCrashes, indexNodesFts, NODES_FTS_STEP, rederiveGistsFor, redactNodeFields, reparseFailClosed, rerollNodes,
  beltNodesStep,
} from './derive.mjs';
import { cardStep, collectPurgedHistoryFiles, ensureHistoryDirs, withdrawCards } from './card.mjs';

const USAGE = 'usage: sweep.mjs [--op <verb> <op-args...>] [--roster-unreadable] --secrets <file...> -- <home...>';

/** The shim's argv, exactly: `[--op <verb> <op-args…>] [--roster-unreadable]
 *  --secrets <file…> -- <home…>` (§5.1 step 5). An op's arguments run up to the
 *  first `--roster-unreadable` or `--secrets`. Sources are normalized in stable first-seen order and
 *  refused before a pass opens the store unless the shared bounded source-list contract admits them. */
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
  const normalizedSecrets = normalizeRedactSources(secrets);
  if (normalizedSecrets === null) return { error: 'bad-args' };
  return { op, opArgs, rosterUnreadable, secrets: normalizedSecrets, homes: argv.slice(i + 1) };
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
 *  string — malformed, so the default applies and doctor WARNs (§9.3). One bounded nonblocking open
 *  (D-4347 (history-planted-entries-never-wedge)): a FIFO, a device or a file over CONTROL_FILE_MAX is unreadable, never waited on. */
function capText(capPath) {
  const r = readBounded(capPath, CONTROL_FILE_MAX, true);
  return r.state === 'absent' ? null : r.state === 'value' ? r.value : '';
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

/** A journal append, its fsync, or a month file's creation that did not complete, or a failed write of the
 *  observation sidecar that precedes it (D-4338, history-sidecar-write-failure-holds: the sidecar lives on the same
 *  home filesystem as the journal, so a full one fails it first and it is the same hold). The caller keeps the draining
 *  file in `.draining/` and runs no drain transaction for it (§9.2 "Journal first"). A verdict stays in the outbox.
 *  `code` is a closed word ('bad-name' | 'short-write' | 'append-failed' | 'sidecar-failed'), never an OS message. */
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
    // D-4347 (history-planted-entries-never-wedge): type-aware, so an empty directory planted at a temp name is removed and a non-empty one left, never an EISDIR
    // out of every append. This pass's own temp carries this pid, so a leftover blocks nothing unless its name has it.
    if (n.startsWith(`.${month}.${ids.writer}.jsonl.`) && n.endsWith('.tmp')) removeEntry(`${dir}/${n}`);
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
    mkdirDurable(dir);
    // D-4308 (history-journal-temp-swept-every-append): swept on EVERY append, before the existence check, not only
    // when the month file is first created. A kill between createMonthFile's link and its unlink leaves the month
    // file in place with a temp link to it, which the creation-only sweep never reached. One readdir per call;
    // appendJournal is the batch entry point (callers hand it a whole block).
    removeStaleMonthTemps(dir, ids, month);
    if (!existsSync(file)) createMonthFile(dir, file, ids, month, nowMs);
    // D-4347 (history-planted-entries-never-wedge): O_NOFOLLOW refuses a link at the month file (ELOOP, so append-failed through the outer catch, never a
    // write-through), and the descriptor must be a regular file: a FIFO opened O_RDWR does not block in open(2) but
    // blocks in write(2) past the pipe buffer. No O_NONBLOCK: this type check is the guard. A non-regular entry here
    // is the ordinary journal hold, never a wait.
    const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw new JournalError('append-failed');
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
export function countOutside(db, name, by = 1) {
  try { withTx(db, 'NORMAL', () => bump(db, name, by)); } catch { /* recounted on the next tick that meets it */ }
}

/** A counter committed in its own transaction BEFORE the act it counts (D-4337's order: a crash between the two may count
 *  twice, never lose the count). False when it could not commit: the caller then leaves the act undone, and the next tick
 *  meets the entry again and counts it then (`setAside`; FU8, FP6: tidyDraining's displacement). */
function countFirst(db, name) {
  try { withTx(db, 'NORMAL', () => bump(db, name)); return true; } catch { return false; }
}

// ── The spool drain, two-phase (spec §9.2 step 1, §9.14 "The order of writes") ──────────────────────────────
//
// At tick N each spool/<id>.jsonl is renamed to spool/.draining/<id>.<tickMs>.<pid>.jsonl (so a name is never reused)
// and observed. It is read at tick N+1. A hook that opened the old inode just before the rename still lands its line.
// `drainSpool` runs, in this order: `ensureSpoolDirs`, then `tidyDraining` (planted entries and stale or malformed
// sidecars, D-4347: counted, moved or removed before the drain lists anything), then, for each draining file in
// journaling order:
//   0. a name tidyDraining `kept` or `blocked`, or one that waits behind an earlier blocked file of its id, is skipped
//      (D-4347); a regular file over SPOOL_FILE_MAX is set aside from its lstat BEFORE any open (D-4337): into
//      `.draining/oversize/`, counted `spool_oversize`, never journaled (one over SPOOL_FILE_LINES_MAX is set aside
//      there too, counted `spool_overlines`, when its read counts the lines). For any other file, each per-file step
//      follows §9.14's order:
//   1. the observation sidecar (a link or FIFO met when the file is read is removed with the sidecar this step
//      wrote, and counted `non_regular`, D-4347);
//   2. the `file` and `spool` records, ONE write, fsynced;
//   3. the sidecar's journaled mark;
//   4. the drain transaction under synchronous=FULL, holding its verdicts and one `drained` outbox row; a commit the
//      store refuses for the file's own rows moves that journaled file into `.draining/rejected/` (counted
//      `drain_rejected`, D-4346) and the loop goes on;
//   5. the verdict append, fsynced;
//   6. the unlink of the file and its sidecar;
//   7. the outbox delete.
// The three set-aside directories under `.draining/` are distinct, and `listDraining` lists none of them:
// `oversize/` holds the files of step 0 only (D-4337); `rejected/` holds ONLY spool files the store refused, already
// journaled, counted `drain_rejected` (D-4346); `planted/<tickMs>.<pid>/` holds planted non-regular entries, counted
// `non_regular` (D-4347), and a live file whose sidecar name was planted (counted `spool_displaced`, or `spool_blocked`
// and skipped when it cannot move either). After the loop, THIS tick's renames run (`renameAndObserve`), so a file is
// read at the NEXT tick, never the one that renamed it. When the loop throws, the journal half runs instead, before its error
// leaves: it renames, observes and journals, as a hold does (FU8, FPM8).
// Nothing here runs through a `spool/` that is not a real directory (FU8, D-4347 (history-planted-entries-never-wedge)): a link
// there is never followed, and the drain, the journal half and the tick's own mkdir refuse it (`spoolRefused`). Nor through a
// `spool/` or `.draining` this user cannot read, write and search (`spoolUnusable`).
// So a drained file's lines and the verdicts taken from them are both in the fsynced journal before the file goes.

/** Registry values ccd writes are a few dozen bytes; anything larger was not written by ccd. */
const REG_VALUE_MAX = 4096;
/** A compaction journal record is under 1 KiB of metadata, so 4 MiB holds thousands; an over-cap or unreadable log gives no
 *  evidence, and its transcripts are listed unmapped (importEvidence; D-4347 (history-planted-entries-never-wedge)). */
const REG_LOG_MAX = 4 * 1024 * 1024;
/** The absent and unreadable Presences. `ABSENT` is this Presence object; Task 22's set of absent-file error codes
 *  is a different value under its own name, `ABSENT_CODES`, so the module never declares `ABSENT` twice. */
const ABSENT = Object.freeze({ state: 'absent' });
const UNREADABLE = Object.freeze({ state: 'unreadable' });

/** `<id>.<tickMs>.<pid>.jsonl`. At SPOOL_ID_MAX (224) with a 7-digit pid, it is 252 bytes, within lib's
 *  DRAINING_NAME_MAX (253, D-4303); its sidecar is 250 and the sidecar's temp 254, under the 255-byte NAME_MAX (§5.1). */
export function drainingName(id, tickMs, pid) { return `${id}.${tickMs}.${pid}.jsonl`; }

/** The id is everything before the last three dot-components, so `a.b.c` drains under `a.b.c`. Anything not of
 *  this shape is not a draining file. The grammar is lib's `drainingNameOk` (an id passing idOk, a tick of at most
 *  16 digits, a pid of at most 10, DRAINING_NAME_MAX = 253 bytes in all, D-4303), the one the journal's `file` and `drained` records are checked
 *  against: a name it refuses is never listed, journaled or drained, so it can never make journalRecord throw
 *  mid-tick. lib's `drainingNameParts` is that grammar's one split (FU8), which status's held-file walk shares. */
export function parseDrainingName(name) {
  return drainingNameParts(name);
}

export function idOfDrainingName(name) {
  const p = parseDrainingName(name);
  return p === null ? null : p.id;
}

/** `.jsonl` replaced by `.obs`, not appended to it: `<file>.obs` would not fit 255 bytes at SPOOL_ID_MAX. */
export function sidecarName(name) { return `${name.slice(0, -'.jsonl'.length)}.obs`; }

/** Read a small regular file in ONE open, with its type and size judged on the descriptor
 *  (D-4347 (history-planted-entries-never-wedge)). This is the `_reg_read` lesson (ccd/ccd:3238-3246): a FIFO with no writer
 *  blocks in open(2) forever, and a link to /dev/zero blocks in read(2). A stat followed by an open could be raced into
 *  either, so store.mjs's `readBounded` opens nonblocking and judges the descriptor, and a FIFO or device is never
 *  waited on. Absent and unreadable are two answers, never folded together (rev 3.2 review, IV5). */
function readSmall(path, max) {
  const r = readBounded(path, max, true);
  return r.state === 'value' ? { state: 'value', value: r.value } : r.state === 'absent' ? ABSENT : UNREADABLE;
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

/** The sidecar as a measured read, four answers never folded (FU8, FPM9; the no-overloaded-null rule):
 *  - `value`, with the observation `observe` wrote;
 *  - `absent`;
 *  - `malformed`: a regular file over OBS_FILE_MAX, or content that fails lib's `observationOk`
 *    (D-4347 (history-planted-entries-never-wedge)), which no `observe` wrote, so it is observed again;
 *  - `unreadable`: there, but not readable now (an open or read failure such as EACCES or EMFILE, or a non-regular entry).
 *    It may still hold the file's rename-time observation and journaled mark (DI14, O46), so nothing removes or replaces it:
 *    `observe` throws SPOOL_UNREADABLE and the file waits.
 *  So `observe`, `recordHeldMatches` and `journalFile` only ever use a valid observation, on the drain and the hold alike. */
function readSidecar(path) {
  const r = readBounded(path, OBS_FILE_MAX, true);
  if (r.state === 'absent') return { state: 'absent' };
  if (r.state === 'unreadable') return { state: 'unreadable' };
  if (r.state !== 'value') return { state: 'malformed' };   // over-cap: a size no observe writes
  let o;
  try { o = JSON.parse(r.value); } catch { return { state: 'malformed' }; }
  return observationOk(o) ? { state: 'value', obs: o } : { state: 'malformed' };
}

/** One draining file this pass cannot read (FU8, FP5, FPM9; D-4347 (history-planted-entries-never-wedge)): its bytes
 *  (`file <code>`: an fs error other than ENOENT and ELOOP, such as EACCES on a mode-000 file or one another uid owns, EMFILE
 *  or EIO) or its observation sidecar (`sidecar unreadable`). Thrown per file, code SPOOL_UNREADABLE: the drain and the
 *  journal half skip that file for the pass, leave it and its sidecar in place, and hold its id's later files behind it. */
function spoolUnreadable(what, why) {
  return Object.assign(new Error(`draining ${what} cannot be read: ${why}`), { code: 'SPOOL_UNREADABLE', reason: `${what} ${why}` });
}

/** A failure of a draining file's open or read as `readDrainingText`'s callers decide it: ENOENT (gone) and ELOOP (a planted
 *  link) as they are; any other fs error (one carrying a code and a syscall) as SPOOL_UNREADABLE; anything else as it is. */
function asDrainingReadError(e) {
  if (e && typeof e.code === 'string' && typeof e.syscall === 'string' && e.code !== 'ENOENT' && e.code !== 'ELOOP') return spoolUnreadable('file', e.code);
  return e;
}

/** Temp, fsync, rename, fsync the directory. The temp is `<sidecar>.tmp` (254 bytes at the bound), so no longer
 *  suffix fits. One lock holder at a time, so one temp name is enough. */
function writeSidecar(path, obs) {
  // D-4338 (history-sidecar-write-failure-holds): any failure to write the sidecar (ENOSPC, a short write, a failed
  // rename or fsync) is the journal-unwritable hold, a JournalError, never a plain Error that fails the pass every
  // tick before ingest. The files stay held, and the next tick writes the sidecar again.
  try {
    const tmp = `${path}.tmp`;
    // D-4347 (history-planted-entries-never-wedge): whatever stands at the temp name is removed first (a file, link or FIFO unlinked, an empty directory rmdir'd),
    // so a planted FIFO cannot block open(2) and a link is never written through; a non-empty directory is kept and fails
    // the open EEXIST, as this try's JournalError. O_EXCL and O_NOFOLLOW are race belts behind removeEntry and have no
    // deterministic case.
    removeEntry(tmp);
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const buf = Buffer.from(JSON.stringify(obs), 'utf8');
      if (writeSync(fd, buf) !== buf.length) throw new Error('sidecar: short write');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    fsyncDir(dirname(path));
  } catch (e) {
    throw new JournalError('sidecar-failed', e);
  }
}

/** The file's observation (slugs history-journal-observation-sidecar, D-4231; history-observe-at-rename, D-4232). The registry is
 *  read right after the rename and kept beside the file. Every decision the drain later takes uses this earliest
 *  observation, never the registry as it is then. An existing sidecar is reused, never re-read: a re-journal after a
 *  crash decides from the same facts. A sidecar that does not parse is observed again. One that is there but cannot be
 *  read now is never replaced (FU8, FPM9): this throws SPOOL_UNREADABLE and the file waits for a pass that can read it. */
export function observe(home, name, nowMs) {
  const side = `${historyPaths(home).draining}/${sidecarName(name)}`;
  const had = readSidecar(side);
  if (had.state === 'value') return had.obs;
  if (had.state === 'unreadable') throw spoolUnreadable('sidecar', 'unreadable');
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
export function listDraining(home, complete = false) {
  const P = historyPaths(home);
  // FU8 (D-4347 (history-planted-entries-never-wedge)): a link at `.draining` is never listed through, and a non-directory
  // there lists nothing (its readdir threw ENOTDIR out of a pass that only journals, M16). A receipt census needs to
  // distinguish that unavailable listing from a measured empty directory.
  if (dirKind(P.draining) !== 'dir') return complete ? null : [];
  let names;
  try { names = readdirSync(P.draining); } catch (e) { if (e && e.code === 'ENOENT') return complete ? null : []; throw e; }
  return names
    .map((n) => ({ name: n, parts: drainingNameParts(n) }))
    .filter((x) => x.parts !== null)
    .sort(drainingOrder)
    .map((x) => x.name);
}

/** spool/ and spool/.draining/, 0700. Only a bound, open store makes them, and the hook spools only into an
 *  existing spool/ (§5.1), so capture starts with the first tick of a bound store. True when a non-directory stood at
 *  `.draining` and was removed (the caller counts it `non_regular`). */
export function ensureSpoolDirs(home) {
  const P = historyPaths(home);
  let stray = false;
  let st = null;
  try { st = lstatSync(P.draining); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
  // D-4347 (history-planted-entries-never-wedge): a file, link or FIFO at `.draining` is unlinked (a link's target is untouched), or mkdir fails EEXIST every pass.
  if (st !== null && !st.isDirectory()) { removeEntry(P.draining); stray = true; }
  mkdirDurable(P.draining);
  return stray;
}

/** Whether `p` names an entry (a link counts, its target is never followed); any lstat error but ENOENT propagates. */
function presentName(p) { try { lstatSync(p); return true; } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; } }

/** What stands at one of the spool directories' own names, judged by lstat and never followed (FU8, D-4347
 *  (history-planted-entries-never-wedge)): `dir` for a real directory; `absent` when nothing does (ENOENT, or ENOTDIR: an
 *  ancestor is not a directory); `other` for anything else, a link to a directory included. Any other lstat error propagates. */
function dirKind(p) {
  let st;
  try { st = lstatSync(p); } catch (e) { if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return 'absent'; throw e; }
  return st.isDirectory() ? 'dir' : 'other';
}

/** True when something that is not a real directory stands at `spool/` (FU8, D-4347 (history-planted-entries-never-wedge)).
 *  Only db/ may link out of the history root (§9.3; RV9), and the hook appends only into a real `spool/` (D-4418). Followed,
 *  a link there had the sweep rename every `<id>.jsonl` in its target (a transcript's `<uuid>.jsonl` included) into a
 *  `.draining/` it made there, and unlink each once drained (final pass FP3). While it stands, no spool work runs through it:
 *  nothing is renamed out of it, no `.draining` is made, tidied, listed, journaled or drained through it, and the tick makes no
 *  `spool/`. A drain counts it `non_regular`, both halves print SPOOL_REFUSED_LINE, and every other step of the pass goes on. */
function spoolRefused(home) { return dirKind(historyPaths(home).spool) === 'other'; }
const SPOOL_REFUSED_LINE = 'history-sweep: spool-refused: spool/ is not a real directory\n';

/** True when `spool/`, or the `.draining` directory under it, is a real directory this user cannot read, write and search
 *  (access(2) R_OK|W_OK|X_OK; FU8, D-4347 (history-planted-entries-never-wedge)). A 000 or 0500 one failed every pass's
 *  lstat, readdir or rename with EACCES before ingest, on the drain and the hold alike. While it stands no spool work runs, as
 *  for `spoolRefused`, and both halves print SPOOL_UNUSABLE_LINE. It is counted nowhere: status measures the directory's
 *  mode itself (FAIL `mode-wrong`, remedy `chmod 0700`). */
function spoolUnusable(home) {
  const P = historyPaths(home);
  const usable = (p) => { try { accessSync(p, constants.R_OK | constants.W_OK | constants.X_OK); return true; } catch { return false; } };
  if (dirKind(P.spool) !== 'dir') return false;
  if (!usable(P.spool)) return true;
  return dirKind(P.draining) === 'dir' && !usable(P.draining);
}
const SPOOL_UNUSABLE_LINE = 'history-sweep: spool-refused: spool/ or spool/.draining is not readable, writable and searchable by this user\n';

/** Rename each regular spool/<id>.jsonl into .draining/ under a fresh name, chmod 0600 (uncounted, §9.2; the 0700
 *  directory is the protection, slug history-spool-mode-by-directory, D-4233). A name no hook writes (an id outside the
 *  grammar) or a dot-file stays where it is and is never read. Any other node at a spool file's name that is not a
 *  regular file (a FIFO, a link, dangling or not, a directory), which the hook refuses too, stays where it is and is
 *  never read or followed; its name is pushed onto `refused` when the caller passes one (D-4418
 *  (history-spool-append-regular-file-only), FR2c). A name already present in .draining/ (or its .obs) is never renamed
 *  onto: that spool file waits for the next half. */
export function renameSpoolFiles(home, tickMs, pid, refused = null) {
  const P = historyPaths(home);
  // FU8 (D-4347 (history-planted-entries-never-wedge)): only a real spool/ is read; through a link this renamed, and the
  // drain then unlinked, `<id>.jsonl` files outside the history root (FP3).
  if (dirKind(P.spool) !== 'dir') return [];
  let names;
  try { names = readdirSync(P.spool).sort(); } catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const n of names) {
    const id = spoolFileIdOf(n);
    if (id === null) continue;
    let st;
    try { st = lstatSync(`${P.spool}/${n}`); } catch { continue; }
    if (!st.isFile()) {   // D-4418 (history-spool-append-regular-file-only): never read, moved or followed; the caller counts and names it (FR2c, F3)
      if (refused !== null) refused.push(n);
      continue;
    }
    ensureSpoolDirs(home);
    const to = drainingName(id, tickMs, pid);
    // §9.2 step 1: a draining name is never reused (D-4232's halves can run twice in one millisecond of one pass). An
    // existing name, or its observation sidecar's, would be replaced by renameSync and its .obs inherited: the spool
    // file waits in spool/ for the next half (review 316 F19).
    if (presentName(`${P.draining}/${to}`) || presentName(`${P.draining}/${sidecarName(to)}`)) continue;
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

/** Rename this tick's spool files and observe each. `failed` is true when a sidecar write failed (D-4338,
 *  history-sidecar-write-failure-holds): the renamed file stays in .draining/ without one, and the next journaling
 *  observes it. Every file is still tried, so one failure does not leave a later file unobserved. `refused` is how many
 *  nodes at a spool file's name were not regular files (D-4418 (history-spool-append-regular-file-only), FR2c): each is
 *  named on stderr here, on both halves, and only the drain counts them (`non_regular`; no DB holds a counter on a
 *  hold, IV2). */
function renameAndObserve(home, tickMs, nowMs) {
  let failed = false;
  const refused = [];
  for (const n of renameSpoolFiles(home, tickMs, process.pid, refused)) {
    if (overSpoolCap(home, n)) continue;   // FU8 (FPM7): never observed; the drain sets it aside from its lstat (D-4337)
    try {
      observe(home, n, nowMs);
    } catch (e) {
      // FU8 (FPM9): a sidecar name it cannot read right after the rename leaves the file unobserved; its next journaling observes it
      if (e && e.code === 'SPOOL_UNREADABLE') continue;
      if (!(e instanceof JournalError)) throw e;
      failed = true;
    }
  }
  for (const n of refused) process.stderr.write(`history-sweep: spool-refused: spool/${n} is not a regular file\n`);
  return { failed, refused: refused.length };
}

/** A draining file's whole text. It is opened O_NOFOLLOW|O_NONBLOCK and must be a regular file, so a link or a FIFO
 *  planted in .draining/ is refused rather than followed or waited on. It is also BOUNDED (D-4337,
 *  history-spool-file-size-cap): a file whose size is over SPOOL_FILE_MAX, by its descriptor's stat or by the bytes
 *  actually read, throws `SPOOL_OVERSIZE` before it is buffered, so no spool file can make a pass allocate its way past
 *  the unit's memory limit. A file within the byte cap but over SPOOL_FILE_LINES_MAX lines throws `SPOOL_OVERLINES`, so no
 *  spool file's line count can make a pass allocate past the unit's memory limit either. Every read of a draining file
 *  goes through here. An open or read that fails for any reason but ENOENT and ELOOP throws SPOOL_UNREADABLE (FU8, FP5): a
 *  mode-000 file, or one another uid owns, threw EACCES out of every drain and every hold. */
export function readDrainingText(path) {
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (e) { throw asDrainingReadError(e); }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw Object.assign(new Error('draining file is not a regular file'), { code: 'NON_REGULAR' });
    if (st.size > SPOOL_FILE_MAX) throw Object.assign(new Error('draining file is over SPOOL_FILE_MAX'), { code: 'SPOOL_OVERSIZE' });
    const chunks = [];
    let pos = 0;
    for (;;) {
      const b = Buffer.alloc(64 * 1024);
      const n = readSync(fd, b, 0, b.length, pos);
      if (n === 0) break;
      chunks.push(b.subarray(0, n));
      pos += n;
      if (pos > SPOOL_FILE_MAX) throw Object.assign(new Error('draining file grew past SPOOL_FILE_MAX'), { code: 'SPOOL_OVERSIZE' });   // it grew while it was read
    }
    const buf = Buffer.concat(chunks);
    // D-4337 (history-spool-file-size-cap, its line arm): counted on the bytes, before the text exists.
    if (spoolLinesOverCap(buf)) throw Object.assign(new Error('draining file is over SPOOL_FILE_LINES_MAX'), { code: 'SPOOL_OVERLINES' });
    return { text: buf.toString('utf8'), bytes: buf.length };
  } catch (e) {
    throw asDrainingReadError(e);
  } finally {
    closeSync(fd);
  }
}

/** The two sibling directories of `.draining/` that `setAside` moves a file into (D-4337, D-4346); `listDraining` lists neither. */
const OVERSIZE_DIR = 'oversize';
const REJECTED_DIR = 'rejected';
/** The sibling `.draining/planted/` that `tidyDraining` moves a planted directory into, one area per drain,
 *  `planted/<tickMs>.<pid>/` (D-4347 (history-planted-entries-never-wedge)); `listDraining` never lists it. */
const PLANTED_DIR = 'planted';

/** True when `name` in `.draining/` is a regular file over SPOOL_FILE_MAX by its lstat (D-4337, history-spool-file-size-cap):
 *  decided before any open, and before any observation (FU8, FPM7). No pass journals such a file, so an observation written
 *  for it would only leave a `journaled: null` sidecar, which status reads as a journal hold. False for a file within the
 *  cap, a link or a FIFO, which are not this function's. */
function overSpoolCap(home, name) {
  let st;
  try { st = lstatSync(`${historyPaths(home).draining}/${name}`); } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; }
  return st.isFile() && st.size > SPOOL_FILE_MAX;
}

/** Decide a draining file's oversize from its lstat BEFORE any open (D-4337, history-spool-file-size-cap): true when it
 *  is a regular file over SPOOL_FILE_MAX, which `setAside` has then moved aside or left for the next tick to count; the
 *  caller never journals it. False for a file that is not oversize, a link or a FIFO, which are not this function's. */
export function setAsideOversize(db, home, name) {
  if (!overSpoolCap(home, name)) return false;
  return setAside(db, home, name, OVERSIZE_DIR, 'spool_oversize');
}

/** The observation sidecar of a file over SPOOL_FILE_LINES_MAX, removed whenever a pass meets the file (FU8, FPM7). No pass
 *  journals such a file at its size, so its observation is never used, and a `journaled: null` sidecar left while its
 *  set-aside waits (a pass that only journals, or a move that fails) would read as a journal hold in status. Never throws. */
function dropOverlinesSidecar(home, name) {
  try { removeEntry(`${historyPaths(home).draining}/${sidecarName(name)}`); } catch { /* the set-aside, or the next pass, removes it */ }
}

/** Move `<from>/<name>` into the directory `dir`, made on demand (0700). A name at `dir` that is not a directory (a stray
 *  same-user writer's file, link or FIFO) is removed first and reported as `stray`, so a mkdir never fails EEXIST on every
 *  tick. Never throws: `moved` is false when anything failed (D-4347 (history-planted-entries-never-wedge)). */
function moveAside(dir, from, name) {
  let stray = false;
  try {
    stray = clearNonDirectory(dir);
    mkdirDurable(dir);
    renameSync(`${from}/${name}`, `${dir}/${name}`);
    return { moved: true, stray };
  } catch {
    return { moved: false, stray };
  }
}

/** True when an entry that is not a directory stood at `dir` and was removed (a stray same-user writer's file, link or
 *  FIFO), so a mkdir at or under `dir` never fails EEXIST or ENOTDIR on every tick. Throws what lstat or removeEntry throw. */
function clearNonDirectory(dir) {
  let ds;
  try { ds = lstatSync(dir); } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; }
  if (ds.isDirectory()) return false;
  removeEntry(dir);
  return true;
}

/** Set a draining file aside (D-4337, history-spool-file-size-cap): moved into the sibling directory
 *  `.draining/<sub>/` (0700, made on demand, the same filesystem, the name unchanged at its at-most-253 bytes, which a
 *  `<name>.oversize` rename would push past the 255-byte NAME_MAX), which `listDraining` never lists, so it is never
 *  journaled, drained or unlinked by the sweep (the operator removes it). Its observation sidecar, which nothing lists once
 *  the `.jsonl` is gone, is removed. `counter` is `spool_oversize` (over SPOOL_FILE_MAX, decided from its lstat by
 *  setAsideOversize) or `spool_overlines` (over SPOOL_FILE_LINES_MAX, decided by readDrainingText's count). The counter is
 *  bumped in a committed transaction FIRST and the file moved after, so a crash between the two may count a file twice and
 *  can never lose the count; a count that cannot commit, or a move that fails, leaves the file where it is for the next
 *  tick (recounted then: once per tick while the failure lasts, never a thrown tick). A name that is not a directory at
 *  `<sub>` is removed and counted `non_regular`. True on every path: the caller never journals the file.
 *  `sub` is OVERSIZE_DIR (counted spool_oversize or spool_overlines, D-4337) or REJECTED_DIR (counted drain_rejected,
 *  D-4346, history-permanent-failures-classified). */
export function setAside(db, home, name, sub, counter) {
  const P = historyPaths(home);
  if (!countFirst(db, counter)) return true;   // uncounted, so unmoved: the next tick meets it again and counts it then
  // A failed move (ENOENT: another actor took the file; ENOSPC, EACCES, EXDEV through a planted link) leaves the file
  // where it is and the tick goes on, never rethrown; the next tick meets it again and counts it again, one recount per
  // tick until the failure clears (FR4 round 1).
  const m = moveAside(`${P.draining}/${sub}`, P.draining, name);
  if (m.stray) countOutside(db, 'non_regular');
  if (m.moved) removeEntry(`${P.draining}/${sidecarName(name)}`);
  return true;
}

/** Set aside a draining file the store refused (D-4346, history-permanent-failures-classified). The file was journaled
 *  before its drain transaction ran, so its lines are in the journal and nothing is lost; it is moved into
 *  `.draining/rejected/`, which `listDraining` never lists, and counted `drain_rejected` before the move. A move that
 *  fails leaves it for the next tick, which recounts it. Only files the store refused for their own rows go here. */
export function setAsideRejected(db, home, name) { setAside(db, home, name, REJECTED_DIR, HEALTH_COUNTERS.drainRejected); }

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

/** `recall-off/<id>` as a Presence, read bounded: the file holds one generation (§9.7). ENOENT is absent; any
 *  other failure, a symlink or a non-regular file is unreadable. W1-B2 (Task 11). */
function recallOffPresence(home, id) {
  let fd;
  try {
    fd = openSync(recallOffPath(home, id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable' };
  }
  try {
    if (!fstatSync(fd).isFile()) return { state: 'unreadable' };
    const b = Buffer.alloc(128);
    const n = readSync(fd, b, 0, b.length, 0);
    return { state: 'value', value: b.subarray(0, n).toString('utf8').trim() };
  } catch {
    return { state: 'unreadable' };
  } finally {
    closeSync(fd);
  }
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
    // This is a live drain observation after line/registry generation joining; replay never re-observes controls.
    if (c.replay !== true && decideRecallOff({ file: recallOffPresence(c.home, rec.id), generation: g.generation }) === 'stale') bump(db, 'recall_off_stale');
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
  removeEntry(`${P.draining}/${sidecarName(name)}`);
  deleteOutbox(db, flushed.upto);
  return { hints };
}

/** While a file is held, re-read `.uuid` for its startup, resume and fork lines whose sid the observation did not name.
 *  Record the first time each is named (§9.14 Holds), so a session that /clears during a hold keeps its earlier
 *  startup epoch. */
export function recordHeldMatches(home, name, nowMs) {
  const P = historyPaths(home);
  const side = `${P.draining}/${sidecarName(name)}`;
  const had = readSidecar(side);
  if (had.state !== 'value') return;
  const obs = had.obs;
  const id = idOfDrainingName(name);
  const named = obs.uuid.state === 'value' ? obs.uuid.value : null;
  const waiting = spoolRecordsOf(readDrainingText(`${P.draining}/${name}`).text, id).valid
    .filter((v) => v.rec.ev === 'SessionStart' && (v.rec.src === 'startup' || v.rec.src === 'resume' || v.rec.src === 'fork')
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
  // FU8 (D-4347 (history-planted-entries-never-wedge)): no spool work through a spool/ that is not a real directory, as on
  // the drain (FP3); no DB holds a counter here (IV2), so it is only named.
  if (spoolRefused(home)) { process.stderr.write(SPOOL_REFUSED_LINE); return { held, journalFailed }; }
  if (spoolUnusable(home)) { process.stderr.write(SPOOL_UNUSABLE_LINE); return { held, journalFailed }; }
  // Rename first, so this pass's spool files are observed and journaled in this same pass (§9.2: "renames,
  // observes and journals each spool file as step 1 does"). A line a hook lands on the old inode after this
  // grows the file, and the next pass re-journals it under the same `t` (journalFile compares byte counts).
  if (renameAndObserve(home, nowMs, nowMs).failed) journalFailed = true;   // D-4338 (history-sidecar-write-failure-holds)
  const waiting = new Set();   // FU8 (FP5): an id whose earlier file could not be read waits behind it, as on the drain
  for (const name of listDraining(home)) {
    if (waiting.has(idOfDrainingName(name))) continue;
    // FU8 (FPM7): an oversize file is decided from its lstat before it is observed, as the drain decides it (D-4337), so no
    // sidecar of it reads `journaled: null` while the hold lasts.
    if (overSpoolCap(home, name)) continue;
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
      // D-4338 (history-sidecar-write-failure-holds): a sidecar that cannot be written is the journal failure; the file is held.
      if (e instanceof JournalError) { journalFailed = true; held.push(name); continue; }
      if (e && e.code === 'SPOOL_UNREADABLE') {
        // FU8 (FP5, FPM9): left in place with its sidecar, never a thrown pass; no DB holds a counter here (IV2), so it is named.
        process.stderr.write(`history-sweep: spool-unreadable: ${name}: ${e.reason}\n`);
        waiting.add(idOfDrainingName(name));
        continue;
      }
      // SPOOL_OVERSIZE or SPOOL_OVERLINES (D-4337): left where it is, unread. No DB holds a counter here (IV2), so the drain, which has one, sets
      // it aside and counts it when the hold ends. An over-lines file's sidecar, written just above, goes (FU8, FPM7).
      if (e && e.code === 'SPOOL_OVERLINES') { dropOverlinesSidecar(home, name); continue; }
      if (e && (e.code === 'ENOENT' || e.code === 'ELOOP' || e.code === 'NON_REGULAR' || e.code === 'SPOOL_OVERSIZE')) continue;
      throw e;
    }
  }
  return { held, journalFailed };
}

/** Tidy `spool/.draining/` before a drain lists it (D-4347 (history-planted-entries-never-wedge)). Returns what it
 *  counted, `nonRegular` entries and `malformed` sidecars (the caller bumps the counters; `journalHalf` never calls this,
 *  because no DB holds a counter there, IV2), the draining files it `displaced`, the draining files it found `blocked`, and the
 *  draining names it `kept`, and the draining files it `deferred` (FU8, FP6). `countBefore(counter)` commits one count and
 *  answers whether it did (drainSpool hands it `countFirst`): a displacement is counted through it BEFORE its move.
 *  - A directory is moved whole into this drain's own area, `.draining/planted/<tickMs>.<pid>/` (never recursed into,
 *    never deleted: a same-user process may have left content, or a mount, there). The area is new for each drain, so a
 *    name planted again never meets the one set aside before, and the name itself is unchanged (NAME_MAX, D-4303). One
 *    that cannot be moved (a 0500 directory, whose `..` a move must rewrite; a mount point) is rmdir'd when it is empty
 *    and not a mount point, and otherwise left in place.
 *  - Loop 1, the draining names: a regular file is live and stays. A directory is set aside as above; any other
 *    non-regular entry is removed. Each counts `non_regular` once per drain that meets it, and one left in place is
 *    `kept`: the drain skips it, so no sidecar is written for it (M17).
 *  - Loop 2, the observation sidecars and their temps: a directory is set aside as above and counted. One left at a live
 *    file's sidecar or sidecar-temp name would fail every sidecar write of that file (the rename onto it EISDIR, the
 *    O_EXCL open EEXIST), D-4338's hold, so the live file itself is moved into the area instead: `displaced`, never
 *    journaled by this drain (a hold pass may have journaled it already), its bytes kept, so one planted entry costs
 *    only that file's lines. The area is made first, then `spool_displaced` is committed (`countBefore`), then the file
 *    moves (FU8, FP6), so a kill or a failed commit never loses the count of a file that left the drain: a count that cannot
 *    commit leaves the file where it is, `deferred` (skipped by this drain like a blocked file, uncounted, for the next drain to
 *    count and move). When the live file cannot be moved either (the area cannot be made), the file is `blocked`:
 *    taken out of `live` so the arms after it treat its sidecar names as not live, and never `displaced`. The names are
 *    visited in sorted order, so `<stem>.obs` comes before `<stem>.obs.tmp` and a blocked file keeps its regular sidecar
 *    (FU6). Any other entry at a sidecar-temp name, or at the sidecar name of a file that is not live, is the sweep's own
 *    debris and is removed uncounted (F20). Any other non-regular entry at a live file's
 *    sidecar name is removed and counted `non_regular`; a sidecar of a live file that `readSidecar` answers `malformed` is
 *    removed and counted `sidecar_malformed`, and the next `observe` re-observes it (F9); one it answers `unreadable` is left
 *    in place, uncounted here (FU8, FPM9).
 *  - A non-directory at `.draining/planted` or at the area is removed and counted `non_regular` when a set-aside needs it.
 *  - An area a failed move left empty is removed at the end, so an entry met on every drain leaves no empty area behind.
 *  A step that fails is left for the next drain. */
export function tidyDraining(home, tickMs, pid, countBefore) {
  const P = historyPaths(home);
  const out = { nonRegular: 0, malformed: 0, displaced: [], blocked: [], kept: [], deferred: [] };
  let names;
  try { names = readdirSync(P.draining); } catch (e) { if (e && e.code === 'ENOENT') return out; throw e; }
  // FU6 (B3M10): loop 2 depends on this order. A file the blocked arm takes out of `live` keeps its regular sidecar only
  // when `<stem>.obs` is visited BEFORE `<stem>.obs.tmp` (a prefix sorts first); the other way round the orphan arm would
  // remove the sidecar of a file that is still there, and a hold pass's `journalT`/`journaled` in it with it. readdir's own
  // order is the filesystem's, so it is stated here, not assumed.
  names.sort();
  const typeOf = (n) => {
    let st;
    try { st = lstatSync(`${P.draining}/${n}`); } catch (e) { if (e && e.code === 'ENOENT') return 'gone'; throw e; }
    return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
  };
  const plantedRoot = `${P.draining}/${PLANTED_DIR}`;
  const area = `${plantedRoot}/${tickMs}.${pid}`;
  let planting = false;
  // The planted root's one initialisation, shared by `plant` and `areaReady` (FU10, B5M4): a non-directory at planted/ is
  // removed and counted once per drain. False when that throws; `planting` is set first, so later calls go on without retrying (unchanged).
  const rootReady = () => {
    if (planting) return true;
    planting = true;
    try { if (clearNonDirectory(plantedRoot)) out.nonRegular += 1; } catch { return false; }
    return true;
  };
  // Move `n` into this drain's area; true when it moved. Never throws.
  const plant = (n) => {
    if (!rootReady()) return false;
    const m = moveAside(area, P.draining, n);
    if (m.stray) out.nonRegular += 1;
    return m.moved;
  };
  // Make this drain's area (a non-directory at planted/ or at the area removed and counted first); true when it stands.
  // Never throws. A displacement asks this BEFORE its count, so no count is taken for a file that cannot move (FU8, FP6).
  const areaReady = () => {
    if (!rootReady()) return false;
    try { if (clearNonDirectory(area)) out.nonRegular += 1; mkdirDurable(area); return true; } catch { return false; }
  };
  // Set the directory `n` aside, or remove it when it cannot be moved and is empty; true when nothing stands at `n` now.
  const plantOrRemove = (n) => {
    if (plant(n)) return true;
    try { return removeEntry(`${P.draining}/${n}`) !== 'kept-dir'; } catch { return false; }
  };
  const live = new Set();
  for (const n of names) {                                   // loop 1: draining names
    if (parseDrainingName(n) === null) continue;
    let t;
    try { t = typeOf(n); } catch { continue; }               // left for the next drain; the drain loop's non-regular branch backs this
    if (t === 'file') { live.add(n); continue; }
    if (t === 'gone') continue;
    out.nonRegular += 1;
    let cleared = false;
    if (t === 'dir') cleared = plantOrRemove(n);
    else { try { removeEntry(`${P.draining}/${n}`); cleared = true; } catch { /* kept: met again next drain */ } }
    if (!cleared) out.kept.push(n);
  }
  for (const n of names) {                                   // loop 2: sidecars and sidecar temps
    const stem = n.endsWith('.obs.tmp') ? n.slice(0, -'.obs.tmp'.length) : n.endsWith('.obs') ? n.slice(0, -'.obs'.length) : null;
    if (stem === null || !drainingNameOk(`${stem}.jsonl`)) continue;
    const p = `${P.draining}/${n}`;
    const file = `${stem}.jsonl`;
    try {
      const t = typeOf(n);
      if (t === 'gone') continue;
      if (t === 'dir') {
        out.nonRegular += 1;
        if (!plantOrRemove(n) && live.has(file)) {
          live.delete(file);
          // D-4347 (history-planted-entries-never-wedge): when neither the entry nor its file can move, the file is `blocked`: the
          // drain skips it, never holds on it. FU8 (FP6): `spool_displaced` is committed before the move, as setAside's counts are.
          if (!areaReady()) out.blocked.push(file);
          else if (!countBefore(HEALTH_COUNTERS.spoolDisplaced)) out.deferred.push(file);
          else if (plant(file)) out.displaced.push(file);
          else out.blocked.push(file);
        }
        continue;
      }
      // D-4347 (history-planted-entries-never-wedge): a sidecar temp is always stale at a drain's start (writeSidecar
      // renames it within one call, under the lock), and a sidecar whose draining file is not a live regular file is an
      // orphan (a kill between the file's removal or move and its sidecar's, or a file this drain displaced);
      // `listDraining` lists only `*.jsonl`, so nothing else would ever remove either. Both are the sweep's own debris:
      // removed uncounted.
      if (n.endsWith('.obs.tmp') || !live.has(file)) { removeEntry(p); continue; }
      if (t === 'other') { out.nonRegular += 1; removeEntry(p); continue; }
      // FU8 (FPM9): only a sidecar whose content is no observation is removed and counted; one that cannot be read now is
      // left, uncounted here, because it may hold the file's rename-time observation: the drain skips the file (spool_unreadable).
      if (readSidecar(p).state === 'malformed') { removeEntry(p); out.malformed += 1; }
    } catch { /* left for the next drain */ }
  }
  if (planting) { try { removeEntry(area); } catch { /* an area left behind is met by the next set-aside's own area */ } }
  return out;
}

/** Step 1 with an open store: every draining file in journaling order, each journaled then drained; then this tick's
 *  renames. Returns the sids of the fresh lines (discovery's hints).
 *  - A journal failure stops here, and so does a busy or locked commit (the rest wait, in order, so no id's later file
 *    drains before its earlier one); a commit the store refused for the file's own rows sets that journaled file aside
 *    into `.draining/rejected/` and the drain goes on; any other SQLite failure ends the tick (D-4346,
 *    history-permanent-failures-classified).
 *  - A link or FIFO planted in .draining/ is removed and counted. A draining name tidyDraining `kept` is skipped, and a
 *    file it `displaced` was counted `spool_displaced` before its move and is named on stderr (D-4347
 *    (history-planted-entries-never-wedge); FU8, FP6), and one it `deferred` (that count could not commit) is skipped like a
 *    blocked file, uncounted and unnamed, its id waiting behind it, for the next drain. A file
 *    it found `blocked` (its sidecar name is blocked and it could not move) is counted `spool_blocked`, named on stderr and
 *    skipped like a kept name: never journaled by this drain, left in place, retried by the next drain's tidy, and every later
 *    file of another id drains. The blocked file's own id's later files wait behind it, so the epoch chain, which numbers in
 *    drain order, never inverts when the block lifts (FU3F review F1).
 *  - A file whose bytes or sidecar cannot be read on this drain (SPOOL_UNREADABLE) is skipped the same way, counted
 *    `spool_unreadable` and named on stderr as `history-sweep: spool-unreadable: <name>: <reason>` (FU8, FP5, FPM9).
 *  - A node at a spool file's name that is not a regular file (a FIFO, a link, a directory: D-4418) is never renamed, read or
 *    followed; renameAndObserve names it on stderr as it returns, after its renames and their observations. A drain whose
 *    loop ends without throwing (a `break` included) counts it `non_regular` once renameAndObserve returns (FR2c, F3).
 *    A drain whose loop throws leaves that count out: its journal half renames and observes in the drain's place and, as
 *    that returns, names the node on stderr and does not count it (D-4418; review 351 F2). A throw out of those renames
 *    or observations, or one before the loop, names and counts nothing. */
export function drainSpool(db, c) {
  const tickMs = c.now();
  // FU8 (D-4347 (history-planted-entries-never-wedge)): no spool work through a spool/ that is not a real directory (FP3):
  // counted and named once per drain, and the tick goes on without it.
  if (spoolRefused(c.home)) {
    countOutside(db, 'non_regular');
    process.stderr.write(SPOOL_REFUSED_LINE);
    return [];
  }
  // FU8: nor through a spool/ or .draining this user cannot use; uncounted, because status names its mode (mode-wrong).
  if (spoolUnusable(c.home)) { process.stderr.write(SPOOL_UNUSABLE_LINE); return []; }
  if (ensureSpoolDirs(c.home)) countOutside(db, 'non_regular');
  const t = tidyDraining(c.home, tickMs, process.pid, (counter) => countFirst(db, counter));
  if (t.nonRegular > 0) countOutside(db, 'non_regular', t.nonRegular);
  if (t.malformed > 0) countOutside(db, 'sidecar_malformed', t.malformed);
  // FU8 (FP6): each displaced file was counted `spool_displaced` by tidyDraining before its move.
  for (const n of t.displaced) process.stderr.write(`history-sweep: spool-displaced: ${n}\n`);
  if (t.blocked.length > 0) {
    countOutside(db, HEALTH_COUNTERS.spoolBlocked, t.blocked.length);
    for (const n of t.blocked) process.stderr.write(`history-sweep: spool-blocked: ${n}\n`);
  }
  const kept = new Set([...t.kept, ...t.blocked, ...t.deferred]);
  const waitsBehind = new Set([...t.blocked, ...t.deferred]);   // FU8 (FP6): a deferred file holds its id as a blocked one does
  const blockedIds = new Set();   // D-4347 (history-planted-entries-never-wedge): an id with a blocked file waits behind it, in order (FU3F review F1)
  const hints = [];
  let failedCounted = false;
  // FU8 (FPM8): a throw out of the loop is held until the journal half has run for the rest of this tick (below).
  let thrown = null;
  try {
    for (const name of listDraining(c.home)) {
      if (kept.has(name)) {   // D-4347 (history-planted-entries-never-wedge): counted once by tidyDraining, never observed (M17)
        if (waitsBehind.has(name)) blockedIds.add(idOfDrainingName(name));
        continue;
      }
      // The epoch chain numbers in drain order, so a blocked file's later same-id files must not drain before it (they would invert the chain once it drains).
      // A kept name, or a displaced file (which never drains), loses lines but never reorders, so only a blocked file holds its id.
      if (blockedIds.has(idOfDrainingName(name))) continue;
      // D-4337 (history-spool-file-size-cap): an oversize file is decided from its stat and never opened.
      if (setAsideOversize(db, c.home, name)) continue;
      let j;
      try {
        j = journalFile(c.home, c.ids, name, c.now());
      } catch (e) {
        if (e instanceof JournalError) { countOutside(db, 'journal_write_failed'); failedCounted = true; break; }
        if (e && e.code === 'SPOOL_OVERSIZE') {   // it grew between the stat and the read
          setAsideOversize(db, c.home, name);
          continue;
        }
        if (e && e.code === 'SPOOL_OVERLINES') {   // D-4337's line arm: decided by readDrainingText's count, never by a stat
          dropOverlinesSidecar(c.home, name);    // FU8 (FPM7): first, so a set-aside that cannot move leaves no `journaled: null` sidecar
          setAside(db, c.home, name, OVERSIZE_DIR, 'spool_overlines');
          continue;
        }
        if (e && (e.code === 'ELOOP' || e.code === 'NON_REGULAR')) {
          // journalFile observed before it read, so the planted name has a sidecar too. listDraining lists only
          // `*.jsonl`, so a sidecar left here would never be removed.
          // D-4347 (history-planted-entries-never-wedge): type-aware and never thrown; a race that tidyDraining (which runs first) did not meet is met again next drain.
          try {
            removeEntry(`${historyPaths(c.home).draining}/${name}`);
            removeEntry(`${historyPaths(c.home).draining}/${sidecarName(name)}`);
          } catch { /* left for the next drain: tidyDraining meets it first */ }
          countOutside(db, 'non_regular');
          continue;
        }
        if (e && e.code === 'SPOOL_UNREADABLE') {
          // FU8 (FP5, FPM9; D-4347 (history-planted-entries-never-wedge)): skipped for this pass like a blocked file, never a
          // thrown pass: left in place with its sidecar, read again by the next drain, and its own id's later files wait behind it.
          countOutside(db, HEALTH_COUNTERS.spoolUnreadable);
          process.stderr.write(`history-sweep: spool-unreadable: ${name}: ${e.reason}\n`);
          blockedIds.add(idOfDrainingName(name));
          continue;
        }
        if (e && e.code === 'ENOENT') continue;
        throw e;
      }
      try {
        hints.push(...drainFile(db, c, name, j.obs, j.text).hints);
      } catch (e) {
        if (e instanceof JournalError) { countOutside(db, 'journal_write_failed'); failedCounted = true; break; }
        if (e && e.code === 'ERR_SQLITE_ERROR') {
          // D-4346 (history-permanent-failures-classified): lib decides from the result code, never every SQLite error as a busy commit.
          const arm = decideDrainFailure(e.errcode);
          if (arm === 'defer') { countOutside(db, 'drain_deferred'); break; }
          if (arm === 'reject') {
            process.stderr.write(`history-sweep: drain-rejected: ${name}: ${e.message}\n`);
            setAsideRejected(db, c.home, name);
            continue;
          }
        }
        throw e;   // 'fail': the store itself failed; the tick ends with it, as ingest's SQLite errors do (D-4340)
      }
    }
  } catch (e) {
    thrown = e;
  }
  if (thrown !== null) {
    // FU8 (FPM8): the drain could not finish (D-4346's 'fail' arm: FULL, IOERR, CORRUPT, a foreign trigger; or any other throw),
    // so the rest of this tick is the journal half's, as a hold's is (§9.2: "the journal half runs whenever the drain cannot"):
    // this tick's spool files are renamed and observed (D-4232), and every draining file the loop did not reach is journaled. So,
    // for a failure the drain meets, no id's spool file grows toward SPOOL_FILE_LINES_MAX while it lasts, and no renamed file
    // waits with a `journaled: null` sidecar that status would read as a journal hold. Its renames take a later tick than every
    // file the loop met, so the journaling order holds. The loop's error is thrown after it, and an error of the journal half
    // never replaces it. A store failure thrown at a write the pass makes before the drain (the migration verdict's meta write,
    // the secrets step or the FTS probe, among others) ends the pass before drainSpool, so this half never runs for it; a
    // journal-append failure at an outbox flush is counted and the pass goes on to the drain (FR2a, review 344 F5).
    try {
      // failedCounted is always false here: the loop sets it only right before a `break`, and countOutside never throws.
      if (journalHalf(c.home, c.ids, c.now()).journalFailed) countOutside(db, 'journal_write_failed');
    } catch { /* the loop's error is the one this tick reports */ }
    throw thrown;
  }
  // D-4338 (history-sidecar-write-failure-holds): a failed observation of this tick's renames is the same hold,
  // counted once for the tick; the renamed files wait without a sidecar and are observed at their next journaling.
  const renamed = renameAndObserve(c.home, tickMs, c.now());
  // Every remaining file is intentionally unread (newly renamed or held), so it may carry a steer receipt. Only a
  // complete census may narrow that uncertainty to bounded session UUID candidates for derivation.
  const sessionUuids = new Set();
  const names = listDraining(c.home, true);
  if (names !== null) {
    const receiptEpochStmts = tickStmts(db);
    for (const name of names) {
      const id = idOfDrainingName(name);
      for (const { u } of receiptEpochStmts.epochsOfId.all(id)) sessionUuids.add(u);
      const current = readRegUuid(c.home, id);
      if (current !== null) sessionUuids.add(current);
    }
    c.pendingReceiptState = { kind: 'measured', sessionUuids };
  }
  if (renamed.failed && !failedCounted) countOutside(db, 'journal_write_failed');
  // D-4418 (history-spool-append-regular-file-only), FR2c (review 344 F3): each node the hook refuses at spool/<id>.jsonl,
  // counted once per drain whose loop ends without throwing (a `break` included) and whose renameAndObserve returned, as
  // D-4347's planted entries are; renameAndObserve named it as it returned. A drain whose loop throws never reaches this
  // line: the journal half above named the node on stderr as its own renameAndObserve returned, and did not count it, so
  // that drain's count is left out (review 351 F2).
  if (renamed.refused > 0) countOutside(db, 'non_regular', renamed.refused);
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
  // W1-B2 (Task 9): nodes follow their epochs (slug history-rekey-merges). A merge keeps every epoch and only
  // renumbers its seq. So every node of either family re-points to (toPk, the seq its transcript's epoch now
  // has); node ids never change (§6.1), and a parent never spans two epochs. A node whose transcript is in no
  // epoch of (id, G) cannot be placed. The derivation never makes one, but a damaged table could: it stays where
  // it is and is counted nodes_unrepointed. This runs inside the caller's transaction, like the rest of the merge.
  const epochOfNode = 'SELECT e.seq FROM epochs e JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid '
    + 'WHERE t.transcript_pk = nodes.transcript_pk AND e.session_pk = ?';
  db.prepare(`UPDATE nodes SET session_pk = ?, epoch_seq = (${epochOfNode}) WHERE session_pk IN (?, ?) AND EXISTS (${epochOfNode})`)
    .run(toPk, toPk, fromPk, toPk, toPk);
  const stranded = Number(db.prepare('SELECT count(*) AS n FROM nodes WHERE session_pk = ?').get(fromPk).n);
  if (stranded > 0) bump(db, 'nodes_unrepointed', stranded);
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
 *  that file, as Task 17's did; it never fails the tick (D-4298, slug history-first-row-read-error-skips-file).
 *  `cache` is the tick's newFirstRowCache (F16); null walks per lookup. */
export function firstUuidRowCwd(homes, userHome, uuid, cache = null) {
  if (cache !== null && cache.cwd.has(uuid)) return cache.cwd.get(uuid);
  const files = cache === null ? discoverTranscripts(homes, [uuid]) : indexedTranscripts(cache, homes, uuid);
  for (const f of files) {
    const a = admitFile(f.path, f.home, homes, userHome);
    if (!a.ok) continue;
    try {
      const cwd = firstUuidRowCwdOf(a.fd);
      if (cwd !== undefined) {
        if (cache !== null) cache.cwd.set(uuid, cwd);
        return cwd;
      }
    } catch {
      continue;   // a read that fails on an admitted file: this file cannot place the epoch, the next may (Task 17's rule kept)
    } finally {
      closeSync(a.fd);
    }
  }
  // nothing admitted and read: never remembered, so the next lookup this tick asks again (D-4298, D-4340: unreadable is not absent)
  return null;
}

/** A clear epoch confirms by location when its transcript's first uuid row's cwd resolves to the observed `.workdir`:
 *  both realpaths when both resolve, otherwise the verbatim strings (§6.1; D-4191, slug history-epoch-cwd-real). */
function locationConfirms(c, uuid, workdir) {
  if (workdir.state !== 'value') return false;
  const cwd = firstUuidRowCwd(c.homes, c.home, uuid, c.firstRows ?? null);
  if (cwd === null) return false;
  return locationMatches({ cwd, cwdReal: realOrNull(cwd), workdir, workdirReal: realOrNull(workdir.value) });
}

/** One SessionStart line, inside its file's drain transaction. Returns its verdict lines.
 *  - startup/resume, and fork from W1-B2 (D-4734 (`history-fork-spooled`)): confirmed by its own reg, by the observed `.uuid`, or by a first match while held. Otherwise it
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
 *  - A startup, resume or fork candidate confirms when `.uuid` names its sid. A gen-less one joins the generation the
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
 *  transaction before any ingest chunk can need it, and flushed. On a W1-B1 build a forked session entered only this way; from W1-B2 its fork line chains it, and a fork line whose uuid a scan chained first confirms that epoch (ruled Q16). A uuid this id's `''` family
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
    mapRegistryUuid(db, c, { id, uuid, declaredBy: 'registry', path: null, nowMs, obs }, (fn) => { verdictTx(db, c, fn); });
  }
}

/** The per-uuid registry mapping core: ONE definition, called by `registryBackfill` and by `--op import`'s
 *  registry/journal-evidence path and operator form (`commitMapping`), so the two never apply different rules
 *  (Task 26F item 1; D-4297, D-4193).
 *  - `m` is {id, uuid, declaredBy, path, nowMs, obs}: `obs` is `readObservation`'s answer for the id, so the family's
 *    generation and project are read through `joinFamily`/`joinGeneration` — an absent `.generation` is counted
 *    family_gen_absent, an unreadable or malformed one family_gen_unreadable, never folded into one another or
 *    into `''` uncounted (IV5, D-4193).
 *  - A clear epoch this id still holds UNCONFIRMED is confirmCandidates' to decide, or to drop past 7 days (IV4, spec
 *    §6.1; D-4297, slug history-backfill-skips-unconfirmed-epoch): a registry or journal mapping must not confirm it,
 *    so it answers 'skipped' and writes nothing. Scoped to this id, so another family's planted unconfirmed clear
 *    line still blocks nobody (chainEpoch's doc). The OPERATOR (`declaredBy` 'operator') is the one exception: an
 *    operator naming the file is itself the confirmation (Q19), so that mapping is never skipped.
 *  - Otherwise the family is joined and the epoch chained with cause `import`, inside `run`, the caller's own
 *    transaction wrapper (`fn` returns the verdict records it queued). Answers
 *      'refused'  another family holds the uuid confirmed (first claim wins, counted uuid_two_sessions): nothing chained;
 *      'already'  this family holds it confirmed: chained nothing, queued no verdict;
 *      'mapped'   the epoch was chained or confirmed now, and its `mapping` verdict queued.
 *    plus the family it joined. */
function mapRegistryUuid(db, c, m, run) {
  const { id, uuid, declaredBy, path: filePath, nowMs, obs } = m;
  if (declaredBy !== 'operator' && db.prepare('SELECT 1 AS x FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? AND s.ccrc_id = ? AND e.confirmed_ms IS NULL LIMIT 1').get(uuid, id) !== undefined) {
    return { outcome: 'skipped', family: null };
  }
  let outcome = 'already';
  let family = null;
  run(() => {
    const out = [];
    const v = (kind, fields) => { out.push(verdictRecord(nowMs, 'none', kind, fields)); };
    family = joinFamily(db, c, {
      ccrcId: id, lineGen: null, observedGen: obs.generation, observedProject: obs.project, uuid, v, joinVerdict: false,
    });
    const r = chainEpoch(db, family.sessionPk, uuid, 'import', declaredBy, nowMs);
    if (r === null) {
      outcome = 'refused';
    } else if (r.created || r.confirmedNow) {
      outcome = 'mapped';
      db.prepare(DELETE_CANDIDATE).run(uuid, id);
      v('mapping', { ccrc_id: id, generation: family.generation, cc_session_uuid: uuid, declared_by: declaredBy, ...(filePath ? { path: filePath } : {}) });
    }
    return out;
  });
  return { outcome, family };
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
// filesystem reports one, and its first line's sha where it does not (D-4235; slugs history-cursor-per-inode,
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
 *  - it opens O_NOCTTY, so a terminal reached through a directory link under the roots never becomes the pass's
 *    controlling terminal (fix round 1, M22);
 *  - it is a regular file;
 *  - its realpath lies under one of the rostered projects/ roots.
 *  `missing` and `unreadable` are kept apart from `non_regular` and `outside-roots`, never folded. On `ok` the caller
 *  owns `fd` and must close it. */
export function admitFile(p, home, homes, userHome) {
  if (!homes.includes(home) || !underClaudeGlob(home, userHome)) return { ok: false, why: 'outside-roots' };
  let fd;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
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

/** Every `<home>/projects/<slug>/<name>.jsonl` under the rostered homes, in ONE order (homes as given, slugs and names
 *  sorted): take({path, uuid, home}) for each, uuid the name's stem. A projects/ or slug directory that cannot be listed
 *  is skipped, as discoverTranscripts always skipped it. discoverTranscripts and the location rule's per-tick index
 *  both walk through it (review 316 F16). */
function walkTranscripts(homes, take) {
  for (const home of homes) {
    let slugs;
    try { slugs = readdirSync(`${home}/projects`).sort(); } catch { continue; }
    for (const slug of slugs) {
      let names;
      try { names = readdirSync(`${home}/projects/${slug}`).sort(); } catch { continue; }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        take({ path: `${home}/projects/${slug}/${n}`, uuid: n.slice(0, -'.jsonl'.length), home });
      }
    }
  }
}

/** `<home>/projects/*\/<uuid>.jsonl` for every wanted uuid, across the rostered homes the shim passed. Paths come
 *  from directory entries, never from a uuid spliced into a path. A home with no projects/ is skipped silently. */
export function discoverTranscripts(homes, uuids) {
  const want = new Set(uuids);
  const out = [];
  if (want.size === 0) return out;
  walkTranscripts(homes, (t) => { if (want.has(t.uuid)) out.push(t); });
  return out;
}

/** The location rule's memory for ONE tick (review 316 F16): `index`, every `<stem>.jsonl` under the rostered homes by
 *  stem, from one walk made at the tick's first lookup; `cwd`, each uuid's first-row cwd once an ADMITTED file was
 *  READ. tick() makes a fresh one before the drain; a caller with none walks per lookup, as before. */
export function newFirstRowCache() { return { index: null, cwd: new Map() }; }

/** This uuid's transcripts from the tick's one walk. A miss is "not seen this tick", never "absent": the only
 *  consequence is a clear epoch left unconfirmed with its candidate row, which confirmClear tries again next tick with
 *  a fresh walk (§6.1, D-4189). Re-walking per miss would bring back F16's cost whenever one directory is unlistable,
 *  and it would see no more than the walk did: that directory fails the same way. */
function indexedTranscripts(cache, homes, uuid) {
  if (cache.index === null) {
    const index = new Map();
    walkTranscripts(homes, (t) => { const l = index.get(t.uuid); if (l === undefined) index.set(t.uuid, [t]); else l.push(t); });
    cache.index = index;
  }
  return cache.index.get(uuid) ?? [];
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

// ── The recovery step (spec §9.14 "Recovery: one step for --restore and --rebuild"; §9.2; W1-B2) ──────────────
//
// `doctor --restore` and `doctor --rebuild` register ONE derivation step, ('recover', <bind ms>), inside the store
// before it is linked (store.mjs; slug history-binding-facts-before-link).
//
// While that step is registered, and once the store is at this build's version (planRun decides the migration
// first, §6.11), a scheduled pass runs (recoverPass's doc comment is the authority for the order):
//   1. the outbox;
//   2. the migration verdict;
//   3. the secrets, with the pass's belt;
//   4. the FTS probe (ftsPrepare);
//   5. the phrase re-index and the hash re-derivation, in one slice of the run budget (reindexForValues,
//      rederiveFts);
//   6. this step, within the run budget;
//   7. meta recover_unmoved_ticks and a ticks row;
//   8. the journal half (D-4224).
// The drain and the ingest wait, and no ingest cursor moves, so replayed epochs keep their order before new ones.
// Every writing --op form but restore and rebuild is refused `recovering` meanwhile, by lib's decideOpGate as Task
// 19's runOpPass measures it (RB6; D-4698 (history-ops-refused-while-recovering)), so no operator verb moves a cursor
// either. Three exemptions move none: W2's recall-off (RB12), migrate on a store not yet at this build's version,
// which the step waits for (RB13), and adopt on an unbound store, which no pass opens until it is bound (RB14). A dry
// run and a read verb still answer.
//
// The step walks the phases lib's RECOVER_PHASES names, each run by RECOVER_EXECUTORS:
//   index    Reads every journal file of this store, in lib orderJournalFiles' order. Each `redact` record goes
//            into redact_hashes, before any blob is replayed or indexed (D-4241). A restore has already
//            put every one of them into its copy before the link (journalRedactPairs, store.mjs's commitRestore;
//            spec §8.4 and §9.14) and started the cursor `+pairs` when that added any, so
//            here they insert nothing and the reindex phase still runs. Each
//            drain-time verdict goes into a scratch table by event_key, and each `drained` record by file
//            (D-4725 (history-recovery-scratch-tables)).
//   apply    Reads the same records again through lib replayStep (D-4699 (history-recovery-replay)):
//            - a receipt is applied with its drain-time verdicts, at the spool record's own position;
//            - a verdict with no event_key is applied at its own position;
//            - a spool record of a file with no `drained` record is skipped (D-4230),
//              and counted journal_spool_undrained_gone only when B1 keeps its file nowhere: not in .draining/,
//              .draining/rejected/ (D-4346) or .draining/planted/<area>/
//              (D-4347); a set-aside file is kept (D-4728 (history-replay-keeps-set-aside-files)).
//            It never reads $REG and writes no journal record.
//   reindex  W1-B2 Task 29's FTS re-derivation, for pairs the index pass added. A no-op until then.
//   export-blobs  W1-B4, between apply and reindex: every segment's blobs, insert-or-ignore by sha256, before any
//                 segment's rows, so no row waits on a blob in a later segment (§9.14 "Export replay").
//   export-rows   W1-B4: every segment's rows in (seq, writer) order, filling only what the journal lacks
//                 (B2's D-4700 (history-b4-after-b2)).
//
// THE CURSOR is lib's RecoverCursor, kept in derivation_state.cursor. It advances in the SAME transaction as the
// records it covers, so a kill never re-applies or skips a chunk (DI4). Within a phase it names the first file of the
// current replay group and a position in it:
//   - for a group of one file, a byte offset;
//   - for a merge group of several (two writers whose files overlap in time, against §6.9's rule), the ordinal of
//     the next record in their time-merged order.
// A chunk stops only before a record that is not a `spool` record, so a file's spool records never part from their
// `file` record across two passes.
//
// Before every chunk, the step checks the run budget, history-off and the free-space floor (§9.3):
//   - low disk pauses the step and counts capture_paused_low_disk, never recovery-stalled;
//   - a chunk that throws rolls back, counts recover_chunk_failed and ends the step for this pass with its cursor
//     unmoved, and so does a stored cursor lib's grammar refuses (never a silent restart);
//   - so does a journal file the step cannot read (EACCES, EIO) and a spool answer it cannot measure: recovery never
//     completes past journal data it could not read (D-4592 (history-recover-unreadable-journal-fails-the-chunk));
//   - an executor that answers neither a moved cursor nor a finished phase ends the step for this pass too.
//   A step that cannot progress reaches doctor's recovery-stalled through meta recover_unmoved_ticks
//   (D-4727 (history-recovery-chunk-failure-counted)).

const RECOVER_ROW_SQL = "SELECT version, cursor FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL ORDER BY version DESC LIMIT 1";
const RECOVER_CURSOR_SQL = "UPDATE derivation_state SET cursor = ? WHERE step = 'recover' AND version = ?";
const RECOVER_DONE_SQL = "UPDATE derivation_state SET cursor = ?, completed_ms = ? WHERE step = 'recover' AND completed_ms IS NULL AND version <= ?";
/** The index pass's results, which must survive the several passes a large replay spans; schema v1 has no table for
 *  them. Made by the step and dropped when it completes, as the FTS tables are made by derivation: never part of a
 *  schema version (D-4725 (history-recovery-scratch-tables)). A duplicate verdict line (an outbox appended twice after a
 *  crash, §9.14) is indexed once. */
const RECOVER_SCRATCH_DDL = Object.freeze([
  'CREATE TABLE IF NOT EXISTS recover_verdicts (seq INTEGER PRIMARY KEY, event_key TEXT NOT NULL, rec TEXT NOT NULL, UNIQUE (event_key, rec))',
  'CREATE TABLE IF NOT EXISTS recover_drained (file TEXT PRIMARY KEY)',
]);
const RECOVER_SCRATCH_TABLES = Object.freeze(['recover_verdicts', 'recover_drained']);
const RECOVER_VERDICT_INSERT = 'INSERT INTO recover_verdicts (event_key, rec) VALUES (?, ?) ON CONFLICT (event_key, rec) DO NOTHING';
const RECOVER_VERDICTS_AT = 'SELECT rec FROM recover_verdicts WHERE event_key = ? ORDER BY seq';
const RECOVER_DRAINED_INSERT = 'INSERT INTO recover_drained (file) VALUES (?) ON CONFLICT (file) DO NOTHING';
const RECOVER_DRAINED_HAS = 'SELECT 1 AS x FROM recover_drained WHERE file = ?';
const RECOVER_REDACT_INSERT = 'INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?) ON CONFLICT (len, sha256) DO NOTHING';
const RECOVER_RECEIPT_INSERT = 'INSERT INTO spool_receipts (event_key, payload_sha, received_ms, ts_ms, ts_source) VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_key) DO NOTHING';
const RECOVER_TICK_INSERT = 'INSERT INTO ticks (ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, 0, 0, 0)';
/** One read of a journal file while replaying it. */
const RECOVER_READ = 1 << 20;
/** journal/<store_id>/<YYYY-MM>.<writer>.jsonl, B1's month files: never the dot-named temps a month file is linked
 *  from (B1 Task 15). The month is 01-12, as lib's cursor grammar reads it, so a listed file can always be a cursor's
 *  file. */
const JOURNAL_NAME_RE = /^([0-9]{4}-(?:0[1-9]|1[0-2]))\.([0-9a-f]{8})\.jsonl$/;
const JOURNAL_HEAD_PROBE = 4096;
const JOURNAL_TAIL_PROBE = 64 * 1024;
/** The observation replay decides a verdict-less epoch line with: nothing read from $REG, ever (§9.14). Under it,
 *  decideEpochLine confirms only a line whose own `reg` names its sid. */
const NO_OBSERVATION = Object.freeze({
  v: 1,
  observedMs: 0,
  uuid: Object.freeze({ state: 'absent' }),
  generation: Object.freeze({ state: 'absent' }),
  project: Object.freeze({ state: 'absent' }),
  workdir: Object.freeze({ state: 'absent' }),
  journaled: null,
  heldMatches: Object.freeze({}),
});

/** Whether a restore or a rebuild registered a recovery step that has not completed: planRun's `recovering` input. */
export function isRecovering(db) {
  return db.prepare(RECOVER_ROW_SQL).get() !== undefined;
}

/** The first non-empty line of the open file `fd` (`size` bytes), whole, or '' when the file holds none. It reads
 *  JOURNAL_HEAD_PROBE bytes at a time: leading newlines are skipped however many, and a line is read to its newline or the
 *  end of the file (H-177). The read is unbounded by design, as fileLines' and planReplay's are. */
function firstNonEmptyLine(fd, size) {
  const piece = Buffer.alloc(JOURNAL_HEAD_PROBE);
  const parts = [];
  let started = false;
  for (let pos = 0; pos < size;) {
    const n = readSync(fd, piece, 0, Math.min(JOURNAL_HEAD_PROBE, size - pos), pos);
    if (n <= 0) break;
    pos += n;
    let from = 0;
    if (!started) {
      while (from < n && piece[from] === 0x0a) from += 1;
      if (from === n) continue;
      started = true;
    }
    const end = piece.subarray(from, n).indexOf(0x0a);
    if (end !== -1) {
      parts.push(Buffer.from(piece.subarray(from, from + end)));
      break;
    }
    parts.push(Buffer.from(piece.subarray(from, n)));
  }
  return Buffer.concat(parts).toString('utf8');
}

/** A journal file's ends, measured as Task 7's planReplay measures a file (which the executor must agree with). Three
 *  answers besides the ends, never folded into one null (D-4592 (history-recover-unreadable-journal-fails-the-chunk);
 *  the "no overloaded null at a seam" rule): recovery never completes past journal data it could not read.
 *  - `{ kind: 'ends', headT, headStore, lastT }`:
 *    - `headT` and `headStore` from a first line that is a `head` record, both null when it is not one. Such a file is
 *      kept and sorts last in its month, alone, as planReplay keeps it;
 *    - `lastT`, the latest record time in the last JOURNAL_TAIL_PROBE bytes (the head's own time included). B1's
 *      writer appends in time order, so the tail holds the file's latest record.
 *  - `{ kind: 'gone' }`: the name vanished between the listing and the open (ENOENT). It is listed nowhere.
 *  - `{ kind: 'foreign' }`: the name is a link (O_NOFOLLOW meets it: ELOOP) or no regular file, which no writer in the
 *    tree makes. It is never replayed, and counted journal_head_mismatch with the files whose head names another store.
 *    A socket or a device node fails the open (ENXIO, ENODEV, EISDIR) before any fstat could say what it is, so an open
 *    error that is none of the above asks lstat what stands at the name (H-92): no regular file is foreign.
 *  - `{ kind: 'unreadable' }`: any other open or read error (EACCES, EIO, ...) on a name that is, or cannot be shown not
 *    to be, a regular file. The file may hold journal data, so the step fails its chunk and a later tick retries it. */
function journalEnds(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { kind: 'gone' };
    if (e && e.code === 'ELOOP') return { kind: 'foreign' };
    // Any other open error: what stands at the name decides, not the errno. A socket fails ENXIO and a device ENODEV, and
    // neither is journal data an unreadable file might hold; only a name that is (or cannot be shown not to be) a
    // regular file is unreadable.
    try {
      return lstatSync(path).isFile() ? { kind: 'unreadable' } : { kind: 'foreign' };
    } catch (le) {
      return le && le.code === 'ENOENT' ? { kind: 'gone' } : { kind: 'unreadable' };
    }
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { kind: 'foreign' };
    if (st.size === 0) return { kind: 'ends', headT: null, headStore: null, lastT: null };
    // The first NON-EMPTY line, as lib planReplay reads the head (H-96): a leading blank fence is skipped by both, so a
    // file the plan drops for a foreign head is never kept and replayed by the executor. It is read WHOLE, however many
    // blank bytes lead it and wherever it ends (H-177): the read goes on until its newline or the end of the file,
    // as planReplay's and fileLines' reads do, so the two never disagree about a head that starts or ends past a probe.
    const first = parseJournalRecord(firstNonEmptyLine(fd, st.size));
    const head = first.kind === 'record' && first.rec.k === 'head' ? first.rec : null;
    const tailLen = Math.min(JOURNAL_TAIL_PROBE, st.size);
    const tailBuf = Buffer.alloc(tailLen);
    readSync(fd, tailBuf, 0, tailLen, st.size - tailLen);
    let lastT = head === null ? null : head.t;
    for (const line of tailBuf.toString('utf8').split('\n')) {
      if (line === '') continue;
      const p = parseJournalRecord(line);
      if (p.kind === 'record') lastT = lastT === null ? p.rec.t : Math.max(lastT, p.rec.t);
    }
    return { kind: 'ends', headT: head === null ? null : head.t, headStore: head === null ? null : head.store_id, lastT };
  } catch (e) {
    return e && e.code === 'ENOENT' ? { kind: 'gone' } : { kind: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

/** This store's journal files, measured for lib orderJournalFiles, in three lists:
 *  - `files`: the listed files. A file with no head is kept;
 *  - `foreign`: a file whose head names another store, or a name that is a link or no regular file. Never replayed, and
 *    counted journal_head_mismatch once when the index phase ends, as planReplay drops and counts it;
 *  - `nonRegular`: the names in `foreign` that are a link or no regular file (journalEnds kind `foreign`), a subset of it
 *    and the recovery step's own business never. A caller that must tell a file that is not this store's from data it
 *    could not see reads it (journalRedactPairs, H-184);
 *  - `unreadable`: a file that could not be opened or read (D-4592): it is no other store's file, and its data is not
 *    known, so recoveryStep fails its journal chunks while one stands.
 *  A name that vanished (ENOENT) is in none. */
function journalListing(P, storeId) {
  const dir = `${P.journalDir}/${storeId}`;
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { dir, files: [], foreign: [], nonRegular: [], unreadable: [] };
    throw e;
  }
  const files = [];
  const foreign = [];
  const nonRegular = [];
  const unreadable = [];
  for (const name of names.sort()) {
    const m = JOURNAL_NAME_RE.exec(name);
    if (m === null) continue;
    const ends = journalEnds(`${dir}/${name}`);
    if (ends.kind === 'gone') continue;
    if (ends.kind === 'unreadable') {
      unreadable.push(name);
      continue;
    }
    if (ends.kind === 'foreign' || (ends.headStore !== null && ends.headStore !== storeId)) {
      foreign.push(name);
      if (ends.kind === 'foreign') nonRegular.push(name);
      continue;
    }
    files.push({ name, month: m[1], writer: m[2], headT: ends.headT, lastT: ends.lastT });
  }
  return { dir, files, foreign, nonRegular, unreadable };
}

/** A journal file's lines from byte `start`, each with the offset just past it (`next`) and its size with its
 *  newline. A last fragment with no newline (a torn tail, §9.14) is a line too, ending at end-of-file. When the next
 *  append adds the newline B1's writer puts before it, a resumed read starts at that newline and meets an empty
 *  line, which every caller skips. */
function* fileLines(path, start) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const size = fstatSync(fd).size;
    let pos = start;
    let carry = Buffer.alloc(0);
    let carryAt = start;
    while (pos < size) {
      const want = Math.min(RECOVER_READ, size - pos);
      const piece = Buffer.allocUnsafe(want);
      const n = readSync(fd, piece, 0, want, pos);
      if (n <= 0) break;
      pos += n;
      const buf = carry.length === 0 ? piece.subarray(0, n) : Buffer.concat([carry, piece.subarray(0, n)]);
      let from = 0;
      for (let i = buf.indexOf(0x0a); i !== -1; i = buf.indexOf(0x0a, from)) {
        yield { raw: buf.toString('utf8', from, i), next: carryAt + i + 1, bytes: i + 1 - from };
        from = i + 1;
      }
      carry = Buffer.from(buf.subarray(from));
      carryAt += from;
    }
    if (carry.length > 0) yield { raw: carry.toString('utf8'), next: carryAt + carry.length, bytes: carry.length };
  } finally {
    closeSync(fd);
  }
}

/** Every `redact` record of this store's journal, read whole BEFORE a restore links its copy
 *  (spec §8.4 and §9.14). W1-B2 Task 27's restore hands `pairs` to store.mjs's commitRestore,
 *  which inserts them into the staged copy's redact_hashes inside its FULL bind transaction, so no read verb ever
 *  serves a restored store without a pair this journal knows: the index phase's "redaction first" (D-4241) then holds
 *  from the moment the store is visible, not from the moment the phase reaches the record. The files are the index
 *  phase's own (journalListing, in name order): the pairs are exactly what that phase could learn. Two lists name every
 *  file it did not read, never skipped silently, and they are two words because they have two remedies
 *  (D-4593 (history-restore-refuses-unread-journal-pairs), refined by H-103 and H-184):
 *  - `foreign`: a REGULAR file whose head names another store (journalListing's `foreign` less its `nonRegular`). It is not
 *    this store's file, so no pair of this store's is in it, and recovery skips it too (journal_head_mismatch);
 *  - `unreadable`: a name it cannot open or read (journalListing's `unreadable`), a link, socket, FIFO or directory at a month
 *    name (its `nonRegular`: a store's own month file moved away and replaced by a link is data this read cannot see, and
 *    recovery skips it unhealed), and any listed file whose read failed part-way. Its data is not known, so a pair only
 *    it holds may be missing. `nonRegular` names the link, socket, FIFO and directory entries among them, a subset of
 *    `unreadable` (H-219): no chmod cures them, so the restore's refusal gives them their own remedy.
 *  A pair is a few dozen bytes and redact records are
 *  rare, so the answer is small; the read is one pass over the journal, under the restore's lock. */
export function journalRedactPairs(P, storeId) {
  const listing = journalListing(P, storeId);
  const pairs = [];
  const unreadable = [...listing.unreadable, ...listing.nonRegular].sort();
  for (const f of listing.files) {
    const found = [];
    try {
      for (const { raw } of fileLines(`${listing.dir}/${f.name}`, 0)) {
        if (raw === '') continue;
        const x = indexRecord(parseJournalRecord(raw));
        if (x.redact !== undefined) found.push(x.redact);
      }
    } catch {
      unreadable.push(f.name);
    }
    pairs.push(...found);   // a file read part-way still yields the pairs it gave: a pair can only mask more
  }
  return { pairs, foreign: listing.foreign.filter((n) => !listing.nonRegular.includes(n)), unreadable, nonRegular: [...listing.nonRegular] };
}

/** One replay group's lines from position `at`.
 *  - A group of one file is read by byte offset.
 *  - A merge group is read whole and merged by lib's mergeJournalByTime, the very function Task 7's planReplay merges it
 *    with (R-T25-1), so the executor applies the order O56 pins: each file's own order kept, the earliest record next, a
 *    tie to the earlier file in the group. A line that is not a record takes the latest record time before it in its
 *    own file, as planReplay times it; an empty line is skipped, as planReplay skips it. The merged list is cached for
 *    the pass, and a position is an ordinal into it. */
function* groupLines(run, group, at) {
  if (group.length === 1) {
    yield* fileLines(`${run.dir}/${group[0]}`, at);
    return;
  }
  let merged = run.merged.get(group[0]);
  if (merged === undefined) {
    merged = mergeJournalByTime(group.map((name) => {
      const items = [];
      let lastT = null;
      for (const { raw } of fileLines(`${run.dir}/${name}`, 0)) {
        if (raw === '') continue;
        const r = parseJournalRecord(raw);
        const t = r.kind === 'record' ? r.rec.t : (lastT ?? 0);
        if (r.kind === 'record') lastT = lastT === null ? t : Math.max(lastT, t);
        items.push({ raw, t });
      }
      return items;
    }));
    run.merged.set(group[0], merged);
  }
  for (let i = at; i < merged.length; i += 1) {
    yield { raw: merged[i].raw, next: i + 1, bytes: Buffer.byteLength(merged[i].raw) + 1 };
  }
}

/** Where the cursor points in this pass's listing. A cursor naming a file this listing does not lead a group with
 *  restarts the phase. Journal files are never removed, so only a group that changed shape since the last pass can
 *  do that, and every record applies idempotently.
 *  D-4607 (history-recover-cursor-records-group-shape): the cursor's position is a byte offset into a group of one file
 *  and an ordinal into a merge group, and a second writer's file arriving (or one leaving the group) under the same
 *  leader changes which it is. The cursor therefore records the group's file count, and a group whose count differs, or
 *  is unknown (a cursor written before the count was kept), restarts at its start rather than reading a number as
 *  the wrong kind of position. Replay applies idempotently, but a restart counts again the skips the group's earlier
 *  chunks counted (a named residual).
 *  A second named residual (H-181): a member of a merge group that grows between two passes with a record timed before the
 *  stored ordinal shifts every later item, so that record is skipped and an earlier one is applied again; the count
 *  cannot see it. A group fingerprint beside the count is the recorded follow-up. */
function locateGroup(groups, cursor) {
  if (cursor.file === null) return { gi: 0, at: 0 };
  const gi = groups.findIndex((g) => g[0] === cursor.file);
  if (gi === -1) return { gi: 0, at: 0 };
  return { gi, at: cursor.offset === 0 || cursor.groupSize === groups[gi].length ? cursor.offset : 0 };
}

/** One chunk of a journal phase. From the cursor's position, the records of ONE replay group are handed to
 *  `onRecord` in order, in ONE transaction that also advances the cursor past them.
 *  - The chunk takes at least one line.
 *  - Once budget.chunkBytes of journal are read, it stops before the next line that is not a `spool` record.
 *  - Empty lines (the fence a torn tail leaves) are skipped uncounted.
 *  It answers the cursor it committed, whether that moved, and whether the phase has no record left. */
function journalChunk(db, run, cursor, onRecord) {
  const { gi, at } = locateGroup(run.groups, cursor);
  if (gi >= run.groups.length) return { cursor, moved: false, phaseDone: true };
  const group = run.groups[gi];
  let bytes = 0;
  let pos = at;
  let ended = true;
  const next = withTx(db, 'NORMAL', () => {
    for (const line of groupLines(run, group, at)) {
      const r = line.raw === '' ? null : parseJournalRecord(line.raw);
      if (bytes >= run.budget.chunkBytes && !(r !== null && r.kind === 'record' && r.rec.k === 'spool')) {
        ended = false;
        break;
      }
      if (r !== null) onRecord(r, line.raw);
      bytes += line.bytes;
      pos = line.next;
    }
    const c = ended && gi + 1 < run.groups.length
      ? { ...cursor, file: run.groups[gi + 1][0], offset: 0, groupSize: run.groups[gi + 1].length, pairsAdded: run.pairsAdded }
      : { ...cursor, file: group[0], offset: pos, groupSize: group.length, pairsAdded: run.pairsAdded };
    db.prepare(RECOVER_CURSOR_SQL).run(formatRecoverCursor(c), run.version);
    return c;
  });
  run.budget.bytes += bytes;
  return {
    cursor: next,
    moved: formatRecoverCursor(next) !== formatRecoverCursor(cursor),
    phaseDone: ended && gi + 1 >= run.groups.length,
  };
}

/** The index pass's one record: a learned pair into redact_hashes first (a pair the store lacked marks the cursor
 *  `+pairs`, which Task 29's reindex phase reads); a drain-time verdict, by its event_key, and a `drained` record, by
 *  its file, into the scratch tables. Skips are counted by the apply pass alone, so each is counted once. */
function indexJournalRecord(db, run, r, raw) {
  const x = indexRecord(r);
  if (x.redact !== undefined) {
    const changes = db.prepare(RECOVER_REDACT_INSERT).run(x.redact.len, Buffer.from(x.redact.sha256, 'hex'), x.redact.t).changes;
    if (Number(changes) > 0) run.pairsAdded = true;
  }
  if (x.verdictKey !== undefined) db.prepare(RECOVER_VERDICT_INSERT).run(x.verdictKey, raw);
  if (x.drainedFile !== undefined) db.prepare(RECOVER_DRAINED_INSERT).run(x.drainedFile);
}

/** The drain-time verdicts indexed under one event_key, in journal order. */
function verdictsAt(db, key) {
  return db.prepare(RECOVER_VERDICTS_AT).all(key).flatMap((row) => {
    const p = parseJournalRecord(String(row.rec));
    return p.kind === 'record' ? [p.rec] : [];
  });
}

/** The apply pass's one record. replayStep (lib, L1) decides; this applies its actions. Before the step:
 *  - a `file` record's name is looked up in the drained index;
 *  - a `spool` record's verdicts are looked up by its event_key.
 *  The replay state's maps then hold exactly what the step reads. A `head` starts a file, so no spool record
 *  after it can borrow the previous file's name. */
function applyJournalRecord(db, run, r) {
  if (r.kind === 'record') {
    const rec = r.rec;
    if (rec.k === 'file' && db.prepare(RECOVER_DRAINED_HAS).get(rec.name) !== undefined) run.drained.add(rec.name);
    if (rec.k === 'spool' && run.state.file !== null) {
      const key = eventKey(run.state.file, rec.ord);
      if (!run.verdicts.has(key)) run.verdicts.set(key, verdictsAt(db, key));
    }
  }
  const step = replayStep(run.state, r);
  run.state = { ...step.state, drained: run.drained, verdictsByKey: run.verdicts };
  if (r.kind === 'record' && r.rec.k === 'head') run.state = { ...run.state, file: null };
  for (const a of step.actions) applyReplayAction(db, run, a);
}

/** The observation a replayed recall or steer line is decided with: the generation its `generation-joined` verdict
 *  named, else none. A line that carried its own gen joined it without a verdict (via 'line'). */
function replayObservation(verdicts) {
  const j = verdicts.find((v) => v.kind === 'generation-joined');
  if (j === undefined) return NO_OBSERVATION;
  const generation = j.via === 'registry' ? { state: 'value', value: j.generation }
    : j.via === 'unreadable' ? { state: 'unreadable' } : { state: 'absent' };
  return { ...NO_OBSERVATION, generation };
}

/** One verdict, applied by an idempotent upsert on its natural key (§9.14), so a record the restored backup already
 *  holds changes nothing.
 *  - A re-key is a merge, which a replayed `family(X, '')` lands in (ensureFamily follows merged_into;
 *    D-4194).
 *  - Counters fold only where the record proves the event happened, and only once:
 *    - a join's counters only for an epoch line's own verdicts, which apply once, with the line's fresh receipt;
 *    - a re-key only when it merged;
 *    - a drop only when it removed a waiting candidate.
 *    A verdict with no event_key (a later-tick join) has no key to prove it new, so its join is not counted again.
 *  - `bind` and `drained` change nothing in the store. */
function replayVerdict(db, v, countJoins) {
  switch (v.kind) {
    case 'family':
      ensureFamily(db, v.ccrc_id, v.generation, v.project, v.first_seen_ms);
      return;
    case 'generation-joined':
      if (countJoins && v.via === 'absent') bump(db, 'family_gen_absent');
      if (countJoins && v.via === 'unreadable') bump(db, 'family_gen_unreadable');
      return;
    case 'rekeyed': {
      const legacy = db.prepare("SELECT session_pk, project FROM sessions WHERE ccrc_id = ? AND generation = '' AND merged_into IS NULL")
        .get(v.ccrc_id);
      if (legacy === undefined) return;
      const to = ensureFamily(db, v.ccrc_id, v.generation, legacy.project, v.t);
      mergeFamily(db, legacy.session_pk, to.sessionPk);
      bump(db, 'family_rekeyed');
      return;
    }
    case 'epoch-confirmed': {
      const f = ensureFamily(db, v.ccrc_id, v.generation, '', v.t);
      chainEpoch(db, f.sessionPk, v.cc_session_uuid, v.cause, v.declared_by, v.t);
      db.prepare(DELETE_CANDIDATE).run(v.cc_session_uuid, v.ccrc_id);
      return;
    }
    case 'epoch-chained': {
      const f = ensureFamily(db, v.ccrc_id, v.generation, '', v.t);
      chainEpoch(db, f.sessionPk, v.cc_session_uuid, 'clear', 'hook', null);
      return;
    }
    case 'epoch-unconfirmed':
      if (Number(db.prepare(DELETE_CANDIDATE).run(v.cc_session_uuid, v.ccrc_id).changes) === 0) return;
      bump(db, 'epoch_unconfirmed');
      if (v.superseded === true) bump(db, 'epoch_unconfirmed_superseded');
      return;
    case 'mapping': {
      const f = ensureFamily(db, v.ccrc_id, v.generation, '', v.t);
      chainEpoch(db, f.sessionPk, v.cc_session_uuid, 'import', v.declared_by, v.t);
      db.prepare(DELETE_CANDIDATE).run(v.cc_session_uuid, v.ccrc_id);
      return;
    }
    default:
      return;
  }
}

/** A SessionStart line, replayed at its own position (§9.14; D-4190).
 *  - With drain-time verdicts: each is applied in journal order. A clear that was chained but not confirmed
 *    re-enters epoch_candidates as the drain left it, aged by its journal time, so the live tick goes on deciding
 *    it within the same 7 days.
 *  - With none: the drain either kept the line as a candidate, or found its epoch already in place. lib's
 *    decideEpochLine, under an observation that read nothing, tells the candidate. A candidate whose uuid some
 *    family already holds confirmed is the in-place case, and is not re-added. */
function replayEpochLine(db, a, tsMs) {
  const { rec } = a;
  if (a.verdicts.length === 0) {
    const line = rec.reg === undefined ? { src: rec.src, sid: rec.sid } : { src: rec.src, sid: rec.sid, reg: rec.reg };
    if (decideEpochLine(line, NO_OBSERVATION).kind !== 'candidate') return;
    if (db.prepare('SELECT 1 AS x FROM epochs WHERE cc_session_uuid = ? AND confirmed_ms IS NOT NULL LIMIT 1').get(rec.sid) !== undefined) return;
    db.prepare(INSERT_CANDIDATE).run(rec.sid, rec.id, rec.gen ?? '', rec.src, tsMs, a.recvMs);
    return;
  }
  let chained = null;
  let confirmed = false;
  for (const v of a.verdicts) {
    replayVerdict(db, v, true);
    if (v.kind === 'epoch-chained') chained = v;
    if (v.kind === 'epoch-confirmed') confirmed = true;
  }
  if (chained !== null && !confirmed) db.prepare(INSERT_CANDIDATE).run(rec.sid, rec.id, chained.generation, 'clear', tsMs, a.recvMs);
}

/** One drained spool line's receipt, as drainFile writes it: event_key from the draining name and the ordinal,
 *  received_ms the file's journaling time, ts_ms the line's ts else that time.
 *  - payload_sha hashes the record's re-serialisation: the journal keeps the parsed object, and every writer in the
 *    tree writes exactly that compact text (D-4726 (history-replay-receipt-sha-from-record)).
 *  - A duplicate is a no-op, never a collision: the bytes a restored backup's receipt hashed are not in the journal.
 *  - A fresh receipt's effects follow it: an epoch line through its verdicts; a recall or steer line through the
 *    drain's own applyEventLine, with the generation its verdict named. `run.ectx.replay` is true, so applyEventLine
 *    reads no switch whose state is today's, not the drain's: Task 11's recall_off_stale count is the drain's alone
 *    (§9.14 "never re-decides"). */
function replayReceipt(db, run, a) {
  const fromLine = typeof a.rec.ts === 'number';
  const tsMs = fromLine ? a.rec.ts : a.recvMs;
  const fresh = Number(db.prepare(RECOVER_RECEIPT_INSERT)
    .run(a.key, sha256Bytes(JSON.stringify(a.rec)), a.recvMs, tsMs, fromLine ? 'line' : 'received').changes) > 0;
  if (!fresh) return;
  if (a.rec.ev === 'SessionStart') {
    replayEpochLine(db, a, tsMs);
    return;
  }
  if (a.rec.ev === 'recall' || a.rec.ev === 'steer') {
    applyEventLine(db, run.ectx, { key: a.key, rec: a.rec, recvMs: a.recvMs, tsMs, obs: replayObservation(a.verdicts) });
  }
}

/** Whether `path` is there, by lstat. ENOENT and ENOTDIR are "not there": no entry can exist under a non-directory, so a
 *  stray file standing where a spool directory belongs is a measured absence, and failing on it would wedge the step for
 *  good (the drain and tidyDraining that cure it never run while the step is open). Any other error is "could not be
 *  measured" and is thrown, never read as absence (D-4592 (history-recover-unreadable-journal-fails-the-chunk)): the
 *  apply chunk that meets it fails, and a later tick measures again. */
function spoolEntryThere(path) {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false;
    throw new Error(`the spool cannot be measured at ${path}: ${e && e.code ? e.code : String(e)}`);
  }
}

/** Whether a journaled spool file with no `drained` record is still kept. In `.draining/` it was held, or drained by the
 *  lost store before its verdicts were flushed, and the live drain decides it after the step. B1 also sets a journaled
 *  file aside with no `drained` record, its bytes kept and its lines in no store: into `.draining/rejected/<name>` when
 *  the store refused its rows (D-4346), and into `.draining/planted/<area>/<name>` when
 *  a directory at its sidecar or sidecar-temp name displaced it (D-4347). Replay skips all three, as
 *  the lost store held none of a set-aside file's lines; only a file kept in none of them is gone
 *  (D-4728 (history-replay-keeps-set-aside-files)). It answers true or false only for a spool it could measure: an
 *  lstat or a listing that fails for any reason but ENOENT or ENOTDIR throws, so the chunk fails and the file is never counted
 *  gone on a guess (D-4592 (history-recover-unreadable-journal-fails-the-chunk)). */
function undrainedFileKept(draining, name) {
  if (spoolEntryThere(`${draining}/${name}`)) return true;
  if (spoolEntryThere(`${draining}/${REJECTED_DIR}/${name}`)) return true;
  let areas;
  try {
    areas = readdirSync(`${draining}/${PLANTED_DIR}`);
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false;
    throw new Error(`the spool cannot be listed at ${draining}/${PLANTED_DIR}: ${e && e.code ? e.code : String(e)}`);
  }
  return areas.some((area) => spoolEntryThere(`${draining}/${PLANTED_DIR}/${area}/${name}`));
}

/** One replayStep action. A `tick` record is the lag series' copy. replayStep answers it only when it is newer than
 *  the ticks the store held below the bind (ReplayState.ticksAfter) and older than the bind itself
 *  (ReplayState.ticksBefore): a recovery pass journals its own tick record, whose row it already wrote
 *  (D-4701 (history-replay-skips-post-bind-ticks)). lib decides that bound; this executor applies every tick it answers. */
function applyReplayAction(db, run, a) {
  switch (a.do) {
    case 'receipt':
      replayReceipt(db, run, a);
      return;
    case 'verdict':
      replayVerdict(db, a.rec, false);
      return;
    case 'redact':
      db.prepare(RECOVER_REDACT_INSERT).run(a.len, Buffer.from(a.sha256, 'hex'), a.t);
      return;
    case 'tick':
      db.prepare(RECOVER_TICK_INSERT).run(a.t, a.lagMs);
      return;
    case 'skip':
      bump(db, a.counter);
      return;
    case 'skip-undrained':
      // Its file was held, or drained by the lost store before its verdicts were flushed: either way it is still in
      // .draining/ with its sidecar, and the live drain decides it after the step. Or B1 set it aside after journaling
      // it (undrainedFileKept). Counted only when it is gone.
      if (typeof a.file !== 'string' || !undrainedFileKept(run.P.draining, a.file)) bump(db, 'journal_spool_undrained_gone');
      return;
    default:
      return;   // 'file': the replay state carries it
  }
}

/** index: the first pass. At the phase's start, any rows a killed earlier step left are cleared. */
function recoverIndexChunk(db, run, cursor) {
  if (cursor.file === null) {
    withTx(db, 'NORMAL', () => { for (const t of RECOVER_SCRATCH_TABLES) db.exec(`DELETE FROM ${t}`); });
  }
  return journalChunk(db, run, cursor, (r, raw) => indexJournalRecord(db, run, r, raw));
}

/** apply: the second pass. The per-chunk lookups start empty, except the current file's drained flag, which a
 *  spool record continuing that file still needs. */
function recoverApplyChunk(db, run, cursor) {
  run.verdicts.clear();
  run.drained.clear();
  const f = run.state.file;
  if (f !== null && db.prepare(RECOVER_DRAINED_HAS).get(f) !== undefined) run.drained.add(f);
  return journalChunk(db, run, cursor, (r) => applyJournalRecord(db, run, r));
}

/** reindex: Task 25's executor contract over W1-B2 Task 29's recoverReindex. Its progress lives in its own
 *  derivation rows, so the recovery cursor comes back unchanged; `done` ends the phase. recoverReindex answers
 *  `{ moved: false, done: false }` only when the run budget was spent before it did any work; recoveryStep ends the
 *  step for this pass on that answer (Task 25's contract, and its budget check before every chunk), so it is never
 *  called again in a spin. It answers a Promise, which recoveryStep awaits (Task 25's executor contract). */
async function recoverReindexChunk(db, run, cursor) {
  const r = await recoverReindex(db, run.ectx, cursor, run.budget);
  return { cursor: r.cur, moved: r.moved, phaseDone: r.done };
}

// ── W1-B4 Task 10: export replay, the recovery step's two export phases (spec §9.14 "Export replay", §9.15) ─────
//
// After the journal (index, apply), the step replays this store's export segments in two passes, so no row ever
// waits on a blob in a later segment (BK21):
//   export-blobs  every segment's blobs, insert-or-ignore by sha256; each replayed blob that holds bytes is marked
//                 with its segment, so it is never exported again;
//   export-rows   every segment's rows in their write order (ord), through the ingest's named columns:
//                 - families and epochs fill only what the journal lacks, through merged_into;
//                 - a gone file becomes a dead-file ingest_files row keyed 'exported:' + hex(sha256(path ∖0 dev ∖0
//                   ino)) (lib deadFileSourceKey: a path already of that form is the key itself, so a replayed row
//                   exported again maps back to its own row), never a live row, even one that now reuses its inode
//                   (§9.15), and with no file_paths row, so the live ingest can never find it;
//                 - entries go through ENTRY_UPSERT's newest-rank rule, each marked with its segment;
//                 - variants, boundaries (their carried ord), sidecars and memberships, idempotently.
// Segments go in (seq, writer) order (lib orderSegmentNames), whatever their writer, and lib decideSegmentReplay
// judges each from its meta: a newer format is refused loudly (meta export_segment_newer lists it, doctor FAIL
// export-segment-newer) and skipped; another store's is skipped and counted export_segment_foreign. A segment that
// cannot be opened or read fails its chunk (recover_chunk_failed) and the step waits for it, capture held with it:
// only a newer format is skippable, and the failure line names the way out
// (D-4765 (history-export-segment-unreadable-stalls), NEW).
// THE CURSOR is lib's RecoverCursor at its phase: `file` the segment's name, `offset` the last blobs rowid
// (export-blobs) or the last row ord (export-rows) applied. It is committed in the chunk's own NORMAL transaction
// with what it applied, and `pairsAdded` rides along as the step holds it (run.pairsAdded: an export phase learns no
// pair itself), so Task 29's reindex phase still sees a learned pair. It carries no group size: only a journal phase
// has one, and lib formatRecoverCursor refuses one beside an export phase. Replay writes no journal record (O36) and
// no segment.

/** Rows read per page of one segment; a chunk applies them until run.budget.chunkBytes. */
const EXPORT_REPLAY_PAGE = 256;

const EXPORT_REPLAY_STMTS = new WeakMap();
/** Export replay's prepared statements, one set per connection, each naming its columns (stmts(db)'s idiom). A variant
 *  and a sidecar row go in through B1's own inserts (stmts(db).variantIns, sideStmts(db).sidecarIns), whose SQL replay
 *  needs as it stands; an entry through stmts(db).entryUpsert and a membership through stmts(db).membership. */
function replayStmts(db) {
  let s = EXPORT_REPLAY_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    blobIns: db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING'),
    blobMark: db.prepare('UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE sha256 = ? AND z IS NOT NULL AND exported_ms IS NULL'),
    blobId: db.prepare('SELECT blob_id FROM blobs WHERE sha256 = ?'),
    familySel: db.prepare('SELECT session_pk, merged_into FROM sessions WHERE ccrc_id = ? AND generation = ?'),
    familyFill: db.prepare("UPDATE sessions SET project = ? WHERE session_pk = ? AND project = ''"),
    epochMine: db.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND cc_session_uuid = ?'),
    epochFill: db.prepare(`UPDATE epochs SET started_ms = coalesce(started_ms, ?), cwd = coalesce(cwd, ?),
        git_branch = coalesce(git_branch, ?), cwd_real = coalesce(cwd_real, ?), confirmed_ms = coalesce(confirmed_ms, ?)
      WHERE session_pk = ? AND seq = ?`),
    epochElsewhere: db.prepare('SELECT 1 AS x FROM epochs WHERE cc_session_uuid = ? AND session_pk <> ? AND confirmed_ms IS NOT NULL LIMIT 1'),
    epochSeqTaken: db.prepare('SELECT 1 AS x FROM epochs WHERE session_pk = ? AND seq = ?'),
    epochIns: db.prepare(`INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd,
        git_branch, cwd_real, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    candidateDel: db.prepare(DELETE_CANDIDATE),
    transcriptUpsert: db.prepare(`INSERT INTO transcripts (cc_session_uuid, agent_id, harness, parent_tool_use_id,
        workflow_run_id, agent_type) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (cc_session_uuid, agent_id) DO UPDATE SET
        parent_tool_use_id = coalesce(transcripts.parent_tool_use_id, excluded.parent_tool_use_id),
        workflow_run_id = coalesce(transcripts.workflow_run_id, excluded.workflow_run_id),
        agent_type = coalesce(transcripts.agent_type, excluded.agent_type)`),
    transcriptPk: db.prepare('SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ?'),
    deadFileUpsert: db.prepare(`INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, size, mtime_ns, offset,
        status, eof_ms, parser_version) VALUES (?, ?, ?, ?, ?, ?, 0, 'exported', ?, ?)
      ON CONFLICT (dev, ino, source_key) DO UPDATE SET eof_ms = coalesce(ingest_files.eof_ms, excluded.eof_ms)`),
    deadFileId: db.prepare('SELECT file_id FROM ingest_files WHERE dev = ? AND ino = ? AND source_key = ?'),
    entrySel: db.prepare('SELECT entry_id, struct_file_id FROM entries WHERE uuid = ?'),
    entryMark: db.prepare('UPDATE entries SET exported_ms = ?, exported_seg = ? WHERE entry_id = ? AND exported_ms IS NULL'),
    // B1's boundaryIns draws ord itself; replay carries the exporter's. It meets two uniqueness rules, PRIMARY KEY
    // (entry_id) and UNIQUE (transcript_pk, ord), and absorbs both: a repeated entry (a second segment of it) is the
    // ordinary case, silent; a collision on (transcript_pk, ord) with ANOTHER entry's boundary is a row the store cannot
    // place, and replayBoundaryRow counts it export_row_unplaced and goes on. A throw there would fail the chunk on every
    // pass, and while the step is registered no tick runs, so capture would be held store-wide for one row.
    boundaryIns: db.prepare(`INSERT INTO boundaries (entry_id, transcript_pk, ord, trigger, head_uuid, anchor_uuid,
        tail_uuid, kept_blob_id, pre_tokens, post_tokens, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`),
    boundaryHas: db.prepare('SELECT 1 AS x FROM boundaries WHERE entry_id = ?'),
  };
  EXPORT_REPLAY_STMTS.set(db, s);
  return s;
}

const blobIdOf = (db, sha) => {
  const b = replayStmts(db).blobId.get(sha);
  return b === undefined ? null : Number(b.blob_id);
};
const transcriptPkOf = (db, uuid, agentId) => {
  const t = replayStmts(db).transcriptPk.get(uuid, agentId);
  return t === undefined ? null : Number(t.transcript_pk);
};
/** The family a segment row names, through merged_into (a re-keyed '' family answers with the one it merged into),
 *  or null when the store has none: a row never creates a family the segment's own family row did not. */
function familyPkOf(db, ccrcId, generation) {
  const row = replayStmts(db).familySel.get(ccrcId, generation);
  if (row === undefined) return null;
  return row.merged_into === null ? Number(row.session_pk) : Number(row.merged_into);
}
/** The dead-file row of a gone file, made when absent (§9.15 "Memberships of a gone file"). Its eof_ms is the one the
 *  segment carried, else the segment's cutoff (D-4764 (history-export-dead-file-eof), NEW): B2's leaf readiness reads it. */
function ensureDeadFile(db, seg, path, dev, ino, transcriptPk, size, mtimeNs, eofMs) {
  const s = replayStmts(db);
  const key = deadFileSourceKey(path, dev, ino);
  s.deadFileUpsert.run(dev, ino, key, transcriptPk, size, mtimeNs, eofMs ?? seg.cutoffMs, PARSER_VERSION);
  return Number(s.deadFileId.get(dev, ino, key).file_id);
}
const deadFileIdOf = (db, path, dev, ino) => {
  const row = replayStmts(db).deadFileId.get(dev, ino, deadFileSourceKey(path, dev, ino));
  return row === undefined ? null : Number(row.file_id);
};

function replayFamilyRow(db, _seg, r) {
  const f = ensureFamily(db, r.ccrc_id, r.generation, r.project, r.first_seen_ms);
  if (!f.created && r.project !== '') replayStmts(db).familyFill.run(r.project, f.sessionPk);
}
function replayTranscriptRow(db, _seg, r) {
  replayStmts(db).transcriptUpsert.run(r.cc_session_uuid, r.agent_id, r.harness, r.parent_tool_use_id, r.workflow_run_id, r.agent_type);
}
/** An epoch the journal holds (by uuid, in the family the row names after merged_into) keeps its seq, cause and
 *  declared_by and gains only its NULL columns; one the journal lacks goes in at the segment's seq, unless that seq,
 *  or the uuid confirmed in another family, is taken (export_epoch_conflict). */
function replayEpochRow(db, _seg, r) {
  const s = replayStmts(db);
  const pk = familyPkOf(db, r.ccrc_id, r.generation);
  if (pk === null) { bump(db, 'export_row_unplaced'); return; }
  const mine = s.epochMine.get(pk, r.cc_session_uuid);
  if (mine !== undefined) {
    s.epochFill.run(r.started_ms, r.cwd, r.git_branch, r.cwd_real, r.confirmed_ms, pk, mine.seq);
    if (r.confirmed_ms !== null) s.candidateDel.run(r.cc_session_uuid, r.ccrc_id);
    return;
  }
  if (s.epochElsewhere.get(r.cc_session_uuid, pk) !== undefined || s.epochSeqTaken.get(pk, r.seq) !== undefined) {
    bump(db, 'export_epoch_conflict');
    return;
  }
  s.epochIns.run(pk, r.seq, r.cc_session_uuid, r.cause, r.declared_by, r.started_ms, r.cwd, r.git_branch, r.cwd_real, r.confirmed_ms);
  if (r.confirmed_ms !== null) s.candidateDel.run(r.cc_session_uuid, r.ccrc_id);
}
function replayFileRow(db, seg, r) {
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  if (t === null) { bump(db, 'export_row_unplaced'); return; }
  ensureDeadFile(db, seg, r.path, r.dev, r.ino, t, r.size, r.mtime_ns, r.eof_ms);
}
function replayEntryRow(db, seg, r) {
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  if (t === null) { bump(db, 'export_row_unplaced'); return; }
  const blobId = blobIdOf(db, r.blob_sha256);
  if (blobId === null) { bump(db, 'export_row_blob_missing'); return; }
  const fileId = ensureDeadFile(db, seg, r.struct_path, r.struct_dev, r.struct_ino, t, null, null, null);
  stmts(db).entryUpsert.run(r.uuid, t, r.type, r.subtype, r.role, r.model, r.parent_uuid, r.ts_ms, r.request_id,
    r.api_block_index, r.msg_id, r.source_tool_use_id, r.tool_name, r.is_compact_summary, r.provenance, r.prov_version,
    r.parse_state, r.struct_rank_ns, fileId, blobId);
  const s = replayStmts(db);
  const e = s.entrySel.get(r.uuid);
  s.entryMark.run(seg.markMs, seg.name, e.entry_id);
}
/** A variant's first file is the dead-file row of the first file the segment names for it (first_path, first_dev,
 *  first_ino; the export pass writes that file row before the entry), else its entry's own dead-file row
 *  (D-4766 (history-export-variant-first-file), NEW). */
function replayVariantRow(db, _seg, r) {
  const s = replayStmts(db);
  const e = s.entrySel.get(r.uuid);
  if (e === undefined) { bump(db, 'export_row_unplaced'); return; }
  const blobId = blobIdOf(db, r.blob_sha256);
  if (blobId === null) { bump(db, 'export_row_blob_missing'); return; }
  const first = deadFileIdOf(db, r.first_path, r.first_dev, r.first_ino) ?? Number(e.struct_file_id);
  stmts(db).variantIns.run(e.entry_id, blobId, first, r.first_seen_ms, r.cause);   // B1's own insert, byte for byte (ON CONFLICT (entry_id, blob_id) DO NOTHING)
}
function replayBoundaryRow(db, _seg, r) {
  const s = replayStmts(db);
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  const e = s.entrySel.get(r.uuid);
  if (t === null || e === undefined) { bump(db, 'export_row_unplaced'); return; }
  let kept = null;
  if (r.kept_sha256 !== null) {
    kept = blobIdOf(db, r.kept_sha256);
    if (kept === null) bump(db, 'export_row_blob_missing');
  }
  const ins = s.boundaryIns.run(e.entry_id, t, r.boundary_ord, r.trigger, r.head_uuid, r.anchor_uuid, r.tail_uuid, kept, r.pre_tokens, r.post_tokens, r.duration_ms);
  // Nothing inserted: the entry already has its boundary (a repeat, absorbed), or another entry holds this (transcript, ord).
  if (Number(ins.changes) === 0 && s.boundaryHas.get(e.entry_id) === undefined) bump(db, 'export_row_unplaced');
}
function replaySidecarRow(db, _seg, r) {
  const s = replayStmts(db);
  const t = transcriptPkOf(db, r.cc_session_uuid, r.agent_id);
  if (t === null) { bump(db, 'export_row_unplaced'); return; }
  const blobId = blobIdOf(db, r.blob_sha256);
  if (blobId === null) { bump(db, 'export_row_blob_missing'); return; }
  let entryId = null;
  if (r.uuid !== null) {
    const e = s.entrySel.get(r.uuid);
    if (e === undefined) bump(db, 'export_row_unplaced');
    else entryId = e.entry_id;
  }
  sideStmts(db).sidecarIns.run(t, r.name, blobId, entryId, r.first_seen_ms);   // B1's own insert, byte for byte (ON CONFLICT (transcript_pk, name, blob_id) DO NOTHING)
}
function replayMembershipRow(db, _seg, r) {
  const fileId = deadFileIdOf(db, r.path, r.dev, r.ino);
  const e = replayStmts(db).entrySel.get(r.uuid);
  if (fileId === null || e === undefined) { bump(db, 'export_row_unplaced'); return; }
  stmts(db).membership.run(fileId, e.entry_id, r.line);
}

/** One applicator per row kind a format-1 segment holds (Task 4's segmentInserts keys). */
const EXPORT_ROW_APPLY = Object.freeze({
  family: replayFamilyRow,
  transcript: replayTranscriptRow,
  epoch: replayEpochRow,
  file: replayFileRow,
  entry: replayEntryRow,
  variant: replayVariantRow,
  boundary: replayBoundaryRow,
  sidecar: replaySidecarRow,
  membership: replayMembershipRow,
});

/** A row's size for the chunk bound: its strings' and byte arrays' lengths, eight bytes per other value. */
function rowBytes(row) {
  let n = 0;
  for (const v of Object.values(row)) {
    if (typeof v === 'string') n += Buffer.byteLength(v);
    else if (v instanceof Uint8Array) n += v.length;
    else n += 8;
  }
  return n;
}

/** This store's segment names in replay order, listed once per pass (the run object is the pass's). An absent
 *  directory is no segment; a listing that throws fails the chunk. */
function exportReplayListing(run) {
  if (run.exportListing === undefined) {
    const dir = `${run.P.root}/${EXPORT_DIR}/${run.storeId}`;
    run.exportListing = { dir, names: orderSegmentNames(listSegments(dir).map((s) => s.name)) };
  }
  return run.exportListing;
}

/** The failure of a segment that cannot be read, naming the segment and the way out: an unreadable segment fails its
 *  chunk and is never skipped, and while the step waits for it no tick ingests (D-4765
 *  (history-export-segment-unreadable-stalls)). One text for every read of it: its open, its meta and each page. */
function segmentUnreadable(dir, name, e) {
  return new Error(`export segment ${dir}/${name} cannot be read (${e && e.message ? e.message : String(e)}); `
    + 'recovery waits for it and capture is held. Move it aside under a non-segment name to skip it (its text is not '
    + 'replayed), or put a good copy back');
}

/** One page read from an open segment. A file whose meta reads but whose later pages do not (a partial or damaged
 *  copy, D-4765's own example) fails inside the page read with a bare SQLite message; it fails the chunk the same way,
 *  with the segment named and the way out. Only the READ is wrapped: an error applying a row to the store is not a
 *  segment that cannot be read. */
function readSegmentPage(dir, name, read) {
  try {
    return read();
  } catch (e) {
    throw segmentUnreadable(dir, name, e);
  }
}

/** A segment opened read-only and judged by lib from its meta, the judgement cached for the pass. Either read
 *  failing throws, naming the segment and the way out (segmentUnreadable). */
function openForReplay(run, dir, name) {
  let sdb = null;
  try {
    sdb = openSegment(`${dir}/${name}`);
    if (run.exportVerdicts === undefined) run.exportVerdicts = new Map();
    let verdict = run.exportVerdicts.get(name);
    if (verdict === undefined) {
      const meta = segmentMeta(sdb);
      verdict = { word: decideSegmentReplay({ meta: { storeId: meta.storeId, format: meta.format }, storeId: run.storeId }), meta };
      run.exportVerdicts.set(name, verdict);
    }
    return { sdb, verdict };
  } catch (e) {
    if (sdb !== null) sdb.close();
    throw segmentUnreadable(dir, name, e);
  }
}

/** A segment the export-blobs walk skips, once per walk: a newer format joins meta export_segment_newer (doctor FAIL
 *  export-segment-newer, naming it); another store's is counted export_segment_foreign. Each prints one line. */
function noteSkippedSegment(db, name, verdict) {
  if (verdict.word === 'newer') {
    let listed = [];
    try {
      const v = JSON.parse(getMeta(db, HEALTH_META.exportSegmentNewer) ?? '[]');
      if (Array.isArray(v)) listed = v.filter((x) => typeof x === 'string');
    } catch {
      listed = [];
    }
    if (!listed.includes(name)) setMeta(db, HEALTH_META.exportSegmentNewer, JSON.stringify([...listed, name]));
    process.stderr.write(`history-sweep: export segment ${name} is format ${verdict.meta.format}, newer than this build's ${EXPORT_SEGMENT_FORMAT}; it was not replayed\n`);
    return;
  }
  bump(db, 'export_segment_foreign');
  process.stderr.write(`history-sweep: export segment ${name} names store ${verdict.meta.storeId}, not this one; it was not replayed\n`);
}

/** One page of one segment's blobs past `after` (a rowid), bounded by the chunk's bytes. insert-or-ignore by sha256
 *  (§9.14): a blob the store already holds, whole or pruned, keeps its row; one with bytes is marked with its
 *  segment. A stub (no bytes) goes in pruned (D-4759 (history-export-pruned-row-stub)). An empty page ends the segment. */
function replayBlobPage(db, run, sdb, dir, name, after) {
  const page = readSegmentPage(dir, name, () => segmentBlobsAfter(sdb, after, run.budget.chunkBytes));
  if (page.length === 0) return { pos: after, done: true, bytes: 0 };
  const s = replayStmts(db);
  const markMs = run.now();
  let bytes = 0;
  for (const b of page) {
    s.blobIns.run(b.sha256, b.codec, b.z, b.raw_len, b.z === null ? markMs : null);
    if (b.z !== null) {
      s.blobMark.run(markMs, name, b.sha256);
      bytes += b.z.length;
    }
  }
  return { pos: Number(page[page.length - 1].rowid), done: false, bytes };
}

/** One page of one segment's rows past `after` (an ord), applied in order until the chunk's bytes; at least one. An
 *  empty page ends the segment. A kind format 1 does not define fails the chunk. */
function replayRowPage(db, run, sdb, dir, name, meta, after) {
  const page = readSegmentPage(dir, name, () => segmentRowsAfter(sdb, after, EXPORT_REPLAY_PAGE));
  if (page.length === 0) return { pos: after, done: true, bytes: 0 };
  const seg = { name, markMs: run.now(), cutoffMs: meta.cutoffMs };
  let bytes = 0;
  let pos = after;
  for (const r of page) {
    if (pos !== after && bytes >= run.budget.chunkBytes) break;
    const apply = Object.hasOwn(EXPORT_ROW_APPLY, r.kind) ? EXPORT_ROW_APPLY[r.kind] : undefined;
    if (apply === undefined) throw new Error(`export segment ${name} holds a row of kind ${String(r.kind)}, which format ${meta.format} does not define`);
    apply(db, seg, r.row);
    bytes += rowBytes(r.row);
    pos = Number(r.ord);
  }
  return { pos, done: false, bytes };
}

/** One bounded chunk of an export phase: one page of one segment, applied with the cursor past it in one NORMAL
 *  transaction (B2's executor contract). `blobs` picks the phase's page. */
function exportPhaseChunk(db, run, cursor, blobs) {
  const { dir, names } = exportReplayListing(run);
  // A cursor naming a segment this listing does not hold restarts the phase: segments are never removed by the sweep,
  // and every insert here is idempotent.
  const found = cursor.file === null ? -1 : names.indexOf(cursor.file);
  const at = found === -1 ? 0 : found;
  const after = found === -1 ? 0 : cursor.offset;
  const name = at < names.length ? names[at] : null;
  const position = (file, offset) => ({ phase: cursor.phase, file, offset, blobId: null, pairsAdded: run.pairsAdded });
  // An unreadable segment throws here, before the transaction: the chunk fails and the step waits for it.
  const opened = name === null ? { sdb: null, verdict: null } : openForReplay(run, dir, name);
  let page = { pos: after, done: true, bytes: 0 };
  let next;
  try {
    next = withTx(db, 'NORMAL', () => {
      if (blobs && cursor.file === null) setMeta(db, HEALTH_META.exportSegmentNewer, '[]');
      if (opened.verdict !== null && opened.verdict.word === 'replay') {
        page = blobs
          ? replayBlobPage(db, run, opened.sdb, dir, name, after)
          : replayRowPage(db, run, opened.sdb, dir, name, opened.verdict.meta, after);
      } else if (opened.verdict !== null && blobs) {
        noteSkippedSegment(db, name, opened.verdict);
      }
      const c = name === null ? position(null, 0)
        : page.done && at + 1 < names.length ? position(names[at + 1], 0)
          : position(name, page.pos);
      db.prepare(RECOVER_CURSOR_SQL).run(formatRecoverCursor(c), run.version);
      return c;
    });   // the chunk's one transaction: what it applied, and the cursor past it
  } finally {
    if (opened.sdb !== null) opened.sdb.close();
  }
  run.budget.bytes += page.bytes;
  return {
    cursor: next,
    moved: formatRecoverCursor(next) !== formatRecoverCursor(cursor),
    phaseDone: name === null || (page.done && at + 1 >= names.length),
  };
}

/** export-blobs: every segment's blobs, before any segment's rows (BK21). */
function recoverExportBlobsChunk(db, run, cursor) {
  return exportPhaseChunk(db, run, cursor, true);
}

/** export-rows: every segment's rows, in (seq, writer) order. */
function recoverExportRowsChunk(db, run, cursor) {
  return exportPhaseChunk(db, run, cursor, false);
}

/** One executor per RECOVER_PHASES phase, keyed by its name. The contract each keeps:
 *  - it is `(db, run, cursor) => { cursor, moved, phaseDone }`, or a Promise of it, and does ONE bounded chunk;
 *  - it commits its cursor, at its own phase, in the transaction that applies the chunk;
 *  - `phaseDone` hands the move to the next phase to recoveryStep;
 *  - `{ moved: false, phaseDone: false }` ends the step for this pass: recoveryStep calls it no more until the next
 *    pass, which counts toward recovery-stalled.
 *  W1-B4's export phases are here and in RECOVER_PHASES, in one order; history-recover.test.ts holds the two equal. */
export const RECOVER_EXECUTORS = Object.freeze({
  index: recoverIndexChunk,
  apply: recoverApplyChunk,
  'export-blobs': recoverExportBlobsChunk,
  'export-rows': recoverExportRowsChunk,
  reindex: recoverReindexChunk,
});

/** The step's end, in one transaction:
 *  - every open recover row up to this one is completed: a replay of the whole journal subsumes an older one;
 *  - the scratch tables are dropped;
 *  - the unmoved count is reset;
 *  - B1's four spool counters are re-measured against this box's spool (Task 23's applyCounterResets and
 *    measureSpoolStanding): a store-refused or displaced file still kept raises its count, and a cured one resets it. */
function finishRecovery(db, run, cursor) {
  withTx(db, 'NORMAL', () => {
    db.prepare(RECOVER_DONE_SQL).run(formatRecoverCursor(cursor), run.now(), run.version);
    for (const t of RECOVER_SCRATCH_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    setMeta(db, HEALTH_META.recoverUnmovedTicks, '0');
    // D-4723 (history-counter-resets-after-cure): a restored or rebuilt store's spool counters are another moment's; this box's
    // spool is the standing truth (Task 23's re-measure, inside the step's closing transaction).
    applyCounterResets(db, measureSpoolStanding(run.ectx.home));
  });
}

/** The registered recovery step, advanced chunk by chunk within `ctx.budget`.
 *  - It answers `held` when history-off or the free-space floor stopped it before a chunk.
 *  - It answers `moved` when any cursor advanced this pass, and `done` when the step completed.
 *  - A chunk that throws rolls back and ends the pass's step, and so does a stored cursor lib's grammar refuses.
 *    Busy rethrows, so the pass ends as a busy tick ends (O22).
 *  - An executor answer that neither moved nor finished its phase ends the pass's step: the executor is not called
 *    again until the next pass.
 *  `executors` is an in-process seam (history-recover.test.ts); every caller in the tree passes none. */
export async function recoveryStep(db, ctx, executors = RECOVER_EXECUTORS) {
  const row = db.prepare(RECOVER_ROW_SQL).get();
  if (row === undefined) return { moved: false, done: true, held: false };
  // A NULL column is the step's start (lib parseRecoverCursor); a stored text lib refuses is never a guess at where
  // to resume: restarting would read as progress on every pass and hide a stall from doctor.
  const storedCursor = parseRecoverCursor(row.cursor === null ? null : String(row.cursor));
  if (storedCursor === null) {
    process.stderr.write(`history-sweep: the recovery cursor ${JSON.stringify(String(row.cursor))} does not parse; the step waits\n`);
    countOutside(db, 'recover_chunk_failed');
    return { moved: false, done: false, held: false };
  }
  for (const sql of RECOVER_SCRATCH_DDL) db.exec(sql);
  const version = Number(row.version);
  // A listing that fails (the journal directory cannot be read) is a failed journal chunk below, not a throw out of the pass
  // and not an empty journal (D-4592).
  let listing;
  let listingError = null;
  try {
    listing = journalListing(ctx.paths, ctx.ids.storeId);
  } catch (e) {
    if (isBusy(e)) throw e;
    listingError = e;
    listing = { dir: `${ctx.paths.journalDir}/${ctx.ids.storeId}`, files: [], foreign: [], unreadable: [] };
  }
  const run = {
    version,
    P: ctx.paths,
    storeId: ctx.ids.storeId,
    budget: ctx.budget,
    now: ctx.now,
    dir: listing.dir,
    groups: orderJournalFiles(listing.files),
    foreign: listing.foreign,
    merged: new Map(),
    // replay: true: applyEventLine reads no switch whose state is today's (Task 11's recall_off_stale, §9.14).
    // belt: the pass's substring belt (§8.3 layer 4), set by recoverPass from its secrets step; Task 29's reindex phase
    // redacts node fields through it.
    ectx: { home: ctx.home, paths: ctx.paths, ids: ctx.ids, now: ctx.now, homes: ctx.homes, out: ctx.out, deps: ctx.deps, replay: true, belt: ctx.belt ?? null },
    pairsAdded: false,
    drained: new Set(),
    verdicts: new Map(),
    state: null,
  };
  const ticksAfter = Number(db.prepare('SELECT COALESCE(MAX(ts_ms), 0) AS t FROM ticks WHERE ts_ms < ?').get(version).t);
  // ticksBefore: the step's bind ms. replayStep answers no tick at or after it, so this executor bounds no tick itself.
  run.state = { storeId: run.storeId, file: null, recvMs: 0, drained: run.drained, verdictsByKey: run.verdicts, ticksAfter, ticksBefore: version };
  let cursor = storedCursor;
  run.pairsAdded = cursor.pairsAdded;
  const floorProbe = floorProbeFor(ctx.paths.dbDir, ctx.deps.statfs);
  let moved = false;
  for (;;) {
    if (!budgetLeft(ctx.budget)) return { moved, done: false, held: false };
    if (existsSync(ctx.paths.off)) return { moved, done: false, held: true };
    const floor = await floorProbe();
    if (floor !== 'ok') {
      if (floor === 'low-disk') countOutside(db, 'capture_paused_low_disk');
      return { moved, done: false, held: true };
    }
    try {
      // D-4592 (history-recover-unreadable-journal-fails-the-chunk): a journal file the step could not read is data it
      // never read. Its journal phases fail while one stands (the cursor unmoved, the step open), so a later tick retries
      // it once it reads; they never run past it, and it is never counted journal_head_mismatch.
      if (RECOVER_JOURNAL_PHASES.includes(cursor.phase)) {
        if (listingError !== null) throw new Error(`the journal directory cannot be listed: ${listingError.code ?? String(listingError)}`);
        if (listing.unreadable.length > 0) throw new Error(`a journal file cannot be read: ${listing.unreadable.join(', ')}`);
      }
      const exec = executors[cursor.phase];
      if (exec === undefined) throw new Error(`the recovery cursor names a phase this build does not run: ${cursor.phase}`);
      const r = await exec(db, run, cursor);
      moved = moved || r.moved;
      cursor = r.cursor;
      if (!r.phaseDone) {
        // Neither moved nor finished: calling it again this pass would spin out the budget on the write lock.
        if (!r.moved) return { moved, done: false, held: false };
        continue;
      }
      const at = RECOVER_PHASES.indexOf(cursor.phase);
      if (at === RECOVER_PHASES.length - 1) {
        finishRecovery(db, run, cursor);
        return { moved: true, done: true, held: false };
      }
      const next = { phase: RECOVER_PHASES[at + 1], file: null, offset: 0, blobId: null, groupSize: null, pairsAdded: run.pairsAdded };
      withTx(db, 'NORMAL', () => {
        if (at === 0 && run.foreign.length > 0) bump(db, 'journal_head_mismatch', run.foreign.length);
        db.prepare(RECOVER_CURSOR_SQL).run(formatRecoverCursor(next), version);
      });
      cursor = next;
      moved = true;
    } catch (e) {
      if (isBusy(e)) throw e;
      process.stderr.write(`history-sweep: a recovery chunk failed and was rolled back: ${e && e.message ? e.message : String(e)}\n`);
      countOutside(db, 'recover_chunk_failed');
      return { moved, done: false, held: false };
    }
  }
}

/** A scheduled pass on planRun's `recover` arm (§9.2 "While a recovery step is registered"). It runs:
 *  1. B1's tick prefix, items 1-6 of tick's doc comment, in that order: flushOutbox (a JournalError counted
 *     journal_write_failed, as tick counts it), makeIngestCtx, secretsStep with its redact records (and the pass's
 *     belt, kept on ctx for the step's executors), ftsPrepare, then reindexForValues and rederiveFts sharing one
 *     rederiveSlice of the run budget. They run whatever phase the step is at, the reindex phase's open index rebuild
 *     included: that rebuild deletes each blob's row before writing it, and an open generation cannot clear the
 *     belt-due record it writes (W1-B2 Task 25's ruling). tick's beltNodesStep is not part of this prefix;
 *  2. the step within the run budget. Below the free-space floor the step does not start, and
 *     capture_paused_low_disk +1;
 *  3. meta recover_unmoved_ticks (lib nextUnmovedTicks: reset by a move, kept by a hold, else one more);
 *  4. a ticks row, its lag unmeasured;
 *  5. the journal half.
 *  The drain and the ingest never run here, so no ingest cursor moves. It exits 0, as a tick does: status and doctor
 *  read the step's progress. */
export async function recoverPass(db, ctx, failedAtStart) {
  let busy = false;
  try {
    // B1's tick item 1: the outbox first, outside the run budget. With no writer token the rows wait in the DB.
    if (ctx.ids !== null) {
      try {
        flushOutbox(db, ctx.home, ctx.ids, ctx.now());
      } catch (e) {
        if (!(e instanceof JournalError)) throw e;
        countOutside(db, 'journal_write_failed');
      }
    }
    const ictx = makeIngestCtx(ctx.home, ctx.homes, ctx.now(), ctx.ids, floorProbeFor(ctx.paths.dbDir, ctx.deps.statfs));
    // A node rewrite on this pass (the late-pair fast path, the belt's node step) deletes nodes_fts rows, whose term bytes wait
    // until FTS5 merges them: it registers the merge step inside its own transaction, as the tick's context does. The reindex
    // phase's rebuild recreates nodes_fts only when the replay added a pair, so a pair from a secrets file needs this hook;
    // this pass runs no merge step, and the next ordinary tick merges. D-4609 (history-nodes-fts-merged-after-rewrite), H-158.
    registerNodesMerge(ictx, db);
    const secrets = secretsStep(db, ictx, ctx.parsed.secrets);
    ictx.pairIdx = secrets.pairIdx;
    ctx.belt = secrets.pairIdx.belt;   // §8.3 layer 4: recoveryStep hands it to its executors as run.ectx.belt (Task 29)
    ictx.fts = ftsPrepare(db, ictx.nowMs).tables;
    // B1's tick re-indexes within one slice shared by the phrase path and the hash re-derivation (review 344 F2); the
    // recover arm does the same, under any pause and whatever phase the step is at (Task 25's ruling: the reindex
    // phase's rebuild deletes each blob's row before it writes one). Both are async; un-awaited, the pass would close
    // the writer under them.
    const slice = rederiveSlice(ctx.budget);
    await reindexForValues(db, ictx, secrets.values, secrets.newValues, ctx.budget, slice);
    await rederiveFts(db, ictx, ctx.budget, slice);
    let r = { moved: false, done: false, held: true };
    if (ctx.pause === 'low-disk') bump(db, 'capture_paused_low_disk');
    else r = await recoveryStep(db, ctx);
    if (!r.done) {
      const prev = Number(getMeta(db, HEALTH_META.recoverUnmovedTicks) ?? '0');
      const n = nextUnmovedTicks({ prev: Number.isSafeInteger(prev) && prev >= 0 ? prev : 0, moved: r.moved, held: r.held });
      withTx(db, 'NORMAL', () => { setMeta(db, HEALTH_META.recoverUnmovedTicks, String(n)); });
    }
    recordTick(db, ictx, null);
  } catch (e) {
    if (isBusy(e)) busy = true;
    else {
      if (!(e instanceof JournalError)) throw e;
      countOutside(db, 'journal_write_failed');
    }
  }
  if (busy) return EXIT.OK;
  const unwritable = runJournalHalf(ctx.home, ctx.ids, ctx.now);
  try {
    if (unwritable) {
      bump(db, 'journal_write_failed');
      ctx.out('history-sweep: journal-unwritable');
    }
    setMeta(db, 'journal_unwritable', counterOf(db, 'journal_write_failed') > failedAtStart ? String(ctx.now()) : '');
  } catch (e) {
    if (!isBusy(e)) throw e;
  }
  return EXIT.OK;
}

// ── The binding verbs: doctor --adopt here; --restore and --rebuild from W1-B2 Tasks 27 and 28 (spec §8.4) ──────
// They run as --op passes under the shim's lock, and BEFORE openStore, which refuses exactly the states they exist to
// repair (store-unbound, store-missing, store-recoverable). By then runOpPass has already run:
//   - decideOpGate: CLAUDECODE, a TTY, not a cc- pane. The three binding forms alone pass under history-off
//     (D-4181);
//   - the role check;
//   - the lock-take journal half and the statfs probe;
//   - decideOpGate again with a registered recovery step measured (recoverStepAt): adopt is refused `recovering` on a
//     bound store and passes on an unbound one, store.id absent, which no pass can open until it is bound (RB14);
//     restore and rebuild are never refused, and they replace the step (RB6; D-4698 (history-ops-refused-while-recovering)).
// Each verb then:
//   1. removes the writer temps a killed pass left. The lock is held, so every temp is stale (§9.4);
//   2. measures the store's facts, its stored user_version among them, and lets lib's decideBind decide (L1). A
//      store newer than this build is decideBind's refusal too (RB17): no arm compares versions itself;
//   3. writes the op marker and runs store.mjs's sequence (L3). Every DB-side binding fact is committed before a
//      binding file names the store (D-4724 (history-binding-facts-before-link));
//   4. finishBind: opens the store as any pass does, then flushes its outbox, so the `bind` record lands in
//      journal/<store_id>/<YYYY-MM>.<new writer>.jsonl (D-4226). Then the release
//      journal half. An exit 0 therefore means the bind is in the fsynced journal (§8.4 "Every writing form
//      flushes its outbox before it exits 0").

/** decideBind's inputs (lib BindFacts): measureStoreFacts, measured afresh on every call, plus this build's schema
 *  version, history.db's own user_version (storedVersionAt, a Presence: absent with no DB, unreadable when it will
 *  not read; RB17's fact), and what the verb names. measureStoreFacts goes first: its -wal/-shm reads must come before
 *  any read-only open, which creates both. `extra` carries what the verb names: a backup (restore, Task 27), a
 *  --store-id and the journal directories (rebuild, Task 28). adopt names none of them, so they stay empty. */
function bindFactsOf(home, role, deps, extra = {}) {
  return {
    ...measureStoreFacts(home, role),
    // openStore's own expression (B1 sweep.mjs `const code = …`), as Task 19's RB6 fact counts it: deps.schemaAdded
    // and deps.migrations are separate seams, so a bare MIGRATIONS length would only coincide with it.
    codeVersion: deps.migrations === undefined ? SCHEMA_VERSION : deps.migrations.length,
    storedVersion: storedVersionAt(historyPaths(home).dbFile),
    storeIdArg: null,
    journalDirs: [],
    backup: null,
    ...extra,
  };
}

/** The clause a binding verb's refusal or stop line ends with (H-99): under `--json`, or at the direct `--op` door, the CLI's
 *  operator note is not on the page, and a detail that tells the reader to act (lib's "adopt it with the build that wrote
 *  it", "name one with --store-id") must still say whose act it is. R-X-OPERATOR. */
const OPERATOR_ACTS = '; the operator acts on it, from a terminal outside any session';

/** A binding verb's close, once history.db is visible and bound:
 *  - the ordinary open, which also finishes a pending marker, removes stale temps and syncs meta.writer;
 *  - the `bind` record, flushed into journal/<store_id>/ under the new writer token;
 *  - the release journal half.
 *  A store that does not open answers its word when the word is an exit-5 REASONS word, else exit 1, as runOpPass
 *  answers it; the bind waits in the outbox for a pass that opens the store. A newer schema never gets here:
 *  decideBind refuses it before any write, adopt's newer store from bindFactsOf's storedVersion (RB17) and restore's
 *  newer backup from the staged copy, and rebuild creates at this build's version. A journal that cannot be appended is exit 1, as runOpPass answers it; the bind row stays in the
 *  outbox, and the next pass flushes it. That answer carries `counted: true`: the failure is said and counted here, on
 *  the open store, so opPass's `released` (which runs the half at release once more, with the writer closed) does not
 *  say it twice, as B1's opBody hands its own `counted` to it. */
function finishBind(home, P, role, deps, out, now) {
  const opened = openStore(home, P, role, deps);
  if ('word' in opened) {
    out(`history-sweep: the store is bound but does not open yet: ${opened.word}${OPERATOR_ACTS}`);
    return REASONS[opened.word] === EXIT.DB ? { rc: EXIT.DB, reason: opened.word } : { rc: EXIT.INTERNAL };
  }
  const { db, ids } = opened;
  try {
    if (ids === null) {
      out('history-sweep: store.writer cannot be read, so the bind record could not be journaled');
      return { rc: EXIT.DB, reason: 'store-unmeasured' };
    }
    flushOutbox(db, home, ids, now());
    if (runJournalHalf(home, ids, now)) throw new JournalError('append-failed');
    return { rc: EXIT.OK };
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    bump(db, 'journal_write_failed');
    out('history-sweep: journal-unwritable');
    return { rc: EXIT.INTERNAL, counted: true };
  } finally {
    closeWriter(db);
  }
}

/** `doctor --adopt` (§8.4; D-4692 (history-adopt-verb)): bind a store that is present without store.id to this box.
 *  It is the only binding of an unbound store; the sweep never adopts (D-4186).
 *  decideBind refuses (rc 2 adopt-refused) when:
 *  - store.id is present, whether equal (nothing to adopt) or not (two stores claim this box);
 *  - a pending marker names the DB's own id (the next tick finishes that creation);
 *  - the DB has no readable meta.store_id;
 *  - the DB's user_version is newer than this build's: refused before the op marker or any write, as openStore
 *    refuses it before ITS writer's open (G9; DM17 "no write"). The comparison is decideBind's (L1, RB17), over
 *    bindFactsOf's storedVersion; this arm only measures and relays.
 *  It refuses with rc 5 store-unmeasured when a binding input, the user_version included, cannot be read.
 *  On success, store.mjs's adoptStore commits `bound:<ms>` = adopt, a new writer token and the `bind` row, then
 *  writes store.writer, then store.id (D-4220). Adopt registers no recovery step: the store
 *  is whole, it only moved (RC16). The carry line repeats §8.4's remedy, because the journal and the export are
 *  keyed by the store's id, not by this box; adopt prints it itself (RB11), and HEALTH_REMEDIES is unchanged. */
export async function adoptArm(home, P, args, deps, out) {
  const now = deps.now ?? Date.now;
  const role = readRole(P);
  removeStaleTemps(home);
  const d = decideBind('adopt', bindFactsOf(home, role, deps));
  if (!d.ok) {
    out(`history-sweep: ${d.reason}: ${d.detail}${OPERATOR_ACTS}`);
    return { rc: d.rc, reason: d.reason };
  }
  removeStaleOpMarker(P);   // H-101: a planted entry at op would fail the marker's rename (EISDIR) before any open clears it
  writeOpMarker(P, 'adopt', now());
  try {
    const bound = adoptStore(home, { nowMs: now() });
    const id = bound.storeId;
    out(`history-sweep: adopt: store ${id} is this box's now, under writer ${bound.writer}`);
    out(`history-sweep: the operator, from a terminal outside any session: if the box this store left still has ~/.ccrc/history/journal/${id}/ or ~/.ccrc/history/export/${id}/, copy each to the same path here (~/.ccrc/history/journal/${id}/, ~/.ccrc/history/export/${id}/); their file names never collide with this box's`);
    return finishBind(home, P, role, deps, out, now);
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    out(`history-sweep: adopt stopped: ${e.message}${OPERATOR_ACTS}`);
    return REASONS[e.word] === undefined ? { rc: EXIT.INTERNAL } : { rc: REASONS[e.word], reason: e.word };
  } finally {
    // B1's type-aware removal, as opPass's own finally and removeStaleOpMarker use (B1's
    // history-planted-entries-never-wedge): an rmSync with force throws EISDIR on a directory planted at `op`.
    removeEntry(P.op);
  }
}

/** The binding verbs' one entry from runOpPass. It is called for every BINDING_OPS member, after the gate and the
 *  lock-take journal half, before openStore. `args` is the op's parsed OpArgs (lib parseOpVerbArgs, Task 6); adopt
 *  takes none. W1-B2 Tasks 27 and 28 put their `restore` and `rebuild` dispatch lines first in this body. */
export async function bindingPass(home, P, op, args, deps, out) {
  if (op === 'restore') return restoreArm(home, P, args, deps, out);
  if (op === 'rebuild') return rebuildArm(home, P, args, deps, out);
  if (op === 'adopt') return adoptArm(home, P, args, deps, out);
  out(`history-sweep: ${op} is not a binding verb this build runs`);
  return { rc: EXIT.REFUSED, reason: 'bad-args' };
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
 * @property {object} [firstRows]  set by tick: the location rule's per-tick memory (newFirstRowCache, review 316 F16)
 * @property {object[]} [planned]  set by Task 18's discovery step: the files bound this tick (Task 19's ingest
 *   discovers and binds per path instead, and leaves it unset)
 * @property {boolean} ingest  planRun's verdict: false under a cap or floor pause (Task 19)
 * @property {object} budget  the run's ONE budget, newBudget(now), spent by every step that reads the disk (Task 19)
 */
/** The bound store's tick (§9.2; D-4224, slug history-tick-order), handed an open writer connection. The steps, in the
 *  order the body runs them (a test reads this list against the body, review 316 F39):
 *  1. `flushOutbox`: verdict rows a crash left behind reach the journal first, outside the run budget (with no writer
 *     token the rows wait in the DB);
 *  2. `makeIngestCtx`: the tick's one ingest context, shared by the secrets, the ingest, the launch facts and the
 *     ticks row;
 *  3. `secretsStep`: every pair committed and journaled before any drain or FTS insert, and the context's pairIdx;
 *  4. `ftsPrepare`: §9.1's probe at every open, which sets the context's `fts`;
 *  5. `reindexForValues`: the same-tick phrase fast path over the values this tick loaded, or, while a generation is
 *     open, over those whose pairs this tick recorded; it never moves the mark;
 *  6. `rederiveFts`: the hash re-derivation of every indexed blob, which alone moves the durable reindex mark
 *     (D-4344); it runs under any pause, and it and step 5 share one per-tick slice of the run budget (review 344 F2);
 *  7. `beltNodesStep`: §6.2 "The belt": while ('nodes-belt', 1) is open, every node's stored fields re-redacted
 *     in the slice steps 5 and 6 share; it writes only the nodes the redaction changes (W1-B2 Task 29);
 *  8. `drainSpool`: the journal-first drain of the spool (§9.14), whose hints feed the ingest; the per-tick first-row
 *     cache (`newFirstRowCache`) is made just before it and shared by the drain's location rule and step 9's;
 *  9. `confirmCandidates`: startup and resume lines awaiting `.uuid`, and clear epochs awaiting `.uuid` or their
 *     location, each decided in its own FULL transaction;
 * 10. `registryBackfill`: only when `scanDue` says the periodic scan is due, every `$REG/<id>.uuid` that names no
 *     epoch becomes a registry mapping, committed before any ingest chunk can need it (D-4297);
 * 11. `ingestTick`: discovery, admission and the chunked read under the run's ONE budget, unless a cap or floor pause
 *     (`ctx.ingest` false) or an unreadable roster holds it; a busy database ends the tick here;
 * 12. `backfillEpochFacts`: launch facts an epoch chained after its transcript's first chunk missed, after an ingest;
 * 13. `resetFtsPending`: blobs this tick wrote but could not index re-open the completed FTS backfill;
 * 14. `deriveFts`: §9.1 derivation ('fts', 1)'s backfill within what is left of the budget, held with the ingest
 *     (D-4242) and when Task 19's per-chunk floor stopped it;
 * 15. `deriveNodes`: the leaves from the boundaries stored so far (§9.2 step 6; W1-B2 Task 8), held with the ingest
 *     and the FTS backfill (a node grows db/, §9.3) and run after the backfill, so a new node's nodes_fts row is
 *     written in a tick whose tables exist;
 * 16. `cardStep`: §9.2 step 6 under the derivation's gate: the card delivery measure, then the card/ predictions
 *     consumed, deleted and written (card.mjs; W1-B3 Tasks 5 and 6);
 * 17. `withdrawCards`: every card/ prediction unlinked when this tick ran no card step over a caught-up ingest
 *     (ruling RC2: fail closed; lib decideCardWithdraw names the reason), and, on a pass that kept the rest, the
 *     predictions of the sessions whose transcript copy ingest skipped (a read error), admission refused or whose parse crashed this tick
 *     (D-5061 (history-card-withdraw-on-a-skipped-copy));
 * 18. `mergeSteps`: §6.2's merge steps, which run under any pause: they free space rather than take it;
 * 19. `recordTick`: the tick's row and journal record (a paused ingest records an unmeasured lag);
 * 20. `collectPurgedHistoryFiles`: at a due scan, the scope markers and card directories of purged sessions,
 *     7 days on (card.mjs; W1-B3 Task 7);
 * 21. `markScan`: a due scan is marked done, unless the roster was unreadable;
 * 22. `exportStep`: §9.2 step 6, last (W1-B4): the export pass, at most once an hour, with a writer token only,
 *     outside the ingest gate, behind its own floor on the home filesystem;
 * 23. `ensureHistoryDirs`: last, below the spool/ line the next sentence names, scope/ and card/ made 0700, a link
 *     or a file there refused and counted (card.mjs; W1-B3 Task 5).
 *  Then spool/ is made unless something that is not a directory stands there (FU8) (the hook's gate is that directory, and
 *  the hook never makes it, §5.1, so a box with no bound store spools nothing) and an unreadable roster is counted, once per pass (FE4, O54); the scheduled pass runs
 *  `periodicCensus` after the tick. `bump` and `countOutside` are counters, not steps. */
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
  // A node rewrite deletes nodes_fts rows, whose term bytes stay until FTS5 merges them: the rewrite registers the merge
  // step inside its own transaction, as the blob re-index does (D-4609 (history-nodes-fts-merged-after-rewrite)).
  registerNodesMerge(ictx, db);
  // §9.2 "Then the secrets": every pair committed and journaled before any drain or FTS insert.
  const secrets = secretsStep(db, ictx, ctx.parsed.secrets);
  ictx.pairIdx = secrets.pairIdx;
  // §9.1 the probe at every open, then §6.2: every pair whose re-index is still owed (a pair learned this tick, or
  // one a dead pass committed) re-indexes before any FTS insert, within the tick's re-index slice, in two steps
  // (D-4344, history-reindex-mark-by-rederivation). First the phrase fast path over the values this tick loaded, or,
  // while a generation is open, over those whose pairs this tick recorded; then the hash re-derivation of every
  // indexed blob, which alone moves the durable mark. Both run before any FTS insert of the tick and under any
  // pause; the one slice of the run budget the two share keeps capture going, and what the slice leaves is finished
  // on later ticks by the re-derivation (review 344 F2).
  ictx.fts = ftsPrepare(db, ictx.nowMs).tables;
  const slice = rederiveSlice(ctx.budget);
  await reindexForValues(db, ictx, secrets.values, secrets.newValues, ctx.budget, slice);
  await rederiveFts(db, ictx, ctx.budget, slice);
  // §6.2 "The belt": while ('nodes-belt', 1) is open, every node's stored fields re-redacted, in the slice the two
  // re-index steps share; it writes only the nodes the redaction changes (W1-B2 Task 29).
  beltNodesStep(db, ictx, slice);
  // Step 1, the drain: journal first, then the FULL drain transaction, then its verdicts, then the unlink (§9.14).
  // runPass never ticks without both binding names: a missing store.writer is a hold there (§9.10 "Writer token").
  // F16: one transcript index and one first-row memory per tick, shared by the drain's location rule and the candidates' (confirmClear) below
  ctx.firstRows = newFirstRowCache();
  // A failed or refused drain never proves its remaining receipt set empty.
  ctx.pendingReceiptState = { kind: 'unmeasured' };
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
  // series has no hole. The re-index above (the phrase path and the hash re-derivation, D-4344) and the merge
  // steps below run under any pause: a learned pair's re-index obligation is durable (meta fts_reindex_rid,
  // moved only by a completed re-derivation, with its cursor in meta fts_rederive), so a tick that cannot
  // index leaves it to the next tick that can, and a merge step frees space rather than takes it. The FTS backfill is
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
  if (ctx.ingest && !(ing !== null && ing.paused)) await deriveFts(db, ictx, ctx.budget);
  // Derive, nodes (W1-B2 Task 8): leaves from the boundaries stored so far, under the FTS backfill's gate, because a
  // node grows db/ (§9.3), and after it, so a new node's nodes_fts row is written in a tick whose tables exist.
  // A receipt file newly renamed in this tick is deliberately not read until the next one. A complete spool census
  // narrows its bounded candidate session UUIDs; an unmeasured census holds every leaf. deriveNodes is synchronous. D-4224
  ictx.pendingReceiptState = ctx.pendingReceiptState;
  if (ctx.ingest && !(ing !== null && ing.paused)) deriveNodes(db, ictx, ctx.budget);
  // §9.2 step 6, after the leaves and parents (W1-B3 Task 5): measure card delivery, then consume and write the
  // card/ predictions, under the derivation's gate. A tick that does not reach the card step over a caught-up ingest
  // (a cap or floor pause, a per-chunk floor stop, an ingest an unreadable roster skipped, a budget spent before the
  // step) withdraws every prediction instead, fail closed: lib decideCardWithdraw names the reason (ruling RC2). The
  // budget is read here, before the step. D-4224 D-4740 (history-card-withdrawn-when-not-ticking)
  const cardPass = { arm: 'run', pause: ctx.pause, floorStop: ing !== null && ing.paused, ingested: ing !== null, budgetLeft: budgetLeft(ctx.budget) };
  if (ctx.ingest && !(ing !== null && ing.paused)) cardStep(db, ictx, ctx.budget);
  withdrawCards(db, ctx.home, cardPass, ctx.out, ing === null ? undefined : ing.skipped);   // D-5061: and a skipped copy's session
  // §6.2's merge steps run under any pause (§9.2: only ingest pauses): they purge a late pair's deleted bytes and
  // free space rather than take it.
  mergeSteps(db, ictx, ctx.budget);
  // §9.2 step 6: the tick's row and journal record. A paused ingest records an unmeasured lag.
  recordTick(db, ictx, ing);
  // §9.4 (W1-B3 Task 7): the scope markers and card directories of purged sessions, 7 days on, at the periodic scan.
  if (scan) collectPurgedHistoryFiles(db, ctx.home, ctx.now());
  if (scan && !ctx.rosterUnreadable) markScan(db, ctx.now());
  // §9.2 step 6, last (W1-B4): the export pass, after the ticks row and the tick record, at most once an hour (exportStep).
  // It is OUTSIDE the ingest gate: under a cap or db-floor pause text keeps ageing toward its source's deletion, and the
  // export has its own floor, on the home filesystem (D-4762 (history-export-outside-capture-pause)).
  if (ctx.ids !== null) await exportStep(db, ctx);
  // <<< history tick steps
  // FU8 (D-4347 (history-planted-entries-never-wedge)): never over a planted entry, which the drain refused and counted; a
  // file or a dangling link there failed this mkdir on every pass (FP3).
  if (dirKind(ctx.paths.spool) !== 'other') mkdirDurable(ctx.paths.spool);
  ensureHistoryDirs(db, ctx.home);
  if (ctx.parsed.rosterUnreadable) bump(db, 'roster_unreadable');
}

// ── THE PASS (Task 24) ────────────────────────────────────────────────────────────────────────────
// One composition for the run, the pause and the hold (spec §9.2 "The order of a tick", §9.3, §9.14
// "Holds", §6.11; D-4224, slug history-tick-order). A scheduled pass decides in this order, and an earlier
// answer ends it:
//   history-off (§9.7) → the recorded role (§6.9) → the free-space probe, which is ALSO the
//   reachability probe and therefore runs before anything stats the volume (§9.3; slug
//   history-store-unreachable) → `openStore`: the binding (decideStoreOpen) → stale temps → (drop a pending
//   creation →) create → a newer schema, refused with NO write and BEFORE finish-pending (G9, DM17, D-4301) →
//   finish-pending → open, WAL (store-not-wal, §6.2) → the writer mirror and the stale op marker → a `held` hold
//   when store.writer cannot name the journal (§9.10 "Writer token") → the outbox, first and outside the budget
//   (§9.14) → `clearDoneMarkers` → the migration verdict (§6.11), which first removes every stale migration
//   temp (D-4339) → planRun's arm: migrate, hold, or run with its cap or floor pause (`fixModes`, then the
//   tick) → after the tick, the periodic census (`periodicCensus`) and meta `journal_unwritable`.
// "The journal half runs whenever the drain cannot" (§9.2; D-4231, slug history-journal-observation-sidecar):
// every hold renames, observes and journals the spool with the two names read from store.id and
// store.writer ON THE HOME FILESYSTEM, never from meta (DI5; D-4220, slug history-store-writer-file), so a held
// startup line keeps the registry facts of its rename (O46). Under a cap or floor PAUSE only ingest
// stops; the drain and its journal append still run, so epoch confirmation stays timely (§9.2).

/** Bytes of a file, trimmed, or null when it cannot be read. */
function readTrimmed(p) {
  const r = readBounded(p, CONTROL_FILE_MAX, false);
  return r.state === 'value' ? r.value.trim() : null;
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
  const f = readBounded(P.ccrcEnv, CONTROL_FILE_MAX, true);
  if (f.state !== 'value') return '';
  const r = readBoxEnvValue(f.value, 'CCRC_ROLE');
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
  withdrawCards(null, home, { arm: 'hold', word }, out);   // W1-B3 (ruling RC2): no DB is open, so the count is a line
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
  removeStaleAtomicTemps(home);
  if (verdict.act === 'drop-pending-create') {
    dropPending(home);
    verdict = { act: 'create' };
  }
  if (verdict.act === 'create') createStore(home);
  const code = deps.migrations === undefined ? SCHEMA_VERSION : deps.migrations.length;
  let stored;
  try {
    stored = peekVersion(P.dbFile);
  } catch (e) {
    if (e instanceof StoreError) return { word: e.word };
    throw e;
  }
  if (stored > code) return { word: 'schema-newer' };
  // D-4599 (HI2 H-162): the reader answers a version below 1 as store-schema-missing, so the writer refuses it with the same
  // word before the pending finish or the WAL open, and never plans a migration from MIGRATIONS[0] over tables that exist.
  if (storeVersionDamaged(stored)) return { word: 'store-schema-missing' };
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
  removeStaleOpMarker(P);
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
  // D-4339 (history-migration-temp-precleaned): every stale pre-migration temp is removed HERE, before the room
  // check and on every pass that measures migration room (a verdict of 'none' included: a temp for an older target
  // is stale whenever a pass holds the lock), and the bytes it held count as room. `o.free` was measured earlier in
  // this pass, with the temp still on disk, so a partial copy would otherwise be charged against the very check
  // that lets its replacement run.
  const reclaimed = removeStaleMigrationTemps(home).bytes;
  if (o.stored === o.code) return 'none';
  // The ONE walk of the range for a heavy version (lib's heavyVersionsBetween): doctor's printed estimate calls the same function.
  const heavy = heavyVersionsBetween(o.stored, o.code, o.schemaAdded).length > 0;
  const bps = Number(getMeta(db, 'copy_bps'));
  const measured = o.free.state === 'ok';
  return planMigration({
    stored: o.stored,
    code: o.code,
    freeBytes: measured ? o.free.bytes + reclaimed : 0,
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
    // deps.budget is an in-process limit (maxMs, maxBytes, chunkBytes) for tests only; absent, lib's run budget applies
    // (W1-B2 Task 25; slug history-test-seams-not-env).
    budget: newBudget(o.now, o.deps.budget ?? {}),
  };
}

/** A process's identity, measured now from /proc: its start time (field 22 of /proc/<pid>/stat) and the boot id, or null
 *  when either cannot be measured (no /proc, a dead pid, a zombie, an unreadable or malformed file). The pass marker
 *  records it beside the pid, and status measures it again, so a reused pid never reads as the pass (D-5016). */
export function procIdentityOf(pid) {
  try {
    const procStart = procStartOf(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    const bootId = bootIdOf(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
    return procStart === null || bootId === null ? null : { procStart, bootId };
  } catch {
    return null;
  }
}

/** D-5026 (history-pass-death-record): before a scheduled pass writes its own marker it reads the one it finds. No marker is no
 *  death (the previous pass ended through its `finally`). A marker that parses and whose pass is LIVE is no death either (it cannot
 *  happen under the sweep lock; the pass goes on as it did). A marker with no live pass behind it is a pass that ended without its
 *  `finally`: the carrier's kill at 10 min (the unit's TimeoutStartSec), the OOM killer, a SIGKILL. A marker that is there and cannot be
 *  read or parsed is a death of an unknown pass (pid null; its start is bounded above by THIS pass's start). Either is recorded in
 *  `pass-died` (pid, start, this pass's start, and the count of deaths recorded since the record was last cleared: the previous
 *  record's plus one when a parseable record stands, else 1), and doctor FAILs until a pass writes a tick, which removes the record
 *  (`clearPassDied`). The count normally equals the deaths since the last tick, and over-counts when a record outlives a tick (a clear
 *  that was cut off, or a death recorded for a pass that had already ticked); the FAIL itself does not read it.
 *  Answers false only when the record could not be written: the caller then leaves the dead marker standing, which doctor reads as
 *  the same death. */
function recordPassDeath(P, startMs) {
  const found = readBounded(P.pass, CONTROL_FILE_MAX, false);
  if (found.state === 'absent') return true;
  let pid = null;
  let deadStartMs = startMs;
  if (found.state === 'value') {
    const pm = parsePassMarker(found.value.trim());
    if (pm !== null) {
      if (decidePassLive(pm, procIdentityOf(pm.pid))) return true;
      pid = pm.pid;
      deadStartMs = pm.startMs;
    }
  }
  return writePassDied(P, pid, deadStartMs, startMs);
}

/** The record's one writer (D-5026): `pid` and `deadStartMs` name the pass that ended without its tick, `foundMs` is when it was
 *  found (the next pass's start for a kill, the dying pass's own clock for a throw), and the count is the previous parseable
 *  record's plus one, else 1. Answers false when the write failed. */
function writePassDied(P, pid, deadStartMs, foundMs) {
  const prior = readBounded(P.passDied, CONTROL_FILE_MAX, false);
  const was = prior.state === 'value' ? parsePassDied(prior.value.trim()) : null;
  try {
    writeFileAtomic(P.passDied, formatPassDied(pid, deadStartMs, foundMs, was === null ? 1 : was.count + 1), 0o600);
    return true;
  } catch {
    return false;
  }
}

/** Removed once a pass's ticks row is committed (recordTick): only a tick written by a pass that ran clears the death record. Best
 *  effort: a leftover whose start is at or before the last tick is closed by doctor's comparison alone. A held, migrating or
 *  refused pass writes no tick and never reaches this. */
function clearPassDied(home) {
  try { removeEntry(historyPaths(home).passDied); } catch { /* closed by the comparison against the last tick */ }
}

/** Written under the lock when a scheduled pass starts (D-5016 history-doctor-reads-a-live-pass): the pass's pid, its start
 *  and its identity. A pass that cannot measure its own identity (no /proc) writes none, and a write that fails (no history
 *  root yet) is skipped: the marker is evidence for doctor and never a condition of the pass, and no marker reads as no
 *  live pass, which is how the box was judged before. The marker it finds is recorded as a death first (recordPassDeath, D-5026);
 *  a stale one is then overwritten, or removed when none can be written. Answers true when this pass owns the name (the marker
 *  it wrote, or tried to), and false when it left the name alone: a pass whose death record could not be written leaves the dead
 *  marker standing, so doctor still sees it. Only an owner removes the marker (removePassMarker). */
function writePassMarker(P, nowMs) {
  let owned = false;
  try {
    const identity = procIdentityOf(process.pid);
    if (identity === null) {
      removeEntry(P.pass);
      return false;
    }
    if (!recordPassDeath(P, nowMs)) return false;
    removeEntry(P.pass);
    owned = true;
    writeFileAtomic(P.pass, formatPassMarker(process.pid, nowMs, identity), 0o600);
  } catch { /* evidence only: the pass goes on without it */ }
  return owned;
}

/** Removed when the pass ends, on every exit path (scheduledPass's finally), by the pass that wrote it only (`owned`): a pass
 *  that left a dead marker standing for doctor (its death record could not be written) must not remove it (D-5026). A killed
 *  pass leaves its marker, which reads as not live (its identity no longer measures) and which the next pass records and overwrites. */
function removePassMarker(P, owned) {
  if (!owned) return;
  try { removeEntry(P.pass); } catch { /* a leftover reads as not live */ }
}

/** One scheduled pass (no --op). Returns its exit: 0 for a run, a pause or a hold; 5 for a refusal. */
export async function scheduledPass(parsed, deps, out) {
  const P = historyPaths(deps.home);
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
  // D-5016: the pass marker stands from here, before any long step, to the pass's end. D-5026: a marker found here is recorded as a
  // death before it is overwritten, and a pass that could not record it leaves it standing and runs without a marker of its own.
  const startMs = now();
  const owned = writePassMarker(P, startMs);
  try {
    return await scheduledPassBody(parsed, deps, out, P, now, role);
  } catch (e) {
    // D-5026: a pass that ends by an exception ran its `finally`, so it leaves no marker for the next pass to find; it writes no tick,
    // and it records its own death here, before the finally removes its marker (pid and start its own, found_ms now). Best effort: a
    // failed write changes nothing else. A pass that RETURNS (held, migrated, refused, busy, run) records nothing.
    try { writePassDied(P, process.pid, startMs, now()); } catch { /* evidence only */ }
    throw e;
  } finally {
    removePassMarker(P, owned);
  }
}

async function scheduledPassBody(parsed, deps, out, P, now, role) {
  const home = deps.home;
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
      withdrawCards(db, home, { arm: 'hold', word: 'held' }, out);   // W1-B3 (ruling RC2)
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
    const run = planRun({ historyOff: false, store: { act: 'open' }, free, sizeBytes, capGb: cap.gb, migration, recovering: isRecovering(db) });
    // W1-B3 (ruling RC2, fail closed): the migrate, recover and hold arms never reach the card step, so each withdraws
    // every prediction here, before it runs; the run arm decides in the tick, over the tick's own facts.
    if (run.arm !== 'run') withdrawCards(db, home, { arm: run.arm, word: run.holdWord ?? 'held' }, out);
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
    if (run.arm === 'recover') {
      // W1-B2 Task 25 (§9.2 "While a recovery step is registered"; D-4224): a restore or a rebuild
      // registered a recovery step, and the store is at this build's version (planRun decided the migration first).
      // This pass runs B1's tick prefix (the outbox, the secrets, the FTS probe, the re-index and the hash re-derivation),
      // then the step, a ticks row and the journal half, in recoverPass's doc comment's order; the drain and the ingest wait.
      setMeta(db, 'migration', migration);
      setMeta(db, 'capture_pause', run.pause ?? '');
      fixModes(db, P);
      return await recoverPass(db, passCtx({ home, P, ids, parsed, now, out, deps, pause: run.pause, ingest: false }), failedAtStart);
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
      // D-5027 (history-held-pass-is-fresh-for-tick-stale): a held pass is a pass that ran and ended as designed. It writes no tick, so
      // doctor would FAIL tick-stale beside the hold's own FAIL; this stamp lets deriveHealth read it as fresh for that FAIL only.
      setMeta(db, HEALTH_META.heldPassMs, String(now()));
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
      periodicCensus(db, ctx);
      setMeta(db, 'journal_unwritable', counterOf(db, 'journal_write_failed') > failedAtStart ? String(now()) : '');
    } catch (e) {
      if (!isBusy(e)) throw e;
    }
    return EXIT.OK;
  } finally {
    closeWriter(db);
  }
}

/** D-4600 (history-operator-door-survives-a-closed-pipe): the default `out` writes the sweep's lines to stdout, and a reader
 *  that has gone (`ccd-history-sweep --op … | head -1`, or `2>&1 | head -1` for the stderr lines the pass prints itself)
 *  makes the next write an EPIPE 'error' event that, unhandled, kills the pass mid-op (the store survives a crash; the
 *  operator loses the result). This swallows EPIPE alone on both streams, so the op runs to its end and its exit code
 *  stands, and rethrows any other stream error. The listener is `.on`, never `.once` (HI2 H-199): after an EPIPE Node's
 *  stdio stream is NOT destroyed (stdio's dummyDestroy un-destroys it), so every later write retries the syscall and emits a
 *  fresh EPIPE (measured on Node 24.14.1: 49 events over 50 writes), and a `.once` listener would crash on the second. */
let stdioGuarded = false;
function stdoutOut() {
  if (!stdioGuarded) {
    stdioGuarded = true;
    for (const stream of [process.stdout, process.stderr]) {
      stream.on('error', (e) => {
        if (e && e.code === 'EPIPE') return;
        throw e;
      });
    }
  }
  return (line) => { process.stdout.write(`${line}\n`); };
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
  const out = deps.out ?? stdoutOut();
  const prevUmask = process.umask(0o077);
  try {
    const parsed = parseSweepArgv(argv);
    if ('error' in parsed) {
      // Task 14's one spelling of the argv grammar; its argv case pins `usage: sweep.mjs`.
      process.stderr.write(`history-sweep: ${USAGE}\n`);
      return EXIT.REFUSED;
    }
    if (parsed.op !== null) return await runOpPass(parsed, deps, out);
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
    // D-4589 (history-prune-revives-a-tombstone-on-recapture): a tombstone holds no body, so "already stored" means a row whose
    // z is not NULL (blobLive), and the insert revives a tombstone; a stored body is never rewritten.
    blobLive: db.prepare('SELECT blob_id FROM blobs WHERE sha256 = ? AND z IS NOT NULL'),
    blobIns: db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) ON CONFLICT(sha256) DO UPDATE SET codec = excluded.codec, z = excluded.z, raw_len = excluded.raw_len, pruned_ms = NULL WHERE blobs.z IS NULL'),
    blobZ: db.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?'),
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
    // W1-B4 Task 8 (§9.15 "Mark"): a variant first seen after its entry was exported clears the entry's marks, so the
    // next export pass writes the entry again with every variant (O39); so does a sidecar row first linked to it.
    exportClear: db.prepare('UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE entry_id = ? AND exported_ms IS NOT NULL'),
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
    pairSel: db.prepare(`SELECT e.parent_uuid AS parent_uuid, b.z AS z, b.raw_len AS raw_len FROM entries e
      JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?`),
    pathRow: db.prepare('SELECT file_id FROM file_paths WHERE path = ?'),
    rowPaths: db.prepare('SELECT path FROM file_paths WHERE file_id = ?'),
    markGone: db.prepare("UPDATE ingest_files SET status = 'gone' WHERE file_id = ? AND source_key = '' AND status = 'live'"),
  };
  INGEST_STMTS.set(db, s);
  return s;
}

/** A stored blob's bytes parsed as JSON, behind lib's structure gate (D-4345, history-json-structure-bound). A body
 *  stored from a parsed row is within the bound by construction (blobBodyOf takes a subtree of a line that passed the
 *  gate, and canonical JSON adds no structure), so only a raw-only blob is refused: one a row reaches by naming a raw
 *  row's key as its uuid. The refusal is a SyntaxError, which each caller already folds exactly as it folds a blob that
 *  does not parse. */
export function parseStoredJson(bytes) {
  if (!jsonWithinStructureBound(bytes)) throw new SyntaxError('stored blob is over the JSON structure bound');
  return JSON.parse(bytes.toString('utf8'));
}

/** A stored body, parsed; null for a tombstone, a body that is not JSON, or one over the structure bound (D-4345), or one
 *  whose raw_len is over BLOB_DECODE_MAX, which is never decompressed (D-4346). */
export function storedBody(s, blobId) {
  const r = s.blobZ.get(blobId);
  if (r === undefined || r.z === null) return null;
  if (blobOverDecodeCap(r.raw_len)) return null;   // D-4346 (history-permanent-failures-classified): an over-cap body is never decoded whole for the variant compare
  try { return parseStoredJson(unbrotli(r.z, r.raw_len)); } catch { return null; }
}

/** The tool_use a tool_result answers, when it was written in an earlier tick: walked up the
 *  stored `parentUuid` chain, PAIR_WALK_HOPS at most. null when not found. provenanceOf then
 *  classifies the result as plain `tool`, the searchable side. */
export function pairedFromStore(db, toolUseId, parentUuid) {
  const s = stmts(db);
  let uuid = parentUuid;
  for (let hop = 0; hop < PAIR_WALK_HOPS && typeof uuid === 'string'; hop += 1) {
    const r = s.pairSel.get(uuid);
    if (r === undefined) return null;
    if (r.z !== null) {
      if (blobOverDecodeCap(r.raw_len)) { uuid = r.parent_uuid; continue; }   // D-4346: an over-cap body is never decoded whole; walk on to its parent
      try {
        const u = toolUsesOf(parseStoredJson(unbrotli(r.z, r.raw_len))).find((x) => x.id === toolUseId);
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

/** The stored `raw_len` of a row blob: its UTF-8 byte length. The measure the over-cap gate reads (B3M2, FU5). */
function rowRawLen(json) { return Buffer.byteLength(json, 'utf8'); }

/** Lines → prepared rows, OUTSIDE any transaction (§9.2 step 4). `st` is the per-file state
 *  ingestFile keeps across this file's chunks: the connection, the transcript's uuid, the
 *  tool_use pairs seen so far, and whether the file's first stored row is still to come.
 *  JSON.parse failures, non-objects and lines over the JSON structure bound (D-4345, decided before any parse) become raw-only rows here. ANY OTHER THROW is the
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
    // D-4345 (history-json-structure-bound): decided on the bytes, before JSON.parse would hold every value at once.
    if (!jsonWithinStructureBound(bytes)) {
      rows.push(rawRowOf(st, at, bytes, 'line-too-complex')); add('raw_only'); rawError = { code: 'line-too-complex', at };
      continue;
    }
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
    // The index text, only for an indexed row (the searchable three, and recall echoes, which only `grep --include-recall`
    // reads: history-recall-echo-indexed) and only when this tick may index (§6.2). A recall echo is
    // classified by the paired tool_use in provenanceOf, never by its text (D-4197, history-recall-echo-by-structure).
    // The index text is a function of the STORED blob, not of the parsed row: canonicalJson sorts keys, and
    // ftsTextOf joins tool_use.input leaves in key order, so the row's own key order would give a text whose
    // parts sit in another order than the one rederiveFts re-derives (a PEM run to end-of-text masks a different
    // part). Reading the canonical form makes the two texts equal, which makeProbeIndex's soundness argument
    // assumes (D-4344, review 316 F1; `json` is the string compressed below).
    // D-4346 (history-permanent-failures-classified): an over-cap canonical body indexes nothing here too, so ingest, the backfill and the re-derivation give one text (review 316 F7 sibling; FU2).
    // The length is the one compressMissing stores as the blob's raw_len (rowRawLen), and the gate precedes the parse.
    // `ftsOverCap` is the row-level word the gate sets: writeChunk marks such a blob indexed and inserts NO row, the state
    // the re-derivation leaves it in (B3M3, FU5); the text stays '' so the mark is still taken, and is never read as the flag.
    // History-recall-echo-indexed (W1-B2 Task 12): the searchable three plus recall echoes (read only by grep --include-recall).
    const indexable = ctx.fts === true && INDEXED_PROVENANCE.includes(provenance);
    const ftsOverCap = indexable && blobOverDecodeCap(rowRawLen(json));
    const ftsText = !indexable ? null : ftsOverCap ? '' : ftsTextOf(JSON.parse(json), 'entry');
    rows.push({ kind: 'row', at, entry, provenance, sha: sha256Bytes(json), json, boundary, kept, ftsText, ftsOverCap });
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
    if (s.blobLive.get(sha) !== undefined) { blobs.set(hex, { sha, z: null, rawLen: 0 }); return; }
    blobs.set(hex, { sha, ...make() });
  };
  const fromJson = (body) => () => ({ z: brotli(Buffer.from(body, 'utf8')), rawLen: rowRawLen(body) });
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

/** One chunk, ONE transaction (§9.2 step 5). It writes: blobs, insert-or-revive by sha (a tombstone gets its body back, a stored body is never rewritten; D-4589); entries,
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
        s.exportClear.run(entryId);   // in the chunk's own transaction: the variant and the cleared mark commit together
        add(`variants_${cause.replace(/^ccd-/, '')}`);
      }
      s.membership.run(chunk.fileId, entryId, r.at);   // r.at is a byte offset (D-4237)
      if (chunk.pairIdx !== null && r.kind === 'row' && r.ftsText !== null) {
        const b = s.blobId.get(r.sha);
        if (b.fts_indexed === 0) indexBlob(db, b.blob_id, r.ftsText, chunk.pairIdx, r.ftsOverCap === true);
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
export async function ingestPath(db, ctx, f, budget, skipped) {
  const a = admitFile(f.path, f.home, ctx.homes, ctx.home);
  if (!a.ok) {
    countAdmission(db, a.why);
    if (skipped !== undefined) skipped.add(f.uuid);   // W1-B3 (D-5061): a refused copy may hold a boundary this pass did not see
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
    if (r.crashed === true && skipped !== undefined) skipped.add(f.uuid);   // W1-B3 (D-5061): a parse crash holds the cursor before the crashing line, every tick
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
 *  (ftsPrepare's tables). admitFile, budgetLeft and isBusy are this module's own, handed to derive.mjs, which imports nothing of the sweep (W1-B2 Task 8).
 *  readRegPresence is handed to card.mjs the same way: it names the sessions a card may be written for (W1-B3 Task 5). */
export function makeIngestCtx(home, homes, nowMs, ids, floorProbe = FLOOR_ALWAYS_OK) {
  const off = historyPaths(home).off;
  return { home, homes, nowMs, ids, isBoundaryLine, prepareLines, historyOff: () => existsSync(off), floorProbe, pairIdx: makePairIndex([]), fts: false, pendingReceiptState: { kind: 'measured', sessionUuids: new Set() }, admitFile, budgetLeft, isBusy, readRegPresence };
}

// ---------------------------------------------------------------------------------------------
// The tick's ingest and its accounting (§9.2 steps 2, 6-7; plan task 20).
// ---------------------------------------------------------------------------------------------

/** The meta key holding when the periodic scan last examined every known uuid's files. */
const SCAN_META = 'scan_discover_ms';

/** SQLITE_BUSY (5) and its extended codes: another connection held the write lock past
 *  busy_timeout. The tick ends and is retried next tick (§9.10). */
export function isBusy(e) {
  return e !== null && typeof e === 'object' && typeof e.errcode === 'number' && (e.errcode & 0xff) === SQLITE_CODES.BUSY;
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
 *  from it here (§9.2 step 1 decides from the observation sidecar). The read is type-checked (readRegPresence's
 *  one nonblocking open, D-4347 (history-planted-entries-never-wedge); the `_reg_read` lesson, as knownUuids): a FIFO or a link to /dev/zero at
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
  const P = historyPaths(home);
  // FU10 (D-4347 (history-planted-entries-never-wedge)): the same refusal the drain makes. Listed through a link at `spool/`
  // or at `.draining`, a name in its target hinted that id's `$REG` uuid and epochs, hints taken from outside the history root (B5M1).
  let names;
  try {
    if (spoolRefused(home) || dirKind(P.draining) !== 'dir') return new Set();
    names = readdirSync(P.draining);
  } catch { return new Set(); }   // an unreadable spool/ hints nothing, as it did before the guard
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

/** An error the operating system raised (EIO, ESTALE, EACCES, ENOENT, EISDIR, ...): `code` and `syscall` are both
 *  set by node from the failing call. SQLite's errors (code ERR_SQLITE_ERROR, no syscall), zlib's and a programming
 *  error carry no syscall, so none of them is one (D-4340, history-ingest-read-error-skips-file). */
function isFsError(e) {
  return e !== null && typeof e === 'object' && typeof e.code === 'string' && typeof e.syscall === 'string';
}

/** One tick's ingest (§9.2 steps 2-5, 7; slug history-ingest-by-cursor, D-4236): the candidate
 *  transcripts in candidateFiles' order, then the caught-up uuids' sidecars (task 21), under the
 *  run's ONE budget, which is never reset per file (O5). A busy database ends the tick with no
 *  partial chunk (O22): every chunk is its own transaction, and the one that met the lock never
 *  began. The free-space floor (Task 19's per-chunk probe, and a sidecar's own) ends the run's
 *  ingest, transcripts or sidecars: `paused`. The scan is marked done only when both halves
 *  examined everything. A read or open error the OS raised on ONE file (a transcript or a sidecar) is that file's:
 *  counted `file_unreadable`, the file skipped with its cursor where its last committed chunk left it, the scan not
 *  marked done, so the file is found again by the next tick that lists it (at once when it was behind or met by a
 *  scan, which then runs again; a hint-only file at its next hint or the next due scan), and the tick goes on
 *  (D-4340, history-ingest-read-error-skips-file). `skipped` answers the cc uuids of the transcript copies the tick
 *  could not read (that read error), admission refused, or whose parse crashed (the cursor held before the crashing line,
 *  every tick, until a parser fix ships), which the card step's withdrawal reads (D-5061). The routine stops are not
 *  fed: a budget, history-off or floor stop is a whole-pass withdrawal or a no-op, a torn tail is the end of the file, and
 *  a file that shrank under the read is re-read and rebound by the next tick. */
export async function ingestTick(db, ctx, budget) {
  const scan = ingestScanDue(db, ctx.nowMs);
  const { files, uuids } = candidateFiles(db, ctx, scan);
  const examined = [];
  let bytes = 0;
  let newEntries = 0;
  let minNewTsMs = null;
  let complete = true;
  let paused = false;
  // D-4340 (history-ingest-read-error-skips-file): a file whose read failed was not examined, so the scan is not
  // marked done (a scan tick's files are found again at the next tick; a hint-only file at its next hint or the next
  // due scan); the tick itself, its sidecars and its row go on.
  let unreadable = false;
  // W1-B3 (D-5061 (history-card-withdraw-on-a-skipped-copy)): the uuids whose transcript copy this tick could not read,
  // admission refused or whose parse crashed (ingestPath). The card step withdraws their predictions (lib
  // decideCardWithdraw, arm 'copy'): a copy that was not read to its end may hold the boundary that consumes the
  // standing line.
  const skipped = new Set();
  try {
    for (const f of files) {
      if (!budgetLeft(budget) || ctx.historyOff()) { complete = false; break; }
      let r;
      try {
        r = await ingestPath(db, ctx, f, budget, skipped);
      } catch (e) {
        // One admitted file whose read or open failed (EIO, ESTALE, EACCES, ...) is counted and skipped, its cursor
        // where its last committed chunk left it. Anything the OS did not raise (a programming error, SQLite) leaves.
        if (!isFsError(e)) throw e;
        countAdmission(db, 'unreadable');
        unreadable = true;
        skipped.add(f.uuid);
        continue;
      }
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
      if (side.unreadable === true) unreadable = true;
    }
    if (scan && complete && !unreadable) recordExamined(db, ctx, [], true);
  } catch (e) {
    if (!isBusy(e)) throw e;
    return { busy: true, bytes, newEntries, minNewTsMs, paused, skipped };
  }
  return { busy: false, bytes, newEntries, minNewTsMs, paused, skipped };
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
    stampBeltWitness(db);   // W1-B2 Task 7B (R-rollback): the pass ends with every one of its own writes witnessed
  });
  clearPassDied(ctx.home);   // D-5026: this pass ran and its tick row is committed; a death recorded before it is answered
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
    toolResults: db.prepare(`SELECT e.entry_id AS entry_id, b.z AS z, b.raw_len AS raw_len FROM entries e JOIN blobs b ON b.blob_id = e.blob_id
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

/** What linkSidecar needs of a transcript's tool_result rows, for the sidecar names asked about, as
 *  `{entryId, text, toolUseIds}` candidates in entry order. It never keeps a row's text: the rows are
 *  iterated, each body is decompressed, tested against the names and dropped before the next, so peak
 *  memory is one row's body however many large rows the transcript holds (O20's RSS bound; the first
 *  version held every row's decoded text for the whole tick). A candidate's `text` is only the asked
 *  names that row's text contains, NUL-joined (a file name cannot hold NUL, so no match can span two),
 *  and its `toolUseIds` only the asked `toolu_` stems it answers. Each asked name is tested against the
 *  row's full text on its own, so linkSidecar's two rules (a text that names the file, else the tool_use
 *  the name is the id of) pick the same entry as over the full text. A row answering none of the asked
 *  names is not a candidate. */
export function toolResultCandidates(db, transcriptPk, names) {
  const stems = new Set();
  for (const n of names) {
    const stem = n.replace(/\.[^.]*$/, '');
    if (stem.startsWith('toolu_')) stems.add(stem);
  }
  const out = [];
  for (const r of sideStmts(db).toolResults.iterate(transcriptPk)) {
    // D-4346: ENTRY_UPSERT promotes a collided entry's type to 'user' but keeps its first blob_id, so this entry's current blob can be a
    // raw-only line-too-long blob of unbounded raw_len; it is never decompressed whole, and names no sidecar.
    if (blobOverDecodeCap(r.raw_len)) continue;
    let body;
    try { body = parseStoredJson(unbrotli(r.z, r.raw_len)); } catch { continue; }
    const ids = toolResultIdsOf(body);
    if (ids.length === 0) continue;
    const text = ftsTextOf(body, 'entry');
    const named = [];
    for (const n of names) if (text.includes(n)) named.push(n);
    const answered = ids.filter((id) => stems.has(id));
    if (named.length > 0 || answered.length > 0) out.push({ entryId: r.entry_id, text: named.join('\0'), toolUseIds: answered });
  }
  return out;
}

/** The candidates for one sidecar's transcript, cached per transcript for the tick: the small index
 *  toolResultCandidates returns (never a row's text), asked for every sidecar name the tick found under
 *  that uuid so the rows are read once. A name the cached index was not built for rebuilds it. */
function candidatesFor(db, cache, transcriptPk, s) {
  const hit = cache.byPk.get(transcriptPk);
  if (hit !== undefined && hit.names.has(s.name)) return hit.candidates;
  const names = new Set(cache.wanted.get(s.uuid) ?? []);
  names.add(s.name);
  const candidates = toolResultCandidates(db, transcriptPk, names);
  cache.byPk.set(transcriptPk, { names, candidates });
  return candidates;
}

function countSidecarTooLarge(db) {
  withTx(db, 'NORMAL', () => { bump(db, 'sidecar_too_large'); });
}

/** One sidecar file (§9.2 step 4).
 *  - A file over SIDECAR_MAX_BYTES is counted `sidecar_too_large` from its stat and never opened (D-4310).
 *  - An unchanged (size, mtime_ns) is skipped before any open (DM47).
 *  - Otherwise it is admitted like a transcript (O_NOFOLLOW, a regular file under a rostered
 *    projects/ root).
 *  - It is read whole up to SIDECAR_WHOLE_MAX, else streamed through compressFdRange.
 *  - It is hashed and stored as a blob of its bytes, and linked by linkSidecar.
 *  - Its index text is made from those same bytes, before the transaction: the whole read's buffer, or the streamed
 *    arm's compressed blob through ftsTextOfBlob's bounded prefix decoder, never a second read of the file (FPM6).
 *  - The `sidecars` row and the `sidecar_seen` mark commit in one transaction.
 *  - A file that has to be read is one ingest unit for §9.3's floor: the probe runs before it, as
 *    before an ingest chunk, and anything but `ok` stops the run's sidecars (`floor`).
 *  Returns null when the file was not taken. */
export async function ingestSidecar(db, ctx, s, budget, cache) {
  const q = sideStmts(db);
  let ls;
  try { ls = lstatSync(s.path, { bigint: true }); } catch { countAdmission(db, 'missing'); return null; }
  if (!ls.isFile()) { countAdmission(db, 'non_regular'); return null; }
  // D-4310 (history-sidecar-size-cap): over the cap it is decided from the stat alone, before any open or read. No
  // sidecar_seen row can mark it (blob_id is NOT NULL and the schema does not change), so it is counted once per pass
  // that walks it, not once per tick for ever and never read at all.
  if (ls.size > BigInt(SIDECAR_MAX_BYTES)) { countSidecarTooLarge(db); return null; }
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
    if (size > SIDECAR_MAX_BYTES) { countSidecarTooLarge(db); return null; }   // grew between the lstat and the open (D-4310)
    let sha;
    let make;   // the body to store, made only when no live blob holds this sha (D-4589's one probe, below)
    let z = null;
    // The index text comes from the bytes hashed and stored, never from a second read of the file: a rewrite between two
    // reads would index text the blob does not hold, and D-4344's re-derivation recomputes the stored blob's own text
    // (final review 316 FPM6). It is made outside the transaction, only for a blob not indexed yet; null indexes nothing.
    let text = null;
    const unindexed = (h) => {
      if (ctx.fts !== true) return false;
      const b = stmts(db).blobId.get(h);
      return b === undefined || b.fts_indexed === 0;
    };
    if (size <= SIDECAR_WHOLE_MAX) {
      const buf = readAt(a.fd, 0, size);
      if (buf.length < size) return null;                 // it shrank under the read: next tick
      sha = blobShaOfBytes(buf);
      make = () => brotli(buf);
      if (unindexed(sha)) text = sidecarIndexText(buf, ctx.pairIdx);
    } else {
      const c = await compressFdRange(a.fd, 0, size);
      if (c === null) return null;
      sha = c.sha;
      make = () => c.z;
      // D-4312 (history-sidecar-redact-before-cut): the redaction window, decoded from the compressed bytes by the backfill's own bounded reader
      if (unindexed(sha)) text = (await ftsTextOfBlob(c.z, true, ctx.pairIdx, size)).text;
    }
    // D-4589: one probe for both arms, so the streamed arm (over SIDECAR_WHOLE_MAX) is pinned by the same case as the whole one.
    if (stmts(db).blobLive.get(sha) === undefined) z = make();
    // Task 18's ensureTranscript expects its caller's transaction (bindFile's); here it gets its own.
    const transcriptPk = withTx(db, 'NORMAL', () => ensureTranscript(db, s.uuid));
    const entryId = linkSidecar(s.name, candidatesFor(db, cache, transcriptPk, s));
    withTx(db, 'NORMAL', () => {
      if (z !== null) stmts(db).blobIns.run(sha, CODEC, z, size);
      const blobId = stmts(db).blobId.get(sha).blob_id;
      const ins = q.sidecarIns.run(transcriptPk, s.name, blobId, entryId, ctx.nowMs);
      if (ins.changes === 1 && entryId === null) bump(db, 'sidecar_unlinked');
      // W1-B4 Task 8 (D-4763 (history-export-late-sidecar-clears-marks), NEW): a sidecar row first linked after its entry was
      // exported clears the entry's marks, in this transaction, so the next pass writes the entry again with the new
      // row and its bytes. A no-op for an entry not yet exported.
      if (ins.changes === 1 && entryId !== null) stmts(db).exportClear.run(entryId);
      q.seenUpsert.run(s.path, st.size, st.mtimeNs, blobId);
      if (text !== null && stmts(db).blobId.get(sha).fts_indexed === 0) indexBlob(db, blobId, text, ctx.pairIdx);
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
 *  free-space floor cut it short, and `paused` says it was the floor; `floor` names the probe's word when the floor stopped it. */
export async function ingestSidecars(db, ctx, budget, uuids) {
  const due = [...uuids].filter((u) => !notCaughtUp(db, ctx.homes, u));
  const found = discoverSidecars(ctx.homes, due);
  const cache = { byPk: new Map(), wanted: new Map() };
  for (const s of found) {
    const names = cache.wanted.get(s.uuid);
    if (names === undefined) cache.wanted.set(s.uuid, new Set([s.name])); else names.add(s.name);
  }
  let bytes = 0;
  let unreadable = false;
  for (const s of found) {
    if (!budgetLeft(budget) || ctx.historyOff()) return { bytes, complete: false, paused: false, ...(unreadable ? { unreadable } : {}) };
    let r;
    try {
      r = await ingestSidecar(db, ctx, s, budget, cache);
    } catch (e) {
      // D-4340 (history-ingest-read-error-skips-file): as for a transcript, one sidecar's failed read is counted and
      // skipped (no sidecar_seen mark, so a later tick whose candidate uuids hold its uuid takes it again), and the
      // rest are tried.
      if (!isFsError(e)) throw e;
      countAdmission(db, 'unreadable');
      unreadable = true;
      continue;
    }
    if (r === null) continue;
    bytes += r.bytes;
    if (r.floor !== undefined) return { bytes, complete: false, paused: true, floor: r.floor, ...(unreadable ? { unreadable } : {}) };
  }
  return { bytes, complete: true, paused: false, ...(unreadable ? { unreadable } : {}) };
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
 *  a link to /dev/zero balloons in read(2), and secrets run first every tick. The read itself is `readBounded`'s one
 *  nonblocking open (D-4347 (history-planted-entries-never-wedge)), so a file swapped for a FIFO after the stat is no wait. */
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
    restartStep: db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, 1, NULL, NULL)
      ON CONFLICT(step, version) DO UPDATE SET cursor = NULL, completed_ms = NULL`),
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
    const r = readBounded(file, SECRET_FILE_MAX, true);
    if (r.state === 'absent') return;
    if (r.state !== 'value') { unreadable.push(file); return; }
    const text = r.value;
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
  // Each path is taken once: the roster's default secretsFile (`.cc-secrets/<id>-oauth.env`) is also what the
  // `.cc-secrets/*` glob yields, and an unreadable one would be listed (and counted) twice. The frozen-list entry
  // wins, because only it can carry `env-identifier` or `sessions` (Task 24F, Task 22's "once per unreadable path per tick").
  const wanted = new Map();
  for (const src of SECRET_SOURCES) for (const f of expandSecretSource(home, src, unreadable)) if (!wanted.has(f)) wanted.set(f, secretKindOf(src, f));
  for (const f of secretFiles) if (!wanted.has(f)) wanted.set(f, secretKindOf(null, f));
  for (const [f, kind] of wanted) take(f, kind);
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
 *  task 23's phrase fast path reads against its durable mark (while a D-4344 generation is open, only
 *  `newValues`: review 344 F2), so a pair committed by a pass that died before its re-index is still
 *  searched at the next tick no generation is open, and re-derived by the generation whose target covers
 *  it. The caller drops the values when the tick ends. */
export function secretsStep(db, ctx, secretFiles) {
  // §6.2 "The belt" (ruling R-rollback): record a due belt before this pass writes a witnessed value.
  withTx(db, 'NORMAL', () => { recordBeltDueIfWitnessMoved(db); });
  const loaded = loadSecrets(ctx.home, secretFiles);
  const fresh = new Set(recordPairs(db, ctx.home, ctx.ids, loaded.pairs, ctx.nowMs).map((p) => `${p.len}:${p.sha256}`));
  const newValues = loaded.values.filter((v) => secretPairs([v]).pairs.some((p) => fresh.has(`${p.len}:${p.sha256}`)));
  // §8.3 layer 4: the belt over every unit this tick loaded, held in memory only.
  const belt = makeBelt(beltUnits(loaded.values));
  withTx(db, 'NORMAL', () => {
    if (loaded.unreadable.length > 0) bump(db, 'redact_source_unreadable', loaded.unreadable.length);
    if (loaded.unsegmentable > 0) bump(db, 'redact_value_unsegmentable', loaded.unsegmentable);
    if (belt.overflow > 0) bump(db, BELT_COUNTERS.overflow, belt.overflow);
    setMeta(db, 'redact_unreadable', JSON.stringify(loaded.unreadable));
    // A pass handed no declared paths keeps the last list: a stale path can only mask more.
    if (secretFiles.length > 0) setMeta(db, REDACT_SOURCES_META, JSON.stringify(secretFiles));
  });
  // The redact_hashes rowids of the belt's units: the belt state's live set (§6.2 "The belt").
  const rid = derivStmts(db).pairRid;
  const live = [...new Set(belt.texts.map((u) => Number(rid.get(u.length, Buffer.from(sha256Hex(u), 'hex'))?.rid ?? 0)).filter((r) => r > 0))]
    .sort((a, b) => a - b);
  const all = secretStmts(db).allPairs.all().map((r) => ({ len: r.len, sha256: Buffer.from(r.sha256).toString('hex') }));
  return { pairIdx: { ...makePairIndex(all, belt), beltLive: live }, newValues, values: loaded.values };
}

// ---------------------------------------------------------------------------------------------
// The FTS index (§6.2 "FTS indexing", §9.1; plan task 23). The index is derived and blobs stay verbatim.
// Its body is extracted plain text (never JSON), redacted by entryIndexText (D-4343, D-4419) before it is
// a term, and only for blobs that a row of searchable provenance references. A pair learned after its
// text was indexed is re-indexed before any FTS insert of that tick, within the tick's re-index slice,
// and what the slice leaves is finished on later ticks by the re-derivation; the obligation outlives the
// pass that learned it: by quoted phrase (reindexForValues: on every tick no re-derivation generation is
// open, which is the tick that learned the pair or, after a pass that died first, a later one; while one
// is open, only for the pairs that tick recorded; charged to the slice it shares with the re-derivation,
// review 344 F2), then by a hash re-derivation of every indexed blob (rederiveFts), which alone moves
// meta fts_reindex_rid (D-4344, history-reindex-mark-by-rederivation). The bytes a contentless delete
// leaves in blobs_fts_data are purged by bounded merge steps; a whole-table 'optimize' never runs in a
// scheduled pass.
// ---------------------------------------------------------------------------------------------

const MERGE_STEP = 'fts-merge';
/** meta key: every FTS-indexed blob has been re-derived against every pair up to this redact_hashes rowid
 *  (rederiveFts, D-4344, history-reindex-mark-by-rederivation). Only a completed re-derivation moves it. */
const REINDEX_META = 'fts_reindex_rid';
/** meta key: the re-derivation generation in flight, `<target> <cursor> <end>` (lib's parseRederiveState): the
 *  mark it will become, the last blob_id re-derived, and the highest blob_id the generation covers
 *  (D-4344, history-reindex-mark-by-rederivation). */
const REDERIVE_META = 'fts_rederive';
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
    // Any existing row, completed or already pending, goes back to pending at cursor zero (resetFtsPending's only reader).
    reopen: db.prepare("UPDATE derivation_state SET completed_ms = NULL, cursor = '0' WHERE step = ? AND version = ?"),
    blobZ: db.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?'),
    blobForFts: db.prepare(`SELECT z, raw_len, EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = blobs.blob_id) AS is_sidecar
      FROM blobs WHERE blob_id = ?`),
    pairTop: db.prepare('SELECT max(rowid) AS rid FROM redact_hashes'),
    pairRid: db.prepare('SELECT rowid AS rid FROM redact_hashes WHERE len = ? AND sha256 = ?'),
    pairRows: db.prepare('SELECT rowid AS rid, len, sha256 FROM redact_hashes'),
    maxBlob: db.prepare('SELECT max(blob_id) AS id FROM blobs'),
  };
  DERIV_STMTS.set(db, d);
  return d;
}

const FTS_STMTS = new WeakMap();
/** The ONE eligibility relation of the FTS backfill (§6.2, D-4712): a blob some sidecar, or some entry or entry
 *  variant of an INDEXED_PROVENANCE row, references. `b` is blobs; it binds INDEXED_PROVENANCE twice, in order.
 *  Both the backfill writer and ftsOwesRow's measurement read it, so what is owed and what is written cannot drift. */
const FTS_ELIGIBLE_SQL = (() => {
  const ph = INDEXED_PROVENANCE.map(() => '?').join(', ');
  return `b.z IS NOT NULL
        AND (EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = b.blob_id)
          OR EXISTS (SELECT 1 FROM entries e WHERE e.blob_id = b.blob_id AND e.provenance IN (${ph}))
          OR EXISTS (SELECT 1 FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
                     WHERE v.blob_id = b.blob_id AND e.provenance IN (${ph})))`;
})();

/** The decoder mode a blob is read in (deriveFts's `is_sidecar`): `sidecar` while any sidecar references it, else `entry`.
 *  `b` is blobs. The ONE spelling of the decision, for the backfill's select and for the owed relation below. */
const FTS_IS_SIDECAR_SQL = 'EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = b.blob_id)';
/** meta key prefix of a permanent decode failure's classification (D-4346, F3): `fts_undecodable:<blob_id>` holds the decoder
 *  mode (`entry` or `sidecar`) whose attempt did not decode the blob, and nothing else: no text, error, path or secret.
 *  Sparse (a row per failing blob only), in schema v1's meta table. */
const FTS_UNDECODABLE_META = 'fts_undecodable:';
/** The classification key of a blob id; the SQL below builds the same text with `||`, which renders an integer as decimal. */
function ftsUndecodableKey(blobId) {
  if (!Number.isSafeInteger(blobId) || blobId < 1) throw new TypeError('ftsUndecodableKey: blob id');
  return `${FTS_UNDECODABLE_META}${blobId}`;
}
/** The ONE owed-row relation, read by the backfill's select and by ftsOwesRow's measurement so they cannot drift: an
 *  unindexed blob that FTS_ELIGIBLE_SQL admits and that carries no failure classification matching its CURRENT decoder
 *  mode. A permanently undecodable blob keeps fts_indexed = 0 (D-4346) and is not owed in the mode that failed it, but a
 *  change of mode (a sidecar now references it) makes it owed again. `b` is blobs; binds INDEXED_PROVENANCE twice.
 *  Its first two terms, `b.fts_indexed = 0 AND b.z IS NOT NULL`, are the predicate of schema v2's partial index `blobs_unindexed`
 *  (store.mjs's V2) written out, which is what lets SQLite read the owed rows from that index instead of scanning `blobs` (D-5015);
 *  FTS_ELIGIBLE_SQL's `b.z IS NOT NULL` must stay a top-level term of this AND chain. Both queries below that read it NAME the
 *  index (INDEXED BY, D-5018) behind ftsOwedIndexed's presence guard. */
const FTS_OWED_SQL = `b.fts_indexed = 0 AND ${FTS_ELIGIBLE_SQL}
        AND NOT EXISTS (SELECT 1 FROM meta m WHERE m.k = '${FTS_UNDECODABLE_META}' || b.blob_id
                          AND m.v = CASE WHEN ${FTS_IS_SIDECAR_SQL} THEN 'sidecar' ELSE 'entry' END)`;

/** Whether this store carries the owed-row index (schema v2's `blobs_unindexed`): a point lookup in sqlite_master. A store at v1 does
 *  not, and a statement that NAMES a missing index fails to prepare ("no such index"). The two owed queries are written in two forms,
 *  forced (`FROM blobs b INDEXED BY blobs_unindexed`) and plain, and this picks between them (D-5018). The forced form is the only one
 *  that keeps the plan once sqlite_stat1 records the index as most of the table (D-5018: the planner then prefers a scan of `blobs`,
 *  the full read D-5015 removed); the plain form is the v1 plan and is only ever used on a store that has no index to name. */
function ftsOwedIndexed(db) {
  return db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'index' AND name = ?").get(OWED_INDEX) !== undefined;
}
/** `blobs b`, naming the owed-row index when `forced`. */
const ftsOwedFrom = (forced) => (forced ? `blobs b INDEXED BY ${OWED_INDEX}` : 'blobs b');
/** The backfill's select over the ONE owed relation; binds the cursor, INDEXED_PROVENANCE twice, the limit. */
const ftsBackfillSql = (forced) => `SELECT b.blob_id AS blob_id, length(b.z) AS zlen,
        ${FTS_IS_SIDECAR_SQL} AS is_sidecar
      FROM ${ftsOwedFrom(forced)}
      WHERE b.blob_id > ? AND ${FTS_OWED_SQL}
      ORDER BY b.blob_id LIMIT ?`;
/** The owed check's select over the ONE owed relation; binds INDEXED_PROVENANCE twice. */
const ftsOwesRowSql = (forced) => `SELECT 1 AS one FROM ${ftsOwedFrom(forced)} WHERE ${FTS_OWED_SQL} LIMIT 1`;

/** Statements over the FTS tables. These are prepared only once ftsPrepare has made the tables:
 *  node:sqlite refuses to prepare against a table that does not exist. The backfill's form (forced or plain) is measured ONCE per
 *  handle, here, and cached with it (D-5018): no production path migrates under a handle that has prepared these (the scheduled pass
 *  returns right after runMigration, migrateOp returns, and every other op is refused migration-pending), unlike ftsOwesRow, which
 *  measures per call. */
function ftsStmts(db) {
  let f = FTS_STMTS.get(db);
  if (f !== undefined) return f;
  const backfillSql = ftsBackfillSql(ftsOwedIndexed(db));
  f = {
    ins: db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)'),
    del: db.prepare('DELETE FROM blobs_fts WHERE rowid = ?'),
    mark: db.prepare('UPDATE blobs SET fts_indexed = 1 WHERE blob_id = ?'),
    unclassify: db.prepare('DELETE FROM meta WHERE k = ?'),
    match: db.prepare('SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH ?'),
    merge: db.prepare("INSERT INTO blobs_fts (blobs_fts, rank) VALUES ('merge', ?)"),
    total: db.prepare('SELECT total_changes() AS n'),
    rederive: db.prepare('SELECT blob_id, length(z) AS zlen FROM blobs WHERE blob_id > ? AND blob_id <= ? AND fts_indexed = 1 ORDER BY blob_id LIMIT ?'),
    backfill: db.prepare(backfillSql),
    backfillSql,
  };
  FTS_STMTS.set(db, f);
  return f;
}

/** Whether a COMPLETED ('fts', 1) backfill owes the index a row: any blob id satisfies FTS_OWED_SQL, the backfill's own
 *  relation. A rolled-back build ingests recall echoes without indexing them and without touching meta `fts_provenance`,
 *  so the provenance marker alone cannot see them; and it can make an OLD blob (one at or below the completed cursor,
 *  deduplicated onto a new referrer) eligible without storing anything. Every id is measured, because the owed relation
 *  already excludes what the backfill passed over as undecodable (D-4346): that blob is classified by the mode that
 *  failed it, so a healthy tick neither re-opens nor recounts it. */
export function ftsOwesRow(db) {
  // Prepared here, not in ftsStmts: it reads no FTS table, and ftsStmts cannot be prepared where the tables are gone.
  return db.prepare(ftsOwesRowStatement(db)).get(...INDEXED_PROVENANCE, ...INDEXED_PROVENANCE) !== undefined;
}

/** The owed check's SQL for THIS store: forced onto the owed-row index when the store has it, plain when it has none (a v1 store).
 *  The one choice, read by ftsOwesRow and by ftsOwedPlans, so a pin of the plan sees what the pass runs. Measured per call, a
 *  point lookup in sqlite_master, so a store that gains the index (its migration) is not left on the plain form.
 *
 *  The forced form is what keeps a healthy pass's owed check O(index), never O(blobs) (D-5015, review 441 F1). FTS_OWED_SQL's two
 *  leading terms, `b.fts_indexed = 0 AND b.z IS NOT NULL`, are schema v2's partial index `blobs_unindexed` predicate WRITTEN OUT
 *  (store.mjs's V2), and SQLite only admits a partial index whose WHERE the query's own implies; INDEXED BY then keeps it chosen
 *  (D-5018), because the planner alone drops it for `SCAN b` once the closing PRAGMA optimize has recorded the index as most of
 *  the blobs rows (the review put the flip at about 70-75%; it reproduces here at a 90% unindexed share, and the `0 0` flip the
 *  review saw on its fixture did NOT reproduce, so `0 0` is pinned as a forced plan only): the stat is written at the migrating
 *  pass's own close and never refreshed. If a term here drifts from the index the forced statement no longer prepares, and
 *  history-store.test.ts's pins go red. A store without the index (v1) is answered by the plain form. */
const ftsOwesRowStatement = (db) => ftsOwesRowSql(ftsOwedIndexed(db));

/** EXPLAIN QUERY PLAN of the two owed queries exactly as this store would run them (ftsOwesRow's, and the backfill's select as
 *  ftsStmts prepares it), as `detail` lines in plan order (and the two statements' text): a pure read of the plan, for the pins that each is a search or scan of the
 *  owed-row index and never a scan of `blobs`, whatever sqlite_stat1 says, and that the entries probe is covering. The backfill's
 *  needs the FTS tables, as ftsStmts does. */
export function ftsOwedPlans(db) {
  const P = [...INDEXED_PROVENANCE, ...INDEXED_PROVENANCE];
  const plan = (sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => String(r.detail));
  const owesSql = ftsOwesRowStatement(db);
  const backfillSql = ftsStmts(db).backfillSql;
  return { owes: plan(owesSql, ...P), backfill: plan(backfillSql, 0, ...P, 1), owesSql, backfillSql };
}

/** What ftsTextOfBlob answers for a blob whose stored bytes do not decode (D-4346, history-permanent-failures-classified). */
const UNDECODABLE = Object.freeze({ text: null, decoded: 0, undecodable: true });
/** A stored blob's index text, and how many bytes were decoded to make it (D-4312, history-sidecar-redact-before-cut).
 *  A sidecar's is `sidecarIndexText` (lib: redacted over a window, then cut) of a BOUNDED prefix of
 *  its body, at most SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN bytes of output, never the whole
 *  decompressed blob (O20's RSS bound). A body's plain text is small and decompressed whole
 *  (D-4195, history-fts-body-plain-text). A blob whose stored bytes do not decode (any throw of its decompress call,
 *  which depends on those bytes alone, a decode past its raw_len included: unbrotli is bounded by it, FPM10) answers
 *  `undecodable: true` with `text: null` and is never thrown; a body that decodes but does not parse indexes nothing
 *  (`text: ''`, `undecodable: false`). A body whose stored raw_len is over BLOB_DECODE_MAX is never decompressed
 *  (blobOverDecodeCap): it indexes nothing and is not counted, so a raw line-too-long line reached by a uuid collision
 *  cannot exhaust a pass's memory (D-4346, history-permanent-failures-classified). It answers `overCap: true` (a
 *  distinct word: `text: ''` also means "did not parse"), and every writer marks such a blob indexed and inserts NO row
 *  for it (`indexBlob`'s `overCap`, B3M3 FU5), so the re-derivation, which deletes any row it finds for one
 *  (rederiveFts, FU2), leaves the state every path leaves. `rawLen` is the blob's stored raw_len; sidecars are exempt,
 *  their prefix decoder being bounded already. */
export async function ftsTextOfBlob(z, isSidecar, pairIdx, rawLen) {
  if (isSidecar) {
    let p;
    try { p = await unbrotliPrefix(z, SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN); } catch { return UNDECODABLE; }
    return { text: sidecarIndexText(p.bytes, pairIdx), decoded: p.decoded, undecodable: false };
  }
  if (blobOverDecodeCap(rawLen)) return { text: '', decoded: 0, undecodable: false, overCap: true };   // D-4346: over BLOB_DECODE_MAX; never decompressed whole, marked indexed with no row, uncounted
  let bytes;
  try { bytes = unbrotli(z, rawLen); } catch { return UNDECODABLE; }
  try { return { text: ftsTextOf(parseStoredJson(bytes), 'entry'), decoded: bytes.length, undecodable: false }; } catch { return { text: '', decoded: bytes.length, undecodable: false }; }
}

/** Index text is computed outside any transaction (a sidecar's decompression is async) and written
 *  in groups of at most this many characters, so a backfill holds a few MiB of text, never a batch's. */
const FTS_GROUP_CHARS = 4 * 1024 * 1024;

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
    let row = d.sel.get(FTS_STEP, 1);
    if (row === undefined) {
      withTx(db, 'NORMAL', () => {
        createFtsTables(db);
        d.ins.run(FTS_STEP, 1, '0');
        setMeta(db, 'fts_provenance', INDEXED_PROVENANCE.join(','));
      });
    } else if (getMeta(db, 'fts_provenance') !== INDEXED_PROVENANCE.join(',')) {
      // A completed B1 backfill missed recall echoes. Reopen once from zero while recording this provenance set.
      withTx(db, 'NORMAL', () => {
        db.prepare("UPDATE derivation_state SET completed_ms = NULL, cursor = '0' WHERE step = ? AND version = ?").run(FTS_STEP, 1);
        setMeta(db, 'fts_provenance', INDEXED_PROVENANCE.join(','));
      });
      row = d.sel.get(FTS_STEP, 1);
    } else if (row.completed_ms !== null && ftsOwesRow(db)) {
      // The marker is current but an eligible blob is owed (unindexed and not classified undecodable in its current mode),
      // at any id: a rollback to a build that ingests recall echoes without indexing them. Reopen once from zero, in one
      // transaction that measures again, so a concurrent repair is not undone.
      withTx(db, 'NORMAL', () => {
        const now = d.sel.get(FTS_STEP, 1);
        if (now !== undefined && now.completed_ms !== null && ftsOwesRow(db)) {
          db.prepare("UPDATE derivation_state SET completed_ms = NULL, cursor = '0' WHERE step = ? AND version = ?").run(FTS_STEP, 1);
        }
      });
      row = d.sel.get(FTS_STEP, 1);
    }
    state = row !== undefined && row.completed_ms !== null && openFtsRebuild(db) === null ? 'ready' : 'fts-pending';
  } else {
    state = probe === 'absent' ? 'fts5-absent' : 'probe-failed';
  }
  withTx(db, 'NORMAL', () => { setMeta(db, 'fts', state); });
  return { state, tables: probe === 'present' };
}

/** One blob into the index, inside the caller's transaction: its text REDACTED first
 *  (D-4243, history-fts-indexes-redacted-text; a secret known now is never a term, a prefix or an index
 *  byte), rowid = blob_id, and the blob marked indexed. The text is `entryIndexText`'s: `redactForIndex` (every
 *  JSON-escape reading, a deeper one kept only when it redacts, D-4343, so a literal backslash-n in an entry's plain
 *  text never glues an `n` onto a value) over the text's first ENTRY_FTS_BYTES + ENTRY_REDACT_MARGIN bytes, then cut
 *  to ENTRY_FTS_BYTES (D-4419); a sidecar's text, already cut shorter, is redacted whole. */
export function indexBlob(db, blobId, text, pairIdx, overCap = false) {
  const f = ftsStmts(db);
  if (!overCap) f.ins.run(blobId, entryIndexText(text, pairIdx));   // an over-cap body gets no row, only the mark (B3M3, FU5: the state rederiveFts leaves it in)
  f.mark.run(blobId);
  f.unclassify.run(ftsUndecodableKey(blobId));   // F3: a stale failure classification dies with the blob's first success
}

/** Derivation ('fts', 1)'s backfill (§9.1). Every blob still unindexed that a searchable row (or a
 *  sidecar) references is indexed, from a cursor, within the run's budget. A batch of up to
 *  BACKFILL_BATCH blobs is selected by id and compressed size ONLY; each blob's `z` is fetched one at
 *  a time, charged to the run budget as it is, and the batch stops when the budget fails (D-4312,
 *  history-sidecar-redact-before-cut: 256 compressed blobs plus a decompressed sidecar in one batch
 *  broke O20's RSS bound). Text is computed outside the transaction, which writes it in groups.
 *  When none is left the step completes and meta `fts` reads ready. Under a cap or floor pause the
 *  tick does not call it (D-4242, history-fts-backfill-pauses-with-ingest). The EXISTS probes below search
 *  schema v1's referrer indexes (D-4217, history-referrer-indexes). */
export async function deriveFts(db, ctx, budget) {
  if (ctx.fts !== true) return;
  const d = derivStmts(db);
  const row = d.sel.get(FTS_STEP, 1);
  if (row === undefined || row.completed_ms !== null) return;
  const f = ftsStmts(db);
  let cursor = Number(row.cursor ?? 0);
  while (budgetLeft(budget)) {
    const batch = f.backfill.all(cursor, ...INDEXED_PROVENANCE, ...INDEXED_PROVENANCE, BACKFILL_BATCH);
    const last = batch.length < BACKFILL_BATCH;
    let group = [];
    let chars = 0;
    let failed = [];   // blobs of this batch passed over undecoded, with the decoder mode that failed: classified and counted in the commit that moves the cursor past them (D-4346)
    let reached = cursor;   // the last blob of this batch taken, indexed or skipped
    const commit = (done) => {
      withTx(db, 'NORMAL', () => {
        for (const g of group) indexBlob(db, g.id, g.text, ctx.pairIdx, g.overCap === true);
        for (const x of failed) setMeta(db, ftsUndecodableKey(x.id), x.mode);
        if (failed.length > 0) bump(db, HEALTH_COUNTERS.blobUndecodable, failed.length);
        cursor = reached;
        if (done) {
          d.done.run(ctx.nowMs, String(cursor), FTS_STEP, 1);
          if (openFtsRebuild(db) === null) setMeta(db, 'fts', 'ready');   // W1-B2 Task 23: never ready under an open rebuild
        } else {
          d.cursor.run(String(cursor), FTS_STEP, 1);
        }
      });
      group = [];
      chars = 0;
      failed = [];
    };
    for (const b of batch) {
      if (!budgetLeft(budget)) { if (reached !== cursor) commit(false); return; }
      const zr = d.blobZ.get(b.blob_id);
      const z = zr?.z;
      if (z === undefined || z === null) { reached = b.blob_id; continue; }
      const t = await ftsTextOfBlob(z, b.is_sidecar === 1, ctx.pairIdx, zr.raw_len);
      budget.bytes += b.zlen;
      reached = b.blob_id;
      if (t.undecodable) { failed.push({ id: b.blob_id, mode: b.is_sidecar === 1 ? 'sidecar' : 'entry' }); continue; }   // D-4346 (history-permanent-failures-classified): passed over, its fts_indexed left 0, classified by the mode that failed
      group.push({ id: b.blob_id, text: t.text, overCap: t.overCap === true });
      chars += t.text.length;
      if (chars >= FTS_GROUP_CHARS) commit(false);
    }
    commit(last);
    if (last) return;
  }
}

/** Re-open ('fts', 1) from cursor zero: an existing row, completed or already pending, becomes pending at cursor 0.
 *  Called when blobs were written that could not be indexed: by a tick whose probe answered fts5-absent or
 *  probe-failed while the tables exist, or by an `--op import --apply` pass, whose ingest context never indexes
 *  (Task 25). The next tick that has FTS backfills them through its full pair index. The cursor is NOT kept: an
 *  ingest can make an OLD blob (id at or below the cursor) owed without allocating one, by giving it its first
 *  eligible referrer (a deduplicated body promoted to a recall echo), so the shared owed relation (FTS_OWED_SQL)
 *  is rescanned from zero; its failure classification keeps a permanent failure from being retried or recounted.
 *  A store whose tables were never made has no row to re-open: their first creation backfills from 0. */
export function resetFtsPending(db) {
  withTx(db, 'NORMAL', () => { derivStmts(db).reopen.run(FTS_STEP, 1); });
}

/** The same-tick fast path of the re-index a learned pair owes the index (D-4245, history-redaction-reindex-merge,
 *  SE4; units by D-4311, history-reindex-by-units-and-complete-loads). `values` is every secret value this tick
 *  loaded; each whose pair lies above the mark (`owed`: a redact_hashes rowid above meta `fts_reindex_rid`) has its
 *  blobs found by QUOTED-PHRASE matches, which FTS5 tokenises as the index did, one per UNIT redaction matches by
 *  (`secretUnits`: the value when it is one run, else each of its 12+-char segments), so a blob that holds only a
 *  segment is found too. In one transaction per group, each such blob's row is deleted and re-inserted with the
 *  now-complete index, and merge steps are registered to purge the deleted bytes. It NEVER moves the mark: a phrase
 *  finds a blob whose term is the value alone, and one whose value a `_` or `-` glues to a neighbour (unicode61 splits
 *  at both; §8.3's run grammar leaves that value in place, so the blob is found and re-indexed with the value still in
 *  it), so it cannot show the index complete (a value glued by a letter or digit, inside one index term, a hash-only
 *  pair and a value no source loaded this tick are all invisible to it). Only `rederiveFts` moves the mark (D-4344,
 *  history-reindex-mark-by-rederivation, which supersedes D-4311's mark clause). While a generation is open it searches
 *  only `fresh`, the values whose pairs this tick recorded (lib's `phraseValues`), and every blob it reads is charged
 *  to `slice` and `budget` as rederiveFts charges one, so it never runs unbudgeted ahead of the step that ends the
 *  generation; a blob a spent budget leaves waits for the re-derivation (review 344 F2).
 *  Values are never written anywhere. Returns how many blobs were re-indexed. */
export async function reindexForValues(db, ctx, values, fresh, budget, slice = rederiveSlice(budget)) {
  if (ctx.fts !== true) return 0;
  const d = derivStmts(db);
  const mark = Number(getMeta(db, REINDEX_META) ?? 0);
  const top = d.pairTop.get().rid ?? 0;
  if (top <= mark) return 0;
  const searched = phraseValues(mark, parseRederiveState(getMeta(db, REDERIVE_META)), values, fresh);
  const owed = searched.filter((v) => secretPairs([v]).pairs
    .some((p) => (d.pairRid.get(p.len, Buffer.from(p.sha256, 'hex'))?.rid ?? 0) > mark));
  const f = ftsStmts(db);
  const ids = new Set();
  for (const v of owed) for (const unit of secretUnits(v)) for (const r of f.match.all(ftsPhrase(unit))) ids.add(Number(r.rowid));
  // §6.2 (SE4): the same-tick fast path over nodes, as the phrase search above is over blobs (W1-B2 Task 29). It moves
  // no mark (only B1's rederiveFts does). It asks the same slice and budget on entry, before each leaf it re-derives
  // and before each batch of nodes it rewrites, and stops at the first that is spent; a path that stops after it
  // started reopens the belt's node step itself (D-5025), so what it left is owed to the belt. Whatever it misses or
  // leaves, the belt's node step (beltNodesStep, restarted by every generation that opens) finishes fail-closed.
  rederiveGistsFor(db, ctx, owed, budget, slice);
  if (ids.size === 0) return 0;
  // Texts are computed outside the transaction and written in groups. Each group's transaction registers the
  // merge steps, so a pass that dies between groups still purges what it deleted.
  const rows = [...ids];
  let group = [];
  let chars = 0;
  const commit = () => {
    withTx(db, 'NORMAL', () => {
      let bad = 0;
      for (const g of group) {
        const removed = Number(f.del.run(g.id).changes);
        if (g.undecodable && removed > 0) bad += 1;   // counted once: the row is gone, so no later re-index counts it again (D-4346)
        if (g.text !== null) f.ins.run(g.id, entryIndexText(g.text, ctx.pairIdx));
      }
      if (bad > 0) bump(db, HEALTH_COUNTERS.blobUndecodable, bad);
      if (ids.size > 0) d.pending.run(MERGE_STEP, 1);
    });
    group = [];
    chars = 0;
  };
  let done = 0;
  for (const id of rows) {
    // Review 344 F2: charged as rederiveFts charges; a blob a spent budget leaves waits for the re-derivation.
    if (!budgetLeft(slice) || !budgetLeft(budget)) break;
    const b = d.blobForFts.get(id);
    // A tombstone keeps no index row; nor does a blob whose bytes no longer decode (D-4346, history-permanent-failures-classified).
    const t = b === undefined || b.z === null ? null : await ftsTextOfBlob(b.z, b.is_sidecar === 1, ctx.pairIdx, b.raw_len);
    const undecodable = t !== null && t.undecodable;
    const text = t === null || undecodable || t.overCap === true ? null : t.text;   // an over-cap body keeps no row on this path either (B3M3, FU5)
    group.push({ id, text, undecodable });
    const zlen = b === undefined || b.z === null ? 0 : b.z.length;
    slice.bytes += zlen;
    budget.bytes += zlen;
    done += 1;
    chars += text === null ? 0 : text.length;
    if (chars >= FTS_GROUP_CHARS) commit();
  }
  commit();
  return done;
}

/** One tick's slice of the run budget for the re-index (REDERIVE_SLICE_*, D-4344): the tick makes one and charges
 *  the phrase path and the re-derivation to it, so the two together never take more of a tick than one slice
 *  (review 344 F2). */
function rederiveSlice(budget) {
  return newBudget(budget.now, { maxMs: REDERIVE_SLICE_MS, maxBytes: REDERIVE_SLICE_BYTES });
}

/** The store's witness for the belt (§6.2 "The belt", ruling R-rollback): values a B1 build moves whenever it
 * writes index state, including FTS5's bookkeeping for a row indexed after its blob was already stored. */
export function beltWitness(db) {
  const d = derivStmts(db);
  const fts = d.sel.get(FTS_STEP, 1);
  return JSON.stringify([
    d.maxBlob.get().id ?? 0,  // witness (blob): its ingest stores a blob
    d.pairTop.get().rid ?? 0,  // witness (pair): it records a pair, and only then does its phrase path write
    getMeta(db, REINDEX_META) ?? '',  // witness (mark): its re-derivation completes
    getMeta(db, REDERIVE_META) ?? '',  // witness (rederive): its re-derivation's cursor, or a generation of its own
    fts === undefined ? null : [fts.cursor ?? null, fts.completed_ms ?? null],  // witness (backfill): ('fts', 1)
    ftsIndexWitness(db),  // witness (index): every committed blobs_fts write
  ]);
}

/** The FTS5 component of beltWitness. The averages and structure records change with committed index writes. */
function ftsIndexWitness(db) {
  if (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'blobs_fts_data'").get() === undefined) return null;
  const h = createHash('sha256');
  for (const r of db.prepare('SELECT id, block FROM blobs_fts_data WHERE id IN (1, 10) ORDER BY id').all()) h.update(`${r.id}:`).update(r.block);
  return h.digest('hex');
}

/** Stamp a parseable belt state after a pass has checked the previous witness and completed its writes. */
export function stampBeltWitness(db) {
  const s = parseBeltState(getMeta(db, BELT_META));
  if (s === null) return;
  const next = formatBeltState({ ...s, w: beltWitness(db) });
  if (next !== getMeta(db, BELT_META)) setMeta(db, BELT_META, next);
}

/** Inside the caller's transaction, record a due belt before any witnessed write when another build moved its witness. */
export function recordBeltDueIfWitnessMoved(db) {
  const moved = beltWitnessMoved(parseBeltState(getMeta(db, BELT_META)), beltWitness(db));
  if (moved) setMeta(db, BELT_META, formatBeltState({ v: 0, rids: [], gen: null }));
  return moved;
}

/** The hash re-derivation that moves the re-index mark (§6.2 "A pair learned after its text was indexed", D-4344,
 *  history-reindex-mark-by-rederivation). A generation re-derives every FTS-indexed blob, in blob_id order, with the
 *  redaction's OWN code (`entryIndexText` over `ftsTextOfBlob`'s text, exactly as indexBlob does) through a probe
 *  index that counts the hits on pairs above the mark (lib's `makeProbeIndex`). A blob whose re-derivation hit an
 *  owed pair has its row deleted and re-inserted with the full redaction; one that hit none already equals it.
 *  Soundness is the argument at `makeProbeIndex`: the index text depends on the pair set only through the
 *  `byLen.get(len)?.has(sha)` answers, so a recomputation with no owed hit asked the stored row's own questions and
 *  got its own answers. A blob the redaction would change is therefore always found, whether its term is glued to a
 *  neighbour no quoted phrase matches, or its pair is a bare hash (sessions.json) with no value to search.
 *  Meta `fts_rederive` is the durable state `<target> <cursor> <end>`. Liveness: `end` is the highest blob_id at the
 *  generation's start, fixed, and a blob indexed later already carries every pair up to the target (the pair index
 *  of its own tick), so a busy ingest cannot keep a generation from completing. The mark moves only to the
 *  generation's own target, never to a pair learned mid-generation; that pair opens the next generation. Each call
 *  is charged to a slice of the run budget (REDERIVE_SLICE_*; from tick, the slice it shares with the phrase path,
 *  review 344 F2) so a generation never starves capture, charges each blob's compressed bytes as the backfill does,
 *  and commits its groups with the cursor, so a dead pass resumes. It runs under any pause, like the phrase path and
 *  the merge steps (D-4242): it frees the very bytes a late pair put at risk, and the group's merge registration
 *  purges the deleted ones. A tombstoned blob keeps no index row. Three distinct words: 'idle' (nothing owed or FTS
 *  off), 'running' (budget spent, the cursor saved) and 'completed' (the mark moved), with how many blobs were
 *  re-indexed. */
export async function rederiveFts(db, ctx, budget, slice = rederiveSlice(budget)) {
  if (ctx.fts !== true) return { state: 'idle', reindexed: 0 };
  const d = derivStmts(db);
  const mark = Number(getMeta(db, REINDEX_META) ?? 0);
  // §6.2 "The belt": open a belt generation with no new pair, or restart one that lacks its versioned live set.
  const live = ctx.pairIdx?.beltLive ?? [];
  const beltNow = getMeta(db, BELT_META);
  const stored = parseBeltState(beltNow);
  const belt = decideBelt(stored, live, mark);
  const prior = parseRederiveState(getMeta(db, REDERIVE_META));
  const plan = rederivePlan(mark, d.pairTop.get().rid ?? 0, d.maxBlob.get().id ?? 0, prior, belt.due, belt.restart);
  if (plan === null) {
    const kept = formatBeltState({ ...belt.next, w: beltWitness(db) });
    if (kept !== beltNow) withTx(db, 'NORMAL', () => { setMeta(db, BELT_META, kept); });
    return { state: 'idle', reindexed: 0 };
  }
  // A generation records the live units at its open and makes the node belt step due (Task 29).
  const opened = plan !== prior;
  const next = opened ? { ...belt.next, gen: [...live], gv: BELT_VERSION } : belt.next;
  if (opened) {
    withTx(db, 'NORMAL', () => {
      secretStmts(db).restartStep.run(BELT_NODES_STEP);
      // A first generation and a v:0 due record are not flapping-file events (finding R15).
      if (plan.belt === true && stored !== null && stored.v !== 0) bump(db, BELT_COUNTERS.generations);
    });
  }
  // Built per call: pairs can grow between calls. Every layer-4 and glue-window hit counts as owed.
  const idx = makeProbeIndex(d.pairRows.all().map((r) => ({ rid: r.rid, len: r.len, sha256: Buffer.from(r.sha256).toString('hex') })), mark,
    { belt: ctx.pairIdx?.belt ?? null, beltAll: true });
  const f = ftsStmts(db);
  let cursor = plan.cursor;
  let reindexed = 0;
  let group = [];
  let chars = 0;
  const commit = (completed) => {
    let changed = 0;
    withTx(db, 'NORMAL', () => {
      let bad = 0;
      for (const g of group) {
        const removed = Number(f.del.run(g.id).changes);
        if (g.undecodable === true && removed > 0) bad += 1;   // counted once: the row is gone, so no later generation counts it again (D-4346)
        if (g.text !== null) f.ins.run(g.id, g.text);
        if (removed > 0 || g.text !== null) changed += 1;
      }
      if (bad > 0) bump(db, HEALTH_COUNTERS.blobUndecodable, bad);
      // Only a group in which a row was removed or inserted reopens the merge step and counts as re-indexed: an undecodable
      // or over-cap blob keeps fts_indexed = 1, so every later generation pushes it again for a delete that answers 0 (M10, FU2).
      if (changed > 0) d.pending.run(MERGE_STEP, 1);
      setMeta(db, REDERIVE_META, formatRederiveState(completed ? { target: plan.target, cursor, end: plan.end } : { ...plan, cursor }));
      if (completed) setMeta(db, REINDEX_META, String(plan.target));
      // Measured after this transaction's own meta writes: never ahead of an index write, only behind or exact.
      setMeta(db, BELT_META, formatBeltState({ ...(completed ? beltAfterGeneration(next) : next), w: beltWitness(db) }));
    });
    reindexed += changed;
    group = [];
    chars = 0;
  };
  for (;;) {
    const batch = f.rederive.all(cursor, plan.end, BACKFILL_BATCH);
    if (batch.length === 0) { commit(true); return { state: 'completed', reindexed }; }
    for (const b of batch) {
      if (!budgetLeft(slice) || !budgetLeft(budget)) { commit(false); return { state: 'running', reindexed }; }
      const row = d.blobForFts.get(b.blob_id);
      if (row === undefined || row.z === null) {
        group.push({ id: b.blob_id, text: null });   // a tombstone keeps no index row
      } else {
        idx.probe.hits = 0;
        const t = await ftsTextOfBlob(row.z, row.is_sidecar === 1, idx, row.raw_len);
        if (t.overCap === true) {
          // D-4346 (history-permanent-failures-classified): an over-cap body indexes nothing, and a row written before that rule may hold its full text; never skipped, so the row is deleted and none inserted, uncounted (FU2).
          group.push({ id: b.blob_id, text: null });
        } else if (t.undecodable) {
          // D-4346 (history-permanent-failures-classified): never skipped; its row cannot be shown free of an owed pair, so it is deleted and none inserted.
          group.push({ id: b.blob_id, text: null, undecodable: true });
        } else {
          const final = entryIndexText(t.text, idx);
          if (idx.probe.hits > 0) { group.push({ id: b.blob_id, text: final }); chars += final.length; }
        }
      }
      const zlen = b.zlen ?? 0;
      slice.bytes += zlen;
      budget.bytes += zlen;
      cursor = b.blob_id;
      if (chars >= FTS_GROUP_CHARS) commit(false);
    }
  }
}

/** Gives a tick's (and a reparse's, and the recover arm's pass's) ingest context the hook derive.mjs calls inside each transaction that deletes a nodes_fts row: it
 *  registers the merge step pending, as the blob paths register it, so mergeSteps merges nodes_fts too. A function of its
 *  own and `db` last, because the tick's docstring test reads every `name(db` in the body as a step to list.
 *  D-4609 (history-nodes-fts-merged-after-rewrite) */
function registerNodesMerge(ictx, db) {
  ictx.onNodesFtsDeleted = () => { derivStmts(db).pending.run(MERGE_STEP, 1); };
}

/** Bounded FTS5 merge steps (§6.2), from derivation_state ('fts-merge', 1), within the run's
 *  budget, until FTS5 reports nothing left to merge in either table: a total_changes() delta under 2 from blobs_fts's
 *  merge and from nodes_fts's. Only then does the guarantee on the index's bytes hold. The step is registered pending by
 *  every writer that deletes index rows: the blob paths, and the node paths through the context's onNodesFtsDeleted hook
 *  (the tick, `reparse --apply` and the recover arm's pass install it, D-4609 (history-nodes-fts-merged-after-rewrite)). */
export function mergeSteps(db, ctx, budget) {
  if (ctx.fts !== true) return;
  const d = derivStmts(db);
  const row = d.sel.get(MERGE_STEP, 1);
  if (row === undefined || row.completed_ms !== null) return;
  const f = ftsStmts(db);
  // nodes_fts is a regular FTS5 table whose rewrites are a DELETE and an INSERT, so its deleted terms wait in nodes_fts_data
  // as blobs_fts's do. Prepared here, not in ftsStmts, and only where the table is: a store without it has nothing to merge,
  // and the blob paths that share ftsStmts must not start to need it (D-4609 (history-nodes-fts-merged-after-rewrite)).
  const mergeNodes = db.prepare("SELECT 1 AS t FROM sqlite_master WHERE type = 'table' AND name = 'nodes_fts'").get() === undefined
    ? null : db.prepare("INSERT INTO nodes_fts (nodes_fts, rank) VALUES ('merge', ?)");
  while (budgetLeft(budget)) {
    const before = f.total.get().n;
    withTx(db, 'NORMAL', () => { f.merge.run(-MERGE_PAGES); });
    const between = f.total.get().n;
    if (mergeNodes !== null) withTx(db, 'NORMAL', () => { mergeNodes.run(-MERGE_PAGES); });
    if (between - before < 2 && f.total.get().n - between < 2) {
      withTx(db, 'NORMAL', () => { d.done.run(ctx.nowMs, null, MERGE_STEP, 1); });
      return;
    }
  }
}

// ── THE --op PASS (Task 25) ───────────────────────────────────────────────────────────────────────
// `ccd-history-sweep --op <verb> …`, from the CLI (W1-B2) or straight from an operator's shell (§5.1's
// published door; D-4221 history-apply-via-shim: every writing verb runs through the shim).
// Spec §8.4 "Operator verbs" and "Speed bumps", §9.2 "An --op pass runs the journal half
// too", §6.11 "doctor --migrate". In order (`opPass`):
//   1. the verb and its arguments: B1 knows `import` and `migrate`; anything else is bad-args (a session id off its
//      grammar is bad-id; the file is made absolute once, and must be a `<uuid>.jsonl`);
//   2. THE GATE, decided by lib.mjs's decideOpGate from this process's OWN CLAUDECODE, isatty(0) and, for an
//      irreversible form only, the bounded `tmux display-message -p -t "$TMUX_PANE" '#S'` — the bumps the CLI
//      applies, decided once and executed twice (D-4181, slug history-op-gate-in-sweep), so the direct door meets
//      them too. A refusal writes NOTHING: it precedes the role, the lock-take journal half, the marker and
//      the store. These are speed bumps, not walls: `env -u CLAUDECODE` defeats the first (§8.4);
//   3. the recorded role: a server box never gets a store, whatever a stale shim is asked (§6.9, O27; D-4222
//      history-role-not-server);
//   4. a dry run (`import` without --apply): an unreadable roster is refused first, `roster-unreadable`, before any
//      read and without a count (D-4313, history-import-refusal-words); then, after the bounded free-space probe,
//      it opens READ-ONLY and writes nothing at all (§8.4 "dry run by default"): no journal half, no marker, no
//      flush;
//   5. otherwise the journal half at lock take (DI7, D-4232 history-observe-at-rename: a /clear during a long
//      --op keeps its startup epoch; a failed one says `history-sweep: journal-unwritable` and answers exit INTERNAL
//      with no reason, before the probe; no release half runs), then the free-space probe, then the store opened exactly as a scheduled
//      pass opens it (`openStore`; a throw there is answered after the release half, review 316 F19); from here
//      on EVERY answer, not only rc 0, runs the journal half again before release (D-4232), and a failed one
//      replaces only an rc 0. Inside the body: an unreadable store.writer answers store-unmeasured; an `import`
//      with an unreadable roster is counted `roster_unreadable` and refused BEFORE the marker is written (D-4313,
//      every import form); then the op marker, the outbox (`flushFirst`), `clearDoneMarkers`, an `import` against
//      a store with a migration pending refused `migration-pending`, and the verb; an rc 0 flushes the outbox
//      once more (an operator told "done" is in the fsynced journal, §8.4, D-4225); the marker is removed and
//      the writer closed last.
// The result is ONE JSON line, `{"rc":<EXIT>}` or `{"rc":<EXIT>,"reason":"<REASONS key>"}`, printed LAST,
// which the CLI relays (§8.4); the process exits with that rc. A held lock never reaches here: the shim
// answers 75 for an --op pass (§5.1).

/** The --op verbs this build runs (§8.4). Each B2 verb joins in the task that ships its path (Tasks 20–28): a verb
 *  named here has an entry in OP_HANDLERS, or an arm in bindingPass, and one in OP_DRY_RUNS when it has a dry run. */
const OP_VERBS = new Set(['import', 'migrate', 'prune', 'reparse', 'backup', 'repair', 'adopt', 'restore', 'rebuild']);

/** adopt, restore and rebuild (§8.4): they run BEFORE openStore, which refuses exactly the states they exist to
 *  repair (store-unbound, store-missing, store-recoverable, store-zero-byte, store-schema-missing, …). */
const BINDING_OPS = new Set(BIND_KINDS);

/** The verbs whose rows the code's schema version shapes: a store awaiting its migration refuses them
 *  (migration-pending). backup and migrate run at any stored version; the binding verbs never reach openStore. */
const OP_NEEDS_CODE_VERSION = new Set(['import', 'prune', 'reparse', 'repair']);

/** Each verb's dry run, its null form (§8.4 "dry run by default"): READ-ONLY, after the bounded reachability probe,
 *  with no journal half, no op marker and no flush. c = {home, P, parsed, args, deps, out, now}; answers
 *  {rc, reason?}. */
const OP_DRY_RUNS = Object.freeze({
  import: async (c) => {
    importDryRun(c.P, c.parsed.homes, c.args, c.out);
    return { rc: EXIT.OK };
  },
  prune: (h) => pruneDryRunOp(h.home, h.P, h.args, h.out, h.now()),
  reparse: (h) => reparseDryRunOp(h.home, h.P, h.args, h.out),
});

/** Each writing verb's body, on the store openStore opened, under the lock, after the lock-take journal half, the
 *  op marker and the first outbox flush. c = {db, ctx, P, args, opened, free}; answers {rc, reason?}. An rc of 0 is
 *  followed by the release flush and journal half (§8.4: every writing form flushes before it exits 0). */
const OP_HANDLERS = Object.freeze({
  import: (c) => importApply(c.db, c.ctx, c.P, c.args),
  migrate: (c) => migrateOp(c.db, c.ctx, c.opened, c.free),
  prune: (c) => pruneApplyOp(c.db, c.ctx, c.args),
  reparse: (c) => reparseApplyOp(c.db, c.ctx, c.args),
  backup: (c) => backupOp(c.db, c.ctx),
  repair: (c) => repairOp(c.db, c.ctx),   // a Promise: opPass awaits every handler
});

/** B1's name, kept: a verb's arguments by lib's one grammar (parseOpVerbArgs), or null when refused. opPass
 *  reads parseOpVerbArgs itself, for the refusal's word. */
export function parseOpArgs(op, args) {
  if (!OP_VERBS.has(op)) return null;
  const p = parseOpVerbArgs(op, args);
  return p.ok ? p.args : null;
}

/** The pane an irreversible form runs in, by the bounded tmux read the CLI uses (§8.2, §8.4): always with
 *  -t, under TMUX_DEADLINE_MS, and only for a pane id of the right grammar. A reversible form, no pane,
 *  or a tmux that fails or times out answers null — the TTY requirement still stands then. */
export function paneNameFor(form) {
  const pane = process.env.TMUX_PANE ?? '';
  if (!paneReadWanted(form, pane)) return null;
  const r = spawnSync('tmux', ['display-message', '-p', '-t', pane, '#S'],
    { encoding: 'utf8', timeout: TMUX_DEADLINE_MS, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Whether a pid names a live process (EPERM: alive, another user's). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'EPERM';
  }
}

/** ~/.ccrc/history/op (§9.6 op-running), parsed by lib's one grammar; null when absent or malformed. */
export function readOpMarker(P) {
  const text = readTrimmed(P.op);
  return text === null ? null : parseOpMarker(text);
}

/** A marker whose pid is dead, or which names none, is stale: the next pass removes it (§9.6). */
export function removeStaleOpMarker(P) {
  const r = readBounded(P.op, CONTROL_FILE_MAX, false);
  if (r.state === 'absent') return;
  // An unreadable marker (a FIFO, a link, a directory, over the cap) names no live pid, so it is stale (D-4347 (history-planted-entries-never-wedge)).
  const m = r.state === 'value' ? parseOpMarker(r.value.trim()) : null;
  if (m === null || !pidAlive(m.pid)) removeEntry(P.op);
}

/** Written under the lock when an --op pass starts; removed when it ends (§9.6). */
export function writeOpMarker(P, verb, nowMs) {
  writeFileAtomic(P.op, `${verb} ${process.pid} ${nowMs}\n`, 0o600);
}

/** One rostered home's projects/ tree, spelled and resolved: an unmade projects/ resolves to its spelling and holds nothing. */
function projectsRootOf(h) {
  const spelled = join(h, 'projects');
  let root = spelled;
  try { root = realpathSync(spelled); } catch { /* an unmade projects/ holds nothing */ }
  return { spelled, root };
}

/** Whether a home's projects/ tree holds a path: by the resolved path, and by the spelled one for a file already gone. */
function treeHolds(p, real, tree) {
  return real.startsWith(`${tree.root}/`) || p.startsWith(`${tree.spelled}/`);
}

/** The resolved projects/ trees of `homes`, in order, each measured ONCE: a caller that asks about many paths resolves
 *  them here and hands the list to `homesOfPath`, so the resolutions cost one per home, not one per home per path (H-214). */
export function projectsTrees(homes) {
  return homes.map(projectsRootOf);
}

/** Every rostered home whose projects/ tree holds a path, in roster order — by the resolved path, and by the spelled
 *  one for a file already gone. Two homes whose projects/ resolve to one real tree both hold it. `trees` is
 *  `projectsTrees(homes)`, resolved by the caller once for a run of paths (H-214); absent, it is resolved here. */
export function homesOfPath(p, homes, trees = projectsTrees(homes)) {
  let real = p;
  try { real = realpathSync(p); } catch { /* gone: the spelled path decides */ }
  const out = [];
  homes.forEach((h, i) => { if (treeHolds(p, real, trees[i])) out.push(h); });
  return out;
}

/** The first rostered home whose projects/ tree holds a path, or null when none does (§5.2: only rostered roots are
 *  read). Ingest admission asks this; the export census asks `homesOfPath` and takes the shortest (D-4612). It stops
 *  at the first match: a later home's projects/ is not resolved for a path an earlier home holds (H-214). */
export function homeOfPath(p, homes) {
  let real = p;
  try { real = realpathSync(p); } catch { /* gone: the spelled path decides */ }
  for (const h of homes) if (treeHolds(p, real, projectsRootOf(h))) return h;
  return null;
}

/** A verdict line queued in the outbox, inside the caller's transaction (§9.14). */
function outboxRow(db, rec) {
  db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)').run(rec);
}

/** One mapping verdict (§9.14: a backfill mapping, `declared_by` registry or journal, or an operator's
 *  import --session --file), through `mapRegistryUuid`, the ONE per-uuid registry mapping core
 *  `registryBackfill` also calls (Task 26F item 1): the family (created on first sight, with its `family` verdict,
 *  its generation read through `readObservation`/`joinFamily` and counted when absent or unreadable) and the epoch
 *  with cause `import`, committed under FULL in a transaction of its own and flushed to the journal right
 *  after — before the file's first NORMAL chunk (§9.2 "Every verdict commits first", CT10; O34). A uuid
 *  another family already claims is chainEpoch's first-claim rule (uuid_two_sessions). A uuid this id holds as an
 *  unconfirmed epoch is the scan's to decide (D-4297), except for the operator's own mapping.
 *  Answers the core's outcome: 'skipped', 'refused' (another family holds the uuid confirmed; `holder` names it,
 *  {ccrc_id, generation}), 'already' (this family holds it confirmed: no new verdict, a re-run queues nothing) or
 *  'mapped'. D-4313 (history-import-refusal-words): a refusal is the CALLER's to answer, never to read as success. */
export function commitMapping(db, ctx, ev) {
  const nowMs = ctx.now();
  const r = mapRegistryUuid(db, ctx, {
    id: ev.id, uuid: ev.uuid, declaredBy: ev.declaredBy, path: ev.path, nowMs, obs: readObservation(ctx.home, ev.id, nowMs),
  }, (fn) => {
    withTx(db, 'FULL', () => { for (const rec of fn()) outboxRow(db, rec); });
  });
  flushOutbox(db, ctx.home, ctx.ids, ctx.now());
  if (r.outcome !== 'refused') return { outcome: r.outcome };
  const holder = db.prepare('SELECT s.ccrc_id, s.generation FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? AND e.confirmed_ms IS NOT NULL AND e.session_pk <> ? LIMIT 1')
    .get(ev.uuid, r.family.sessionPk);
  return { outcome: 'refused', holder };
}

/** The generation a registry row reads now, for a LISTING only (the dry run's `mapped` lines): the same
 *  `joinGeneration` the mapping core applies, so what is listed is what a mapping would join, but nothing is
 *  counted — a dry run writes nothing. */
function registryGenerationOf(P, id) {
  return joinGeneration({ lineGen: null, observedGen: readRegPresence(join(P.reg, `${id}.generation`)) }).generation;
}

/** Evidence-only import (§8.4): which transcript uuid belongs to which family, the first evidence for a
 *  uuid winning — spool history (a confirmed epoch already in the store; declaredBy null, nothing to map),
 *  then the registry's `$REG/<id>.uuid`, then `$REG/<id>.compactions`' `transcript` paths. Nothing is
 *  inferred from file timing (§6.1). `db` may be null (a dry run with no store yet). */
export function importEvidence(db, P) {
  const m = new Map();
  const put = (uuid, e) => { if (UUID_RE.test(uuid) && !m.has(uuid)) m.set(uuid, e); };
  if (db !== null) {
    const st = db.prepare('SELECT s.ccrc_id, s.generation, e.cc_session_uuid FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.confirmed_ms IS NOT NULL ORDER BY s.session_pk, e.seq');
    for (const r of st.iterate()) {
      put(r.cc_session_uuid, { id: r.ccrc_id, generation: r.generation, declaredBy: null, path: null });
    }
  }
  const regNames = listNames(P.reg).sort();
  for (const name of regNames) {
    const u = /^(.+)\.uuid$/.exec(name);
    if (u === null || !idOk(u[1])) continue;
    const p = readRegPresence(join(P.reg, name));
    if (p.state === 'value') put(p.value, { id: u[1], generation: registryGenerationOf(P, u[1]), declaredBy: 'registry', path: null });
  }
  for (const name of regNames) {
    const c = /^(.+)\.compactions$/.exec(name);
    if (c === null || !idOk(c[1])) continue;
    const r = readBounded(join(P.reg, name), REG_LOG_MAX, true);
    if (r.state !== 'value') continue;
    const text = r.value;
    for (const line of text.split('\n')) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const t = rec !== null && typeof rec === 'object' ? rec.transcript : null;
      if (typeof t !== 'string' || !t.endsWith('.jsonl')) continue;
      put(basename(t, '.jsonl'), { id: c[1], generation: registryGenerationOf(P, c[1]), declaredBy: 'journal', path: t });
    }
  }
  return m;
}

/** Every `<home>/projects/<p>/<uuid>.jsonl` under the rostered homes, sorted per directory. */
export function transcriptsUnder(homes) {
  const out = [];
  for (const h of homes) {
    for (const proj of listNames(join(h, 'projects')).sort()) {
      for (const f of listNames(join(h, 'projects', proj)).sort()) {
        const u = /^(.+)\.jsonl$/.exec(f);
        if (u !== null && UUID_RE.test(u[1])) out.push({ path: join(h, 'projects', proj, f), uuid: u[1] });
      }
    }
  }
  return out;
}

/** Whether an import may ingest its next budget window (§9.3). An import has no run budget (§9.2 "Backfill"), so
 *  the pass-start probe cannot bound it: before every window this re-measures free space (under
 *  STATFS_DEADLINE_MS, through Task 14's in-process seam when a test injects one), the cap file and the store's
 *  measured size, and lets lib's planRun decide — the rule a scheduled pass applies, never a second one here
 *  (L4). null when it may; else the word it stops on. */
export async function importRoom(db, ctx) {
  const free = await statfsWithDeadline(probePath(ctx.paths, ctx.home), STATFS_DEADLINE_MS, ctx.deps.statfs);
  const sizeBytes = (ctx.deps.measureSize ?? measuredSize)(db, ctx.paths.dbFile);
  const run = planRun({
    historyOff: false, store: { act: 'open' }, free, sizeBytes, capGb: capOf(capText(ctx.paths.cap)).gb,
    migration: 'none', recovering: false,
  });
  if (run.arm !== 'run') return 'store-unreachable';   // planRun's only hold for these inputs: a probe that never settled
  if (run.pause === 'at-cap') return 'at-cap';
  if (run.pause === 'low-disk') return 'capture-paused-low-disk';
  return null;
}

/** importRoom's answer counted and said as a scheduled pass counts a pause (§9.3); true when the import must stop. */
async function importPaused(db, ctx, say) {
  const pause = await importRoom(db, ctx);
  if (pause === null) return false;
  if (pause === 'at-cap') bump(db, 'capture_paused_at_cap');
  if (pause === 'capture-paused-low-disk') bump(db, 'capture_paused_low_disk');
  say(pause);
  return true;
}

/** The word a floor stop inside a window is said with: ingestFile/ingestSidecar counted low-disk where it stopped; an unsettled probe is counted nowhere (§9.3). */
const floorStopWord = (floor) => (floor === 'low-disk' ? 'capture-paused-low-disk' : 'store-unreachable');

/** One file, ingested by cursor with no run budget (§9.2 "Backfill"). This is Task 19's `ingestPath`
 *  (admission, Task 18's `bindFile`, then `ingestFile` from the cursor), called again with a FRESH budget
 *  until the file reaches end-of-file or stops advancing (an unterminated last line, a parser crash). Before
 *  each call `importRoom` re-measures the cap and the floor (through `importPaused`, which counts a pause as a
 *  scheduled pass counts it and says it on stdout): the file answers 'paused', its cursor held for the scheduled ticks (§9.3). Within a call the
 *  floor is probed again before EVERY chunk (§9.3, BK17): the ingest context carries `floorProbeFor(P.dbDir)`,
 *  so Task 19's `ingestFile` stops the file at the chunk that meets the floor, counts a `low-disk` stop there,
 *  and reports the probe's word as `floor`; this function then only says so and answers 'paused', so the stop
 *  is counted once. The journal half runs between calls (§9.2: "passes with real chunks … also run it between
 *  chunks"). A file that is not a regular file under a rostered projects/ root, or that has gone, is counted by
 *  `ingestPath`'s admission and answers 'refused'. The ingest context is Task 19's own `makeIngestCtx`, with
 *  `fts` false, so these blobs are written unindexed; `importApply` then calls Task 23's `resetFtsPending`,
 *  and the next scheduled tick's `deriveFts` indexes them through its full pair index. */
export async function importFile(db, ctx, filePath, uuid) {
  const home = homeOfPath(filePath, ctx.homes) ?? '';
  const say = (word) => ctx.out(`history-sweep: ${word}: ingest stopped at ${filePath}; the scheduled ticks resume it by cursor`);
  for (;;) {
    if (await importPaused(db, ctx, say)) return 'paused';
    // Task 19's per-chunk floor probe, on db/ (a link followed), through the same in-process seam importRoom uses.
    const ictx = makeIngestCtx(ctx.home, ctx.homes, ctx.now(), ctx.ids, floorProbeFor(ctx.paths.dbDir, ctx.deps.statfs));
    const r = await ingestPath(db, ictx, { path: filePath, uuid, home }, newBudget(ctx.now));
    if (r === null) return 'refused';
    if (runJournalHalf(ctx.home, ctx.ids, ctx.now)) throw new JournalError('append-failed');
    if (r.floor !== undefined) {
      say(floorStopWord(r.floor));
      return 'paused';
    }
    if (r.atEof || r.bytes === 0) return 'done';
  }
}

/** The mapped transcripts' sidecars (§9.2 "Backfill": "with their sidecars"; D-4240), taken after their transcripts
 *  by Task 21's ingestSidecars, called again with a FRESH budget while it reports incomplete, as importFile calls
 *  ingestPath: the sidecar_seen marks are its cursor, so a later window skips what an earlier one took. importRoom
 *  re-measures the cap and the floor before each window; inside a window each sidecar's own floor probe runs
 *  (ingestSidecar). The journal half runs between windows (D-4232). A window that took nothing and is still
 *  incomplete (history-off, or a budget spent on nothing) ends it. Answers 'done' or 'paused'. */
async function importSidecars(db, ctx, uuids) {
  if (uuids.length === 0) return 'done';
  const say = (word) => ctx.out(`history-sweep: ${word}: sidecar ingest stopped; the scheduled ticks take the rest`);
  for (;;) {
    if (await importPaused(db, ctx, say)) return 'paused';
    const ictx = makeIngestCtx(ctx.home, ctx.homes, ctx.now(), ctx.ids, floorProbeFor(ctx.paths.dbDir, ctx.deps.statfs));
    const r = await ingestSidecars(db, ictx, newBudget(ctx.now), uuids);
    if (runJournalHalf(ctx.home, ctx.ids, ctx.now)) throw new JournalError('append-failed');
    if (r.paused) { say(floorStopWord(r.floor)); return 'paused'; }
    if (r.complete || r.bytes === 0) return 'done';
  }
}

/** `import` without --apply (§8.4): read-only, one line per file, nothing written. */
function importDryRun(P, homes, args, out) {
  if (args.session !== null) {
    out(`mapped ${args.session} ${registryGenerationOf(P, args.session) || '-'} ${args.file}`);
    return;
  }
  let ro = null;
  try { if (statSync(P.dbFile).size > 0) ro = openReader(P.dbFile); } catch { ro = null; }
  try {
    const ev = importEvidence(ro, P);
    const all = transcriptsUnder(homes);
    for (const t of all) {
      const e = ev.get(t.uuid);
      if (e !== undefined) out(`mapped ${e.id} ${e.generation || '-'} ${t.path}`);
    }
    for (const t of all) if (!ev.has(t.uuid)) out(`unmapped ${t.path}`);
  } finally {
    ro?.close();
  }
}

/** `import --apply` and `import --session <id> --file <path> --apply` (§8.4): map from evidence, one verdict
 *  at a time, then ingest the mapped files one at a time by cursor, then their sidecars (§9.2 "with their sidecars"); list the unmapped, never ingest them. Only
 *  evidence that names a transcript found under the rostered homes is mapped — the dry run's `mapped` lines,
 *  exactly. A pause at the cap or the floor (importFile) ends the ingest, not the pass: the mappings stand. */
async function importApply(db, ctx, P, args) {
  const ends = [];
  if (args.session !== null) {
    const uuid = basename(args.file, '.jsonl');
    const probe = admitFile(args.file, homeOfPath(args.file, ctx.homes) ?? '', ctx.homes, ctx.home);
    if (!probe.ok) {
      bump(db, 'non_regular');
      ctx.out(`history-sweep: ${args.file} is not a regular file under a rostered projects/ root (${probe.why}); nothing mapped`);
      return { rc: EXIT.REFUSED, reason: 'bad-args' };
    }
    closeSync(probe.fd);
    const m = commitMapping(db, ctx, { uuid, id: args.session, declaredBy: 'operator', path: args.file });
    if (m.outcome === 'refused') {
      // D-4313 (history-import-refusal-words): first claim wins, so the operator is told which family holds the uuid.
      process.stderr.write(`history-sweep: ${uuid} is already confirmed in ${m.holder.ccrc_id} (generation ${m.holder.generation || '-'}); nothing mapped or ingested\n`);
      return { rc: EXIT.REFUSED, reason: 'uuid-claimed' };
    }
    ends.push(await importFile(db, ctx, args.file, uuid));
    if (ends[ends.length - 1] === 'done') await importSidecars(db, ctx, [uuid]);
  } else {
    const ev = importEvidence(db, P);
    const all = transcriptsUnder(ctx.homes);
    const mapped = new Set();
    for (const t of all) {
      const e = ev.get(t.uuid);
      if (e === undefined || e.declaredBy === null || mapped.has(t.uuid)) continue;
      mapped.add(t.uuid);
      commitMapping(db, ctx, { uuid: t.uuid, id: e.id, declaredBy: e.declaredBy, path: e.path });
    }
    const done = new Set();
    for (const t of all) {
      if (!ev.has(t.uuid)) continue;
      const end = await importFile(db, ctx, t.path, t.uuid);
      ends.push(end);
      if (end === 'done') done.add(t.uuid);
      if (end === 'paused') break;
    }
    if (!ends.includes('paused') && done.size > 0) await importSidecars(db, ctx, [...done]);
    for (const t of all) if (!ev.has(t.uuid)) ctx.out(`unmapped ${t.path}`);
  }
  // §9.1: these blobs were written with fts_indexed = 0, and a completed ('fts', 1) backfill never looks again
  // (Task 23's deriveFts returns on completed_ms). Task 23's resetFtsPending re-opens it from cursor zero —
  // an old blob can become owed too — so the next scheduled tick's deriveFts indexes them. No ('fts', 1) row (FTS5 absent,
  // or not yet probed): nothing to re-open.
  if (ends.some((end) => end !== 'refused')) resetFtsPending(db);
  return { rc: EXIT.OK };
}

/** `--op migrate` (§6.11 "doctor --migrate"; D-4180 history-migrate-verb): planMigration with NO bound — an operator's shell has no
 *  carrier kill — so only room and the versions decide. refuse-* answer migrate-refused, none answers 0. */
function migrateOp(db, ctx, opened, free) {
  const sizeBytes = (ctx.deps.measureSize ?? measuredSize)(db, ctx.paths.dbFile);
  const verdict = migrationVerdict(db, ctx.home, ctx.paths, {
    stored: opened.stored, code: opened.code, free, sizeBytes, boundS: null, schemaAdded: ctx.deps.schemaAdded ?? SCHEMA_ADDED,
  });
  if (verdict === 'none') {
    ctx.out('history-sweep: nothing to migrate');
    return { rc: EXIT.OK };
  }
  if (verdict !== 'snapshot-then-migrate') {
    ctx.out(`history-sweep: ${verdict}`);
    return { rc: EXIT.REFUSED, reason: 'migrate-refused' };
  }
  const r = runMigration(db, ctx.home, {
    verdict, from: opened.stored, to: opened.code, migrations: ctx.deps.migrations ?? MIGRATIONS,
  });
  setMeta(db, 'migration', 'none');
  ctx.out(`history-sweep: migrated (snapshot ${basename(r.snapshot)}, ${r.copyBps} B/s)`);
  return { rc: EXIT.OK };
}

/** What an --op pass answers for a throw (Task 26F item 5): the message to stderr first, as main() would have printed
 *  it, then ONE result line. A StoreError whose word REASONS knows answers that word's exit with the word; any other
 *  throw is exit 1 with no word. Both of the pass's catch sites answer through it, so the mapping is spelled once. */
function opThrowResult(e, result) {
  process.stderr.write(`history-sweep: internal error: ${e && e.message ? e.message : String(e)}\n`);
  if (e instanceof StoreError && Object.hasOwn(REASONS, e.word)) return result(REASONS[e.word], e.word);
  return result(EXIT.INTERNAL);
}

/** One --op pass: see the block comment above. The pass's contract is ONE {"rc":…} line, printed LAST, on EVERY
 *  path (Task 26F item 5, completed by the final review's FR2-c). `opPass` answers it for a throw inside its try;
 *  this wrapper answers it for the throws that leave `opPass` BEFORE its store is opened (the journal half at lock
 *  take, the dry run, the release half itself), which used to reach main()'s catch with no result line at all, so the
 *  CLI relayed nothing; openStore's own throws are answered inside opPass, after its release half (review 316 F19). */
export async function runOpPass(parsed, deps, out) {
  try {
    return await opPass(parsed, deps, out);
  } catch (e) {
    return opThrowResult(e, (rc, reason) => {
      out(JSON.stringify(reason === undefined ? { rc } : { rc, reason }));
      return rc;
    });
  }
}

async function opPass(parsed, deps, out) {
  const home = deps.home;
  const P = historyPaths(home);
  const now = deps.now ?? Date.now;
  const result = (rc, reason) => {
    out(JSON.stringify(rc === EXIT.OK || reason === undefined ? { rc } : { rc, reason }));
    return rc;
  };
  const verdict = OP_VERBS.has(parsed.op) ? parseOpVerbArgs(parsed.op, parsed.opArgs) : { ok: false, reason: 'bad-args' };
  if (!verdict.ok) return result(EXIT.REFUSED, verdict.reason);
  // Resolved ONCE against the operator's cwd (B1 Task 26F item 2): admission, the file's binding and the journal's
  // mapping verdict then all see one absolute path. Left as typed, a relative path was admitted by its cwd-relative
  // spelling but stored verbatim, giving the file a second path row and a path replay cannot resolve. parseOpVerbArgs
  // freezes its args (and already checked the `<uuid>.jsonl` basename, which resolving does not change), so copy.
  const args = typeof verdict.args.file === 'string' ? { ...verdict.args, file: resolve(verdict.args.file) } : verdict.args;
  const form = formOf(parsed.op, parsed.opArgs);
  // The gate's inputs, read once: RB6's second call below reuses them, so tmux is read at most once per pass.
  const gateEnv = { claudecode: (process.env.CLAUDECODE ?? '') !== '', historyOff: existsSync(P.off) };
  const tty = isatty(0);
  const paneName = paneNameFor(form);
  const gate = decideOpGate(form, gateEnv, tty, paneName);
  if (!gate.ok) return result(gate.rc, gate.reason);
  const role = readRole(P);
  if (role === 'server') {
    out('history-sweep: store-create-refused-role');
    return result(EXIT.NO_STORE);
  }
  if (form === null && parsed.op === 'import' && parsed.rosterUnreadable) {
    // B1's D-4313 (history-import-refusal-words): an unreadable roster is no homes, so there is nothing to list or
    // admit; reading it as an empty roster answered "nothing to import" and exit 0. A dry run writes nothing at all
    // (§8.4), so it cannot count the condition; --apply does (below). Import only: prune's and reparse's dry runs
    // need no roster.
    out('history-sweep: accounts.sh could not be read, so no home is known; nothing listed');
    return result(EXIT.REFUSED, 'roster-unreadable');
  }
  if (form === null) {
    const dry = OP_DRY_RUNS[parsed.op];
    if (dry === undefined) return result(EXIT.REFUSED, 'bad-args');
    // The dry run stats and opens db/history.db, so the bounded probe goes first (§9.3, RR15).
    const reach = await statfsWithDeadline(probePath(P, home), STATFS_DEADLINE_MS, deps.statfs);
    if (reach.state === 'unsettled') return result(EXIT.DB, 'store-unreachable');
    const r = await dry({ home, P, parsed, args, deps, out, now });
    return result(r.rc, r.reason);
  }
  if (runJournalHalf(home, idsFromFiles(P), now)) {
    out('history-sweep: journal-unwritable');
    return result(EXIT.INTERNAL);
  }
  const free = await statfsWithDeadline(probePath(P, home), STATFS_DEADLINE_MS, deps.statfs);
  // §9.2 "An --op pass runs the journal half too" (D-4232): the half at release runs before EVERY answer from here on,
  // not only rc 0. A failed one is said (and counted on an open store, §9.10 "Journal append") and replaces only an rc 0:
  // a refusal keeps its word, as holdPass keeps a hold's. `counted` is true when the outcome is itself a counted journal
  // failure, so it is not counted or said twice.
  const released = (rc, reason, db = null, ids = idsFromFiles(P), counted = false) => {
    if (runJournalHalf(home, ids, now)) {
      if (!counted) {
        if (db !== null) bump(db, 'journal_write_failed');
        out('history-sweep: journal-unwritable');
      }
      if (rc === EXIT.OK) return result(EXIT.INTERNAL);
    }
    return result(rc, reason);
  };
  if (free.state === 'unsettled') return released(EXIT.DB, 'store-unreachable');
  // RB6 (slug history-ops-refused-while-recovering): THE authoritative half. A registered recovery step, measured on
  // its own read-only handle behind the probe above, runs the gate again with `recovering`, before the binding branch
  // (adopt on a bound store is refused) and before openStore (no op marker, no flush, no writer). Only `open`
  // refuses; every other answer is left to openStore's and decideBind's own words. Like store-unreachable, it comes
  // after the lock-take journal half, which moves no cursor, and answers through B1's `released`, so the half at
  // release runs on it as on every other answer from here on. With it go the facts lib's recoveryExempt reads,
  // measured only now: the stored user_version against this build's, counted as openStore counts it (RB13: migrate
  // runs while they differ), and store.id's presence (RB14: adopt runs on an unbound store). The gate decides; this
  // half only measures.
  if (recoverStepAt(P.dbFile) === 'open') {
    const recovery = {
      recovering: true,
      storedVersion: storedVersionAt(P.dbFile),
      codeVersion: deps.migrations === undefined ? SCHEMA_VERSION : deps.migrations.length,
      storeId: measureStoreFacts(home, role).storeId,
    };
    const held = decideOpGate(form, { ...gateEnv, ...recovery }, tty, paneName);
    if (!held.ok) return released(held.rc, held.reason);
  }
  // W1-B2 Task 26: the binding verbs (adopt; restore and rebuild from Tasks 27 and 28) run here, under the lock and
  // after the gate, and never reach openStore, which refuses the very states they repair (§8.4). Their outcome, a
  // refusal included, answers through B1's `released` like every answer after the lock-take half (RF5a F19). The ids
  // are read from the files NOW: a bind writes a new store.writer (restore and rebuild may write another store.id), so
  // the half journals under the binding this pass leaves. `db` is null (finishBind closed the writer), and a journal
  // failure finishBind already said and counted is `counted`, so it is not said twice. A throw out of the binding pass
  // that is no answer of its own (removeStaleTemps' readdir of db/, which fails loudly; a StoreError an arm does not
  // catch) is answered as B1 answers openStore's throw: opThrowResult maps it to one {"rc":…} line, through `released`,
  // so the half at release still runs (RF5a F19). Left to runOpPass's wrapper, it would skip that half.
  if (BINDING_OPS.has(parsed.op)) {
    let b;
    try {
      b = await bindingPass(home, P, parsed.op, args, deps, out);
    } catch (e) {
      return opThrowResult(e, (rc, reason) => released(rc, reason));
    }
    return released(b.rc, b.reason, null, idsFromFiles(P), b.counted === true);
  }
  const handler = OP_HANDLERS[parsed.op];
  if (handler === undefined) return released(EXIT.REFUSED, 'bad-args');
  let opened;
  try {
    // `deps.openStore` is an in-process dependency like `deps.statfs`, never an env var (slug history-test-seams-not-env): the
    // run-pass driver answers a word no real store reaches here, so the arm below that is not exit 5 is pinned (FU4 M28).
    opened = (deps.openStore ?? openStore)(home, P, role, deps);
  } catch (e) {
    return opThrowResult(e, (rc, reason) => released(rc, reason));
  }
  if ('word' in opened) {
    if (parsed.op === 'migrate' && opened.word === 'schema-newer') return released(EXIT.REFUSED, 'migrate-refused');
    return REASONS[opened.word] === EXIT.DB ? released(EXIT.DB, opened.word) : released(EXIT.INTERNAL);
  }
  const { db, ids } = opened;
  // The outcome of the body, said by value: the release half runs ONCE, below, on whatever this answers (review 316
  // round 1 F19, M26). A `released(...)` returned from inside the try put the half's own non-JournalError throw in the
  // catch, which ran the half a second time and printed two `internal error` lines; a throw from the half now leaves
  // opPass once, to runOpPass's wrapper.
  const outcome = (rc, reason, counted = false) => ({ rc, reason, counted });
  try {
    let v;
    try {
      v = await opBody(db, ids);
    } catch (e) {
      if (e instanceof JournalError) {
        bump(db, 'journal_write_failed');
        out('history-sweep: journal-unwritable');
        v = outcome(EXIT.INTERNAL, undefined, true);
      } else {
        // The pass's contract is ONE {"rc":…} line, printed LAST, on every path (Task 26F item 5): the CLI relays it, so a
        // throw that reached main()'s own catch ended stdout with no line at all (opThrowResult; runOpPass's wrapper
        // answers the throws that precede this try).
        v = opThrowResult(e, (rc, reason) => outcome(rc, reason));
      }
    }
    return released(v.rc, v.reason, db, ids, v.counted);
  } finally {
    removeEntry(P.op);
    closeWriter(db);
  }

  async function opBody(db, ids) {
    if (ids === null) {
      out('history-sweep: store.writer cannot be read, so nothing this pass decides could be journaled');
      return outcome(EXIT.DB, 'store-unmeasured');
    }
    if (parsed.op === 'import' && parsed.rosterUnreadable) {
      // D-4313 (history-import-refusal-words): counted and refused before any listing or admission, every import form
      // (the operator's --session --file would otherwise fail admission as outside-roots and count non_regular).
      // --op migrate does not need the roster.
      bump(db, 'roster_unreadable');
      out('history-sweep: accounts.sh could not be read, so no home is known; nothing imported');
      return outcome(EXIT.REFUSED, 'roster-unreadable');
    }
    writeOpMarker(P, parsed.op, now());
    if (!flushFirst(db, home, ids, now)) {
      out('history-sweep: journal-unwritable');
      return outcome(EXIT.INTERNAL, undefined, true);
    }
    clearDoneMarkers(home, opened.stored);
    if (OP_NEEDS_CODE_VERSION.has(parsed.op) && opened.stored !== opened.code) return outcome(EXIT.DB, 'migration-pending');
    const ctx = passCtx({ home, P, ids, parsed, now, out, deps, pause: null, ingest: true });
    const r = await handler({ db, ctx, P, args, opened, free });
    if (r.rc === EXIT.OK) flushOutbox(db, home, ids, now());   // D-4225: only an rc 0 is told "done"
    return outcome(r.rc, r.reason);
  }
}

// ── THE PERIODIC CENSUS (Task 26) ─────────────────────────────────────────────────────────────────
// Every SCAN_INTERVAL_MS the pass re-reads each rostered home's retention, starts a census of the export's
// due and overdue blobs, and audits the journal (§9.2 step 2). It ships in W1-B1, before the export itself
// (W1-B4), so doctor can see the gap (§9.15 "The gap guard"): `export-due` WARNs from the first due blob,
// `export-overdue` FAILs on measured source loss (slug history-export-due-escalates). Due-ness is the
// rule through lib.mjs's planExport and its default reducer: the per-copy rule since W1-B2 (ruled Q15,
// D-4735 (history-export-due-per-copy)), each row against its own holding files. Only the sweep parses the journal (§9.14).
// Departures carried here: D-4207 (history-export-due-escalates: the overdue count on measured source loss),
// D-4208 (history-export-row-age-early: a NULL-ts row ages by its newest holding file), D-4209
// (history-harness-seam-named: retention through HARNESS_TABLE), D-4210 (history-retention-read-from-settings:
// each home's settings.json plus the managed settings, an unreadable home keeping its last value).

const DAY_MS = 86_400_000;
const EXPORT_CENSUS_CHUNK = 2000;

/** The managed-settings sources Claude Code reads on Linux (§9.15, M from the 2.1.289 bundle): the file, and
 *  every *.json in the drop-in directory beside it (an entry ending `.d`). Tests inject their own list
 *  through deps.managedSettings — an in-process dependency, never an env var (slug history-test-seams-not-env). */
export const MANAGED_SETTINGS = Object.freeze(['/etc/claude-code/managed-settings.json', '/etc/claude-code/managed-settings.d']);

/** The read bound of a retention settings file; one holds a few KiB of JSON. An over-cap file is unreadable (D-4347 (history-planted-entries-never-wedge)). */
const SETTINGS_FILE_MAX = 4 * 1024 * 1024;

/** A file as lib.mjs's Readable: absent, unreadable, or its text. Never folded (IV5). */
function readable(p) {
  const r = readBounded(p, SETTINGS_FILE_MAX, true);
  return r.state === 'value' ? { state: 'text', text: r.value } : r.state === 'absent' ? { state: 'absent' } : { state: 'unreadable' };
}

/** Every managed-settings source as a Readable, a drop-in directory expanded to its *.json files (sorted). */
function managedReadables(list) {
  const out = [];
  for (const p of list) {
    if (!p.endsWith('.d')) { out.push(readable(p)); continue; }
    let entries;
    try {
      entries = readdirSync(p).filter((n) => n.endsWith('.json')).sort();
    } catch (e) {
      if (!(e !== null && typeof e === 'object' && e.code === 'ENOENT')) out.push({ state: 'unreadable' });
      continue;
    }
    for (const n of entries) out.push(readable(join(p, n)));
  }
  return out;
}

/** The last retention measured for `home`, in days: the positive integer retentionCensus kept in meta `retention:<home>`,
 *  or null when the home was never measured or the stored text is not one. The ONE reader of that key: the census
 *  feeds it to the harness reader as `lastDays`, and the export pass reads the same number through exportHomeDays. */
function lastRetentionDays(db, home) {
  const raw = getMeta(db, `retention:${home}`);
  return raw !== null && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null;
}

/** §9.15 "The horizon, per source harness": each rostered home's retention through HARNESS_TABLE's
 *  claude-code reader. A measured value is kept per home in meta; an unreadable file or a value that is not a
 *  positive integer is `retention_unmeasured`, and that home keeps its LAST measured value — 30 only when it
 *  was never measured (BK9, RC6) — so one failed read never makes a blob due early. Returns home → days. */
export function retentionCensus(db, homes, managedList) {
  const managed = managedReadables(managedList);
  const days = {};
  for (const h of homes) {
    const last = lastRetentionDays(db, h);
    const r = HARNESS_TABLE['claude-code'].retention({ home: readable(join(h, 'settings.json')), managed, lastDays: last });
    if (r.state === 'unmeasured') bump(db, 'retention_unmeasured');
    else setMeta(db, `retention:${h}`, String(r.days));
    setMeta(db, RETENTION_STATE_META + h, r.state);
    days[h] = r.days;
  }
  const values = Object.values(days);
  setMeta(db, 'retention_min', values.length > 0 ? String(Math.min(...values)) : '');
  const lowered = retentionLowered(days);
  setMeta(db, 'retention_lowered', lowered === null ? '' : JSON.stringify(lowered));
  return days;
}

/** A derivation step's JSON cursor (derivation_state), or null when none is in progress. */
function stepCursorGet(db, step) {
  const row = db.prepare('SELECT cursor FROM derivation_state WHERE step = ? AND version = 1').get(step);
  if (row === undefined || row.cursor === null) return null;
  try { return JSON.parse(row.cursor); } catch { return null; }
}
function stepCursorSet(db, step, state) {
  db.prepare('INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, 1, ?, NULL) '
    + 'ON CONFLICT (step, version) DO UPDATE SET cursor = excluded.cursor, completed_ms = NULL').run(step, JSON.stringify(state));
}
function stepCursorDone(db, step, state, nowMs) {
  db.prepare('INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, 1, ?, ?) '
    + 'ON CONFLICT (step, version) DO UPDATE SET cursor = excluded.cursor, completed_ms = excluded.completed_ms')
    .run(step, state === null ? null : JSON.stringify(state), nowMs);
}

/** Every holding file the census needs, measured ONCE per pass: per transcript, its files' homes,
 *  presence and mtime — planExport's file clock. A referrer's holding files are its TRANSCRIPT's files, not
 *  its own copies through memberships (D-4248,
 *  history-export-holding-files-by-transcript: it can err early or late; the per-row set is W1-B4's). A retired or exported row is a file known gone (§9.2, §9.15); a recorded
 *  mtime stands in for a file that no longer stats. ns columns are divided in SQL, so no value past 2^53
 *  reaches JavaScript. */
function transcriptFiles(db, homes, homeDays) {
  const byTranscript = new Map();
  const trees = projectsTrees(homes);   // each home's projects/ resolved once for the pass, not once per recorded file (H-214)
  const st = db.prepare('SELECT f.transcript_pk, f.source_key, f.mtime_ns / 1000000 AS mtime_ms, p.path '
    + 'FROM ingest_files f LEFT JOIN file_paths p ON p.file_id = f.file_id');
  for (const r of st.iterate()) {
    let present = false;
    let mtimeMs = r.mtime_ms ?? 0;
    if (r.path !== null && r.source_key === '') {
      try {
        const s = statSync(r.path);
        present = s.isFile();
        mtimeMs = s.mtimeMs;
      } catch { present = false; }
    }
    const files = byTranscript.get(r.transcript_pk) ?? [];
    // D-4612 (history-export-file-home-shortest-of-containing): a file under several rostered homes reads against the
    // shortest, not the first listed; null (no home holds it) reads against the shortest of all in filesOf.
    files.push({ home: r.path === null ? null : shortestRetentionHome(homesOfPath(r.path, homes, trees), homeDays), mtimeMs, present });
    byTranscript.set(r.transcript_pk, files);
  }
  return byTranscript;
}

/** RD1's ONE file clock: the holding files of every transcript, as the export census (exportCensus) and the export pass
 *  (exportSelect) both read them, so neither keeps a copy that could drift from the other. Answers
 *  - `files`: transcriptFiles' map, transcript_pk to the files' homes, presence and mtime (B1's census clock: a row's
 *    holding files are its TRANSCRIPT's, not its own copies through memberships, D-4248
 *    history-export-holding-files-by-transcript; each file's home is the shortest-retention rostered home containing it,
 *    B2's D-4612 history-export-file-home-shortest-of-containing);
 *  - `filesOf(pk)`: one transcript's files as lib's ExportFile, a file under no rostered home read against the SHORTEST
 *    rostered home (the early side); `minDays` is that home's retention, shortestRetention's answer;
 *  - `transcripts`: EVERY transcript, a file-less one included (no clock: due at once), `{ key, files }`, ready for lib's
 *    dueTranscriptKeys, the default per-copy rule's prefilter (B2's D-4735 history-export-due-per-copy).
 *  `homeDays` is home to retention days; with no home at all, a file's home is undefined, which fileDueMs reads as the
 *  harness default, as it reads null. */
function exportFileClock(db, homeDays) {
  const homes = Object.keys(homeDays);
  const minDays = shortestRetention(homeDays);
  const minHome = homes.find((h) => homeDays[h] === minDays);
  const files = transcriptFiles(db, homes, homeDays);
  const filesOf = (pk) => (files.get(pk) ?? []).map((f) => ({ home: f.home ?? minHome, mtimeMs: f.mtimeMs, present: f.present }));
  const transcripts = db.prepare('SELECT transcript_pk FROM transcripts ORDER BY transcript_pk').all()
    .map((r) => ({ key: r.transcript_pk, files: filesOf(r.transcript_pk) }));
  return { minDays, files, filesOf, transcripts };
}

/** The candidate blobs of one chunk: unexported, unpruned, past the cursor, with at least one referrer whose
 *  transcript the default rule makes due now (the JSON array of lib's dueTranscriptKeys, bound once per clause).
 *  A blob is due only when EVERY referrer is, which planExport decides; this is only the prefilter, and it is exact
 *  for the per-copy rule (D-4735 (history-export-due-per-copy)), under which every row of one transcript falls due at one
 *  instant: its holding files are its transcript's (D-4248) and the rule
 *  reads no row time. B1's row-clock cutoff would hide a young row whose every file is gone, which the rule counts
 *  as passed. The partial index blobs_unexported serves the outer scan; each `IN (SELECT value FROM json_each(?))`
 *  is uncorrelated, so SQLite evaluates it once per statement. */
const EXPORT_CANDIDATES_SQL = 'SELECT b.blob_id FROM blobs b WHERE b.exported_ms IS NULL AND b.z IS NOT NULL AND b.blob_id > ? AND ('
  + 'EXISTS (SELECT 1 FROM entries e WHERE e.blob_id = b.blob_id AND e.transcript_pk IN (SELECT value FROM json_each(?))) '
  + 'OR EXISTS (SELECT 1 FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id WHERE v.blob_id = b.blob_id AND e.transcript_pk IN (SELECT value FROM json_each(?))) '
  + 'OR EXISTS (SELECT 1 FROM sidecars s WHERE s.blob_id = b.blob_id AND s.transcript_pk IN (SELECT value FROM json_each(?))) '
  + 'OR EXISTS (SELECT 1 FROM boundaries d JOIN entries e ON e.entry_id = d.entry_id WHERE d.kept_blob_id = b.blob_id AND e.transcript_pk IN (SELECT value FROM json_each(?)))'
  + ') ORDER BY b.blob_id LIMIT ?';
/** The referrers of every blob in one chunk's id range, each with its blob, its age and its transcript (§9.15
 *  "A blob is due"): entries, entry_variants and sidecars aging by their entry, and boundaries.kept_blob_id
 *  aging by its boundary's entry. Read ONCE per chunk over the chunk's [first, last] blob ids, never once per
 *  blob: only entries has an index led by its blob column (entries_blob), so a per-blob statement would scan
 *  entry_variants, sidecars and boundaries for every candidate. Rows of a blob in the range that is not a
 *  candidate are dropped in JavaScript. */
const EXPORT_REFERRERS_SQL = 'SELECT e.blob_id AS blob_id, e.ts_ms AS ts_ms, e.transcript_pk AS transcript_pk FROM entries e WHERE e.blob_id BETWEEN ? AND ? '
  + 'UNION ALL SELECT v.blob_id, e.ts_ms, e.transcript_pk FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id WHERE v.blob_id BETWEEN ? AND ? '
  + 'UNION ALL SELECT s.blob_id, e.ts_ms, s.transcript_pk FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id WHERE s.blob_id BETWEEN ? AND ? '
  + 'UNION ALL SELECT d.kept_blob_id, e.ts_ms, e.transcript_pk FROM boundaries d JOIN entries e ON e.entry_id = d.entry_id WHERE d.kept_blob_id BETWEEN ? AND ?';
/** W1-k's holders (§9.15 "If B4 slips"): each transcript that holds an unexported row, with that row's oldest time.
 *  Both subqueries search one transcript through `entries_ts` (transcript_pk, ts_ms); no statement scans `entries`
 *  whole for the date. */
const EXPORT_HOLDERS_SQL = 'SELECT t.transcript_pk AS pk, '
  + '(SELECT min(e.ts_ms) FROM entries e WHERE e.transcript_pk = t.transcript_pk AND e.exported_ms IS NULL) AS m '
  + 'FROM transcripts t WHERE EXISTS (SELECT 1 FROM entries e WHERE e.transcript_pk = t.transcript_pk AND e.exported_ms IS NULL)';

/** The export census (§9.15, W1-k): from the ('export-census', 1) cursor, in chunks, within the run budget,
 *  count the due blobs and, among them, the overdue ones; on completion record them with the W1-k dates. Due-ness is
 *  planExport's default, the per-copy rule since W1-B2 (D-4735 (history-export-due-per-copy)), and the candidate scan
 *  keeps exactly the blobs with a referrer in a transcript that rule makes due (lib's dueTranscriptKeys).
 *  Returns true when complete (or when no census is in progress). */
export function exportCensus(db, nowMs, budget) {
  const state = stepCursorGet(db, 'export-census');
  if (state === null) return true;
  // The file clock and every transcript (a file-less one included: no clock, due at once), shared with the export pass.
  const { files, filesOf, transcripts } = exportFileClock(db, state.homeDays);
  const dueKeys = JSON.stringify(dueTranscriptKeys({ nowMs, homeRetentionDays: state.homeDays, transcripts }));
  const candidates = db.prepare(EXPORT_CANDIDATES_SQL);
  const referrers = db.prepare(EXPORT_REFERRERS_SQL);
  for (;;) {
    if (!budgetLeft(budget)) {
      stepCursorSet(db, 'export-census', state);
      return false;
    }
    const ids = candidates.all(state.last, dueKeys, dueKeys, dueKeys, dueKeys, EXPORT_CENSUS_CHUNK);
    if (ids.length === 0) break;
    const lo = ids[0].blob_id;
    const hi = ids[ids.length - 1].blob_id;
    const wanted = new Set(ids.map((r) => r.blob_id));
    const byBlob = new Map();
    for (const r of referrers.iterate(lo, hi, lo, hi, lo, hi, lo, hi)) {
      if (!wanted.has(r.blob_id)) continue;
      const list = byBlob.get(r.blob_id) ?? [];
      list.push({ tsMs: r.ts_ms, files: filesOf(r.transcript_pk) });
      byBlob.set(r.blob_id, list);
    }
    const blobs = ids.map(({ blob_id: id }) => ({ key: String(id), referrers: byBlob.get(id) ?? [] }));
    const plan = planExport({ nowMs, homeRetentionDays: state.homeDays, blobs });
    state.due += plan.due.length;
    state.overdue += plan.overdue.length;
    // W1-B4 Task 9: when the oldest due blob became due (§9.15 "The gap guard", "How long a due blob has waited"),
    // on this census's own clock, the one the pass selects by (D-4248).
    // A census a B1 pass started carries no dueOldest: it reads as null, never as a time.
    const prevOldest = typeof state.dueOldest === 'number' ? state.dueOldest : null;
    state.dueOldest = plan.oldestDueSinceMs === null ? prevOldest : (prevOldest === null ? plan.oldestDueSinceMs : Math.min(prevOldest, plan.oldestDueSinceMs));
    state.last = ids[ids.length - 1].blob_id;
    stepCursorSet(db, 'export-census', state);
  }
  // W1-k: the oldest unexported row, and the two dates lib's exportDates decides: the first due date over the
  // holders, by the default rule, and the file clock's first deletion date over every measured file.
  const oldest = db.prepare('SELECT min(ts_ms) AS m FROM entries WHERE exported_ms IS NULL').get().m;
  const holders = db.prepare(EXPORT_HOLDERS_SQL).all().map((r) => ({ tsMs: r.m, files: filesOf(r.pk) }));
  const dates = exportDates({ homeRetentionDays: state.homeDays, holders, files: [...files.keys()].flatMap(filesOf) });
  setMeta(db, 'export_due', String(state.due));
  setMeta(db, 'export_overdue', String(state.overdue));
  setMeta(db, HEALTH_META.exportDueOldestMs, exportDueOldestMeta(state.due, state.dueOldest));   // '', a time, or 'unmeasured': lib decides
  setMeta(db, 'export_census_ms', String(nowMs));
  setMeta(db, 'oldest_row_ms', oldest === null ? '' : String(oldest));
  setMeta(db, 'first_due_ms', dates.firstDueMs === null ? '' : String(dates.firstDueMs));
  setMeta(db, 'first_deletion_ms', dates.firstDeletionMs === null ? '' : String(dates.firstDeletionMs));
  stepCursorDone(db, 'export-census', null, nowMs);
  return true;
}

/** The verdict kinds that chain or map an epoch: each epochs row needs one (§9.14, W1-j). */
const EPOCH_VERDICT_KINDS = new Set(['epoch-confirmed', 'epoch-chained', 'mapping']);

/** The journal audit reads a month file this many bytes at a time, asking the run's wall clock before each read (review 316 F17),
 *  and buffers at most this much of one line: a longer line is no record journalRecord writes (a spool record carries one parsed
 *  line of at most SPOOL_LINE_MAX bytes; a verdict ids, a uuid and at most one path), so it is counted in journal_skipped, once,
 *  and never held whole. */
export const AUDIT_READ_BYTES = 1 << 20;

/** The lines of the open file `fd`, in order, read AUDIT_READ_BYTES at a time into ONE reused buffer. `inBudget()` is asked before
 *  EVERY read and a no ends the walk at once (false). `onLine(buf)` gets each `\n`-terminated line without its `\n`, and at EOF a
 *  non-empty unterminated last piece, as `split('\n')` gave; `onLine` must consume its buffer before returning, because the
 *  buffer is a view of the reused read buffer or a copy joined from pieces. A line that spans reads is kept as copied pieces. A
 *  line whose running total passes AUDIT_READ_BYTES is reported as `onLine(null)` exactly once, its pieces dropped, and the rest of
 *  it discarded up to its `\n` (`over`): it is never buffered. true at EOF. */
function auditLines(fd, inBudget, onLine) {
  const buf = Buffer.allocUnsafe(AUDIT_READ_BYTES);
  let pieces = [];
  let have = 0;
  let over = false;
  let pos = 0;
  for (;;) {
    if (!inBudget()) return false;
    const n = readSync(fd, buf, 0, AUDIT_READ_BYTES, pos);
    if (n === 0) break;
    pos += n;
    const chunk = buf.subarray(0, n);   // indexOf must never see the stale tail of a shorter read
    let from = 0;
    while (from < n) {
      const nl = chunk.indexOf(10, from);
      const end = nl === -1 ? n : nl;
      if (!over) {
        have += end - from;
        if (have > AUDIT_READ_BYTES) {
          onLine(null);
          over = true;
          pieces = [];
          have = 0;
        } else if (nl !== -1 && pieces.length === 0) {
          have = 0;
          onLine(chunk.subarray(from, end));    // a whole line inside this read: no copy
        } else {
          pieces.push(Buffer.from(chunk.subarray(from, end)));   // copied: buf is reused by the next read
          if (nl !== -1) { const line = Buffer.concat(pieces); pieces = []; have = 0; onLine(line); }
        }
      }
      if (nl === -1) break;
      over = false;                          // an over-long line ends at its \n
      from = nl + 1;
    }
  }
  if (!over && pieces.length > 0) onLine(Buffer.concat(pieces));
  return true;
}

/** The journal audit (§9.2 step 2, W1-j; rev 3.2 review, DI8): every spool_receipts row has its `spool`
 *  record, every family and every chained epoch its `verdict`, every redact_hashes row its `redact` record.
 *  Incremental by rowid from the ('journal-audit', 1) cursor; this store's journal, one month file at a time
 *  (journal/<store_id>/ only — another store's directory is never read), read AUDIT_READ_BYTES at a time, the run's wall
 *  clock asked before every read, so one large month cannot carry the audit past its budget (F17); a month file is opened
 *  O_NOFOLLOW|O_NONBLOCK and must be a regular file, else journal_audit_unreadable. An audit cut short leaves its cursor
 *  where it was and starts again from the first month at the next census, as before. A month file that cannot be read
 *  counts `journal_audit_unreadable` and ends the audit unfinished.
 *  Skipped while journal_outbox holds rows (their verdicts are still in flight). Folds journal_missing_*
 *  and records journal_skipped (malformed or unknown lines seen) and journal_growth_30d (bytes appended in
 *  the trailing 30 days). Returns true when it ran to the end. */
export function journalAudit(db, ctx, nowMs) {
  // unreachable from periodicCensus: scheduledPass answers 'held' before the tick when ids is null (Task 24); this
  // narrows ctx.ids for the dereference below, so it has no pin of its own (Task 24's held-before-tick case covers it).
  if (ctx.ids === null) return false;
  // Pinned by 'verdicts still in the outbox are not missing' (history-op.test.ts): a tick whose journal append failed
  // leaves its verdicts queued, and an audit run over them would count each one as journal_missing_verdict.
  if (db.prepare('SELECT count(*) AS n FROM journal_outbox').get().n > 0) return false;
  const cur = stepCursorGet(db, 'journal-audit') ?? { receipts: 0, sessions: 0, epochs: 0, redact: 0 };
  const next = { ...cur };
  const want = { spool: new Set(), family: new Set(), epoch: new Set(), redact: new Set() };
  const sReceipts = db.prepare('SELECT rowid AS rid, event_key FROM spool_receipts WHERE rowid > ? ORDER BY rowid');
  for (const r of sReceipts.iterate(cur.receipts)) { want.spool.add(r.event_key); next.receipts = r.rid; }
  const sSessions = db.prepare('SELECT session_pk AS rid, ccrc_id, generation FROM sessions WHERE session_pk > ? ORDER BY session_pk');
  for (const r of sSessions.iterate(cur.sessions)) { want.family.add(`${r.ccrc_id}\0${r.generation}`); next.sessions = r.rid; }
  const sEpochs = db.prepare('SELECT e.rowid AS rid, s.ccrc_id, e.cc_session_uuid FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.rowid > ? ORDER BY e.rowid');
  for (const r of sEpochs.iterate(cur.epochs)) { want.epoch.add(`${r.ccrc_id}\0${r.cc_session_uuid}`); next.epochs = r.rid; }
  const sRedact = db.prepare('SELECT rowid AS rid, len, sha256 FROM redact_hashes WHERE rowid > ? ORDER BY rowid');
  for (const r of sRedact.iterate(cur.redact)) { want.redact.add(`${r.len}\0${Buffer.from(r.sha256).toString('hex')}`); next.redact = r.rid; }
  const dir = join(ctx.paths.journalDir, ctx.ids.storeId);
  const files = listNames(dir).filter((n) => /^[0-9]{4}-[0-9]{2}\.[0-9a-f]{8}\.jsonl$/.test(n)).sort();
  const since = nowMs - 30 * DAY_MS;
  let skipped = 0;
  let growth = 0;
  const inBudget = () => withinBudget({ elapsedMs: ctx.budget.now() - ctx.budget.startMs, bytes: 0, maxMs: ctx.budget.maxMs });
  for (const f of files) {
    let fd = null;
    try {
      // D-4347 (history-planted-entries-never-wedge): a month file is opened as appendJournal opens the live one, O_NOFOLLOW with its type judged on the descriptor, and here nonblocking too, so a FIFO or a link with a month file's name counts journal_audit_unreadable and is never waited on (review 316 F10, F17).
      fd = openSync(join(dir, f), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!fstatSync(fd).isFile()) { bump(db, 'journal_audit_unreadable'); return false; }
      let draining = null;
      const finished = auditLines(fd, inBudget, (b) => {
        if (b === null) { skipped += 1; return; }
        if (b.length === 0) return;
        const line = b.toString('utf8');
        const p = parseJournalRecord(line);
        if (p.kind !== 'record') { skipped += 1; return; }
        const rec = p.rec;
        if (rec.t >= since) growth += b.length + 1;
        if (rec.k === 'file') draining = rec.name;
        else if (rec.k === 'spool' && draining !== null) want.spool.delete(eventKey(draining, rec.ord));
        else if (rec.k === 'redact') want.redact.delete(`${rec.len}\0${rec.sha256}`);
        else if (rec.k === 'verdict' && rec.kind === 'family') want.family.delete(`${rec.ccrc_id}\0${rec.generation}`);
        else if (rec.k === 'verdict' && EPOCH_VERDICT_KINDS.has(rec.kind)) want.epoch.delete(`${rec.ccrc_id}\0${rec.cc_session_uuid}`);
      });
      if (!finished) return false;
    } catch (e) {
      if (!isFsError(e)) throw e;
      // Named, not swallowed (Task 26F item 6): a persistently unreadable month file would otherwise stop every audit
      // with no sign of why, journal_audit_ms merely going stale. periodicCensus ignores the answer, so this counter is
      // the reason.
      bump(db, 'journal_audit_unreadable');
      return false;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }
  if (want.spool.size > 0) bump(db, 'journal_missing_spool', want.spool.size);
  if (want.family.size + want.epoch.size > 0) bump(db, 'journal_missing_verdict', want.family.size + want.epoch.size);
  if (want.redact.size > 0) bump(db, 'journal_missing_redact', want.redact.size);
  stepCursorDone(db, 'journal-audit', next, nowMs);
  setMeta(db, 'journal_audit_ms', String(nowMs));
  setMeta(db, 'journal_skipped', String(skipped));
  setMeta(db, 'journal_growth_30d', String(growth));
  return true;
}

/** §9.15 judges a ROSTERED home (review 316 F13): a `retention_state:<home>` whose home is not in this pass's roster is
 *  removed, since no pass can measure it again and status would name it unmeasured for ever. `retention:<home>`, the
 *  last measured days, is kept: a home that rejoins keeps its last value, as D-4210 keeps an unreadable one's. The
 *  caller passes a READABLE roster only. Returns the homes removed. */
export function reconcileRetentionState(db, homes) {
  const rostered = new Set(homes);
  const gone = db.prepare('SELECT k FROM meta').all().map((r) => String(r.k))
    .filter((k) => k.startsWith(RETENTION_STATE_META) && !rostered.has(k.slice(RETENTION_STATE_META.length)));
  if (gone.length > 0) withTx(db, 'NORMAL', () => { const del = db.prepare('DELETE FROM meta WHERE k = ?'); for (const k of gone) del.run(k); });
  return gone.map((k) => k.slice(RETENTION_STATE_META.length));
}

/** The periodic census, run by every scheduled pass after its tick (a pause included: it only reads and
 *  counts). An unreadable roster skips it (§9.2 step 2); a readable one first removes the retention verdict of every
 *  home that left it (F13). A census in progress continues every pass until complete; a new one starts once
 *  SCAN_INTERVAL_MS has passed since the last start. */
export function periodicCensus(db, ctx) {
  // §9.2 step 2: an UNREADABLE roster knows no home, so it skips the census and removes nothing (F13: unreadable is not empty).
  if (ctx.rosterUnreadable) return;
  reconcileRetentionState(db, ctx.homes);   // every pass, so a home that left stops WARNing at the next pass
  if (ctx.homes.length === 0) return;       // a readable roster with no home: nothing to measure or count
  const nowMs = ctx.now();
  const last = Number(getMeta(db, 'census_ms') ?? 0);
  if (nowMs - last >= SCAN_INTERVAL_MS && stepCursorGet(db, 'export-census') === null) {
    const homeDays = retentionCensus(db, ctx.homes, ctx.deps.managedSettings ?? MANAGED_SETTINGS);
    stepCursorSet(db, 'export-census', { last: 0, due: 0, overdue: 0, homeDays, startMs: nowMs, dueOldest: null });
    setMeta(db, 'census_ms', String(nowMs));
    journalAudit(db, ctx, nowMs);
  }
  exportCensus(db, nowMs, ctx.budget);
}

// ── prune (W1-B2 Task 20) ──────────────────────────────────────────────────────────────────────────
// §6.6 "prune --older-than <dur>", §8.4. A dry run by default: the store read through a read-only handle,
// nothing written. `--apply` (irreversible: a TTY and no cc- pane, both decided by the gate before this
// runs) tombstones every blob whose every referrer is older than the cutoff, in bounded BEGIN IMMEDIATE
// batches with the journal half between them (store.mjs's pruneApply). It never deletes a row, never
// touches the journal or the export, and never decides by a source file's absence (lossless-claw #610,
// DM27). Free space is probed for reachability only, by runOpPass: prune frees space, so a store below the
// floor is exactly the one it must not refuse (history-prune-not-floor-gated).

/** Blobs per prune batch (§6.6 "bounded BEGIN IMMEDIATE batches"). Chosen. */
const PRUNE_BATCH = 500;
/** The most free pages one batch's PRAGMA incremental_vacuum returns: 256 MiB at 4 KiB pages. Chosen. */
const PRUNE_VACUUM_PAGES = 65_536;

/** A dry run's store (§8.4 "dry run by default"): measured as a scheduled pass would find it and opened
 *  READ-ONLY only when decideStoreOpen would open it. No store yet answers rc 0 with a line; a refusal word
 *  answers its own exit; nothing is written — no journal half, no marker, no flush. Returns `{ ro }` or
 *  `{ result }`; the caller closes `ro`. */
function dryRunReader(home, P, out) {
  const verdict = decideStoreOpen(measureStoreFacts(home, readRole(P)));
  if (verdict.act === 'create' || verdict.act === 'drop-pending-create') {
    out('history-sweep: no store on this box yet; nothing to do');
    return { result: { rc: EXIT.OK } };
  }
  if (verdict.act === 'refuse') {
    return { result: REASONS[verdict.word] === EXIT.DB ? { rc: EXIT.DB, reason: verdict.word } : { rc: EXIT.INTERNAL } };
  }
  return { ro: openReader(P.dbFile) };
}

/** `prune --older-than <dur>` without --apply (§6.6): what --apply would tombstone, and how much of it the
 *  export already holds. */
export function pruneDryRunOp(home, P, args, out, nowMs) {
  const r = dryRunReader(home, P, out);
  if (r.result !== undefined) return r.result;
  try {
    const t = pruneDryRun(r.ro, nowMs - args.days * DAY_MS);
    out(`history-sweep: prune --older-than ${args.days}d would tombstone ${t.blobs} blob(s), ${t.bytes} bytes compressed; the export holds ${t.exported} of them`);
    out('history-sweep: a dry run writes nothing; rows, nodes, the journal and the export are never touched; the operator adds --apply, from a terminal outside any session, to tombstone');
    return { rc: EXIT.OK };
  } finally {
    r.ro.close();
  }
}

/** `prune --older-than <dur> --apply` (§6.6): the batched tombstone, the WAL truncated after each batch, the
 *  journal half between batches (a failed append ends the pass through runOpPass's JournalError arm), and the
 *  merge step registered INSIDE each batch that deleted index rows (store.mjs's onDeleted), so the bytes those
 *  deletes left are purged by the scheduled ticks' bounded merges (§6.2) even when the pass stops between
 *  batches. */
export function pruneApplyOp(db, ctx, args) {
  const nowMs = ctx.now();
  const r = pruneApply(db, {
    cutoffMs: nowMs - args.days * DAY_MS,
    nowMs,
    batch: PRUNE_BATCH,
    vacuumPages: PRUNE_VACUUM_PAGES,
    between: () => { if (runJournalHalf(ctx.home, ctx.ids, ctx.now)) throw new JournalError('append-failed'); },
    onDeleted: () => { derivStmts(db).pending.run(MERGE_STEP, 1); },
  });
  ctx.out(`history-sweep: pruned ${r.blobs} blob(s), ${r.bytes} bytes compressed, older than ${args.days} days; every row and node stays, and expand says "content pruned on <date>"`);
  return { rc: EXIT.OK };
}

// ── reparse (W1-B2 Task 21) ────────────────────────────────────────────────────────────────────────
// §8.4 "reparse": the targets, then lib's decideReparse — above REPARSE_MAX_TARGETS (500) reparse-too-many,
// any target over pruned text span-pruned, each refusing the WHOLE run with nothing written. The dry run
// answers the same decision, so it predicts what --apply would do. --apply re-derives in place
// (derive.mjs's reparseLeaves) with this pass's full redaction index and FTS state, then, for an all-leaves or
// --session run, clears the matching leaf-crashed markers (derive.mjs's clearLeafCrashes; RB5).

/** The tick's belt-state rule, for an operator pass that writes index rows or stored node fields (§6.2 "The belt",
 *  rev 3.5; coordinator ruling R-oppass-belt). Only the tick's rederiveFts moves meta fts_belt, through lib's decideBelt, and no
 *  operator pass runs it. A pass whose belt lacks a unit the state records as covered (that unit's file unreadable
 *  during the pass) writes rows without that unit's belt, and its letter-glued or stray-CSI remnants would stay terms
 *  while the state says every row carries it: no belt generation would ever open for them. So, inside the CALLER's
 *  transaction and BEFORE the pass writes its first such row (a kill after a later commit then finds the belt already
 *  due), the belt is recorded due — `{ v: 0, rids: [], gen: null }`, the record Task 23's rebuild writes, which the
 *  next tick's decideBelt opens a generation on — unless the stored state is at BELT_VERSION, its rids are exactly
 *  this pass's live units, and an open generation's gen names no unit outside them and was opened at this BELT_VERSION
 *  (its gv; one at another version restarts from cursor 0, ruling R-version). The rule is the plain inequality:
 *  a live unit the state does not name yet also records it due, which costs at most one extra generation per operator
 *  pass and needs no mark. Answers whether it wrote. Callers: reparseApplyOp and ftsRebuildJob (W1-B2 Task 23:
 *  repair, a resumed repair and the recovery reindex's rebuild). A caller that writes witnessed values ends with
 *  stampBeltWitness after this record (Task 7B; ruling R-rollback). */
export function recordBeltDueIfUncovered(db, pairIdx) {
  const live = new Set(pairIdx?.beltLive ?? []);
  const s = parseBeltState(getMeta(db, BELT_META));
  // The distinct rids, never their count: a damaged row naming one rid twice has the live set's length and members and is not the live set (HB1 H-61).
  const covered = s !== null && s.v === BELT_VERSION && new Set(s.rids).size === live.size && s.rids.every((r) => live.has(r))
    && (s.gen === null || (s.gv === BELT_VERSION && s.gen.every((r) => live.has(r))));
  if (covered) return false;
  setMeta(db, BELT_META, formatBeltState({ v: 0, rids: [], gen: null }));
  return true;
}

/** The decision both forms share: `{ result }` when the run stops (not found, or refused), else
 *  `{ targets }`. Its lines say why. */
function reparsePlan(db, args, out) {
  const t = reparseTargets(db, { node: args.node, session: args.session });
  if (!t.found) {
    out(`history-sweep: no node ${args.node} in this store`);
    return { result: { rc: EXIT.NOT_FOUND } };
  }
  const d = decideReparse({ targets: t.nodeIds.length, prunedSpans: t.pruned.length });
  if (!d.ok) {
    out(d.reason === 'reparse-too-many'
      ? `history-sweep: reparse-too-many: ${t.nodeIds.length} leaves named, above the limit of ${REPARSE_MAX_TARGETS}; the operator names fewer with --node or --session`
      : `history-sweep: span-pruned: ${t.pruned.length} of the ${t.nodeIds.length} leaves named hold pruned text (${t.pruned.slice(0, 3).join(', ')}); their stored derivation stays`);
    return { result: { rc: EXIT.REFUSED, reason: d.reason } };
  }
  return { targets: t.nodeIds };
}

/** `reparse` without --apply: the targets and the decision, on a read-only handle; nothing written. */
export function reparseDryRunOp(home, P, args, out) {
  const r = dryRunReader(home, P, out);
  if (r.result !== undefined) return r.result;
  try {
    const plan = reparsePlan(r.ro, args, out);
    if (plan.result !== undefined) return plan.result;
    out(`history-sweep: reparse would re-derive ${plan.targets.length} leaves from their stored summaries; the operator adds --apply, from a terminal outside any session, to re-derive them`);
    return { rc: EXIT.OK };
  } finally {
    r.ro.close();
  }
}

/** `reparse --apply`: the decision, then the re-derivation with this pass's redaction index (B1's secretsStep,
 *  the frozen list plus the shim's --secrets) and FTS state (ftsPrepare), node ids and sources kept. A leaf whose
 *  derivation still throws is recorded parse-failed and counted (RB5) and the run goes on; the line reports it.
 *  A --node run names no boundary without a leaf, so it clears no marker. Before the first leaf is rewritten, the
 *  tick's belt-state rule (recordBeltDueIfUncovered; spec §6.2 "The belt"); at the end, the pass's own witness
 *  (stampBeltWitness; ruling R-rollback), since its secretsStep can record pairs and it writes no ticks row. */
export function reparseApplyOp(db, ctx, args) {
  const plan = reparsePlan(db, args, ctx.out);
  if (plan.result !== undefined) return plan.result;
  const ictx = makeIngestCtx(ctx.home, ctx.homes, ctx.now(), ctx.ids);
  ictx.pairIdx = secretsStep(db, ictx, ctx.parsed.secrets).pairIdx;
  ictx.fts = ftsPrepare(db, ictx.nowMs).tables;
  registerNodesMerge(ictx, db);   // a leaf's nodes_fts delete registers the merge step, as the tick's does (D-4609)
  withTx(db, 'NORMAL', () => { recordBeltDueIfUncovered(db, ictx.pairIdx); });   // the op pass's belt rule (reparse)
  const r = reparseLeaves(db, ictx, plan.targets);
  const cleared = args.node === null ? clearLeafCrashes(db, { session: args.session }) : 0;
  withTx(db, 'NORMAL', () => { stampBeltWitness(db); });   // the op pass's witness (reparse)
  // The skipped count is its own (D-4602 (history-reparse-counts-skips-and-rethrows-store-faults), HB1 H-54): a leaf read as nothing is not 'unchanged'.
  ctx.out(`history-sweep: reparsed ${plan.targets.length} leaves (${r.changed} changed, ${r.failed} failed, ${r.skipped} skipped); node ids and sources unchanged`);
  if (cleared > 0) ctx.out(`history-sweep: reparse: ${cleared} crashed boundary marker(s) cleared; the next tick derives their leaves`);
  return { rc: EXIT.OK };
}

// ── doctor --backup (W1-B2 Task 22) ────────────────────────────────────────────────────────────────
// §8.4 "doctor --backup"; §6.11's planCopy. A writing form but not an irreversible one: the gate refuses it under
// CLAUDECODE and history-off, and it needs no TTY. It runs at any stored version (a snapshot is exactly what an
// operator takes before a risky act), and the copy's single VACUUM INTO is uninterruptible: runOpPass's journal
// half runs at the lock's take and its release.

/** `--op backup`: a stale backup temp is removed first (D-4588, history-backup-stale-temp-before-room-probe), so the
 *  free space measured next already includes the bytes a killed copy left; that free space is measured now, on db/
 *  (a link followed) under STATFS_DEADLINE_MS; lib's planCopy must admit the store's measured size above the floor's
 *  threshold, because the copy itself takes that much (§9.3); then store.mjs's writeBackup, which records copy_bps
 *  at whatever version the store is (§8.4). D-4695 (history-backup-preflight-and-rename) is the preflight. */
export async function backupOp(db, ctx) {
  const P = ctx.paths;
  removeStaleBackupTemps(ctx.home);
  const free = await statfsWithDeadline(P.dbDir, STATFS_DEADLINE_MS, ctx.deps.statfs);
  if (free.state === 'unsettled') return { rc: EXIT.DB, reason: 'store-unreachable' };
  const storeBytes = (ctx.deps.measureSize ?? measuredSize)(db, P.dbFile);
  const room = free.state === 'ok' ? planCopy({ freeBytes: free.bytes, thresholdBytes: floorThreshold(free.fsSize), sizeBytes: storeBytes }) : { admit: false, needBytes: null };
  if (!room.admit) {
    ctx.out(room.needBytes === null || free.state !== 'ok'
      ? 'history-sweep: backup-refused: free space on the store\'s filesystem could not be measured, so no copy is admitted'
      : `history-sweep: backup-refused: a copy needs more than ${room.needBytes} bytes free on the store's filesystem (the free-space threshold plus the store's ${storeBytes} bytes); ${free.bytes} are free`);
    return { rc: EXIT.REFUSED, reason: 'backup-refused' };
  }
  let r;
  try {
    r = writeBackup(db, ctx.home, { nowMs: ctx.now() });
  } catch (e) {
    if (!(e instanceof StoreError) || e.word !== 'backup-exists') throw e;
    ctx.out(`history-sweep: backup-refused: ${e.message}; the operator takes it again in a second`);
    return { rc: EXIT.REFUSED, reason: 'backup-refused' };
  }
  ctx.out(`history-sweep: backup written: ~/${STORE_DB_REL}/backups/${r.name} (${r.sizeBytes} bytes, ${r.copyBps} B/s); the operator puts it back with ccrc history doctor --restore ${r.name}, from a terminal outside any session`);
  return { rc: EXIT.OK };
}

// ── doctor --repair (W1-B2 Task 23) ────────────────────────────────────────────────────────────────
// §8.4 "doctor --repair": PRAGMA integrity_check, then a foreign_key_check baseline diff that refuses on NEW
// violations (lib's diffForeignKeys, P21), then the FTS self-heal as a resumable job. Irreversible (a TTY, no
// cc- pane), refused under CLAUDECODE and history-off, and run only at the code's version (Task 19's
// OP_NEEDS_CODE_VERSION).
//
// The self-heal REBUILDS both FTS tables from the store, never row by row (history-repair-rebuilds-fts-whole):
// an index that holds a term indexed before its redaction pair was learned — a sessions.json token, whose pair
// has no value to phrase-search (B1 Task 23) — cannot be cleaned in place, and a dropped or damaged table
// (P24's checks, shadows per table) has nothing to clean. It also indexes the blobs B1's backfill cursor had
// already passed. The job is the derivation step (lib's FTS_REBUILD_STEP, <start ms>); its state commits with
// each chunk, so a killed repair resumes where it stopped when it is run again. While a rebuild is open,
// ftsPrepare keeps meta fts at fts-pending and grep's index gate reads the open step itself (recall.mjs's
// indexGate), so grep answers exit 7 rather than miss what the new index lacks.
//
// foreign_key_check runs twice per job (RB7): the baseline, measured once before the first chunk and kept in the
// step's cursor, and the diff at completion, inside the completion's transaction. A chunk never runs one: inside a
// chunk a new violation can only come deferred, and a deferred one fails that chunk's COMMIT, which the job maps
// to a refusal.

/** Blobs per rebuild transaction: larger than the backfill's 256, because a repair is an operator's act that
 *  runs to completion in one pass. Chosen. */
const REBUILD_BATCH = 2048;
/** The rebuild's phases after its start, in order. */
const REBUILD_PHASES = Object.freeze(['blobs', 'nodes', 'merge']);

/** A completion whose baseline diff found foreign-key violations the job's baseline does not hold (C61, RB7). */
class ForeignKeyRefusal extends Error {
  constructor(rows) {
    super(`${rows.length} new foreign-key violation(s)`);
    this.name = 'ForeignKeyRefusal';
    this.rows = rows;
  }
}

/** A chunk's COMMIT refused by a deferred foreign-key violation: SQLITE_CONSTRAINT_FOREIGNKEY, errcode 787
 *  (measured, 24.14.1); the message is matched too, for a build whose error carries no errcode. withTx has
 *  already rolled the chunk back. */
function isForeignKeyCommitFailure(e) {
  return e !== null && typeof e === 'object' && (e.errcode === 787 || /FOREIGN KEY constraint failed/.test(String(e.message)));
}

/** B1's four spool counters' standing conditions (D-4723 (history-counter-resets-after-cure)), by lstat, readdir and access(2),
 *  never through a link and never opening a file (B1's D-4347 rules):
 *  - drain_rejected: the entries in .draining/rejected/ (B1's D-4346);
 *  - spool_displaced: the regular files with a draining name in any .draining/planted/<area>/;
 *  - spool_blocked: the draining files whose .obs or .obs.tmp name holds a directory;
 *  - spool_unreadable: the other draining files this user cannot read, or whose regular .obs it cannot.
 *  null = unmeasured, never 0: a spool/ or .draining that is a link or other non-directory, one this user cannot use,
 *  or any lstat or listing that fails. A spool/ or .draining that is absent holds nothing: 0 for all four. */
export function measureSpoolStanding(home) {
  const H = HEALTH_COUNTERS;
  const all = (v) => ({ [H.drainRejected]: v, [H.spoolDisplaced]: v, [H.spoolBlocked]: v, [H.spoolUnreadable]: v });
  const P = historyPaths(home);
  try {
    const spool = dirKind(P.spool);
    if (spool === 'absent') return all(0);
    if (spool === 'other' || spoolUnusable(home)) return all(null);
    const dr = dirKind(P.draining);
    if (dr === 'absent') return all(0);
    if (dr === 'other') return all(null);
    const kind = (p) => {
      try { const st = lstatSync(p); return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other'; }
      catch (e) { if (e && e.code === 'ENOENT') return 'absent'; throw e; }
    };
    const readable = (p) => { try { accessSync(p, constants.R_OK); return true; } catch { return false; } };
    const sub = (name, count) => {
      const k = dirKind(`${P.draining}/${name}`);
      return k === 'absent' ? 0 : k === 'other' ? null : count(`${P.draining}/${name}`);
    };
    const rejected = sub(REJECTED_DIR, (d) => readdirSync(d).length);
    const displaced = sub(PLANTED_DIR, (d) => {
      let n = 0;
      for (const area of readdirSync(d)) {
        if (kind(`${d}/${area}`) !== 'dir') continue;
        for (const name of readdirSync(`${d}/${area}`)) if (drainingNameParts(name) !== null && kind(`${d}/${area}/${name}`) === 'file') n += 1;
      }
      return n;
    });
    let blocked = 0;
    let unreadable = 0;
    for (const name of readdirSync(P.draining)) {
      if (drainingNameParts(name) === null) continue;
      const file = `${P.draining}/${name}`;
      if (kind(file) !== 'file') continue;
      const stem = file.slice(0, -'.jsonl'.length);
      if (kind(`${stem}.obs`) === 'dir' || kind(`${stem}.obs.tmp`) === 'dir') blocked += 1;
      else if (!readable(file) || (kind(`${stem}.obs`) === 'file' && !readable(`${stem}.obs`))) unreadable += 1;
    }
    return { [H.drainRejected]: rejected, [H.spoolDisplaced]: displaced, [H.spoolBlocked]: blocked, [H.spoolUnreadable]: unreadable };
  } catch {
    return all(null);
  }
}

/** Inside the caller's transaction: lib's decideCounterResets over `standing`, written with store.mjs's setCounter.
 *  Answers { standing, before, writes } for the caller's report (D-4723 (history-counter-resets-after-cure)). */
export function applyCounterResets(db, standing) {
  const before = {};
  for (const name of Object.keys(standing)) before[name] = counterOf(db, name);
  const writes = decideCounterResets(before, standing);
  for (const w of writes) setCounter(db, w.name, w.n);
  return { standing, before, writes };
}

/** The four spool counters re-measured against the spool as it stands, in one transaction. */
function spoolCounterResets(db, home) {
  const standing = measureSpoolStanding(home);
  return withTx(db, 'NORMAL', () => applyCounterResets(db, standing));
}

/** doctor --repair's line for each re-measured counter it wrote, or that still holds a count. */
function reportCounterResets(ctx, r) {
  for (const [name, m] of Object.entries(r.standing)) {
    const w = r.writes.find((x) => x.name === name);
    const had = r.before[name];
    if (w !== undefined) ctx.out(`history-sweep: repair: ${name} ${had} -> ${w.n}: ${w.n === 0 ? 'nothing it counts stands now' : `${m} stand now`}`);
    else if (had > 0) ctx.out(`history-sweep: repair: ${name} stays ${had}: ${m === null ? 'what it counts could not be measured' : `${m} still stand`}`);
  }
}

/** The open rebuild — its version and its state `{ phase, blobId, baseline, undecodable }` (the cursor's JSON;
 *  `undecodable`: the blobs that did not decode so far in this job) — or null.
 *  A state that does not parse reads as phase `start`: the next chunk drops and recreates the tables again
 *  rather than insert into an index it cannot place a cursor in.
 *  A baseline whose element is not a row object reads the same way (H-76): the completion's diff would throw a TypeError on it inside
 *  its transaction, so every repair would exit 1 and grep would stay at fts-pending, and the restart re-measures the baseline. */
export function openFtsRebuild(db) {
  const r = db.prepare('SELECT version, cursor FROM derivation_state WHERE step = ? AND completed_ms IS NULL ORDER BY version DESC LIMIT 1')
    .get(FTS_REBUILD_STEP);
  if (r === undefined) return null;
  let s = null;
  try { s = JSON.parse(r.cursor ?? 'null'); } catch { s = null; }
  const ok = s !== null && typeof s === 'object' && REBUILD_PHASES.includes(s.phase) && Number.isSafeInteger(s.blobId)
    && (s.baseline === null || (Array.isArray(s.baseline) && s.baseline.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))))
    && Number.isSafeInteger(s.undecodable) && s.undecodable >= 0;
  return { version: Number(r.version), state: ok ? s : { phase: 'start', blobId: 0, baseline: null, undecodable: 0 } };
}

/** One round of the rebuild within `i.budget` (B1's newBudget): the start, the blobs phase, nodes_fts, then
 *  merge steps to completion. The FIRST chunk, in ONE transaction, drops both tables (store.mjs's
 *  dropFtsTables), recreates them, resets derive.mjs's nodes_fts backfill, marks meta fts pending, indexes the
 *  first batch and saves the step — so a first chunk whose COMMIT fails leaves the old index exactly as it was.
 *  Each blobs chunk indexes every blob that a row of INDEXED_PROVENANCE or a sidecar references, its plain text
 *  redacted with `ictx.pairIdx` (B1's indexBlob); it deletes the blob's row first, because a tick that ran
 *  between two repair passes may already have indexed a new blob into the new table, and FTS5 merges a second
 *  insert of one rowid instead of refusing it. Two refusals (RB7), each a value, never a throw:
 *  - a chunk whose COMMIT fails on a deferred foreign-key violation is rolled back by withTx and answers
 *    `refused: { at: 'chunk' }`; the step keeps its last committed cursor;
 *  - with a baseline (FkRow[]) in its state, the completion runs diffForeignKeys inside its own transaction, and
 *    a new violation rolls the completion back (the step stays open, meta fts stays fts-pending) and answers
 *    `refused: { at: 'completion', rows }`.
 *  Each blob's index text is B1's ftsTextOfBlob (async: a sidecar's window is read through unbrotliPrefix, and
 *  redacted before its cut), so a chunk's texts are computed BEFORE its transaction opens, as B1's deriveFts does:
 *  an await inside withTx's callback would let the COMMIT run first. As in B1's backfill (B1's D-4312), the pick
 *  selects ids and compressed sizes only, each `z` is fetched one at a time and charged to the budget by its
 *  compressed size, and a chunk stops taking blobs once its text reaches B1's FTS_GROUP_CHARS, so a chunk never
 *  holds a batch's bodies or 2048 sidecar windows. Each `ftsTextOfBlob` call passes the blob's stored raw_len (B1's
 *  D-4346): a body that does not decode keeps no row and is counted in the state's
 *  `undecodable`, and an over-cap body is marked indexed with no row (B1's indexBlob `overCap`).
 *  The first chunk also records meta fts_belt due (§6.2 "The belt"), since the rebuilt rows carry only the belt of the
 *  units loaded now, and every call first applies recordBeltDueIfUncovered (the operator passes' belt-state rule), so
 *  a resumed call whose belt lacks a unit a tick's generation recorded since records the belt due as well.
 *  `i.baseline` is used only when the job starts. Answers { done, refused }. When done, the completion's transaction
 *  also re-measures blob_undecodable (applyCounterResets) and the answer carries that result as counters. */
export async function ftsRebuildJob(db, ictx, i) {
  // spec §6.2 "The belt" (R-oppass-belt): the tick's belt-state rule, on EVERY call and before any row is written. A resumed
  // call never runs the first chunk's record again, and a tick's belt generation may have completed since it did.
  withTx(db, 'NORMAL', () => { recordBeltDueIfUncovered(db, ictx.pairIdx); });   // the op pass's belt rule (rebuild)
  const open = openFtsRebuild(db);
  const version = open?.version ?? i.stepVersion;
  let st = open?.state ?? { phase: 'start', blobId: 0, baseline: i.baseline ?? null, undecodable: 0 };
  if (st.phase === 'start' && st.baseline === null && i.baseline != null) st = { ...st, baseline: i.baseline };
  const pick = db.prepare(`SELECT b.blob_id AS blob_id, length(b.z) AS zlen, ${FTS_IS_SIDECAR_SQL} AS is_sidecar FROM blobs b WHERE b.blob_id > ? AND ${FTS_ELIGIBLE_SQL} ORDER BY b.blob_id LIMIT ?`);
  const save = db.prepare(`INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES (?, ?, ?, NULL)
    ON CONFLICT(step, version) DO UPDATE SET cursor = excluded.cursor, completed_ms = NULL`);
  const check = (s) => {
    if (s.baseline === null) return;
    const d = diffForeignKeys(s.baseline, foreignKeyRows(db));
    if (d.newViolations.length > 0) throw new ForeignKeyRefusal(d.newViolations);
  };
  try {
    while (budgetLeft(i.budget)) {
      if (st.phase === 'start' || st.phase === 'blobs') {
        const starting = st.phase === 'start';
        const from = starting ? 0 : st.blobId;
        const batch = pick.all(from, ...INDEXED_PROVENANCE, ...INDEXED_PROVENANCE, REBUILD_BATCH);
        const baseline = st.baseline;
        // The texts first, outside any transaction (B1's ftsTextOfBlob is async); one z at a time.
        const texts = [];
        let chars = 0;
        let bad = 0;   // blobs of this chunk whose stored bytes do not decode (B1's D-4346)
        for (const b of batch) {
          const zr = derivStmts(db).blobZ.get(b.blob_id);   // B1's blobZ reads z and raw_len
          const t = zr === undefined || zr.z === null ? null : await ftsTextOfBlob(zr.z, b.is_sidecar === 1, ictx.pairIdx, zr.raw_len);
          if (t !== null && t.undecodable) bad += 1;
          // An undecodable blob keeps no row; an over-cap one is marked indexed with no row (B1's indexBlob `overCap`).
          texts.push({
            id: Number(b.blob_id), text: t === null || t.undecodable ? null : t.text, overCap: t !== null && t.overCap === true,
            undecodable: t !== null && t.undecodable === true, mode: b.is_sidecar === 1 ? 'sidecar' : 'entry',
          });
          i.budget.bytes += Number(b.zlen);
          chars += t === null || t.text === null ? 0 : t.text.length;
          if (chars >= FTS_GROUP_CHARS) break;
        }
        const whole = texts.length === batch.length;
        st = withTx(db, 'NORMAL', () => {
          if (starting) {
            dropFtsTables(db);
            createFtsTables(db);
            setStep(db, NODES_FTS_STEP, 1, '0', null);
            setMeta(db, 'fts', 'fts-pending');
            // The rebuilt rows carry the belt of the units loaded now, which may lack one whose file is unreadable: record
            // the belt due, so the next tick's belt generation re-derives with the units loaded then (§6.2 "The belt";
            // W1-B2 Task 7B). A recovery reindex rebuilds through here too.
            setMeta(db, BELT_META, formatBeltState({ v: 0, rids: [], gen: null }));
          }
          const f = ftsStmts(db);
          let last = from;
          for (const t of texts) {
            last = t.id;
            f.del.run(last);
            if (t.text !== null) indexBlob(db, last, t.text, ictx.pairIdx, t.overCap);
            // D-4346 F3, as deriveFts classifies it: the decoder mode that failed this blob. No bump: the completion re-measures.
            else if (t.undecodable) setMeta(db, ftsUndecodableKey(t.id), t.mode);
          }
          const next = { phase: whole && batch.length < REBUILD_BATCH ? 'nodes' : 'blobs', blobId: last, baseline, undecodable: st.undecodable + bad };
          save.run(FTS_REBUILD_STEP, version, JSON.stringify(next));
          return next;
        });
        continue;
      }
      if (st.phase === 'nodes') {
        if (indexNodesFts(db, ictx, i.budget) > 0) continue;
        const next = { ...st, phase: 'merge' };
        withTx(db, 'NORMAL', () => {
          save.run(FTS_REBUILD_STEP, version, JSON.stringify(next));
          derivStmts(db).pending.run(MERGE_STEP, 1);
        });
        st = next;
        continue;
      }
      mergeSteps(db, ictx, i.budget);
      const m = derivStmts(db).sel.get(MERGE_STEP, 1);
      if (m !== undefined && m.completed_ms === null) continue;
      const finished = st;
      const counters = withTx(db, 'NORMAL', () => {
        db.prepare('UPDATE derivation_state SET completed_ms = ?, cursor = NULL WHERE step = ? AND version = ?')
          .run(ictx.nowMs, FTS_REBUILD_STEP, version);
        check(finished);
        // D-4723 (history-counter-resets-after-cure): this job read every blob B1's blob_undecodable can count (INDEXED_PROVENANCE
        // and every sidecar, z not NULL), so its count is the standing one: 0 resets the counter, more raises it.
        return applyCounterResets(db, { [HEALTH_COUNTERS.blobUndecodable]: finished.undecodable });
      });
      return { done: true, refused: null, counters };
    }
    return { done: false, refused: null };
  } catch (e) {
    if (e instanceof ForeignKeyRefusal) return { done: false, refused: { at: 'completion', rows: e.rows } };
    if (isForeignKeyCommitFailure(e)) return { done: false, refused: { at: 'chunk' } };
    throw e;
  }
}

/** `--op repair`: integrity first (a store that fails it is a restore's or a rebuild's, never an index's), then
 *  the FK baseline (measured once, before the first chunk; a resumed job keeps the one in its cursor), then the
 *  rebuild in budget-bounded rounds with the journal half between them, then ftsPrepare to set meta fts back to
 *  ready, then B1's health counters re-measured (D-4723 (history-counter-resets-after-cure): blob_undecodable by the
 *  rebuild's completion, the four spool counters against the spool as it stands; with FTS5 absent, the spool's four
 *  only; a refused repair writes none). The pair index is this pass's full one (B1's secretsStep: every pair ever recorded plus the frozen list
 *  and the shim's --secrets), so no value known now is ever a term. */
export async function repairOp(db, ctx) {
  // D-4591 (history-repair-heals-index-integrity-rows): rows naming only blobs_fts or nodes_fts are index damage the rebuild below replaces.
  let problems;
  try {
    problems = integrityCheck(db);
  } catch (e) {
    if (isBusy(e) || !(e instanceof Error)) throw e;
    ctx.out(`history-sweep: integrity_check could not run: ${e && e.message ? e.message : String(e)}`);
    // H-80: the cause is worded by what was measured. A throw out of integrity_check names an FTS cause only when the FTS tables
    // are measured unhealthy; a store whose FTS tables stand (a CORRUPT or I/O error, say) has its integrity unmeasured, no more.
    // H-201: and only when an FTS index was ever set up: a store on a Node without FTS5 never made the tables, so its empty set is
    // not a missing index. FTS was set up when the meta says ready or some FTS table or shadow stands (a partial set).
    let fts = null;
    let ftsSetUp = false;
    try {
      const measured = ftsMeasure(db);
      fts = ftsTablesHealthy(measured);
      ftsSetUp = measured.tables.size > 0 || getMeta(db, 'fts') === 'ready';
    } catch { fts = null; }
    const remedy = 'the operator restores a backup (ccrc history doctor --restore <file>) or rebuilds from the journal (ccrc history doctor --rebuild), from a terminal outside any session';
    ctx.out(fts !== null && ftsSetUp && (!fts.blobs || !fts.nodes)
      ? `history-sweep: repair-refused: an FTS index whose own tables are missing cannot be opened, dropped or rebuilt by a repair; ${remedy}`
      : `history-sweep: repair-refused: PRAGMA integrity_check could not run, so the store's integrity is unmeasured and no rebuild starts; ${remedy}`);
    return { rc: EXIT.REFUSED, reason: 'repair-refused' };
  }
  const gate = decideIntegrity(problems);
  if (gate.verdict === 'store') {
    for (const p of problems.slice(0, 5)) ctx.out(`history-sweep: integrity_check: ${p}`);
    ctx.out('history-sweep: repair-refused: the store fails PRAGMA integrity_check, which no index rebuild can fix; the operator restores a backup (ccrc history doctor --restore <file>) or rebuilds from the journal (ccrc history doctor --rebuild), from a terminal outside any session');
    return { rc: EXIT.REFUSED, reason: 'repair-refused' };
  }
  if (gate.verdict === 'index') {
    for (const p of gate.rows.slice(0, 5)) ctx.out(`history-sweep: integrity_check: ${p} (index damage: the rebuild replaces it)`);
  }
  // H-81: the summary lines lead with the verdict; rows listed as index damage are never followed by "integrity_check ok".
  const integrityLead = gate.verdict === 'ok' ? 'integrity_check ok' : 'integrity_check: index damage only (listed above)';
  const ictx = makeIngestCtx(ctx.home, ctx.homes, ctx.now(), ctx.ids);
  const prep = ftsPrepare(db, ictx.nowMs);
  // D-4603 (history-repair-refuses-a-failed-probe): a probe that THREW is not an FTS5 that is absent (spec §9.1: "never folded
  // into absent"; grep keeps them apart, 5 against 7). The repair cannot tell whether an index exists, so it heals nothing, answers
  // exit 5 and re-measures no counter. Only a Node without FTS5 has no index to heal, and that arm below stays exit 0.
  if (prep.state === 'probe-failed') {
    ctx.out('history-sweep: probe-failed: the FTS5 probe threw on this store, so the repair cannot tell whether an index exists; nothing was repaired');
    return { rc: EXIT.DB, reason: 'probe-failed' };
  }
  if (!prep.tables) {
    const present = foreignKeyRows(db).length;
    ctx.out(`history-sweep: repair: ${integrityLead}; ${present} foreign-key violation(s) present; FTS5 is ${prep.state} on this Node, so there is no index to heal`);
    reportCounterResets(ctx, spoolCounterResets(db, ctx.home));   // blob_undecodable stays as it is: no rebuild read the blobs
    return { rc: EXIT.OK };
  }
  ictx.pairIdx = secretsStep(db, ictx, ctx.parsed.secrets).pairIdx;
  ictx.fts = true;
  const open = openFtsRebuild(db);
  const baseline = open === null || open.state.phase === 'start' ? foreignKeyRows(db) : null;
  if (open === null) {
    const health = ftsTablesHealthy(ftsMeasure(db));
    ctx.out(`history-sweep: repair: ${integrityLead}; ${baseline.length} foreign-key violation(s) already present, kept as the baseline`);
    ctx.out(`history-sweep: repair: blobs_fts ${health.blobs ? 'healthy' : 'damaged or missing'}, nodes_fts ${health.nodes ? 'healthy' : 'damaged or missing'}; rebuilding both from the store`);
  } else {
    // H-76: a version no Date can hold (a damaged row) would throw a RangeError here, so it is said as an unrecorded time.
    const started = Number.isSafeInteger(open.version) && Math.abs(open.version) <= 8.64e15 ? new Date(open.version).toISOString() : 'at an unrecorded time';
    ctx.out(`history-sweep: repair: resuming the index rebuild started ${started} at its ${open.state.phase} phase`);
  }
  let rebuilt = null;
  for (;;) {
    const r = await ftsRebuildJob(db, ictx, { stepVersion: ictx.nowMs, budget: newBudget(ctx.now), baseline });
    if (r.refused !== null && r.refused.at === 'chunk') {
      ctx.out(`history-sweep: repair-refused: a rebuild chunk would have committed a foreign-key violation (FOREIGN KEY constraint failed at COMMIT); that chunk was rolled back, and ${openFtsRebuild(db) === null
        ? 'nothing was rebuilt: the old index stands'
        : 'the rebuild stays open: grep answers fts-pending until a repair finishes'}`);
      return { rc: EXIT.REFUSED, reason: 'repair-refused' };
    }
    if (r.refused !== null) {
      const named = r.refused.rows.slice(0, 5).map((v) => `${v.table} -> ${v.parent}`).join(', ');
      ctx.out(`history-sweep: repair-refused: ${r.refused.rows.length} new foreign-key violation(s) (${named}) since this rebuild's baseline; the rebuilt index stays pending (grep answers fts-pending), and a repair refuses again until the violation is removed; the operator may instead restore the store (ccrc history doctor --restore <file>) or rebuild it (ccrc history doctor --rebuild), from a terminal outside any session`);
      return { rc: EXIT.REFUSED, reason: 'repair-refused' };
    }
    if (r.done) { rebuilt = r; break; }
    if (runJournalHalf(ctx.home, ctx.ids, ctx.now)) throw new JournalError('append-failed');
  }
  ftsPrepare(db, ctx.now());
  // The pass's own writes witnessed (Task 7B's stampBeltWitness; ruling R-rollback): its secretsStep can record pairs and
  // it writes no ticks row; it ran secretsStep's witness check first, so the stamp hides no other build's writes.
  withTx(db, 'NORMAL', () => { stampBeltWitness(db); });   // the op pass's witness (repair)
  ctx.out('history-sweep: repaired: both FTS tables rebuilt from the store with the full redaction index, and merged');
  // D-4723 (history-counter-resets-after-cure): the rebuild re-measured blob_undecodable at its completion; the spool's four now.
  reportCounterResets(ctx, rebuilt.counters);
  reportCounterResets(ctx, spoolCounterResets(db, ctx.home));
  return { rc: EXIT.OK };
}

// ── W1-B2 Task 27: doctor --restore (§8.4 "doctor --restore <file>"; slugs history-restore-verb,
// history-restore-wal-mode, history-binding-facts-before-link). It reuses Task 26's bindFactsOf and finishBind. ─────

/** The restore's belt-witness hooks (spec §6.2 "The belt"; coordinator ruling R-witness-restore), which store.mjs's
 *  commitRestore runs on the staged copy inside its FULL bind transaction: `check` before any write, `stamp` after the
 *  journal's pairs. The pair insert raises the top redact_hashes rowid, a value beltWitness reads, and a belt-aware
 *  writer that changes witnessed values checks first, then writes, then stamps:
 *  - check: Task 7B's recordBeltDueIfWitnessMoved, the one function secretsStep calls at a pass's start (ruling
 *    R-rollback), which opens no withTx of its own. A copy whose witness moved since its fts_belt was stamped (a backup
 *    taken after a build without the belt wrote) has its belt recorded due, which also clears an open generation's
 *    record so that it restarts;
 *  - stamp: Task 7B's stampBeltWitness, so the first recovery pass does not read the restore's own pairs as another
 *    build's writes. The check ran first in the same transaction, so the stamp hides nothing. */
const RESTORE_BELT = {
  check(db) { recordBeltDueIfWitnessMoved(db); },   // the restore's witness check (R-witness-restore)
  stamp(db) { stampBeltWitness(db); },
};

/** `doctor --restore <name>` (§8.4): put a backup under db/backups/ back as this box's store.
 *  It first removes the writer temps a killed pass left in db/ (a killed restore's full-size copy among them): the
 *  lock is held, so every temp is stale (§9.4), and free space is then measured without the dead copy. Task 26's
 *  binding section names this as each verb's first step.
 *  Refusals come next, and none of them writes anything:
 *  - the name (restoreNameOk: a <ts>.db or a pre-v<N>.db, never a path or a temp);
 *  - the file, by lstat, so a symlink is never followed (only an absent name is a refusal; any other failure is exit 1,
 *    D-4608 (history-restore-io-failure-is-not-a-refusal));
 *  - the binding table on the facts as they stand (decideBind, Task 6): a DB present, an orphaned WAL, a store.id
 *    naming another store, an unreadable binding input (exit 5);
 *  - room for the copy (planCopy, the one copy preflight, §6.11; a statfs that throws reads low-disk, R3).
 *  Then the copy is staged and judged again on what only the copy can tell: its store_id, its user_version and its
 *  integrity_check. It is committed with every binding fact inside it before it becomes history.db (Task 24's
 *  commitRestore: WAL set, bound:<ms>, a new writer, the ('recover', <ms>) step, the bind outbox row, then the
 *  pending marker and link()), and with every redact pair the store's journal holds (Task 25's journalRedactPairs;
 *  R-restore-pairs), so §9.14's "redaction first" holds from the moment the store is visible. A journal file the pair
 *  read could not open refuses the restore (D-4593 (history-restore-refuses-unread-journal-pairs)): the copy is
 *  removed, nothing is linked and no binding file is written, and so does a link, socket, FIFO or directory at a month name
 *  (data the read cannot see; H-184); a REGULAR file whose head names another store is not this store's, and is skipped
 *  with a notice naming it, as recovery skips it (H-103). A StoreError from the commit (a copy with no store_id, or
 *  one that will not take WAL: store-not-wal, exit 5) answers its own word and exit, as adoptArm answers one; the
 *  finally removes the temp. It runs before openStore, because a missing store is the state it exists to repair. It
 *  runs under history-off too, since it is a binding verb (§8.4); its recovery step waits for the switch. */
export async function restoreArm(home, P, args, deps, out) {
  const now = deps.now ?? Date.now;
  const role = readRole(P);
  removeStaleTemps(home);
  const refuse = (detail) => {
    out(`history-sweep: restore-refused: ${detail}`);
    return { rc: EXIT.REFUSED, reason: 'restore-refused' };
  };
  // Defence in depth: Task 6's parseOpVerbArgs restore case refuses a bad name restore-refused before the gate, so this line cannot go red alone.
  if (typeof args.name !== 'string' || !restoreNameOk(args.name)) {
    return refuse(`${JSON.stringify(args.name)} is not a <ts>.db or pre-v<N>.db name under db/backups/`);
  }
  const file = `${P.backups}/${args.name}`;
  let st;
  try {
    st = lstatSync(file);
  } catch (e) {
    // Only an absent name is a refusal of the argument; EACCES, EIO, ENOTDIR and the rest say nothing about it, so they are exit 1
    // (D-4608 (history-restore-io-failure-is-not-a-refusal); R-T27-3).
    if (e && e.code === 'ENOENT') return refuse(`db/backups/${args.name} cannot be read`);
    throw e;
  }
  // Defence in depth: Task 24's stageRestore opens O_NOFOLLOW and refuses a non-regular file with nothing written, so this line cannot go red alone.
  if (!st.isFile()) return refuse(`db/backups/${args.name} is not a regular file; a symlink is never followed`);
  const facts = bindFactsOf(home, role, deps, {});
  // Residual (D-4608): peekStoreId folds every failure to 'unreadable' (B1 shares it, D-4219), so an I/O error on the backup refuses here as restore-refused.
  const restorePre = decideBind('restore', {
    ...facts, backup: { regular: true, storeId: peekStoreId(file), userVersion: null, integrityOk: null },
  });
  if (!restorePre.ok) {
    out(`history-sweep: ${restorePre.reason}: ${restorePre.detail}${OPERATOR_ACTS}`);
    return { rc: restorePre.rc, reason: restorePre.reason };
  }
  const free = await statfsWithDeadline(probePath(P, home), STATFS_DEADLINE_MS, deps.statfs);
  // Defence in depth: opPass refuses an unsettled probe earlier (B1), so this line cannot go red alone.
  if (free.state === 'unsettled') return { rc: EXIT.DB, reason: 'store-unreachable' };
  const restoreRoom = free.state === 'ok'
    ? planCopy({ freeBytes: free.bytes, thresholdBytes: floorThreshold(free.fsSize), sizeBytes: st.size })
    : { admit: false, needBytes: null };
  if (!restoreRoom.admit) {
    return refuse(restoreRoom.needBytes === null
      ? 'free space on the store\'s filesystem could not be measured, so no copy is admitted'
      : `a copy of ${st.size} bytes needs more than ${restoreRoom.needBytes} bytes free, and ${free.bytes} are`);
  }
  removeStaleOpMarker(P);   // H-101: a planted entry at op would fail the marker's rename (EISDIR) before any open clears it
  writeOpMarker(P, 'restore', now());
  let staged = null;
  try {
    try {
      staged = stageRestore(home, args.name);
    } catch (e) {
      // Only a StoreError is a refusal; an I/O failure (a full disk, a read error) is exit 1, never narrowed into restore-refused (R-T27-3).
      removeStaleTemps(home);
      if (!(e instanceof StoreError)) throw e;
      return refuse(`db/backups/${args.name} could not be copied and opened (${e.message})`);
    }
    const restorePost = decideBind('restore', {
      ...facts,
      backup: { regular: true, storeId: staged.storeId, userVersion: staged.userVersion, integrityOk: staged.integrityOk },
    });
    if (!restorePost.ok) {
      out(`history-sweep: ${restorePost.reason}: ${restorePost.detail}${OPERATOR_ACTS}`);
      return { rc: restorePost.rc, reason: restorePost.reason };
    }
    // Redaction first, at the link (R-restore-pairs; spec §8.4 and §9.14): every redact record of this store's journal
    // goes into the copy inside commitRestore's bind transaction, before link(), so no read verb ever serves the
    // restored store without a pair the journal knows. The witness is checked before those pairs go in and stamped
    // after them, in the same transaction (RESTORE_BELT; R-witness-restore).
    const journalPairs = journalRedactPairs(P, restorePost.storeId);
    if (journalPairs.unreadable.length > 0) {
      // D-4593 (history-restore-refuses-unread-journal-pairs), refined by H-103: read verbs answer while the recovery step is registered,
      // and under D-4592 the step's index phase fails its chunk rather than read an unreadable file, so a pair only
      // that file holds would be served unmasked from the restored blobs. Refuse; the finally removes the copy.
      // A FOREIGN file is not refused: it is no file of this store's, no readability cures it, and recovery skips it.
      // H-219: a link, socket, FIFO or directory at a month name is refused too, and the chmod remedy cannot cure it (journalEnds
      // opens O_NOFOLLOW: ELOOP whatever the mode), so it has its own clause and its own remedy; the chmod clause keeps the rest.
      const notRegular = journalPairs.nonRegular;
      const unreadableOnly = journalPairs.unreadable.filter((n) => !notRegular.includes(n));
      if (unreadableOnly.length > 0) {
        out(`history-sweep: restore-refused: ${unreadableOnly.length} journal file(s) could not be read for redact pairs: ${unreadableOnly.join(', ')}; the operator makes them readable, from a terminal outside any session, and runs the restore again`);
      }
      if (notRegular.length > 0) {
        out(`history-sweep: restore-refused: ${notRegular.length} journal entr${notRegular.length === 1 ? 'y' : 'ies'} at a month-file name are not regular files: ${notRegular.join(', ')}; the operator puts the regular month file back, or removes the entry, from a terminal outside any session, and runs the restore again`);
      }
      abortRestore(staged);
      staged = null;
      return { rc: EXIT.REFUSED, reason: 'restore-refused' };
    }
    try {
      commitRestore(home, staged, { nowMs: now(), pairs: journalPairs.pairs, belt: RESTORE_BELT });
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      out(`history-sweep: restore stopped: ${e.message}${OPERATOR_ACTS}`);
      return REASONS[e.word] === undefined ? { rc: EXIT.INTERNAL } : { rc: REASONS[e.word], reason: e.word };
    }
    staged = null;
    if (journalPairs.foreign.length > 0) {
      out(`history-sweep: restore: ${journalPairs.foreign.length} journal file(s) not read for redact pairs: ${journalPairs.foreign.join(', ')}; each is a regular file whose head names another store, so it is not this store's, and recovery skips them too (journal_head_mismatch)`);
    }
    return finishBind(home, P, role, deps, out, now);
  } finally {
    if (staged !== null) abortRestore(staged);
    removeEntry(P.op);   // B1's type-aware removal (history-planted-entries-never-wedge), as adoptArm's
  }
}

// ── W1-B2 Task 28: doctor --rebuild (§8.4 "doctor --rebuild [--store-id <uuid>]"; slugs history-rebuild-verb,
// history-store-recoverable, history-binding-facts-before-link). It reuses Task 26's bindFactsOf and finishBind. ───

/** The journal directories that could name a store to rebuild (§8.4 "Its store_id"): every uuid-named directory
 *  under journal/. Each comes with whether its heads agree: it has at least one month file, and every month file's
 *  head names this directory. A directory carried in by hand under another name therefore names nothing.
 *  Month files and their heads are read exactly as recovery reads them (Task 25's JOURNAL_NAME_RE and journalEnds,
 *  O_NOFOLLOW), so rebuild and replay never disagree about which files a directory holds. A head that is missing or
 *  unreadable names no store (§9.14: link() of a fsynced temp means no month file exists without its head).
 *  Each answers `heads` in five words, never one boolean (D-4605 (history-rebuild-unreadable-journal-is-unmeasured);
 *  the "no overloaded null at a seam"; D-4605 refined by whole-branch fix round 1, H-227):
 *  - `agree`: it has a month file and every month file's head names this directory;
 *  - `empty`: it holds no month file at all. Measured: appendJournal is the only writer that makes a journal/<id>/ directory
 *    (mkdirDurable, then createMonthFile), so a crash, an ENOSPC or an fsync failure between the two leaves exactly this, with at
 *    most a dot-named temp that JOURNAL_NAME_RE does not read; a hand-made directory is the only other way. There is nothing to
 *    replay in it, which is not a head that disagrees (decideBind reads it as nothing to replay);
 *  - `disagree`: a month file read whole whose head is missing or names another store;
 *  - `foreign`: a month name holds a link, socket, FIFO or directory (journalEnds kind `foreign`) and no file read whole
 *    has disagreed. That is measured and permanent, so decideBind refuses it (exit 2) naming the entry, where
 *    `unreadable` is a retry (H-178). It outranks `unreadable`;
 *  - `unreadable`: the directory cannot be listed, or a month file cannot be read (journalEnds kind `unreadable` or
 *    `gone`) and nothing measured has already disagreed or been foreign, or the directory cannot be
 *    searched (its lstat fails with anything but ENOENT; H-108). decideBind answers it exit 5
 *    store-unmeasured, as it answers an unlistable journal/, and a rebuild never mints a store under that id.
 *  The precedence is disagree, then foreign, then unreadable, whatever the order the month files are read in (H-179). */
export function journalStoreDirs(home) {
  const dir = historyPaths(home).journalDir;
  const out = [];
  for (const name of listNames(dir).sort()) {
    if (!UUID_RE.test(name)) continue;
    const sub = `${dir}/${name}`;
    try {
      if (!lstatSync(sub).isDirectory()) continue;
    } catch (e) {
      // Gone between the listing and here (ENOENT): nothing to name. Any other failure (a journal/ listed but not searchable,
      // EACCES) leaves a name that exists and cannot be measured, so it is named unreadable and never dropped, which would read it as
      // absent ("nothing names a store_id"); the listing in store.mjs's facts names it too (H-108).
      if (e && e.code === 'ENOENT') continue;
      out.push({ storeId: name, heads: 'unreadable' });
      continue;
    }
    let names;
    // Sorted, as journalListing sorts: the verdict does not depend on the order, but a test of its precedence needs one (H-179).
    try { names = readdirSync(sub).sort(); } catch { out.push({ storeId: name, heads: 'unreadable' }); continue; }
    const months = names.filter((m) => JOURNAL_NAME_RE.test(m));
    let heads = months.length > 0 ? 'agree' : 'empty';
    for (const m of months) {
      const e = journalEnds(`${sub}/${m}`);
      if (e.kind !== 'ends') {
        // A link, socket, FIFO or directory at a month name is a measured, permanent condition (`foreign`, H-178), where a
        // name that cannot be read (or vanished) is cured by a retry or a chmod. A disagreement outranks both, and a
        // foreign entry outranks an unreadable file, in either order.
        const word = e.kind === 'foreign' ? 'foreign' : 'unreadable';
        if (heads === 'agree' || (heads === 'unreadable' && word === 'foreign')) heads = word;
        continue;
      }
      if (e.headStore !== name) heads = 'disagree';
    }
    out.push({ storeId: name, heads });
  }
  return out;
}

/** `doctor --rebuild [--store-id <uuid>]` (§8.4): rebuild a lost DB from what else holds its data.
 *  - First, the writer temps a killed pass left in db/ are removed: the lock is held, so every temp is stale (§9.4),
 *    as Task 26's binding section orders it.
 *  - Precondition and store_id: Task 6's decideBind('rebuild') over the store's facts, `--store-id` and the journal
 *    directories. A refusal writes nothing else and names the candidate directories.
 *  - Creation: Task 24's createStore with that store_id. Its creation transaction holds bound:<ms> = rebuild, a new
 *    writer, the ('recover', <ms>) step and the bind outbox row before link(). store.id, when absent, is written
 *    through the pending marker, which the next pass finishes after a kill.
 *  - Then finishBind (Task 26): open, flush the bind, the release journal half.
 *  The following passes run the recovery step (Task 25) and then re-ingest every transcript on disk from empty
 *  cursors (the backfill path). It runs under history-off too, since it is a binding verb. */
export async function rebuildArm(home, P, args, deps, out) {
  const now = deps.now ?? Date.now;
  const role = readRole(P);
  removeStaleTemps(home);
  const dirs = journalStoreDirs(home);
  const rebuildVerdict = decideBind('rebuild', bindFactsOf(home, role, deps, {
    storeIdArg: typeof args.storeId === 'string' ? args.storeId : null, journalDirs: dirs,
  }));
  if (!rebuildVerdict.ok) {
    out(`history-sweep: ${rebuildVerdict.reason}: ${rebuildVerdict.detail}${OPERATOR_ACTS}`);
    // D-4606 (history-rebuild-store-id-hint-where-it-cures): the candidates are named on every refusal (spec §8.4), and the
    // --store-id clause only where lib says the flag cures it (`remedy`). A DB present, a leftover -wal, a store.id
    // disagreement and the exit-5 arms are cured by nothing the flag does.
    if (dirs.length > 0 && rebuildVerdict.rc === EXIT.REFUSED) {
      out(`history-sweep: journal store directories: ${dirs.map((x) => x.storeId).join(', ')}${rebuildVerdict.remedy === 'store-id' ? '; the operator names one with --store-id <uuid>, from a terminal outside any session' : ''}`);
    }
    return { rc: rebuildVerdict.rc, reason: rebuildVerdict.reason };
  }
  removeStaleOpMarker(P);   // H-101: a planted entry at op would fail the marker's rename (EISDIR) before any open clears it
  writeOpMarker(P, 'rebuild', now());
  try {
    createStore(home, { storeId: rebuildVerdict.storeId, bind: { kind: 'rebuild', nowMs: now() } });
    return finishBind(home, P, role, deps, out, now);
  } finally {
    removeEntry(P.op);   // B1's type-aware removal (history-planted-entries-never-wedge), as adoptArm's
  }
}

// ── W1-B2 Task 29: the recovery step's reindex phase (§9.14 "Redaction first": a restore whose journal adds a
// pair the backup lacked re-runs the FTS derivation over the restored blobs; slugs history-redaction-journaled,
// history-redaction-reindex-merge) ───────────────────────────────────────────────────────────────────────────

/** How many nodes one batch of the reindex phase re-derives before the budget is checked again. */
const RECOVER_NODE_BATCH = 64;
/** The node sub-step's cursor: which pass (every leaf, then every condensed node) and the last nodes.rowid done. */
const RECOVER_NODES_CURSOR_RE = /^(leaves|condensed):([0-9]+)$/;
/** The node sub-step's derivation step, at the recovery's version; RECOVER_REBUILT_STEP's sibling. */
const RECOVER_NODES_STEP = 'recover-nodes';
/** The step, at the recovery's version, completed once this recovery's FTS rebuild (its merge steps included)
 *  completed, so a pass after it never starts another rebuild. */
const RECOVER_REBUILT_STEP = 'recover-merge';

/** The full pair index: every redact_hashes row. That is every pair loaded from a file and every pair the replay
 *  applied, so a rotated value is still known. With it, the pass's substring belt (§8.3 layer 4; Task 25's
 *  run.ectx.belt), so a node field rewritten here is masked as the tick masks it. The FTS rebuild below marks the belt
 *  due (Task 23), so the next tick's belt generation re-derives blobs_fts with the units loaded then.
 *  The belt-state rule for this phase (spec §6.2 "The belt"; the coordinator's ruling R-oppass-belt): a unit
 *  missing from a recovery pass's belt must never stay recorded covered in meta fts_belt. Two things keep it, neither
 *  of them a call here:
 *  - recoverPass runs rederiveFts before recoveryStep, in the same pass and with the same live units (Task 25), so
 *    lib's decideBelt drops every unit this pass's belt lacks from fts_belt's rids and gen before any node is
 *    rewritten here;
 *  - ftsRebuildJob applies Task 21's recordBeltDueIfUncovered on every call (Task 23), with this phase's pair index.
 *    That index carries no beltLive, so the rule reads the live set as empty and records the belt due unless the
 *    recorded state names no unit: a recovery that re-derived nodes costs at most one belt generation, fail-closed.
 *  The node rewrite adds no call of its own. With an FTS table it always precedes this phase's rebuild, and with none
 *  rederiveFts never reads fts_belt, so such a call could never be the one that holds and no case could red it. The
 *  recovery-belt case pins the rule; Step 7A's M12, which removes both mechanisms, is its red. secretsStep's witness
 *  check (Task 7B) can record the belt due too, but not in that case: the restore stamped its own pair insert (Task
 *  27's RESTORE_BELT; ruling R-witness-restore), and the case asserts that before any recovery pass runs. */
function recoverPairIdx(db, belt) {
  return makePairIndex(db.prepare('SELECT len, sha256 FROM redact_hashes').all()
    .map((r) => ({ len: Number(r.len), sha256: Buffer.from(r.sha256).toString('hex') })), belt);
}

/** The open recovery step's version (its bind ms), or null when none is registered: recoveryStep's own row (Task 25's
 *  RECOVER_ROW_SQL, its one spelling). */
function openRecoverVersion(db) {
  const row = db.prepare(RECOVER_ROW_SQL).get();
  return row === undefined ? null : Number(row.version);
}

/** One batch of the node sub-step:
 *  - leaves first: one whose summary is still stored is re-derived (reparseFailClosed: same id, parents re-rolled,
 *    a throw counted parser_crash and passed over, never retried by the next pass); every leaf of the batch is then
 *    rewritten through redactNodeFields;
 *  - then every condensed node is re-rolled from its children, each read through redactField first, and then rewritten
 *    through redactNodeFields: rowid order puts a child before its parent, so a parent built from a child the rewrite
 *    cleaned is clean too, and a prefix of a value that an old cut left in a parent's gist, which a field rewrite can
 *    never mask, is rebuilt away (D-4610 (history-reroll-from-redacted-children)).
 *  Its cursor is (RECOVER_NODES_STEP, version), committed after the batch's own transactions
 *  (D-4730 (history-reindex-subcursor-idempotent)): re-deriving is idempotent, so a batch re-run after a kill costs
 *  time, never correctness. Answers whether the sub-step is complete. */
function recoverNodesBatch(db, rctx, version) {
  const step = getStep(db, RECOVER_NODES_STEP, version);
  if (step !== null && step.completedMs !== null) return true;
  const at = RECOVER_NODES_CURSOR_RE.exec(step?.cursor ?? '');
  const pass = at === null ? 'leaves' : at[1];
  const after = at === null ? 0 : Number(at[2]);
  const batch = pass === 'leaves'
    ? db.prepare(`SELECT n.rowid AS rid, n.node_id, (n.summary_blob_id IS NOT NULL AND b.z IS NOT NULL) AS readable
        FROM nodes n LEFT JOIN blobs b ON b.blob_id = n.summary_blob_id
        WHERE n.kind <> 'condensed' AND n.rowid > ? ORDER BY n.rowid LIMIT ?`).all(after, RECOVER_NODE_BATCH)
    : db.prepare(`SELECT rowid AS rid, node_id, 0 AS readable FROM nodes
        WHERE kind = 'condensed' AND rowid > ? ORDER BY rowid LIMIT ?`).all(after, RECOVER_NODE_BATCH);
  if (batch.length === 0) {
    if (pass === 'leaves') {
      withTx(db, 'NORMAL', () => { setStep(db, RECOVER_NODES_STEP, version, 'condensed:0', null); });
      return false;
    }
    withTx(db, 'NORMAL', () => { setStep(db, RECOVER_NODES_STEP, version, `condensed:${after}`, rctx.nowMs); });
    return true;
  }
  const leaves = batch.filter((r) => r.readable === 1).map((r) => r.node_id);
  if (leaves.length > 0) reparseFailClosed(db, rctx, leaves);
  if (pass === 'condensed') rerollNodes(db, rctx, batch.map((r) => r.node_id));
  // Every node of the batch, re-derived or not: a leaf refreshLeaf had to skip, or that threw, is still rewritten
  // fail-closed (R2).
  redactNodeFields(db, rctx, batch.map((r) => r.node_id));
  withTx(db, 'NORMAL', () => { setStep(db, RECOVER_NODES_STEP, version, `${pass}:${Number(batch[batch.length - 1].rid)}`, null); });
  return false;
}

/** The recovery step's `reindex` phase, run through Task 25's RECOVER_EXECUTORS.reindex (recoverReindexChunk).
 *  It runs only when the replay's first pass added a pair the store lacked (cur.pairsAdded). Otherwise it is done
 *  at once: a rebuild starts empty, and every row it re-ingests is indexed redacted already. In order, within the
 *  run budget:
 *  1. every node's gist, topics and refs, re-derived or rewritten with the full pair index (recoverNodesBatch), a
 *     batch per call;
 *  2. the FTS index rebuilt over every blob and nodes_fts from those fields, by Task 23's ftsRebuildJob at this
 *     step's version. That job completes only after its own merge steps complete ('fts-merge', 1), so a rotated
 *     value is then no term and no index byte (§6.2). RECOVER_REBUILT_STEP records its completion, so a later
 *     pass never starts another; a kill between the two runs the rebuild once more, which is idempotent.
 *  Before the rebuild, any OTHER open rebuild is deleted. ftsRebuildJob resumes the newest open rebuild of any
 *  version, and one the restored file carried (a repair killed before the backup was taken) indexed its earlier
 *  blobs without the pairs the replay added: resumed, it would leave them terms. This rebuild re-indexes every
 *  blob, which subsumes it, and it carries no foreign-key baseline, so it cannot answer `refused`; a refusal would
 *  mean a job this code failed to supersede, and it throws, so recoveryStep counts recover_chunk_failed and ends
 *  the pass rather than call it again.
 *  One bounded sub-step per call (R-T29-2): one node batch, or one ftsRebuildJob call, or the completed merge marker.
 *  Task 25's recoveryStep then re-checks the budget, history-off and the free-space floor before the next call, as it
 *  does before every executor chunk. One ftsRebuildJob call runs its own chunk loop on one floor probe, as doctor
 *  --repair's does: that job owns its chunking. ftsRebuildJob answers not-done only when the budget ran out after it did
 *  work, so that counts as moved. This answers `moved: false` with `done: false` only when the budget was spent
 *  before any work.
 *  Each sub-step keeps its own derivation row and opens its own transactions, so this must run outside any
 *  transaction (the first sub-step's withTx throws inside one), and those cursors commit after each batch (D-4730
 *  (history-reindex-subcursor-idempotent)). Its progress
 *  lives in those rows, so it returns the recovery cursor unchanged. B4 inserts its export phases before this one
 *  in Task 25's phase table. It is async because Task 23's ftsRebuildJob is (B1's ftsTextOfBlob is async), and it
 *  awaits that job between, never inside, its sub-steps' transactions.
 *  It moves neither meta fts_reindex_rid nor fts_rederive (B1's REINDEX_META and REDERIVE_META). B1's rederiveFts,
 *  which every tick and every recovery pass runs, therefore re-derives the rebuilt table once more afterwards (or
 *  continues a generation the restored file carried), and the belt generation the rebuild marked due (Task 23) runs
 *  too. Both are idempotent and cost only time. Moving the mark here would vouch for a pair learned between this
 *  rebuild's calls, which its earlier blobs never saw, since each call builds its pair index afresh. */
export async function recoverReindex(db, ctx, cur, budget) {
  if (cur.pairsAdded !== true) return { cur, done: true, moved: true };
  const version = openRecoverVersion(db);
  if (version === null) return { cur, done: true, moved: true };
  const b = budget ?? ctx.budget;
  const nowMs = ctx.now();
  const fts = db.prepare("SELECT 1 AS t FROM sqlite_master WHERE type = 'table' AND name = 'blobs_fts'").get() !== undefined;
  const rctx = { ...ctx, ...makeIngestCtx(ctx.home, ctx.homes, nowMs, ctx.ids), pairIdx: recoverPairIdx(db, ctx.belt ?? null), fts };
  while (budgetLeft(b)) {
    if (!recoverNodesBatch(db, rctx, version)) return { cur, done: false, moved: true };
    if (fts && getStep(db, RECOVER_REBUILT_STEP, version) === null) {
      const others = db.prepare('SELECT count(*) AS n FROM derivation_state WHERE step = ? AND completed_ms IS NULL AND version <> ?')
        .get(FTS_REBUILD_STEP, version);
      if (Number(others.n) > 0) {
        withTx(db, 'NORMAL', () => {
          db.prepare('DELETE FROM derivation_state WHERE step = ? AND completed_ms IS NULL AND version <> ?').run(FTS_REBUILD_STEP, version);
        });
      }
      const rebuilt = await ftsRebuildJob(db, rctx, { stepVersion: version, budget: b });
      if (rebuilt.refused !== null) {
        const why = rebuilt.refused.at === 'completion'
          ? `${rebuilt.refused.rows.length} new foreign-key violation(s) at completion`
          : 'a chunk failed its foreign-key check and was rolled back';
        throw new Error(`the recovery's index rebuild was refused: ${why}`);
      }
      // Its budget ran out after real work: the next call resumes it at its cursor.
      if (!rebuilt.done) return { cur, done: false, moved: true };
      withTx(db, 'NORMAL', () => { setStep(db, RECOVER_REBUILT_STEP, version, 'merged', nowMs); });
      return { cur, done: true, moved: true };
    }
    return { cur, done: true, moved: true };
  }
  return { cur, done: false, moved: false };
}

// ── W1-B4 Task 5: the sole-copy export pass (spec §9.15 "What is due", "The pass"; D-4754 (history-sole-copy-export)) ──────
// One pass writes ONE immutable segment, export/<store_id>/<seq>.<writer>.db, on the home filesystem and never under
// db/, so a lost volume leaves it (D-4172). Four phases, one function each:
//   1. exportSelect: the candidate rows, page by page, in four runs: the rows with no ts_ms first, then the young rows
//      (at or past the ts cutoff) of each transcript lib's dueTranscriptKeys makes due, then the older rows by time
//      through entries' partial index entries_unexported, then the unlinked sidecars whose blob nothing has exported
//      (D-4761 (history-export-unlinked-sidecar-with-blob)). Within a run the order is (ts_ms, entry_id), or blob id for
//      the sidecars; across the runs it is not one time order. Every candidate carries its transcript's files, the
//      census's per-row set (D-4248), and lib's planSegment (L1), with its default
//      reducer, the census's per-copy one (B2's D-4735 (history-export-due-per-copy); RD1's one clock), decides each page under
//      what is left of the bound: EXPORT_SEGMENT_MAX_BYTES, or what the run's byte budget has left, each row counted at
//      its new blob bytes and its metadata (D-4760 (history-export-segment-bound-estimated)).
//   2. writeSegmentRows: through store.mjs, each row after what places it (its families, transcript, epochs and the
//      files it names), then the entry, its variants, its boundary, its linked sidecars and its memberships by (path,
//      dev, ino, line). The bytes of every blob it references that is not yet exported travel with it
//      (D-4758 (history-export-row-carries-blob)), and a pruned blob as a stub with no bytes
//      (D-4759 (history-export-pruned-row-stub)). No internal id is written.
//   3. publishSegment (store.mjs): link(), never rename, so an existing name is never replaced.
//   4. markExported: ONE transaction, after the link, sets exported_ms and exported_seg on the blobs and entries the
//      segment holds. A crash before it leaves rows the next segment repeats, which replay absorbs (§9.15 "Mark").
// The pass reads no segment and appends no journal record. It decides nothing: lib's planSegment and nextSegmentSeq do.
// Its stops stay apart: 'written', 'nothing-due', 'no-horizon' (no rostered home to read a retention from), 'held'
// (history-off, or the run's budget, before a row was published) and 'failed' (a throw, counted export_write_failed).

/** Rows per page of the selection: a bound on one statement's work, not a rule. */
const EXPORT_PAGE_ROWS = 256;
/** meta: the last segment number this store published. The next is past it AND past every name on disk (§9.15 "Write"). */
const EXPORT_SEQ_META = 'export_seq';
/** meta: when a pass last failed with a CAUGHT error. exportStep's cadence counts it as a pass, so a pass that keeps
 *  failing that way retries hourly, never every tick; doctor's last-pass clock (HEALTH_META.exportPassMs) does not, so
 *  it still reads stale. A killed pass writes nothing here, and the next tick retries it. */
const EXPORT_ATTEMPT_META = 'export_attempt_ms';
/** Names tried past a taken one before the pass fails: a directory whose names keep appearing under the lock is a fault,
 *  never a loop (§9.15 "Write"). */
const EXPORT_SEQ_RETRIES = 8;
/** meta: how many export passes in a row published their segment and then failed to mark it (§9.15 "Mark": the marks
 *  are one transaction on db/, which the export's preflight never measures). Each such pass leaves its rows unmarked,
 *  so the next pass publishes them again. lib decides the count after each outcome and the wait (decideMarkOutcome,
 *  exportMarkFailsOf, exportPassIntervalMs; coordinator ruling RD2): the wait doubles per failure, at most a day, so a
 *  store whose own volume refuses the marks does not publish a copy every hour until the home filesystem's floor
 *  (D-4757 (history-export-mark-failure-backs-off), NEW). This module only writes what lib answers. */
const EXPORT_MARK_FAILS_META = 'export_mark_fails';
/** Candidate rows with a time below the ts cutoff, oldest first within this run, keyset-paged by (ts_ms, entry_id): the
 *  partial index entries_unexported orders them. `ts_ms < cutoff` (the shortest home's horizon) is only a prefilter;
 *  planSegment decides each row by its holding files. It hides no due row held by a file on disk: no file's horizon is
 *  shorter than the shortest home's (an unrostered file is mapped to that home), and a row is written no later than its
 *  file's last write. */
const EXPORT_DUE_ENTRIES_SQL = 'SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE exported_ms IS NULL AND ts_ms IS NOT NULL '
  + 'AND ts_ms < ? AND (ts_ms > ? OR (ts_ms = ? AND entry_id > ?)) ORDER BY ts_ms, entry_id LIMIT ?';
/** Rows with no time: the prefilter cannot see them, so every one is a candidate; like every row, each is due by its
 *  transcript's files (§9.15 "A row is due"). */
const EXPORT_NULL_TS_ENTRIES_SQL = 'SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE exported_ms IS NULL AND ts_ms IS NULL '
  + 'AND entry_id > ? ORDER BY entry_id LIMIT ?';
/** One transcript's rows at or past the prefilter's cutoff, oldest first, keyset-paged by (ts_ms, entry_id) through
 *  entries_ts (transcript_pk, ts_ms). Asked only for a transcript lib's dueTranscriptKeys makes due now: under the
 *  per-copy rule every row of it is due at that instant, however young (B2's D-4735 (history-export-due-per-copy)). Its rows
 *  below the cutoff come through EXPORT_DUE_ENTRIES_SQL, never twice. */
const EXPORT_TRANSCRIPT_ENTRIES_SQL = 'SELECT entry_id, ts_ms, transcript_pk FROM entries WHERE transcript_pk = ? AND exported_ms IS NULL '
  + 'AND ts_ms >= ? AND (ts_ms > ? OR (ts_ms = ? AND entry_id > ?)) ORDER BY ts_ms, entry_id LIMIT ?';
/** Blobs only an unlinked sidecar names, unexported and unpruned: schema v1 has no mark on a sidecar row, so the blob's
 *  mark is the row's (D-4761 (history-export-unlinked-sidecar-with-blob)). */
const EXPORT_UNLINKED_SQL = 'SELECT DISTINCT s.blob_id AS blob_id FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id '
  + 'WHERE s.entry_id IS NULL AND b.exported_ms IS NULL AND b.z IS NOT NULL AND s.blob_id > ? ORDER BY s.blob_id LIMIT ?';

const EXPORT_STMTS = new WeakMap();
/** The export's prepared statements, one set per connection. Each names its columns. The ingest_files and entries reads
 *  take integers as bigints: mtime_ns and struct_rank_ns pass 2^53, and node:sqlite throws a RangeError on such
 *  a value read as a number. */
function exportStmts(db) {
  let s = EXPORT_STMTS.get(db);
  if (s !== undefined) return s;
  const big = (st) => { st.setReadBigInts(true); return st; };
  s = {
    dueEntries: db.prepare(EXPORT_DUE_ENTRIES_SQL),
    nullTsEntries: db.prepare(EXPORT_NULL_TS_ENTRIES_SQL),
    transcriptEntries: db.prepare(EXPORT_TRANSCRIPT_ENTRIES_SQL),
    unlinked: db.prepare(EXPORT_UNLINKED_SQL),
    rowBlobs: db.prepare('SELECT blob_id FROM entries WHERE entry_id = ? UNION SELECT blob_id FROM entry_variants WHERE entry_id = ? '
      + 'UNION SELECT kept_blob_id FROM boundaries WHERE entry_id = ? AND kept_blob_id IS NOT NULL'),
    blobFact: db.prepare('SELECT length(z) AS zlen, z IS NULL AS pruned, exported_ms IS NOT NULL AS exported FROM blobs WHERE blob_id = ?'),
    blobRow: db.prepare('SELECT sha256, codec, raw_len, z FROM blobs WHERE blob_id = ?'),
    blobSha: db.prepare('SELECT sha256 FROM blobs WHERE blob_id = ?'),
    sidecarsOf: db.prepare('SELECT name, blob_id, entry_id, first_seen_ms FROM sidecars WHERE transcript_pk = ? ORDER BY name, blob_id'),
    unlinkedOf: db.prepare('SELECT transcript_pk, name, first_seen_ms FROM sidecars WHERE blob_id = ? AND entry_id IS NULL ORDER BY transcript_pk, name'),
    entry: big(db.prepare(`SELECT uuid, transcript_pk, type, subtype, role, model, parent_uuid, ts_ms, request_id, api_block_index,
        msg_id, source_tool_use_id, tool_name, is_compact_summary, provenance, prov_version, parse_state, struct_rank_ns,
        struct_file_id, blob_id FROM entries WHERE entry_id = ?`)),
    variants: db.prepare('SELECT blob_id, first_file_id, first_seen_ms, cause FROM entry_variants WHERE entry_id = ? ORDER BY blob_id'),
    boundary: db.prepare(`SELECT transcript_pk, ord, trigger, head_uuid, anchor_uuid, tail_uuid, kept_blob_id, pre_tokens, post_tokens,
        duration_ms FROM boundaries WHERE entry_id = ?`),
    transcript: db.prepare('SELECT cc_session_uuid, harness, agent_id, parent_tool_use_id, workflow_run_id, agent_type FROM transcripts WHERE transcript_pk = ?'),
    epochsOf: db.prepare(`SELECT s.ccrc_id, s.generation, s.project, s.first_seen_ms, e.seq, e.cause, e.declared_by, e.started_ms,
        e.cwd, e.cwd_real, e.git_branch, e.confirmed_ms
      FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? ORDER BY s.ccrc_id, s.generation, e.seq`),
    file: big(db.prepare(`SELECT f.dev, f.ino, f.transcript_pk, f.size, f.mtime_ns, f.eof_ms, f.source_key,
        (SELECT min(p.path) FROM file_paths p WHERE p.file_id = f.file_id) AS path FROM ingest_files f WHERE f.file_id = ?`)),
    memberships: db.prepare('SELECT file_id, entry_id, line FROM memberships'),
    markBlob: db.prepare('UPDATE blobs SET exported_ms = ?, exported_seg = ? WHERE blob_id = ? AND exported_ms IS NULL'),
    markEntry: db.prepare('UPDATE entries SET exported_ms = ?, exported_seg = ? WHERE entry_id = ?'),
  };
  EXPORT_STMTS.set(db, s);
  return s;
}

/** A bigint read whose value fits a number (an id, a size, a ms time), as a number; NULL stays null. */
function segInt(v) {
  return v === null || v === undefined ? null : Number(v);
}

/** Each rostered home's retention, the census's rule (§9.15): the last value retentionCensus kept in meta, or the
 *  harness default for a home never measured (D-4210). Never read from settings.json
 *  here: the census reads the files once, and the pass and doctor read the same numbers. */
function exportHomeDays(db, homes) {
  const days = {};
  for (const h of homes) days[h] = lastRetentionDays(db, h) ?? CLAUDE_CODE_DEFAULT_RETENTION_DAYS;
  return days;
}

/** export/<store_id>/ under the fixed root: lib's EXPORT_DIR is the one spelling, and historyPaths gains no key (B3,
 *  merged, added none either: card.mjs spells `${historyPaths(home).root}/${CARD_DIR}` the same way). */
function exportDirFor(P, storeId) {
  return `${P.root}/${EXPORT_DIR}/${storeId}`;
}

/** Both export directories, 0700 whatever the umask, as §9.6's mode check wants every directory: store.mjs's
 *  ensureSegmentDir (Task 4), the one directory maker, which also refuses a store id off its grammar. */
function ensureExportDirs(P, storeId) {
  ensureSegmentDir(`${P.root}/${EXPORT_DIR}`, storeId);
}

/** Phase 1 (§9.15 "What is due"): the candidates this segment takes, in order, decided page by page by lib's
 *  planSegment under what is left of `boundBytes`. Answers the taken candidates, the blob ids whose bytes travel
 *  (`carry`), the pruned blob ids that travel as stubs, the transcripts they name, each transcript's linked sidecars,
 *  the cutoff, and `complete`: false when the bound or the run's budget stopped the selection with due rows left. */
function exportSelect(db, ctx, nowMs, homeDays, boundBytes) {
  const s = exportStmts(db);
  // A candidate's holding files are its TRANSCRIPT's, B1's census clock, not its own copies through memberships: the
  // export and the census read one clock (RD1; D-4248), and exportFileClock is that one clock, shared with the census,
  // down to the home a file outside every rostered home is measured against (the early side). The shortest rostered
  // home's horizon decides here no due verdict, only the ts prefilter's cutoff below; planSegment's per-copy default
  // measures every file against its own home (B2's D-4735 (history-export-due-per-copy)).
  const { minDays, filesOf, transcripts } = exportFileClock(db, homeDays);
  const cutoffMs = nowMs - exportHorizonDays(minDays) * DAY_MS;
  // Rows per page: EXPORT_PAGE_ROWS, or an in-process test's ctx.deps.exportPageRows (D-4247).
  const pageRows = Number.isSafeInteger(ctx.deps?.exportPageRows) && ctx.deps.exportPageRows > 0 ? ctx.deps.exportPageRows : EXPORT_PAGE_ROWS;
  const sel = { taken: [], carry: new Set(), stubs: new Set(), transcripts: new Set(), linked: new Map(), cutoffMs, complete: true };
  const facts = new Map();
  const blobFact = (id) => {
    let f = facts.get(id);
    if (f === undefined) {
      const r = s.blobFact.get(id);
      f = { zBytes: Number(r.zlen ?? 0), pruned: Number(r.pruned) === 1, exported: Number(r.exported) === 1 };
      facts.set(id, f);
    }
    return f;
  };
  // A blob this pass already carries is `exported` to every later page, so it is never counted or carried twice.
  const blobsFor = (ids) => [...ids].sort((a, b) => a - b).map((id) => {
    const f = blobFact(id);
    return { key: String(id), zBytes: f.zBytes, exported: f.exported || sel.carry.has(id), pruned: f.pruned };
  });
  const linkedOf = (pk) => {
    let m = sel.linked.get(pk);
    if (m === undefined) {
      m = new Map();
      for (const r of s.sidecarsOf.all(pk)) {
        if (r.entry_id === null) continue;
        const list = m.get(Number(r.entry_id)) ?? [];
        list.push({ name: r.name, blobId: Number(r.blob_id), firstSeenMs: Number(r.first_seen_ms) });
        m.set(Number(r.entry_id), list);
      }
      sel.linked.set(pk, m);
    }
    return m;
  };
  const entryCand = (r) => {
    const id = Number(r.entry_id);
    const pk = Number(r.transcript_pk);
    const ids = new Set(s.rowBlobs.all(id, id, id).map((b) => Number(b.blob_id)));
    for (const sc of linkedOf(pk).get(id) ?? []) ids.add(sc.blobId);
    return { kind: 'entry', id, pks: [pk], cand: { key: `e${id}`, tsMs: r.ts_ms === null ? null : Number(r.ts_ms), files: filesOf(pk), blobs: blobsFor(ids) } };
  };
  const sidecarCand = (r) => {
    const id = Number(r.blob_id);
    const pks = [...new Set(s.unlinkedOf.all(id).map((x) => Number(x.transcript_pk)))];
    return { kind: 'sidecar', id, pks, cand: { key: `s${id}`, tsMs: null, files: pks.flatMap(filesOf), blobs: blobsFor([id]) } };
  };
  let left = boundBytes;
  /** One page through planSegment. False when the bound or the run's budget ends the selection. Once an earlier page
   *  took a row, this page's first row must fit what is left (takenBefore): only the pass's first row is taken
   *  whatever its size. No reducer is passed: planSegment's default is the census's (B2's per-copy reducer), so the
   *  pass and the census answer one clock (RD1). */
  const decide = (cands) => {
    if (cands.length > 0) {
      const plan = planSegment({ nowMs, homeRetentionDays: homeDays, rows: cands.map((c) => c.cand), boundBytes: left, takenBefore: sel.taken.length > 0 });
      const byKey = new Map(cands.map((c) => [c.cand.key, c]));
      for (const k of plan.take) {
        const c = byKey.get(k);
        sel.taken.push(c);
        for (const pk of c.pks) sel.transcripts.add(pk);
      }
      for (const k of plan.carry) sel.carry.add(Number(k));
      for (const k of plan.stubs) sel.stubs.add(Number(k));
      left -= plan.bytes;
      if (plan.leftDue > 0 || left <= 0) { sel.complete = false; return false; }
    }
    if (!budgetLeft(ctx.budget)) { sel.complete = false; return false; }
    return true;
  };
  for (let after = 0; ;) {
    const page = s.nullTsEntries.all(after, pageRows);
    if (page.length === 0) break;
    after = Number(page[page.length - 1].entry_id);
    if (!decide(page.map(entryCand))) return sel;
  }
  // The rows, at or past the cutoff, of every transcript the default rule makes due now: lib's dueTranscriptKeys, the
  // census's own prefilter over the same file clock (RD1). Under the per-copy rule every row of one transcript falls
  // due at one instant whatever its own time, so the ts prefilter below would pass over the young ones: a transcript
  // with no holding file left on disk, and one whose young rows outlived the files that held them while an older file
  // of it stays on disk (B2's D-4735 (history-export-due-per-copy)). planSegment still decides each row.
  for (const pk of dueTranscriptKeys({ nowMs, homeRetentionDays: homeDays, transcripts })) {
    for (let ts = cutoffMs, after = 0; ;) {
      const page = s.transcriptEntries.all(pk, cutoffMs, ts, ts, after, pageRows);
      if (page.length === 0) break;
      ts = Number(page[page.length - 1].ts_ms);
      after = Number(page[page.length - 1].entry_id);
      if (!decide(page.map(entryCand))) return sel;
    }
  }
  for (let ts = Number.MIN_SAFE_INTEGER, after = 0; ;) {
    const page = s.dueEntries.all(cutoffMs, ts, ts, after, pageRows);
    if (page.length === 0) break;
    ts = Number(page[page.length - 1].ts_ms);
    after = Number(page[page.length - 1].entry_id);
    if (!decide(page.map(entryCand))) return sel;
  }
  for (let after = 0; ;) {
    const page = s.unlinked.all(after, pageRows);
    if (page.length === 0) break;
    after = Number(page[page.length - 1].blob_id);
    if (!decide(page.filter((r) => !sel.carry.has(Number(r.blob_id))).map(sidecarCand))) return sel;
  }
  return sel;
}

/** Phase 2: the taken candidates into the segment, each row after what places it. Before every row it reads the run's
 *  clock and history-off; it stops at either, so what it wrote is whole rows. Answers the entry and blob ids written,
 *  the rows and bytes, and why it stopped early ('budget' | 'off' | null). */
function writeSegmentRows(db, ctx, seg, sel) {
  const s = exportStmts(db);
  const ins = segmentInserts(seg);
  const out = { entries: [], blobs: [], rows: 0, bytes: 0, stopped: null };
  // Every membership of the taken entries in ONE scan: schema v1 has no index led by memberships.entry_id, and one scan
  // a segment costs less than one a row.
  const want = new Set(sel.taken.filter((t) => t.kind === 'entry').map((t) => t.id));
  const held = new Map();
  for (const m of s.memberships.iterate()) {
    const id = Number(m.entry_id);
    if (!want.has(id)) continue;
    const list = held.get(id) ?? [];
    list.push({ fileId: Number(m.file_id), line: Number(m.line) });
    held.set(id, list);
  }
  const keys = new Map();
  const files = new Map();
  const done = { families: new Set(), epochs: new Set(), blobs: new Set() };
  const shaOf = (id) => s.blobSha.get(id).sha256;
  // A transcript by its natural key, after its families and before its epochs: what placed the row, which the transcript
  // alone gave and a rebuild could not re-derive once it is gone (§9.15, BK11).
  const ensureTranscript = (pk) => {
    let k = keys.get(pk);
    if (k !== undefined) return k;
    const t = s.transcript.get(pk);
    k = { cc_session_uuid: t.cc_session_uuid, agent_id: t.agent_id };
    const epochs = s.epochsOf.all(t.cc_session_uuid);
    for (const e of epochs) {
      const fk = `${e.ccrc_id}\0${e.generation}`;
      if (done.families.has(fk)) continue;
      done.families.add(fk);
      ins.family({ ccrc_id: e.ccrc_id, generation: e.generation, project: e.project, first_seen_ms: e.first_seen_ms });
    }
    ins.transcript({ ...k, harness: t.harness, parent_tool_use_id: t.parent_tool_use_id, workflow_run_id: t.workflow_run_id, agent_type: t.agent_type });
    for (const e of epochs) {
      const ek = `${e.ccrc_id}\0${e.generation}\0${e.seq}`;
      if (done.epochs.has(ek)) continue;
      done.epochs.add(ek);
      ins.epoch({
        ccrc_id: e.ccrc_id, generation: e.generation, seq: e.seq, cc_session_uuid: t.cc_session_uuid, cause: e.cause,
        declared_by: e.declared_by, started_ms: e.started_ms, cwd: e.cwd, cwd_real: e.cwd_real, git_branch: e.git_branch,
        confirmed_ms: e.confirmed_ms,
      });
    }
    keys.set(pk, k);
    return k;
  };
  // A file by its identity (path, dev, ino), after its transcript. A file whose paths were all re-pointed (a retired row)
  // has no path left, and travels with its store source_key as its path identity: B1's 'retired:<hex>', set once at the
  // retire and unique per retired generation (its hash holds dev, ino, transcript_pk and the retire time), or a replayed
  // 'exported:<hex>' row exported again. Two generations of one (dev, ino) therefore never share a dead-file key at replay.
  // '' remains only for a row with no path AND an empty source_key. Replay writes no file_paths row for it, so nothing
  // reads the token as a path (D-5393 (history-export-pathless-file-identity)). The structural file, a variant's first file
  // and a membership's file all come through this one result, so the three always agree.
  const ensureFile = (fileId) => {
    let f = files.get(fileId);
    if (f !== undefined) return f;
    const r = s.file.get(fileId);
    if (r === undefined) throw new Error(`ingest_files row ${fileId} is gone and a row still names it`);
    const k = ensureTranscript(segInt(r.transcript_pk));
    f = { path: r.path ?? r.source_key, dev: r.dev, ino: r.ino };
    ins.file({ ...f, ...k, size: segInt(r.size), mtime_ns: r.mtime_ns, eof_ms: segInt(r.eof_ms) });
    files.set(fileId, f);
    return f;
  };
  // A carried blob's bytes as stored, with every unlinked sidecar row naming it; a pruned blob as a stub. A blob already
  // exported is in its own segment, which replay applies first (every segment's blobs before any rows, §9.14).
  const ensureBlob = (id) => {
    if (done.blobs.has(id)) return;
    done.blobs.add(id);
    if (sel.carry.has(id)) {
      const b = s.blobRow.get(id);
      ins.blob({ sha256: b.sha256, codec: b.codec, raw_len: b.raw_len, z: b.z, pruned: false });
      ctx.budget.bytes += b.z.length;
      out.bytes += b.z.length;
      out.blobs.push(id);
      for (const u of s.unlinkedOf.all(id)) {
        const k = ensureTranscript(Number(u.transcript_pk));
        ins.sidecar({ ...k, name: u.name, blob_sha256: b.sha256, uuid: null, first_seen_ms: u.first_seen_ms });
      }
    } else if (sel.stubs.has(id)) {
      const b = s.blobRow.get(id);
      ins.blob({ sha256: b.sha256, codec: b.codec, raw_len: b.raw_len, z: null, pruned: true });
    }
  };
  const writeEntry = (id) => {
    const e = s.entry.get(id);
    const pk = segInt(e.transcript_pk);
    const k = ensureTranscript(pk);
    const struct = ensureFile(segInt(e.struct_file_id));
    const variants = s.variants.all(id);
    const firsts = variants.map((v) => ensureFile(Number(v.first_file_id)));
    const copies = (held.get(id) ?? []).map((m) => ({ ...ensureFile(m.fileId), line: m.line }));
    const bd = s.boundary.get(id);
    const sidecars = sel.linked.get(pk)?.get(id) ?? [];
    const keptId = bd !== undefined && bd.kept_blob_id !== null ? Number(bd.kept_blob_id) : null;
    for (const b of [segInt(e.blob_id), ...variants.map((v) => Number(v.blob_id)), ...(keptId === null ? [] : [keptId]), ...sidecars.map((x) => x.blobId)]) {
      ensureBlob(b);
    }
    ins.entry({
      uuid: e.uuid, ...k, type: e.type, subtype: e.subtype, role: e.role, model: e.model, parent_uuid: e.parent_uuid,
      ts_ms: segInt(e.ts_ms), request_id: e.request_id, api_block_index: segInt(e.api_block_index), msg_id: e.msg_id,
      source_tool_use_id: e.source_tool_use_id, tool_name: e.tool_name, is_compact_summary: segInt(e.is_compact_summary),
      provenance: e.provenance, prov_version: segInt(e.prov_version), parse_state: e.parse_state, struct_rank_ns: e.struct_rank_ns,
      struct_path: struct.path, struct_dev: struct.dev, struct_ino: struct.ino, blob_sha256: shaOf(segInt(e.blob_id)),
    });
    variants.forEach((v, i) => {
      ins.variant({
        uuid: e.uuid, blob_sha256: shaOf(Number(v.blob_id)), first_path: firsts[i].path, first_dev: firsts[i].dev,
        first_ino: firsts[i].ino, first_seen_ms: v.first_seen_ms, cause: v.cause,
      });
    });
    if (bd !== undefined) {
      const bk = ensureTranscript(Number(bd.transcript_pk));
      ins.boundary({
        uuid: e.uuid, ...bk, boundary_ord: bd.ord, trigger: bd.trigger, head_uuid: bd.head_uuid, anchor_uuid: bd.anchor_uuid,
        tail_uuid: bd.tail_uuid, kept_sha256: keptId === null ? null : shaOf(keptId), pre_tokens: bd.pre_tokens,
        post_tokens: bd.post_tokens, duration_ms: bd.duration_ms,
      });
    }
    for (const sc of sidecars) ins.sidecar({ ...k, name: sc.name, blob_sha256: shaOf(sc.blobId), uuid: e.uuid, first_seen_ms: sc.firstSeenMs });
    for (const c of copies) ins.membership({ path: c.path, dev: c.dev, ino: c.ino, uuid: e.uuid, line: c.line });
  };
  for (const t of sel.taken) {
    if (!budgetLeft(ctx.budget)) { out.stopped = 'budget'; break; }
    if (existsSync(ctx.paths.off)) { out.stopped = 'off'; break; }
    if (t.kind === 'entry') {
      writeEntry(t.id);
      out.entries.push(t.id);
    } else {
      ensureBlob(t.id);
    }
    out.rows += 1;
  }
  return out;
}

/** A segment that will not be published: its handle closed (publishSegment may have closed it already) and its temp gone. */
function discardSegment(seg) {
  try { seg.db.close(); } catch { /* already closed */ }
  removeEntry(seg.temp);   // B1's removal by type (review 316 F22); store.mjs owns the temp's name
}

/** What a pass that ran to its end records, inside the caller's transaction: the last-pass clock doctor's export-due
 *  rule and the hourly cadence read. `complete` says every due row the pass found fit in its segment. */
function noteExportPassDone(db, nowMs, complete) {
  setMeta(db, HEALTH_META.exportPassMs, String(nowMs));
  // A complete pass left no due row behind: what a missing segment's cleared marks owed has exported again (Task 8).
  if (complete && (getMeta(db, HEALTH_META.exportSegmentMissing) ?? '0') !== '0') setMeta(db, HEALTH_META.exportSegmentMissing, '0');
}

/** Phase 4 (§9.15 "Mark"): ONE transaction, after the link: the blobs whose bytes the segment holds and the entries it
 *  holds take its name, and the counter takes its number. A stub is never marked: a pruned blob is never exported. */
function markExported(db, m) {
  const s = exportStmts(db);
  withTx(db, 'NORMAL', () => {
    for (const id of m.blobs) s.markBlob.run(m.nowMs, m.name, id);
    for (const id of m.entries) s.markEntry.run(m.nowMs, m.name, id);
    setMeta(db, EXPORT_SEQ_META, String(m.seq));
    // marked: lib decideMarkOutcome ends the backoff, writing '0' only over another value (RD2)
    const ended = decideMarkOutcome({ outcome: 'marked', recorded: getMeta(db, EXPORT_MARK_FAILS_META) });
    if (ended.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, ended.write);
    noteExportPassDone(db, m.nowMs, m.complete);
  });
}

/** One export pass (§9.15 "The pass"). It never throws but for busy (O22): anything else that fails, from making the
 *  directories to the mark, removes its temp, marks nothing, is counted export_write_failed with one stderr line, and
 *  answers 'failed', so the tick goes on. */
export async function exportPass(db, ctx) {
  const stop = (state) => ({ state, segment: null, rows: 0, blobs: 0, bytes: 0, complete: false });
  if (ctx.ids === null || ctx.rosterUnreadable === true || ctx.homes.length === 0) return stop('no-horizon');
  const nowMs = ctx.now();
  let seg = null;
  let published = null;   // { name, seq } once the segment is linked: a failure after that is the mark's
  try {
    const { storeId, writer } = ctx.ids;
    const dir = exportDirFor(ctx.paths, storeId);
    ensureExportDirs(ctx.paths, storeId);
    // A stale temp (a killed pass's) is removed by Task 6's exportStep before its preflight, so a pause never keeps it.
    const room = Math.min(EXPORT_SEGMENT_MAX_BYTES, ctx.budget.maxBytes - ctx.budget.bytes);
    if (room <= 0 || !budgetLeft(ctx.budget)) return stop('held');
    const sel = exportSelect(db, ctx, nowMs, exportHomeDays(db, ctx.homes), room);
    if (sel.taken.length === 0) {
      if (!sel.complete) return stop('held');
      withTx(db, 'NORMAL', () => { noteExportPassDone(db, nowMs, true); });
      return { ...stop('nothing-due'), complete: true };
    }
    const s = exportStmts(db);
    const recorded = getMeta(db, EXPORT_SEQ_META);
    let seq = nextSegmentSeq({
      onDisk: listSegments(dir).map((x) => x.seq),
      recorded: recorded !== null && /^[1-9][0-9]{0,15}$/.test(recorded) ? Number(recorded) : null,
    });
    let name = segmentName({ seq, writer });
    const harnesses = [...new Set([...sel.transcripts].map((pk) => s.transcript.get(pk).harness))].sort();
    seg = createSegment(dir, name, { storeId, writer, seq, harnesses, cutoffMs: sel.cutoffMs, format: EXPORT_SEGMENT_FORMAT });
    const w = writeSegmentRows(db, ctx, seg, sel);
    if (w.stopped === 'off' || w.rows === 0) {
      discardSegment(seg);
      seg = null;
      return stop('held');
    }
    // §9.15 "Write": link() fails on a name already on disk, and the pass takes the next number past every name there,
    // of any writer, and past the one it tried. A name is never replaced (D-4226).
    let linked = publishSegment(seg, dir, name);
    for (let tries = 1; linked === 'exists'; tries += 1) {
      if (tries > EXPORT_SEQ_RETRIES) throw new Error(`no free segment name in ${EXPORT_SEQ_RETRIES} tries past ${name}`);
      countOutside(db, 'export_seq_taken');
      seq = nextSegmentSeq({ onDisk: listSegments(dir).map((x) => x.seq), recorded: seq });
      name = segmentName({ seq, writer });
      setSegmentSeq(seg.temp, seq);
      linked = publishSegment(seg, dir, name);
    }
    published = { name, seq };   // linked: from here a failure is the mark's, and these rows go into a later segment
    seg = null;
    const complete = sel.complete && w.stopped === null;
    markExported(db, { name, seq, nowMs, blobs: w.blobs, entries: w.entries, complete });
    return { state: 'written', segment: name, rows: w.rows, blobs: w.blobs.length, bytes: w.bytes, complete };
  } catch (e) {
    if (seg !== null) discardSegment(seg);
    if (isBusy(e)) {
      // RD3: SQLITE_BUSY after the link (another connection held the write lock through the marks). The segment is
      // published and its rows are unmarked. Its number and the attempt clock are recorded before the error ends the
      // tick (O22), so the next tick's cadence waits rather than publish the same rows again a minute later. lib says a
      // busy is the lock's, not the volume's: the backoff stands as it is. If this record meets busy too, the first
      // error still ends the tick, the next pass repeats these rows into a later segment, and replay absorbs the copy
      // (insert-or-ignore by sha256): a residual the PR body names. A busy before the link records nothing.
      if (published !== null) {
        try {
          withTx(db, 'NORMAL', () => {
            setMeta(db, EXPORT_SEQ_META, String(published.seq));
            setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));
            const held = decideMarkOutcome({ outcome: 'mark-busy', recorded: getMeta(db, EXPORT_MARK_FAILS_META) });
            if (held.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, held.write);
          });
        } catch { /* busy again: the residual above */ }
      }
      throw e;
    }
    const why = e && e.message ? e.message : String(e);
    process.stderr.write(published === null
      ? `history-sweep: an export segment write failed and nothing was marked: ${why}\n`
      : `history-sweep: export segment ${published.name} was published and could not be marked; its rows go into a later segment: ${why}\n`);
    countOutside(db, 'export_write_failed');
    try {
      withTx(db, 'NORMAL', () => {
        setMeta(db, EXPORT_ATTEMPT_META, String(nowMs));
        // lib decides whether this pass backs off (RD2): one step more after a published, unmarked segment; as it stands
        // after a failure before the link
        const after = decideMarkOutcome({ outcome: published === null ? 'write-failed' : 'mark-failed', recorded: getMeta(db, EXPORT_MARK_FAILS_META) });
        if (after.write !== null) setMeta(db, EXPORT_MARK_FAILS_META, after.write);
      });
    } catch { /* busy or full: the next tick retries sooner, nothing is lost */ }
    return stop('failed');
  }
}

// ── W1-B4 Task 6: the export in the tick (spec §9.2 step 6, §9.15 "Preflight") ─────────────────────────────────────

/** §9.2 step 6, last (W1-B4): the export pass, at most once an hour by its own clock, anchored on the store's first tick
 *  (lib decideExportPass; D-4755 (history-export-cadence-from-first-tick)), behind a preflight on the HOME filesystem (§9.15
 *  "Preflight"): statfs on ~/.ccrc/history/export under STATFS_DEADLINE_MS, then lib planExportRoom, which is planCopy
 *  with that filesystem's own floor and the segment bound as the size (RC9; B2's D-4695 (history-backup-preflight-and-rename)).
 *  Never db/, which may be a link onto a volume whose floor the tick already guards (§9.3; D-4179).
 *  A refusal, or a probe that does not settle, skips the pass: counted export_paused_low_disk and kept in meta for doctor
 *  (HEALTH_META.exportPaused, planExportRoom's word) until a preflight admits. Capture is unaffected, and the next tick
 *  retries: a pause is not a pass. A stale temp is removed before the probe, so a pause never keeps one. A pass that
 *  fails with a caught error counts for the cadence (Task 5's attempt clock), so it retries hourly. First of all, and
 *  outside the cadence, the step checks the export marks against the segments on this box once per new bind fact
 *  (checkSegmentMarks; §9.15 "After a bind"). Null when the cadence waits. */
export async function exportStep(db, ctx) {
  // §9.15 "After a bind": first, and outside the cadence, on the first step after an adopt, a restore or a rebuild. lib
  // decideMarkCheck decides it from WHICH bind facts the last check covered, never their clocks (RD2). A check that
  // cannot list the directory is counted and tried again next step, never thrown out of the tick.
  const markCheck = decideMarkCheck({ metaKeys: bindFactKeys(db), checkedRecord: getMeta(db, EXPORT_MARKS_CHECKED_BINDS_META) });
  if (markCheck.check) {
    try { checkSegmentMarks(db, ctx, markCheck.record); } catch (e) {
      if (isBusy(e)) throw e;
      process.stderr.write(`history-sweep: the export marks could not be checked against ${exportDirFor(ctx.paths, ctx.ids.storeId)}: ${e && e.message ? e.message : String(e)}\n`);
      countOutside(db, 'export_marks_check_failed');
    }
  }
  const nowMs = ctx.now();
  const msOf = (k) => {
    const v = getMeta(db, k);
    return v !== null && /^[0-9]{1,16}$/.test(v) ? Number(v) : null;
  };
  // The meta text is measured here; which of the two clocks governs the wait is lib's decision (RD2).
  const first = db.prepare('SELECT ts_ms FROM ticks ORDER BY tick_id LIMIT 1').get();
  const verdict = decideExportPass({
    nowMs,
    lastPassMs: msOf(HEALTH_META.exportPassMs),
    lastAttemptMs: msOf(EXPORT_ATTEMPT_META),
    firstTickMs: first === undefined ? null : Number(first.ts_ms),
    intervalMs: exportPassIntervalMs(exportMarkFailsOf(getMeta(db, EXPORT_MARK_FAILS_META))),   // Task 7: lib's wait after failed marks
  });
  if (verdict === 'wait') return null;
  // A directory that cannot be made never throws out of the tick (a planted entry would otherwise fail every tick): the
  // failure is swallowed here and the probe decides. When export/ itself is missing (EACCES, EROFS, ENOSPC on the home
  // filesystem), the probe below fails on it (ENOENT) and planExportRoom answers low-disk: a pause. When only
  // export/<store_id> cannot be made, or export/ is not a directory, statfs on export/ still answers and the probe admits,
  // and exportPass's own ensureExportDirs then fails and is counted export_write_failed ('failed').
  try { ensureExportDirs(ctx.paths, ctx.ids.storeId); } catch { /* the probe decides */ }
  // Every temp is stale here: only a pass under the shim's lock writes one (the lifecycle row's "the writer removes a
  // stale .tmp itself"). It goes BEFORE the probe, so a pause never keeps a killed pass's temp on the filesystem whose
  // room the probe measures. A removal that fails is counted and the step goes on.
  try { removeStaleSegmentTemps(exportDirFor(ctx.paths, ctx.ids.storeId)); } catch { countOutside(db, 'export_write_failed'); }
  const probe = await statfsWithDeadline(`${ctx.paths.root}/${EXPORT_DIR}`, STATFS_DEADLINE_MS, ctx.deps.statfs);
  const room = planExportRoom(probe);
  if (!room.admit) {
    withTx(db, 'NORMAL', () => {
      bump(db, 'export_paused_low_disk');
      setMeta(db, HEALTH_META.exportPaused, room.word);
    });
    return { state: 'paused', segment: null, rows: 0, blobs: 0, bytes: 0, complete: false };
  }
  // An admitting preflight ends a pause, whatever the pass then answers (held, failed or no-horizon included).
  if ((getMeta(db, HEALTH_META.exportPaused) ?? '') !== '') withTx(db, 'NORMAL', () => { setMeta(db, HEALTH_META.exportPaused, ''); });
  return exportPass(db, ctx);
}

// ── W1-B4 Task 8: the marks after a bind (spec §9.15 "After a bind"; D-4226) ───────────────
// lib decides (coordinator ruling RD2): decideMarkCheck whether a step checks and what the check records, from the bind
// facts' KEYS and never their clocks; missingSegmentNames which marked segments this box lacks. This block measures the
// meta keys, the last check's record, the marked names and the directory listing, calls those, and acts.

/** meta: when the export last checked its marks against the segments on this box (for display; never a decision). */
const EXPORT_MARKS_CHECKED_META = 'export_marks_checked_ms';
/** meta: the bind facts the last check covered, as lib decideMarkCheck's `record` gives them (a JSON list of
 *  `bound:<ms>` keys). */
const EXPORT_MARKS_CHECKED_BINDS_META = 'export_marks_checked_binds';

/** The meta keys that may be bind facts: every adopt, restore and rebuild writes `bound:<ms>` inside its binding
 *  transaction (B2's D-4724 (history-binding-facts-before-link)). A measurement only: lib decideMarkCheck says which are facts.
 *  [] when none: a store only ever created on this box has nothing to check. */
function bindFactKeys(db) {
  return db.prepare("SELECT k FROM meta WHERE k LIKE 'bound:%'").all().map((r) => String(r.k));
}

/** §9.15 "After a bind": every blob and entry mark whose segment is not in export/<store_id>/ on THIS box is cleared,
 *  so its rows export again. A directory left on the box the store came from is the usual cause; carrying it before
 *  the verb avoids the re-export (§8.4). Which names are missing is lib missingSegmentNames' answer over the marked
 *  names and the listing measured here. One NORMAL transaction; when anything was cleared, export_segment_missing +1
 *  and HEALTH_META.exportSegmentMissing holds how many marks, which doctor WARNs on until a complete pass resets it.
 *  Either way it records its clock and `record`, the bind facts lib decideMarkCheck says it covers. Two DISTINCT scans
 *  of exported_seg per bind, blobs then entries; neither column has an index and none is added. A directory that is
 *  absent (ENOENT) lists as none, so every mark naming a segment is missing; one that cannot be listed for any other
 *  reason (ENOTDIR, EACCES) is NOT absent: listSegments throws, before anything is cleared or recorded, and exportStep
 *  counts it and tries again next step. */
export function checkSegmentMarks(db, ctx, record) {
  const dir = exportDirFor(ctx.paths, ctx.ids.storeId);
  const present = listSegments(dir).map((x) => x.name);   // [] only for a proven ENOENT; ENOTDIR, EACCES and the rest throw
  const named = new Set();
  for (const r of db.prepare('SELECT DISTINCT exported_seg AS seg FROM blobs WHERE exported_seg IS NOT NULL').all()) named.add(String(r.seg));
  for (const r of db.prepare('SELECT DISTINCT exported_seg AS seg FROM entries WHERE exported_seg IS NOT NULL').all()) named.add(String(r.seg));
  const segments = missingSegmentNames({ named, present });
  let cleared = 0;
  withTx(db, 'NORMAL', () => {
    const blobs = db.prepare('UPDATE blobs SET exported_ms = NULL, exported_seg = NULL WHERE exported_seg = ?');
    const entries = db.prepare('UPDATE entries SET exported_ms = NULL, exported_seg = NULL WHERE exported_seg = ?');
    for (const seg of segments) cleared += Number(blobs.run(seg).changes) + Number(entries.run(seg).changes);
    if (cleared > 0) {
      bump(db, 'export_segment_missing');
      setMeta(db, HEALTH_META.exportSegmentMissing, String(cleared));
    }
    setMeta(db, EXPORT_MARKS_CHECKED_META, String(ctx.now()));
    setMeta(db, EXPORT_MARKS_CHECKED_BINDS_META, record);
  });
  return { cleared, segments };
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
