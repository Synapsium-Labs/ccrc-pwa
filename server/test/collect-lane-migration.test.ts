// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2): the collector switch's table is ONE new MIGRATIONS
// entry with an exact seed. Its slot is found by its DDL and never hard-coded: the delegation-broker wave 3 plan names
// the same slot, and whichever branch merges second moves up without editing a line here. Fixture coord.db files only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

/** The needle stops at the NAME: `_` is a word character, so `collect_lane_settings_new` (SQLite's rebuild idiom, a
 *  legitimate later migration) is not a second create of this table. The stall_settings case's rule. */
const CREATE = /CREATE TABLE collect_lane_settings(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const SEED = { id: 1, choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0, updatedAt: 0 };
const SEED_SQL = 'SELECT id, choice, fleetNodeId, markerRetiredAt, generation, updatedAt FROM collect_lane_settings';
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

describe('the switch’s table is one new entry with an exact seed (path-identity spec 2026-10-12 §5.2)', () => {
  it('the slot is found by DDL, created once, never amended into a frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry creates collect_lane_settings').toBeGreaterThanOrEqual(19);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length, 'more than one entry creates collect_lane_settings').toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => m.includes('collect_lane_settings')),
      'collect_lane_settings was amended into a frozen entry').toBe(false);
  });

  it('the entry alone adds exactly collect_lane_settings and seeds the one row', () => {
    expect(SLOT, 'no MIGRATIONS entry creates collect_lane_settings').toBeGreaterThanOrEqual(19);
    // A NEW TABLE AND NOTHING ELSE: one CREATE and its seed, no ALTER of an older build's table.
    expect(MIGRATIONS[SLOT - 1]!.trim()).toMatch(
      /^CREATE TABLE collect_lane_settings \([^;]*\);\s*INSERT INTO collect_lane_settings \(id, choice, fleetNodeId, markerRetiredAt, generation, updatedAt\)\s*VALUES \(1, 'off', NULL, NULL, 0, 0\);$/);
    const raw = new DatabaseSync(plantedBefore('ccrc-mig-collectlane-'));
    const had = objectNames(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(objectNames(raw).filter((n) => !had.includes(n)).sort()).toEqual(['collect_lane_settings']);
    expect(raw.prepare(SEED_SQL).all()).toEqual([SEED]);
    raw.close();
  });

  it('openCoordDb reaches a database one version before it and keeps its rows', () => {
    const db = openCoordDb(plantedBefore('ccrc-mig-collectlane-open-'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(db.prepare(SEED_SQL).all()).toEqual([SEED]);
    expect(db.prepare('SELECT claimedBy, state FROM runs').all()).toEqual([{ claimedBy: 'c', state: 'working' }]);
    db.close();
  });

  it('the columns and their nullability', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-collectlane-cols-')));
    const cols = (db.prepare('PRAGMA table_info(collect_lane_settings)').all() as unknown as
      { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[])
      .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);
    expect(cols).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['choice', 'TEXT', 1, null, 0], ['fleetNodeId', 'TEXT', 0, null, 0],
      ['markerRetiredAt', 'INTEGER', 0, null, 0], ['generation', 'INTEGER', 1, null, 0], ['updatedAt', 'INTEGER', 1, null, 0],
    ]);
    db.close();
  });

  it('the singleton check refuses id 2', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-collectlane-one-')));
    expect(() => db.exec('INSERT INTO collect_lane_settings (id, choice, fleetNodeId, markerRetiredAt, generation, updatedAt) ' +
      "VALUES (2, 'off', NULL, NULL, 0, 0)")).toThrow(/CHECK constraint failed/);
    db.close();
  });

  it('no SQL check on choice', () => {
    // A token a newer build writes must not stop an older build opening the file (spec §5.2); this build reads it as
    // readable but ineffective, which is L1's to decide.
    expect(MIGRATIONS[SLOT - 1] ?? '', 'the entry checks choice').not.toMatch(/CHECK\s*\(\s*choice\b/);
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-collectlane-token-')));
    db.exec("UPDATE collect_lane_settings SET choice = 'LIVE'");
    expect(new CoordStore(db).collectLaneRow()).toMatchObject({ kind: 'row', row: { choice: 'LIVE' } });
    db.close();
  });

  it('an older build opening the new version takes the read-as-is rule and boots', () => {
    // A test cannot run an older db.ts. It puts THIS build where an older build stands: the file is one version past
    // COORD_SCHEMA_VERSION, as a file carrying this entry is one version past a build from before it. Rule 3 (db.ts)
    // warns, reads as-is and migrates nothing. An older build never names this table, and every read it makes names
    // its own columns.
    const p = dbPathIn(mkTmp('ccrc-mig-collectlane-older-'));
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
      expect(new CoordStore(db).collectLaneRow()).toEqual({ kind: 'row', row: {
        choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n } });
      db.close();
    } finally {
      warn.mockRestore();
    }
  });
});
