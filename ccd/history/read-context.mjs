// ccd/history/read-context.mjs — the store-measuring helpers the history CLI and the Overlord's read share (plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 1; the coordinator's ruling F1, "move, not
// guard", and R2: the set is closed under what the moved code calls).
//
// They left cli.mjs, which a worker thread cannot load: cli.mjs calls `process.umask` at module load, and Node refuses
// that in a worker (ERR_WORKER_UNSUPPORTED_OPERATION). This module runs nothing at load: no umask, no environment read,
// no `process.exit`. Its only top-level statement besides imports and declarations is NO_PAIRS.
//
// L3: it measures the store (store.mjs) and hands what it measured to lib.mjs's decisions. It never imports cli.mjs or
// sweep.mjs, so nothing here reaches the secret loader.
import { lstatSync, promises as fsp } from 'node:fs';
import {
  UUID_RE, CLI_STAT_DEADLINE_MS, CONTROL_FILE_MAX, historyPaths, makePairIndex, redactFinalLines,
  decideStatusReadFailure, decideCliStore, decideStatusRead,
} from './lib.mjs';
import { StoreError, measureStoreFacts, readBounded, openReader, userVersion } from './store.mjs';

/** The inputs §8.3's table does not reach on its first rows (Darwin, a server role, an unsettled stat):
 *  passed as unmeasured, so the table, not this file, decides every answer. */
export function unmeasuredFacts(role) {
  const unread = { state: 'unreadable' };
  return {
    role, dbDir: 'unmeasured', storeId: unread, pending: unread, writer: unread, db: 'unmeasured',
    dbStoreId: unread, wal: false, shm: false, journalStoreDirs: [], backupsDb: [],
  };
}

/** Bytes of a file, trimmed, or null when it cannot be read: one bounded nonblocking open that refuses a link
 *  (store.mjs `readBounded`, D-4347 (history-planted-entries-never-wedge)), so a FIFO is never waited on. */
export function readTrimmed(p) {
  const r = readBounded(p, CONTROL_FILE_MAX, false);
  return r.state === 'value' ? r.value.trim() : null;
}

/** A name's presence, never folded (IV5): ENOENT is absent; any other failure is unmeasured. */
export function presence(p) {
  try {
    lstatSync(p);
    return 'present';
  } catch (e) {
    return e !== null && typeof e === 'object' && e.code === 'ENOENT' ? 'absent' : 'unmeasured';
  }
}

/** A promise raced against a deadline: {settled:false} when it did not answer in time. */
export function settleWithin(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ settled: false }), ms);
    promise.then(
      (value) => { clearTimeout(t); resolve({ settled: true, value }); },
      (error) => { clearTimeout(t); resolve({ settled: true, error }); },
    );
  });
}

/** What §8.3's no-store table reads, measured in the table's own order (W1-B2 Task 10: shared by status and the
 *  read verbs, so the two never measure a store differently):
 *   - Darwin and the recorded role first: they answer before anything else is touched;
 *   - then the 2 s reachability stat of db/history.db; one that never settles reads unsettled, and nothing
 *     behind it is measured;
 *   - then every presence input (measureStoreFacts), with the shim measured beside them.
 *  `role` is the caller's (R1): cli.mjs passes what sweep.mjs's readRole reads from ccrc.env, and the Overlord's read passes
 *  the empty role, which is what readRole answers on a box whose ccrc.env records none. So this module never opens
 *  ccrc.env, a SECRET_SOURCES entry. */
export async function measureReach(home, role) {
  const P = historyPaths(home);
  const darwin = process.platform === 'darwin';
  if (darwin || role === 'server') return { darwin, role, facts: unmeasuredFacts(role), statSettled: true, shim: 'unmeasured' };
  const stat = await settleWithin(fsp.stat(P.dbFile), CLI_STAT_DEADLINE_MS);
  if (!stat.settled) return { darwin, role, facts: unmeasuredFacts(role), statSettled: false, shim: presence(P.shim) };
  return { darwin, role, facts: measureStoreFacts(home, role), statSettled: true, shim: presence(P.shim) };
}

/** decideCliStore's input from a reach measurement. */
export function cliFactsOf(reach) {
  return { ...reach.facts, darwin: reach.darwin, statSettled: reach.statSettled, shim: reach.shim };
}

/** No pairs: a refusal prints no recalled text, but every output still takes the final belt's context and shape
 *  layers (§8.3). */
export const NO_PAIRS = makePairIndex([]);

/** One stderr line carrying a thrown error's text, through redactFinalLines (D-4613 round 5: never framed, so no tag split;
 *  D-5021: the field pass first, as the only redaction raw text gets) like every other output (§8.3, §12: the final
 *  stdout, stderr and --json each take one more pass). A SQLite message can quote a value, and the three sites that
 *  wrote `e.message` raw did not redact it (HA2 H-32). Every error text on stderr goes through here. `idx` is the pair
 *  index of the read the text belongs to, where there is one (D-5023): NO_PAIRS only where no index was built. */
export function errLine(text, idx = NO_PAIRS) {
  process.stderr.write(redactFinalLines(`${text}\n`, idx));
}

/** A read verb's answer when there is no ReadContext. `reason` rides only where §8.3 gives the exit one. `id`
 *  and `gen` are what the counter line names; both are null before the identity resolved. */
export function refusal(exit, reason, storeId, id, gen) {
  return { exit, ...(reason === undefined ? {} : { reason }), storeId, id, gen };
}

/** The store_id an exit-5 or exit-6 answer names (§8.3: the store-unbound remedy needs no sqlite3). */
export function refusalStoreId(reach, P) {
  if (reach.facts.storeId.state === 'value') return reach.facts.storeId.value;
  if (reach.facts.dbStoreId.state === 'value') return reach.facts.dbStoreId.value;
  if (!reach.statSettled) {
    const id = readTrimmed(P.storeId);
    return id !== null && UUID_RE.test(id) ? id : null;
  }
  return null;
}

/** A failed read of an admitted store as a read verb's refusal (§8.3: ONE answer, exit 5, for a DB or schema error),
 *  measured as B1's readStoreAnswered measures it and decided by lib's decideStatusReadFailure: a StoreError's word,
 *  SQLite's own error (ERR_SQLITE_ERROR: a missing table or column, a corrupt page, an I/O error) as
 *  store-read-failed, the error's message on stderr. Null for any other throw, a defect the caller rethrows, so it
 *  stays exit 1 with no answer (review 316 F11's rule; B1's slug history-import-refusal-words names the word). */
export function readFailure(e, storeId, id, gen, idx = NO_PAIRS) {
  const f = decideStatusReadFailure({
    storeWord: e instanceof StoreError ? e.word : null,
    sqliteError: e !== null && typeof e === 'object' && e.code === 'ERR_SQLITE_ERROR',
  });
  if (f === null) return null;
  errLine(`ccrc history: ${f.reason}: ${e.message}`, idx);
  return refusal(f.exit, f.reason, storeId, id, gen);
}

/** Every (len, sha256) pair the sweep recorded in redact_hashes, as lib's makePairIndex takes them (§8.3 layer 1). It reads
 *  the store alone, never a secret file: cli.mjs's pairIndexOf adds the pairs of the files it loads now, and the Overlord's
 *  read builds its belt from these alone (the store-only belt, ruled F4). */
export function recordedPairsOf(db) {
  return db.prepare('SELECT len, sha256 FROM redact_hashes').all()
    .map((r) => ({ len: Number(r.len), sha256: Buffer.from(r.sha256).toString('hex') }));
}

/** The admitted store, opened: the one sequence every read of the store takes (review 2126 F7: the CLI's two read paths
 *  and the Overlord's read call this, so a gate added here is every reader's). It measures the reach with the caller's
 *  role, asks lib's decideCliStore, opens the read-only handle (openReader), then reads the meta store_id, the journal
 *  mode and user_version for lib's decideStatusRead.
 *  - `storeIdOf(reach)` is the caller's store-id fallback, for a refusal and for a store with no meta row: the CLI passes
 *    refusalStoreId, the Overlord's read `() => null`.
 *  - `busyTimeoutMs`, when not null, is set on the handle before its first read (the Overlord's read, below its deadline).
 *  Answers `{ok: true, db, storeId, metaStoreId, version}`, the handle the caller's to close, or `{ok: false, exit,
 *  reason?, storeId}` (refusal's shape: `reason` only where §8.3 gives the exit one) with the handle closed. A throw
 *  readFailure does not map is rethrown, the handle closed: the caller's defect arm decides it. */
export async function openAdmitted(home, role, storeIdOf, busyTimeoutMs = null) {
  const P = historyPaths(home);
  const reach = await measureReach(home, role);
  const d = decideCliStore(cliFactsOf(reach));
  if (!d.read) return { ok: false, ...refusal(d.exit, d.reason, storeIdOf(reach), null, null) };
  let db;
  try {
    db = openReader(P.dbFile);
  } catch (e) {
    const f = readFailure(e, storeIdOf(reach), null, null);
    if (f === null) throw e;
    return { ok: false, ...f };
  }
  let storeId = storeIdOf(reach);
  try {
    if (busyTimeoutMs !== null) db.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs)}`);
    const meta = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (meta !== undefined) storeId = meta.v;
    // lib's decideStatusRead decides the journal mode, as it does for status: this file only measures.
    const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    const version = userVersion(db);
    const rd = decideStatusRead({ userVersion: version, journalMode: mode, recordedMigration: undefined });
    if (rd.reason !== undefined) {
      db.close();
      return { ok: false, ...refusal(rd.exit, rd.reason, storeId, null, null) };
    }
    return { ok: true, db, storeId, metaStoreId: meta === undefined ? null : meta.v, version };
  } catch (e) {
    // A read of this admitted store failed (the meta read, a PRAGMA): ONE exit-5 answer, as status gives (review 316 F11).
    db.close();
    const f = readFailure(e, storeId, null, null);
    if (f === null) throw e;
    return { ok: false, ...f };
  }
}
