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
import { buildTrustOf } from '../../shared/claudeBuildTrust.js';
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
      build: '2.1.320', source: 'fleet', capture: 'queued', cwd: false, seenAt: 100, attempts: 0, lastAttemptAt: null, notSent: null, verdictAt: null, output: null,
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
});
