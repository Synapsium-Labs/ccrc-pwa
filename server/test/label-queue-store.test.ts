// Overlord W2, the label cards and the labels (plan w2-label-queue.md Task 3): one card per state, the budget re-read inside
// the pick's transaction, the close and its label in one transaction with its compare, the store that never filters, labels
// keyed by state (LQ7), measured labels read and never stored (LQ8), and no text in either table.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { DECISION_QUESTIONS, type DecisionRowId } from '../../shared/decisionModel.js';
import { openCoordDb } from '../src/coord/db.js';
import { recordDecision } from '../src/coord/decisionModelStore.js';
import {
  closeLabelCardInTx, labelCardById, labelCardCounts, labelLaneReadsOf, labelledAnswersOf, labelledCasesOf, labelRefFactsOf, openLabelCards,
  pickLabelCardsInTx, waitingStates,
} from '../src/coord/labelQueueStore.js';
import type { MeasuredLabels } from '../src/coord/labelQueuePorts.js';
import { utcIsoWeek } from '../src/time/rules.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterAll(() => removeTmpFixtures());

const ROW: DecisionRowId = 'relay.method';
const REV = DECISION_QUESTIONS[ROW].revision;
const WEEK = '2026-W48';
const MON = Date.UTC(2026, 10, 23);
const NONE: MeasuredLabels = { labelsFor: () => [] };

function freshDb(): DatabaseSync {
  return openCoordDb(path.join(mkTmp('ccrc-label-store-'), 'coord.db'));
}
let at = MON;
function record(db: DatabaseSync, stateHash: string, o: { row?: DecisionRowId; revision?: string; modelId?: string; origin?: string;
  verdict?: 'yes' | 'no'; p?: number; refs?: Record<string, string>; inline?: Record<string, string> | null } = {}): number {
  const row = o.row ?? ROW;
  const r = recordDecision(db, {
    row, revision: o.revision ?? DECISION_QUESTIONS[row].revision, modelId: o.modelId ?? 'model-a', hostKind: 'local',
    origin: o.origin ?? 'http://127.0.0.1:1', stateHash, lineGen: 0, verdict: o.verdict ?? 'yes', p: o.p ?? 0.97, band: 'very-likely',
    ms: 5, refs: o.refs ?? {}, inline: o.inline === undefined ? (DECISION_QUESTIONS[row].privateState ? null : { part: `text of ${stateHash}` }) : o.inline,
    at: (at += 1000),
  });
  return r.id;
}
function setMode(db: DatabaseSync, row: DecisionRowId, mode: 'off' | 'shadow' | 'armed'): void {
  db.prepare(`INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES (?, ?, 600, 1, 'test')
    ON CONFLICT (row) DO UPDATE SET mode = excluded.mode`).run(row, mode);
}
const pick = (db: DatabaseSync, hashes: readonly string[], budget = 10, week = WEEK): { picked: number } =>
  pickLabelCardsInTx(db, week, hashes.map((h) => ({ row: ROW, revision: REV, stateHash: h, recordId: 1 })), MON, () => budget);
const SHADOW = { mode: 'shadow' as const, revision: REV };

describe('pickLabelCardsInTx', () => {
  it('two picks of one state insert one card', () => {
    const db = freshDb();
    expect(pick(db, ['s1'])).toEqual({ picked: 1 });
    expect(pick(db, ['s1'])).toEqual({ picked: 0 });
    expect(openLabelCards(db)).toHaveLength(1);
  });

  it('reads the budget inside the transaction: a budget of 3 inserts 3 of 5', () => {
    const db = freshDb();
    let calls = 0;
    const r = pickLabelCardsInTx(db, WEEK, ['a', 'b', 'c', 'd', 'e'].map((h) => ({ row: ROW, revision: REV, stateHash: h, recordId: 1 })), MON,
      () => { calls++; expect(db.isTransaction).toBe(true); return 3; });
    expect(r).toEqual({ picked: 3 });
    expect(calls).toBe(1);
    expect(openLabelCards(db).map((c) => c.stateHash)).toEqual(['a', 'b', 'c']);
  });

  it('a state already carded does not use the budget', () => {
    const db = freshDb();
    pick(db, ['a']);
    expect(pick(db, ['a', 'b', 'c'], 2)).toEqual({ picked: 2 });
    expect(openLabelCards(db).map((c) => c.stateHash)).toEqual(['a', 'b', 'c']);
  });
});

describe('closeLabelCardInTx', () => {
  it('writes the card and the label together, and a second close answers already', () => {
    const db = freshDb();
    setMode(db, ROW, 'shadow');
    pick(db, ['s1']);
    const id = openLabelCards(db)[0]!.id;
    expect(closeLabelCardInTx(db, id, { outcome: 'labelled', label: 'no', actor: 'device-a', at: 50, expect: SHADOW })).toBe('closed');
    expect(labelCardById(db, id)).toMatchObject({ closedAt: 50, closedBy: 'device-a', outcome: 'labelled' });
    expect(db.prepare('SELECT row, revision, stateHash, label, source, cardId, actor, at FROM decision_labels').all())
      .toEqual([{ row: ROW, revision: REV, stateHash: 's1', label: 'no', source: 'label-queue', cardId: id, actor: 'device-a', at: 50 }]);
    expect(closeLabelCardInTx(db, id, { outcome: 'labelled', label: 'yes', actor: 'device-b', at: 60, expect: SHADOW })).toBe('already');
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_labels').get()).toEqual({ n: 1 });
  });

  it('not-sure closes the card and writes no label', () => {
    const db = freshDb();
    setMode(db, ROW, 'armed');
    pick(db, ['s1']);
    const id = openLabelCards(db)[0]!.id;
    expect(closeLabelCardInTx(db, id, { outcome: 'not-sure', label: null, actor: 'device-a', at: 50, expect: { mode: 'armed', revision: REV } })).toBe('closed');
    expect(labelCardById(db, id)).toMatchObject({ outcome: 'not-sure' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_labels').get()).toEqual({ n: 0 });
  });

  it('a close whose expect no longer matches the row answers moved and writes nothing', () => {
    const db = freshDb();
    setMode(db, ROW, 'shadow');
    pick(db, ['s1']);
    const id = openLabelCards(db)[0]!.id;
    setMode(db, ROW, 'off');
    expect(closeLabelCardInTx(db, id, { outcome: 'labelled', label: 'yes', actor: 'device-a', at: 50, expect: SHADOW })).toBe('moved');
    setMode(db, ROW, 'shadow');
    expect(closeLabelCardInTx(db, id, { outcome: 'labelled', label: 'yes', actor: 'device-a', at: 50, expect: { mode: 'shadow', revision: 'ffffffffffffffff' } })).toBe('moved');
    expect(labelCardById(db, id)).toMatchObject({ closedAt: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_labels').get()).toEqual({ n: 0 });
  });

  it('an unknown card is absent; a labelled close without a label is a programming error', () => {
    const db = freshDb();
    expect(closeLabelCardInTx(db, 99, { outcome: 'not-sure', label: null, actor: 'a', at: 1, expect: SHADOW })).toBe('absent');
    expect(() => closeLabelCardInTx(db, 99, { outcome: 'labelled', label: null, actor: 'a', at: 1, expect: SHADOW })).toThrow(/carries a label/);
  });
});

describe('the reads', () => {
  it('openLabelCards answers a card whose row went off (the store never filters), and the counts carry no open', () => {
    const db = freshDb();
    setMode(db, ROW, 'shadow');
    pick(db, ['s1', 's2']);
    setMode(db, ROW, 'off');
    expect(openLabelCards(db).map((c) => c.stateHash)).toEqual(['s1', 's2']);
    const counts = labelCardCounts(db, WEEK);
    expect(Object.keys(counts).sort()).toEqual(['lastCardWeekStart', 'pickedThisWeek']);
    expect(counts.pickedThisWeek).toBe(2);
    expect(counts.lastCardWeekStart.get(ROW)).toBe(utcIsoWeek(MON).start);
    expect(labelCardCounts(db, '2026-W49').pickedThisWeek).toBe(0);
  });

  it('a waiting state has a record, no label from any source and no card, and is its newest record', () => {
    const db = freshDb();
    setMode(db, ROW, 'shadow');
    record(db, 'carded');
    record(db, 'stored');
    record(db, 'measured');
    record(db, 'old', { modelId: 'model-a' });
    const newest = record(db, 'old', { modelId: 'model-b' });
    record(db, 'otherrev', { revision: 'ffffffffffffffff' });
    pick(db, ['carded', 'stored']);
    const storedId = openLabelCards(db).find((c) => c.stateHash === 'stored')!.id;
    closeLabelCardInTx(db, storedId, { outcome: 'labelled', label: 'yes', actor: 'a', at: 1, expect: SHADOW });
    const measured: MeasuredLabels = { labelsFor: () => [{ stateHash: 'measured', source: 'operator-answer', label: 'no', at: 1 }] };
    const w = waitingStates(db, measured, ROW, REV);
    expect(w.map((s) => s.stateHash)).toEqual(['old']);
    expect(w[0]!.recordId).toBe(newest);
  });

  it('the newest record of a state is the store order among the revision, whatever the host (point 4)', () => {
    const db = freshDb();
    record(db, 's1', { origin: 'http://127.0.0.1:1', verdict: 'yes', p: 0.99 });
    const second = record(db, 's1', { origin: 'http://127.0.0.1:2', verdict: 'no', p: 0.2 });
    expect(waitingStates(db, NONE, ROW, REV)).toEqual([expect.objectContaining({ stateHash: 's1', recordId: second, verdict: 'no', p: 0.2 })]);
  });
});

describe('labelledCasesOf and labelledAnswersOf', () => {
  it('a stored label and a measured one on two states both answer, with the newest record\'s refs and inline', () => {
    const db = freshDb();
    setMode(db, ROW, 'shadow');
    record(db, 's1', { inline: { part: 'one' } });
    record(db, 's2', { inline: { part: 'two' }, verdict: 'no', p: 0.4 });
    pick(db, ['s1']);
    closeLabelCardInTx(db, openLabelCards(db)[0]!.id, { outcome: 'labelled', label: 'yes', actor: 'a', at: 5, expect: SHADOW });
    const measured: MeasuredLabels = { labelsFor: () => [{ stateHash: 's2', source: 'operator-answer', label: 'no', at: 5 }] };
    expect(labelledCasesOf(db, measured).casesFor(ROW, REV)).toEqual([
      { refs: {}, inline: { part: 'one' }, label: 'yes' },
      { refs: {}, inline: { part: 'two' }, label: 'no' },
    ]);
    expect(labelledAnswersOf(db, measured, ROW, REV)).toEqual([
      { p: 0.97, verdict: 'yes', label: 'yes' },
      { p: 0.4, verdict: 'no', label: 'no' },
    ]);
  });

  it('an outcome on the same state retires a measured answer', () => {
    const db = freshDb();
    record(db, 's1');
    const measured: MeasuredLabels = { labelsFor: () => [
      { stateHash: 's1', source: 'operator-answer', label: 'yes', at: 10 },
      { stateHash: 's1', source: 'outcome', label: 'no', at: 5 },
    ] };
    expect(labelledCasesOf(db, measured).casesFor(ROW, REV).map((c) => c.label)).toEqual(['no']);
  });

  it('a label of another revision is not answered, and a host or model change keeps the label (LQ7)', () => {
    const db = freshDb();
    setMode(db, ROW, 'shadow');
    record(db, 's1', { modelId: 'model-a' });
    pick(db, ['s1']);
    closeLabelCardInTx(db, openLabelCards(db)[0]!.id, { outcome: 'labelled', label: 'yes', actor: 'a', at: 5, expect: SHADOW });
    record(db, 's1', { modelId: 'model-b', origin: 'http://127.0.0.1:9', inline: { part: 'rebuilt' } });
    expect(labelledCasesOf(db, NONE).casesFor(ROW, REV)).toEqual([{ refs: {}, inline: { part: 'rebuilt' }, label: 'yes' }]);
    expect(labelledCasesOf(db, NONE).casesFor(ROW, 'ffffffffffffffff')).toEqual([]);
  });

  it('a case carries refs and inline from its record, never text from the card', () => {
    const db = freshDb();
    setMode(db, 'scope.widens', 'shadow');
    record(db, 's1', { row: 'scope.widens', refs: { cited: '7', goals: 'prog-a/pin/3' }, inline: null });
    pickLabelCardsInTx(db, WEEK, [{ row: 'scope.widens', revision: DECISION_QUESTIONS['scope.widens'].revision, stateHash: 's1', recordId: 1 }], MON, () => 1);
    closeLabelCardInTx(db, openLabelCards(db)[0]!.id, { outcome: 'labelled', label: 'no', actor: 'a', at: 5,
      expect: { mode: 'shadow', revision: DECISION_QUESTIONS['scope.widens'].revision } });
    expect(labelledCasesOf(db, NONE).casesFor('scope.widens', DECISION_QUESTIONS['scope.widens'].revision))
      .toEqual([{ refs: { cited: '7', goals: 'prog-a/pin/3' }, inline: null, label: 'no' }]);
  });
});

describe('the lane reads', () => {
  it('mode goes through the decision model\'s row read: an absent row reads off, an unreadable one unreadable', () => {
    const db = freshDb();
    const reads = labelLaneReadsOf(db, NONE);
    expect(reads.mode(ROW)).toBe('off');
    setMode(db, ROW, 'shadow');
    expect(reads.mode(ROW)).toBe('shadow');
    db.prepare("UPDATE decision_rows SET ceiling = 1 WHERE row = ?").run(ROW);
    expect(reads.mode(ROW)).toBe('unreadable');
  });

  it('a measured read that throws makes the waiting read throw, never an empty list', () => {
    const db = freshDb();
    record(db, 's1');
    const broken: MeasuredLabels = { labelsFor: () => { throw new Error('unreadable'); } };
    expect(() => labelLaneReadsOf(db, broken).waiting(ROW, REV)).toThrow(/unreadable/);
  });
});

describe('labelRefFactsOf: present, absent or unmeasured, never folded', () => {
  const measured = (value: unknown) => ({ kind: 'measured' as const, value });
  it('a message by its facts read, a mail by its row', () => {
    const f = labelRefFactsOf({ messageFactsById: (id) => measured(id === 1 ? { id: 1 } : 'absent') }, { mailOrigin: (id) => (id === 5 ? { body: 'x' } : null) });
    expect([f.found('message', 1), f.found('message', 2), f.found('mail', 5), f.found('mail', 6)]).toEqual(['present', 'absent', 'present', 'absent']);
  });
  it('no private store, an unmeasured read and a throw are unmeasured', () => {
    expect(labelRefFactsOf(undefined, { mailOrigin: () => null }).found('message', 1)).toBe('unmeasured');
    expect(labelRefFactsOf({ messageFactsById: () => ({ kind: 'unmeasured' }) }, { mailOrigin: () => null }).found('message', 1)).toBe('unmeasured');
    expect(labelRefFactsOf(undefined, { mailOrigin: () => { throw new Error('locked'); } }).found('mail', 1)).toBe('unmeasured');
  });
});

describe('no text in the label store (LQ11)', () => {
  it('the two tables hold ids, words, hashes and times only', () => {
    const db = freshDb();
    const cols = (t: string): string[] => (db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[]).map((c) => c.name);
    expect(cols('label_cards')).toEqual(['id', 'week', 'row', 'revision', 'stateHash', 'recordId', 'pickedAt', 'closedAt', 'closedBy', 'outcome']);
    expect(cols('decision_labels')).toEqual(['id', 'row', 'revision', 'stateHash', 'label', 'source', 'cardId', 'actor', 'at']);
  });
});
