// `limit_samples` and its store (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 5): one row per account reading, read back by
// account oldest first, pruned strictly before a bound; over a fixture coord.db.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { COORD_SCHEMA_VERSION } from '../src/coord/schema.js';
import type { LimitSample } from '../src/poolRunway.js';
import { limitSamplePass } from '../src/limitSampler.js';
import { parseRoster } from '../../shared/roster.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 2_000_000_000;
let coord: CoordStore;
beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-limit-samples-'), '.ccrc', 'coord.db'))); });

const s = (account: string, ts: number, over: Partial<LimitSample> = {}): LimitSample => ({
  account, ts, five: 40, seven: 20, fiveResetAt: ts + 9_000, sevenResetAt: ts + 300_000, fiveRolled: false, sevenRolled: false,
  fiveWindowMinutes: null, ...over,
});

describe('limit_samples (C57)', () => {
  it('the table and its index exist at this build\'s version', () => {
    const names = coord.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'limit_samples%' ORDER BY name").all() as { name: string }[];
    expect(names.map((n) => n.name)).toEqual(['limit_samples', 'limit_samples_ts']);
    expect((coord.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
  });

  it('a reading inserted twice is one row, and the first beat\'s flags stand', () => {
    expect(coord.insertLimitSamples([s('lane-a', NOW - 60)], NOW)).toBe(1);
    expect(coord.insertLimitSamples([s('lane-a', NOW - 60, { fiveRolled: true, five: 0 })], NOW + 300)).toBe(0);
    expect(coord.limitSamplesSince(['lane-a'], 0)).toEqual([s('lane-a', NOW - 60)]);
    expect(coord.db.prepare('SELECT sampled_at AS at FROM limit_samples').all()).toEqual([{ at: NOW }]);
  });

  it('rows read back by account, oldest first, only for the asked accounts and at or after the bound', () => {
    coord.insertLimitSamples([s('lane-b', NOW - 10), s('lane-a', NOW - 20), s('lane-a', NOW - 300), s('lane-c', NOW - 5),
      s('lane-a', NOW - 900, { five: null, fiveWindowMinutes: 0, sevenRolled: true })], NOW);
    expect(coord.limitSamplesSince(['lane-a', 'lane-b'], NOW - 300).map((r) => [r.account, r.ts]))
      .toEqual([['lane-a', NOW - 300], ['lane-a', NOW - 20], ['lane-b', NOW - 10]]);
    expect(coord.limitSamplesSince(['lane-a'], 0)[0]).toEqual(s('lane-a', NOW - 900, { five: null, fiveWindowMinutes: 0, sevenRolled: true }));
    expect(coord.limitSamplesSince([], 0)).toEqual([]);
  });

  it('prune deletes only rows strictly older than the bound, answering the count', () => {
    coord.insertLimitSamples([s('lane-a', NOW - 100), s('lane-a', NOW - 50), s('lane-b', NOW - 101)], NOW);
    expect(coord.pruneLimitSamples(NOW - 100)).toBe(1);
    expect(coord.limitSamplesSince(['lane-a', 'lane-b'], 0).map((r) => r.ts)).toEqual([NOW - 100, NOW - 50]);
  });

  it('a second sampler pass over the same reading adds no row (plan Task 6)', () => {
    const roster = parseRoster({ version: 1, accounts: [
      { id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] });
    const limits = { 'lane-a': { five: 40, seven: 20, ts: NOW - 30, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000,
      fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false } };
    expect(limitSamplePass(coord, limits, roster, NOW).inserted).toBe(1);
    expect(limitSamplePass(coord, limits, roster, NOW + 300).inserted).toBe(0);
    expect(coord.limitSamplesSince(['lane-a'], 0)).toHaveLength(1);
  });

  it('an empty insert writes nothing', () => {
    expect(coord.insertLimitSamples([], NOW)).toBe(0);
  });
});

describe('the migration (the plan\'s F15)', () => {
  const versionOf = (db: { prepare(sql: string): { get(): unknown } }): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  it('a file at the version before this one is migrated, never opened empty, and gains the table and its index', () => {
    const file = path.join(mkTmp('ccrc-limit-samples-up-'), '.ccrc', 'coord.db');
    const first = openCoordDb(file);
    first.exec("CREATE TABLE kept_fixture (x TEXT); INSERT INTO kept_fixture VALUES ('kept')");
    first.exec('DROP TABLE limit_samples');
    first.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION - 1}`);
    first.close();
    const db = openCoordDb(file);
    expect(versionOf(db)).toBe(COORD_SCHEMA_VERSION);
    expect((db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'limit_samples%' ORDER BY name").all() as { name: string }[]).map((n) => n.name))
      .toEqual(['limit_samples', 'limit_samples_ts']);
    expect(db.prepare('SELECT x FROM kept_fixture').all()).toEqual([{ x: 'kept' }]);
    db.close();
  });
  it('a file at a higher version than this build opens as it is, with the build\'s warning, and its samples read', () => {
    const file = path.join(mkTmp('ccrc-limit-samples-hi-'), '.ccrc', 'coord.db');
    const first = new CoordStore(openCoordDb(file));
    first.insertLimitSamples([s('lane-a', NOW - 60)], NOW);
    first.db.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 1}`);
    first.db.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const again = new CoordStore(openCoordDb(file));
      expect(versionOf(again.db)).toBe(COORD_SCHEMA_VERSION + 1);
      expect(again.limitSamplesSince(['lane-a'], 0)).toEqual([s('lane-a', NOW - 60)]);
      expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes(`is at schema ${COORD_SCHEMA_VERSION + 1}, this build knows ${COORD_SCHEMA_VERSION}`))).toBe(true);
      again.db.close();
    } finally { warn.mockRestore(); }
  });
});
