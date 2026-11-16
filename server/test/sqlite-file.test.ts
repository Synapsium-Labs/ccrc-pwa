// Private store plan, Task 1 (slug `opener-is-shared`): the migrating opener's rules, pinned through `openCoordDb` first,
// byte for byte, so the move into `server/src/sqliteFile.ts` is provably behaviour-neutral. Every arm `coord-db.test.ts`
// drives is driven here again with its exact thrown message, warning line, resulting `user_version`, journal mode and
// file presence. The second half pins what the opener adds for the private store: `createMode`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, CoordDbUnmigratable, openCoordDb } from '../src/coord/db.js';
import { openMigratedSqlite, type MigratedSqliteSpec } from '../src/sqliteFile.js';
import { COLLECT_LANE_JOURNAL_BASENAME } from '../src/coord/collectLaneJournal.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { mkTmp } from './tmpHelpers.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const versionOf = (db: DatabaseSync): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const modeOf = (db: DatabaseSync): string =>
  (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
const reopen = <T>(p: string, fn: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(p);
  try { return fn(db); } finally { db.close(); }
};
const caughtFrom = (fn: () => unknown): unknown => {
  try { fn(); } catch (err) { return err; }
  return undefined;
};

/** The two restore sentences, spelled here in full: a move that changes one byte of either is red. */
const CLAUSE =
  ` Restore a snapshot only with ccrc.service stopped, and leave ~/.ccrc/${COLLECT_LANE_JOURNAL_BASENAME} in place: ` +
  'no backup holds it, and if the collector switch changed after that snapshot the temp-root collector stays ' +
  'stopped until a fresh choice in Settings. A restore that moves that file back to the same older point too ' +
  'cannot be detected: after one, raise the cleanup pause and confirm a fresh choice in Settings before choosing Live.';
const zeroByteMessage = (p: string): string =>
  `ccrc-server: ${p} exists but is 0 bytes. REFUSING TO START: SQLite would treat this as ` +
  'a brand-new empty database and migrate 0->1 clean, silently erasing whatever this file held ' +
  'before it was truncated — the outcome rule 2 forbids by name. Check ~/ccrc-backups/<ts>/coord.db ' +
  'first: every deploy.sh run snapshots coord.db there (VACUUM INTO, backup-coord.mjs) before ' +
  'touching anything, so the newest timestamped snapshot is the restore path. Only if no ' +
  'snapshot exists, reconstruct the program history from the markdown ledger ' +
  '(docs/superpowers/programs/<slug>.md) plus the registry and .prhistory (spec:82-85), or ' +
  'move the file aside and accept the loss — starting empty would erase it silently instead.' + CLAUSE;
const migrationFailedMessage = (p: string, v: number, cause: string, dataStatus: string): string =>
  `ccrc-server: ${p} is at schema ${v} and migration ${v + 1} failed: ` +
  `${cause}. REFUSING TO START. ${dataStatus} ` +
  'Check ~/ccrc-backups/<ts>/coord.db first: every deploy.sh run snapshots coord.db there ' +
  '(VACUUM INTO, backup-coord.mjs) before touching anything, so the newest timestamped ' +
  'snapshot is the restore path. Only if no snapshot exists, reconstruct the program history ' +
  'from the markdown ledger (docs/superpowers/programs/<slug>.md) plus the registry and ' +
  '.prhistory (spec:82-85), or move the file aside and accept the loss — starting empty ' +
  'would erase it silently instead.' + CLAUSE;
const FIRST_ATTEMPT_STATUS = (v: number): string =>
  `No table data changed: migration ${v + 1} was the first attempted this boot, and its own ` +
  'transaction rolled back in full.';

/** Swap one migration for invalid SQL for the length of `fn`, as `coord-db.test.ts` does. */
function withBrokenMigration<T>(index: number, fn: () => T): T {
  const mutable = MIGRATIONS as unknown as string[];
  const original = mutable[index]!;
  mutable[index] = 'CREATE TABLE broken (';
  try { return fn(); } finally { mutable[index] = original; }
}

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
afterEach(() => { warnSpy?.mockRestore(); warnSpy = null; });

describe('openCoordDb, characterized (the opener move changes no byte of it)', () => {
  it('fresh: creates the parent and the file, migrates to the schema version, then sets WAL, and warns nothing', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    const db = openCoordDb(p);
    expect(versionOf(db)).toBe(COORD_SCHEMA_VERSION);
    expect(modeOf(db)).toBe('wal');
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000);
    db.close();
    expect(existsSync(p)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('current: a second open migrates nothing and warns nothing', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    openCoordDb(p).close();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = openCoordDb(p);
    expect(versionOf(db)).toBe(COORD_SCHEMA_VERSION);
    expect(modeOf(db)).toBe('wal');
    db.close();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('behind: a file one migration behind is brought forward by exactly the missing migration', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    mkdirSync(path.dirname(p), { recursive: true });
    reopen(p, (raw) => {
      for (let v = 0; v < COORD_SCHEMA_VERSION - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION - 1}`);
    });
    const db = openCoordDb(p);
    expect(versionOf(db)).toBe(COORD_SCHEMA_VERSION);
    expect(modeOf(db)).toBe('wal');
    db.close();
  });

  it('ahead: a higher user_version is read, never migrated, with exactly this warning line', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    openCoordDb(p).close();
    reopen(p, (raw) => raw.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 3}`));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = openCoordDb(p);
    expect(versionOf(db)).toBe(COORD_SCHEMA_VERSION + 3);
    expect(modeOf(db)).toBe('wal');
    db.close();
    expect(warnSpy.mock.calls).toEqual([[
      `ccrc-server: coord.db is at schema ${COORD_SCHEMA_VERSION + 3}, this build knows ${COORD_SCHEMA_VERSION} — ` +
      'reading it as-is and migrating nothing (a rollback may only refuse to migrate, never to read)',
    ]]);
  });

  it('0-byte: a file that predates the call refuses with exactly this message, and is left 0 bytes', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, '');
    const err = caughtFrom(() => openCoordDb(p));
    expect(err).toBeInstanceOf(CoordDbUnmigratable);
    expect((err as Error).message).toBe(zeroByteMessage(p));
    expect(statSync(p).size).toBe(0);
  });

  it('a failing migration on a fresh file: exactly this message, and no file left behind', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    const err = withBrokenMigration(0, () => caughtFrom(() => openCoordDb(p)));
    expect(err).toBeInstanceOf(CoordDbUnmigratable);
    expect((err as Error).message).toBe(
      migrationFailedMessage(p, 0, 'incomplete input', FIRST_ATTEMPT_STATUS(0)));
    expect(existsSync(p)).toBe(false);
  });

  it('a failing migration on an existing file: exactly this message, the file kept, its version and mode unchanged', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const last = COORD_SCHEMA_VERSION - 1;
    reopen(p, (raw) => {
      for (let v = 0; v < last; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${last}`);
    });
    const err = withBrokenMigration(last, () => caughtFrom(() => openCoordDb(p)));
    expect(err).toBeInstanceOf(CoordDbUnmigratable);
    expect((err as Error).message).toBe(
      migrationFailedMessage(p, last, 'incomplete input', FIRST_ATTEMPT_STATUS(last)));
    expect(existsSync(p)).toBe(true);
    reopen(p, (raw) => {
      expect(versionOf(raw)).toBe(last);
      expect(modeOf(raw)).not.toBe('wal');
    });
  });

  it('a failing migration after earlier ones committed this boot names the schema the file was left at', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const start = COORD_SCHEMA_VERSION - 3;
    reopen(p, (raw) => {
      for (let v = 0; v < start; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${start}`);
    });
    const failing = COORD_SCHEMA_VERSION - 1;
    const err = withBrokenMigration(failing, () => caughtFrom(() => openCoordDb(p)));
    expect((err as Error).message).toBe(migrationFailedMessage(p, failing, 'incomplete input',
      `Migrations ${start + 1}-${failing} already committed earlier in this boot — the file is now at schema ${failing}, ` +
      `not ${start} — before migration ${failing + 1} failed and rolled back on its own.`));
    reopen(p, (raw) => expect(versionOf(raw)).toBe(failing));
  });

  it('not a database: the raw SQLite error escapes, unwrapped, and the file is kept', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, 'this is not a sqlite file\n');
    const err = caughtFrom(() => openCoordDb(p));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CoordDbUnmigratable);
    expect((err as Error).message).toBe('file is not a database');
    expect(existsSync(p)).toBe(true);
  });

  it('coord.db is created at the umask\'s mode: no createMode is passed for it', () => {
    const p = dbPathIn(mkTmp('ccrc-sqlite-file-'));
    const old = process.umask(0o022);
    try { openCoordDb(p).close(); } finally { process.umask(old); }
    expect(statSync(p).mode & 0o777).toBe(0o644);
  });
});

class FixtureUnmigratable extends Error {}
const fixtureSpec = (migrations: string[], createMode?: number): MigratedSqliteSpec => ({
  migrations,
  label: 'fixture.db',
  zeroByte: (p) => `zero ${p}`,
  migrationFailed: (p, v, err, dataStatus) => `failed ${p} at ${v}: ${err instanceof Error ? err.message : String(err)} | ${dataStatus}`,
  fail: (m) => new FixtureUnmigratable(m),
  ...(createMode === undefined ? {} : { createMode }),
});
const withUmask = <T>(mask: number, fn: () => T): T => {
  const old = process.umask(mask);
  try { return fn(); } finally { process.umask(old); }
};
const fileIn = (name: string): string => path.join(mkTmp('ccrc-sqlite-file-'), 'nested', name);

describe('openMigratedSqlite, its own caller\'s spec', () => {
  it('uses the caller\'s label, sentences and error class', () => {
    const p = fileIn('fixture.db');
    const db = openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)', 'CREATE TABLE b (y)']));
    expect(versionOf(db)).toBe(2);
    db.exec('PRAGMA user_version = 5');
    db.close();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)', 'CREATE TABLE b (y)'])).close();
    expect(warnSpy.mock.calls[0]![0]).toBe('ccrc-server: fixture.db is at schema 5, this build knows 2 — '
      + 'reading it as-is and migrating nothing (a rollback may only refuse to migrate, never to read)');
    const z = fileIn('zero.db');
    mkdirSync(path.dirname(z), { recursive: true });
    writeFileSync(z, '');
    const err = caughtFrom(() => openMigratedSqlite(z, fixtureSpec(['CREATE TABLE a (x)'])));
    expect(err).toBeInstanceOf(FixtureUnmigratable);
    expect((err as Error).message).toBe(`zero ${z}`);
  });

  it('a crash between the DDL and its user_version cannot happen: both commit in one transaction', () => {
    // The second statement of migration 1 fails after its first applied: the table is rolled back with the version.
    const p = fileIn('tx.db');
    const err = caughtFrom(() => openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)', 'CREATE TABLE b (y); CREATE TABLE a (z)'])));
    expect(err).toBeInstanceOf(FixtureUnmigratable);
    expect((err as Error).message).toMatch(/^failed .* at 1: .*\| Migration 1 already committed earlier in this boot/);
    reopen(p, (raw) => {
      expect(versionOf(raw)).toBe(1);
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").all()).toEqual([]);
    });
  });

  it('a crash between a migration\'s DDL and its user_version leaves neither: both are one transaction', () => {
    // The crash is simulated at the version write itself: inside the migration's transaction it rolls the DDL back too.
    const p = fileIn('crash.db');
    const real = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql === 'PRAGMA user_version = 1') throw new Error('simulated crash before the version write');
      return real.call(this, sql);
    });
    let err: unknown;
    try { err = caughtFrom(() => openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)']))); } finally { spy.mockRestore(); }
    expect(err).toBeInstanceOf(FixtureUnmigratable);
    reopen(p, (raw) => {
      expect(versionOf(raw)).toBe(0);
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").all()).toEqual([]);
    });
  });

  it('createMode: a file this call creates is 0600 under a 0o022 umask, and so are its -wal and -shm', () => {
    const p = fileIn('private.db');
    const db = withUmask(0o022, () => openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)'], 0o600)));
    db.exec('INSERT INTO a VALUES (1)');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(statSync(`${p}-wal`).mode & 0o777).toBe(0o600);
    expect(statSync(`${p}-shm`).mode & 0o777).toBe(0o600);
    expect(versionOf(db)).toBe(1);
    db.close();
  });

  it('createMode never touches a file that existed before the call', () => {
    const p = fileIn('existing.db');
    withUmask(0o022, () => openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)'])).close());
    expect(statSync(p).mode & 0o777).toBe(0o644);
    withUmask(0o022, () => openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)'], 0o600)).close());
    expect(statSync(p).mode & 0o777).toBe(0o644);
  });

  it('createMode: a failed first migration of the created file leaves no file, and the 0-byte guard still refuses only a file that predates the call', () => {
    const p = fileIn('failing.db');
    const err = caughtFrom(() => openMigratedSqlite(p, fixtureSpec(['CREATE TABLE broken ('], 0o600)));
    expect(err).toBeInstanceOf(FixtureUnmigratable);
    expect(existsSync(p)).toBe(false);
    const db = openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)'], 0o600));
    expect(versionOf(db)).toBe(1);
    db.close();
  });

  it('createMode: the created file is migrated under a temporary name and appears at its real name only once migrated (F5)', () => {
    const p = fileIn('atomic.db');
    const seen: boolean[] = [];
    const migrations = new Proxy(['CREATE TABLE a (x)', 'CREATE TABLE b (y)'], {
      get(target, key, receiver) {
        if (key === '0' || key === '1') seen.push(existsSync(p));
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const db = openMigratedSqlite(p, fixtureSpec(migrations, 0o600));
    expect(seen).toEqual([false, false]);   // a crash during either migration leaves nothing at the real name
    expect(versionOf(db)).toBe(2);
    expect(existsSync(`${p}.creating`)).toBe(false);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    db.close();
  });

  it('createMode: what a crashed create left under the temporary name is removed, and the next open creates the file (F5)', () => {
    const p = fileIn('crashed.db');
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(`${p}.creating`, '');
    writeFileSync(`${p}.creating-journal`, 'partial');
    const db = openMigratedSqlite(p, fixtureSpec(['CREATE TABLE a (x)'], 0o600));
    expect(versionOf(db)).toBe(1);
    expect(existsSync(`${p}.creating`)).toBe(false);
    expect(existsSync(`${p}.creating-journal`)).toBe(false);
    db.close();
  });
});
