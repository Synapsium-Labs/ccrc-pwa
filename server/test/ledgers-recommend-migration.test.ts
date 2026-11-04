// Programme ledgers (plan PL9, spec §3.2, D24): a decide item's recommendation is two nullable columns on `operator_items`,
// added by ONE new MIGRATIONS entry. The slot is found by its DDL and never hard-coded, so a branch that merges second
// moves up without editing a line here. An item raised before the entry reads NULL for both, which the console draws as
// it did before. Fixture coord.db files only; neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const ADD = /ALTER TABLE operator_items ADD COLUMN recommended\b/;
const SLOT = MIGRATIONS.findIndex((m) => ADD.test(m)) + 1;
/** The PL2 entry that creates the table: the recommendation must come after it. */
const CREATE_SLOT = MIGRATIONS.findIndex((m) => /CREATE TABLE operator_items(?![A-Za-z0-9_])/.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');

/** A database at exactly the version before this entry, holding one decide item raised before the rule. */
const plantedBefore = (prefix: string): string => {
  const p = dbPathIn(mkTmp(prefix));
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    raw.exec("INSERT INTO operator_items (program, runId, raisedBy, kind, title, why, how, options, neededBy, state, raisedAt) " +
             "VALUES ('prog-a', NULL, 'lane-a', 'decide', 'Pick one', 'Because.', '[]', '[\"yes\",\"no\"]', 'soon', 'open', 1)");
  });
  raw.close();
  return p;
};

describe('a decide item’s recommendation is one new entry of two nullable columns (plan PL9)', () => {
  it('the slot is found by DDL, after the entry that creates the table, added once and never amended into a frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry adds operator_items.recommended').toBeGreaterThan(CREATE_SLOT);
    expect(CREATE_SLOT).toBeGreaterThanOrEqual(37);
    expect(MIGRATIONS.filter((m) => ADD.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /recommended/.test(m))).toBe(false);
  });

  it('the entry adds exactly the two columns, nullable with no default, and nothing else', () => {
    expect(SLOT).toBeGreaterThan(CREATE_SLOT);
    const raw = new DatabaseSync(plantedBefore('ccrc-mig-recommend-'));
    const cols = (): string[] => (raw.prepare('PRAGMA table_info(operator_items)').all() as { name: string }[]).map((c) => c.name);
    const objects = (): string[] => (raw.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    const hadCols = cols();
    const hadObjects = objects();
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(cols().filter((c) => !hadCols.includes(c))).toEqual(['recommended', 'recommendedWhy']);
    expect(objects()).toEqual(hadObjects);
    const info = (raw.prepare('PRAGMA table_info(operator_items)').all() as { name: string; type: string; notnull: number; dflt_value: unknown }[])
      .filter((c) => c.name.startsWith('recommended')).map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
    expect(info).toEqual([['recommended', 'INTEGER', 0, null], ['recommendedWhy', 'TEXT', 0, null]]);
    raw.close();
  });

  it('openCoordDb reaches a database one version before it, and the item raised before the rule reads null for both', () => {
    expect(SLOT).toBeGreaterThan(CREATE_SLOT);
    const db = openCoordDb(plantedBefore('ccrc-mig-recommend-open-'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    const store = new CoordStore(db);
    expect(store.itemById(1)).toMatchObject({ kind: 'decide', options: ['yes', 'no'], recommended: null, recommendedWhy: null });
    db.close();
  });
});
