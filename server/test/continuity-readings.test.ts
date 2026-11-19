// Overlord W1 door process B1 (plan `w1-door-process.md` Task 9): the hook reports' three readings, `offModelOf`,
// `modelDriftOf` and `readersRunning`, run against the shared oracle cases (the mutation floors run the same ones), and the
// off-model condition through the ladder.
import { describe, it, expect } from 'vitest';
import * as hookReports from '../src/continuity/hookReports.js';
import { modelDriftCases, offModelCases, offModelReadingCases, readersRunningCases } from './sim/hookReadingSets.js';

describe('offModelOf', () => { for (const [n, fn] of Object.entries(offModelCases(hookReports))) it(n, fn); });
describe('modelDriftOf', () => { for (const [n, fn] of Object.entries(modelDriftCases(hookReports))) it(n, fn); });
describe('readersRunning', () => { for (const [n, fn] of Object.entries(readersRunningCases(hookReports))) it(n, fn); });

// ---- The off-model condition through the ladder (Table 7.5a) ----
import { DatabaseSync } from 'node:sqlite';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { LADDER_CAUSE_MAP, LADDER_CAUSES, RUNGS, rungRank, type Rung } from '../../shared/overlord-ladder.js';
import * as ladder from '../src/coord/overlordLadder.js';
import { effectiveRung } from '../src/coord/overlordLadder.js';
import { ladderConditionInputs } from '../src/coord/overlordLadderRead.js';
import { insertHookReport, modelSwitchesSinceStart } from '../src/continuity/hookReportStore.js';
import type { GenRow } from '../src/continuity/continuityStore.js';

const facts = (operator: Rung | null, reading: 'standing' | 'lifted' | 'unmeasured') => effectiveRung({
  operatorRung: operator === null ? { kind: 'default' } : { kind: 'set', rung: operator }, latches: [],
  conditions: [{ cause: 'off-model', reading }], causeTable: LADDER_CAUSE_MAP, serverCaps: ['overlord-route-v1', 'overlord-answer-v1'],
});

describe('the off-model row', () => {
  it('is a condition, one under the operator, floor chat, no notice', () => {
    expect(LADDER_CAUSE_MAP['off-model']).toEqual({
      kind: 'condition', effect: { kind: 'one-under-operator', floor: 'chat' }, notice: 'none',
      spec: 'a generation off the designated model, its replay not passed (Table 7.5a)',
    });
    expect(LADDER_CAUSES).toContain('off-model');
  });
  it('standing lowers the rung one under the operator and never below chat', () => {
    expect(facts('full', 'standing').rung).toBe('advise');
    expect(facts('advise', 'standing').rung).toBe('chat');
    expect(facts('chat', 'standing').rung).toBe('chat');
    expect(facts(null, 'standing').rung).toBe('chat');
    expect(facts('off', 'standing').rung).toBe('off');   // the operator's own off is not the condition's doing
    for (const op of RUNGS.filter((r) => r !== 'off')) expect(rungRank(facts(op, 'standing').rung)).toBeGreaterThanOrEqual(rungRank('chat'));
  });
  it('unmeasured applies the effect too, lifted does not', () => {
    expect(facts('full', 'unmeasured').rung).toBe('advise');
    expect(facts('full', 'lifted').rung).toBe('full');
  });
});

const designated = (model: 'fable' | 'opus'): DesignationRead => ({ kind: 'designated', sessionId: 'lane-a', term: 1, row: { model } } as unknown as DesignationRead);

describe('offModelReading', () => { for (const [n, fn] of Object.entries(offModelReadingCases(ladder))) it(n, fn); });

describe('ladderConditionInputs: off-model', () => {
  const START = 5_000;
  const gen = (model: string | null) => ({ identity: 'overlord', sessionId: 'lane-a', state: 'active', shadowState: null, walk: null, model, startId: 1, startReportedAt: START }) as unknown as GenRow;
  const make = (o: { designation?: DesignationRead; model?: string | null; gens?: 'none' | 'throw' }) => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE continuity_hook_reports (id INTEGER PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL, key TEXT, agentId TEXT, detail TEXT, at INTEGER NOT NULL, receivedAt INTEGER NOT NULL);');
    // The generation's start row: received by the server at START (the hook stamped it START as well, unless a case moves it).
    db.exec(`CREATE TABLE continuity_starts (id INTEGER PRIMARY KEY, receivedAt INTEGER NOT NULL); INSERT INTO continuity_starts VALUES (1, ${START});`);
    const coord = {
      modelSwitchesOf: (id: string, startId: number) => modelSwitchesSinceStart(db, id, startId),
      designationRead: () => o.designation ?? designated('fable'),
      liveGenerations: () => { if (o.gens === 'throw') throw Error('x'); return { ok: true as const, rows: o.gens === 'none' ? [] : [gen(o.model === undefined ? 'claude-fable-5-1' : o.model)] }; },
      laneArmSetting: () => ({ kind: 'row' as const, choice: 'live' as const, updatedAt: 1, importedAt: null, imported: null }),
      ladderRungRead: () => ({ kind: 'default' as const }),
    };
    return { db, coord: coord as never };
  };
  const input = (c: ReturnType<typeof make>, sidecar?: never) => ladderConditionInputs({ coord: c.coord, serverCaps: [], continuityGate: () => null, sidecar })['off-model']();
  it('lifted with no designation or no live generation', () => {
    expect(input(make({ designation: { kind: 'not-designated', row: null } }))).toBe('lifted');
    expect(input(make({ gens: 'none' }))).toBe('lifted');
  });
  it('lifted on the designated class, standing on a different start class', () => {
    expect(input(make({}))).toBe('lifted');
    expect(input(make({ model: 'claude-opus-5-5' }))).toBe('standing');
  });
  it('unmeasured when the start model is unknown or the generations cannot be read', () => {
    expect(input(make({ model: null }))).toBe('unmeasured');
    expect(input(make({ gens: 'throw' }))).toBe('unmeasured');
  });
  it('a reported switch since the start stands, one before it does not, a typed-refused one never', () => {
    const c = make({});
    const put = (how: string, to: string, receivedAt: number) => insertHookReport(c.db, 'lane-a', { kind: 'model-switch', how, from: null, to, at: 1 } as never, receivedAt);
    put('switched', 'claude-opus-5-5', START - 1);
    expect(input(c)).toBe('lifted');
    put('typed-refused', 'claude-opus-5-5', START + 1);
    expect(input(c)).toBe('lifted');
    put('switched', 'claude-opus-5-5', START + 2);
    expect(input(c)).toBe('standing');
  });
  it('a fresh sidecar class that differs stands; a stale or absent one is no evidence', () => {
    const c = make({});
    expect(input(c, ((): { class: string; stale: boolean } => ({ class: 'opus', stale: false })) as never)).toBe('standing');
    expect(input(c, ((): { class: string; stale: boolean } => ({ class: 'opus', stale: true })) as never)).toBe('lifted');
    expect(input(c, (() => null) as never)).toBe('lifted');
  });
  it('the window is the server clock: a switch received after the start stands even when the hook stamped the start later', () => {
    const c = make({});
    // The hook's clock runs an hour ahead: its `startReportedAt` is START + 1h, but the server received the start at START.
    (c.coord as { liveGenerations: () => unknown }).liveGenerations = () => ({ ok: true, rows: [{ ...gen('claude-fable-5-1'), startReportedAt: START + 3_600_000 }] });
    insertHookReport(c.db, 'lane-a', { kind: 'model-switch', how: 'switched', from: null, to: 'claude-opus-5-5', at: 1 } as never, START + 10);
    expect(input(c)).toBe('standing');
  });
  it('a start row that cannot be found is unmeasured, never lifted', () => {
    const c = make({});
    c.db.exec('DELETE FROM continuity_starts');
    expect(input(c)).toBe('unmeasured');
  });
  it('an unreadable switch table is unmeasured, never lifted', () => {
    const c = make({});
    c.db.exec('DROP TABLE continuity_hook_reports');
    expect(input(c)).toBe('unmeasured');
  });
});
