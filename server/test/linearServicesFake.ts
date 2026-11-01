/**
 * The Linear services as a test builds them (#1444, plan "Absent services", D-7684). `index.ts` builds each service
 * once for the process; a test that reaches one builds it here, over an in-memory coord.db and an injected clock, so
 * no test spells its own copy of a service and none reaches the network.
 *
 * Today it holds the write journal and the policy point's default (task LK7), and the one rate service (task LK2): a
 * REAL `rate.ts` service, so a test that reaches Linear spends the same budgets the box does. The refresher (LK3) joins
 * it as a builder of its own; the one-instance census counts constructions in `server/src` only, so this file never
 * counts as a second instance.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/coord/schema.js';
import { LinearJournal } from '../src/linear/journal.js';
import { allowAll } from '../src/linear/policyPoint.js';
import type { LinearWritePolicy } from '../src/linear/policy.js';
import { LinearRateService } from '../src/linear/rate.js';

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
  /** The default policy, `allowAll`, as `index.ts` wires it. */
  readonly policy: LinearWritePolicy;
  /** The one rate service, on the given clock (the wall clock when none is given). */
  readonly rate: LinearRateService;
}

export function linearServicesFake(opts: { clock?: () => number; db?: DatabaseSync } = {}): LinearServicesFake {
  const db = opts.db ?? memCoordDb();
  const clock = opts.clock ?? Date.now;
  return { db, journal: new LinearJournal(db, clock), policy: allowAll, rate: new LinearRateService(clock) };
}
