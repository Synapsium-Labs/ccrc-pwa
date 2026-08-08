// The four properties spec:70-81 names, and one the spec implies: a
// transaction that throws leaves nothing behind.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, CoordDbUnmigratable, openCoordDb, tx } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');

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

  it('refuses to start, loudly, on a database it cannot migrate', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    // A file at a LOWER version whose migration cannot apply: the target table
    // already exists with an incompatible shape, so migration 1 throws.
    const raw = new DatabaseSync(p);
    raw.exec('PRAGMA user_version = 0');
    raw.exec('CREATE TABLE programs (nonsense INTEGER)');
    raw.close();

    expect(() => openCoordDb(p)).toThrow(CoordDbUnmigratable);
    // And the file is UNTOUCHED — the migration ran in a transaction.
    const after = new DatabaseSync(p);
    expect((after.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
    expect((after.prepare("SELECT count(*) AS c FROM sqlite_master WHERE name='runs'")
      .get() as { c: number }).c).toBe(0);
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
