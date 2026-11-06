// D-8068 (the ruling of 2026-11-06 on D-7214): the server says a run had a child. Migration 41's column, the store's two
// writes and the read that puts it on the wire, over fixture coord.db files only. The entry's slot is found by its DDL
// and never hard-coded, so a branch that takes the slot first moves this one up without editing a line here. Dispatch's
// write is pinned in dispatch-child-argv.test.ts, and what the board does with the answer in
// pwa/test/w7-cold-runs-children.test.tsx.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const ADD = /ALTER TABLE runs ADD COLUMN hadChild\b/;
const SLOT = MIGRATIONS.findIndex((m) => ADD.test(m)) + 1;

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-had-child-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string): number => {
  const r = s.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'coord-a' });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const wire = (s: CoordStore, id: number): boolean => {
  const r = s.run(id);
  if (!r.ok || r.run === null) throw new Error('fixture run unreadable');
  return toRunSummary(r.run).hadChild;
};

/** A database at exactly the version before this entry, with `plant` run inside the same transaction. */
const plantedBefore = (plant: (raw: DatabaseSync) => void): string => {
  const p = path.join(mkTmp('ccrc-mig-had-child-'), '.ccrc', 'coord.db');
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
    plant(raw);
  });
  raw.close();
  return p;
};
const runRow = (raw: DatabaseSync, id: number, sessionId: string | null, dispatchStartedAt: number | null): void => {
  raw.prepare(
    "INSERT INTO runs (id, program, wave, waveOf, project, sessionId, state, claimedBy, openedAt, dispatchStartedAt, closedAt) " +
    "VALUES (?, 'p', ?, NULL, 'demo', ?, 'done', 'c', 1, ?, 2)",
  ).run(id, id, sessionId, dispatchStartedAt);
};

describe('migration 41: a row stored before the field reads through a backfill, never as a flat false', () => {
  const planted = (): CoordStore => new CoordStore(openCoordDb(plantedBefore((raw) => {
    runRow(raw, 1, 'child-a', 10);          // a fresh spawn: marked
    runRow(raw, 2, 'child-a', null);        // the wave resumed on it: mark names run 1, the row is bound
    runRow(raw, 3, 'unmarked-b', 10);       // a spawn sent without --child, journalled
    raw.exec("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) " +
             "VALUES (3, 1, 'planned', 'planned', 'coordinator', 'child-omitted:no-child-argv-cap')");
    runRow(raw, 4, 'manual-c', null);       // a run opened on a manual workspace: no dispatch ever spawned
    runRow(raw, 5, null, 10);               // a dispatch that never bound
  })));

  it('the entry is one additive column and its backfill, past every frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry adds runs.hadChild').toBeGreaterThanOrEqual(41);
    expect(MIGRATIONS.filter((m) => ADD.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => m.includes('hadChild')), 'amended into a frozen entry').toBe(false);
  });

  it('openCoordDb reaches it from one version before, and each stored row reads as its evidence says', () => {
    const s = planted();
    expect(s.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect([1, 2, 3, 4, 5].map((id) => [id, wire(s, id)])).toEqual([[1, true], [2, true], [3, false], [4, false], [5, false]]);
  });

  it('a row the journal says was spawned without --child is not lifted by a sibling, nor is one with no spawn', () => {
    const s = planted();
    const col = (id: number): unknown => (s.db.prepare('SELECT hadChild FROM runs WHERE id = ?').get(id) as { hadChild: number }).hadChild;
    expect([col(3), col(4)]).toEqual([0, 0]);
  });

  it('an older build\'s INSERT, which names no such column, stores 0 (the rollback shape)', () => {
    const s = store();
    s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('old', 'Old', 1, 'active')");
    s.db.exec("INSERT INTO runs (program, wave, project, state, claimedBy, openedAt) VALUES ('old', 1, 'demo', 'working', 'c', 1)");
    expect(s.db.prepare("SELECT hadChild FROM runs WHERE program = 'old'").get()).toEqual({ hadChild: 0 });
  });
});

describe('the store: what a run had, on the wire', () => {
  it('a run nobody asked a child for reads false, bound or not', () => {
    const s = store();
    const id = open(s, 'p1');
    expect(wire(s, id)).toBe(false);
    s.setSession(id, 'manual-a');
    expect(wire(s, id)).toBe(false);
  });

  it('asked for and not bound says nothing; bound says true; the answer outlives the close', () => {
    const s = store();
    const id = open(s, 'p1');
    s.markHadChild(id);
    expect(wire(s, id), 'no session: nothing was held').toBe(false);
    s.setSession(id, 'child-a', 5);
    expect(wire(s, id)).toBe(true);
    s.db.prepare("UPDATE runs SET state = 'done', closedAt = 9 WHERE id = ?").run(id);
    expect(wire(s, id)).toBe(true);
  });

  it('a later wave bound to the child had it too; a later wave bound to another session did not', () => {
    const s = store();
    const first = open(s, 'p1');
    s.markHadChild(first);
    s.setSession(first, 'child-a', 5);
    const handed = open(s, 'p2');
    s.setSession(handed, 'child-a');
    expect(wire(s, handed)).toBe(true);
    const other = open(s, 'p3');
    s.setSession(other, 'manual-b');
    expect(wire(s, other)).toBe(false);
  });

  it('a run whose session is emptied has no child to wait for', () => {
    const s = store();
    const id = open(s, 'p1');
    s.markHadChild(id);
    s.setSession(id, 'child-a', 5);
    s.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(id);
    expect(wire(s, id)).toBe(false);
  });

  it('it rides every emitter: the row list carries it, and it is not stripped with the server-only columns', () => {
    const s = store();
    const id = open(s, 'p1');
    s.markHadChild(id);
    s.setSession(id, 'child-a', 5);
    const all = s.runs({ includeClosed: true });
    if (!all.ok) throw new Error('fixture runs unreadable');
    expect(all.runs.map(toRunSummary).find((r) => r.id === id)).toMatchObject({ id, hadChild: true });
  });
});
