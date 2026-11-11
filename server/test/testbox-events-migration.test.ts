// Test box connect plan TC12 (spec §2.10, D-8166): `testbox_events` is ONE new MIGRATIONS entry that adds a table, an index
// and nothing else. The slot is found by its DDL and never hard-coded, so a branch that merges second moves up without editing
// a line here. Fixture coord.db files only.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { actorOf } from '../src/accounts/audit.js';
import { TestboxAudit, TESTBOX_AUDIT_RETENTION_DAYS } from '../src/testboxAudit.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const CREATE = /CREATE TABLE testbox_events(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const DAY_MS = 86_400_000;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const objectNames = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all() as
    unknown as { name: string }[]).map((r) => r.name);

/** A database at exactly the version before this entry. */
const plantedBefore = (prefix: string): string => {
  const p = dbPathIn(mkTmp(prefix));
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
  });
  raw.close();
  return p;
};

describe('testbox_events is one new entry (spec §2.10, D-8166)', () => {
  it('the slot is found by DDL, created once, never amended into a frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry creates testbox_events').toBeGreaterThanOrEqual(52);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /testbox_events/.test(m))).toBe(false);
  });

  it('the migration adds testbox_events and nothing else', () => {
    const raw = new DatabaseSync(plantedBefore('ccrc-mig-testbox-events-'));
    const had = objectNames(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(objectNames(raw).filter((n) => !had.includes(n)).sort()).toEqual(['testbox_events', 'testbox_events_by_at']);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM testbox_events').get()).toEqual({ n: 0 });
    const cols = (raw.prepare('PRAGMA table_info(testbox_events)').all() as unknown as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'at', 'actor', 'act', 'actId', 'outcome', 'code', 'fingerprint', 'fleetIdentity']);
    // The outcome is closed in the table itself, and an act id is unique.
    const ins = (outcome: string, actId: string | null): void => {
      raw.prepare('INSERT INTO testbox_events (at, actor, act, actId, outcome) VALUES (1, ?, ?, ?, ?)').run('a 00000000', 'connect', actId, outcome);
    };
    expect(() => ins('maybe', null)).toThrow();
    ins('ok', 'a'.repeat(32));
    expect(() => ins('ok', 'a'.repeat(32))).toThrow();
    ins('ok', null);
    ins('ok', null);
    raw.close();
  });

  it('an older build opens the file at the new version', () => {
    const p = plantedBefore('ccrc-mig-testbox-older-');
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    db.close();
    // The same file at the new version is opened again by this build without a second run of the entry.
    const again = openCoordDb(p);
    expect((again.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    again.close();
  });

  it('rows older than 365 days are swept, and a row of 364 days is kept', () => {
    expect(TESTBOX_AUDIT_RETENTION_DAYS).toBe(365);
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig-testbox-sweep-')));
    const audit = new TestboxAudit(db, () => 400 * DAY_MS);
    const actor = actorOf('a test phone', 'ab'.repeat(32));
    const put = (at: number): void => {
      db.prepare('INSERT INTO testbox_events (at, actor, act, outcome) VALUES (?, ?, ?, ?)').run(at, actor.toString(), 'connect', 'ok');
    };
    const now = 400 * DAY_MS;
    put(now - 366 * DAY_MS);
    put(now - 364 * DAY_MS);
    expect(audit.sweep(now)).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM testbox_events').get() as { n: number }).n).toBe(1);
    db.close();
  });
});
