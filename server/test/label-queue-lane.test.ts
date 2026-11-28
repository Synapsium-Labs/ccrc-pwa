// Overlord W2, the weekly label lane (plan w2-label-queue.md Task 4, LQ1, LQ2, LQ13; the coordinator's ruling on the gap, point a,
// and point 7): the week's budget, the open cap, an off row, a hidden card, a failed read, a restart, the states that cannot be
// drawn, and the quiet of a fleet with no row in shadow. The lane runs over a real coord.db and the real store.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { DECISION_QUESTIONS, type DecisionRowId } from '../../shared/decisionModel.js';
import { openCoordDb } from '../src/coord/db.js';
import { recordDecision } from '../src/coord/decisionModelStore.js';
import type { RefFound } from '../src/coord/labelQueue.js';
import { runLabelQueueLane, type LabelLaneDeps } from '../src/coord/labelQueueLane.js';
import type { LabelLaneReads, LabelRefFacts, MeasuredLabels } from '../src/coord/labelQueuePorts.js';
import { closeLabelCardInTx, labelLaneReadsOf, openLabelCards } from '../src/coord/labelQueueStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterAll(() => removeTmpFixtures());

const DAY = 86_400_000;
const MON = Date.UTC(2026, 10, 23, 9);   // Monday of 2026-W48
const NONE: MeasuredLabels = { labelsFor: () => [] };
const ALL_PRESENT: LabelRefFacts = { found: () => 'present' };

function freshDb(): DatabaseSync {
  return openCoordDb(path.join(mkTmp('ccrc-label-lane-'), 'coord.db'));
}
let seq = 0;
function record(db: DatabaseSync, row: DecisionRowId, stateHash: string, refs: Record<string, string | string[]> = {}): void {
  const q = DECISION_QUESTIONS[row];
  recordDecision(db, {
    row, revision: q.revision, modelId: 'model-a', hostKind: 'local', origin: 'http://127.0.0.1:1', stateHash, lineGen: 0,
    verdict: 'yes', p: 0.97, band: 'very-likely', ms: 5, refs, inline: q.privateState ? null : { part: stateHash }, at: (seq += 1000),
  });
}
const relay = (db: DatabaseSync, n: number, prefix = 's'): void => { for (let i = 0; i < n; i++) record(db, 'relay.method', `${prefix}${i}`); };
const readback = (db: DatabaseSync, hash: string, message = '3', mail = '12'): void =>
  record(db, 'readback.omits', hash, { request: message, readback: mail });
function setMode(db: DatabaseSync, row: DecisionRowId, mode: 'off' | 'shadow' | 'armed'): void {
  db.prepare(`INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES (?, ?, 600, 1, 'test')
    ON CONFLICT (row) DO UPDATE SET mode = excluded.mode`).run(row, mode);
}
function lane(db: DatabaseSync, at: number, o: { refs?: LabelRefFacts; reads?: LabelLaneReads } = {}) {
  const lines: string[] = [];
  const d: LabelLaneDeps = { reads: o.reads ?? labelLaneReadsOf(db, NONE), refs: o.refs ?? ALL_PRESENT, wall: () => at, warn: (l) => lines.push(l) };
  return { pass: runLabelQueueLane(d), lines };
}
const open = (db: DatabaseSync) => openLabelCards(db);
const answerAll = (db: DatabaseSync): void => {
  for (const c of open(db)) {
    closeLabelCardInTx(db, c.id, { outcome: 'labelled', label: 'yes', actor: 'device-a', at: 1, expect: { mode: 'shadow', revision: c.revision } });
  }
};

describe('no row in shadow (point 7)', () => {
  it('writes nothing and logs nothing, whatever is recorded', () => {
    const db = freshDb();
    relay(db, 5);
    const { pass, lines } = lane(db, MON);
    expect(pass.picked).toBe(0);
    expect(open(db)).toEqual([]);
    expect(lines).toEqual([]);
  });
});

describe('the week\'s budget and the open cap (LQ1, LQ2)', () => {
  it('a week\'s first pass picks up to ten, and a second pass that day picks nothing new', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    relay(db, 14);
    expect(lane(db, MON).pass.picked).toBe(10);
    expect(lane(db, MON + 1000).pass.picked).toBe(0);
    expect(open(db)).toHaveLength(10);
  });

  it('a case recorded mid-week is picked that week while the budget lasts, and never past ten', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    relay(db, 4);
    expect(lane(db, MON).pass.picked).toBe(4);
    answerAll(db);
    relay(db, 9, 'mid');
    expect(lane(db, MON + 2 * DAY).pass.picked).toBe(6);
    answerAll(db);
    expect(lane(db, MON + 3 * DAY).pass.picked).toBe(0);
  });

  it('an operator who answers nothing sees the same ten the next week, and no eleventh', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    relay(db, 20);
    lane(db, MON);
    const first = open(db).map((c) => c.id);
    expect(lane(db, MON + 7 * DAY).pass.picked).toBe(0);
    expect(open(db).map((c) => c.id)).toEqual(first);
  });

  it('a restart within the week picks nothing twice; across the week boundary it picks the new week\'s budget', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    relay(db, 30);
    lane(db, MON);
    answerAll(db);
    expect(lane(db, MON + DAY).pass.picked).toBe(0);
    expect(lane(db, MON + 7 * DAY).pass.picked).toBe(10);
  });
});

describe('an off row, a hidden card and a failed read (LQ13)', () => {
  it('an off row gets no card; a row back in shadow resumes', () => {
    const db = freshDb();
    relay(db, 3);
    setMode(db, 'relay.method', 'off');
    expect(lane(db, MON).pass.picked).toBe(0);
    setMode(db, 'relay.method', 'shadow');
    expect(lane(db, MON + 1000).pass.picked).toBe(3);
  });

  it('ten open cards, one of whose rows goes off: the next week picks one, because the hidden card is not counted open', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    setMode(db, 'readback.omits', 'shadow');
    relay(db, 12);
    readback(db, 'rb0');
    lane(db, MON);
    expect(open(db)).toHaveLength(10);
    expect(open(db).filter((c) => c.row === 'readback.omits')).toHaveLength(1);
    setMode(db, 'readback.omits', 'off');
    relay(db, 3, 'late');
    expect(lane(db, MON + 7 * DAY).pass.picked).toBe(1);
  });

  it('a row whose read throws is skipped and logged once, and the others are still picked', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    setMode(db, 'readback.omits', 'shadow');
    relay(db, 2);
    readback(db, 'rb0');
    const real = labelLaneReadsOf(db, NONE);
    const reads: LabelLaneReads = { ...real, waiting: (row, rev) => { if (row === 'readback.omits') throw new Error('boom'); return real.waiting(row, rev); } };
    const { pass, lines } = lane(db, MON, { reads });
    expect(pass.picked).toBe(2);
    expect(pass.failed).toEqual(['readback.omits']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/rows skipped \(read failed\): readback\.omits/);
  });
});

describe('states that cannot be drawn (the coordinator\'s ruling on the gap, point a)', () => {
  const refsOf = (m: Record<string, RefFound>): LabelRefFacts => ({ found: (kind, id) => m[`${kind}:${id}`] ?? 'unmeasured' });

  it('a state whose ref is proven absent, unmeasured or has no reader is not picked, and each is counted apart', () => {
    const db = freshDb();
    setMode(db, 'readback.omits', 'shadow');
    setMode(db, 'scope.widens', 'shadow');
    readback(db, 'ok', '1', '10');
    readback(db, 'gone', '2', '10');
    readback(db, 'unsure', '3', '10');
    record(db, 'scope.widens', 'goals', { cited: '1', goals: 'prog-a/pin/5' });
    const { pass, lines } = lane(db, MON, { refs: refsOf({ 'message:1': 'present', 'message:2': 'absent', 'mail:10': 'present' }) });
    expect(open(db).map((c) => c.stateHash)).toEqual(['ok']);
    expect(pass.undrawn).toEqual({ absent: 1, unmeasured: 1, 'no-reader': 1 });
    expect(lines).toEqual(['ccrc-server: label lane 2026-W48: picked 1; not drawable: absent 1, unmeasured 1, no-reader 1']);
  });

  it('an open card whose ref is later proven absent holds no slot; an unmeasured one still holds its slot', () => {
    const db = freshDb();
    setMode(db, 'readback.omits', 'shadow');
    setMode(db, 'relay.method', 'shadow');
    for (let i = 0; i < 10; i++) readback(db, `rb${i}`, String(i + 1), '10');
    lane(db, MON);
    expect(open(db)).toHaveLength(10);
    relay(db, 5);
    // Messages 1 and 2 withdrawn, message 3 unreadable: two slots free; the unmeasured card keeps its slot.
    const refs = refsOf(Object.fromEntries([
      ...Array.from({ length: 10 }, (_, i) => [`message:${i + 1}`, i < 2 ? 'absent' : i === 2 ? 'unmeasured' : 'present'] as const),
      ['mail:10', 'present'] as const,
    ]));
    expect(lane(db, MON + 7 * DAY, { refs }).pass.picked).toBe(2);
    expect(open(db)).toHaveLength(12);
  });

  it('the budget is re-read inside the pick: a card closed and re-picked elsewhere is never over ten', () => {
    const db = freshDb();
    setMode(db, 'relay.method', 'shadow');
    relay(db, 15);
    const real = labelLaneReadsOf(db, NONE);
    // Between the pass's read and the pick, another pass picks five.
    let raced = false;
    const reads: LabelLaneReads = { ...real, pick: (week, picks, at, budget) => {
      if (!raced) { raced = true; real.pick(week, picks.slice(5, 10), at, () => 5); }
      return real.pick(week, picks, at, budget);
    } };
    lane(db, MON, { reads });
    expect(open(db)).toHaveLength(10);
  });
});
