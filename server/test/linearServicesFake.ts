/**
 * The Linear services as a test builds them (#1444, plan "Absent services", D-7684). `index.ts` builds each service
 * once for the process; a test that reaches one builds it here, over an in-memory coord.db and an injected clock, so
 * no test spells its own copy of a service and none reaches the network.
 *
 * It holds the write journal and the policy point's default (task LK7), the one rate service (task LK2): a REAL
 * `rate.ts` service, so a test that reaches Linear spends the same budgets the box does, and the one background
 * refresher (task LK3) over that same service. The one-instance census counts constructions in `server/src` only, so
 * this file never counts as a second instance.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { MIGRATIONS } from '../src/coord/schema.js';
import { LinearJournal } from '../src/linear/journal.js';
import { allowAll } from '../src/linear/policyPoint.js';
import type { LinearWritePolicy } from '../src/linear/policy.js';
import { LinearRateService } from '../src/linear/rate.js';
import { LinearRefresher } from '../src/linear/refresher.js';
import type { FetchLike } from '../src/linear/client.js';
import { mkTmp } from './tmpHelpers.js';
import type { Deps } from '../src/deps.js';

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
  /** The one background refresher, over `rate` and the given clock, reading the slots of `ccrcDir` (a fresh empty
   *  one when none is given, so a test that never refreshes holds no box's directory) through `fetch`. */
  readonly refresher: LinearRefresher;
}

export interface LinearServicesFakeOpts {
  clock?: () => number;
  db?: DatabaseSync;
  /** The ccrc dir the refresher reads; a fresh empty one when absent. */
  ccrcDir?: string;
  /** The Linear stand-in the refresher calls; nothing reaches the network either way, since a test that refreshes passes one. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function linearServicesFake(opts: LinearServicesFakeOpts = {}): LinearServicesFake {
  const db = opts.db ?? memCoordDb();
  const clock = opts.clock ?? Date.now;
  const rate = new LinearRateService(clock);
  const refresher = new LinearRefresher({
    ccrcDir: opts.ccrcDir ?? path.join(mkTmp('ccrc-linear-fake-'), '.ccrc'), rate, now: clock,
    fetch: opts.fetch ?? (async () => { throw new Error('linearServicesFake: no Linear stand-in was given'); }),
    timeoutMs: opts.timeoutMs,
  });
  return { db, journal: new LinearJournal(db, clock), policy: allowAll, rate, refresher };
}

/** The Linear members of `Deps` that the title lookups and the legacy Check again reach, from one fake: what a
 *  `buildServer` test spreads into its deps when it reaches Linear, so a service those paths gain later reaches every
 *  such test from here, with no test of its own changed. */
export function linearDeps(fx: LinearServicesFake): Pick<Deps, 'linearRate' | 'linearRefresher'> {
  return { linearRate: fx.rate, linearRefresher: fx.refresher };
}
