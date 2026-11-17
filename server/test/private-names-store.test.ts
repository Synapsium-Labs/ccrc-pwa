// Overlord W2, private names B (plan w2-private-names.md, Task 4): the uploaded name list's two tables in the private store,
// `private_name_list` and `private_name_entries`, and their one writer, `OperatorModelStore.replacePrivateNames`. Fixture
// files only (`mkTmp`), synthetic hashes only: no entry here was made from a name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { OPERATOR_MODEL_SCHEMA_VERSION } from '../src/operatorModel/schema.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type NameListEntryRow, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { mkTmp } from './tmpHelpers.js';

const issuer: PrivacyIssuer = { kind: 'ready', issue: () => ({ ok: true, id: 1 }) };
const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen) db.close(); });
function fixture(): { db: DatabaseSync; store: OperatorModelStore; p: string } {
  const p = defaultOperatorModelDbPath(mkTmp('ccrc-names-store-'));
  const db = openOperatorModelDb(p);
  opened.push(db);
  return { db, store: new OperatorModelStore(db, issuer), p };
}

const hex = (seed: number): string => seed.toString(16).padStart(2, '0').repeat(16);
const entry = (seed: number, n = 1, mode = 'part'): NameListEntryRow => ({ h: hex(seed), f: hex(seed + 1), n, mode });
const LIST_1 = [entry(1), entry(3, 2, 'words'), entry(5, 1, 'exact')];
const LIST_2 = [entry(7), entry(9, 1, 'run')];

describe('the private store gains the name list at its next migration', () => {
  it('a fresh store is at schema 2 and holds both tables', () => {
    const { db } = fixture();
    expect(OPERATOR_MODEL_SCHEMA_VERSION).toBe(2);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['private_name_list', 'private_name_entries']));
  });

  it('a store at schema 1 migrates to 2 and keeps its messages', () => {
    const { p, db } = fixture();
    db.exec('DROP TABLE private_name_list; DROP TABLE private_name_entries; PRAGMA user_version = 1');
    db.prepare("INSERT INTO read_ledger (at, door, caller, scope, count, outcome, generationRead) VALUES (1, 'board', 'operator', 's', 0, 'ok', 'not-a-session')").run();
    db.close();
    const again = openOperatorModelDb(p);
    opened.push(again);
    expect((again.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    expect((again.prepare('SELECT count(*) AS c FROM read_ledger').get() as { c: number }).c).toBe(1);
    expect(new OperatorModelStore(again, issuer).privateNamesRead()).toEqual({ kind: 'measured', value: { kind: 'none' } });
  });

  it('a database from a newer build opens with no migration and one warning (private store A\'s rule, unchanged)', () => {
    const { p, db } = fixture();
    db.exec('PRAGMA user_version = 9');
    db.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const b = openOperatorModelDb(p);
      opened.push(b);
      expect((b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/is at schema 9, this build knows 2/);
    } finally { warn.mockRestore(); }
  });
});

describe('replacePrivateNames: the one writer of the list', () => {
  it('a fresh store reads none, and its generation none', () => {
    const { store } = fixture();
    expect(store.privateNamesRead()).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(store.privateNamesGeneration()).toEqual({ kind: 'measured', value: 'none' });
  });

  it('a first upload reads its time, its rows, generation 1 and the entries in their order', () => {
    const { store } = fixture();
    expect(store.replacePrivateNames(LIST_1, 2, 1_000)).toEqual({ ok: true, value: { generation: 1 } });
    expect(store.privateNamesRead()).toEqual({
      kind: 'measured', value: { kind: 'list', uploadedAt: 1_000, rows: 2, generation: 1, entries: LIST_1 },
    });
    expect(store.privateNamesGeneration()).toEqual({ kind: 'measured', value: 1 });
  });

  it('a second upload replaces every entry, the time and the rows, and raises the generation to 2', () => {
    const { store, db } = fixture();
    store.replacePrivateNames(LIST_1, 2, 1_000);
    expect(store.replacePrivateNames(LIST_2, 1, 2_000)).toEqual({ ok: true, value: { generation: 2 } });
    expect(store.privateNamesRead()).toEqual({
      kind: 'measured', value: { kind: 'list', uploadedAt: 2_000, rows: 1, generation: 2, entries: LIST_2 },
    });
    expect((db.prepare('SELECT count(*) AS c FROM private_name_entries').get() as { c: number }).c).toBe(2);
    expect((db.prepare('SELECT count(*) AS c FROM private_name_list').get() as { c: number }).c).toBe(1);
  });

  it('an upload of the canary alone (zero rows) is a list, never none', () => {
    const { store } = fixture();
    expect(store.replacePrivateNames([entry(1)], 0, 3_000)).toEqual({ ok: true, value: { generation: 1 } });
    expect(store.privateNamesRead()).toMatchObject({ kind: 'measured', value: { kind: 'list', rows: 0, entries: [entry(1)] } });
  });

  it('a write that fails midway leaves the first list and its generation whole', () => {
    const { store, db } = fixture();
    store.replacePrivateNames(LIST_1, 2, 1_000);
    db.exec("CREATE TRIGGER stop_second BEFORE INSERT ON private_name_entries WHEN NEW.pos = 1 BEGIN SELECT RAISE(ABORT, 'stopped'); END");
    const r = store.replacePrivateNames(LIST_2, 1, 2_000);
    expect(r).toMatchObject({ ok: false, error: 'write-failed' });
    expect(store.privateNamesRead()).toEqual({
      kind: 'measured', value: { kind: 'list', uploadedAt: 1_000, rows: 2, generation: 1, entries: LIST_1 },
    });
  });

  it('refuses, writing nothing, a list with no entry, an entry not of the matcher\'s shape, or a bad count or time', () => {
    const { store } = fixture();
    const bad: [readonly NameListEntryRow[], number, number][] = [
      [[], 0, 1],
      [[{ ...entry(1), h: 'zz' }], 0, 1],
      [[{ ...entry(1), f: hex(10).toUpperCase() }], 0, 1],
      [[{ ...entry(1), n: 0 }], 0, 1],
      [[{ ...entry(1), n: 1.5 }], 0, 1],
      [[{ ...entry(1), mode: '' }], 0, 1],
      [LIST_1, -1, 1],
      [LIST_1, 0.5, 1],
      [LIST_1, 2, -1],
    ];
    for (const [entries, rows, at] of bad) {
      expect(store.replacePrivateNames(entries, rows, at), JSON.stringify({ rows, at })).toMatchObject({ ok: false, error: 'refused' });
    }
    expect(store.privateNamesRead()).toEqual({ kind: 'measured', value: { kind: 'none' } });
  });

  it('a closed store refuses not-open, and its reads answer unmeasured, never none', () => {
    const { store, db } = fixture();
    db.close();
    expect(store.replacePrivateNames(LIST_1, 2, 1)).toMatchObject({ ok: false, error: 'not-open' });
    expect(store.privateNamesRead()).toMatchObject({ kind: 'unmeasured' });
    expect(store.privateNamesGeneration()).toMatchObject({ kind: 'unmeasured' });
  });

  it('a list row whose entries are missing reads unmeasured, never a list with no canary', () => {
    const { store, db } = fixture();
    store.replacePrivateNames(LIST_1, 2, 1_000);
    db.exec('DELETE FROM private_name_entries');
    expect(store.privateNamesRead()).toMatchObject({ kind: 'unmeasured' });
  });
});
