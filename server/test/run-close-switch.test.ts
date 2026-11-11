// D-8077 (spec 2026-11-04 §12.3, A15, o7, o12; the runs rebuild, Task 26): arming the run-close lanes from the UI. The store's
// three-state row, the lane's would-close reading, the view the Advanced rows read, and `GET`/`POST /api/coord/run-close`. The lane
// runs over a real store with scripted fakes, so nothing reaches a box.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseOutcome } from '../src/coord/close.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import { createRunCloseMemory, runClosePass, type RunCloseLaneDeps } from '../src/coord/runCloseLane.js';
import { closedByGroup, runCloseViewOf, DISPATCH_ABANDON_CLOSE_DETAIL } from '../src/coord/runCloseSwitch.js';
import { deadCoordinatorLaneArmed, deadCoordinatorLaneOff } from '../src/coord/endDeadCoordinator.js';
import type { ClaimantVerdict } from '../src/coord/reclaim.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import type { GateDecision } from '../src/auth/gate.js';
import { COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { DEAD_COORDINATOR_LANE_LIVE_MARKER, RUNS_EXPIRE_NEVER_STARTED_MARKER, SWITCHES } from '../../shared/switches.js';
import { runCloseChoiceOf } from '../../shared/run-close.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
  removeTmpFixtures();
});

const H = 3_600_000;
const T0 = 1_800_000_000_000;
const ALIVE: ClaimantVerdict = { state: 'alive', why: 'live' };
const DEAD: ClaimantVerdict = { state: 'dead', cause: 'orphan', why: 'gone' };

const rig = async (o: { names?: string[] | null; verdicts?: Record<string, ClaimantVerdict>; choice?: 'off' | 'shadow' | 'on' } = {}) => {
  const home = mkTmp('ccrc-runclose-switch-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const base = testDeps(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const verdicts = createRunVerdicts();
  if (o.choice !== undefined) coord.setRunCloseChoice('never-started', o.choice, T0);
  const state = { clock: T0, names: o.names === undefined ? [] : o.names, verdicts: { 'coord-a': ALIVE, ...(o.verdicts ?? {}) } as Record<string, ClaimantVerdict> };
  const deps = (): RunCloseLaneDeps => ({
    coord, verdicts, memory: createRunCloseMemory(), notifyLog, now: () => state.clock,
    registryNames: async () => state.names,
    measure: async (id) => state.verdicts[id] ?? DEAD,
    claimantBusyAt: () => null, abandonRefusal: () => null,
    branchFacts: async () => ({ readAt: state.clock, openPr: false, unpushed: false }),
    childMark: async () => ({ kind: 'none' }),
    serial: async (c, fn) => fn((runId, claimedBy, stillStuck, extra): Promise<CloseOutcome> =>
      closeRun({ coord: c, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy, stillStuck, ...extra })),
  });
  const pass = () => runClosePass(deps());
  const open = (program: string, wave: number, over: { kind?: 'review'; reviews?: number; claimedBy?: string } = {}): number => {
    const r = coord.openRun({ program, title: `T ${wave}`, project: 'demo', wave, waveOf: null, claimedBy: over.claimedBy ?? 'coord-a',
      ...(over.kind === undefined ? {} : { kind: over.kind, reviews: over.reviews ?? null }) });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T0 - 100 * H, r.id);
    return r.id;
  };
  const seed = (laneRow: string, key: string, firstAgo: number): void =>
    coord.setRunCloseAnchor(laneRow, key, { firstAt: T0 - firstAgo, lastAt: T0 - 60_000 });
  return { coord, state, verdicts, pass, open, seed, home, base, notifyLog };
};

describe('the store: three states per group, default shadow', () => {
  it('a fresh database reads shadow for both groups, and only an exact on or off is anything else', async () => {
    const r = await rig();
    expect(r.coord.runCloseSetting()).toEqual({ kind: 'row', neverStarted: 'shadow', claimantCrashed: 'shadow', claimantGone: 'shadow', updatedAt: 0 });
    expect(r.coord.runCloseChoice('never-started')).toBe('shadow');
    expect(r.coord.runCloseChoice('claimant-gone')).toBe('shadow');
    r.coord.setRunCloseChoice('never-started', 'on', 5);
    r.coord.setRunCloseChoice('claimant-crashed', 'off', 6);
    expect(r.coord.runCloseChoice('never-started')).toBe('on');
    expect(r.coord.runCloseChoice('claimant-crashed')).toBe('off');
    for (const raw of ['ON', 'live', '', null, 1, undefined]) expect(runCloseChoiceOf(raw)).toBe('shadow');
    r.coord.db.prepare("UPDATE run_close_settings SET neverStarted = 'armed-by-a-newer-build'").run();
    expect(r.coord.runCloseChoice('never-started')).toBe('shadow');
  });

  it('migration 54 adds the claimant-gone group to a database at version 53 as shadow and keeps the other two choices (D-8078)', () => {
    const file = path.join(mkTmp('ccrc-runclose-migrate-'), 'coord.db');
    const fresh = openCoordDb(file);
    fresh.prepare("UPDATE run_close_settings SET neverStarted = 'on', claimantCrashed = 'off', updatedAt = 9").run();
    // Back to version 53: undo migrations 56 (lane_arm_settings, D-8274) and 55 (coordinator_calls, D-8126) as well as 54, so
    // the reopen replays all three.
    fresh.exec('DROP TABLE lane_arm_settings; DROP TABLE coordinator_calls; ALTER TABLE run_close_settings DROP COLUMN claimantGone; PRAGMA user_version = 53;');
    fresh.close();
    const coord = new CoordStore(openCoordDb(file));
    expect(coord.runCloseSetting()).toEqual({ kind: 'row', neverStarted: 'on', claimantCrashed: 'off', claimantGone: 'shadow', updatedAt: 9 });
    coord.setRunCloseChoice('claimant-gone', 'on', 10);
    expect(coord.runCloseChoice('claimant-gone')).toBe('on');
    expect(coord.runCloseChoice('never-started')).toBe('on');
    expect(coord.runCloseChoice('claimant-crashed')).toBe('off');
  });

  it('SWITCHES carries a row per group, written by the one route', () => {
    for (const k of ['run-close-never-started-choice', 'run-close-claimant-crashed-choice', 'run-close-claimant-gone-choice'] as const) {
      expect(SWITCHES[k]).toMatchObject({ default: 'shadow', writer: 'POST /api/coord/run-close' });
    }
  });
});

describe('the lane: off, shadow and on', () => {
  it('shadow reads and counts down, and the row set on arms it without any marker', async () => {
    const r = await rig();
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    const shadow = await r.pass();
    expect(shadow.warned).toEqual([]);
    expect(r.verdicts.reading()?.groups['never-started']?.would.map((w) => w.program)).toEqual(['programme-a']);
    r.coord.setRunCloseChoice('never-started', 'on', T0);
    const armed = await r.pass();
    expect(armed.warned).toEqual(['programme-a']);   // armed by the row: the warning goes first
  });

  it('off reads nothing, records nothing, keeps no clock and acts on nothing', async () => {
    const r = await rig({ choice: 'off' });
    r.coord.setRunCloseChoice('claimant-gone', 'off', T0);   // each group is off on its own: with both off the pass reads nothing at all
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    const out = await r.pass();
    expect(out).toMatchObject({ held: 'off', warned: [], closed: [] });
    expect(r.verdicts.reading()).toEqual({ at: T0, groups: {} });
    expect(r.coord.runCloseAnchors('never-started').size).toBe(0);
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM feed_events').get()).toEqual({ n: 0 });
  });

  it('one group off leaves the other running: never-started off still reads the claimant-gone group, and the reverse', async () => {
    const r = await rig({ choice: 'off' });
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    await r.pass();
    expect(r.coord.runCloseAnchors('never-started').size).toBe(0);
    expect(r.verdicts.reading()?.groups['never-started']).toBeUndefined();
    expect(r.verdicts.reading()?.groups['claimant-gone']).toEqual({ would: [], named: [] });
    r.coord.setRunCloseChoice('claimant-gone', 'off', T0);
    r.coord.setRunCloseChoice('never-started', 'shadow', T0);
    await r.pass();
    expect(r.verdicts.reading()?.groups['claimant-gone']).toBeUndefined();
    expect(r.verdicts.reading()?.groups['never-started']).toBeDefined();
  });

  it('a marker remains an emergency override: it arms an off group, and the act-time guard honours it', async () => {
    const r = await rig({ choice: 'off', names: [RUNS_EXPIRE_NEVER_STARTED_MARKER] });
    r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);
    const out = await r.pass();
    expect(out.held).toBeNull();
    expect(out.warned).toEqual(['programme-a']);
  });

  it('the crash row gets the same control: on arms it, off stops it, the marker overrides both', () => {
    expect(deadCoordinatorLaneArmed([], 'shadow')).toBe(false);
    expect(deadCoordinatorLaneArmed([], 'on')).toBe(true);
    expect(deadCoordinatorLaneArmed([DEAD_COORDINATOR_LANE_LIVE_MARKER], 'off')).toBe(true);
    expect(deadCoordinatorLaneOff([], 'off')).toBe(true);
    expect(deadCoordinatorLaneOff([DEAD_COORDINATOR_LANE_LIVE_MARKER], 'off')).toBe(false);
    expect(deadCoordinatorLaneOff([], 'shadow')).toBe(false);
  });
});

describe('the would-close reading', () => {
  it('lists every run that would close with its reason and time, and counts those closing now and those closing later', async () => {
    const r = await rig();
    const a = r.open('programme-a', 1);
    r.seed('never-started', 'programme-a', 80 * H);                    // 80 h quiet and never warned: arming warns first
    const b = r.open('programme-b', 1);
    r.seed('never-started', 'programme-b', 60 * H);                    // 60 h quiet and never warned: the same
    const work = r.open('programme-c', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = 5 WHERE id = ?").run(work);
    const review = r.open('programme-c', 1, { kind: 'review', reviews: work });
    r.coord.setRunCloseAnchor('review-orphaned', String(review), { firstAt: T0 - 2 * H, lastAt: T0 - 60_000 });
    await r.pass();
    const g = r.verdicts.reading()!.groups['never-started']!;
    expect(g.would.map((w) => [w.runId, w.why]).sort()).toEqual([[a, 'never-started'], [b, 'never-started'], [review, 'review-of-closed']].sort());
    expect(g.named).toEqual([]);
    const view = runCloseViewOf({
      names: [], choices: { 'never-started': 'shadow', 'claimant-crashed': 'shadow', 'claimant-gone': 'shadow' }, updatedAt: 0, reading: r.verdicts.reading(),
      closed7d: { 'never-started': 0, 'claimant-crashed': 0, 'claimant-gone': 0 }, refused7d: { 'never-started': 0, 'claimant-crashed': 0, 'claimant-gone': 0 }, nowMs: T0,
    });
    const list = view.groups.find((x) => x.group === 'never-started')!.list!;
    expect(list.would).toHaveLength(3);
    expect(list.now).toBe(1);       // the review: its hour is spent
    expect(list.later).toBe(2);     // programme-a and programme-b: arming sends their warning, and 24 h must pass
  });

  it('a run the row fits but the lane holds, such as one with a live session, is named under the list and not in it', async () => {
    const r = await rig({ verdicts: { 's-live': ALIVE } });
    const work = r.open('programme-a', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = 5 WHERE id = ?").run(work);
    const review = r.open('programme-a', 1, { kind: 'review', reviews: work });
    r.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('s-live', review);
    r.coord.setRunCloseAnchor('review-orphaned', String(review), { firstAt: T0 - 2 * H, lastAt: T0 - 60_000 });
    await r.pass();
    const g = r.verdicts.reading()!.groups['never-started']!;
    expect(g.would).toEqual([]);
    expect(g.named).toEqual([{ runId: review, program: 'programme-a', why: 'live-session' }]);
  });

  it('a run whose E1 warning cannot be delivered, under a coordinator that is gone, is named and not counted', async () => {
    const r = await rig({ verdicts: { 'coord-gone': DEAD } });
    const id = r.open('programme-a', 1, { claimedBy: 'coord-gone' });
    r.seed('never-started', 'programme-a', 80 * H);
    await r.pass();
    const g = r.verdicts.reading()!.groups['never-started']!;
    expect(g.would).toEqual([]);
    expect(g.named).toEqual([{ runId: id, program: 'programme-a', why: 'coordinator-not-reached' }]);
    // The run keeps its hours in shadow (o2): the closes map is the board's, the list is the sheet's.
    expect(r.verdicts.reading()!.at).toBe(T0);
  });
});

describe('the view', () => {
  const base = {
    choices: { 'never-started': 'shadow', 'claimant-crashed': 'shadow', 'claimant-gone': 'shadow' } as const, updatedAt: 0, reading: null,
    closed7d: { 'never-started': 0, 'claimant-crashed': 0, 'claimant-gone': 0 }, refused7d: { 'never-started': 0, 'claimant-crashed': 0, 'claimant-gone': 0 }, nowMs: T0,
  };
  const reading = { at: T0, groups: { 'never-started': { would: [{ runId: 1, program: 'p', why: 'never-started' as const, at: T0 - 1 }], named: [] } } };

  it('three states per group: off, shadow, on, with the list only when the group is read and not off', () => {
    const states = (c: 'off' | 'shadow' | 'on') => runCloseViewOf({ ...base, names: [], choices: { 'never-started': c, 'claimant-crashed': c, 'claimant-gone': c }, reading })
      .groups.map((g) => [g.group, g.state, g.list === null]);
    expect(states('shadow')).toEqual([['never-started', 'shadow', false], ['claimant-crashed', 'shadow', true], ['claimant-gone', 'shadow', true]]);
    expect(states('on')).toEqual([['never-started', 'on', false], ['claimant-crashed', 'on', true], ['claimant-gone', 'on', true]]);
    expect(states('off')).toEqual([['never-started', 'off', true], ['claimant-crashed', 'off', true], ['claimant-gone', 'off', true]]);
  });

  it('the crash row lists what the dead-coordinator lane read, beside the never-started group, and the run-close lane never clears it', () => {
    const v = createRunVerdicts();
    v.setCrashReading({ would: [{ runId: 9, program: 'q', why: 'claimant-crashed', at: T0 + 5 }], named: [] }, T0);
    expect(v.reading()?.groups['claimant-crashed']?.would).toHaveLength(1);
    v.setReading(reading);
    v.setReading({ at: T0, groups: {} });
    const view = runCloseViewOf({ ...base, names: [], reading: v.reading() });
    expect(view.groups[1]!.list).toMatchObject({ now: 0, later: 1, would: [{ runId: 9, program: 'q' }] });
    v.setCrashReading(null, 0);
    expect(v.reading()?.groups['claimant-crashed']).toBeUndefined();
  });

  it('while coordination is paused every row reads held with no list; so do a reclaim pause and an unreadable registry', () => {
    for (const names of [[COORDINATOR_PAUSE_MARKER], [RECLAIM_PAUSE_MARKER], null]) {
      const v = runCloseViewOf({ ...base, names, reading });
      expect(v.groups.map((g) => [g.state, g.list])).toEqual([['held', null], ['held', null], ['held', null]]);
    }
  });

  it('a standing marker shows on whatever the row says, naming the override', () => {
    const v = runCloseViewOf({ ...base, names: [RUNS_EXPIRE_NEVER_STARTED_MARKER], choices: { 'never-started': 'off', 'claimant-crashed': 'shadow', 'claimant-gone': 'shadow' }, reading });
    expect(v.groups[0]).toMatchObject({ state: 'on', choice: 'off', marker: 'set' });
    expect(v.groups[1]).toMatchObject({ state: 'shadow', marker: 'clear' });
  });

  it('closes and refusals of the last 7 days show per group', async () => {
    const r = await rig();
    const id = r.open('programme-a', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ?, closedBy = 'sweep', closeDetail = 'expired:never-started quiet-since=1' WHERE id = ?").run(T0 - H, id);
    const other = r.open('programme-b', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ?, closedBy = 'sweep', closeDetail = NULL WHERE id = ?").run(T0 - H, other);
    expect(closedByGroup(r.coord.sweepClosesBetween(T0 - 7 * 24 * H, T0 + 1))).toEqual({ 'never-started': 1, 'claimant-crashed': 1, 'claimant-gone': 0 });
    // A dispatch-abandon close is its own switch's: it counts under neither group.
    const dead = r.open('programme-c', 1);
    r.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ?, closedBy = 'sweep', closeDetail = ? WHERE id = ?").run(T0 - H, DISPATCH_ABANDON_CLOSE_DETAIL, dead);
    expect(closedByGroup(r.coord.sweepClosesBetween(T0 - 7 * 24 * H, T0 + 1))).toEqual({ 'never-started': 1, 'claimant-crashed': 1, 'claimant-gone': 0 });
    // The claimant-gone rows name themselves in their close detail, and each row counts under the group that holds it (D-8078).
    for (const row of ['claimant-gone', 'claimant-stopped', 'name-reused']) {
      const gone = r.open(`programme-${row}`, 1);
      r.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ?, closedBy = 'sweep', closeDetail = ? WHERE id = ?").run(T0 - H, `expired:${row}`, gone);
    }
    expect(closedByGroup(r.coord.sweepClosesBetween(T0 - 7 * 24 * H, T0 + 1))).toEqual({ 'never-started': 1, 'claimant-crashed': 1, 'claimant-gone': 3 });
    r.coord.recordRunCloseRefusal('never-started', id, 'claimant-changed', T0 - H);
    r.coord.recordRunCloseRefusal('never-started', id, 'claimant-changed', T0 - 30 * 60_000);   // the same refusal again: one row
    r.coord.recordRunCloseRefusal('claimant-crashed', other, 'x', T0 - 9 * 24 * H);               // older than 7 days
    expect(r.coord.runCloseRefusalCounts(T0 - 7 * 24 * H)).toEqual({ 'never-started': 1, 'claimant-crashed': 0, 'claimant-gone': 0 });
  });
});

describe('GET and POST /api/coord/run-close', () => {
  const setup = async (names: string[] = []) => {
    const r = await rig();
    const deps: Deps = { ...r.base, notifyLog: r.notifyLog, coord: r.coord, io: { ...r.base.io, readdirMeasured: async () => ({ ok: true as const, entries: names }) } } as Deps;
    const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
    const app = Fastify();
    registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
    apps.push(app);
    return { app, ...r };
  };
  const post = (app: FastifyInstance, payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/coord/run-close', payload: payload as Record<string, unknown> });

  it('a fresh database answers shadow for both groups', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/coord/run-close' });
    expect(res.statusCode).toBe(200);
    expect(res.json().groups.map((g: { group: string; state: string }) => [g.group, g.state])).toEqual([['never-started', 'shadow'], ['claimant-crashed', 'shadow'], ['claimant-gone', 'shadow']]);
  });

  it('POST stores each choice for its group, answers the view, and records a change in the feed once', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { group: 'never-started', choice: 'on' })).json().groups[0]).toMatchObject({ state: 'on', choice: 'on' });
    expect(coord.runCloseChoice('never-started')).toBe('on');
    expect(coord.runCloseChoice('claimant-crashed')).toBe('shadow');
    expect((await post(app, { group: 'never-started', choice: 'on' })).statusCode).toBe(200);
    expect((await post(app, { group: 'never-started', choice: 'shadow' })).json().groups[0]).toMatchObject({ state: 'shadow' });
    expect((await post(app, { group: 'claimant-crashed', choice: 'off' })).json().groups[1]).toMatchObject({ state: 'off' });
    const rows = coord.feedEvents(50).filter((e) => e.title === 'run close changed').map((e) => e.body);
    expect(rows).toEqual([
      'the never-started run-close group: shadow -> on; by flag-off',
      'the never-started run-close group: on -> shadow; by flag-off',
      'the claimant-crashed run-close group: shadow -> off; by flag-off',
    ]);
  });

  it('refuses any other body with bad-request and writes nothing', async () => {
    const { app, coord } = await setup();
    for (const body of [{}, { group: 'never-started' }, { choice: 'on' }, { group: 'nope', choice: 'on' }, { group: 'never-started', choice: 'live' },
      { group: 'never-started', choice: 'on', extra: 1 }, ['on']]) {
      const res = await post(app, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(coord.runCloseSetting()).toMatchObject({ neverStarted: 'shadow', claimantCrashed: 'shadow', claimantGone: 'shadow', updatedAt: 0 });
  });

  it('while coordination is paused POST refuses to arm, and off and shadow still go through', async () => {
    for (const marker of [COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER]) {
      const { app, coord } = await setup([marker]);
      const res = await post(app, { group: 'never-started', choice: 'on' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, error: 'coordination-paused' });
      expect(coord.runCloseChoice('never-started')).toBe('shadow');
      expect((await post(app, { group: 'never-started', choice: 'off' })).statusCode).toBe(200);
      expect((await post(app, { group: 'never-started', choice: 'shadow' })).statusCode).toBe(200);
      const view = (await app.inject({ method: 'GET', url: '/api/coord/run-close' })).json();
      expect(view.groups.map((g: { state: string; list: unknown }) => [g.state, g.list])).toEqual([['held', null], ['held', null], ['held', null]]);
    }
  });

  it('a registry that will not list refuses to arm', async () => {
    const r = await rig();
    const deps: Deps = { ...r.base, notifyLog: r.notifyLog, coord: r.coord, io: { ...r.base.io, readdirMeasured: async () => ({ ok: false as const, reason: 'unreadable' }) } } as Deps;
    const app = Fastify();
    registerCoordRoutes(app, deps, new Bus(), () => ({ allow: true, verdict: 'ok', reason: 'session', device: null }), { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
    apps.push(app);
    const res = await post(app, { group: 'never-started', choice: 'on' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'registry-unread' });
  });
});
