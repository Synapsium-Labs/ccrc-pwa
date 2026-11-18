// Overlord W2, forecasts A (plan w2-forecasts-health.md, Task 4): the forecast lane's seal and score arms, over a fixture
// coord.db, with seeded entropy (`fakeTime`) and `now` handed in, as the watcher hands its wall reading in. No watcher is
// built here: the lane's row is `lane-schedule.test.ts`'s, and its clock is the time-ports census's.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { forecastProgramme } from '../src/coord/forecast.js';
import { runForecastLane, type ForecastLanePort } from '../src/coord/forecastLane.js';
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

// Overlord W2 remaining work B (plan w2-remaining-work.md, Task 5): the edge arm. Every target is read through the
// done-test vocabulary's one reader, over the same fixture coord.db.
describe('the edge arm', () => {
  const HEAD = 'a'.repeat(40);
  const WEEK = 7 * DAY;
  const closeRun = (c: CoordStore, id: number, s: 'done' | 'failed', closePr: { pr: number; merged: boolean } | null, at = T0) =>
    c.db.prepare('UPDATE runs SET state = ?, closedAt = ?, closePr = ? WHERE id = ?')
      .run(s, at, closePr === null ? null : JSON.stringify({ ...closePr, head: HEAD }), id);
  const edgeOn = (c: CoordStore, target: Record<string, unknown>, kind = 'needs-landed'): number => {
    const r = c.insertRemaining('prog-a', 'lane-a-project-a', { lo: 1, hi: 2, reason: 'left', runId: null },
      [{ kind: kind as never, target: target as never, why: 'waits on it' }], null, T0 - HOUR);
    if (!r.ok) throw new Error(r.detail);
    return [...r.added, ...r.kept][0]!;
  };
  const edgeRow = (c: CoordStore, id: number) =>
    c.db.prepare('SELECT state, endedAt, evidence, unmeasuredSince FROM programme_edges WHERE id = ?').get(id) as
      { state: string; endedAt: number | null; evidence: string | null; unmeasuredSince: number | null };
  /** The store, with its run read throwing: the reader answers `unmeasured` and holds. */
  const locked = (c: CoordStore): ForecastLanePort => Object.assign(Object.create(c) as CoordStore, {
    run: () => { throw new Error('database is locked'); },
  });

  it('an edge whose run closed with its pull request merged is met after one pass, run-closed and pr-merged alike', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const landed = edgeOn(coord, { predicate: 'run-closed', runId: rb });
    const merged = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 7 });
    expect(runForecastLane(coord, T0 - MIN, entropy())).toMatchObject({ edgesEnded: 0, edgesUnmeasured: 0, failed: [] });
    expect(edgeRow(coord, landed)).toEqual({ state: 'open', endedAt: null, evidence: null, unmeasuredSince: null });
    closeRun(coord, rb, 'done', { pr: 7, merged: true });
    expect(runForecastLane(coord, T0, entropy())).toMatchObject({ edgesEnded: 2, failed: [] });
    expect(edgeRow(coord, landed)).toEqual({ state: 'met', endedAt: T0, evidence: 'pr-7', unmeasuredSince: null });
    expect(edgeRow(coord, merged)).toEqual({ state: 'met', endedAt: T0, evidence: 'pr-7', unmeasuredSince: null });
  });

  it('an edge whose pull request closed unmerged is target-ended, with the measured end', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const e = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 7 });
    closeRun(coord, rb, 'done', { pr: 7, merged: false });
    runForecastLane(coord, T0, entropy());
    expect(edgeRow(coord, e)).toEqual({ state: 'target-ended', endedAt: T0, evidence: 'pr-7-not-merged', unmeasuredSince: null });
  });

  it('a pr-merged edge on a pull request that is not the run\'s own ends target-unmeasurable at once (review 2381 N1)', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const e = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 6 });
    coord.foldPrLineage(rb, [{ pr: 6, branch: 'ws/b', phase: 'closed', recordedAt: Math.floor(T0 / 1000) - 60 }]);
    closeRun(coord, rb, 'done', { pr: 7, merged: true });
    expect(runForecastLane(coord, T0, entropy())).toMatchObject({ edgesEnded: 1, edgesUnmeasured: 0 });
    expect(edgeRow(coord, e)).toMatchObject({ state: 'target-unmeasurable', endedAt: T0, evidence: 'unmeasurable: lineage-unattributed' });
  });

  it('an operator-confirms edge is met once the item is done', () => {
    const item = coord.raiseItem({ program: 'prog-a', runId: null, raisedBy: 'lane-a-project-a', kind: 'do', title: 't', why: 'w',
      how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, T0 - DAY);
    const e = edgeOn(coord, { predicate: 'operator-confirms', itemId: item }, 'needs-decision');
    coord.db.prepare("UPDATE operator_items SET state = 'done' WHERE id = ?").run(item);
    runForecastLane(coord, T0, entropy());
    expect(edgeRow(coord, e)).toMatchObject({ state: 'met', evidence: `item-${item}-done` });
  });

  it('an unmeasured target leaves the edge open with its clock; seven days of unmeasured passes later it is target-unmeasurable', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const e = edgeOn(coord, { predicate: 'run-closed', runId: rb });
    expect(runForecastLane(locked(coord), T0, entropy())).toMatchObject({ edgesEnded: 0, edgesUnmeasured: 1, failed: [] });
    expect(edgeRow(coord, e)).toEqual({ state: 'open', endedAt: null, evidence: null, unmeasuredSince: T0 });
    expect(coord.openEdgesOf(['prog-a'])[0]).toMatchObject({ id: e, unmeasured: true });
    runForecastLane(locked(coord), T0 + WEEK - 1, entropy());
    expect(edgeRow(coord, e)).toMatchObject({ state: 'open', unmeasuredSince: T0 });
    expect(runForecastLane(locked(coord), T0 + WEEK, entropy())).toMatchObject({ edgesEnded: 1 });
    expect(edgeRow(coord, e)).toEqual({ state: 'target-unmeasurable', endedAt: T0 + WEEK, evidence: `unmeasured since ${T0}: Error`, unmeasuredSince: T0 });
  });

  it('a measured pending answer in between resets the clock', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const e = edgeOn(coord, { predicate: 'run-closed', runId: rb });
    runForecastLane(locked(coord), T0, entropy());
    runForecastLane(coord, T0 + 3 * DAY, entropy());
    expect(edgeRow(coord, e)).toMatchObject({ state: 'open', unmeasuredSince: null });
    runForecastLane(locked(coord), T0 + 4 * DAY, entropy());
    runForecastLane(locked(coord), T0 + WEEK + DAY, entropy());
    expect(edgeRow(coord, e)).toMatchObject({ state: 'open', unmeasuredSince: T0 + 4 * DAY });
  });

  it('a second pass changes nothing', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    edgeOn(coord, { predicate: 'run-closed', runId: rb });
    edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 7 });
    runForecastLane(locked(coord), T0, entropy());
    closeRun(coord, rb, 'done', { pr: 7, merged: true });
    runForecastLane(coord, T0 + MIN, entropy());
    const before = coord.db.prepare('SELECT * FROM programme_edges ORDER BY id').all();
    expect(runForecastLane(coord, T0 + 2 * MIN, entropy())).toMatchObject({ edgesEnded: 0, edgesUnmeasured: 0, failed: [] });
    expect(coord.db.prepare('SELECT * FROM programme_edges ORDER BY id').all()).toEqual(before);
  });

  it('an edge a concurrent pass already met is not written again (the writer\'s state = open guard)', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const e = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 7 });
    const stale = coord.openEdgesToMeasure();
    closeRun(coord, rb, 'done', { pr: 7, merged: true });
    runForecastLane(coord, T0, entropy());
    closeRun(coord, rb, 'done', { pr: 7, merged: false });
    const port: ForecastLanePort = Object.assign(Object.create(coord) as CoordStore, { openEdgesToMeasure: () => stale });
    expect(runForecastLane(port, T0 + MIN, entropy())).toMatchObject({ edgesEnded: 0, failed: [] });
    expect(edgeRow(coord, e)).toEqual({ state: 'met', endedAt: T0, evidence: 'pr-7', unmeasuredSince: null });
  });

  it('an edge whose state, kind or target this build cannot read is never written', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const a = edgeOn(coord, { predicate: 'run-closed', runId: rb });
    const b = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 7 });
    const k = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 8 });
    coord.db.prepare("UPDATE programme_edges SET state = 'paused' WHERE id = ?").run(a);
    coord.db.prepare("UPDATE programme_edges SET target = '{\"predicate\":\"pr-merged\",\"runId\":1,\"pr\":7,\"repo\":\"x\"}' WHERE id = ?").run(b);
    coord.db.prepare("UPDATE programme_edges SET kind = 'needs-x' WHERE id = ?").run(k);
    closeRun(coord, rb, 'done', { pr: 7, merged: true });
    const before = coord.db.prepare('SELECT * FROM programme_edges ORDER BY id').all();
    expect(runForecastLane(locked(coord), T0 + WEEK * 2, entropy())).toMatchObject({ edgesEnded: 0, edgesUnmeasured: 0, failed: [] });
    expect(runForecastLane(coord, T0 + WEEK * 2, entropy())).toMatchObject({ edgesEnded: 0, failed: [] });
    expect(coord.db.prepare('SELECT * FROM programme_edges ORDER BY id').all()).toEqual(before);
  });

  it('a throw from the writer on one edge is recorded on the pass, and the next edge is still settled', () => {
    const rb = run(coord, 'prog-b', 1, T0 - DAY, null);
    const first = edgeOn(coord, { predicate: 'run-closed', runId: rb });
    const second = edgeOn(coord, { predicate: 'pr-merged', runId: rb, pr: 7 });
    closeRun(coord, rb, 'done', { pr: 7, merged: true });
    const port: ForecastLanePort = Object.assign(Object.create(coord) as CoordStore, {
      settleEdge: (id: number, settle: Parameters<CoordStore['settleEdge']>[1], now: number) => {
        if (id === first) throw new Error('database is locked');
        return coord.settleEdge(id, settle, now);
      },
    });
    expect(runForecastLane(port, T0, entropy())).toMatchObject({ edgesEnded: 1, failed: ['prog-a: database is locked'] });
    expect(edgeRow(coord, first).state).toBe('open');
    expect(edgeRow(coord, second).state).toBe('met');
  });
});
