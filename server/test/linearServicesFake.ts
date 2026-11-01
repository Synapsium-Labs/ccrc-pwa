/**
 * The Linear services as a test builds them (#1444, plan "Absent services", D-7684). `index.ts` builds each service
 * once for the process; a test that reaches one builds it here, over an in-memory coord.db and an injected clock, so
 * no test spells its own copy of a service and none reaches the network.
 *
 * Today it holds the write journal (task LK7). The rate service and the refresher (LK2, LK3)
 * join it as builders of their own; the one-instance census counts constructions in `server/src` only, so this file
 * never counts as a second instance.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/coord/schema.js';
import { LinearJournal } from '../src/linear/journal.js';

/** A coord.db in memory at this build's version: every migration, in order, as `openCoordDb` would run them. */
export function memCoordDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  return db;
}

export interface LinearServicesFake {
  /** The coord.db the services write: the one passed in, or a fresh in-memory one. */
  readonly db: DatabaseSync;
  /** The write journal over `db`, on the given clock. */
  readonly journal: LinearJournal;
}

export function linearServicesFake(opts: { clock?: () => number; db?: DatabaseSync } = {}): LinearServicesFake {
  const db = opts.db ?? memCoordDb();
  return { db, journal: new LinearJournal(db, opts.clock ?? Date.now) };
}
