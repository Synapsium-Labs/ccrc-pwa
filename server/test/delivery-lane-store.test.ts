// `claude_build_deliveries` (migration 129, Desktop polish wave 178): one new MIGRATIONS entry holding only that table, and
// `CoordStore`'s three methods as its only writers. The slot is found by its DDL, never hard-coded. Fixture coord.db files only.
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { BUILD_CAPTURE_NOT_SENT_MAP, buildTrustOf } from '../../shared/claudeBuildTrust.js';
import { DELIVERY_RECIPE_VERSION } from '../../shared/deliveryCapture.js';
import { deliveryResultFor } from './deliveryLaneHelpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const CREATE = /CREATE TABLE claude_build_deliveries(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-deliveries-'), '.ccrc', 'coord.db')));

describe('claude_build_deliveries is one new entry', () => {
  it('created once, by an entry that adds that table and nothing else, and claude_builds is not altered', () => {
    expect(SLOT).toBeGreaterThan(1);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /claude_build_deliveries/.test(m))).toBe(false);
    expect(MIGRATIONS[SLOT - 1]).not.toMatch(/claude_builds/);
    const p = path.join(mkTmp('ccrc-mig-deliveries-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${SLOT - 1}`); });
    const names = (): string[] => (raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .all() as unknown as { name: string }[]).map((r) => r.name);
    const had = names();
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(names().filter((n) => !had.includes(n))).toEqual(['claude_build_deliveries']);
    expect(() => raw.prepare("INSERT INTO claude_build_deliveries (build, part) VALUES ('2.1.400', -1)").run()).toThrow();
    raw.prepare("INSERT INTO claude_build_deliveries (build, part) VALUES ('2.1.400', 0)").run();
    expect(() => raw.prepare("INSERT INTO claude_build_deliveries (build, part) VALUES ('2.1.400', 0)").run()).toThrow();
    raw.close();
  });
});

describe('the delivery writers', () => {
  it('a fresh store has no row', () => { expect(store().claudeBuildDeliveries()).toEqual([]); });

  it('recordDelivery upserts the current result for (build, part) and reads it back whole', () => {
    const c = store();
    const r = deliveryResultFor('2.1.320', 1, 'refused');
    expect(c.recordDelivery(r, 50)).toBe(true);
    expect(c.claudeBuildDeliveries()).toEqual([{
      build: '2.1.320', part: 1, version: r.version, word: 'refused', result: r, at: 50, attempts: 0, lastAttemptAt: null, notSent: null,
    }]);
    const again = deliveryResultFor('2.1.320', 1, 'intact');
    c.recordDelivery(again, 60);
    expect(c.claudeBuildDeliveries()).toHaveLength(1);
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ word: 'intact', at: 60 });
  });

  it('an attempt that went out counts one and clears the why; a try that sent nothing stamps the clock, counts none, records why', () => {
    const c = store();
    c.markDeliveryAttempt('2.1.320', 0, 10, 'no-runner');
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 0, lastAttemptAt: 10, notSent: 'no-runner', word: null, result: null });
    c.markDeliveryAttempt('2.1.320', 0, 20, 'sent');
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 20, notSent: null });
    c.markDeliveryAttempt('2.1.320', 0, 30, 'busy');
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 30, notSent: 'busy' });
    expect(Object.keys(BUILD_CAPTURE_NOT_SENT_MAP)).toContain('busy');
    c.markDeliveryAttempt('2.1.320', 0, 40, 'recipe-not-run');
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 40, notSent: 'recipe-not-run' });
    expect(Object.keys(BUILD_CAPTURE_NOT_SENT_MAP), 'build trust\'s vocabulary is unchanged').not.toContain('recipe-not-run');
  });

  it('a result keeps the attempts and the clock, and an attempt keeps a recorded result', () => {
    const c = store();
    c.markDeliveryAttempt('2.1.320', 2, 10, 'sent');
    const r = deliveryResultFor('2.1.320', 2);
    c.recordDelivery(r, 11);
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, lastAttemptAt: 10, result: r });
    c.markDeliveryAttempt('2.1.320', 2, 20, 'sent');
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 2, lastAttemptAt: 20, result: r, word: 'intact' });
  });

  it('a recorded result clears the part\'s last not-sent word: a measured part is not also unmeasured', () => {
    const c = store();
    c.markDeliveryAttempt('2.1.320', 1, 10, 'recipe-not-run');
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ notSent: 'recipe-not-run' });
    c.recordDelivery(deliveryResultFor('2.1.320', 1), 11);
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ notSent: null, word: 'intact', lastAttemptAt: 10 });
  });

  it('a result of the newer recipe replaces an older version\'s row', () => {
    const c = store();
    c.recordDelivery(deliveryResultFor('2.1.320', 0, 'altered', '0123456789abcdef'), 10);
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ version: '0123456789abcdef', word: 'fault' });
    c.recordDelivery(deliveryResultFor('2.1.320', 0), 20);
    expect(c.claudeBuildDeliveries()).toHaveLength(1);
    expect(c.claudeBuildDeliveries()[0]).toMatchObject({ version: DELIVERY_RECIPE_VERSION, word: 'intact', at: 20 });
  });

  it('rows read newest build first, then by part; a stored result the reader refuses reads as a part with none', () => {
    const c = store();
    c.recordDelivery(deliveryResultFor('2.1.310', 1), 1);
    c.recordDelivery(deliveryResultFor('2.1.320', 1), 1);
    c.recordDelivery(deliveryResultFor('2.1.320', 0), 1);
    expect(c.claudeBuildDeliveries().map((r) => `${r.build}:${r.part}`)).toEqual(['2.1.320:0', '2.1.320:1', '2.1.310:1']);
    c.db.prepare("UPDATE claude_build_deliveries SET result = '{\"nope\":1}' WHERE build = '2.1.310'").run();
    expect(c.claudeBuildDeliveries().at(-1)).toMatchObject({ build: '2.1.310', version: null, word: null, result: null, at: null });
  });

  it('a row is read whole or not at all: a version or a word column at odds with its stored result reads as a part with none, and an unknown not-sent word as none', () => {
    const c = store();
    c.recordDelivery(deliveryResultFor('2.1.320', 0), 1);
    c.recordDelivery(deliveryResultFor('2.1.320', 1), 1);
    c.markDeliveryAttempt('2.1.320', 2, 3, 'busy');
    c.db.prepare("UPDATE claude_build_deliveries SET version = '0123456789abcdef' WHERE part = 0").run();
    c.db.prepare("UPDATE claude_build_deliveries SET word = 'refused' WHERE part = 1").run();
    c.db.prepare("UPDATE claude_build_deliveries SET notSent = 'gone-fishing' WHERE part = 2").run();
    const rows = c.claudeBuildDeliveries();
    for (const p of [0, 1]) expect(rows[p]).toMatchObject({ part: p, version: null, word: null, result: null, at: null, attempts: 0 });
    expect(rows[2]).toMatchObject({ part: 2, notSent: null, lastAttemptAt: 3 });
  });

  it('never touches claude_builds', () => {
    const c = store();
    const before = JSON.stringify(c.claudeBuilds());
    c.markDeliveryAttempt('2.1.302', 0, 10, 'sent');
    c.recordDelivery(deliveryResultFor('2.1.302', 0, 'altered'), 11);
    expect(JSON.stringify(c.claudeBuilds())).toBe(before);
    expect(buildTrustOf(c.claudeBuilds(), '2.1.302')).toEqual({ kind: 'trusted', cwd: true });
  });
});
