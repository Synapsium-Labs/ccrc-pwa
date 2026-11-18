// Overlord W2, forecasts A (plan w2-forecasts-health.md, Task 4) and B (Task 7): the forecast lane's seal, score, spend and
// health arms, over a fixture
// coord.db, with seeded entropy (`fakeTime`) and `now` handed in, as the watcher hands its wall reading in. No watcher is
// built here: the lane's row is `lane-schedule.test.ts`'s, and its clock is the time-ports census's.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { forecastProgramme } from '../src/coord/forecast.js';
import { runForecastLane, type ForecastLanePort, type ForecastLive, type UsageRead } from '../src/coord/forecastLane.js';
import type { SpendReading } from '../src/coord/programmeMeasures.js';
import type { HealthVerdict } from '../../shared/programmeFacts.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let coord: CoordStore;
const newStore = (): CoordStore => {
  const c = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-forecast-lane-'), '.ccrc', 'coord.db')));
  for (const slug of ['prog-a', 'prog-b']) {
    c.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')").run(slug, `Title of ${slug}`, T0 - 300 * DAY);
  }
  return c;
};
beforeEach(() => { coord = newStore(); });

const run = (c: CoordStore, program: string, wave: number, openedAt: number, closedAt: number | null, state = closedAt === null ? 'working' : 'done'): number =>
  Number(c.db.prepare(
    "INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt, claimedBy) VALUES (?, ?, 'project-a', ?, 'work', ?, ?, ?, 'lane-a-project-a')",
  ).run(program, wave, state, openedAt, openedAt + MIN, closedAt).lastInsertRowid);
/** Twenty-two done waves of one day each, ending 30 days before T0: enough own history to forecast. */
const history = (c: CoordStore, program: string): void => {
  for (let w = 1; w <= 22; w++) run(c, program, w, T0 - (60 - w) * DAY, T0 - (59 - w) * DAY);
};
const state = (c: CoordStore, program: string, runId: number | null, lo: number, hi: number, at: number): number => {
  const r = c.insertRemaining(program, 'lane-a-project-a', { lo, hi, reason: 'left', runId }, [], null, at);
  if (!r.ok) throw new Error(r.detail);
  return r.id;
};
const seals = (c: CoordStore, program = 'prog-a') => c.forecastsOf({ program });
const entropy = (seed = 3) => fakeTime({ seed }).ports.entropy;

describe('the seal arm', () => {
  it('a close with a statement naming it is sealed on the first pass, as of the later of the close and the statement', () => {
    history(coord, 'prog-a');
    const r = run(coord, 'prog-a', 23, T0 - 2 * DAY, T0 - 2 * MIN);
    const st = state(coord, 'prog-a', r, 2, 3, T0 - MIN);
    const pass = runForecastLane(coord, T0, entropy());
    expect(pass).toMatchObject({ sealed: 1, waiting: 0, failed: [] });
    const [s] = seals(coord).filter((x) => x.closingRunId === r);
    expect(s).toMatchObject({ statementId: st, lo: 2, hi: 3, asOf: T0 - MIN, sealedAt: T0, outcome: 'open' });
    // Twenty-two waves of history, and the closing wave itself, closed by the boundary.
    expect(s!.forecast).toMatchObject({ kind: 'forecast', source: 'own', n: 23 });
  });

  it('a close no statement names waits 30 minutes, then seals with the newest statement standing then', () => {
    history(coord, 'prog-a');
    const r = run(coord, 'prog-a', 23, T0 - 2 * DAY, T0);
    const st = state(coord, 'prog-a', null, 1, 4, T0 + 10 * MIN);
    expect(runForecastLane(coord, T0 + 29 * MIN, entropy())).toMatchObject({ sealed: 0, waiting: 1 });
    expect(seals(coord).filter((x) => x.closingRunId === r)).toEqual([]);
    expect(runForecastLane(coord, T0 + 30 * MIN, entropy())).toMatchObject({ sealed: 1, waiting: 0 });
    expect(seals(coord).find((x) => x.closingRunId === r)).toMatchObject({ statementId: st, lo: 1, hi: 4, asOf: T0 + 10 * MIN });
  });

  it('with the lane down past the wait, a statement naming the close made after the wait does not move the seal (F7, F19)', () => {
    history(coord, 'prog-a');
    const r = run(coord, 'prog-a', 23, T0 - 2 * DAY, T0);
    const standing = state(coord, 'prog-a', null, 1, 4, T0 + 10 * MIN);
    state(coord, 'prog-a', r, 6, 8, T0 + 45 * MIN);
    expect(runForecastLane(coord, T0 + HOUR, entropy())).toMatchObject({ sealed: 1 });
    expect(seals(coord).find((x) => x.closingRunId === r)).toMatchObject({ statementId: standing, lo: 1, hi: 4, asOf: T0 + 10 * MIN });
  });

  it('a close in a gap the lane was down for is never sealed, and the pass counts it missed (F5)', () => {
    run(coord, 'prog-a', 1, T0 - 21 * DAY, T0 - 20 * DAY);
    expect(runForecastLane(coord, T0 - 20 * DAY + 30 * MIN, entropy())).toMatchObject({ sealed: 1, missed: 0 });
    const gap = run(coord, 'prog-a', 2, T0 - 16 * DAY, T0 - 15 * DAY);
    expect(runForecastLane(coord, T0, entropy())).toMatchObject({ sealed: 0, missed: 1, failed: [] });
    expect(seals(coord).map((x) => x.closingRunId)).not.toContain(gap);
  });

  it('a close with no statement at all seals unforecastable, no-remaining, after the wait', () => {
    const r = run(coord, 'prog-a', 1, T0 - DAY, T0);
    runForecastLane(coord, T0 + 30 * MIN, entropy());
    expect(seals(coord).find((x) => x.closingRunId === r)).toMatchObject({
      statementId: null, lo: null, hi: null, asOf: T0, forecast: { kind: 'unforecastable', reason: 'no-remaining' } });
  });

  it('the seed stored replays to the same dates', () => {
    history(coord, 'prog-a');
    const r = run(coord, 'prog-a', 23, T0 - 2 * DAY, T0);
    state(coord, 'prog-a', r, 3, 6, T0 + MIN);
    runForecastLane(coord, T0 + MIN, entropy(17));
    const s = seals(coord).find((x) => x.closingRunId === r)!;
    if (s.forecast === 'unreadable' || s.forecast.kind !== 'forecast') throw new Error('expected a forecast');
    expect(forecastProgramme(coord.leadHistoryOf('prog-a', s.asOf), { lo: 3, hi: 6 }, s.forecast.seed, s.asOf)).toEqual(s.forecast);
  });

  it('a close sealed five days late has the same dates as one sealed on time (F19)', () => {
    const late = newStore();
    for (const c of [coord, late]) {
      history(c, 'prog-a');
      const r = run(c, 'prog-a', 23, T0 - 2 * DAY, T0);
      state(c, 'prog-a', null, 2, 5, T0 + 5 * MIN);
      // After the boundary: a statement past the wait, and a wave of history closed later. Neither may move the seal.
      state(c, 'prog-a', r + 1000, 9, 9, T0 + 2 * DAY);
      run(c, 'prog-a', 24, T0 + MIN, T0 + DAY);
    }
    runForecastLane(coord, T0 + 30 * MIN, entropy(5));
    runForecastLane(late, T0 + 5 * DAY, entropy(5));
    const pick = (c: CoordStore) => { const s = seals(c).find((x) => x.lo === 2)!; return [s.asOf, s.statementId, s.forecast]; };
    expect(pick(late)).toEqual(pick(coord));
    expect((pick(late)[2] as { kind: string }).kind).toBe('forecast');
  });

  it('a second pass changes nothing', () => {
    history(coord, 'prog-a');
    const r = run(coord, 'prog-a', 23, T0 - 2 * DAY, T0);
    state(coord, 'prog-a', r, 1, 1, T0);
    runForecastLane(coord, T0 + MIN, entropy());
    const before = coord.db.prepare('SELECT * FROM programme_forecasts ORDER BY id').all();
    expect(runForecastLane(coord, T0 + 2 * MIN, entropy(99))).toMatchObject({ sealed: 0, scored: 0, failed: [] });
    expect(coord.db.prepare('SELECT * FROM programme_forecasts ORDER BY id').all()).toEqual(before);
  });

  it('a throw on one programme leaves another\'s seal written, and is recorded on the pass', () => {
    const ra = run(coord, 'prog-a', 1, T0 - DAY, T0);
    const rb = run(coord, 'prog-b', 1, T0 - DAY, T0);
    state(coord, 'prog-a', ra, 1, 2, T0);
    state(coord, 'prog-b', rb, 1, 2, T0);
    const port: ForecastLanePort = Object.assign(Object.create(coord) as CoordStore, {
      leadHistoryOf: (program: string, asOf: number) => {
        if (program === 'prog-a') throw new Error('runs unreadable');
        return coord.leadHistoryOf(program, asOf);
      },
    });
    const pass = runForecastLane(port, T0 + MIN, entropy());
    expect(pass).toMatchObject({ sealed: 1, failed: ['prog-a: runs unreadable'] });
    expect(seals(coord, 'prog-a')).toEqual([]);
    expect(seals(coord, 'prog-b')).toHaveLength(1);
  });
});

describe('the score arm', () => {
  const sealOne = (c: CoordStore): { runId: number; p85At: number } => {
    history(c, 'prog-a');
    const r = run(c, 'prog-a', 23, T0 - 2 * DAY, T0);
    state(c, 'prog-a', r, 1, 1, T0);
    runForecastLane(c, T0 + MIN, entropy());
    const s = seals(c).find((x) => x.closingRunId === r)!;
    if (s.forecast === 'unreadable' || s.forecast.kind !== 'forecast') throw new Error('expected a forecast');
    return { runId: r, p85At: s.forecast.p85At };
  };

  it('a pass after the 85% date scores the seal met when the waves closed, and a second pass changes nothing', () => {
    const { runId, p85At } = sealOne(coord);
    run(coord, 'prog-a', 24, T0 + MIN, p85At - MIN);
    expect(runForecastLane(coord, p85At - 1, entropy())).toMatchObject({ scored: 0 });
    expect(runForecastLane(coord, p85At, entropy())).toMatchObject({ scored: 1 });
    expect(seals(coord).find((x) => x.closingRunId === runId)).toMatchObject({ outcome: 'met', scoredAt: p85At });
    expect(runForecastLane(coord, p85At + MIN, entropy())).toMatchObject({ scored: 0 });
  });

  it('a seal whose waves did not close by its date is scored missed', () => {
    const { runId, p85At } = sealOne(coord);
    run(coord, 'prog-a', 24, T0 + MIN, null);
    runForecastLane(coord, p85At + HOUR, entropy());
    expect(seals(coord).find((x) => x.closingRunId === runId)).toMatchObject({ outcome: 'missed', scoredAt: p85At + HOUR });
  });

  it('an unforecastable seal is never scored', () => {
    const r = run(coord, 'prog-a', 1, T0 - DAY, T0);
    runForecastLane(coord, T0 + 30 * MIN, entropy());
    runForecastLane(coord, T0 + 400 * DAY, entropy());
    expect(seals(coord).find((x) => x.closingRunId === r)).toMatchObject({ outcome: 'open', scoredAt: null });
  });
});

// ── Forecasts B: the spend arm and the health arm (plan w2-forecasts-health.md, Task 7) ─────────────────────────────
// The same real CoordStore as the port. `ForecastLive` is built here: a usage port whose readiness and readings the test
// sets, a notice spy (the lane's only sink: it has no push, no mail), and the live-ask and live-spend ports the health arm
// hands the portfolio's facts.

const spendRun = (c: CoordStore, o: { program?: string; wave?: number; kind?: string; openedAt: number; dispatchedAt: number | null;
  closedAt: number | null; sessionId: string | null; reviews?: number | null }): number =>
  Number(c.db.prepare(
    "INSERT INTO runs (program, wave, project, state, kind, reviews, openedAt, dispatchedAt, closedAt, sessionId, claimedBy) VALUES (?, ?, 'project-a', ?, ?, ?, ?, ?, ?, ?, 'lane-a-project-a')",
  ).run(o.program ?? 'prog-a', o.wave ?? 1, o.closedAt === null ? 'working' : 'done', o.kind ?? 'work', o.reviews ?? null, o.openedAt, o.dispatchedAt,
    o.closedAt, o.sessionId).lastInsertRowid);
const rowOf = (c: CoordStore, runId: number) => c.db.prepare('SELECT runId, at, state, cost, class, readAt, startCost FROM run_spend WHERE runId = ?').get(runId);
const reading = (o: Partial<SpendReading> = {}): SpendReading =>
  ({ readAt: T0 - HOUR - 5 * MIN, cost: 3.5, class: 'opus', stale: false, sidecarUuid: 'conv-1', conversationUuid: 'conv-1', ...o });

interface Harness { live: ForecastLive; ready: { value: boolean }; readings: Map<string, SpendReading>; notice: ReturnType<typeof vi.fn> }
const harness = (spendSince = T0 - DAY): Harness => {
  const ready = { value: true };
  const readings = new Map<string, SpendReading>();
  const usage: UsageRead = { ready: () => ready.value, reading: (id) => readings.get(id) ?? null };
  const notice = vi.fn();
  const live: ForecastLive = { usage, spendSince, liveAsk: () => ({ kind: 'unmeasured' }), liveSpend: () => ({ kind: 'none' }), notice };
  return { live, ready, readings, notice };
};

describe('the spend arm', () => {
  const closed = (c: CoordStore, sessionId: string | null, o: { wave?: number; kind?: string; dispatchedAt?: number; closedAt?: number } = {}) =>
    spendRun(c, { wave: o.wave ?? 1, kind: o.kind, openedAt: T0 - 6 * HOUR, dispatchedAt: o.dispatchedAt ?? T0 - 5 * HOUR, closedAt: o.closedAt ?? T0 - HOUR, sessionId });

  it('a closed run with an in-window, fresh, same-conversation reading gets a measured row', () => {
    const h = harness();
    const r = closed(coord, 'sess-a');
    h.readings.set('sess-a', reading());
    expect(runForecastLane(coord, T0, entropy(), h.live)).toMatchObject({ spent: 1, spendWaiting: false, failed: [] });
    expect(rowOf(coord, r)).toEqual({ runId: r, at: T0, state: 'measured', cost: 3.5, class: 'opus', readAt: T0 - HOUR - 5 * MIN, startCost: null });
  });

  it('a review run is recorded too', () => {
    const h = harness();
    const r = closed(coord, 'sess-r', { kind: 'review', wave: 2 });
    h.readings.set('sess-r', reading());
    runForecastLane(coord, T0, entropy(), h.live);
    expect(rowOf(coord, r)).toMatchObject({ state: 'measured', cost: 3.5 });
  });

  it('a reading older than the run\'s dispatch gets outside, with no cost', () => {
    const h = harness();
    const r = closed(coord, 'sess-a');
    h.readings.set('sess-a', reading({ readAt: T0 - 5 * HOUR - 1 }));
    runForecastLane(coord, T0, entropy(), h.live);
    expect(rowOf(coord, r)).toMatchObject({ state: 'outside', cost: null, class: 'opus', readAt: T0 - 5 * HOUR - 1 });
  });

  it('a stale reading gets outside', () => {
    const h = harness();
    const r = closed(coord, 'sess-a');
    h.readings.set('sess-a', reading({ stale: true }));
    runForecastLane(coord, T0, entropy(), h.live);
    expect(rowOf(coord, r)).toMatchObject({ state: 'outside', cost: null });
  });

  it('a session dispatched to a later run gets outside for the earlier one, and the later run measures', () => {
    const h = harness();
    const early = closed(coord, 'sess-a', { wave: 1, dispatchedAt: T0 - 5 * HOUR, closedAt: T0 - 3 * HOUR });
    const later = closed(coord, 'sess-a', { wave: 2, dispatchedAt: T0 - 2 * HOUR, closedAt: T0 - HOUR });
    h.readings.set('sess-a', reading());
    runForecastLane(coord, T0, entropy(), h.live);
    expect(rowOf(coord, early)).toMatchObject({ state: 'outside', cost: null });
    expect(rowOf(coord, later)).toMatchObject({ state: 'measured', cost: 3.5 });
  });

  it('no reading, and no session, get absent', () => {
    const h = harness();
    const noReading = closed(coord, 'sess-x', { wave: 1 });
    const noSession = closed(coord, null, { wave: 2 });
    runForecastLane(coord, T0, entropy(), h.live);
    expect(rowOf(coord, noReading)).toMatchObject({ state: 'absent', cost: null, class: null, readAt: null });
    expect(rowOf(coord, noSession)).toMatchObject({ state: 'absent', cost: null });
  });

  it('while the usage sweep has not run, nothing is written and the pass says so; the run is recorded on the first pass after it has (the boot guard)', () => {
    const h = harness();
    h.ready.value = false;
    const r = closed(coord, 'sess-a');
    h.readings.set('sess-a', reading());
    expect(runForecastLane(coord, T0, entropy(), h.live)).toMatchObject({ spent: 0, spendWaiting: true, failed: [] });
    expect(rowOf(coord, r)).toBeUndefined();
    h.ready.value = true;
    expect(runForecastLane(coord, T0 + MIN, entropy(), h.live)).toMatchObject({ spent: 1, spendWaiting: false });
    expect(rowOf(coord, r)).toMatchObject({ state: 'measured', at: T0 + MIN });
  });

  it('a run closed before the first pass and before any run_spend row gets no row (no backfill)', () => {
    const h = harness(T0 - 2 * HOUR);
    const old = closed(coord, 'sess-a', { wave: 1, closedAt: T0 - 3 * HOUR });
    const fresh = closed(coord, 'sess-b', { wave: 2, closedAt: T0 - HOUR });
    h.readings.set('sess-a', reading());
    h.readings.set('sess-b', reading());
    expect(runForecastLane(coord, T0, entropy(), h.live)).toMatchObject({ spent: 1 });
    expect(rowOf(coord, old)).toBeUndefined();
    expect(rowOf(coord, fresh)).toMatchObject({ state: 'measured' });
  });

  it('a second pass changes nothing', () => {
    const h = harness();
    closed(coord, 'sess-a', { wave: 1 });
    closed(coord, null, { wave: 2 });
    h.readings.set('sess-a', reading());
    runForecastLane(coord, T0, entropy(), h.live);
    const before = coord.db.prepare('SELECT * FROM run_spend ORDER BY runId').all();
    h.readings.set('sess-a', reading({ cost: 99, readAt: T0 - HOUR - MIN }));
    expect(runForecastLane(coord, T0 + 2 * MIN, entropy(), h.live)).toMatchObject({ spent: 0, failed: [] });
    expect(coord.db.prepare('SELECT * FROM run_spend ORDER BY runId').all()).toEqual(before);
  });

  it('with no live ports the arms do not run at all', () => {
    closed(coord, 'sess-a');
    expect(runForecastLane(coord, T0, entropy())).toMatchObject({ spent: 0, spendWaiting: false, healthChanged: 0, notices: 0 });
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM run_spend').get()).toEqual({ n: 0 });
  });
});

describe('the health arm', () => {
  const healthRows = (c: CoordStore, program = 'prog-a') =>
    c.db.prepare('SELECT word, noticed, at FROM programme_health WHERE program = ? ORDER BY id').all(program) as { word: string; noticed: number; at: number }[];
  /** A programme with an open run and one open `blocking` item: the health decider's first row says `blocked-on-you`. */
  const block = (c: CoordStore): void => {
    c.db.prepare("INSERT INTO operator_items (program, raisedBy, kind, title, why, how, neededBy, state, raisedAt) VALUES ('prog-a', 'coordinator', 'do', 'decide', 'w', '[]', 'blocking', 'open', ?)").run(T0 - HOUR);
  };
  const unblock = (c: CoordStore): void => { c.db.prepare("UPDATE operator_items SET state = 'done', closedAt = ?").run(T0); };
  const open = (c: CoordStore): void => {
    spendRun(c, { openedAt: T0 - 2 * HOUR, dispatchedAt: T0 - 2 * HOUR, closedAt: null, sessionId: null });
  };

  it('a programme\'s first row is recorded with no notice, and a repeat of the same word appends none', () => {
    const h = harness();
    open(coord);
    expect(runForecastLane(coord, T0, entropy(), h.live)).toMatchObject({ healthChanged: 1, notices: 0, failed: [] });
    expect(healthRows(coord)).toHaveLength(1);
    expect(healthRows(coord)[0]).toMatchObject({ noticed: 0, at: T0 });
    expect(runForecastLane(coord, T0 + MIN, entropy(), h.live)).toMatchObject({ healthChanged: 0, notices: 0 });
    expect(healthRows(coord)).toHaveLength(1);
    expect(h.notice).not.toHaveBeenCalled();
  });

  it('a worse word records one notice naming the programme and the word, and a row with noticed 1', () => {
    const h = harness();
    open(coord);
    runForecastLane(coord, T0, entropy(), h.live);
    const first = healthRows(coord)[0]!.word;
    block(coord);
    const pass = runForecastLane(coord, T0 + MIN, entropy(), h.live);
    expect(pass).toMatchObject({ healthChanged: 1, notices: 1, failed: [] });
    expect(first).not.toBe('blocked-on-you');
    expect(healthRows(coord).map((r) => [r.word, r.noticed])).toEqual([[first, 0], ['blocked-on-you', 1]]);
    expect(h.notice).toHaveBeenCalledTimes(1);
    expect(h.notice.mock.calls[0]![0]).toBe('prog-a');
    expect((h.notice.mock.calls[0]![1] as HealthVerdict).word).toBe('blocked-on-you');
  });

  it('a flap back and worse again inside 24 hours changes the rows but records no second notice', () => {
    const h = harness();
    open(coord);
    runForecastLane(coord, T0, entropy(), h.live);
    block(coord);
    runForecastLane(coord, T0 + MIN, entropy(), h.live);
    unblock(coord);
    expect(runForecastLane(coord, T0 + 2 * MIN, entropy(), h.live)).toMatchObject({ healthChanged: 1, notices: 0 });
    block(coord);
    expect(runForecastLane(coord, T0 + 3 * MIN, entropy(), h.live)).toMatchObject({ healthChanged: 1, notices: 0 });
    expect(healthRows(coord).map((r) => [r.word, r.noticed]).filter(([w]) => w === 'blocked-on-you')).toEqual([['blocked-on-you', 1], ['blocked-on-you', 0]]);
    expect(h.notice).toHaveBeenCalledTimes(1);
    // A day on, the same worsening is a new notice.
    unblock(coord);
    runForecastLane(coord, T0 + 25 * HOUR, entropy(), h.live);
    block(coord);
    expect(runForecastLane(coord, T0 + 25 * HOUR + MIN, entropy(), h.live)).toMatchObject({ notices: 1 });
    expect(h.notice).toHaveBeenCalledTimes(2);
  });

  it('a better word records a row and no notice', () => {
    const h = harness();
    open(coord);
    block(coord);
    runForecastLane(coord, T0, entropy(), h.live);
    unblock(coord);
    expect(runForecastLane(coord, T0 + MIN, entropy(), h.live)).toMatchObject({ healthChanged: 1, notices: 0 });
    expect(healthRows(coord).map((r) => [r.word, r.noticed])).toEqual([['blocked-on-you', 0], [healthRows(coord)[1]!.word, 0]]);
    expect(healthRows(coord)[1]!.word).not.toBe('blocked-on-you');
    expect(h.notice).not.toHaveBeenCalled();
  });

  it('the arm\'s only sink is the notice spy: a worse word pushes and mails nothing', () => {
    const h = harness();
    open(coord);
    runForecastLane(coord, T0, entropy(), h.live);
    block(coord);
    const before = ['push_outbox', 'mail', 'feed_events'].map((t) => coord.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get());
    runForecastLane(coord, T0 + MIN, entropy(), h.live);
    expect(['push_outbox', 'mail', 'feed_events'].map((t) => coord.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get())).toEqual(before);
    expect(h.notice).toHaveBeenCalledTimes(1);
  });

  it('a throw in portfolioFacts is recorded in failed and the seal arm\'s work still stands', () => {
    const h = harness();
    history(coord, 'prog-a');
    const r = run(coord, 'prog-a', 23, T0 - 2 * DAY, T0 - 2 * MIN);
    state(coord, 'prog-a', r, 2, 3, T0 - MIN);
    open(coord);
    const port: ForecastLanePort = Object.assign(Object.create(coord) as CoordStore, {
      portfolioFacts: () => { throw new Error('runs unreadable'); },
    });
    const pass = runForecastLane(port, T0, entropy(), h.live);
    expect(pass).toMatchObject({ sealed: 1, healthChanged: 0, notices: 0, failed: ['health: runs unreadable'] });
    expect(seals(coord).filter((x) => x.closingRunId === r)).toHaveLength(1);
    expect(healthRows(coord)).toEqual([]);
  });
});
