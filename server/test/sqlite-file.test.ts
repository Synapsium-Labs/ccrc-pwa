// Private store plan, Task 1 (slug `opener-is-shared`): the migrating opener's rules, pinned through `openCoordDb` first,
// byte for byte, so the move into `server/src/sqliteFile.ts` is provably behaviour-neutral. Every arm `coord-db.test.ts`
// drives is driven here again with its exact thrown message, warning line, resulting `user_version`, journal mode and
// file presence. The second half pins what the opener adds for the private store: `createMode`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, CoordDbUnmigratable, openCoordDb } from '../src/coord/db.js';
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
