// Child-reclamation wave 8: the kept-leaf item's two store reads (spec §5.9). The table is NEVER PRUNED
// (schema.ts), so the source read is bounded by a time window through `lifecycle_by_at`, and the ends
// read is bounded by the source's own ids through `lifecycle_by_session` — each ONE statement.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { StatementSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { CHILD_RECLAIM_LEAF_FAILED_TOKENS } from '../src/childReclaimSweep.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cr-leaf-store-'), '.ccrc', 'coord.db')));
const GEN = '1790000000000000000';
const T = 1_790_000_000_000;
const SINCE = T - 7 * 86_400_000;

let seq = 0;
const line = (id: string, act: string, outcome: string, at: number | null,
  over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({ uid: `w8leafst.1.${++seq}`, ...(at === null ? {} : { at }), act, outcome, id, ...over }));
const ingest = (s: CoordStore, rows: JournalRow[]): void => {
  s.ingestJournal({ gen: GEN, rows, cursor: 100 * rows.length, size: 100 * rows.length, at: 9 });
};
const kept = { meas: { childOf: '41', tmpRootKept: 'in-use' } };
const seed = (s: CoordStore): void => ingest(s, [
  line('demo-a', 'reclaim', 'done', T, { verb: 'ws-reclaim', ...kept, detail: 'kept' }),
  line('demo-b', 'reclaim', 'failed', T, { refusal: 'purge-incomplete', meas: { clipsKept: 'refused' } }),
  line('demo-c', 'reclaim', 'done', SINCE, { truncated: true }),                     // at the bound, cut to fit
  line('demo-d', 'reclaim', 'done', SINCE - 1, kept),                               // before the bound
  line('demo-e', 'reclaim', 'done', null, kept),                                     // undated
  line('demo-f', 'expire', 'done', T, kept),                                         // the shared tail's other act
  line('demo-g', 'reclaim', 'failed', T, { refusal: 'worktree-remove-failed', ...kept }),
  line('demo-h', 'reclaim', 'refused', T, { refusal: 'purge-refused', ...kept }),
  line('demo-i', 'reclaim', 'intent', T, kept),
  line('demo-j', 'reclaim', 'done', T),                                              // no meas, not cut
]);

describe('CoordStore.lifecycleReclaimRowsSince — the kept-leaf source, one bounded read', () => {
  it('returns the done and the three purge-failure reclaim rows at or after the bound that carry meas or were cut', () => {
    const s = store();
    seed(s);
    expect(s.lifecycleReclaimRowsSince(SINCE).map((r) => r.sessionId)).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });

  it('carries the mirror\'s id, ccd\'s at, the outcome, the token, the cut flag, the meas and ccd\'s line, unnarrowed', () => {
    const s = store();
    seed(s);
    const got = s.lifecycleReclaimRowsSince(SINCE);
    expect(got[0]).toMatchObject({ sessionId: 'demo-a', at: T, outcome: 'done', refusal: null, truncated: false, detail: 'kept' });
    expect(got[0]!.meas).toMatchObject({ childOf: '41', tmpRootKept: 'in-use', clipsKept: null });
    expect(got[1]).toMatchObject({ sessionId: 'demo-b', outcome: 'failed', refusal: 'purge-incomplete' });
    expect(got[2]).toMatchObject({ sessionId: 'demo-c', at: SINCE, truncated: true, meas: null });
    const ids = got.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(3);
  });

  it('seeks lifecycle_by_at, forced by a hint, never a scan of the table', () => {
    const s = store();
    seed(s);
    expect(CoordStore.lifecycleReclaimRowsSinceSql()).toContain('INDEXED BY lifecycle_by_at');
    const plan = s.db.prepare(`EXPLAIN QUERY PLAN ${CoordStore.lifecycleReclaimRowsSinceSql()}`)
      .all(SINCE, 'reclaim', 'done', 'failed', ...CHILD_RECLAIM_LEAF_FAILED_TOKENS) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' | ')).toContain('USING INDEX lifecycle_by_at');
  });
});

describe('CoordStore.lifecycleLeafEndsFor — what may end a kept-leaf item', () => {
  it('answers every asked id, with only its create and collect done rows, oldest first, carrying the mirror id', () => {
    const s = store();
    ingest(s, [
      line('demo-a', 'create', 'done', T),
      line('demo-a', 'create', 'refused', T + 1, { refusal: 'slug-taken' }),
      line('demo-a', 'create', 'intent', T + 2),
      line('demo-a', 'collect', 'done', null),
      line('demo-a', 'collect', 'refused', T + 3, { refusal: 'quarantine-kept' }),
      line('demo-a', 'reclaim', 'done', T + 4),
      line('demo-b', 'create', 'done', T + 5),
    ]);
    const got = s.lifecycleLeafEndsFor(['demo-a', 'demo-c']);
    expect([...got.keys()].sort()).toEqual(['demo-a', 'demo-c']);
    expect(got.get('demo-a')!.map((e) => [e.act, e.at])).toEqual([['create', T], ['collect', null]]);
    expect(got.get('demo-a')![0]!.id).toBeLessThan(got.get('demo-a')![1]!.id);
    expect(got.get('demo-c')).toEqual([]);
  });

  it('spends ONE statement for each read whatever the id count, and nothing for an empty ends request', () => {
    const s = store();
    seed(s);
    const prepare = vi.spyOn(s.db, 'prepare');
    const all = vi.spyOn(StatementSync.prototype, 'all');
    try {
      expect(s.lifecycleLeafEndsFor([])).toEqual(new Map());
      expect(prepare).not.toHaveBeenCalled();
      s.lifecycleLeafEndsFor(['demo-a', 'demo-b', 'demo-c', 'demo-a']);
      s.lifecycleReclaimRowsSince(SINCE);
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(all).toHaveBeenCalledTimes(2);
    } finally {
      all.mockRestore();
      prepare.mockRestore();
    }
  });
});
