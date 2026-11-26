// X2 P4.3: the singleton settings store, exercised only on fixture coord.db files.
// The schema and CoordStore implementation are held separately and must be integrated before this suite runs.
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { EMPTY_DOCS_SETTINGS, docsSettingsFromStored, type DocsSettings } from '../../shared/docsTracker.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-docs-settings-store-'), 'coord.db')));
const A: DocsSettings = {
  rules: [{ name: 'items', pattern: '([A-Z]+)-([0-9]+)', template: 'https://tracker.example/browse/{1}-{2}' }],
  defaultBranches: { 'project-a': 'main' },
};
const B: DocsSettings = {
  rules: [{ name: 'other', pattern: 'T[0-9]+', template: 'https://tracker.example/t/{0}' }],
  defaultBranches: {},
};
const BOTH: DocsSettings = { rules: [...A.rules, ...B.rules], defaultBranches: {} };
const onlyA: DocsSettings = { rules: A.rules, defaultBranches: {} };
const rawRows = (s: CoordStore): unknown[] => {
  const st = s.db.prepare('SELECT id, body, updatedAt FROM docs_settings');
  st.setReadBigInts(true);
  return st.all();
};

describe('the migration: one table, one row, no seed', () => {
  it('starts without a row and has the singleton body and timestamp columns', () => {
    const s = store();
    expect(rawRows(s)).toEqual([]);
    const cols = (s.db.prepare('PRAGMA table_info(docs_settings)').all() as
      { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[])
      .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);
    expect(cols).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['body', 'TEXT', 1, null, 0], ['updatedAt', 'INTEGER', 1, null, 0],
    ]);
  });

  it('refuses a second singleton id', () => {
    const s = store();
    expect(() => s.db.exec("INSERT INTO docs_settings (id, body, updatedAt) VALUES (2, '{}', 0)")).toThrow(/CHECK constraint failed/);
  });
});

describe('readDocsSettings', () => {
  it('distinguishes absent, row and failed read', () => {
    const s = store();
    expect(s.readDocsSettings()).toEqual({ kind: 'absent' });
    expect(s.writeDocsSettings(A, 42, () => true)).toEqual({ kind: 'written' });
    const row = s.readDocsSettings();
    expect(row).toEqual({ kind: 'row', body: JSON.stringify(A), updatedAt: 42n });
    expect(docsSettingsFromStored(row)).toEqual({ ok: true, settings: A });
    s.db.exec('DROP TABLE docs_settings');
    const read = s.readDocsSettings();
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' && read.detail).toMatch(/docs_settings/);
    expect(docsSettingsFromStored(read)).toEqual({ ok: false, why: 'unreadable' });
  });

  it('a malformed stored body is unreadable, never empty', () => {
    const s = store();
    s.db.exec("INSERT INTO docs_settings (id, body, updatedAt) VALUES (1, '{not json', 7)");
    expect(s.readDocsSettings().kind).toBe('row');
    expect(docsSettingsFromStored(s.readDocsSettings())).toEqual({ ok: false, why: 'unreadable' });
  });
});

describe('writeDocsSettings: current-row widening and write in one transaction', () => {
  it('authorizes a first widening and later writes replace earlier writes', () => {
    const s = store();
    let calls = 0;
    expect(s.writeDocsSettings(A, 100, () => { calls++; return true; })).toEqual({ kind: 'written' });
    expect(calls).toBe(1);
    expect(rawRows(s)).toEqual([{ id: 1n, body: JSON.stringify(A), updatedAt: 100n }]);
    expect(s.writeDocsSettings(EMPTY_DOCS_SETTINGS, 200, () => { throw new Error('narrowing asked the gate'); })).toEqual({ kind: 'written' });
    expect(s.writeDocsSettings(B, 300, () => true)).toEqual({ kind: 'written' });
    expect(rawRows(s)).toEqual([{ id: 1n, body: JSON.stringify(B), updatedAt: 300n }]);
  });

  it('a stale removal that widens the current row requires authorization and denial leaves it unchanged', () => {
    const s = store();
    expect(s.writeDocsSettings(BOTH, 100, () => true)).toEqual({ kind: 'written' });
    const older = docsSettingsFromStored(s.readDocsSettings());
    expect(older).toEqual({ ok: true, settings: BOTH });
    expect(s.writeDocsSettings(onlyA, 200, () => { throw new Error('narrowing asked the gate'); })).toEqual({ kind: 'written' });
    let calls = 0;
    expect(s.writeDocsSettings(B, 300, () => { calls++; return false; })).toEqual({ kind: 'denied' });
    expect(calls).toBe(1);
    expect(rawRows(s)).toEqual([{ id: 1n, body: JSON.stringify(onlyA), updatedAt: 200n }]);
    expect(s.writeDocsSettings(B, 400, () => true)).toEqual({ kind: 'written' });
    expect(docsSettingsFromStored(s.readDocsSettings())).toEqual({ ok: true, settings: B });
  });

  it('a malformed current row refuses even if authorization would allow the write', () => {
    const s = store();
    s.db.exec("INSERT INTO docs_settings (id, body, updatedAt) VALUES (1, '{not json', 7)");
    let calls = 0;
    expect(s.writeDocsSettings(A, 100, () => { calls++; return true; })).toEqual({ kind: 'unreadable' });
    expect(calls).toBe(0);
    expect(rawRows(s)).toEqual([{ id: 1n, body: '{not json', updatedAt: 7n }]);
  });

  it('a failed read in the transaction refuses rather than treating it as absent', () => {
    const s = store();
    s.db.exec('DROP TABLE docs_settings');
    let calls = 0;
    expect(s.writeDocsSettings(A, 100, () => { calls++; return true; })).toEqual({ kind: 'unreadable' });
    expect(calls).toBe(0);
  });
});

describe('docs_settings has one writer', () => {
  it('no file in server/src names the table but the schema and store', () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const holders = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(path.join(src, f), 'utf8').includes('docs_settings'))
      .map((f) => f.split(path.sep).join('/')).sort();
    expect(holders).toEqual(['coord/schema.ts', 'coord/store.ts']);
  });
});
