// Overlord W2, forecasts A (plan w2-forecasts-health.md, Task 3): `programme_forecasts`' two writers and the facts the
// forecast lane reads, over a fixture coord.db: `sealForecast`, `scoreForecast`, `forecastsOf`, `unsealedClosesOf`,
// `leadHistoryOf` and `outcomeFactsOf`.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { DISPATCH_ABANDON_CLOSE_DETAIL } from '../src/coord/runCloseSwitch.js';
import type { Forecast } from '../../shared/programmeFacts.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let coord: CoordStore;
beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-forecasts-store-'), '.ccrc', 'coord.db'))); });

const programme = (slug: string): void => {
  coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')").run(slug, `Title of ${slug}`, NOW - 90 * DAY);
};
interface R { program?: string; wave?: number; kind?: string; state?: string; openedAt?: number; dispatchedAt?: number | null;
  closedAt?: number | null; closeDetail?: string | null; claimedBy?: string | null }
const run = (o: R = {}): number => Number(coord.db.prepare(
  'INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt, closeDetail, claimedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
).run(o.program ?? 'prog-a', o.wave ?? 1, 'project-a', o.state ?? 'done', o.kind ?? 'work', o.openedAt ?? NOW - 10 * DAY,
  o.dispatchedAt === undefined ? (o.openedAt ?? NOW - 10 * DAY) + MIN : o.dispatchedAt,
  o.closedAt === undefined ? NOW - HOUR : o.closedAt, o.closeDetail ?? null,
  o.claimedBy === undefined ? 'lane-a-project-a' : o.claimedBy).lastInsertRowid);
const statement = (program: string, runId: number | null, lo: number, hi: number, at: number): number => {
  const r = coord.insertRemaining(program, 'lane-a-project-a', { lo, hi, reason: 'what is left', runId }, [], null, at);
  if (!r.ok) throw new Error(r.detail);
  return r.id;
};
const DATED: Forecast = { kind: 'forecast', medianAt: NOW + 5 * DAY, p85At: NOW + 9 * DAY, n: 20, source: 'own', seed: 7 };
const seal = (closingRunId: number, forecast: Forecast = DATED, program = 'prog-a') =>
  coord.sealForecast({ program, closingRunId, asOf: NOW - HOUR, statementId: null, lo: 1, hi: 3, forecast }, NOW);

beforeEach(() => { programme('prog-a'); programme('prog-b'); });

describe('sealForecast and scoreForecast, the two writers', () => {
  it('a seal is written once per closing run: a second is a no-op, by the store (ON CONFLICT DO NOTHING)', () => {
    const r = run();
    expect(seal(r)).toEqual({ written: true });
    expect(seal(r, { kind: 'unforecastable', reason: 'no-remaining' })).toEqual({ written: false });
    const all = coord.forecastsOf({ program: 'prog-a' });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ closingRunId: r, sealedAt: NOW, asOf: NOW - HOUR, lo: 1, hi: 3, forecast: DATED, outcome: 'open', scoredAt: null });
    expect(() => coord.db.prepare("INSERT INTO programme_forecasts (program, closingRunId, sealedAt, asOf, kind) VALUES ('prog-a', ?, 1, 1, 'forecast')").run(r))
      .toThrow(/UNIQUE/);
  });

  it('an unforecastable seal keeps its reason and no dates', () => {
    seal(run(), { kind: 'unforecastable', reason: 'too-little-history' });
    const row = coord.db.prepare('SELECT kind, reason, source, n, seed, medianAt, p85At FROM programme_forecasts').get();
    expect(row).toEqual({ kind: 'unforecastable', reason: 'too-little-history', source: null, n: null, seed: null, medianAt: null, p85At: null });
    expect(coord.forecastsOf({ program: 'prog-a' })[0]!.forecast).toEqual({ kind: 'unforecastable', reason: 'too-little-history' });
  });

  it('scoreForecast writes only outcome and scoredAt, and only on an open row', () => {
    seal(run());
    const [s] = coord.forecastsOf({ program: 'prog-a' });
    const before = coord.db.prepare('SELECT * FROM programme_forecasts').get() as Record<string, unknown>;
    expect(coord.scoreForecast(s!.id, 'met', NOW + 10 * DAY)).toEqual({ written: true });
    const after = coord.db.prepare('SELECT * FROM programme_forecasts').get() as Record<string, unknown>;
    expect(after).toEqual({ ...before, outcome: 'met', scoredAt: NOW + 10 * DAY });
    expect(coord.scoreForecast(s!.id, 'missed', NOW + 11 * DAY)).toEqual({ written: false });
    expect(coord.db.prepare('SELECT outcome, scoredAt FROM programme_forecasts').get()).toEqual({ outcome: 'met', scoredAt: NOW + 10 * DAY });
    expect(coord.scoreForecast(9999, 'met', NOW)).toEqual({ written: false });
  });

  it('forecastsOf({ dueBy }) lists open seals whose 85% date has passed, never a scored or an unforecastable one', () => {
    const a = run(); const b = run({ wave: 2 }); const c = run({ wave: 3 }); const d = run({ wave: 4 });
    seal(a); seal(b, { ...DATED, p85At: NOW + 20 * DAY }); seal(c, { kind: 'unforecastable', reason: 'nothing-left' }); seal(d);
    const dId = coord.forecastsOf({ program: 'prog-a' }).find((x) => x.closingRunId === d)!.id;
    coord.scoreForecast(dId, 'missed', NOW);
    expect(coord.forecastsOf({ dueBy: NOW + 9 * DAY }).map((x) => x.closingRunId)).toEqual([a]);
    expect(coord.forecastsOf({ dueBy: NOW + 9 * DAY - 1 })).toEqual([]);
  });

  it('a stored word this build cannot read is carried as unreadable, never a made-up forecast', () => {
    const r = run();
    coord.db.prepare("INSERT INTO programme_forecasts (program, closingRunId, sealedAt, asOf, kind, outcome) VALUES ('prog-a', ?, 1, 1, 'guess', 'maybe')").run(r);
    const r2 = run({ wave: 2 });
    coord.db.prepare("INSERT INTO programme_forecasts (program, closingRunId, sealedAt, asOf, kind, source) VALUES ('prog-a', ?, 1, 1, 'forecast', 'own')").run(r2);
    expect(coord.forecastsOf({ program: 'prog-a' }).map((x) => [x.forecast, x.outcome])).toEqual([['unreadable', 'unreadable'], ['unreadable', 'open']]);
  });
});

describe('unsealedClosesOf, the seal arm\'s read', () => {
  it('lists a close with no seal, and leaves out one older than 7 days, a sealed one, a review run and an open run', () => {
    const fresh = run({ closedAt: NOW - DAY });
    run({ wave: 2, closedAt: NOW - 8 * DAY });
    const sealed = run({ wave: 3, closedAt: NOW - 2 * DAY });
    seal(sealed);
    run({ wave: 4, kind: 'review', closedAt: NOW - DAY });
    run({ wave: 5, state: 'working', closedAt: null });
    const failed = run({ wave: 6, state: 'failed', closedAt: NOW - 3 * HOUR, closeDetail: 'abandon:operator' });
    expect(coord.unsealedClosesOf(NOW).closes.map((c) => c.runId)).toEqual([fresh, failed]);
  });

  it('pairs a close with the statement naming it, over a newer one that does not', () => {
    const r = run({ closedAt: NOW - 2 * HOUR });
    const naming = statement('prog-a', r, 2, 4, NOW - 90 * MIN);
    statement('prog-a', null, 7, 9, NOW - HOUR);
    const [c] = coord.unsealedClosesOf(NOW).closes;
    expect(c).toMatchObject({ runId: r, program: 'prog-a', closedAt: NOW - 2 * HOUR, named: true, statement: { id: naming, lo: 2, hi: 4, at: NOW - 90 * MIN } });
  });

  it('with no statement naming it, pairs the newest statement standing 30 minutes after the close, never a later one', () => {
    const r = run({ closedAt: NOW - 5 * HOUR });
    const before = statement('prog-a', null, 1, 2, NOW - 6 * HOUR);
    const inWait = statement('prog-a', null, 3, 4, NOW - 5 * HOUR + 30 * MIN);
    statement('prog-a', null, 5, 6, NOW - 5 * HOUR + 31 * MIN);
    statement('prog-b', null, 8, 8, NOW - 5 * HOUR + MIN);
    expect(coord.unsealedClosesOf(NOW).closes[0]).toMatchObject({ named: false, statement: { id: inWait, lo: 3, hi: 4 } });
    expect(inWait).toBeGreaterThan(before);
  });

  it('with no statement at all, answers statement null', () => {
    run({ closedAt: NOW - HOUR });
    expect(coord.unsealedClosesOf(NOW).closes[0]).toMatchObject({ named: false, statement: null });
  });

  it('counts a close missed in a gap: before the window, after the first sealed close, with no seal', () => {
    run({ wave: 1, closedAt: NOW - 30 * DAY });            // before any seal: not a gap
    seal(run({ wave: 2, closedAt: NOW - 20 * DAY }));
    run({ wave: 3, closedAt: NOW - 10 * DAY });             // missed
    run({ wave: 4, closedAt: NOW - DAY });                  // in the window: listed, not missed
    expect(coord.unsealedClosesOf(NOW).missed).toBe(1);
  });
});

describe('leadHistoryOf, the lead samples as of a boundary', () => {
  it('measures close to close through the wave representative, the first wave from its earliest openedAt', () => {
    run({ wave: 1, openedAt: NOW - 20 * DAY, closedAt: NOW - 15 * DAY });
    run({ wave: 2, openedAt: NOW - 16 * DAY, closedAt: NOW - 12 * DAY });
    run({ wave: 3, openedAt: NOW - 11 * DAY, closedAt: NOW - 10 * DAY });  // opened after wave 2 closed: from its open
    const h = coord.leadHistoryOf('prog-a', NOW);
    expect(h.own.done).toEqual([5 * DAY, 3 * DAY, DAY]);
    expect(h.own).toMatchObject({ waves: 3, abandons: 0, reworks: 0, leadsUnmeasured: 0 });
  });

  it('a second work run of one wave is a rework lead; the first run\'s lead is the wave\'s', () => {
    run({ wave: 1, openedAt: NOW - 20 * DAY, state: 'failed', closedAt: NOW - 18 * DAY, closeDetail: 'review-requested-changes' });
    run({ wave: 1, openedAt: NOW - 17 * DAY, closedAt: NOW - 16 * DAY });
    const h = coord.leadHistoryOf('prog-a', NOW).own;
    expect(h).toMatchObject({ done: [2 * DAY], rework: [DAY], waves: 1, reworks: 1 });
  });

  it('an abandon: close is an abandoned lead, so is the dispatch abandon; abandon:never-started is left out', () => {
    run({ wave: 1, openedAt: NOW - 20 * DAY, state: 'failed', closedAt: NOW - 19 * DAY, closeDetail: 'abandon:operator' });
    run({ wave: 2, openedAt: NOW - 19 * DAY, state: 'failed', closedAt: NOW - 17 * DAY, closeDetail: DISPATCH_ABANDON_CLOSE_DETAIL });
    run({ wave: 3, openedAt: NOW - 17 * DAY, state: 'failed', closedAt: NOW - 16 * DAY, closeDetail: 'abandon:never-started' });
    run({ wave: 4, openedAt: NOW - 17 * DAY, closedAt: NOW - 14 * DAY });
    const h = coord.leadHistoryOf('prog-a', NOW).own;
    expect(h).toMatchObject({ abandoned: [DAY, 2 * DAY], done: [3 * DAY], waves: 3, abandons: 2 });
  });

  it('leaves a review run out, and counts a wave with a rebuilt run in leadsUnmeasured', () => {
    run({ wave: 1, openedAt: NOW - 20 * DAY, closedAt: NOW - 18 * DAY });
    run({ wave: 1, kind: 'review', openedAt: NOW - 18 * DAY, closedAt: NOW - 17 * DAY });
    run({ wave: 2, openedAt: NOW - 18 * DAY, dispatchedAt: NOW - 18 * DAY, claimedBy: null, closedAt: NOW - 15 * DAY });
    const h = coord.leadHistoryOf('prog-a', NOW).own;
    expect(h).toMatchObject({ done: [2 * DAY], waves: 1, leadsUnmeasured: 1 });
  });

  it('leaves out a wave closed after asOf, and a run opened after it', () => {
    run({ wave: 1, openedAt: NOW - 20 * DAY, closedAt: NOW - 18 * DAY });
    run({ wave: 2, openedAt: NOW - 18 * DAY, closedAt: NOW - 5 * DAY });
    run({ wave: 1, openedAt: NOW - 9 * DAY, closedAt: NOW - 8 * DAY });  // a rework of wave 1 opened after asOf
    const h = coord.leadHistoryOf('prog-a', NOW - 10 * DAY).own;
    expect(h).toMatchObject({ done: [2 * DAY], rework: [], waves: 1, reworks: 0 });
  });

  it('the fleet pools every programme\'s samples, the programme\'s own included', () => {
    run({ wave: 1, openedAt: NOW - 20 * DAY, closedAt: NOW - 18 * DAY });
    run({ program: 'prog-b', wave: 1, openedAt: NOW - 20 * DAY, closedAt: NOW - 17 * DAY });
    const h = coord.leadHistoryOf('prog-a', NOW);
    expect(h.own.done).toEqual([2 * DAY]);
    expect([...h.fleet.done].sort((a, b) => a - b)).toEqual([2 * DAY, 3 * DAY]);
    expect(h.fleet.waves).toBe(2);
  });
});

describe('outcomeFactsOf, what forecastOutcome reads', () => {
  it('the done wave closes after asOf by the wave rule, and every run open or closed after asOf; never a statement', () => {
    const closing = run({ wave: 1, closedAt: NOW - HOUR });
    seal(closing);
    const [s] = coord.forecastsOf({ program: 'prog-a' });
    run({ wave: 2, openedAt: NOW - 30 * MIN, closedAt: NOW + DAY });
    run({ wave: 3, openedAt: NOW, state: 'failed', closedAt: NOW + 2 * DAY });
    run({ wave: 3, openedAt: NOW + 2 * DAY, state: 'working', closedAt: null });   // wave 3 represented by its open run
    run({ wave: 4, kind: 'review', openedAt: NOW + DAY, closedAt: NOW + 3 * DAY });
    statement('prog-a', null, 0, 0, NOW + HOUR);
    const f = coord.outcomeFactsOf(s!.id)!;
    expect(f.doneWaveCloses).toEqual([NOW + DAY]);
    expect(f.runs.map((r) => r.openedAt)).toEqual([NOW - 30 * MIN, NOW, NOW + 2 * DAY, NOW + DAY]);
    expect(coord.outcomeFactsOf(9999)).toBeNull();
  });
});
