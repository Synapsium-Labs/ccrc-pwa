// Landing order wave 5g (Task 1): the landing_intents migration, ONE new MIGRATIONS entry found by its DDL.
// Fixture coord.db files only.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const SLOT = MIGRATIONS.findIndex((m) => /CREATE TABLE landing_intents(?![A-Za-z0-9_])/.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
type Col = { name: string; type: string; notnull: number; pk: number };

describe('landing_intents is one new entry (landing order wave 5g)', () => {
  it('the slot is found by DDL, created once, and no earlier entry names the table', () => {
    expect(SLOT).toBeGreaterThan(0);
    expect(MIGRATIONS.filter((m) => /CREATE TABLE landing_intents(?![A-Za-z0-9_])/.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /landing_intents/.test(m))).toBe(false);
  });

  it('creates the table, its key and its index', () => {
    const p = dbPathIn(mkTmp('ccrc-mig-5g-shape-'));
    const db = openCoordDb(p);
    const cols = db.prepare('PRAGMA table_info(landing_intents)').all() as unknown as Col[];
    expect(cols.map((c) => c.name)).toEqual(['runId', 'project', 'key', 'setBy', 'takenAt']);
    expect(cols.filter((c) => c.notnull === 0).map((c) => c.name)).toEqual(['setBy']);
    expect(cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)).toEqual(['runId', 'key']);
    const fks = db.prepare('PRAGMA foreign_key_list(landing_intents)').all() as unknown as { table: string; from: string; to: string }[];
    expect(fks.map((f) => `${f.from}->${f.table}.${f.to}`)).toEqual(['runId->runs.id']);
    const ix = db.prepare("PRAGMA index_info(landing_intents_by_key)").all() as unknown as { name: string }[];
    expect(ix.map((i) => i.name)).toEqual(['project', 'key']);
    db.close();
  });

  it('a file one version before migrates to the new one with its rows intact', () => {
    const p = dbPathIn(mkTmp('ccrc-mig-5g-up-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 't', 1, 'active')");
      raw.exec("INSERT INTO runs (program, wave, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 'project-a', 'planned', 'lane-a', 1)");
    });
    raw.close();
    const db = openCoordDb(p);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(db.prepare('SELECT program, project FROM runs').all()).toEqual([{ program: 'prog-a', project: 'project-a' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM landing_intents').get()).toEqual({ n: 0 });
    db.close();
  });
});
