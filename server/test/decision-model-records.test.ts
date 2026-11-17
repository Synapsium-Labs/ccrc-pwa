// Overlord W2, the decision-model records and day counts (plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 4), over a real `coord.db` in a fixture home.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { COORD_SCHEMA_VERSION, MIGRATIONS } from '../src/coord/schema.js';
import {
  decisionAskStore, decisionRecordOf, decisionUsage, recordDecision, releaseDecisionReservations, reserveDecisionCalls,
  settleDecisionCalls, type DecisionRecordWrite,
} from '../src/coord/decisionModelStore.js';
import { mkTmp } from './tmpHelpers.js';

const DAY = '2026-11-16';
let file: string;
let db: DatabaseSync;
beforeEach(() => {
  file = path.join(mkTmp('ccrc-decision-records-'), '.ccrc', 'coord.db');
  db = openCoordDb(file);
});

const write = (o: Partial<DecisionRecordWrite> = {}): DecisionRecordWrite => ({
  row: 'relay.method', revision: 'rev-a', modelId: 'model-a', hostKind: 'local', origin: 'http://127.0.0.1:9000',
  stateHash: 'hash-a', lineGen: 0, verdict: 'yes', p: 0.8, band: 'very-likely', ms: 12,
  refs: {}, inline: { part: 'use a map' }, at: 1_000, ...o,
});
const days = (row = 'relay.method') => db.prepare('SELECT serve, maintain, reserved, unavailableMs FROM decision_days WHERE row = ? AND day = ?')
  .get(row, DAY) as { serve: number; maintain: number; reserved: number; unavailableMs: number } | undefined;

describe('decision_records: never asked twice under one key', () => {
  it('a second record under the same key writes nothing and names the first', () => {
    const a = recordDecision(db, write());
    expect(a).toEqual({ recorded: true, id: expect.any(Number) });
    expect(recordDecision(db, write({ verdict: 'no', p: 0.1, band: 'unlikely' }))).toEqual({ recorded: false, id: a.id });
    expect(decisionRecordOf(db, write())).toEqual({ kind: 'record', id: a.id, verdict: 'yes', p: 0.8, band: 'very-likely', ms: 12 });
  });

  it('the same state under a new line, host kind, origin, model or revision records anew', () => {
    const first = recordDecision(db, write());
    const others = [{ lineGen: 3 }, { hostKind: 'zero-retention' as const }, { origin: 'http://127.0.0.1:9001' },
      { modelId: 'model-b' }, { revision: 'rev-b' }, { stateHash: 'hash-b' }];
    const ids = others.map((o) => recordDecision(db, write(o)));
    for (const r of ids) expect(r.recorded).toBe(true);
    expect(new Set([first.id, ...ids.map((r) => r.id)]).size).toBe(7);
  });

  it('a private-state row write with inline set is refused, and with inline null is kept with its refs', () => {
    expect(() => recordDecision(db, write({ row: 'scope.widens', inline: { goals: 'g' } }))).toThrow(/private state/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_records').get()).toEqual({ n: 0 });
    const r = recordDecision(db, write({ row: 'scope.widens', inline: null, refs: { cited: ['msg-7'], goals: 'v3' } }));
    expect(r.recorded).toBe(true);
    expect(db.prepare('SELECT refs, inline FROM decision_records').get()).toEqual({ refs: '{"cited":["msg-7"],"goals":"v3"}', inline: null });
  });

  it('a choice verdict round-trips, and a word out of the vocabulary reads unreadable, never reused', () => {
    recordDecision(db, write({ row: 'programme.pick', verdict: { option: 'programme-b' } }));
    expect(decisionRecordOf(db, write({ row: 'programme.pick' }))).toMatchObject({ kind: 'record', verdict: { option: 'programme-b' } });
    expect(decisionRecordOf(db, write({ row: 'goals.conflict' }))).toEqual({ kind: 'none' });
    db.prepare("UPDATE decision_records SET verdict = 'maybe' WHERE row = 'programme.pick'").run();
    expect(decisionRecordOf(db, write({ row: 'programme.pick' }))).toEqual({ kind: 'unreadable' });
    db.prepare("UPDATE decision_records SET verdict = 'yes', band = 'certain' WHERE row = 'programme.pick'").run();
    expect(decisionRecordOf(db, write({ row: 'programme.pick' }))).toEqual({ kind: 'unreadable' });
  });
});

describe('decision_days: every attempt counted, reserved before it is made', () => {
  it('reserve then settle: reserved returns to 0 and serve or maintain rises by the attempts', () => {
    reserveDecisionCalls(db, ['relay.method', 'goals.conflict'], DAY, 2);
    expect(days()).toEqual({ serve: 0, maintain: 0, reserved: 2, unavailableMs: 0 });
    settleDecisionCalls(db, ['relay.method', 'goals.conflict'], DAY, 'serve', 2, 1, 0);
    expect(days()).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
    expect(days('goals.conflict')).toEqual({ serve: 1, maintain: 0, reserved: 0, unavailableMs: 0 });
    reserveDecisionCalls(db, ['relay.method'], DAY, 2);
    settleDecisionCalls(db, ['relay.method'], DAY, 'maintain', 2, 2, 1800);
    expect(days()).toEqual({ serve: 1, maintain: 2, reserved: 0, unavailableMs: 1800 });
  });

  it('a settle of 0 attempts counts nothing; a failed call attempts count', () => {
    reserveDecisionCalls(db, ['relay.method'], DAY, 2);
    settleDecisionCalls(db, ['relay.method'], DAY, 'serve', 2, 0, 0);
    expect(days()).toEqual({ serve: 0, maintain: 0, reserved: 0, unavailableMs: 0 });
    reserveDecisionCalls(db, ['relay.method'], DAY, 2);
    settleDecisionCalls(db, ['relay.method'], DAY, 'serve', 2, 2, 2000);
    expect(days()).toEqual({ serve: 2, maintain: 0, reserved: 0, unavailableMs: 2000 });
  });

  it('the usage: each row counts, and the fleet total sums every row, reservations included', () => {
    reserveDecisionCalls(db, ['relay.method'], DAY, 2);
    settleDecisionCalls(db, ['goals.conflict'], DAY, 'serve', 0, 5, 0);
    reserveDecisionCalls(db, ['goals.conflict'], '2026-11-15', 9);
    expect(decisionUsage(db, 'relay.method', DAY, 600))
      .toEqual({ measured: true, serve: 0, maintain: 0, reserved: 2, ceiling: 600, fleetTotal: 7 });
    expect(decisionUsage(db, 'scope.widens', DAY, 50))
      .toEqual({ measured: true, serve: 0, maintain: 0, reserved: 0, ceiling: 50, fleetTotal: 7 });
  });

  it('a database whose decision_days read throws answers measured: false, never a bare null', () => {
    db.exec('DROP TABLE decision_days');
    expect(decisionUsage(db, 'relay.method', DAY, 600)).toEqual({ measured: false });
  });

  it('the boot release moves a stale reservation into maintain', () => {
    reserveDecisionCalls(db, ['relay.method'], DAY, 2);
    reserveDecisionCalls(db, ['goals.conflict'], '2026-11-15', 4);
    settleDecisionCalls(db, ['scope.widens'], DAY, 'serve', 0, 3, 0);
    expect(releaseDecisionReservations(db)).toBe(6);
    expect(days()).toEqual({ serve: 0, maintain: 2, reserved: 0, unavailableMs: 0 });
    expect(days('scope.widens')).toEqual({ serve: 3, maintain: 0, reserved: 0, unavailableMs: 0 });
    expect(releaseDecisionReservations(db)).toBe(0);
  });
});

describe('decisionAskStore: the store as the one caller uses it; no method throws', () => {
  it('reserve is one transaction: each row sees the reservation of the row before it', () => {
    const s = decisionAskStore(db);
    const seen: number[] = [];
    const got = s.reserve(DAY, [{ row: 'programme.pick', ceiling: 600 }, { row: 'programme.any', ceiling: 600 }], (_row, u) => {
      if (u.measured) seen.push(u.fleetTotal);
      return true;
    });
    expect(got).toEqual(['programme.pick', 'programme.any']);
    expect(seen).toEqual([0, 2]);
    expect(db.isTransaction).toBe(false);
  });

  it('a row decide refuses is not reserved; a failed transaction is unmeasured and reserves nothing', () => {
    const s = decisionAskStore(db);
    expect(s.reserve(DAY, [{ row: 'relay.method', ceiling: 600 }], () => false)).toEqual([]);
    expect(days()).toBeUndefined();
    db.exec('BEGIN');
    expect(s.reserve(DAY, [{ row: 'relay.method', ceiling: 600 }], () => true)).toBe('unmeasured');
    expect(s.inTransaction()).toBe(true);
    db.exec('ROLLBACK');
    expect(s.inTransaction()).toBe(false);
  });

  it('record, recordOf and settle answer instead of throwing', () => {
    const s = decisionAskStore(db);
    expect(s.record(write())).toMatchObject({ recorded: true });
    expect(s.recordOf(write())).toMatchObject({ kind: 'record' });
    expect(s.settle(DAY, 'serve', ['relay.method'], 0, 1, 0)).toBe(true);
    db.exec('DROP TABLE decision_records; DROP TABLE decision_days');
    expect(s.record(write())).toEqual({ failed: true });
    expect(s.recordOf(write())).toEqual({ kind: 'unreadable' });
    expect(s.settle(DAY, 'serve', ['relay.method'], 0, 1, 0)).toBe(false);
  });
});

describe('the migration', () => {
  it('a database one version back gains the two tables and keeps every row of every older table', () => {
    // This entry's slot, found by its DDL and never hard-coded: a later migration moves it off the end, and whichever of two
    // branches holding one slot lands second renumbers without editing this case. The tables a later entry creates are
    // dropped with this one's, so the database is truly one version back; a later entry this case cannot undo (an ALTER, or an
    // index on an older table) reds here.
    const SLOT = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE decision_records')) + 1;
    const after = MIGRATIONS.slice(SLOT);
    const later = after.flatMap((m) => [...m.matchAll(/CREATE TABLE (\w+)/g)].map((x) => x[1]!));
    for (const m of after) {
      expect(m, 'a later migration this case cannot undo').not.toMatch(/ALTER TABLE/);
      for (const x of m.matchAll(/CREATE (?:UNIQUE )?INDEX \w+ ON (\w+)/g)) expect(later, 'an index on an older table this case cannot undo').toContain(x[1]);
    }
    db.prepare('INSERT INTO response_boots (epoch, bootedAt, buildSha) VALUES (1, 2, NULL)').run();
    const tables = (d: DatabaseSync): string[] => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as
      { name: string }[]).map((t) => t.name);
    const older = tables(db).filter((t) => !t.startsWith('decision_') && !later.includes(t));
    const counts = (d: DatabaseSync) => Object.fromEntries(older.map((t) => [t, (d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n]));
    const before = counts(db);
    expect(before['response_boots']).toBe(1);
    const dropLater = later.map((t) => `DROP TABLE ${t};`).join(' ');
    db.exec(`DROP TABLE decision_records; DROP TABLE decision_days; ${dropLater} PRAGMA user_version = ${SLOT - 1};`);
    db.close();
    const again = openCoordDb(file);
    expect(again.prepare('PRAGMA user_version').get()).toEqual({ user_version: COORD_SCHEMA_VERSION });
    expect(tables(again)).toEqual(expect.arrayContaining(['decision_records', 'decision_days']));
    expect(counts(again)).toEqual(before);
    again.close();
  });
});
