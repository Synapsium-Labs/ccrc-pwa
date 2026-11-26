// Overlord W1, the invariant monitor's findings store (plan w1-sequence-monitor.md Task 6): `recordFinding` writes a live finding's
// item and row in one transaction, `resolveFindings` stamps only open rows, the partial unique index keeps one open row per
// (invariant, subject, mode), and every read answers `unmeasured` over a closed database. Temp databases only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { findingCounts, invariantItemOf, openFindings, recordFinding, resolveFindings } from '../src/coord/invariantFindingsStore.js';
import { itemById, raiseItem, raiseItemCheckedInTx, type RaiseItemInput } from '../src/coord/ledgersStore.js';
import type { Finding } from '../src/coord/invariants.js';
import { OVERLORD_ITEM_PROGRAMME } from '../../shared/overlord-sequence.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const opened: DatabaseSync[] = [];
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* closed */ } } });
const openDb = (): DatabaseSync => {
  const db = openCoordDb(path.join(mkTmp('ccrc-invariant-findings-'), '.ccrc', 'coord.db'));
  opened.push(db);
  return db;
};
const count = (db: DatabaseSync, table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const finding = (subject = 'timer:1', invariant: Finding['invariant'] = 'I17'): Finding => ({ invariant, subject, seq: null, message: 'a fixture message' });
const rowOf = (db: DatabaseSync, id: number) => db.prepare('SELECT * FROM overlord_invariant_findings WHERE id = ?').get(id) as Record<string, unknown>;
const LIVE = { latched: 'raised' as const };

describe('recordFinding', () => {
  it('a live finding writes one blocking item and one row carrying its id and latched word', () => {
    const db = openDb();
    const r = recordFinding(db, finding(), 'live', LIVE, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemId).not.toBeNull();
    expect(count(db, 'operator_items')).toBe(1);
    const item = itemById(db, r.itemId!);
    expect(item).toMatchObject({ program: OVERLORD_ITEM_PROGRAMME, raisedBy: 'ccrc', kind: 'do', neededBy: 'blocking' });
    expect(item?.program).toBe('overlord');
    const row = rowOf(db, r.id);
    expect(row).toMatchObject({ invariant: 'I17', subject: 'timer:1', mode: 'live', itemId: r.itemId, latched: 'raised', foundAt: NOW, resolvedAt: null });
  });

  it('a shadow finding writes a row with no item and no latched word, and raises no item', () => {
    const db = openDb();
    const before = count(db, 'operator_items');
    const r = recordFinding(db, finding(), 'shadow', null, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemId).toBeNull();
    expect(count(db, 'operator_items')).toBe(before);
    expect(rowOf(db, r.id)).toMatchObject({ mode: 'shadow', itemId: null, latched: null });
  });

  it('a second open row of one invariant, subject and mode is refused and writes no second item; the other mode may coexist', () => {
    const db = openDb();
    expect(recordFinding(db, finding(), 'live', LIVE, NOW).ok).toBe(true);
    const items = count(db, 'operator_items');
    const rows = count(db, 'overlord_invariant_findings');
    expect(recordFinding(db, finding(), 'live', { latched: 'standing' }, NOW + 1)).toMatchObject({ ok: false });
    expect(count(db, 'operator_items')).toBe(items);
    expect(count(db, 'overlord_invariant_findings')).toBe(rows);
    // the other mode is its own key
    expect(recordFinding(db, finding(), 'shadow', null, NOW + 2).ok).toBe(true);
    expect(count(db, 'overlord_invariant_findings')).toBe(rows + 1);
    expect(recordFinding(db, finding(), 'shadow', null, NOW + 3)).toMatchObject({ ok: false });
  });

  it('a refused item (a level outside the vocabulary) answers not ok and writes neither the item nor the row', () => {
    const db = openDb();
    const bad = (f: Finding): RaiseItemInput => ({ ...invariantItemOf(f), neededBy: 'urgent' as never });
    const r = recordFinding(db, finding(), 'live', LIVE, NOW, bad);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/neededBy/);
    expect(count(db, 'operator_items')).toBe(0);
    expect(count(db, 'overlord_invariant_findings')).toBe(0);
  });

  it('a refused row after the item rolls the item back too (one transaction)', () => {
    const db = openDb();
    expect(recordFinding(db, finding(), 'live', LIVE, NOW).ok).toBe(true);
    // a second live row of the same key fails at the INSERT, after the item's insert
    expect(recordFinding(db, finding(), 'live', LIVE, NOW + 1).ok).toBe(false);
    expect(count(db, 'operator_items')).toBe(1);
    expect(db.isTransaction).toBe(false);
  });

  it('a mode and live mismatch answers not ok and writes nothing', () => {
    const db = openDb();
    expect(recordFinding(db, finding(), 'live', null, NOW)).toMatchObject({ ok: false });
    expect(recordFinding(db, finding(), 'shadow', LIVE, NOW)).toMatchObject({ ok: false });
    expect(count(db, 'operator_items')).toBe(0);
    expect(count(db, 'overlord_invariant_findings')).toBe(0);
  });

  it('a closed database answers its failure arm and does not throw', () => {
    const db = openDb();
    db.close();
    expect(() => recordFinding(db, finding(), 'shadow', null, NOW)).not.toThrow();
    expect(recordFinding(db, finding(), 'shadow', null, NOW)).toMatchObject({ ok: false });
    expect(recordFinding(db, finding(), 'live', LIVE, NOW)).toMatchObject({ ok: false });
  });
});

describe('resolveFindings', () => {
  it('stamps only open rows; an already resolved id changes nothing; an empty list answers 0', () => {
    const db = openDb();
    const a = recordFinding(db, finding('timer:1'), 'shadow', null, NOW);
    const b = recordFinding(db, finding('timer:2'), 'shadow', null, NOW);
    if (!a.ok || !b.ok) throw new Error('fixture');
    expect(resolveFindings(db, [], NOW + 1)).toEqual({ resolved: 0 });
    expect(resolveFindings(db, [a.id], NOW + 10)).toEqual({ resolved: 1 });
    expect(resolveFindings(db, [a.id], NOW + 20)).toEqual({ resolved: 0 });
    expect(rowOf(db, a.id).resolvedAt).toBe(NOW + 10);
    expect(rowOf(db, b.id).resolvedAt).toBeNull();
    expect(resolveFindings(db, [a.id, b.id], NOW + 30)).toEqual({ resolved: 1 });
    expect(rowOf(db, a.id).resolvedAt).toBe(NOW + 10);
    expect(rowOf(db, b.id).resolvedAt).toBe(NOW + 30);
  });

  it('after resolution the same key records again: a new row id, and for live a new item', () => {
    const db = openDb();
    const a = recordFinding(db, finding(), 'live', LIVE, NOW);
    if (!a.ok) throw new Error('fixture');
    expect(resolveFindings(db, [a.id], NOW + 1)).toEqual({ resolved: 1 });
    const b = recordFinding(db, finding(), 'live', { latched: 'standing' }, NOW + 2);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.id).not.toBe(a.id);
    expect(b.itemId).not.toBe(a.itemId);
    expect(count(db, 'operator_items')).toBe(2);
    expect(count(db, 'overlord_invariant_findings')).toBe(2);
  });

  it('a closed database answers its error arm and does not throw', () => {
    const db = openDb();
    db.close();
    expect(() => resolveFindings(db, [1], NOW)).not.toThrow();
    expect(resolveFindings(db, [1], NOW)).toHaveProperty('error');
  });
});

describe('the reads', () => {
  it('openFindings lists only that mode\'s open rows', () => {
    const db = openDb();
    const s1 = recordFinding(db, finding('timer:1'), 'shadow', null, NOW);
    recordFinding(db, finding('timer:2'), 'shadow', null, NOW);
    recordFinding(db, finding('timer:3'), 'live', LIVE, NOW);
    if (!s1.ok) throw new Error('fixture');
    resolveFindings(db, [s1.id], NOW + 1);
    const shadow = openFindings(db, 'shadow');
    expect(shadow.kind === 'measured' && shadow.value.map((r) => r.subject)).toEqual(['timer:2']);
    const live = openFindings(db, 'live');
    expect(live.kind === 'measured' && live.value.map((r) => `${r.invariant}/${r.subject}`)).toEqual(['I17/timer:3']);
  });

  it('findingCounts keeps shadow and live apart: totals, open and per invariant', () => {
    const db = openDb();
    const s1 = recordFinding(db, finding('timer:1'), 'shadow', null, NOW);
    recordFinding(db, finding('timer:2'), 'shadow', null, NOW);
    recordFinding(db, finding('ask:1', 'I2'), 'shadow', null, NOW);
    recordFinding(db, finding('timer:3'), 'live', LIVE, NOW);
    if (!s1.ok) throw new Error('fixture');
    resolveFindings(db, [s1.id], NOW + 1);
    const c = findingCounts(db);
    expect(c.kind).toBe('measured');
    if (c.kind !== 'measured') return;
    expect(c.value.shadow).toEqual({ total: 3, open: 2, byInvariant: { I17: 2, I2: 1 } });
    expect(c.value.live).toEqual({ total: 1, open: 1, byInvariant: { I17: 1 } });
  });

  it('an empty table counts zero in both modes', () => {
    const c = findingCounts(openDb());
    expect(c).toEqual({ kind: 'measured', value: { live: { total: 0, open: 0, byInvariant: {} }, shadow: { total: 0, open: 0, byInvariant: {} } } });
  });

  it('a closed database reads unmeasured', () => {
    const db = openDb();
    db.close();
    expect(openFindings(db, 'live').kind).toBe('unmeasured');
    expect(findingCounts(db).kind).toBe('unmeasured');
  });
});

describe('raiseItemCheckedInTx', () => {
  const base = (): RaiseItemInput => invariantItemOf(finding());
  const inTx = (db: DatabaseSync, input: RaiseItemInput): number => {
    db.exec('BEGIN IMMEDIATE');
    try { return raiseItemCheckedInTx(db, input, NOW, 'ccrc'); } finally { db.exec('ROLLBACK'); }
  };

  it('refuses what raiseItem refuses, by RangeError', () => {
    const db = openDb();
    const kind = { ...base(), kind: 'nope' as never };
    const level = { ...base(), neededBy: 'urgent' as never };
    const decide = { ...base(), kind: 'decide' as const };
    for (const input of [kind, level, decide]) {
      expect(() => raiseItem(db, input, NOW, 'ccrc')).toThrow(RangeError);
      expect(() => inTx(db, input)).toThrow(RangeError);
    }
    expect(count(db, 'operator_items')).toBe(0);
  });

  it('accepts a valid input inside a transaction, and throws when none is open', () => {
    const db = openDb();
    db.exec('BEGIN IMMEDIATE');
    const id = raiseItemCheckedInTx(db, base(), NOW, 'ccrc');
    db.exec('COMMIT');
    expect(itemById(db, id)).not.toBeNull();
    expect(() => raiseItemCheckedInTx(db, base(), NOW, 'ccrc')).toThrow(/no transaction/);
  });
});
