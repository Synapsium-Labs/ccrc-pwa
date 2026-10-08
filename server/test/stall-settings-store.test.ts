// Stall watch settings W1 (design 2026-10-05 §8, §11, §17): the settings row's migration and seed, its read and its
// write, and the notice-count read's window and plan. Fixture coord.db only (mkTmp), never a live one.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseStallSettings, stallSettingsAfter } from '../src/coord/stallsettings.js';
import type { StallSettingsPatch, StallSettingsRead } from '../src/coord/stallsettings.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const MIN = 60_000;
const H = 60 * MIN;
const AT = Date.parse('2026-10-05T18:00:00Z');

/** A store on a fresh fixture database, and the database's path, for a second connection. */
const opened = (): { s: CoordStore; file: string } => {
  const file = path.join(mkTmp('ccrc-stall-settings-store-'), 'coord.db');
  return { s: new CoordStore(openCoordDb(file)), file };
};
const store = (): CoordStore => opened().s;
/** The row exactly as SQLite holds it, read without the store, every INTEGER as a bigint. */
const rawRow = (s: CoordStore): unknown => {
  const st = s.db.prepare('SELECT id, level, quietMs, updatedAt FROM stall_settings');
  st.setReadBigInts(true);
  return st.all();
};
const rowRead = (level: unknown, quietMs: unknown, updatedAt: unknown): StallSettingsRead =>
  ({ kind: 'row', row: { level, quietMs, updatedAt } });

describe('the migration: one seeded row that is today\'s behaviour (M12)', () => {
  it('a fresh database holds exactly one row: follow, NULL, 0', () => {
    expect(rawRow(store())).toEqual([{ id: 1n, level: 'follow', quietMs: null, updatedAt: 0n }]);
  });

  it('the table has the four columns §8 names, with their nullability and key', () => {
    const s = store();
    const cols = (s.db.prepare('PRAGMA table_info(stall_settings)').all() as
      { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[])
      .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);
    expect(cols).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['level', 'TEXT', 1, null, 0],
      ['quietMs', 'INTEGER', 0, null, 0], ['updatedAt', 'INTEGER', 1, null, 0],
    ]);
  });

  it('is a singleton: a second row is refused by the CHECK', () => {
    const s = store();
    expect(() => s.db.exec("INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (2, 'follow', NULL, 0)"))
      .toThrow(/CHECK constraint failed/);
  });

  it('run_events_by_at indexes run_events on at alone', () => {
    const s = store();
    expect((s.db.prepare('PRAGMA index_info(run_events_by_at)').all() as { name: string }[]).map((r) => r.name))
      .toEqual(['at']);
  });
});

describe('stallSettings: three words, every value as read (M11c)', () => {
  it('reads the seed as a row, every INTEGER a bigint, and parses it as follow with the built-in quiet time', () => {
    const s = store();
    const read = s.stallSettings();
    expect(read).toEqual(rowRead('follow', null, 0n));
    expect(parseStallSettings(read)).toEqual({
      stored: 'row', level: { kind: 'follow' }, quiet: { kind: 'default' }, updatedAt: 0,
    });
  });

  it('reads a lost row as absent', () => {
    const s = store();
    s.db.exec('DELETE FROM stall_settings');
    expect(s.stallSettings()).toEqual({ kind: 'absent' });
  });

  it('reads a missing table as unreadable, with the driver\'s detail, and never throws', () => {
    const s = store();
    s.db.exec('DROP TABLE stall_settings');
    const read = s.stallSettings();
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' ? read.detail : '').toMatch(/no such table: stall_settings/);
  });

  it('an oversize quietMs reads that field unreadable alone: the level is still read', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'check', quietMs = 9223372036854775807, updatedAt = 7");
    const read = s.stallSettings();
    expect(read).toEqual(rowRead('check', 9223372036854775807n, 7n));
    expect(parseStallSettings(read)).toEqual({
      stored: 'row', level: { kind: 'chosen', level: 'check' },
      quiet: { kind: 'unreadable', value: 9223372036854775807n }, updatedAt: 7,
    });
  });

  it('a TEXT updatedAt reads as the string it is, and parses null with both fields still read', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'alert', quietMs = 3600000, updatedAt = 'abc'");
    const read = s.stallSettings();
    expect(read).toEqual(rowRead('alert', 3_600_000n, 'abc'));
    expect(parseStallSettings(read)).toEqual({
      stored: 'row', level: { kind: 'chosen', level: 'alert' }, quiet: { kind: 'set', ms: H }, updatedAt: null,
    });
  });
});

describe('setStallSettings: the update arm, the insert arm and the no-op (§8; M12, M12b, M12c)', () => {
  it('the update arm sets the named field and updatedAt, and keeps the other', () => {
    const s = store();
    const before = s.stallSettings();
    const w = s.setStallSettings({ level: 'check' }, AT, before);
    expect(w).toEqual({ kind: 'written', before: rowRead('follow', null, 0n), after: rowRead('check', null, BigInt(AT)) });
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'check', quietMs: null, updatedAt: BigInt(AT) }]);
  });

  it('M12: the insert arm takes the seed\'s level and quiet time, overridden only by the named field', () => {
    const quietOnly = store();
    quietOnly.db.exec('DELETE FROM stall_settings');
    const w = quietOnly.setStallSettings({ quiet: { kind: 'set', ms: 3 * H } }, AT, quietOnly.stallSettings());
    expect(w).toEqual({ kind: 'written', before: { kind: 'absent' }, after: rowRead('follow', 10_800_000n, BigInt(AT)) });

    const levelOnly = store();
    levelOnly.db.exec('DELETE FROM stall_settings');
    levelOnly.setStallSettings({ level: 'deliver' }, AT, levelOnly.stallSettings());
    expect(rawRow(levelOnly)).toEqual([{ id: 1n, level: 'deliver', quietMs: null, updatedAt: BigInt(AT) }]);
  });

  it('M12c: a quiet-only write keeps an unreadable stored level as it is', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'banana', updatedAt = 5");
    const w = s.setStallSettings({ quiet: { kind: 'set', ms: H } }, AT, s.stallSettings());
    expect(w.kind === 'written' ? w.after : null).toEqual(rowRead('banana', 3_600_000n, BigInt(AT)));
    expect(parseStallSettings(s.stallSettings()).level).toEqual({ kind: 'unreadable', token: 'banana' });
  });

  it.each<[string, StallSettingsPatch]>([
    ['a level and a quiet time', { level: 'alert', quiet: { kind: 'set', ms: H } }],
    ['a quiet time alone, stored as a bigint', { quiet: { kind: 'set', ms: 90 * MIN } }],
    ['the built-in quiet time, stored as NULL', { quiet: { kind: 'default' } }],
    ['a level alone', { level: 'log' }],
  ])('M12b: the same patch twice (%s) moves nothing the second time', (_name, patch) => {
    const s = store();
    s.setStallSettings(patch, AT, s.stallSettings());
    const stored = rawRow(s);
    const again = s.setStallSettings(patch, AT + H, s.stallSettings());
    expect(again.kind).toBe('written');
    if (again.kind !== 'written') return;
    expect(again.after).toEqual(again.before);
    expect(rawRow(s)).toEqual(stored);
  });
});

describe('setStallSettings writes only over the row the route measured (§8; the store half of M27b)', () => {
  it('a level a second connection changed, updatedAt kept, answers conflict with the row it found and writes nothing', () => {
    const { s, file } = opened();
    const expected = s.stallSettings();
    const other = new DatabaseSync(file);
    other.exec("UPDATE stall_settings SET level = 'check'");
    other.close();
    const w = s.setStallSettings({ quiet: { kind: 'set', ms: 2 * H } }, AT, expected);
    expect(w).toEqual({ kind: 'conflict', before: rowRead('check', null, 0n) });
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'check', quietMs: null, updatedAt: 0n }]);
  });

  it('a row lost since the route read answers conflict with absent, and inserts nothing', () => {
    const s = store();
    const expected = s.stallSettings();
    s.db.exec('DELETE FROM stall_settings');
    expect(s.setStallSettings({ level: 'all' }, AT, expected)).toEqual({ kind: 'conflict', before: { kind: 'absent' } });
    expect(rawRow(s)).toEqual([]);
  });

  it('a read that failed once and then succeeded answers conflict, and writes nothing', () => {
    const s = store();
    const failed: StallSettingsRead = { kind: 'unreadable', detail: 'database is locked' };
    expect(s.setStallSettings({ level: 'all' }, AT, failed)).toEqual({ kind: 'conflict', before: rowRead('follow', null, 0n) });
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'follow', quietMs: null, updatedAt: 0n }]);
  });
});

describe('M12d: the projection is the store\'s write', () => {
  const befores: [string, (s: CoordStore) => void][] = [
    ['an absent row', (s) => s.db.exec('DELETE FROM stall_settings')],
    ['the seed row', () => {}],
    ['a row with an unreadable level', (s) => s.db.exec("UPDATE stall_settings SET level = 'banana', quietMs = 1800000, updatedAt = 5")],
    ['a row with an unreadable quiet time', (s) => s.db.exec("UPDATE stall_settings SET level = 'all', quietMs = 7, updatedAt = 5")],
  ];
  const patches: [string, StallSettingsPatch][] = [
    ['a level', { level: 'deliver' }],
    ['a quiet time', { quiet: { kind: 'set', ms: 2 * H } }],
    ['the built-in quiet time', { quiet: { kind: 'default' } }],
    ['both', { level: 'follow', quiet: { kind: 'set', ms: 30 * MIN } }],
  ];
  const cases = befores.flatMap(([b, plant]) => patches.map(([p, patch]) => [b, p, plant, patch] as const));

  it.each(cases)('%s, written with %s: the written after parses equal to the parsed projection', (_b, _p, plant, patch) => {
    const s = store();
    plant(s);
    const before = s.stallSettings();
    const w = s.setStallSettings(patch, AT, before);
    expect(w.kind).toBe('written');
    if (w.kind !== 'written') return;
    expect(w.before).toEqual(before);
    expect(parseStallSettings(w.after)).toEqual(parseStallSettings(stallSettingsAfter(before, patch, AT)));
    expect(w.after).toEqual(s.stallSettings());
  });

  it('a read inside the write that is itself unreadable takes neither arm: the write throws and the row is unchanged', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'alert', updatedAt = 5");
    const unreadable: StallSettingsRead = { kind: 'unreadable', detail: 'disk I/O error' };
    const spy = vi.spyOn(s, 'stallSettings').mockReturnValue(unreadable);
    try {
      expect(() => s.setStallSettings({ level: 'all' }, AT, unreadable)).toThrow(/stall settings unreadable inside the write: disk I\/O error/);
    } finally {
      spy.mockRestore();
    }
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'alert', quietMs: null, updatedAt: 5n }]);
    // The transaction rolled back: the next write opens its own.
    expect(s.setStallSettings({ level: 'all' }, AT, s.stallSettings()).kind).toBe('written');
  });
});

describe('stallObservationsSince: the window, the plan and the failure (§11; M17c, M17d)', () => {
  const SINCE = AT - 48 * H;
  const withRun = (s: CoordStore): void => {
    s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
    s.db.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('p', 1, 1, 'demo', 'working', 'c', 1)");
  };
  const event = (s: CoordStore, at: number | string, detail: string | null): void => {
    s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (1, ?, 'working', 'working', 'operator', ?)")
      .run(at, detail);
  };
  const byAt = (r: ReturnType<CoordStore['stallObservationsSince']>): unknown =>
    r.ok ? [...r.rows].sort((a, b) => a.at - b.at) : r;

  it('M17c: a row at since comes back and a row at since - 1 does not', () => {
    const s = store();
    withRun(s);
    event(s, SINCE - 1, 'stall:quiet:1:a');
    event(s, SINCE, 'stall:quiet:1:b');
    event(s, SINCE + 5, null);
    expect(byAt(s.stallObservationsSince(SINCE))).toEqual([
      { at: SINCE, detail: 'stall:quiet:1:b' }, { at: SINCE + 5, detail: null },
    ]);
  });

  it('M17d: the read plans a SEARCH on run_events_by_at', () => {
    const s = store();
    const spy = vi.spyOn(s.db, 'prepare');
    let sql: string[];
    try { s.stallObservationsSince(SINCE); sql = spy.mock.calls.map((c) => String(c[0])); } finally { spy.mockRestore(); }
    expect(sql).toHaveLength(1);
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${sql[0]}`).all() as { detail: string }[]).map((r) => r.detail);
    expect(plan).toEqual(['SEARCH run_events USING INDEX run_events_by_at (at>?)']);
  });

  it('a thrown statement answers ok: false with its detail, never a throw', () => {
    const s = store();
    s.db.exec('DROP TABLE run_events');
    const r = s.stallObservationsSince(SINCE);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.detail).toMatch(/no such table: run_events/);
  });

  it('an at that is not a positive safe integer refuses the whole read, naming the column and no value', () => {
    const s = store();
    withRun(s);
    event(s, SINCE, 'stall:quiet:1:b');
    event(s, 'abc', 'stall:quiet:1:c');
    expect(s.stallObservationsSince(SINCE)).toEqual({ ok: false, detail: 'run_events at is not a positive safe integer' });
  });
});
