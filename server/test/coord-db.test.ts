// The four properties spec:70-81 names, and one the spec implies: a
// transaction that throws leaves nothing behind.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  COORD_SCHEMA_VERSION, CoordDbUnmigratable, defaultCoordDbPath, describeMigrationProgress,
  openCoordDb, tx,
} from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');

describe('defaultCoordDbPath', () => {
  it('joins .ccrc/coord.db under the given home', () => {
    // Same precedent as `fleetstate.test.ts`'s `defaultCachePath` pin: the
    // exported helper is asserted directly, not just through whatever
    // `config.ts` happens to do with it — a rename here must fail a test in
    // THIS file, not rely on `config.ts` staying wired to it.
    expect(defaultCoordDbPath('/home/x')).toBe(path.join('/home/x', '.ccrc', 'coord.db'));
  });
});

describe('openCoordDb', () => {
  it('creates the parent directory, the schema and the version, then reopens idempotently', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    expect(existsSync(path.dirname(p))).toBe(false);   // ~/.ccrc is NOT made by the deploy

    const a = openCoordDb(p);
    expect((a.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect((a.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode)
      .toBe('wal');
    // Every table spec:106-117 names, plus the two D-3 adds.
    const names = (a.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(expect.arrayContaining([
      'coordinator_state', 'mail', 'mail_deliveries', 'mail_rejections',
      'programs', 'run_events', 'runs', 'work_items',
    ]));
    a.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('p','P',1,'active')").run();
    a.close();

    // Reopening at the current version migrates NOTHING and destroys nothing.
    const b = openCoordDb(p);
    expect((b.prepare('SELECT count(*) AS c FROM programs').get() as { c: number }).c).toBe(1);
    b.close();
  });

  it('refuses to start, loudly, on a database it cannot migrate — and the WHOLE migration script rolls back, not just the statement that failed', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    // The clash is on `work_items` deliberately, NOT `programs`. `programs` is
    // the FIRST statement `MIGRATIONS[0]` runs (schema.ts), so a clash there
    // dies before any DDL applies at all — `tx()` never gets a chance to roll
    // anything back, and a mutant with `tx()` deleted from the migration loop
    // produces byte-identical post-conditions (measured). `work_items` is the
    // FOURTH table the script creates, so `programs`/`runs`/`run_events` all
    // succeed first — this is the fixture that can actually tell a
    // transactional migration from a non-transactional one apart.
    const raw = new DatabaseSync(p);
    raw.exec('PRAGMA user_version = 0');
    raw.exec('CREATE TABLE work_items (nonsense INTEGER)');
    raw.close();

    let caught: unknown;
    try { openCoordDb(p); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(CoordDbUnmigratable);
    const message = (caught as Error).message;
    // The message must not point the operator at a backup that was never
    // taken — deploy.sh backs up dist-pwa/agent-dist/etc, never coord.db.
    expect(message).not.toMatch(/restore from ~\/ccrc-backups/i);
    expect(message).toMatch(/no coord\.db backup/i);
    // And it must not claim "nothing changed" unconditionally — here it
    // happens to be true (this was the first migration attempted this boot).
    expect(message).toMatch(/no table data changed/i);

    // And the file is UNTOUCHED — the migration ran in a transaction, so the
    // three tables that DID get created earlier in the same script were rolled
    // back along with the statement that failed, not left half-committed.
    const after = new DatabaseSync(p);
    expect((after.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
    const survivingTables = (after.prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('programs','runs','run_events')",
    ).all() as { name: string }[]).map((r) => r.name);
    expect(survivingTables).toEqual([]);
    // The pragma sequencing matters too: WAL is set only once the db is known
    // usable, so a migration that fails on its very first attempt this boot
    // must not even have flipped the journal mode.
    expect((after.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode)
      .not.toBe('wal');
    after.close();
  });

  it('READS a database from a NEWER build rather than refusing it', () => {
    // spec:78-81 — rollback is real. An older build meeting a higher
    // user_version may refuse to MIGRATE, never to READ.
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    const a = openCoordDb(p);
    a.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 7}`);
    a.exec('ALTER TABLE runs ADD COLUMN somethingFromTheFuture TEXT');
    a.prepare(`INSERT INTO programs (slug,title,createdAt,state) VALUES ('p','P',1,'active')`).run();
    a.close();

    const b = openCoordDb(p);                       // no throw
    expect((b.prepare('SELECT count(*) AS c FROM programs').get() as { c: number }).c).toBe(1);
    expect((b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION + 7);              // never written DOWN
    b.close();
  });

  it('rejects a file that is not a database at all, without eating it', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, 'this is not a sqlite file\n');
    expect(() => openCoordDb(p)).toThrow();
    expect(existsSync(p)).toBe(true);
  });

  it('tx rolls back everything on a throw, and commits everything otherwise', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    tx(db, () => {
      db.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('a','A',1,'active')").run();
    });
    expect(() => tx(db, () => {
      db.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('b','B',1,'active')").run();
      throw new Error('nope');
    })).toThrow('nope');
    const slugs = (db.prepare('SELECT slug FROM programs ORDER BY slug').all() as { slug: string }[])
      .map((r) => r.slug);
    expect(slugs).toEqual(['a']);
    db.close();
  });
});

describe('describeMigrationProgress', () => {
  // Isolated from `openCoordDb` deliberately: `MIGRATIONS.length === 1` today,
  // so the loop it drives can only ever fail on iteration 0 end-to-end, and
  // the "earlier migrations already committed" branch is unreachable through
  // `openCoordDb` alone. This pins BOTH branches directly, so a mutant that
  // guts either one fails here even though `coord-db.test.ts`'s own
  // `openCoordDb` tests could never distinguish it.
  it('says nothing changed when the failing migration was the first attempted this boot', () => {
    expect(describeMigrationProgress(0, 0)).toMatch(/^No table data changed/);
    expect(describeMigrationProgress(3, 3)).toMatch(/^No table data changed/);
  });

  it('names the migrations that already committed this boot, and the schema they left the file at', () => {
    expect(describeMigrationProgress(0, 2)).toBe(
      'Migrations 1-2 already committed earlier in this boot — the file is now at schema 2, ' +
      'not 0 — before migration 3 failed and rolled back on its own.',
    );
  });

  it('uses the singular for exactly one committed migration', () => {
    expect(describeMigrationProgress(0, 1)).toMatch(/^Migration 1 already committed/);
    expect(describeMigrationProgress(0, 1)).not.toMatch(/^Migrations/);
  });
});
