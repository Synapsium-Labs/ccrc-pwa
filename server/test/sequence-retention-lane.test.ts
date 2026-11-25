// The one sequence's retention lane (Overlord spec §10.4; Table 11.5b's row "90 days | How long `overlord_sequence` is kept | W1 |
// wall"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 3). Pins `runSequenceRetentionLane`
// over a coord db opened through the real migrations: one pass deletes the lines older than 90 days by the wall clock, at most
// `SEQUENCE_PRUNE_BATCH` of them, raises the floor, keeps the newest designation line however old, deletes nothing while every
// line is young, logs one `ccrc-server:` line and deletes nothing when the sequence is unreadable or a prune fails, and that
// `FleetWatcher.sweepSequenceRetention` runs it through its `LANE_SCHEDULE` row.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { stampSequenceInTx, type SequenceLineInput } from '../src/coord/overlordSequenceStore.js';
import { sequencePage } from '../src/coord/overlordSequence.js';
import { runSequenceRetentionLane, type SequenceRetentionCoord } from '../src/coord/sequenceRetentionLane.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { SEQUENCE_KEEP_MS, SEQUENCE_PRUNE_BATCH } from '../../shared/overlord-sequence.js';
import { testDeps, withFakeClock } from './helpers.js';
import { fakeTime } from './fakeTime.js';
import { quietAtTestEnd } from './laneQuiet.js';   // D-8140: nothing a watcher fires outlives its test
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-seq-retention-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-seq-retention-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BASE = 1_700_000_000_000;
const NOW = BASE + 90 * DAY + HOUR;
const LINE: SequenceLineInput = { kind: 'generation', id: '7', state: 'carded', actor: 'server', actorKind: 'server', at: BASE };
const clockAt = (wall: number) => ({ wall: () => wall });
/** Stamps every line in ONE transaction, so a few thousand lines cost one commit. */
const stampAll = (db: DatabaseSync, lines: readonly Partial<SequenceLineInput>[]): void => {
  tx(db, () => { for (const l of lines) { const r = stampSequenceInTx(db, { ...LINE, ...l }); if (!r.ok) throw new Error(r.detail); } });
};
const seqs = (db: DatabaseSync): number[] => (db.prepare('SELECT seq FROM overlord_sequence ORDER BY seq').all() as { seq: number }[]).map((r) => Number(r.seq));
const floor = (db: DatabaseSync): unknown[] => db.prepare('SELECT through FROM overlord_sequence_pruned').all();
const pass = (coord: SequenceRetentionCoord, wall: number, logs: string[] = []): number =>
  runSequenceRetentionLane({ coord, clock: clockAt(wall), log: (l) => logs.push(l) });
const store = (db: DatabaseSync): CoordStore => new CoordStore(db);

describe('the retention lane: what one pass deletes', () => {
  it('with 91 daily lines, one pass deletes exactly the first day\'s, raises the floor to its seq and answers the count', () => {
    const db = openDb();
    stampAll(db, Array.from({ length: 91 }, (_, day) => ({ at: BASE + day * DAY })));
    expect(SEQUENCE_KEEP_MS).toBe(90 * DAY);
    expect(pass(store(db), NOW)).toBe(1);
    expect(seqs(db)).toEqual(Array.from({ length: 90 }, (_, i) => i + 2));
    expect(floor(db)).toEqual([{ through: 1 }]);
    expect(pass(store(db), NOW)).toBe(0);
    expect(floor(db)).toEqual([{ through: 1 }]);
  });

  it('a pass deletes at most SEQUENCE_PRUNE_BATCH lines: BATCH + 3 old lines take two passes', () => {
    const db = openDb();
    stampAll(db, Array.from({ length: SEQUENCE_PRUNE_BATCH + 3 }, () => ({ at: BASE })));
    const c = store(db);
    expect(pass(c, NOW)).toBe(SEQUENCE_PRUNE_BATCH);
    expect(floor(db)).toEqual([{ through: SEQUENCE_PRUNE_BATCH }]);
    expect(seqs(db)).toHaveLength(3);
    expect(pass(c, NOW)).toBe(3);
    expect(seqs(db)).toEqual([]);
    expect(floor(db)).toEqual([{ through: SEQUENCE_PRUNE_BATCH + 3 }]);
  });

  it('the newest designation line is kept however old, and the floor passes it, so a later page never serves it', () => {
    const db = openDb();
    stampAll(db, [
      { at: BASE },
      { kind: 'designation', id: 'overlord-quiet-otter', state: 'live', at: BASE },
      { at: BASE },
      { at: NOW },
    ]);
    expect(pass(store(db), NOW)).toBe(2);
    expect(seqs(db)).toEqual([2, 4]);
    expect(floor(db)).toEqual([{ through: 3 }]);
    const read = store(db).sequenceAfter(3, 10);
    if (read.kind !== 'measured') throw new Error(read.why);
    const page = sequencePage(3, 10, read.value.facts, read.value.lines, 'unmeasured');
    expect(page.kind === 'page' && page.lines.map((l) => l.seq)).toEqual([4]);
  });

  it('nothing is deleted while every line is younger than 90 days, and no floor row is written', () => {
    const db = openDb();
    stampAll(db, Array.from({ length: 5 }, (_, i) => ({ at: BASE + (i + 1) * DAY })));
    expect(pass(store(db), NOW)).toBe(0);
    expect(seqs(db)).toHaveLength(5);
    expect(floor(db)).toEqual([]);
  });
});

describe('the retention lane: an unreadable sequence and a failed prune', () => {
  const oldLine = { kind: 'measured' as const, value: [{ seq: 1, at: BASE, keep: false }] };

  it('a closed database logs exactly one line and deletes nothing', () => {
    const db = openDb();
    stampAll(db, [{ at: BASE }]);
    const c = store(db);
    db.close();
    const logs: string[] = [];
    expect(pass(c, NOW, logs)).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^ccrc-server: the sequence retention lane/);
  });

  it('an unmeasured read from the store logs one line, and never reaches the prune', () => {
    const logs: string[] = [];
    let pruned = 0;
    const coord: SequenceRetentionCoord = {
      sequenceOldest: () => ({ kind: 'unmeasured', why: 'x' }),
      pruneSequenceThrough: () => { pruned += 1; return { pruned: 0 }; },
    };
    expect(pass(coord, NOW, logs)).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^ccrc-server: the sequence retention lane/);
    expect(pruned).toBe(0);
  });

  it('a prune that answers an error logs one line and the pass deletes nothing', () => {
    const logs: string[] = [];
    const coord: SequenceRetentionCoord = { sequenceOldest: () => oldLine, pruneSequenceThrough: () => ({ error: 'e' }) };
    expect(pass(coord, NOW, logs)).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^ccrc-server: the sequence retention lane/);
  });
});

describe('FleetWatcher.sweepSequenceRetention: the lane through its row', () => {
  it('one call prunes the old lines of the seeded coord db', async () => {
    const db = openDb();
    stampAll(db, [{ at: BASE }, { at: BASE + 1 }, { at: NOW }]);
    const home = mkTmp('ccrc-seq-retention-w-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock({ ...testDeps(home), coord: store(db), time: fakeTime({ wallMs: NOW }).ports }), new Bus(), 2000));
    await w.sweepSequenceRetention();
    expect(seqs(db)).toEqual([3]);
    expect(floor(db)).toEqual([{ through: 2 }]);
  });
});
