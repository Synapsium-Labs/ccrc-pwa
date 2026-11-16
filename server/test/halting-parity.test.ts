// ARCH-16, D-5890 (#535) — the halting predicate has two spellings: the TS one every reader asks
// (`isHaltingUpdate`, `shared/update-move.ts`) and the SQL one the store's guards embed (`haltingRowSql`,
// `server/src/coord/store.ts`), which SQL cannot delegate. D-3412 had to reconcile them once. This file runs the
// SAME rows through both and asserts they agree row for row, so a change to either spelling alone goes red here
// directly, not only through whichever store writer happens to embed the SQL.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { haltingRowSql } from '../src/coord/store.js';
import { isHaltingUpdate } from '../../shared/update-move.js';
import { PROVENANCE_DETAIL_PREFIX, UPDATE_STATES } from '../../shared/api.js';

/** Every state the build can name, plus a token it cannot (never settled, so never halts). */
const STATES: readonly string[] = [...UPDATE_STATES, 'not-a-state'];

/** Provenance-prefixed details, near misses the byte-for-byte compare must refuse, and ordinary failures. */
const DETAILS: readonly (string | null)[] = [
  null, '', 'the installer died', 'planted',
  PROVENANCE_DETAIL_PREFIX, `${PROVENANCE_DETAIL_PREFIX} unsigned bundle`,
  'Provenance: x', 'PROVENANCE: x', ' provenance: x', 'x provenance: y', 'provenance', 'provenance;x',
];

interface Row { id: number; state: string; detail: string | null }

const ROWS: readonly Row[] = STATES.flatMap((state) => DETAILS.map((detail) => ({ state, detail })))
  .map((r, id) => ({ id, ...r }));

/** The SQL verdict per row id: `haltingRowSql` over a minimal `nodes` table in an in-memory DB. A NULL verdict
 *  is kept as NULL — the store's guards use `AND NOT <halting>`, so a NULL there refuses, i.e. reads as halting. */
function sqlVerdicts(rows: readonly Row[]): Map<number, boolean> {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE nodes (id INTEGER PRIMARY KEY, updateState TEXT NOT NULL, updateDetail TEXT)');
    const ins = db.prepare('INSERT INTO nodes (id, updateState, updateDetail) VALUES (?, ?, ?)');
    for (const r of rows) ins.run(r.id, r.state, r.detail);
    // `NOT <halting>` is how every guard asks it; a row passes the guard exactly when it does not halt.
    const passes = new Set((db.prepare(`SELECT id FROM nodes WHERE NOT ${haltingRowSql('nodes')}`).all() as { id: number }[])
      .map((r) => r.id));
    return new Map(rows.map((r) => [r.id, !passes.has(r.id)]));
  } finally {
    db.close();
  }
}

describe('halting parity: isHaltingUpdate (TS) and haltingRowSql (SQL) agree on every row (ARCH-16, D-5890)', () => {
  it('the fixture is wide enough: at least 8 rows, provenance-prefixed and other failures among them', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(8);
    const failed = ROWS.filter((r) => r.state === 'failed');
    expect(failed.some((r) => r.detail?.startsWith(PROVENANCE_DETAIL_PREFIX))).toBe(true);
    expect(failed.some((r) => r.detail === null || !r.detail.startsWith(PROVENANCE_DETAIL_PREFIX))).toBe(true);
  });

  it('each row halts in SQL exactly when it halts in TS', () => {
    const sql = sqlVerdicts(ROWS);
    for (const r of ROWS) {
      expect(sql.get(r.id), `${r.state} / ${JSON.stringify(r.detail)}`).toBe(isHaltingUpdate(r.state, r.detail));
    }
  });

  it('pins the notion itself, so both spellings drifting together is caught too', () => {
    const halts = (state: string, detail: string | null): boolean => isHaltingUpdate(state, detail);
    expect(halts('failed', `${PROVENANCE_DETAIL_PREFIX} unsigned bundle`)).toBe(false);
    expect(halts('failed', 'Provenance: x')).toBe(true);
    expect(halts('failed', null)).toBe(true);
    expect(halts('reverted', `${PROVENANCE_DETAIL_PREFIX} x`)).toBe(true);
    expect(halts('idle', 'the installer died')).toBe(false);
    expect(halts('pending', null)).toBe(false);
    expect(halts('not-a-state', null)).toBe(false);
  });
});
