import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, MIGRATIONS } from './schema.js';

export { COORD_SCHEMA_VERSION } from './schema.js';

/** Thrown when the database on disk cannot be brought to this build's schema.
 *  Deliberately NOT caught anywhere: `index.ts` lets it kill the process, and
 *  `deploy.sh`'s `verify-service.sh ccrc.service` turns that into a failed
 *  deploy with the journal tail attached. */
export class CoordDbUnmigratable extends Error {}

/**
 * The "how much of the file changed" clause of `CoordDbUnmigratable`'s
 * message, isolated as a pure function so it is testable on its own: with
 * `MIGRATIONS.length === 1` today, `openCoordDb`'s loop can only ever fail on
 * its FIRST iteration end-to-end, so a test that only drives `openCoordDb`
 * itself can never exercise the "earlier migrations in this boot already
 * committed" branch below — and a mutant that deletes that branch, or the
 * `tx()` around each migration it describes, would pass every such test.
 *
 * `current` is the schema the file was at when `openCoordDb` started this
 * boot; `v` is the schema the failing migration was attempting to leave
 * (i.e. migration `v+1` is the one that threw). `v > current` means
 * migrations `current+1..v` each committed, in their own transaction, before
 * this one failed — the file is NOT at `current` any more.
 */
export function describeMigrationProgress(current: number, v: number): string {
  const migratedThisBoot = v - current;
  if (migratedThisBoot <= 0) {
    return `No table data changed: migration ${v + 1} was the first attempted this boot, and its own ` +
      'transaction rolled back in full.';
  }
  const range = migratedThisBoot === 1 ? `${v}` : `${current + 1}-${v}`;
  return `Migration${migratedThisBoot === 1 ? '' : 's'} ${range} already committed earlier in this ` +
    `boot — the file is now at schema ${v}, not ${current} — before migration ${v + 1} failed and ` +
    'rolled back on its own.';
}

/** `~/.ccrc/coord.db` on the SERVER box — the same directory `push-subs.json`
 *  (`index.ts:23`), `notify-log.json` (`index.ts:30`) and `state-cache.json`
 *  (`fleetstate.ts:32`) already live in, and the same stance: this is local-box
 *  housekeeping, never proxied through FleetIO. The fleet host has no copy and
 *  cannot read this file; every cross-check against a `.hold`/`.prhistory`/
 *  registry fact is a FleetIO read in the other direction. */
export function defaultCoordDbPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'coord.db');
}

/**
 * Open the coordination database, migrating it forward if needed, or refuse to
 * start.
 *
 * THE HOUSE CACHE RULES DO NOT APPLY HERE, and this paragraph is why — because
 * without it a reviewer will cite them, correctly, against this file:
 *
 *  - `fleetstate.ts:47-55` says "the READ is the version negotiation", and that
 *    a cache which cannot be revived is treated as ABSENT. `offline.ts:11-16`
 *    stays at v1 forever for the same reason. Both govern artefacts whose loss
 *    is FREE: the degraded-mode snapshot is re-assembled live, the offline
 *    snapshot is replaced by the next frame.
 *  - This is the first artefact in ccrc whose loss is NOT free. Collapsing an
 *    unreadable database to "empty" would answer "that program never happened"
 *    — the exact shape of `ccd`'s SIXTEENTH FORGERY, a manifest that lies
 *    pristine (`ccd/ccd:2018-2035`).
 *  - And the reason those files could not do better is absent here: they had
 *    NOWHERE to put a version key. This file has `PRAGMA user_version`, which
 *    IS the key, so the negotiation is a real one and does not have to be
 *    smuggled into the read.
 *
 * The four rules, from spec:70-81:
 *   1. Forward-only, idempotent, at open, EACH IN A TRANSACTION.
 *   2. Cannot migrate -> refuse to start LOUDLY. Never start empty.
 *   3. A HIGHER user_version is not fatal: a rollback (`~/ccrc-backups/`, and
 *      `shared/api.ts:566-575` on why rollback is a real scenario) must be able
 *      to READ. It may only refuse to MIGRATE. `user_version` is never written
 *      downward, and unknown columns are ignored because every read names its
 *      columns explicitly — `SELECT *` is banned in this directory.
 *   4. The markdown ledger stays the disaster-recovery ground truth
 *      (`docs/superpowers/programs/<slug>.md` + the registry + `.prhistory`);
 *      `coord-store.test.ts`'s reconstruction drill proves the path.
 */
export function openCoordDb(dbPath: string): DatabaseSync {
  // `~/.ccrc` is not created by the deploy except incidentally (`deploy.sh:34`
  // runs `mkdir -p ~/.ccrc` only inside `ship_env`), so every writer makes its
  // own parent — `fleetstate.ts:40`, `push.ts:50`, `notifylog.ts:85`.
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  // Deliberately AFTER the version check and any migration attempt, not
  // before: `PRAGMA journal_mode = WAL` is itself a write to the file (it
  // flips the header byte and creates `-wal`/`-shm` sidecars), and the
  // `CoordDbUnmigratable` message below promises how much of the file did or
  // did not change on a failed migration. Setting WAL any earlier would make
  // that promise false on the very case it is meant to reassure about: a
  // migration that fails on its first attempt this boot.
  const finishOpen = (): DatabaseSync => {
    // WAL: a reader must never be blocked by the sweep's write, and the
    // journal mode is a property of the FILE, so it survives every later open.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  };

  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > COORD_SCHEMA_VERSION) {
    // Rule 3. Loud, because it is worth knowing; not fatal, because refusing
    // here would make a rollback unable to read the history it rolled back to.
    console.warn(
      `ccrc-server: coord.db is at schema ${current}, this build knows ${COORD_SCHEMA_VERSION} — ` +
      'reading it as-is and migrating nothing (a rollback may only refuse to migrate, never to read)',
    );
    return finishOpen();
  }

  for (let v = current; v < COORD_SCHEMA_VERSION; v++) {
    try {
      tx(db, () => {
        db.exec(MIGRATIONS[v]!);
        // Inside the same transaction as the DDL it describes: SQLite's DDL is
        // transactional, so a crash between the two would otherwise leave a
        // migrated schema claiming to be unmigrated and re-run it on next boot.
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } catch (err) {
      db.close();
      // Earlier iterations of THIS loop (v ran from `current` up) may already
      // have committed — each is its own transaction, so a v0->v3 build
      // meeting a v0 file that fails migration 3 has already written schema 1
      // and 2 to disk before this throw. "Nothing was changed" is a lie in
      // that case, and both the operator's restore decision and the rollback
      // path (`current > COORD_SCHEMA_VERSION` above) turn on it being true.
      const dataStatus = describeMigrationProgress(current, v);
      throw new CoordDbUnmigratable(
        `ccrc-server: ${dbPath} is at schema ${v} and migration ${v + 1} failed: ` +
        `${err instanceof Error ? err.message : String(err)}. REFUSING TO START. ${dataStatus} ` +
        'There is no coord.db backup: deploy.sh backs up dist-pwa/agent-dist/ccd/notify.sh/' +
        'session-hook.sh under ~/ccrc-backups/, never coord.db, so that directory has nothing to ' +
        'restore for this file. Reconstruct the program history from the markdown ledger ' +
        '(docs/superpowers/programs/<slug>.md) plus the registry and .prhistory (spec:82-85), or ' +
        'move the file aside and accept the loss — starting empty would erase it silently instead.',
      );
    }
  }
  return finishOpen();
}

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
