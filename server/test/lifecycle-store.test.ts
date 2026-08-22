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

describe('CoordStore.lifecycleFor', () => {
  it("answers one session's timeline oldest-first, and nobody else's", () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [
      row('a.1', { id: 'demo-quiet-basin', at: 100 }),
      row('a.2', { id: 'other-session',    at: 110 }),
      row('a.3', { id: 'demo-quiet-basin', at: 120 }),
    ], cursor: 300, size: 300, at: 9 });
    const got = s.lifecycleFor({ sessionId: 'demo-quiet-basin', limit: 50 });
    expect(got.map((e) => e.uid)).toEqual(['a.1', 'a.3']);
    expect(got[0]!.id).toBe('demo-quiet-basin');   // the row says sessionId, the wire says id
    expect(got[0]!.ingestedAt).toBe(9);
    expect(got[0]!.gen).toBe(GEN);
    expect(got[0]!.truncated).toBe(false);
  });

  it('keeps the NEWEST n when limited, still returned oldest-first', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: ['a.1', 'a.2', 'a.3', 'a.4'].map((u) => row(u)),
                      cursor: 400, size: 400, at: 9 });
    expect(s.lifecycleFor({ limit: 2 }).map((e) => e.uid)).toEqual(['a.3', 'a.4']);
  });

  it('clamps a limit it was never going to honour, and survives a NaN', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1')], cursor: 110, size: 110, at: 9 });
    expect(s.lifecycleFor({ limit: 99_999 })).toHaveLength(1);
    expect(s.lifecycleFor({ limit: Number.NaN })).toHaveLength(1);
  });

  it('reads an act token this build does not know as `unknown`, never as a raw string', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1')], cursor: 110, size: 110, at: 9 });
    s.db.prepare('UPDATE lifecycle_events SET act = ?, outcome = ? WHERE uid = ?')
      .run('quarantine', 'partially', 'a.1');
    const e = s.lifecycleFor({ limit: 10 })[0]!;
    expect(e.act).toBe(LC_ACT_UNKNOWN);
    expect(e.outcome).toBe('unknown');
    expect(e.raw).toContain('"uid":"a.1"');   // the bytes survive the degrade
  });

  it('revives the three families as three objects, or null where the line carried none', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1', {
      obs: { cg: 'supervisor', cgraw: '0::/x', pid: 7 },
      dec: { surface: 'pwa', actor: 'nobody', reason: 'r' },
    })], cursor: 110, size: 110, at: 9 });
    const e = s.lifecycleFor({ limit: 10 })[0]!;
    expect(e.obs).toMatchObject({ cg: 'supervisor', cgraw: '0::/x', pid: 7, ppid: null });
    expect(e.dec).toMatchObject({ surface: 'pwa', actor: 'nobody' });
    expect(e.meas).toBeNull();
  });

  // Not in the brief: prove `badoutcome` round-trips through the read side
  // too, both when it is set (a degraded outcome) and when it is null (a
  // known one) — `MirroredLifecycleEvent extends LifecycleEvent` requires
  // the field on every returned row, so a reader that invents `null` for a
  // row where ccd actually wrote a token would silently lie.
  it("carries `badoutcome` through — the degrade's own token, or null for a known outcome", () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [
      row('a.1', { outcome: 'quarantined' }),
      row('a.2', {}),
    ], cursor: 220, size: 220, at: 9 });
    const [degraded, known] = s.lifecycleFor({ limit: 10 });
    expect(degraded!.outcome).toBe('unknown');
    expect(degraded!.badoutcome).toBe('quarantined');
    expect(known!.outcome).toBe('done');
    expect(known!.badoutcome).toBeNull();
  });
});

describe('CoordStore.lifecycleStats and lifecycleGaps', () => {
  it('reports the horizon, the newest event, and the counts', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('a.1', { at: 100 }), row('a.2', { at: 300 })],
                      cursor: 220, size: 220, at: 9 });
    s.recordGap({ at: 20, gen: GEN, reason: 'shrank', detail: 'truncated',
                  lostFrom: 0, lostTo: 100 });
    expect(s.lifecycleStats()).toEqual({
      rows: 2, oldestAt: 100, newestAt: 300, generations: 1, gaps: 1,
    });
    expect(s.lifecycleGaps(10)).toEqual([{
      at: 20, gen: GEN, reason: 'shrank', detail: 'truncated', lostFrom: 0, lostTo: 100,
    }]);
  });

  it('reads a gap reason this build does not know as `unknown`', () => {
    const s = store();
    s.recordGap({ at: 20, gen: GEN, reason: 'shrank', detail: 'd', lostFrom: null, lostTo: null });
    s.db.prepare('UPDATE lifecycle_gaps SET reason = ?').run('vacuumed');
    expect(s.lifecycleGaps(10)[0]!.reason).toBe('unknown');
  });
});

describe('CoordStore.recentProvenance', () => {
  it('returns only rows carrying BOTH an observed class and a declared surface', () => {
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [
      row('a.1', { at: 500, obs: { cg: 'pane' }, dec: { surface: 'agent' } }),
      row('a.2', { at: 500, obs: { cg: 'pane' } }),                    // no dec
      row('a.3', { at: 500, dec: { surface: 'agent' } }),              // no obs
      row('a.4', { at: 100, obs: { cg: 'pane' }, dec: { surface: 'agent' } }),  // too old
    ], cursor: 400, size: 400, at: 9 });
    expect(s.recentProvenance(200, 50)).toEqual([
      { id: 'demo-quiet-basin', at: 500, obsClass: 'pane', decSurface: 'agent' },
    ]);
  });

  it('DROPS a row whose class or surface is not even a string — unmodellable is not a disagreement', () => {
    // A newer ccd writing `"cg": 7`, or a hand-edited row. `json_extract`
    // answers whatever the JSON held, and an adapter that cast it would hand
    // `corroboration` a value it cannot narrow — the "an adapter may not
    // narrow a distinction it received" rule, inverted.
    const s = store();
    s.ingestJournal({ gen: GEN, rows: [row('b.1', { at: 500 })], cursor: 110, size: 110, at: 9 });
    s.db.prepare("UPDATE lifecycle_events SET obsJson = '{\"cg\":7}', decJson = '{\"surface\":\"cli\"}'")
      .run();
    expect(() => s.recentProvenance(200, 50)).not.toThrow();
    expect(s.recentProvenance(200, 50)).toEqual([]);
  });
});
