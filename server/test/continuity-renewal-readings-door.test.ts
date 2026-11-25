// Overlord W1, the renewal readings PR E (plan `w1-renewal-readings.md`, Task 8): the Overlord's `modelDrift` (hard) and the soft
// `readersRunning`, from door process B1's functions passed through unchanged. The L1 mappers' cases are written once in
// `sim/renewalReadingDoorSets.ts` and run here against the real module (the floors run them against each mutant); then the
// store's reader-events read by the start row, the wiring, and the two decisions they reach (`renewalDue`, `softRenewalMay`).
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import * as readings from '../src/continuity/renewalReadings.js';
import { modelDriftInputCases, modelDriftReadingCases, readersRunningReadingCases } from './sim/renewalReadingDoorSets.js';
import { insertHookReport, readerEventsSinceStart, modelSwitchesSinceStart } from '../src/continuity/hookReportStore.js';
import { renewalReadingsOf, type ReadingsCoord } from '../src/continuity/renewalReadingsWiring.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { GenReadings } from '../src/continuity/generationsLane.js';
import type { UsageRead } from '../src/usage.js';
import { renewalDue } from '../src/continuity/renewalDue.js';
import { softRenewalMay } from '../src/continuity/softRenewal.js';
import { renewalBase, softBase } from './sim/renewalDeciderSets.js';
import { READER_STALE_MS } from '../../shared/continuity-reports.js';

afterEach(removeTmpFixtures);

describe('modelDriftInputOf', () => { for (const [n, fn] of Object.entries(modelDriftInputCases(readings))) it(n, fn); });
describe('modelDriftReadingOf', () => { for (const [n, fn] of Object.entries(modelDriftReadingCases(readings))) it(n, fn); });
describe('readersRunningReadingOf', () => { for (const [n, fn] of Object.entries(readersRunningReadingCases(readings))) it(n, fn); });

// ---- The store: reader events by the start row's receipt (the server's clock) ----

/** The hook reports table and one start row, received by the server at `received` (the hook may stamp another time). */
function storeDb(received: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE continuity_hook_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT NOT NULL, kind TEXT NOT NULL, key TEXT, agentId TEXT, detail TEXT, at INTEGER NOT NULL, receivedAt INTEGER NOT NULL);');
  db.exec(`CREATE TABLE continuity_starts (id INTEGER PRIMARY KEY, receivedAt INTEGER NOT NULL); INSERT INTO continuity_starts VALUES (1, ${received});`);
  return db;
}
const S = 'lane-a-project-a';

describe('readerEventsSinceStart', () => {
  it('reads the session\'s reader events received at or after the start row\'s receipt, with that floor', () => {
    const db = storeDb(5_000);
    expect(insertHookReport(db, S, { kind: 'reader-start', agentId: 'a0', agentType: null, at: 1 }, 4_999).ok).toBe(true);
    expect(insertHookReport(db, S, { kind: 'reader-start', agentId: 'a1', agentType: 'Explore', at: 1 }, 5_000).ok).toBe(true);
    expect(insertHookReport(db, S, { kind: 'reader-stop', agentId: 'a1', at: 1 }, 5_001).ok).toBe(true);
    expect(insertHookReport(db, 'lane-b-project-a', { kind: 'reader-start', agentId: 'b1', agentType: null, at: 1 }, 5_002).ok).toBe(true);
    expect(insertHookReport(db, S, { kind: 'model-switch', how: 'switched', from: null, to: null, at: 1 }, 5_003).ok).toBe(true);
    const r = readerEventsSinceStart(db, S, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.since).toBe(5_000);
    expect(r.value.events.map((e) => [e.kind, 'agentId' in e ? e.agentId : null])).toEqual([['reader-start', 'a1'], ['reader-stop', 'a1']]);
  });

  it('a start row that is missing is a failed read, never an empty list', () => {
    expect(readerEventsSinceStart(storeDb(5_000), S, 2)).toEqual({ ok: false, detail: 'no start row 2' });
  });

  it('a table that cannot be read is a failed read', () => {
    const db = storeDb(5_000);
    db.exec('DROP TABLE continuity_hook_reports');
    const r = readerEventsSinceStart(db, S, 1);
    expect(r.ok).toBe(false);
  });
});

// ---- The wiring (`renewalReadingsOf`) ----

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const START = NOW - 3_600_000;
const gen = (over: Partial<GenRow> = {}): GenRow =>
  ({ id: 1, sessionId: S, role: 'overlord', model: 'claude-opus-5-5', startId: 1, startReportedAt: START, ...over }) as GenRow;
const usage = (model: string, o: { stale?: boolean; ts?: number } = {}): UsageRead => ({ kind: 'reading', uuid: null, usage: {
  ts: o.ts ?? Math.floor(NOW / 1000) - 10, model, class: model.includes('-fable-') ? 'fable' : model.includes('-opus-') ? 'opus' : null,
  effort: null, ctxPct: null, ctxTokens: 1_000, ctxWindow: 200_000, cost: null, cacheExpiresAt: null, stale: o.stale ?? false,
} });
const base = (u: UsageRead = usage('claude-opus-5-5')): GenReadings =>
  ({ usage: u, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never, behind: { kind: 'measured', value: false } });

type Door = Required<Pick<ReadingsCoord, 'modelSwitchesOf' | 'readerEventsOf'>>;
function coordOf(door: Partial<Door> | null = {}) {
  const calls: string[] = [];
  const coord: ReadingsCoord = {
    closedSpotProbes: () => ({ ok: true, spots: [] }),
    backstopRead: () => ({ ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true, setAt: 0 } }),
    designationRead: () => ({ kind: 'not-designated', row: null }),
    raiseLatch: () => { throw new Error('no latch here'); },
    startById: () => { throw new Error('no start read here'); },
  };
  if (door === null) return { coord, calls };
  return { calls, coord: { ...coord,
    modelSwitchesOf: (id: string, startId: number) => { calls.push(`switches:${id}:${startId}`); return (door.modelSwitchesOf ?? (() => ({ ok: true as const, value: [] })))(id, startId); },
    readerEventsOf: (id: string, startId: number) => { calls.push(`readers:${id}:${startId}`); return (door.readerEventsOf ?? (() => ({ ok: true as const, value: { since: START, events: [] } })))(id, startId); },
  } as ReadingsCoord };
}
const deps = (logs: string[] = []) => ({ time: { clock: { wall: () => NOW }, entropy: { hex: (n: number) => 'a'.repeat(2 * n) } }, log: (l: string) => logs.push(l) });

describe('renewalReadingsOf (PR E: the door process\'s readings)', () => {
  it('an Overlord generation reads modelDrift and the soft readersRunning, each by its own session and start id', async () => {
    const { coord, calls } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ startId: 7 }), base());
    expect(r.w1?.modelDrift).toEqual({ kind: 'measured', value: false });
    expect(r.soft).toEqual({ readersRunning: { kind: 'measured', value: 0 } });
    expect(calls).toEqual([`switches:${S}:7`, `readers:${S}:7`]);
  });

  it('a switch since the start reads modelDrift measured true', async () => {
    const { coord } = coordOf({ modelSwitchesOf: () => ({ ok: true, value: [{ id: 1, how: 'switched', from: null, to: 'claude-fable-5-2', at: 1, receivedAt: START + 1 }] }) });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen(), base());
    expect(r.w1?.modelDrift).toEqual({ kind: 'measured', value: true });
  });

  it('a stale sidecar with no switch reads modelDrift unmeasured, never false', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen(), base(usage('claude-fable-5-2', { stale: true })));
    expect(r.w1?.modelDrift?.kind).toBe('unmeasured');
  });

  it('a coordinator generation gets neither reading, and neither read is made (its readersRunning stays not-applicable)', async () => {
    const { coord, calls } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ role: 'coordinator' }), base());
    expect(r.w1?.modelDrift).toBeUndefined();
    expect(r.soft).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('a store without the two reads (an older wiring, a test, the simulator) answers neither: both keep the lane\'s W1', async () => {
    const { coord } = coordOf(null);
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen(), base());
    expect('modelDrift' in (r.w1 ?? {})).toBe(false);
    expect(r.soft).toBeUndefined();
  });

  it('a switches read that throws makes modelDrift unmeasured `model drift read failed`, logged once a pass, and the readers still read', async () => {
    const logs: string[] = [];
    const { coord } = coordOf({ modelSwitchesOf: () => { throw new Error('db gone'); } });
    const pass = renewalReadingsOf(deps(logs), coord, []);
    const r = await pass.w1(gen(), base());
    await pass.w1(gen({ id: 2 }), base());
    expect(r.w1?.modelDrift).toEqual({ kind: 'unmeasured', why: 'model drift read failed' });
    expect(r.soft).toEqual({ readersRunning: { kind: 'measured', value: 0 } });
    expect(r.w1?.backstopDue?.kind).toBe('measured');
    expect(logs.filter((l) => l.includes('model drift'))).toHaveLength(1);
  });

  it('a readers read that throws makes readersRunning unmeasured `readers read failed`, logged once a pass, and modelDrift still reads', async () => {
    const logs: string[] = [];
    const { coord } = coordOf({ readerEventsOf: () => { throw new Error('db gone'); } });
    const pass = renewalReadingsOf(deps(logs), coord, []);
    const r = await pass.w1(gen(), base());
    await pass.w1(gen({ id: 2 }), base());
    expect(r.soft).toEqual({ readersRunning: { kind: 'unmeasured', why: 'readers read failed' } });
    expect(r.w1?.modelDrift).toEqual({ kind: 'measured', value: false });
    expect(logs.filter((l) => l.includes('readers read failed'))).toHaveLength(1);
  });

  // Fix round 1 (review 3710 F1, F2): the composition hands the wiring the coordination store itself, whose reads are methods
  // that need their object. A port of stand-in arrow functions survives being taken off its object; the real store does not.
  it('over a real coordination store on a fixture database, both readings measure and nothing is logged', async () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-rr-door-'), '.ccrc', 'coord.db')));
    const started = s.insertStart({ sessionId: S, reportId: 'r-door-1', uuid: '11111111-2222-3333-4444-555555555555', source: 'resume',
      model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: START, receivedAt: START });
    if (!started.ok) throw new Error('start not recorded');
    expect(insertHookReport(s.db, S, { kind: 'model-switch', how: 'switched', from: null, to: 'claude-fable-5-2', at: START + 1 }, START + 1).ok).toBe(true);
    expect(insertHookReport(s.db, S, { kind: 'reader-start', agentId: 'a1', agentType: null, at: START + 2 }, NOW - 60_000).ok).toBe(true);
    const logs: string[] = [];
    const coord: ReadingsCoord = s;
    const r = await renewalReadingsOf(deps(logs), coord, []).w1(gen({ startId: started.id }), base());
    expect(r.w1?.modelDrift).toEqual({ kind: 'measured', value: true });
    expect(r.soft).toEqual({ readersRunning: { kind: 'measured', value: 1 } });
    expect(logs).toEqual([]);
  });

  it('the readers are counted at the pass\'s wall clock: a start older than READER_STALE_MS with no stop is unmeasured', async () => {
    const at = NOW - READER_STALE_MS - 1;
    const { coord } = coordOf({ readerEventsOf: () => ({ ok: true, value: { since: START, events: [{ id: 1, kind: 'reader-start', agentId: 'a1', agentType: null, at, receivedAt: at }] } }) });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ startReportedAt: at - 1 }), base());
    expect(r.soft?.readersRunning?.kind).toBe('unmeasured');
  });
});

// ---- What the readings reach: the hard row and the soft wait ----

describe('the readings in the deciders', () => {
  const pass = async (door: Partial<Door>, u?: UsageRead) => {
    const { coord } = coordOf(door);
    return renewalReadingsOf(deps(), coord, []).w1(gen(), base(u));
  };

  it('a switch since the start makes `model-drift` due, hard, for the Overlord', async () => {
    const r = await pass({ modelSwitchesOf: () => ({ ok: true, value: [{ id: 1, how: 'switched', from: null, to: 'claude-fable-5-2', at: 1, receivedAt: START + 1 }] }) });
    expect(renewalDue({ ...renewalBase('overlord'), modelDrift: r.w1!.modelDrift! })).toMatchObject({ due: true, cls: 'hard', why: 'model-drift' });
  });

  it('a typed-refused switch does not make it due', async () => {
    const r = await pass({ modelSwitchesOf: () => ({ ok: true, value: [{ id: 1, how: 'typed-refused', from: null, to: 'claude-fable-5-2', at: 1, receivedAt: START + 1 }] }) });
    expect(renewalDue({ ...renewalBase('overlord'), modelDrift: r.w1!.modelDrift! }).due).toBe(false);
  });

  it('an unmeasured, absent or stale usage never makes `model-drift` due: the row is blind', async () => {
    for (const u of [{ kind: 'absent' } as UsageRead, { kind: 'unreadable' } as UsageRead, usage('claude-fable-5-2', { stale: true }),
      usage('claude-fable-5-2', { ts: Math.floor(START / 1000) - 5 })]) {
      const r = await pass({}, u);
      const due = renewalDue({ ...renewalBase('overlord'), modelDrift: r.w1!.modelDrift! });
      expect(due.due, JSON.stringify(u)).toBe(false);
      expect(due.blind, JSON.stringify(u)).toContain('model-drift');
    }
  });

  it('three reader starts with one stop wait `readers`; a stale reader start waits `unmeasured`', async () => {
    const ev = (kind: 'reader-start' | 'reader-stop', agentId: string, receivedAt: number) =>
      ({ id: receivedAt, kind, agentId, agentType: null, at: receivedAt, receivedAt }) as never;
    const two = await pass({ readerEventsOf: () => ({ ok: true, value: { since: START, events: [ev('reader-start', 'a1', NOW - 3), ev('reader-start', 'a2', NOW - 2),
      ev('reader-start', 'a3', NOW - 1), ev('reader-stop', 'a2', NOW)] } }) });
    expect(two.soft?.readersRunning).toEqual({ kind: 'measured', value: 2 });
    expect(softRenewalMay({ ...softBase('overlord'), readersRunning: two.soft!.readersRunning! })).toMatchObject({ start: false, waitFor: 'readers' });
    const stale = await pass({ readerEventsOf: () => ({ ok: true, value: { since: START, events: [ev('reader-start', 'a1', NOW - READER_STALE_MS - 1)] } }) });
    expect(softRenewalMay({ ...softBase('overlord'), readersRunning: stale.soft!.readersRunning! })).toMatchObject({ start: false, waitFor: 'unmeasured' });
  });
});

// The switches read the wiring takes is the store's existing one (door process B1's delegate), by the start row too.
it('the switches read is the store\'s own, by the start row\'s receipt', () => {
  const db = storeDb(5_000);
  expect(insertHookReport(db, S, { kind: 'model-switch', how: 'switched', from: null, to: 'claude-fable-5-2', at: 9_999 }, 4_999).ok).toBe(true);
  expect(modelSwitchesSinceStart(db, S, 1)).toEqual({ ok: true, value: [] });
});
