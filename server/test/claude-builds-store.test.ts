// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): `claude_builds` is ONE new MIGRATIONS entry (a table
// and its rig seed, nothing else), and `CoordStore`'s five methods are its only writers. The slot is found by its DDL and never
// hard-coded, so a branch that merges second moves up without editing a line here. Fixture coord.db files only.
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { BUILD_CAPTURE_NOT_SENT_MAP, buildTrustOf } from '../../shared/claudeBuildTrust.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const CREATE = /CREATE TABLE claude_builds(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;
const RIG = ['2.1.296', '2.1.300', '2.1.301', '2.1.302'];

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-claude-builds-'), '.ccrc', 'coord.db')));

describe('claude_builds is one new entry, seeded with the rig record (D-8289)', () => {
  it('the slot is found by DDL, created once, never amended into a frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry creates claude_builds').toBeGreaterThanOrEqual(60);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /claude_builds/.test(m))).toBe(false);
  });

  it('the migration adds the table and the four rig rows, passed with the cwd, and nothing else', () => {
    const p = path.join(mkTmp('ccrc-mig-claude-builds-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${SLOT - 1}`); });
    const names = (): string[] => (raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .all() as unknown as { name: string }[]).map((r) => r.name);
    const had = names();
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(names().filter((n) => !had.includes(n))).toEqual(['claude_builds']);
    expect(raw.prepare('SELECT build, source, capture, cwd FROM claude_builds ORDER BY build').all()).toEqual(
      RIG.map((build) => ({ build, source: 'rig', capture: 'pass', cwd: 1 })));
    expect(() => raw.prepare("INSERT INTO claude_builds (build, source, capture, seenAt) VALUES ('2.1.400', 'fleet', 'maybe', 1)").run()).toThrow();
    expect(() => raw.prepare("INSERT INTO claude_builds (build, source, capture, seenAt, notSent) VALUES ('2.1.400', 'fleet', 'queued', 1, 'unanswered')").run()).toThrow();
    raw.close();
  });
});

describe('the record\'s writers (D-8289)', () => {
  it('a fresh store trusts the rig builds and nothing else', () => {
    const c = store();
    expect(c.claudeBuilds().map((r) => r.build)).toEqual([...RIG].reverse());
    for (const b of RIG) expect(buildTrustOf(c.claudeBuilds(), b)).toEqual({ kind: 'trusted', cwd: true });
    expect(buildTrustOf(c.claudeBuilds(), '2.1.299')).toEqual({ kind: 'untrusted', reason: 'not-captured' });
  });

  it('noteClaudeBuildsSeen records each new build once, queued, and leaves an existing row alone', () => {
    const c = store();
    expect(c.noteClaudeBuildsSeen(['2.1.320', '2.1.302'], 100)).toEqual(['2.1.320']);
    expect(c.noteClaudeBuildsSeen(['2.1.320'], 200)).toEqual([]);
    expect(c.claudeBuilds().find((r) => r.build === '2.1.320')).toEqual({
      build: '2.1.320', source: 'fleet', capture: 'queued', cwd: false, seenAt: 100, attempts: 0, lastAttemptAt: null, notSent: null, verdictAt: null, output: null, fails: 0,
    });
    expect(c.claudeBuilds().find((r) => r.build === '2.1.302')?.source).toBe('rig');
  });

  it('a try is stamped only on a queued row, and a verdict lands only on one', () => {
    const c = store();
    c.noteClaudeBuildsSeen(['2.1.320'], 100);
    expect(c.markClaudeBuildAttempt('2.1.302', 150, 'sent')).toBe(false);
    expect(c.markClaudeBuildAttempt('2.1.320', 150, 'sent')).toBe(true);
    expect(c.recordClaudeBuildVerdict({ build: '2.1.320', pass: true, cwd: true, output: 'ok' }, 160)).toBe(true);
    expect(c.recordClaudeBuildVerdict({ build: '2.1.320', pass: false, cwd: false, output: 'late' }, 170)).toBe(false);
    expect(c.recordClaudeBuildVerdict({ build: '2.1.302', pass: false, cwd: false, output: 'x' }, 170)).toBe(false);
    expect(c.claudeBuilds().find((r) => r.build === '2.1.320')).toMatchObject({ capture: 'pass', cwd: true, attempts: 1, lastAttemptAt: 150, verdictAt: 160, output: 'ok' });
    expect(buildTrustOf(c.claudeBuilds(), '2.1.320')).toEqual({ kind: 'trusted', cwd: true });
  });

  it('a try that sent nothing stamps the retry clock and why, and counts no attempt; a job that goes out clears the why', () => {
    const c = store();
    c.noteClaudeBuildsSeen(['2.1.320'], 100);
    expect(c.markClaudeBuildAttempt('2.1.320', 150, 'no-runner')).toBe(true);
    expect(c.claudeBuilds().find((r) => r.build === '2.1.320')).toMatchObject({ attempts: 0, lastAttemptAt: 150, notSent: 'no-runner' });
    expect(c.markClaudeBuildAttempt('2.1.320', 160, 'no-test-box')).toBe(true);
    expect(c.claudeBuilds().find((r) => r.build === '2.1.320')).toMatchObject({ attempts: 0, lastAttemptAt: 160, notSent: 'no-test-box' });
    expect(c.markClaudeBuildAttempt('2.1.320', 170, 'sent')).toBe(true);
    expect(c.claudeBuilds().find((r) => r.build === '2.1.320')).toMatchObject({ attempts: 1, lastAttemptAt: 170, notSent: null });
  });

  it('requeueClaudeBuild re-queues a failed row only: an unknown build and a row without a failure are refused', () => {
    const c = store();
    c.noteClaudeBuildsSeen(['2.1.320'], 100);
    expect(c.requeueClaudeBuild('2.1.320')).toBe('not-failed');
    expect(c.requeueClaudeBuild('2.1.399')).toBe('unknown-build');
    c.markClaudeBuildAttempt('2.1.320', 150, 'sent');
    c.recordClaudeBuildVerdict({ build: '2.1.320', pass: false, cwd: false, output: 'replay: 1 failed' }, 160);
    expect(buildTrustOf(c.claudeBuilds(), '2.1.320')).toEqual({ kind: 'untrusted', reason: 'capture-failed' });
    expect(c.requeueClaudeBuild('2.1.320')).toBe('queued');
    expect(c.claudeBuilds().find((r) => r.build === '2.1.320')).toMatchObject({ capture: 'queued', lastAttemptAt: null, notSent: null, verdictAt: null, output: null, attempts: 1 });
  });

  it('a failed verdict counts one more fails, a pass none, and the automatic re-queue keeps the count (slug capture-retry-ceiling)', () => {
    const c = store();
    c.noteClaudeBuildsSeen(['2.1.320', '2.1.321'], 100);
    const fails = (b: string): number | undefined => c.claudeBuilds().find((r) => r.build === b)?.fails;
    expect(fails('2.1.320')).toBe(0);
    for (let k = 1; k <= 3; k++) {
      expect(c.recordClaudeBuildVerdict({ build: '2.1.320', pass: false, cwd: false, output: 'red' }, 100 + k)).toBe(true);
      expect(fails('2.1.320')).toBe(k);
      expect(c.recordClaudeBuildVerdict({ build: '2.1.320', pass: false, cwd: false, output: 'red' }, 100 + k), 'a verdict never overwrites another').toBe(false);
      expect(fails('2.1.320')).toBe(k);
      expect(c.requeueClaudeBuild('2.1.320', { keepLadder: true })).toBe('queued');
      expect(fails('2.1.320')).toBe(k);
    }
    c.recordClaudeBuildVerdict({ build: '2.1.321', pass: true, cwd: true, output: 'ok' }, 200);
    expect(fails('2.1.321')).toBe(0);
    expect(c.claudeBuilds().filter((r) => r.source === 'rig').map((r) => r.fails)).toEqual([0, 0, 0, 0]);
  });

  it('the operator\'s Capture again restarts the ladder; the automatic retry keeps the count and the last output (review 3234 F6, F12)', () => {
    const c = store();
    c.noteClaudeBuildsSeen(['2.1.320'], 100);
    const row = () => c.claudeBuilds().find((r) => r.build === '2.1.320');
    c.recordClaudeBuildVerdict({ build: '2.1.320', pass: false, cwd: false, output: 'replay: 1 failed' }, 160);
    expect(c.requeueClaudeBuild('2.1.320', { keepLadder: true })).toBe('queued');
    expect(row()).toMatchObject({ capture: 'queued', fails: 1, output: 'replay: 1 failed', verdictAt: 160, lastAttemptAt: null, notSent: null });
    c.recordClaudeBuildVerdict({ build: '2.1.320', pass: false, cwd: false, output: 'replay: 2 failed' }, 170);
    expect(row()).toMatchObject({ capture: 'fail', fails: 2, output: 'replay: 2 failed', verdictAt: 170 });
    expect(c.requeueClaudeBuild('2.1.320')).toBe('queued');
    expect(row()).toMatchObject({ capture: 'queued', fails: 0, output: null, verdictAt: null });
  });
});

const ADD_FAILS = /ALTER TABLE claude_builds ADD COLUMN fails(?![A-Za-z0-9_])/;
const FAILS_SLOT = MIGRATIONS.findIndex((m) => ADD_FAILS.test(m)) + 1;

describe('claude_builds.fails is one more entry: one column and its backfill (slug capture-retry-ceiling)', () => {
  it('the slot is found by its DDL, after the table, once', () => {
    expect(FAILS_SLOT).toBeGreaterThan(SLOT);
    expect(MIGRATIONS.filter((m) => ADD_FAILS.test(m)).length).toBe(1);
  });
  it('a failed row from before the entry counts its one failure; every other row counts none; no table or index is added', () => {
    const p = path.join(mkTmp('ccrc-mig-claude-fails-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < FAILS_SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${FAILS_SLOT - 1}`); });
    raw.exec("INSERT INTO claude_builds (build, source, capture, seenAt, verdictAt, attempts) VALUES ('2.1.320', 'fleet', 'fail', 1, 2, 1), ('2.1.321', 'fleet', 'queued', 1, NULL, 0)");
    const names = (): string[] => (raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .all() as unknown as { name: string }[]).map((r) => r.name).sort();
    const had = names();
    raw.exec(MIGRATIONS[FAILS_SLOT - 1]!);
    expect(names()).toEqual(had);
    expect(raw.prepare("SELECT build, fails FROM claude_builds WHERE source = 'fleet' ORDER BY build").all()).toEqual([
      { build: '2.1.320', fails: 1 }, { build: '2.1.321', fails: 0 },
    ]);
    expect(raw.prepare("SELECT DISTINCT fails FROM claude_builds WHERE source = 'rig'").all()).toEqual([{ fails: 0 }]);
    raw.close();
  });
});

// Capture runner spec 2026-11-22 §2.2, §2.5 Table 6: the not-sent words widen, so `notSent`'s CHECK is rebuilt (SQLite cannot
// alter one). The entry is found by its DDL, never by number, so a branch that lands after another moves up untouched.
describe('the not-sent words widen by a table rebuild (capture runner PR 2)', () => {
  const REBUILD = /CREATE TABLE claude_builds_\d+ \(/;
  const AT = MIGRATIONS.findIndex((m) => REBUILD.test(m)) + 1;
  const COLUMNS = 'build, source, capture, cwd, seenAt, attempts, lastAttemptAt, notSent, verdictAt, output, fails';

  it('rebuilds the table once, after the failed-verdict counter is added', () => {
    expect(AT, 'no entry rebuilds claude_builds').toBeGreaterThan(FAILS_SLOT);
    expect(MIGRATIONS.filter((m) => REBUILD.test(m))).toHaveLength(1);
  });

  it('every row survives as it stood, the rig seed included, and the table is claude_builds again with nothing left beside it', () => {
    const p = path.join(mkTmp('ccrc-mig-claude-builds-rebuild-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < AT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${AT - 1}`); });
    raw.prepare(`INSERT INTO claude_builds (${COLUMNS}) VALUES ('2.1.320', 'fleet', 'queued', 0, 100, 2, 150, 'no-runner', NULL, NULL, 1)`).run();
    raw.prepare(`INSERT INTO claude_builds (${COLUMNS}) VALUES ('2.1.318', 'fleet', 'fail', 0, 90, 3, 140, NULL, 145, 'replay: 1 failed', 2)`).run();
    const before = raw.prepare(`SELECT ${COLUMNS} FROM claude_builds ORDER BY build`).all();
    const names = (): string[] => (raw.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as { name: string }[]).map((r) => r.name);
    const had = names();
    raw.exec(MIGRATIONS[AT - 1]!);
    expect(raw.prepare(`SELECT ${COLUMNS} FROM claude_builds ORDER BY build`).all()).toEqual(before);
    expect(names()).toEqual(had);
    expect(before).toHaveLength(6);
    raw.close();
  });

  it('the CHECK takes each of the nine words and still refuses any other', () => {
    const c = store();
    c.noteClaudeBuildsSeen(['2.1.320'], 100);
    for (const w of Object.keys(BUILD_CAPTURE_NOT_SENT_MAP) as (keyof typeof BUILD_CAPTURE_NOT_SENT_MAP)[]) {
      expect(c.markClaudeBuildAttempt('2.1.320', 200, w), w).toBe(true);
      expect(c.claudeBuilds().find((r) => r.build === '2.1.320'), w).toMatchObject({ attempts: 0, notSent: w, lastAttemptAt: 200 });
    }
    for (const bad of ['unanswered', 'sent', 'copied', 'No-Runner']) {
      expect(() => c.db.prepare(`INSERT INTO claude_builds (build, source, capture, seenAt, notSent) VALUES ('2.1.400', 'fleet', 'queued', 1, '${bad}')`).run(), bad).toThrow();
    }
  });
});
