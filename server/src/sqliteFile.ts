// The one migrating opener for every SQLite file the server owns (private store plan, Task 1, slug `opener-is-shared`).
// Moved, with no behaviour change, out of `coord/db.ts#openCoordDb`, which is its first caller; the private store
// (`operatorModel/db.ts`) is its second. L3, context K: it names `node:sqlite` and `node:fs` and decides nothing a
// caller does not hand it. The caller keeps its own refusal sentences (`zeroByte`, `migrationFailed`) and its own error
// class (`fail`), so a sentence a test pins where it stands never moves here.
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, fchmodSync, linkSync, mkdirSync, openSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { tx } from './coord/tx.js';

export interface MigratedSqliteSpec {
  /** Index `v` is the migration from schema `v` to `v + 1`. Read at each step, never copied. */
  readonly migrations: readonly string[];
  /** The file's name in the warning line, e.g. `coord.db`. */
  readonly label: string;
  /** The caller's refusal sentences, built where the caller keeps them, so their text never moves. */
  readonly zeroByte: (dbPath: string) => string;
  readonly migrationFailed: (dbPath: string, version: number, err: unknown, dataStatus: string) => string;
  /** The caller's error class: `CoordDbUnmigratable`, `PrivateStoreUnmigratable`. */
  readonly fail: (message: string) => Error;
  /** A file this call creates is created at exactly this mode before SQLite opens it (the private store: 0o600), and
   *  under the temporary name `<file>.creating` until every migration has committed, so a crash before then leaves no
   *  0-byte file at the real name for the next boot to refuse. Absent, SQLite creates it at the umask's mode at its real
   *  name, as `coord.db` always has been (slug `coord-db-keeps-its-create-window`). */
  readonly createMode?: number;
}

/**
 * The "how much of the file changed" clause of a migration refusal, isolated as a pure function so it is testable on
 * its own. `current` is the schema the file was at when the open started this boot; `v` is the schema the failing
 * migration was attempting to leave (migration `v+1` is the one that threw). `v > current` means migrations
 * `current+1..v` each committed, in their own transaction, before this one failed — the file is NOT at `current` any
 * more. Pinning BOTH arms directly is the only way to kill a mutant that guts either one, or the `tx()` around each
 * migration it describes, without depending on which migration happens to be the brittle one a build ships.
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

/**
 * Whether the migration-failure path should delete the file it just rolled back, isolated as a pure function for the
 * same reason `describeMigrationProgress` is: `existedBefore && sizeAfterRollback === 0` cannot be reached through the
 * opener itself (the 0-byte guard refuses a pre-existing empty file before any migration, and SQLite rolls a failed
 * transaction back to its pre-transaction bytes, never to zero), so an integration test can never exercise a mutant
 * that deletes the `!existedBefore` guard. The guard stays anyway: "unreachable today" stops being true without
 * warning. Only a 0-byte file this call created and never wrote a row into is safe to remove — anything with bytes in
 * it might be real, committed history, and rule 2 ("never start empty") forbids guessing that away.
 */
export function shouldRemoveMigrationFailureArtifact(existedBefore: boolean, sizeAfterRollback: number): boolean {
  return !existedBefore && sizeAfterRollback === 0;
}

/**
 * Opens `dbPath`, migrating it to `spec.migrations.length`, or throws `spec.fail(...)`. The four rules
 * (`coord/db.ts#openCoordDb`'s docstring says why they, and not the house cache rules, apply):
 *   1. Forward-only, idempotent, at open, EACH IN A TRANSACTION with its `user_version`.
 *   2. Cannot migrate -> refuse to start LOUDLY. Never start empty: a 0-byte file that existed before the call refuses.
 *   3. A HIGHER `user_version` is read and never migrated, with one warning line; it is never written downward.
 *   4. WAL, foreign keys and a busy timeout are set only after migration.
 * A file that is not a database at all escapes as SQLite's own error, unwrapped, and is kept.
 */
export function openMigratedSqlite(dbPath: string, spec: MigratedSqliteSpec): DatabaseSync {
  const version = spec.migrations.length;
  // `~/.ccrc` is not created by the deploy except incidentally, so every writer makes its own parent.
  mkdirSync(path.dirname(dbPath), { recursive: true });

  // Rule 2 has a hole `DatabaseSync` will not surface on its own: SQLite treats a zero-length file as a brand-new
  // empty database, so a file that already existed and was truncated — a disk-full write, an interrupted
  // `cp`/`rsync --inplace`, a stray `> coord.db` — is indistinguishable from a genuinely fresh install once
  // `new DatabaseSync` has run. This guard runs BEFORE that call, so at THIS instant a 0-byte file can only mean
  // "predates this process" — provided nothing this process does leaves a 0-byte file behind, which the cleanup beside
  // the migration-failure cleanup in `migrateFrom` guarantees (`new DatabaseSync` makes the file at 0 bytes before any
  // migration writes a byte; `createMode`'s create does that under its temporary name).
  const existedBefore = existsSync(dbPath);
  if (existedBefore && statSync(dbPath).size === 0) throw spec.fail(spec.zeroByte(dbPath));

  if (!existedBefore && spec.createMode !== undefined) {
    // Created empty, exclusively, then set to the exact mode through its descriptor, so the umask cannot widen it, and
    // migrated under its temporary name. A leftover of a crashed create never held a row (rows are written only after
    // this open returns), so it is removed. The link fails rather than replace a file that appeared meanwhile. SQLite
    // gives the `-wal` and `-shm` sidecars the main file's mode.
    const tmp = `${dbPath}.creating`;
    rmSync(tmp, { force: true });
    rmSync(`${tmp}-journal`, { force: true });
    const fd = openSync(tmp, 'wx', spec.createMode);
    try { fchmodSync(fd, spec.createMode); } finally { closeSync(fd); }
    const fresh = new DatabaseSync(tmp);
    migrateFrom(fresh, tmp, false, 0, spec, dbPath);
    fresh.close();
    linkSync(tmp, dbPath);
    unlinkSync(tmp);
  }

  const db = new DatabaseSync(dbPath);

  // Deliberately AFTER the version check and any migration attempt: `PRAGMA journal_mode = WAL` is itself a write to
  // the file (it flips the header byte and creates the sidecars), and the refusal below promises how much of the file
  // did or did not change on a failed migration.
  const finishOpen = (): DatabaseSync => {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  };

  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > version) {
    // Rule 3. Loud, because it is worth knowing; not fatal, because refusing here would make a rollback unable to read
    // the history it rolled back to.
    console.warn(
      `ccrc-server: ${spec.label} is at schema ${current}, this build knows ${version} — ` +
      'reading it as-is and migrating nothing (a rollback may only refuse to migrate, never to read)',
    );
    return finishOpen();
  }

  migrateFrom(db, dbPath, existedBefore, current, spec, dbPath);
  return finishOpen();
}

/** Rule 1's loop, from `current` to the spec's version, on the open handle `db` of `file`; on a failure it closes `db`,
 *  removes `file` only when this call created it and it is still 0 bytes, and throws the caller's sentence naming
 *  `reportPath` (the real name, also while the file is migrated under its temporary one). */
function migrateFrom(db: DatabaseSync, file: string, existedBefore: boolean, current: number, spec: MigratedSqliteSpec,
  reportPath: string): void {
  const version = spec.migrations.length;
  for (let v = current; v < version; v++) {
    try {
      tx(db, () => {
        db.exec(spec.migrations[v]!);
        // Inside the same transaction as the DDL it describes: SQLite's DDL is transactional, so a crash between the
        // two would otherwise leave a migrated schema claiming to be unmigrated and re-run it on next boot.
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } catch (err) {
      db.close();
      // A file THIS call created whose migration never got far enough to commit would still be sitting at 0 bytes,
      // and the NEXT boot would meet it at the 0-byte guard and refuse forever over a failure that may already be
      // fixed. Best-effort: the throw below is what reports the failure, and a failed unlink must not replace it.
      try {
        const sizeNow = existsSync(file) ? statSync(file).size : null;
        if (sizeNow !== null && shouldRemoveMigrationFailureArtifact(existedBefore, sizeNow)) {
          unlinkSync(file);
        }
      } catch { /* the caller's refusal below is the real signal */ }
      // Earlier iterations of THIS loop may already have committed, each in its own transaction, so "nothing was
      // changed" would be a lie; the caller's sentence carries the measured progress.
      throw spec.fail(spec.migrationFailed(reportPath, v, err, describeMigrationProgress(current, v)));
    }
  }
}
