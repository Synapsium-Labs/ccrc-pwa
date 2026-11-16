// Landing order wave 5f: the authority overlay's migration. ONE new MIGRATIONS entry (found by its DDL, never by a
// hard-coded slot) creates `landing_subjects`, `landing_authority`, `landing_journal_cursor` (seeded `(1,0)` and nothing
// else), `landing_projection_witness` (empty) and adds `landing_entries.quarantineKind`. It seeds no subject or
// authority from existing landing rows. Migration 35's entry (landing_entries) stays byte-frozen, pinned by content.
// Fixture coord.db files only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const SLOT = MIGRATIONS.findIndex((m) => /CREATE TABLE landing_subjects(?![A-Za-z0-9_])/.test(m)) + 1;
const LANDING_SLOT = MIGRATIONS.findIndex((m) => /CREATE TABLE landing_entries(?![A-Za-z0-9_])/.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const HEX = 'a'.repeat(40);
const CLAIM = JSON.stringify({ at: 5, setBy: 'lane-a', pinnedSha: HEX, handoffCommit: HEX });
const names = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'").all() as unknown as { name: string }[]).map((r) => r.name);
const n = (db: DatabaseSync, t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
/** A database one version before the entry, carrying a landing row that the migration must not turn into a subject. */
const plantedBefore = (prefix: string): string => {
  const p = dbPathIn(mkTmp(prefix));
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    raw.exec("INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, afterIds, fixesMain, setBy, pinnedAt) " +
      `VALUES ('project-a', 7, '${HEX}', '${HEX}', NULL, 'pinned', '[]', 1, 'lane-a', 1)`);
  });
  raw.close();
  return p;
};
const fresh = (prefix: string): DatabaseSync => openCoordDb(dbPathIn(mkTmp(prefix)));
const refuses = (db: DatabaseSync, sql: string, why: string): void => {
  expect(() => db.exec(sql), why).toThrow(/CHECK constraint failed|FOREIGN KEY|UNIQUE|NOT NULL|datatype mismatch/);
};

const subj = (over: Record<string, string>): string => {
  const v = { id: '1', project: "'project-a'", pr: '1', bindingKind: "'no-run'", observedRunId: 'NULL', observedSeq: '1',
    creationSeq: 'NULL', creationClaim: 'NULL', ...over };
  return `INSERT INTO landing_subjects (${Object.keys(v).join(',')}) VALUES (${Object.values(v).join(',')})`;
};
const auth = (over: Record<string, string>): string => {
  const v = { subjectId: '1', afterIds: "'[]'", fixesMain: '0', setBy: "'lane-a'", seq: '1', ...over };
  return `INSERT INTO landing_authority (${Object.keys(v).join(',')}) VALUES (${Object.values(v).join(',')})`;
};
const wit = (over: Record<string, string>): string => {
  const v = { entryId: '1', project: "'project-a'", pr: '7', observedSeq: '0', runId: '3', pinnedSha: `'${HEX}'`, handoffCommit: `'${HEX}'`, ...over };
  return `INSERT INTO landing_projection_witness (${Object.keys(v).join(',')}) VALUES (${Object.values(v).join(',')})`;
};

describe('the authority overlay is one new entry (landing order wave 5f)', () => {
  it('the slot is found by DDL, created once, and the 5e entry is unchanged', () => {
    expect(SLOT).toBeGreaterThan(LANDING_SLOT);
    expect(MIGRATIONS.filter((m) => /CREATE TABLE landing_subjects(?![A-Za-z0-9_])/.test(m)).length).toBe(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /landing_(subjects|authority|journal_cursor|projection_witness)|quarantineKind/.test(m))).toBe(false);
    // The entry that creates landing_entries pinned by content: its tables, columns and index, and nothing of 5f.
    const entry = MIGRATIONS[LANDING_SLOT - 1]!;
    expect(entry).toMatch(/CREATE TABLE landing_entries \(\s+id\s+INTEGER PRIMARY KEY,\s+project\s+TEXT\s+NOT NULL,\s+pr\s+INTEGER NOT NULL,/);
    expect(entry).toMatch(/CREATE INDEX landing_entries_run ON landing_entries\(runId\);/);
    expect(entry).toMatch(/CREATE TABLE landing_projects \(/);
    expect(entry).not.toMatch(/quarantineKind|landing_subjects|landing_authority/);
    expect((entry.match(/CREATE TABLE/g) ?? []).length).toBe(2);
  });

  it('the entry alone adds the four tables and the column, seeding only the cursor', () => {
    const raw = new DatabaseSync(plantedBefore('ccrc-mig-5f-'));
    const had = names(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(names(raw).filter((x) => !had.includes(x)).sort()).toEqual(
      ['landing_authority', 'landing_journal_cursor', 'landing_projection_witness', 'landing_subjects']);
    expect(raw.prepare('SELECT id, appliedSeq FROM landing_journal_cursor').all()).toEqual([{ id: 1, appliedSeq: 0 }]);
    expect(n(raw, 'landing_subjects')).toBe(0);
    expect(n(raw, 'landing_authority')).toBe(0);
    expect(n(raw, 'landing_projection_witness')).toBe(0);
    const cols = raw.prepare('PRAGMA table_info(landing_entries)').all() as unknown as { name: string; type: string; notnull: number; dflt_value: unknown }[];
    expect(cols.find((c) => c.name === 'quarantineKind')).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: 'NULL' });
    expect(raw.prepare('SELECT quarantineKind FROM landing_entries').all()).toEqual([{ quarantineKind: null }]);
    raw.close();
  });

  it('upgrade from the previous version keeps the landing row and seeds no subject or authority from it', () => {
    const db = openCoordDb(plantedBefore('ccrc-mig-5f-up-'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(db.prepare('SELECT project, pr, fixesMain FROM landing_entries').all()).toEqual([{ project: 'project-a', pr: 7, fixesMain: 1 }]);
    expect(n(db, 'landing_subjects')).toBe(0);
    expect(n(db, 'landing_authority')).toBe(0);
    expect(n(db, 'landing_projection_witness')).toBe(0);
    expect(db.prepare('SELECT appliedSeq FROM landing_journal_cursor').all()).toEqual([{ appliedSeq: 0 }]);
    db.close();
  });

  it('a fresh open and a reopen leave the same shape', () => {
    const p = dbPathIn(mkTmp('ccrc-mig-5f-fresh-'));
    const a = openCoordDb(p);
    expect(n(a, 'landing_journal_cursor')).toBe(1);
    a.exec(subj({}));
    a.close();
    const b = openCoordDb(p);
    expect(n(b, 'landing_journal_cursor')).toBe(1);
    expect(n(b, 'landing_subjects')).toBe(1);
    expect(b.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    b.close();
  });

  it('an older build opening the new version takes the read-as-is rule and boots', () => {
    const p = dbPathIn(mkTmp('ccrc-mig-5f-older-'));
    const first = openCoordDb(p);
    first.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 1}`);
    first.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = openCoordDb(p);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/reading it as-is and migrating nothing/);
      db.close();
    } finally { warn.mockRestore(); }
  });
});

describe('landing_subjects constraints', () => {
  const MAX = '9007199254740991';
  it('accepts a good row, a run row and a target-only row', () => {
    const db = fresh('ccrc-mig-5f-s-ok-');
    db.exec(subj({}));
    db.exec(subj({ id: '2', pr: '2', bindingKind: "'run'", observedRunId: '4', creationSeq: '1', creationClaim: `'${CLAIM}'` }));
    db.exec(subj({ id: MAX, pr: MAX, observedSeq: MAX }));
    expect(n(db, 'landing_subjects')).toBe(3);
    db.close();
  });
  it.each([
    ['pr 0', { pr: '0' }], ['pr past the safe range', { pr: '9007199254740992' }],
    ['empty project', { project: "''" }], ['untrimmed project', { project: "' project-a'" }], ['blank project', { project: "'  '" }], ['null project', { project: 'NULL' }],
    ['unknown bindingKind', { bindingKind: "'maybe'" }],
    ['run without observedRunId', { bindingKind: "'run'" }], ['no-run with observedRunId', { observedRunId: '3' }],
    ['observedRunId 0', { bindingKind: "'run'", observedRunId: '0' }], ['observedRunId past safe', { bindingKind: "'run'", observedRunId: '9007199254740992' }],
    ['observedSeq 0', { observedSeq: '0' }], ['observedSeq past safe', { observedSeq: '9007199254740992' }], ['observedSeq real', { observedSeq: '1.5' }],
    ['creationSeq without claim', { creationSeq: '1' }], ['claim without creationSeq', { creationClaim: `'${CLAIM}'` }],
    ['creationSeq above observedSeq', { creationSeq: '2', creationClaim: `'${CLAIM}'` }],
    ['creationSeq 0', { creationSeq: '0', creationClaim: `'${CLAIM}'` }],
    ['claim not JSON', { creationSeq: '1', creationClaim: "'{'" }],
    ['claim an array', { creationSeq: '1', creationClaim: "'[]'" }],
    ['claim at negative', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: -1, setBy: 'a', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim at real', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1.5, setBy: 'a', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim setBy blank', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: ' ', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim setBy untrimmed', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: 'a ', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim setBy missing', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim pinnedSha uppercase', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: 'a', pinnedSha: 'A'.repeat(40), handoffCommit: HEX })}'` }],
    ['claim pinnedSha short', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: 'a', pinnedSha: 'a'.repeat(39), handoffCommit: HEX })}'` }],
    ['claim handoffCommit non-hex', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: 'a', pinnedSha: HEX, handoffCommit: 'g'.repeat(40) })}'` }],
    ['claim handoffCommit missing', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: 'a', pinnedSha: HEX })}'` }],
    ['claim at past the safe range', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 9007199254740992, setBy: 'a', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim at a JSON string', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: '5', setBy: 'a', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim setBy with a trailing LF', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: 'a\n', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['claim setBy with a leading tab', { creationSeq: '1', creationClaim: `'${JSON.stringify({ at: 1, setBy: '\ta', pinnedSha: HEX, handoffCommit: HEX })}'` }],
    ['project with a trailing LF', { project: "'a' || char(10)" }], ['project with a leading tab', { project: "char(9) || 'a'" }],
    ['project with a trailing CR', { project: "'a' || char(13)" }], ['project of only LF', { project: 'char(10)' }],
  ])('refuses %s', (why, over) => {
    const db = fresh('ccrc-mig-5f-s-bad-');
    refuses(db, subj(over), why);
    db.close();
  });
  it('refuses a second row with the same id or the same (project, pr)', () => {
    const db = fresh('ccrc-mig-5f-s-uniq-');
    db.exec(subj({}));
    refuses(db, subj({ pr: '2' }), 'same id');
    refuses(db, subj({ id: '2' }), 'same project and pr');
    db.close();
  });
  it('has no foreign key to runs or landing_entries', () => {
    const db = fresh('ccrc-mig-5f-s-fk-');
    for (const t of ['landing_subjects', 'landing_authority']) {
      const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all() as unknown as { table: string }[];
      expect(fks.map((f) => f.table).filter((x) => x === 'runs' || x === 'landing_entries')).toEqual([]);
    }
    db.close();
  });
});

describe('landing_authority constraints', () => {
  it('accepts a good row and refuses its bad shapes', () => {
    const db = fresh('ccrc-mig-5f-a-');
    db.exec(subj({}));
    db.exec(auth({ afterIds: "'[2,3]'", fixesMain: '1' }));
    expect(n(db, 'landing_authority')).toBe(1);
    db.exec(subj({ id: '2', pr: '2' }));
    refuses(db, auth({ subjectId: '9' }), 'foreign key to a subject that is not there');
    refuses(db, auth({ subjectId: '1' }), 'second authority for a subject');
    refuses(db, auth({ subjectId: '2', afterIds: "'{}'" }), 'afterIds an object');
    refuses(db, auth({ subjectId: '2', afterIds: "'x'" }), 'afterIds not JSON');
    refuses(db, auth({ subjectId: '2', afterIds: "'3'" }), 'afterIds a scalar');
    refuses(db, auth({ subjectId: '2', afterIds: 'NULL' }), 'afterIds null');
    refuses(db, auth({ subjectId: '2', fixesMain: '2' }), 'fixesMain 2');
    refuses(db, auth({ subjectId: '2', setBy: "''" }), 'empty setBy');
    refuses(db, auth({ subjectId: '2', setBy: "' x'" }), 'untrimmed setBy');
    refuses(db, auth({ subjectId: '2', setBy: "'x' || char(10)" }), 'setBy with a trailing LF');
    refuses(db, auth({ subjectId: '2', setBy: "char(9) || 'x'" }), 'setBy with a leading tab');
    refuses(db, auth({ subjectId: '2', seq: '0' }), 'seq 0');
    refuses(db, auth({ subjectId: '2', seq: '9007199254740992' }), 'seq past safe');
    db.close();
  });
});

describe('landing_journal_cursor constraints', () => {
  it('is a singleton of a safe nonnegative integer', () => {
    const db = fresh('ccrc-mig-5f-c-');
    refuses(db, 'INSERT INTO landing_journal_cursor (id, appliedSeq) VALUES (2, 0)', 'a second row');
    refuses(db, 'UPDATE landing_journal_cursor SET appliedSeq = -1', 'negative');
    refuses(db, 'UPDATE landing_journal_cursor SET appliedSeq = 9007199254740992', 'past safe');
    refuses(db, 'UPDATE landing_journal_cursor SET appliedSeq = 1.5', 'real');
    db.exec('UPDATE landing_journal_cursor SET appliedSeq = 9007199254740991');
    expect(db.prepare('SELECT appliedSeq FROM landing_journal_cursor').get()).toEqual({ appliedSeq: 9007199254740991 });
    db.close();
  });
});

describe('landing_projection_witness constraints', () => {
  const entry = `INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (1, 'project-a', 7, '${HEX}', '${HEX}', NULL, 'pinned', 'lane-a', 1)`;
  it('accepts a good row (observedSeq 0 included) and refuses its bad shapes', () => {
    const db = fresh('ccrc-mig-5f-w-');
    db.exec(entry);
    db.exec(wit({}));
    expect(n(db, 'landing_projection_witness')).toBe(1);
    db.exec('DELETE FROM landing_projection_witness');
    refuses(db, wit({ entryId: '2' }), 'no such projection');
    refuses(db, wit({ entryId: '0' }), 'entryId 0');
    refuses(db, wit({ project: "''" }), 'empty project');
    refuses(db, wit({ project: "'p '" }), 'untrimmed project');
    refuses(db, wit({ project: "'p' || char(10)" }), 'project with a trailing LF');
    refuses(db, wit({ project: "char(9) || 'p'" }), 'project with a leading tab');
    refuses(db, wit({ pr: '0' }), 'pr 0');
    refuses(db, wit({ observedSeq: '-1' }), 'observedSeq negative');
    refuses(db, wit({ observedSeq: '9007199254740992' }), 'observedSeq past safe');
    refuses(db, wit({ runId: '0' }), 'runId 0');
    refuses(db, wit({ runId: 'NULL' }), 'runId null');
    refuses(db, wit({ runId: '9007199254740992' }), 'runId past safe');
    refuses(db, wit({ pinnedSha: `'${'A'.repeat(40)}'` }), 'uppercase pinnedSha');
    refuses(db, wit({ pinnedSha: `'${'a'.repeat(41)}'` }), 'long pinnedSha');
    refuses(db, wit({ handoffCommit: `'${'z'.repeat(40)}'` }), 'non-hex handoffCommit');
    refuses(db, wit({ handoffCommit: "''" }), 'empty handoffCommit');
    db.close();
  });
  it('has no runs foreign key and cascades with its projection', () => {
    const db = fresh('ccrc-mig-5f-w-fk-');
    expect((db.prepare('PRAGMA foreign_key_list(landing_projection_witness)').all() as unknown as { table: string }[]).map((f) => f.table)).toEqual(['landing_entries']);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(entry);
    db.exec(wit({ runId: '999' }));
    db.exec('DELETE FROM landing_entries');
    expect(n(db, 'landing_projection_witness')).toBe(0);
    db.close();
  });
});

describe('landing_entries.quarantineKind', () => {
  const ins = (state: string, kind: string): string =>
    `INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, state, setBy, pinnedAt, quarantineKind) VALUES ('p', ${Math.floor(Math.random() * 1e9)}, 'x', 'y', '${state}', 's', 1, ${kind})`;
  it('is NULL by default, and the one marker is licensed only with state unknown', () => {
    const db = fresh('ccrc-mig-5f-q-');
    db.exec("INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, state, setBy, pinnedAt) VALUES ('p', 1, 'x', 'y', 'pinned', 's', 1)");
    expect(db.prepare('SELECT quarantineKind FROM landing_entries').get()).toEqual({ quarantineKind: null });
    db.exec(ins('unknown', "'stale-episode-head'"));
    db.exec(ins('pinned', 'NULL'));
    refuses(db, ins('pinned', "'stale-episode-head'"), 'marker on a pinned row');
    refuses(db, ins('unknown', "'other'"), 'another marker');
    refuses(db, ins('ejected', "'stale-episode-head'"), 'marker on an ejected row');
    db.close();
  });
});
