// #166 wave 10 (path-identity spec 2026-10-12 §5.4): the ONE latch helper, `collectRetireLatch`, and the control read
// it stands on, `collectControlNow`. The helper retires the legacy marker's latch through the store's one writer only
// when L1's `collectLatchDue` says so. That needs a listing that is coherent, unpaused, listed, on the same epoch, and
// that proves the marker absent while the latch is unset. The helper never heals a mismatch, writes its one row only on
// `retired`, and is synchronous. A REAL store and a REAL journal adapter under a fixture HOME, with a recording wrapper
// on the writer; a fake journal only where a failure cannot be built on disk. FIXTURE HOME ONLY.
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type CollectLaneWrite } from '../src/coord/store.js';
import { collectLaneJournalAt, defaultCollectLaneJournalPath } from '../src/coord/collectLaneJournal.js';
import { collectControlNow, collectRetireLatch, type CollectControlDeps } from '../src/coord/collectTempRoot.js';
import {
  collectLatchFeedBody, measureCollectLaneRow, type CollectEpochPair, type CollectLaneJournal, type CollectLaneSwitches,
  type CollectLaneWriteRequest,
} from '../src/collectLane.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const AT = 1_790_000_000_000;
const ABSENT: CollectLaneSwitches = { paused: false, marker: false };
const SAME: CollectEpochPair = { before: 3, after: 3 };
const ENOSPC = (): never => {
  throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
};

interface Built {
  readonly c: CollectControlDeps;
  readonly coord: CoordStore;
  readonly journal: CollectLaneJournal & { readonly logPath: string };
  readonly writes: CollectLaneWriteRequest[];
  readonly answers: CollectLaneWrite[];
  readonly rows: string[];
  /** Row fields planted straight into SQLite (`SET <sql>`), never through the writer. */
  plant(sql: string): void;
}
/** A real store and a real journal under a fresh fixture HOME, the writer wrapped to record each request and answer.
 *  - `journal`: the real adapter, none at all (a server built without one), or one whose append fails.
 *  - `beforeWrite`: runs inside the writer's call, before the store's transaction (another writer, landing between the
 *    read and the write). */
const built = (o: {
  readonly journal?: 'real' | 'none' | 'append-fails'; readonly beforeWrite?: (coord: CoordStore) => void;
} = {}): Built => {
  const ccrcDir = path.join(mkTmp('ccrc-collect-latch-'), '.ccrc');
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const real = collectLaneJournalAt(defaultCollectLaneJournalPath(ccrcDir));
  const writes: CollectLaneWriteRequest[] = [];
  const answers: CollectLaneWrite[] = [];
  const rows: string[] = [];
  const journal: CollectLaneJournal | null = o.journal === 'none' ? null
    : o.journal === 'append-fails' ? { read: () => real.read(), appendGeneration: ENOSPC } : real;
  const c: CollectControlDeps = {
    coord: {
      collectLaneRow: () => coord.collectLaneRow(),
      setCollectLane: (req, at, j) => {
        writes.push(req);
        o.beforeWrite?.(coord);
        const a = coord.setCollectLane(req, at, j);
        answers.push(a);
        return a;
      },
    },
    journal, wallNow: () => AT, latchRetired: (body) => { rows.push(body); },
  };
  return {
    c, coord, journal: real, writes, answers, rows,
    plant: (sql) => { coord.db.prepare(`UPDATE collect_lane_settings SET ${sql} WHERE id = 1`).run(); },
  };
};

describe('the one latch helper (§5.4)', () => {
  it.each<[string, (b: Built) => void, CollectLaneSwitches, CollectEpochPair]>([
    ['a raised pause', () => {}, { paused: true, why: 'raised', marker: false }, SAME],
    ['an unlistable registry', () => {}, { paused: true, why: 'unlistable' }, SAME],
    ['an epoch that moved', () => {}, ABSENT, { before: 3, after: 4 }],
    ['the marker standing', () => {}, { paused: false, marker: true }, SAME],
    ['the latch already set', (b) => { b.plant('markerRetiredAt = 5, generation = 1, updatedAt = 1'); b.journal.appendGeneration(1); },
      ABSENT, SAME],
    ['a mismatch, the journal behind', (b) => { b.plant('generation = 2, updatedAt = 1'); b.journal.appendGeneration(1); },
      ABSENT, SAME],
    ['a mismatch, the journal ahead', (b) => {
      b.plant('generation = 1, updatedAt = 1'); b.journal.appendGeneration(1); b.journal.appendGeneration(2);
    }, ABSENT, SAME],
    ['an unmeasurable control state (a torn journal)', (b) => { writeFileSync(b.journal.logPath, '{"generation":'); }, ABSENT, SAME],
  ])('not-due for each failing condition, with no store call: %s', (_what, plant, switches, epoch) => {
    const b = built();
    plant(b);
    expect(collectRetireLatch(b.c, switches, epoch)).toEqual({ kind: 'not-due' });
    expect(b.writes, 'the writer was never called').toEqual([]);
    expect(b.rows).toEqual([]);
  });

  it('retired calls setCollectLane once, with the pair it read', () => {
    const b = built();
    const row = b.coord.collectLaneRow();
    const journal = b.journal.read();
    expect(collectRetireLatch(b.c, ABSENT, SAME)).toEqual({ kind: 'retired' });
    expect(b.writes).toEqual([{ kind: 'retire', expected: row, expectedJournal: journal }]);
    expect(b.journal.read(), 'the generation journaled').toMatchObject({ kind: 'ok', max: 1 });
    expect(measureCollectLaneRow(b.coord.collectLaneRow()))
      .toMatchObject({ kind: 'row', row: { choice: 'off', fleetNodeId: null, markerRetiredAt: AT, generation: 1 } });
  });

  it('latchRetired is called exactly once, on retired only', () => {
    const b = built();
    expect(collectRetireLatch(b.c, ABSENT, SAME)).toEqual({ kind: 'retired' });
    expect(collectRetireLatch(b.c, ABSENT, SAME), 'the latch is set now: not due').toEqual({ kind: 'not-due' });
    expect(b.rows).toEqual([collectLatchFeedBody('collect sweep')]);
    expect(b.writes).toHaveLength(1);
  });

  it('refused and failed pass through', () => {
    const refused = built({
      beforeWrite: (coord) => { coord.db.prepare('UPDATE collect_lane_settings SET updatedAt = 2 WHERE id = 1').run(); },
    });
    refused.plant('generation = 1, updatedAt = 1');
    refused.journal.appendGeneration(1);                    // coherent at generation 1, the latch unset
    const out = collectRetireLatch(refused.c, ABSENT, SAME);
    const answer = refused.answers[0];
    expect(answer?.kind, 'the store refused: another writer moved the row between the read and the write').toBe('refused');
    expect(out).toEqual({ kind: 'refused', code: answer?.kind === 'refused' ? answer.code : null });
    expect(refused.rows, 'no row on a refusal').toEqual([]);
    const failed = built({ journal: 'append-fails' });
    expect(collectRetireLatch(failed.c, ABSENT, SAME)).toEqual({ kind: 'failed', phase: 'append' });
    expect(failed.rows, 'no row on a failure').toEqual([]);
    expect(measureCollectLaneRow(failed.coord.collectLaneRow()).kind, 'the row is untouched').toBe('seed');
  });

  it('a null journal is never due', () => {
    const b = built({ journal: 'none' });
    expect(collectRetireLatch(b.c, ABSENT, SAME)).toEqual({ kind: 'not-due' });
    expect(b.writes).toEqual([]);
  });

  it('a store that throws before its append answers store-threw, writes nothing, and never throws', () => {
    // A REAL throw from the store's own BEGIN: a transaction already open on its connection makes `BEGIN IMMEDIATE` throw
    // at once, as a busy database does after its timeout. `setCollectLane` propagates a throw before its append by design
    // (Task 6); the helper answers it (the coordinator's extension of the warn-latch ruling, 2026-10-12).
    const b = built({ beforeWrite: (coord) => { coord.db.exec('BEGIN'); } });
    let out: unknown;
    try {
      expect(() => { out = collectRetireLatch(b.c, ABSENT, SAME); }, 'the helper never throws').not.toThrow();
    } finally {
      b.coord.db.exec('ROLLBACK');
    }
    expect(out).toEqual({ kind: 'store-threw' });
    expect(b.writes, 'the store was asked once').toHaveLength(1);
    expect(b.answers, 'and answered nothing: it threw').toEqual([]);
    expect(b.rows, 'no row on a throw').toEqual([]);
    expect(b.journal.read(), 'nothing appended').toEqual({ kind: 'missing' });
    expect(measureCollectLaneRow(b.coord.collectLaneRow()).kind, 'the row is untouched').toBe('seed');
  });

  it('it is synchronous', () => {
    const out: unknown = collectRetireLatch(built().c, ABSENT, SAME);
    expect(out instanceof Promise, 'a Promise: something awaits inside the helper').toBe(false);
    expect(out).toEqual({ kind: 'retired' });
  });
});

describe('collectControlNow reads the switch as it stands (path-identity spec §5.2)', () => {
  it('a server built with no journal reads not-configured, never missing; the real one reads the bootstrap', () => {
    expect(collectControlNow(built({ journal: 'none' }).c))
      .toMatchObject({ journal: { kind: 'not-configured' }, control: { kind: 'unmeasurable', why: 'journal-not-configured' } });
    expect(collectControlNow(built().c))
      .toMatchObject({ row: { kind: 'row' }, journal: { kind: 'missing' }, control: { kind: 'coherent', generation: 0, bootstrap: true } });
  });
});
