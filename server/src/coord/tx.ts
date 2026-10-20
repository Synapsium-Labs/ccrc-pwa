// D-5896 (ARCH-05, #551): the transaction primitive, apart from the database adapter. It needs only the handle's
// `exec`, so it takes `node:sqlite` as a TYPE, and tsc elides that import. A policy file that queues its mail
// through `rundefsTx.ts` therefore loads no `node:sqlite` itself; the handle reaches it from the store it is handed.
// `db.ts` re-exports `tx`, so its callers there are unchanged. `coord-policy-rings.test.ts` walks the runtime graph.
import type { DatabaseSync } from 'node:sqlite';

/**
 * Every write in a transaction (spec:60). `BEGIN IMMEDIATE`, not the default
 * DEFERRED: under WAL a deferred transaction takes its write lock at the first
 * write, so a busy database fails in the MIDDLE of a multi-statement unit
 * instead of at its start.
 *
 * SYNCHRONOUS by construction — `DatabaseSync` has no async surface — and that
 * is a property worth naming rather than apologising for: a whole transaction
 * runs without yielding the event loop, so no route, sweep or socket can
 * interleave inside one. `fn` must therefore never await, and nothing in this
 * directory does.
 */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    // A rollback that itself throws must not replace the real error: the caller
    // needs to know what failed, not that the recovery also did.
    try { db.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
    throw err;
  }
}
