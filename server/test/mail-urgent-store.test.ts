// The urgent column and its one writer (mid-turn mail PR 2, plan Task 2.2, P1): `mail.urgentAs` holds the sender's role
// for an urgent mail, written once by `insertMail`, null for every other mail; its migration adds the column and a partial
// index over the urgent rows, and leaves every older row not urgent.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb, tx } from '../src/coord/db.js';
import { COORD_SCHEMA_VERSION, MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const store = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-urgent-store-'))));
const MAIL = { fromId: 'lane-a-coordinator', fromUuid: 'u', toId: 'lane-a-worker', runId: null, kind: 'status' as const,
  subject: 's', body: 'b', artifacts: [] as string[] };
const urgentAsOf = (s: CoordStore, id: number): unknown =>
  (s.db.prepare('SELECT urgentAs FROM mail WHERE id = ?').get(id) as { urgentAs: unknown }).urgentAs;

/** The entry that adds `urgentAs`, found by its DDL, so a renumber at merge moves nothing here. */
const SLOT = MIGRATIONS.findIndex((m) => m.includes('ADD COLUMN urgentAs')) + 1;

describe('mail.urgentAs (plan Task 2.2)', () => {
  it('insertMail stores the role it is given, and null without one', () => {
    const s = store();
    const coordinator = s.insertMail({ ...MAIL, urgentAs: 'coordinator' });
    const overlord = s.insertMail({ ...MAIL, urgentAs: 'overlord' });
    const plain = s.insertMail(MAIL);
    const explicitNull = s.insertMail({ ...MAIL, urgentAs: null });
    expect(urgentAsOf(s, coordinator.id)).toBe('coordinator');
    expect(urgentAsOf(s, overlord.id)).toBe('overlord');
    expect(urgentAsOf(s, plain.id)).toBeNull();
    expect(urgentAsOf(s, explicitNull.id)).toBeNull();
  });

  it('the column refuses a word outside the two roles', () => {
    const s = store();
    const { id } = s.insertMail(MAIL);
    expect(() => s.db.prepare("UPDATE mail SET urgentAs = 'operator' WHERE id = ?").run(id)).toThrow(/CHECK/);
  });

  it('a database at the previous version gains the column, null on every old row, and the partial index', () => {
    expect(SLOT, 'no MIGRATIONS entry adds mail.urgentAs').toBeGreaterThan(0);
    // Its own slot, pinned by number as plan-ticket-done pins 106: a later migration follows it (Overlord W1 gates B took 109).
    expect(SLOT).toBe(108);
    const p = dbPathIn(mkTmp('ccrc-urgent-mig-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) " +
               "VALUES (5, 'lane-a-coordinator', 'u', 'lane-a-worker', NULL, 'status', 's', 'x')");
    });
    raw.close();
    const db = openCoordDb(p);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(db.prepare('SELECT urgentAs FROM mail').all()).toEqual([{ urgentAs: null }]);
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'mail_urgent'").get() as
      { sql: string } | undefined;
    expect(index?.sql).toMatch(/ON mail\s*\(urgentAs\)\s*WHERE urgentAs IS NOT NULL/);
    db.close();
  });

  it('has one writer in server/src: the INSERT in insertMail', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(path.join(ROOT, 'server/src'));
    const WRITE = /INSERT INTO mail\s*\([^)]*\burgentAs\b|UPDATE mail\s+SET[^;`']*\burgentAs\b/g;
    expect('INSERT INTO mail (at, urgentAs) VALUES'.match(WRITE), 'CONTROL: the pattern sees an insert').not.toBeNull();
    const hits = files.flatMap((f) => (readFileSync(f, 'utf8').match(WRITE) ?? []).map(() => path.relative(ROOT, f)));
    expect(hits).toEqual(['server/src/coord/store.ts']);
  });
});
