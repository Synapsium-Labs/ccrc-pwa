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
  UUID_RE, CLI_STAT_DEADLINE_MS, CONTROL_FILE_MAX, historyPaths, readBoxEnvValue, makePairIndex, redactFinalLines,
  decideStatusReadFailure,
} from './lib.mjs';
import { StoreError, measureStoreFacts, readBounded } from './store.mjs';

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

/** CCRC_ROLE exactly as doctor's _check_skills reads it (ccd/ccrc-doctor-checks:3016): a regular, readable
 *  file, one key, readBoxEnvValue's rules (O53); anything else is '' (not server). */
export function readRole(P) {
  const f = readBounded(P.ccrcEnv, CONTROL_FILE_MAX, true);
  if (f.state !== 'value') return '';
  const r = readBoxEnvValue(f.value, 'CCRC_ROLE');
  return r.found ? r.value : '';
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
