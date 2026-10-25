// The drift push budget (coordinator-durability tail spec §4.4; D-5922): one pure L1 function over plain rows.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { DRIFT_PUSH_AGE_MS, type DriftFindingRow } from '../src/coord/drift.js';
import { DRIFT_DAY_CAP, DRIFT_PASS_CAP, chooseDriftPushes, type DriftPushInput } from '../src/coord/driftPush.js';

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const row = (n: number, o: Partial<DriftFindingRow> = {}): DriftFindingRow => ({
  key: `run-quiet:${n}`, kind: 'run-quiet', subject: '{}', detail: `run ${n} quiet`, factAt: NOW - 2 * DRIFT_PUSH_AGE_MS - n,
  runId: n, sessionId: null, firstSeenAt: NOW - H, lastSeenAt: NOW, clearedAt: null, pushedAt: null, pushedVia: null,
  shadowAt: null, ...o,
});
const input = (rows: DriftFindingRow[], o: Partial<DriftPushInput> = {}): DriftPushInput => ({
  rows, tableWasEmpty: false, armed: true, deadCoordinatorArmed: false,
  told: { quietRuns: new Set(), stuckDeliveries: new Set() }, escalatedDeliveries: new Set(), pushedToday: 0, now: NOW, ...o,
});
const keys = (rs: readonly DriftFindingRow[]): string[] => rs.map((r) => r.key);

describe('chooseDriftPushes', () => {
  it('pushes a finding only once its age passes 24 h, measured from the fact\'s own time', () => {
    const under = row(1, { factAt: NOW - DRIFT_PUSH_AGE_MS });
    const over = row(2, { factAt: NOW - DRIFT_PUSH_AGE_MS - 1 });
    expect(keys(chooseDriftPushes(input([under, over])).items)).toEqual(['run-quiet:2']);
  });
  it('ages from firstSeenAt when the fact has no time of its own', () => {
    const r = row(1, { factAt: null, firstSeenAt: NOW - DRIFT_PUSH_AGE_MS - 1 });
    expect(keys(chooseDriftPushes(input([r])).items)).toEqual(['run-quiet:1']);
  });
  it('never offers a pushed, cleared or question-orphaned finding', () => {
    const rows = [row(1, { pushedAt: NOW - H, pushedVia: 'item' }), row(2, { clearedAt: NOW - H }),
      row(3, { key: 'question-orphaned:ask:3', kind: 'question-orphaned', runId: null, sessionId: 'w' })];
    const plan = chooseDriftPushes(input(rows));
    expect([plan.items, plan.summary, plan.shadow].map((x) => x.length)).toEqual([0, 0, 0]);
  });
  it('four crossings in one pass push 3, the 4th next pass', () => {
    const rows = [1, 2, 3, 4].map((n) => row(n));
    expect(chooseDriftPushes(input(rows)).items).toHaveLength(DRIFT_PASS_CAP);
    expect(DRIFT_PASS_CAP).toBe(3);
  });
  it('thirteen crossings in a day push 12: the day\'s room is what the table already counted', () => {
    const rows = [1, 2, 3].map((n) => row(n));
    expect(chooseDriftPushes(input(rows, { pushedToday: 10 })).items).toHaveLength(2);
    expect(chooseDriftPushes(input(rows, { pushedToday: DRIFT_DAY_CAP })).items).toHaveLength(0);
    expect(chooseDriftPushes(input(rows, { pushedToday: DRIFT_DAY_CAP + 5 })).items).toHaveLength(0);
  });
  it('an empty table folds every due finding into one summary and pushes no item', () => {
    const plan = chooseDriftPushes(input([1, 2, 3, 4, 5].map((n) => row(n)), { tableWasEmpty: true }));
    expect(plan.summary).toHaveLength(5);
    expect(plan.items).toHaveLength(0);
  });
  it('a live stall rung on the run, or on the delivery, suppresses the push; the finding stays listed', () => {
    const quiet = row(1);
    const held = row(7, { key: 'mail-held:7', kind: 'mail-held', runId: null, sessionId: 'w' });
    const plan = chooseDriftPushes(input([quiet, held], {
      told: { quietRuns: new Set([1]), stuckDeliveries: new Set([7]) } }));
    expect(plan.items).toHaveLength(0);
  });
  it('a delivery whose own park push already went is not pushed again', () => {
    const parked = row(9, { key: 'mail-parked:9', kind: 'mail-parked', runId: null, sessionId: 'w' });
    expect(chooseDriftPushes(input([parked], { escalatedDeliveries: new Set([9]) })).items).toHaveLength(0);
    expect(chooseDriftPushes(input([parked])).items).toHaveLength(1);
  });
  it('claimant-gone is pushed while the dead-coordinator lane is unarmed and listed only once it is armed', () => {
    const gone = row(4, { key: 'claimant-gone:program-a:coord-a', kind: 'claimant-gone' });
    expect(chooseDriftPushes(input([gone])).items).toHaveLength(1);
    expect(chooseDriftPushes(input([gone], { deadCoordinatorArmed: true })).items).toHaveLength(0);
  });
  it('unarmed, the due findings go to the shadow record once each and nothing is pushed', () => {
    const plan = chooseDriftPushes(input([row(1), row(2, { shadowAt: NOW - H })], { armed: false, tableWasEmpty: true }));
    expect(keys(plan.shadow)).toEqual(['run-quiet:1']);
    expect(plan.items).toHaveLength(0);
    expect(plan.summary).toHaveLength(0);
  });
  it('the same input answers the same plan', () => {
    const rows = [3, 1, 2].map((n) => row(n));
    expect(chooseDriftPushes(input(rows))).toEqual(chooseDriftPushes(input([...rows].reverse())));
  });
  it('imports no IO module', () => {
    const src = readFileSync(path.join(import.meta.dirname, '../src/coord/driftPush.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports.filter((i) => !i!.startsWith('.') && !i!.startsWith('../../../shared/'))).toEqual([]);
    expect(imports.filter((i) => i!.includes('store') || i!.includes('reclaim') || i!.includes('notice'))).toEqual([]);
  });
});
