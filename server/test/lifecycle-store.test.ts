import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { mkTmp } from './tmpHelpers.js';
import { LIFECYCLE_ACTS, LC_ACT_UNKNOWN } from '../../shared/api.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-lc-'), '.ccrc', 'coord.db')));

const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const GEN = '1755780000000000000';

const row = (uid: string, over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({
    uid, at: 1_755_780_000_123, act: AN_ACT, outcome: 'done',
    verb: 'ws-rm', id: 'demo-quiet-basin', ...over,
  }));

describe('CoordStore.ingestJournal', () => {
  it('inserts the rows and advances the cursor, and reports how many landed', () => {
    const s = store();
    const n = s.ingestJournal({ gen: GEN, rows: [row('a.1.1'), row('a.1.2')], cursor: 220, size: 220, at: 9 });
    expect(n).toBe(2);
    expect(s.journalGenerations()).toEqual([
      { gen: GEN, firstSeenAt: 9, lastSweepAt: 9, cursor: 220, size: 220, retired: false },
    ]);
  });

  it('is idempotent on the UID — a replay is no-op-or-catch-up (D6)', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 110, at: 9 });
    const again = s.ingestJournal({ gen: GEN, rows: [row('a.1.1'), row('a.1.2')], cursor: 220, size: 220, at: 11 });
    expect(again).toBe(1);
    expect((s.db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(2);
  });

  it('re-ingests from offset 0 without duplicating anything — the cursor is an OPTIMISATION', () => {
    const s = store();
    const rows = [row('a.1.1'), row('a.1.2')];
    s.ingestJournal({ gen: GEN, rows, cursor: 220, size: 220, at: 9 });
    expect(s.ingestJournal({ gen: GEN, rows, cursor: 220, size: 220, at: 12 })).toBe(0);
    expect((s.db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(2);
  });

  it('THE CURSOR NEVER ADVANCES PAST UNCOMMITTED ROWS', () => {
    // Both halves in ONE tx(). Force a bind failure half way through the row
    // loop and assert that NEITHER the rows NOR the cursor landed. The shipped
    // rollback behaviour is already pinned at `coord-db.test.ts:255-266`.
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 110, at: 9 });
    const poison = { ...row('a.1.2'), raw: (Symbol('unbindable') as unknown as string) };
    expect(() => s.ingestJournal({
      gen: GEN, rows: [row('a.1.2'), poison], cursor: 330, size: 330, at: 11,
    })).toThrow();
    expect((s.db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(1);
    expect(s.journalGenerations()[0]!.cursor, 'the cursor moved past rows that never committed').toBe(110);
  });

  it('inserts an UNPARSEABLE line rather than dropping it, with `raw` verbatim', () => {
    const s = store();
    const junk = 'ws-rm demo-quiet-basin   # not json at all';
    s.ingestJournal({ gen: GEN, rows: [parseJournalLine(junk)], cursor: 42, size: 42, at: 9 });
    const got = s.db.prepare('SELECT act, uid, raw FROM lifecycle_events').all() as
      { act: string; uid: string | null; raw: string }[];
    expect(got).toEqual([{ act: LC_ACT_UNKNOWN, uid: null, raw: junk }]);
  });

  it('stores `detail` and `truncated` so a dropped family is not read as an absent one', () => {
    const s = store();
    s.ingestJournal({
      gen: GEN, cursor: 110, size: 110, at: 9,
      rows: [row('a.1.1', { detail: 'held: program:build8 wave:2/4', truncated: true })],
    });
    const got = s.db.prepare('SELECT detail, truncated FROM lifecycle_events').get() as
      { detail: string | null; truncated: number };
    expect(got).toEqual({ detail: 'held: program:build8 wave:2/4', truncated: 1 });
  });

  // Not in the brief: F1 added `badoutcome` to `MIGRATIONS[2]` and
  // `JournalRow` after the brief was written (ccd already writes it, and
  // `LifecycleEvent.badoutcome` requires it). Prove the write side actually
  // persists it rather than silently dropping the column.
  it('persists `badoutcome`, `badact`\'s twin on the outcome side, verbatim', () => {
    const s = store();
    s.ingestJournal({
      gen: GEN, cursor: 110, size: 110, at: 9,
      rows: [row('a.1.1', { outcome: 'quarantined' })],
    });
    const got = s.db.prepare('SELECT outcome, badoutcome FROM lifecycle_events').get() as
      { outcome: string; badoutcome: string | null };
    expect(got).toEqual({ outcome: 'unknown', badoutcome: 'quarantined' });
  });

  it('leaves `badoutcome` NULL for a row whose outcome this build knows', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 110, at: 9 });
    const got = s.db.prepare('SELECT outcome, badoutcome FROM lifecycle_events').get() as
      { outcome: string; badoutcome: string | null };
    expect(got).toEqual({ outcome: 'done', badoutcome: null });
  });
});

describe('CoordStore.recordGap / retireGeneration', () => {
  it('records a gap and retires the generation, leaving the row behind', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1.1')], cursor: 110, size: 4096, at: 9 });
    s.recordGap({ at: 20, gen: GEN, reason: 'rotated-away',
                  detail: 'undrained', lostFrom: 110, lostTo: 4096 });
    s.retireGeneration(GEN, 20);
    expect(s.journalGenerations()[0]!.retired).toBe(true);
    // RETIRE, NEVER DELETE: the cursor and size are the evidence behind the gap.
    expect(s.journalGenerations()[0]).toMatchObject({ cursor: 110, size: 4096 });
    const gaps = s.db.prepare('SELECT gen, reason, lostFrom, lostTo FROM lifecycle_gaps').all();
    expect(gaps).toEqual([{ gen: GEN, reason: 'rotated-away', lostFrom: 110, lostTo: 4096 }]);
  });
});
