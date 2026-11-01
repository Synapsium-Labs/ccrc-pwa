// Programme ledgers (plan PL2): the operator's items, their history and the spec modifications are ONE new
// MIGRATIONS entry, and the spec pin is three nullable columns on `programs`. The slot is found by its DDL and never
// hard-coded, so a branch that merges second moves up without editing a line here. Fixture coord.db files only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

/** The needle stops at the NAME: `_` is a word character, so `operator_item_events` is not a second create of
 *  `operator_items`. */
const CREATE = /CREATE TABLE operator_items(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const NAMES = /operator_items|operator_item_events|programme_modifications|specPath|inShort/;
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
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'Prog A', 1, 'active')");
    raw.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) " +
             "VALUES ('prog-a', 1, 1, 'project-a', 'working', 'lane-a', 1)");
  });
  raw.close();
  return p;
};
type Col = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
const colsOf = (db: DatabaseSync, table: string): unknown[][] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Col[])
    .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);

describe('the programme ledgers’ tables are one new entry that seeds nothing (plan PL2)', () => {
  it('the slot is found by DDL, created once, never amended into a frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry creates operator_items').toBeGreaterThanOrEqual(37);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => NAMES.test(m))).toBe(false);
  });

  it('the entry alone adds exactly the three tables and the item index, and seeds nothing', () => {
    expect(SLOT, 'no MIGRATIONS entry creates operator_items').toBeGreaterThanOrEqual(37);
    const raw = new DatabaseSync(plantedBefore('ccrc-mig-ledgers-'));
    const had = objectNames(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(objectNames(raw).filter((n) => !had.includes(n)).sort())
      .toEqual(['operator_item_events', 'operator_items', 'operator_items_by_program', 'programme_modifications']);
    for (const t of ['operator_items', 'operator_item_events', 'programme_modifications']) {
      expect(raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
    }
    // The pin columns start NULL on a programme that already existed: nothing is guessed into them.
    expect(raw.prepare('SELECT specPath, inShort, inShortAt FROM programs').all())
      .toEqual([{ specPath: null, inShort: null, inShortAt: null }]);
    raw.close();
  });

  it('openCoordDb reaches a database one version before it and keeps its rows', () => {
    expect(SLOT, 'no MIGRATIONS entry creates operator_items').toBeGreaterThanOrEqual(37);
    const db = openCoordDb(plantedBefore('ccrc-mig-ledgers-open-'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(db.prepare('SELECT claimedBy, state FROM runs').all()).toEqual([{ claimedBy: 'lane-a', state: 'working' }]);
    expect(db.prepare('SELECT slug, title FROM programs').all()).toEqual([{ slug: 'prog-a', title: 'Prog A' }]);
    db.close();
  });

  it('the columns and their nullability', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-ledgers-cols-')));
    expect(colsOf(db, 'operator_items')).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['program', 'TEXT', 1, null, 0], ['runId', 'INTEGER', 0, null, 0],
      ['raisedBy', 'TEXT', 1, null, 0], ['kind', 'TEXT', 1, null, 0], ['title', 'TEXT', 1, null, 0],
      ['why', 'TEXT', 1, null, 0], ['how', 'TEXT', 1, null, 0], ['options', 'TEXT', 0, null, 0],
      ['neededBy', 'TEXT', 1, null, 0], ['soonLabel', 'TEXT', 0, null, 0], ['secretSlot', 'TEXT', 0, null, 0],
      ['state', 'TEXT', 1, null, 0], ['answer', 'TEXT', 0, null, 0], ['note', 'TEXT', 0, null, 0],
      ['raisedAt', 'INTEGER', 1, null, 0], ['tickedAt', 'INTEGER', 0, null, 0], ['closedAt', 'INTEGER', 0, null, 0]]);
    expect(colsOf(db, 'operator_item_events')).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['itemId', 'INTEGER', 1, null, 0], ['at', 'INTEGER', 1, null, 0],
      ['act', 'TEXT', 1, null, 0], ['actor', 'TEXT', 1, null, 0], ['note', 'TEXT', 0, null, 0]]);
    expect(colsOf(db, 'programme_modifications')).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['program', 'TEXT', 1, null, 0], ['at', 'INTEGER', 1, null, 0],
      ['text', 'TEXT', 1, null, 0], ['ruling', 'TEXT', 0, null, 0], ['itemId', 'INTEGER', 0, null, 0],
      ['pr', 'INTEGER', 0, null, 0], ['mergedAt', 'INTEGER', 0, null, 0]]);
    const programs = colsOf(db, 'programs');
    expect(programs.slice(-3)).toEqual([
      ['specPath', 'TEXT', 0, null, 0], ['inShort', 'TEXT', 0, null, 0], ['inShortAt', 'INTEGER', 0, null, 0]]);
    db.close();
  });

  it('the item index is on (program, state)', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-ledgers-idx-')));
    const idx = db.prepare("SELECT name FROM pragma_index_list('operator_items')").all() as { name: string }[];
    expect(idx.map((r) => r.name)).toEqual(['operator_items_by_program']);
    const cols = db.prepare("SELECT name FROM pragma_index_info('operator_items_by_program') ORDER BY seqno").all() as
      { name: string }[];
    expect(cols.map((r) => r.name)).toEqual(['program', 'state']);
    db.close();
  });

  it('no SQL check on kind, state or neededBy (the vocabulary is L0’s, not the column’s)', () => {
    expect(SLOT, 'no MIGRATIONS entry creates operator_items').toBeGreaterThanOrEqual(37);
    expect(MIGRATIONS[SLOT - 1] ?? '', 'the entry checks a vocabulary column')
      .not.toMatch(/CHECK\s*\(\s*(kind|state|neededBy|act|actor)\b/);
  });

  it('an older build opening the new version takes the read-as-is rule and boots', () => {
    // A test cannot run an older db.ts. It puts THIS build where an older build stands: the file is one version past
    // COORD_SCHEMA_VERSION. Rule 3 (db.ts) warns, reads as-is and migrates nothing; an older build never names these
    // tables or columns.
    const p = dbPathIn(mkTmp('ccrc-mig-ledgers-older-'));
    const first = openCoordDb(p);
    first.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'Prog A', 1, 'active')");
    first.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 1}`);
    first.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = openCoordDb(p);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/reading it as-is and migrating nothing/);
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION + 1 });
      expect(db.prepare('SELECT slug, state FROM programs').all()).toEqual([{ slug: 'prog-a', state: 'active' }]);
      db.close();
    } finally {
      warn.mockRestore();
    }
  });
});
