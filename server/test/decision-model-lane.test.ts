// Overlord W2, decision model B, Task 9: the anchor-set lane (`server/src/coord/decisionModelLane.ts`), the anchors it asks
// (`decisionAnchors.ts`) and its wiring (`laneSchedule.ts`, `watch.ts#sweepDecisionAnchors`, `index.ts`). A double port answers from a
// table the test controls, `fakeTime` drives the days, and the store and the authority journal are real, over a fixture directory.
// Never the live HOME, a network or a real model.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DECISION_ANCHOR_COUNT, DECISION_BANDS, DECISION_CANARY_OVERRIDES, DECISION_QUESTIONS, DECISION_ROW_DEFAULT, DECISION_ROW_IDS,
  type DecisionBand, type DecisionHostKind, type DecisionRowId, type DecisionRowSide,
} from '../../shared/decisionModel.js';
import { DECISION_ANCHORS } from '../src/coord/decisionAnchors.js';
import { applyDecision, planDecision, type DecisionFields } from '../src/coord/decisionModel.js';
import { decideRowArm, type DecisionLineFacts } from '../src/coord/decisionLines.js';
import { gatherDecisions, type DecisionAskDeps } from '../src/coord/decisionModelAsk.js';
import { runDecisionAnchorLane, type DecisionLaneDeps } from '../src/coord/decisionModelLane.js';
import type { DecisionCall, DecisionModel, DecisionWireRequest } from '../src/coord/decisionModelPort.js';
import {
  admitDecisionLine, currentDecisionLine, decisionArmingStore, decisionAskStore, decisionHostRead, decisionLineById, decisionRowRead, decisionRowSideOf,
  moveDecisionRowInTx, recordCanary, setDecisionHostInTx, type DecisionLineRow,
} from '../src/coord/decisionModelStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { tx } from '../src/coord/tx.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { loadConfig } from '../src/config.js';
import { DECISION_ANCHOR_PERIOD_MS, laneRow } from '../src/laneSchedule.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { seedRoster, testDeps, withFakeClock } from './helpers.js';
import { parsedFile } from './scan/symbols.js';
import { nameWrites } from './scan/parse.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { PRIVATE_NAMES, matchLine } from './private-names.mjs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-16T10:00:00.000Z');
const LOCAL = { kind: 'local' as const, endpoint: 'http://127.0.0.1:9000/ask', origin: 'http://127.0.0.1:9000', modelId: 'model-a' };
const HOSTED = { kind: 'hosted' as const, endpoint: 'https://model-host-a.example/ask', origin: 'https://model-host-a.example', modelId: 'model-a' };
type Host = typeof LOCAL | typeof HOSTED;
const SHADOW: DecisionRowSide = { ...DECISION_ROW_DEFAULT, mode: 'shadow' };

/** A band's probability in the double, and the probability that reads as another band (a moved anchor). */
const P_OF: Record<DecisionBand, number> = { unlikely: 0.1, doubtful: 0.4, likely: 0.6, 'very-likely': 0.9 };
const P_MOVED: Record<DecisionBand, number> = { unlikely: 0.9, doubtful: 0.9, likely: 0.1, 'very-likely': 0.1 };
/** The field whose text names an anchor in a request's state, per row the double answers. */
const NAMING: Partial<Record<DecisionRowId, string>> = { 'relay.method': 'part', 'scope.widens': 'cited' };
const ESCAPED = (text: string): string => JSON.stringify(text).slice(1, -1);

let template: Buffer;
beforeAll(() => {
  const file = path.join(mkTmp('ccrc-decision-lane-template-'), 'coord.db');
  openCoordDb(file).close();
  template = readFileSync(file);
});

let n = 0;
interface Rig {
  db: DatabaseSync; ft: FakeTime; deps: DecisionLaneDeps; log: string[];
  /** Every request the port saw, with the reservation the day count held for the row at that moment. */
  calls: { req: DecisionWireRequest; reserved: number }[];
  /** The anchors (by index) the double answers in another band than their authored one. */
  moved: Set<number>;
  /** The labelled cases the source holds: `count` clean cases of the row (label yes), or none. */
  cases: { row: DecisionRowId | null; count: number; label: 'yes' | 'no'; gone: Set<number> };
  /** A probability for a labelled case's state (default 0.97), and for a canary-perturbed one (default: the plain). */
  caseP: number;
  perturbedP: number | null;
  /** The call number (1-based) from which the double answers `unavailable`; 0 never. */
  failFrom: number;
  host: Host | null;
  egress: (texts: readonly string[]) => 'clear' | 'hit' | 'no-list' | 'unreadable';
  setSide(row: DecisionRowId, to: Partial<DecisionRowSide>): void;
  setHost(host: Host): void;
  admit(row: DecisionRowId, o?: Partial<Parameters<typeof admitDecisionLine>[1]>): number;
  run(): Promise<void>;
  day(offset?: number): string;
  maintain(row: DecisionRowId): number;
}

function rig(opts: { host?: Host } = {}): Rig {
  const dir = path.join(mkTmp('ccrc-decision-lane-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'coord.db'), template);
  const db = openCoordDb(path.join(dir, 'coord.db'));
  // A lane pass is hundreds of small transactions: no fsync on a throwaway fixture, so a loaded box's disk does not set the pace.
  db.exec('PRAGMA synchronous = OFF');
  const ft = fakeTime({ wallMs: T0 });
  let journal!: OverlordAuthorityJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) });
  journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock: ft.ports.clock }, guard);
  guard.bootVerdict(journal.measure(db));
  const r: Rig = {
    db, ft, log: [], calls: [], moved: new Set(), cases: { row: null, count: 0, label: 'yes', gone: new Set() },
    caseP: 0.97, perturbedP: null, failFrom: 0, host: opts.host ?? LOCAL, egress: () => 'clear',
    deps: undefined as never,
    setSide: (row, to) => {
      const from = decisionRowSideOf(db, row);
      const moved = tx(db, () => moveDecisionRowInTx(db, journal, { row, expected: from, to: { ...from, ...to }, heldCause: null,
        actor: 'device-a', at: T0, opKey: `op-${++n}` }));
      expect(moved.ok, JSON.stringify(moved)).toBe(true);
    },
    setHost: (host) => {
      r.host = host;
      tx(db, () => setDecisionHostInTx(db, { ...host, keySetAt: 1 }, 'device-a', 1));
    },
    admit: (row, o = {}) => {
      const h = r.host!;
      const id = admitDecisionLine(db, { row, revision: DECISION_QUESTIONS[row].revision, hostKind: h.kind, origin: h.origin, modelId: h.modelId,
        line: 0.9, labelled: 29, errors: 0, bound: 0.05, canaryExpected: 145, baseline: DECISION_ANCHORS[row].map((a) => a.expected),
        admittedAt: T0 - DAY, ...o });
      return id;
    },
    run: () => runDecisionAnchorLane(r.deps),
    day: (offset = 0) => new Date(ft.ports.clock.wall() + offset * DAY).toISOString().slice(0, 10),
    maintain: (row) => (db.prepare('SELECT maintain FROM decision_days WHERE row = ? AND day = ?').get(row, r.day()) as { maintain: number } | undefined)?.maintain ?? 0,
  };
  const pOf = (req: DecisionWireRequest): number => {
    const state = JSON.stringify(req.state);
    const perturbed = DECISION_CANARY_OVERRIDES.some((o) => state.includes(JSON.stringify(o).slice(1, -1)));
    for (const [row, field] of Object.entries(NAMING) as [DecisionRowId, string][]) {
      const idx = DECISION_ANCHORS[row].findIndex((a) => state.includes(ESCAPED(a.fields[field] as string)));
      if (idx >= 0) {
        const band = DECISION_ANCHORS[row][idx]!.expected;
        return r.moved.has(idx) ? P_MOVED[band] : P_OF[band];
      }
    }
    return perturbed && r.perturbedP !== null ? r.perturbedP : r.caseP;
  };
  const store = decisionAskStore(db);
  const ask: DecisionAskDeps = {
    store, time: ft.ports,
    arming: (row) => decisionRowSideOf(db, row),
    // Under the call's own host snapshot (review 2418 F9), never the stored host read again.
    currentLine: (row, host) => {
      const l = currentDecisionLine(db, row, { hostKind: host.kind, origin: host.origin, modelId: host.modelId, revision: DECISION_QUESTIONS[row].revision });
      return l === null ? null : { id: l.id, line: l.line };
    },
    host: () => {
      const h = decisionHostRead(db);
      return h.kind === 'host' ? { kind: h.host.kind, endpoint: h.host.endpoint, origin: h.host.origin, modelId: h.host.modelId } : null;
    },
    keySet: (_origin) => true,
    modelFor: (h): DecisionModel => ({
      kind: h.kind, origin: new URL(h.endpoint).origin,
      ask: async (req): Promise<DecisionCall> => {
        const reserved = (db.prepare("SELECT COALESCE(SUM(reserved), 0) AS r FROM decision_days").get() as { r: number }).r;
        r.calls.push({ req, reserved });
        if (r.failFrom > 0 && r.calls.length >= r.failFrom) return { ok: false, outcome: 'unavailable', why: 'timeout', status: null, ms: 5, attempts: 1 };
        const p = pOf(req);
        return { ok: true, ms: 5, attempts: 1, answer: { model: req.model, answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { type: 'noul', noul: p }])) } };
      },
    }),
    egress: (texts) => r.egress(texts),
    stateHash: (state) => createHash('sha256').update(JSON.stringify(state)).digest('hex'),
  };
  r.deps = {
    store: decisionArmingStore(db, journal), ask, time: ft.ports, log: (line) => r.log.push(line),
    resolve: async () => [],
    labels: {
      casesFor: (row) => (r.cases.row !== row ? [] : Array.from({ length: r.cases.count }, (_, i) => ({
        refs: {}, inline: row === 'scope.widens' ? { cited: `case ${i}`, goals: 'the new goals', ...(r.cases.gone.has(i) ? { gone: 'yes' } : {}) }
          : { part: `case ${i}`, ...(r.cases.gone.has(i) ? { gone: 'yes' } : {}) },
        label: r.cases.label,
      }))),
    },
    states: { fieldsOf: (_row, _refs, inline) => (inline !== null && 'gone' in inline ? 'unresolvable' : { ...inline }) },
  };
  r.setHost(r.host!);
  return r;
}

const bandsOf = (row: DecisionRowId): DecisionBand[] => DECISION_ANCHORS[row].map((a) => a.expected);
const dayRow = (r: Rig, row: DecisionRowId, offset = 0): { anchorBands: string | null; anchorDrift: number } | undefined =>
  r.db.prepare('SELECT anchorBands, anchorDrift FROM decision_days WHERE row = ? AND day = ?').get(row, r.day(offset)) as never;
const lineCount = (r: Rig, row: DecisionRowId): number =>
  (r.db.prepare('SELECT COUNT(*) AS c FROM decision_lines WHERE row = ?').get(row) as { c: number }).c;
const heldCause = (r: Rig, row: DecisionRowId): string | null => {
  const s = decisionRowRead(r.db, row);
  return s.kind === 'row' ? s.state.heldCause : 'unreadable';
};
const serveCheck = async (r: Rig, row: DecisionRowId, fields: DecisionFields) =>
  (await gatherDecisions(r.deps.ask, { rows: [row], fields: new Map([[row, fields]]), refs: new Map(), kind: 'serve', fresh: true }))[0]!;
const hostNow = (r: Rig): { kind: DecisionHostKind; origin: string; modelId: string } => ({ kind: r.host!.kind, origin: r.host!.origin, modelId: r.host!.modelId });
const keyFor = (r: Rig, row: DecisionRowId) => ({ hostKind: r.host!.kind, origin: r.host!.origin, modelId: r.host!.modelId, revision: DECISION_QUESTIONS[row].revision });

describe('a pass over rows that are off or in shadow', () => {
  it('an off row is never asked: with every row off the port sees nothing and no day row is written', async () => {
    const r = rig();
    await r.run();
    expect(r.calls).toHaveLength(0);
    expect(r.db.prepare('SELECT COUNT(*) AS c FROM decision_days').get()).toEqual({ c: 0 });
    expect(r.log).toEqual([]);
  });

  it('only the rows that are not off are asked: a shadow row is, its off sibling is not', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    await r.run();
    expect(r.calls).toHaveLength(DECISION_ANCHOR_COUNT);
    expect(r.calls.every((c) => Object.values(c.req.questions).length === 1)).toBe(true);
    expect(r.db.prepare('SELECT row FROM decision_days').all()).toEqual([{ row: 'relay.method' }]);
  });

  it('every lane ask counts as maintain, and the port sees no call the caller did not reserve', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    r.cases = { row: 'relay.method', count: 29, label: 'yes', gone: new Set() };
    await r.run();
    expect(r.calls.length).toBeGreaterThan(DECISION_ANCHOR_COUNT);
    // The call was reserved before it was made: two calls held on the row's day count while the port had it.
    expect(r.calls.every((c) => c.reserved >= 2)).toBe(true);
    expect(r.db.prepare("SELECT serve, maintain, reserved FROM decision_days WHERE row = 'relay.method'").get()).toEqual({ serve: 0, maintain: r.calls.length, reserved: 0 });
    // A maintenance answer is never a record to serve from.
    expect(r.db.prepare('SELECT COUNT(*) AS c FROM decision_records').get()).toEqual({ c: 0 });
  });

  it('a private-state row on a hosted host is not asked', async () => {
    const r = rig({ host: HOSTED });
    r.setSide('scope.widens', SHADOW);
    await r.run();
    expect(r.calls).toHaveLength(0);
    expect(r.db.prepare('SELECT COUNT(*) AS c FROM decision_days').get()).toEqual({ c: 0 });
  });

  it('a throw in one row is logged, and the lane goes on to the next row', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    r.setSide('goals.conflict', SHADOW);
    const base = r.deps.labels.casesFor;
    r.deps.labels.casesFor = (row, rev) => { if (row === 'relay.method') throw new Error('the label source is down'); return base(row, rev); };
    await r.run();
    expect(r.log).toEqual(['ccrc-server: decision anchors: relay.method: the label source is down']);
    expect(dayRow(r, 'goals.conflict')?.anchorBands).not.toBeNull();
  });
});

describe('the anchors: today\'s bands and drift', () => {
  it('a partial set writes nothing: one unanswered anchor is no baseline and no drift reading', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    r.failFrom = 10;
    await r.run();
    expect(r.calls).toHaveLength(10);
    expect(dayRow(r, 'relay.method')?.anchorBands ?? null).toBeNull();
  });

  it('writes today\'s 20 bands, and no drift without a line to compare with', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    await r.run();
    expect(JSON.parse(dayRow(r, 'relay.method')!.anchorBands!)).toEqual(bandsOf('relay.method'));
    expect(dayRow(r, 'relay.method')!.anchorDrift).toBe(0);
  });

  it('drift at 4 of 20 against the armed line\'s baseline holds an armed gate, and its next serve check answers not-asked, held', async () => {
    const r = rig();
    const id = r.admit('scope.widens', { canaryExpected: 5 });
    recordCanary(r.db, id, 5, 0);
    r.setSide('scope.widens', { mode: 'armed', armedLine: { id, line: 0.9 } });
    r.moved = new Set([0, 1, 2, 3]);
    await r.run();
    expect(dayRow(r, 'scope.widens')!.anchorDrift).toBe(1);
    expect(decisionRowSideOf(r.db, 'scope.widens')).toMatchObject({ mode: 'armed', held: true });
    expect(heldCause(r, 'scope.widens')).toBe('drift');
    const check = await serveCheck(r, 'scope.widens', { cited: 'the operator words', goals: 'the new goals' });
    expect(check).toMatchObject({ outcome: 'not-asked', why: 'held' });
  });

  it('drift at 3 of 20 holds nothing', async () => {
    const r = rig();
    const id = r.admit('scope.widens', { canaryExpected: 5 });
    recordCanary(r.db, id, 5, 0);
    r.setSide('scope.widens', { mode: 'armed', armedLine: { id, line: 0.9 } });
    r.moved = new Set([0, 1, 2]);
    await r.run();
    expect(dayRow(r, 'scope.widens')!.anchorDrift).toBe(0);
    expect(decisionRowSideOf(r.db, 'scope.widens')).toMatchObject({ mode: 'armed', held: false });
    expect(heldCause(r, 'scope.widens')).toBeNull();
  });

  it('a shadow row that drifted is not held: only an armed row is', async () => {
    const r = rig();
    r.admit('relay.method', { canaryExpected: 5 });
    r.setSide('relay.method', SHADOW);
    r.moved = new Set([0, 1, 2, 3, 4]);
    await r.run();
    expect(dayRow(r, 'relay.method')!.anchorDrift).toBe(1);
    expect(decisionRowSideOf(r.db, 'relay.method').held).toBe(false);
  });

  it('a newer line admitted while a gate is armed on an older one: the gate\'s serve check still clears under its armed line, and drift is measured against the older line\'s baseline', async () => {
    const r = rig();
    // The armed line's baseline sits 3 anchors from what the model answers today, so day 1 does not drift.
    const older = bandsOf('scope.widens').map((b, i) => (i < 3 ? (b === 'unlikely' ? 'very-likely' : 'unlikely') : b));
    const id = r.admit('scope.widens', { canaryExpected: 5, baseline: older });
    recordCanary(r.db, id, 5, 0);
    r.setSide('scope.widens', { mode: 'armed', armedLine: { id, line: 0.9 } });
    r.cases = { row: 'scope.widens', count: 59, label: 'yes', gone: new Set() };
    await r.run();
    // The newer line exists and the gate still stands on the older one.
    expect(lineCount(r, 'scope.widens')).toBe(2);
    expect(decisionRowSideOf(r.db, 'scope.widens')).toMatchObject({ mode: 'armed', held: false, armedLine: { id, line: 0.9 } });
    const current = currentDecisionLine(r.db, 'scope.widens', keyFor(r, 'scope.widens'))!;
    expect(current.id).toBeGreaterThan(id);
    // The check clears under the armed line while a newer current line exists (review 2262 F3).
    const check = await serveCheck(r, 'scope.widens', { cited: 'the operator words', goals: 'the new goals' });
    expect(check).toMatchObject({ outcome: 'answered', lineGen: id });
    const armedLine = decisionLineById(r.db, id)!;
    const armedKey = { revision: armedLine.revision, hostKind: armedLine.hostKind, origin: armedLine.origin, modelId: armedLine.modelId };
    expect(armedKey.revision).toBe(DECISION_QUESTIONS['scope.widens'].revision);
    expect(applyDecision(check, { row: DECISION_QUESTIONS['scope.widens'], side: decisionRowSideOf(r.db, 'scope.widens'),
      currentLine: { id: current.id, line: current.line }, host: hostNow(r),
      // The key the gate's armed line was admitted under (review 2418 F3), read from the stored line, never rebuilt from the check.
      armedLineKey: armedKey })).toBe('clear-yes');
    // Under another revision's key the same check shuts.
    expect(applyDecision(check, { row: DECISION_QUESTIONS['scope.widens'], side: decisionRowSideOf(r.db, 'scope.widens'),
      currentLine: { id: current.id, line: current.line }, host: hostNow(r), armedLineKey: { ...armedKey, revision: 'other-revision' } })).toBe('shut');
    // Day 2: one more anchor moves. Against the newer line's baseline (today's bands of day 1) only one moved; against the older
    // line's, four have. The gate is held by drift.
    r.ft.advance(DAY);
    r.moved = new Set([3]);
    await r.run();
    expect(current.baseline).toEqual(bandsOf('scope.widens'));
    expect(dayRow(r, 'scope.widens', 0)!.anchorDrift).toBe(1);
    expect(heldCause(r, 'scope.widens')).toBe('drift');
  });
});

describe('the line key', () => {
  it('a changed model id holds an armed row (an advice row, and a gate on its armed line)', async () => {
    const r = rig();
    r.admit('relay.method');
    const g = r.admit('scope.widens');
    r.setSide('relay.method', { mode: 'armed' });
    r.setSide('scope.widens', { mode: 'armed', armedLine: { id: g, line: 0.9 } });
    r.setHost({ ...LOCAL, modelId: 'model-b' });
    await r.run();
    expect(decisionRowSideOf(r.db, 'relay.method').held).toBe(true);
    expect(heldCause(r, 'relay.method')).toBe('line-key');
    expect(decisionRowSideOf(r.db, 'scope.widens').held).toBe(true);
    expect(heldCause(r, 'scope.widens')).toBe('line-key');
    const moves = r.db.prepare('SELECT actor FROM decision_rows ORDER BY row').all() as { actor: string }[];
    expect(moves.map((m) => m.actor)).toEqual(['server', 'server']);
  });

  it('a row whose line is under today\'s key is not held', async () => {
    const r = rig();
    r.admit('relay.method');
    r.setSide('relay.method', { mode: 'armed' });
    await r.run();
    expect(decisionRowSideOf(r.db, 'relay.method').held).toBe(false);
  });
});

describe('admission', () => {
  it('an empty labels source admits nothing, so every row stays in shadow', async () => {
    const r = rig();
    for (const row of DECISION_ROW_IDS) r.setSide(row, SHADOW);
    await r.run();
    expect(r.db.prepare('SELECT COUNT(*) AS c FROM decision_lines').get()).toEqual({ c: 0 });
    for (const row of DECISION_ROW_IDS) expect(decisionRowSideOf(r.db, row).mode, row).toBe('shadow');
  });

  it('29 clean cases admit a 10% row, 28 do not, and the line\'s baseline is the same day\'s bands', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    r.cases = { row: 'relay.method', count: 28, label: 'yes', gone: new Set() };
    await r.run();
    expect(lineCount(r, 'relay.method')).toBe(0);
    r.cases = { row: 'relay.method', count: 29, label: 'yes', gone: new Set() };
    await r.run();
    expect(lineCount(r, 'relay.method')).toBe(1);
    const line = currentDecisionLine(r.db, 'relay.method', keyFor(r, 'relay.method'))!;
    expect(line).toMatchObject({ labelled: 29, errors: 0, canaryExpected: 29 * DECISION_CANARY_OVERRIDES.length });
    expect(line.bound).toBeLessThanOrEqual(0.1);
    expect(line.baseline).toEqual(JSON.parse(dayRow(r, 'relay.method')!.anchorBands!));
  });

  it('a 5% gate needs 59: 29 clean cases admit nothing', async () => {
    const r = rig();
    r.setSide('scope.widens', SHADOW);
    r.cases = { row: 'scope.widens', count: 29, label: 'yes', gone: new Set() };
    await r.run();
    expect(lineCount(r, 'scope.widens')).toBe(0);
  });

  it('a labelled case that does not resolve is left out and counted in one log line; the rest admit', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    r.cases = { row: 'relay.method', count: 30, label: 'yes', gone: new Set([4]) };
    await r.run();
    expect(r.log).toEqual(['ccrc-server: decision anchors: relay.method: 1 labelled case(s) unresolvable, left out']);
    expect(currentDecisionLine(r.db, 'relay.method', keyFor(r, 'relay.method'))).toMatchObject({ labelled: 29 });
  });

  it('a case the screen refuses on a hosted host is not sent, and no line is admitted from a partial set', async () => {
    const r = rig({ host: HOSTED });
    r.setSide('relay.method', SHADOW);
    r.cases = { row: 'relay.method', count: 29, label: 'yes', gone: new Set() };
    r.egress = (texts) => (texts.some((t) => t === 'case 7') ? 'hit' : 'clear');
    await r.run();
    expect(r.calls.some((c) => JSON.stringify(c.req).includes('case 7'))).toBe(false);
    expect(r.calls.some((c) => JSON.stringify(c.req).includes('case 6'))).toBe(true);
    expect(lineCount(r, 'relay.method')).toBe(0);
  });

  it('29 clean cases admit the 10% rows; a looser line is offered to an armed gate and never applied', async () => {
    const r = rig();
    const id = r.admit('scope.widens', { line: 0.9, canaryExpected: 5 });
    recordCanary(r.db, id, 5, 0);
    r.setSide('scope.widens', { mode: 'armed', armedLine: { id, line: 0.9 } });
    r.cases = { row: 'scope.widens', count: 59, label: 'yes', gone: new Set() };
    await r.run();
    const offered = currentDecisionLine(r.db, 'scope.widens', keyFor(r, 'scope.widens'))!;
    expect(offered.id).toBeGreaterThan(id);
    expect(offered.line).toBeLessThan(0.9);
    expect(decisionRowSideOf(r.db, 'scope.widens')).toMatchObject({ mode: 'armed', held: false, armedLine: { id, line: 0.9 } });
    expect(r.db.prepare("SELECT armedLineId, armedLineValue FROM decision_rows WHERE row = 'scope.widens'").get()).toEqual({ armedLineId: id, armedLineValue: 0.9 });
  });

  it('a gate whose armed line\'s own bound fails on today\'s answers is held (bound)', async () => {
    const r = rig();
    const id = r.admit('scope.widens', { line: 0.9, canaryExpected: 5 });
    recordCanary(r.db, id, 5, 0);
    r.setSide('scope.widens', { mode: 'armed', armedLine: { id, line: 0.9 } });
    // Every case reads as a clear yes at the line, and every label says no: all errors.
    r.cases = { row: 'scope.widens', count: 59, label: 'no', gone: new Set() };
    await r.run();
    expect(heldCause(r, 'scope.widens')).toBe('bound');
  });
});

describe('the canary', () => {
  it('resumes across days at the maintenance cap, and the row cannot be armed until it is complete', async () => {
    const r = rig();
    r.setSide('scope.widens', SHADOW);
    r.cases = { row: 'scope.widens', count: 59, label: 'yes', gone: new Set() };
    const key = keyFor(r, 'scope.widens');
    const facts = (l: DecisionLineRow): DecisionLineFacts => ({ id: l.id, line: l.line, underToday: true, canaryAsked: l.canaryAsked,
      canaryExpected: l.canaryExpected, canaryCrossed: l.canaryCrossed });
    const arm = () => {
      const l = currentDecisionLine(r.db, 'scope.widens', key)!;
      return decideRowArm({ rowId: 'scope.widens', body: { mode: 'armed', expected: decisionRowSideOf(r.db, 'scope.widens') },
        host: { kind: 'local' }, keySet: true, currentLine: facts(l), lineById: (i) => { const x = decisionLineById(r.db, i); return x === null ? null : facts(x); } });
    };
    await r.run();
    const day1 = currentDecisionLine(r.db, 'scope.widens', key)!;
    expect(day1.canaryExpected).toBe(295);
    expect(day1.canaryAsked).toBeGreaterThan(0);
    expect(day1.canaryAsked).toBeLessThan(295);
    // The maintenance cap is half the ceiling; the lane stops at it.
    expect(r.maintain('scope.widens')).toBe(299);
    expect(arm()).toMatchObject({ ok: false, refusal: 'canary-unmet' });
    r.ft.advance(DAY);
    await r.run();
    const day2 = currentDecisionLine(r.db, 'scope.widens', key)!;
    expect(day2.id).toBe(day1.id);
    expect(day2.canaryAsked).toBe(295);
    expect(day2.canaryCrossed).toBe(0);
    expect(arm()).toMatchObject({ ok: true, to: { mode: 'armed' } });
  });

  it('a canary that crosses more than 5% is unmet, and holds an armed row (canary)', async () => {
    const r = rig();
    const id = r.admit('relay.method', { labelled: 29, canaryExpected: 145, line: 0.9 });
    r.setSide('relay.method', { mode: 'armed' });
    r.cases = { row: 'relay.method', count: 29, label: 'yes', gone: new Set() };
    r.perturbedP = 0.05;
    await r.run();
    expect(decisionLineById(r.db, id)).toMatchObject({ canaryAsked: 145, canaryCrossed: 145 });
    expect(heldCause(r, 'relay.method')).toBe('canary');
  });

  it('a perturbed state carries the override on its attacker fields only', async () => {
    const r = rig();
    r.admit('scope.widens', { labelled: 59, canaryExpected: 5 });
    r.setSide('scope.widens', SHADOW);
    r.cases = { row: 'scope.widens', count: 1, label: 'yes', gone: new Set() };
    await r.run();
    const withOverride = r.calls.filter((c) => JSON.stringify(c.req.state).includes(DECISION_CANARY_OVERRIDES[0]));
    expect(withOverride.length).toBeGreaterThan(0);
    // `goals` is scope.widens' only attacker field; the cited words are left as they were.
    for (const c of withOverride) {
      const s = c.req.state as { cited: string; goals: { quoted: string } };
      expect(s.cited).toBe('case 0');
      expect(s.goals.quoted).toBe(`the new goals\n${DECISION_CANARY_OVERRIDES[0]}`);
    }
  });
});

describe('the anchors themselves', () => {
  it.each(DECISION_ROW_IDS)('%s has 20 complete public states, a spread of bands, and nothing the private-name scan matches', (row) => {
    const q = DECISION_QUESTIONS[row];
    const set = DECISION_ANCHORS[row];
    expect(set).toHaveLength(DECISION_ANCHOR_COUNT);
    const bands = new Set(set.map((a) => a.expected));
    for (const b of DECISION_BANDS) expect(bands.has(b), `${row} has no ${b} anchor`).toBe(true);
    const texts = new Set<string>();
    for (const [i, a] of set.entries()) {
      for (const f of q.fields.filter((d) => d.required)) {
        const v = a.fields[f.name];
        expect(v, `${row}[${i}].${f.name}`).toBeDefined();
        expect(typeof v === 'string' ? v.length : v!.length, `${row}[${i}].${f.name} is empty`).toBeGreaterThan(0);
      }
      if (a.fields['candidates'] !== undefined) {
        const c = a.fields['candidates'] as readonly string[];
        const g = a.fields['goals'] as readonly string[];
        expect(c.length).toBeGreaterThanOrEqual(2);
        expect(c.length).toBeLessThanOrEqual(4);
        expect(g).toHaveLength(c.length);
      }
      for (const f of q.fields.filter((d) => d.kind === 'fact')) {
        const v = a.fields[f.name];
        if (typeof v === 'string') expect(v.length).toBeLessThan(200);
      }
      // The plan never skips an anchor for a missing field or its size, and asks it in shadow on a local host.
      expect(planDecision({ row, kind: 'maintain', fresh: true, side: SHADOW, host: { kind: 'local', modelId: 'model-a', origin: 'http://127.0.0.1:9000' },
        keySet: true, fields: a.fields, requestBytes: 100, egress: 'not-hosted', record: null,
        usage: { measured: true, serve: 0, maintain: 0, reserved: 0, ceiling: 600, fleetTotal: 0 } }), `${row}[${i}]`).toEqual({ do: 'ask' });
      const line = JSON.stringify(a.fields);
      expect(matchLine(line, PRIVATE_NAMES), `${row}[${i}] matches a private name`).toEqual([]);
      texts.add(line);
    }
    expect(texts.size, `${row} repeats an anchor`).toBe(DECISION_ANCHOR_COUNT);
  });

  it('the two routing rows share their 20 states, and no other row does', () => {
    expect(DECISION_ANCHORS['programme.pick'].map((a) => a.fields)).toEqual(DECISION_ANCHORS['programme.any'].map((a) => a.fields));
    expect(DECISION_ANCHORS['readback.omits'].map((a) => a.expected)).not.toEqual(DECISION_ANCHORS['readback.adds'].map((a) => a.expected));
  });
});

describe('the wiring', () => {
  const watcher = (deps: Record<string, unknown>): FleetWatcher =>
    quietAtTestEnd(new FleetWatcher(withFakeClock({ ...testDeps(mkTmp('ccrc-decision-w-')), ...deps, time: fakeTime({ wallMs: T0 }).ports }) as never, new Bus(), 2000));
  const decisionsOf = (r: Rig) => { const { time, log, ...rest } = r.deps; void time; void log; return rest; };

  it('sweepDecisionAnchors runs the lane over deps.decisions; with none it does nothing', async () => {
    const r = rig();
    r.setSide('relay.method', SHADOW);
    await watcher({ decisions: decisionsOf(r) }).sweepDecisionAnchors();
    expect(r.calls).toHaveLength(DECISION_ANCHOR_COUNT);
    await watcher({}).sweepDecisionAnchors();
    expect(r.calls).toHaveLength(DECISION_ANCHOR_COUNT);
  });

  it('tick() dispatches the lane', async () => {
    const r = rig();
    const home = mkTmp('ccrc-decision-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(r.db, {});
    const w = quietAtTestEnd(new FleetWatcher({ ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord, decisions: decisionsOf(r) } as never, new Bus(), 10_000));
    const spy = vi.spyOn(w, 'sweepDecisionAnchors').mockResolvedValue(undefined);
    await w.tick();
    expect(spy).toHaveBeenCalled();
  });

  it('the row is daily, on the quiz lane\'s period by reference, and the composition root builds deps.decisions once (read through the parser: ARCH-06)', () => {
    expect(laneRow('decisionAnchors')).toMatchObject({ cadenceMs: DAY, clock: 'mono', flight: 'skip', derivedFrom: { name: 'QUIZ_LANE_PERIOD_MS' },
      warnKey: 'ccrc-server: the decision anchors lane failed' });
    expect(laneRow('decisionAnchors').cadenceMs).toBe(DECISION_ANCHOR_PERIOD_MS);
    const writes = nameWrites(parsedFile('server/src/index.ts')).filter((w) => w.name === 'deps' && w.member === 'decisions');
    expect(writes).toHaveLength(1);
  });
});
