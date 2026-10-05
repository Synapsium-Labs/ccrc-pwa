// Child-reclamation wave 5, Task 2: the reclaim chip's ONE read of the
// lifecycle mirror. The table is NEVER PRUNED (schema.ts), and the board read
// already spends several statements per row, so this read must cost ONE
// statement for the whole board whatever the row count (the four-statement
// batch `CoordStore.runHealth`'s docstring states), and must seek rather than
// scan.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { StatementSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cr-ev-'), '.ccrc', 'coord.db')));

const GEN = '1758500000000000000';
const A = 'ccrc-pwa-quiet-mesa';
const B = 'ccrc-pwa-clear-cove';
const T = 1_758_500_000_000;

let seq = 0;
const line = (sessionId: string, act: string, outcome: string, at: number,
              over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({ uid: `w5ev.1.${++seq}`, at, act, outcome, id: sessionId, ...over }));

/** One ingest per fixture, the shape `lifecycle-store.test.ts` drives the mirror with. */
const seedMirror = (s: CoordStore): void => {
  const rows = [
    line(A, 'create', 'done', T),
    line(A, 'ensure', 'done', T + 1),
    line(A, 'reclaim', 'refused', T + 2, { refusal: 'held' }),
    line(A, 'swap', 'done', T + 3),
    line(A, 'reclaim', 'done', T + 4),
    line(B, 'create', 'done', T + 5),
    line(B, 'hold', 'done', T + 6),
  ];
  s.ingestJournal({ gen: GEN, rows, cursor: 700, size: 700, at: 9 });
};

describe('CoordStore.childReclaimEvents (wave 5)', () => {
  it('answers EVERY requested session, an empty list included — no caller supplies a default', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [line(A, 'reclaim', 'done', T)], cursor: 100, size: 100, at: 9 });
    const got = s.childReclaimEvents([A, B]);
    expect([...got.keys()].sort()).toEqual([B, A].sort());
    expect(got.get(B)).toEqual([]);
    expect(got.get(A)!.map((e) => e.act)).toEqual(['reclaim']);
  });

  it('returns only reclaim and create rows, oldest first, per session', () => {
    const s = store();
    seedMirror(s);
    const got = s.childReclaimEvents([A, B]);
    expect(got.get(A)!.map((e) => `${e.act}:${e.outcome}`)).toEqual(['create:done', 'reclaim:refused', 'reclaim:done']);
    expect(got.get(A)![1]!.refusal).toBe('held');
    expect(got.get(B)!.map((e) => e.act)).toEqual(['create']);
  });

  it('revives each row exactly as lifecycleFor does — reviveLifecycleRow, both reads', () => {
    const s = store();
    seedMirror(s);
    expect(s.childReclaimEvents([A]).get(A)).toEqual(
      s.lifecycleFor({ sessionId: A }).filter((e) => e.act === 'reclaim' || e.act === 'create'));
  });

  it('reads nothing for an empty request', () => {
    const s = store();
    const prepare = vi.spyOn(s.db, 'prepare');
    const all = vi.spyOn(StatementSync.prototype, 'all');
    try {
      expect(s.childReclaimEvents([])).toEqual(new Map());
      expect(prepare).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
    } finally {
      all.mockRestore();
    }
  });

  it('spends ONE statement, run ONCE, whatever the session count', () => {
    const s = store();
    seedMirror(s);
    const prepare = vi.spyOn(s.db, 'prepare');
    // Preparing once and running per id is the per-run loop shape the one-IN
    // read replaces, so the executions are counted too, not only the prepares.
    const all = vi.spyOn(StatementSync.prototype, 'all');
    try {
      s.childReclaimEvents([A, B, 'ccrc-pwa-calm-reef', 'ccrc-pwa-keen-dune', A]);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(all).toHaveBeenCalledTimes(1);
    } finally {
      all.mockRestore();
    }
  });

  it('seeks through lifecycle_by_session and never scans the never-pruned table', () => {
    // The SAME text the method runs (`childReclaimEventsSql`), not a copy.
    // Two pins over it. The hint is asserted as text because today's planner
    // picks the index without it, so EXPLAIN cannot see the hint go; the plan
    // is asserted too, because `NOT INDEXED` (or a rewrite that drops the
    // index's column) turns the SEARCH into a SCAN.
    const s = store();
    const sql = CoordStore.childReclaimEventsSql(2);
    expect(sql).toContain('INDEXED BY lifecycle_by_session');
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
      .map((r) => r.detail).join(' | ');
    expect(plan).toContain('lifecycle_by_session');
    expect(plan).not.toContain('SCAN lifecycle_events');
  });
});
