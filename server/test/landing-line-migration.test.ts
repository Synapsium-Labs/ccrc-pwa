// Landing order wave 5e (D-7611): the landing line's two tables are ONE new MIGRATIONS entry and seed nothing. Its slot
// is found by its DDL and never hard-coded, so a branch that merges second moves up without editing a line here.
// Fixture coord.db files only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

/** The needle stops at the NAME: `_` is a word character, so a later rebuild idiom (`landing_entries_new`) is not a
 *  second create of this table. */
const CREATE = /CREATE TABLE landing_entries(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const objectNames = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all() as
    unknown as { name: string }[]).map((r) => r.name);
/** A database at exactly the version before this entry, carrying one program and one run. */
const plantedBefore = (prefix: string): string => {
  const p = dbPathIn(mkTmp(prefix));
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
    raw.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) " +
             "VALUES ('p', 1, 1, 'demo', 'working', 'c', 1)");
  });
  raw.close();
  return p;
};
type Col = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
const colsOf = (db: DatabaseSync, table: string): unknown[][] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Col[])
    .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);

describe('the landing line’s tables are one new entry that seeds nothing (landing order wave 5e)', () => {
  it('the slot is found by DDL, created once, never amended into a frozen entry', () => {
    expect(SLOT).toBeGreaterThanOrEqual(35);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /landing_(entries|projects)/.test(m))).toBe(false);
  });

  it('the entry alone adds exactly the two tables and the run index, and seeds nothing', () => {
    expect(SLOT, 'no MIGRATIONS entry creates landing_entries').toBeGreaterThanOrEqual(35);
    const raw = new DatabaseSync(plantedBefore('ccrc-mig-landing-'));
    const had = objectNames(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(objectNames(raw).filter((n) => !had.includes(n)).sort()).toEqual(['landing_entries', 'landing_entries_run', 'landing_projects']);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM landing_projects').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM landing_entries').get()).toEqual({ n: 0 });
    raw.close();
  });

  it('openCoordDb reaches a database one version before it and keeps its rows', () => {
    expect(SLOT, 'no MIGRATIONS entry creates landing_entries').toBeGreaterThanOrEqual(35);
    const db = openCoordDb(plantedBefore('ccrc-mig-landing-open-'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(db.prepare('SELECT claimedBy, state FROM runs').all()).toEqual([{ claimedBy: 'c', state: 'working' }]);
    db.close();
  });

  it('the columns and their nullability', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-landing-cols-')));
    const cols = colsOf(db, 'landing_entries');
    const projCols = colsOf(db, 'landing_projects');
    expect(cols).toEqual([
      ['id','INTEGER',0,null,1], ['project','TEXT',1,null,0], ['pr','INTEGER',1,null,0], ['pinnedSha','TEXT',1,null,0],
      ['handoffCommit','TEXT',1,null,0], ['runId','INTEGER',0,null,0], ['state','TEXT',1,null,0], ['baseSha','TEXT',0,null,0],
      ['ejectionKind','TEXT',0,null,0], ['ejections','INTEGER',1,'0',0], ['afterIds','TEXT',1,"'[]'",0],
      ['fixesMain','INTEGER',1,'0',0], ['setBy','TEXT',1,null,0], ['detail','TEXT',0,null,0], ['pinnedAt','INTEGER',1,null,0]]);
    expect(projCols).toEqual([['project','TEXT',1,null,1], ['operatorPaused','INTEGER',1,'0',0], ['mainRedHold','INTEGER',1,'0',0]]);
    db.close();
  });

  it('one row per (project, pr)', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-landing-uniq-')));
    const ins = db.prepare("INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) " +
      "VALUES ('project-a', 7, 'x', 'y', NULL, 'pinned', 'coordinator', 1)");
    ins.run();
    expect(() => ins.run()).toThrow(/UNIQUE constraint failed: landing_entries.project, landing_entries.pr/);
    db.close();
  });

  it('no SQL check on state or ejectionKind', () => {
    expect(SLOT, 'no MIGRATIONS entry creates landing_entries').toBeGreaterThanOrEqual(35);
    expect(MIGRATIONS[SLOT - 1] ?? '', 'the entry checks state or ejectionKind').not.toMatch(/CHECK\s*\(\s*(state|ejectionKind)\b/);
  });

  it('an older build opening the new version takes the read-as-is rule and boots', () => {
    // A test cannot run an older db.ts. It puts THIS build where an older build stands: the file is one version past
    // COORD_SCHEMA_VERSION. Rule 3 (db.ts) warns, reads as-is and migrates nothing; an older build never names these
    // tables.
    const p = dbPathIn(mkTmp('ccrc-mig-landing-older-'));
    const first = openCoordDb(p);
    first.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
    first.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 1}`);
    first.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = openCoordDb(p);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/reading it as-is and migrating nothing/);
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION + 1 });
      expect(db.prepare('SELECT slug, state FROM programs').all()).toEqual([{ slug: 'p', state: 'active' }]);
      db.close();
    } finally {
      warn.mockRestore();
    }
  });
});
