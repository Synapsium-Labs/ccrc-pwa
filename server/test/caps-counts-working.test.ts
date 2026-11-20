// The concurrency cap's count and refusals, pinned at `dispatchRun` (spec 2026-11-19 "waiting workers sleep and hold no
// slot", Part 3). The first block is the CHARACTERIZATION of today's count, green on `main` before the change: every
// dispatched run in an active state counts, whatever its worker is doing, and a resume is charged like a fresh spawn.
// Rows marked "today:" are the ones Part 3 changes once its row is armed; rows marked "kept:" stay. The blocks after it
// are D-8792 and D-8793: the cap reads each counted run's worker, reports the waiting ones in shadow and live, and leaves
// them out only while the operator has armed the `cap-counts-working` Shadow lanes row.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  WORKER_READINGS_DEADLINE_MS, capCountsWorkingArmed, capsMeasured, dispatchRun, sendBackCapCheck, workerReadings,
  type DispatchOutcome, type DispatchRunDeps,
} from '../src/coord/dispatch.js';
import {
  capRefusalOf, capShadowLine, capShadowResumeLine, capsReadingOf, freedSlotPending, resumeSkipsCap, sendBackCapPlan,
  sendBackCharged, workerReadingOf, type SendBackCapFacts, type WorkerFacts, type WorkerReading,
} from '../src/coord/dispatchDecide.js';
import { ADVANCE_TARGETS, advanceGate } from '../src/coord/advance.js';
import { RUN_STATES, type RunState } from '../../shared/api.js';
import { CAP_COUNTS_WORKING_LANE, LANE_ARM_TEXT, laneArmGate } from '../../shared/lane-arm.js';
import { STOP_DONE_PARKED_IDLE_MS } from '../src/stopDone.js';
import type { TurnMarkRead } from '../src/coord/stall.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';
import { WAKE_BURST, WAKE_WINDOW_MS } from '../src/coord/wakeBudget.js';
import { FleetWatcher } from '../src/watch.js';
import { quietAtTestEnd } from './laneQuiet.js';   // D-8140: nothing a watcher fires outlives its test
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';
const HOUR = 60 * 60 * 1000;

/** One migrated database, copied per fixture: a fresh open replays every migration, which on a loaded box costs seconds a
 *  case. The copies are closed after each case. */
let template = '';
const opened: CoordStore[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-caps-working-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } } });

interface Over {
  workerFacts?: DispatchRunDeps['workerFacts'];
  admitFreedSlot?: DispatchRunDeps['admitFreedSlot'];
  /** Arm the `cap-counts-working` row (D-8792). Default: shadow, as the merge leaves it. */
  armed?: boolean;
}

function fixture(over: Over = {}) {
  const home = mkTmp('ccrc-caps-working-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const run: Runner = async (_cmd, args) =>
    ({ ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' });
  const base = testDeps(home, run);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  opened.push(coord);
  /** The shadow records the doors deferred (review 2875 F1): held here, so a case sees the refusal return before any of
   *  them runs, then runs them with `settle()`. */
  const deferred: (() => Promise<void>)[] = [];
  const settle = async (): Promise<void> => { for (const work of deferred.splice(0)) await work(); };
  const deps: DispatchRunDeps = {
    deferShadowRecord: (work) => { deferred.push(work); },
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    ...(over.workerFacts === undefined ? {} : { workerFacts: over.workerFacts }),
    ...(over.admitFreedSlot === undefined ? {} : { admitFreedSlot: over.admitFreedSlot }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => 'idle' as const,
  };
  const mark = (name: string, body = ''): void => writeFileSync(path.join(reg, name), body);
  const seed = (id: string): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) mark(`${id}.${k}`, v);
  };
  /** A dispatched run holding a slot, its worker `session` (null: a row with no session), dispatched `ageMs` ago. */
  const holder = (program: string, session: string | null, ageMs = HOUR): number => {
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-${program}` }) as { id: number };
    coord.markDispatched(o.id, session ?? 'demo-x', `${program}-ws`, `ws/${program}`, false, Date.now() - ageMs);
    if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: holder did not dispatch');
    if (session === null) coord.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(o.id);
    return o.id;
  };
  /** A planned wave-2 run bound to WORKER (the resume arm). */
  const resume = (): number => {
    seed(WORKER);
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 2, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(WORKER, o.id);
    return o.id;
  };
  /** A planned wave-1 run: a fresh spawn. */
  const fresh = (): number =>
    (coord.openRun({ program: 'fresh', title: 'f', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c-fresh' }) as { id: number }).id;
  if (over.armed === true) coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'live', 1);
  /** A run of WORKER parked at `state` (an idle state), for the send-back door. */
  const parked = (state: RunState): number => {
    seed(WORKER);
    const o = coord.openRun({ program: `sb-${state}`, title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c-sb' }) as { id: number };
    coord.markDispatched(o.id, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, Date.now() - HOUR);
    coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, o.id);
    return o.id;
  };
  return { coord, deps, mark, seed, holder, resume, fresh, parked, home, deferred, settle };
}

const capRefused = (out: DispatchOutcome): boolean => !out.ok && out.kind === 'refused' && out.code === 'cap-concurrency';

describe('characterization: the cap counts every dispatched run in an active state (today)', () => {
  it('kept: a fresh spawn at a full cap refuses with the numbers', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(capsMeasured(f.coord).overConcurrency).toEqual({ limit: 1, running: 1 });
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
  });

  it('kept: a row with no session counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('nosession', null, 6 * 24 * HOUR);
    expect(f.coord.capsUsage().running).toBe(1);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('kept: a free slot dispatches', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    f.holder('busy', 'demo-busy');
    expect(capsMeasured(f.coord).overConcurrency).toBeNull();
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
  });

  it('today: a run whose worker is asleep counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.seed('demo-asleep');
    f.mark('demo-asleep.hibernated', '1700000000');
    f.holder('asleep', 'demo-asleep', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('today: a run whose worker has no registry row counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('gone', 'demo-gone', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('today: a resume of a worker whose pane is live is charged like a fresh spawn', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
  });
});

// ── D-8792 (spec 2026-11-19 Part 3, amending D-6094): the reading, the rules, and the two doors ──────────────────────

const MIN = 60_000;
const NOW = 1_800_000_000_000;
/** A turn marker whose newest stamp is `quietMs` before NOW, with nothing running. */
const markQuiet = (quietMs: number, over: Partial<Extract<TurnMarkRead, { ok: true }>> = {}): TurnMarkRead => ({
  ok: true, sessionId: 'u', state: 'done', event: 'Stop', at: NOW - quietMs, turnAt: NOW - quietMs - MIN, stopAt: NOW - quietMs,
  bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: 0, graceUntil: null,
  ...over,
});
const awake = (mark: TurnMarkRead, over: Partial<Extract<WorkerFacts, { kind: 'awake' }>> = {}): WorkerFacts =>
  ({ kind: 'awake', turn: 'idle', rowBusy: false, mark, ...over });
const ASLEEP: WorkerFacts = { kind: 'gone', why: 'asleep' };
const STOPPED: WorkerFacts = { kind: 'gone', why: 'stopped' };

describe('workerReadingOf, the one rule for a worker reading (D-8792)', () => {
  it('quiet 29 minutes is busy (between turns); quiet 30 minutes is waiting', () => {
    expect(STOP_DONE_PARKED_IDLE_MS).toBe(30 * MIN);
    expect(workerReadingOf(awake(markQuiet(29 * MIN)), NOW)).toBe('busy');
    expect(workerReadingOf(awake(markQuiet(STOP_DONE_PARKED_IDLE_MS - 1)), NOW)).toBe('busy');
    expect(workerReadingOf(awake(markQuiet(30 * MIN)), NOW)).toBe('waiting');
    expect(workerReadingOf(awake(markQuiet(49 * 60 * MIN)), NOW)).toBe('waiting');
  });

  it('the quiet runs from the newest of turnAt, stopAt and restartAt', () => {
    expect(workerReadingOf(awake(markQuiet(2 * 60 * MIN, { restartAt: NOW - 5 * MIN })), NOW)).toBe('busy');
    expect(workerReadingOf(awake(markQuiet(2 * 60 * MIN, { turnAt: NOW - 5 * MIN })), NOW)).toBe('busy');
  });

  it('marker background work, a session cron, row background work or subagents keep it busy whatever the quiet', () => {
    for (const over of [{ bg: 1 }, { bg: -1 }, { crons: 1 }, { crons: -1 }, { crons: null }]) {
      expect(workerReadingOf(awake(markQuiet(10 * 60 * MIN, over)), NOW), JSON.stringify(over)).toBe('busy');
    }
    expect(workerReadingOf(awake(markQuiet(10 * 60 * MIN), { rowBusy: true }), NOW)).toBe('busy');
  });

  it('a marker with no stamps is unmeasured (it counts), however quiet the rest reads', () => {
    expect(workerReadingOf(awake(markQuiet(60 * MIN, { turnAt: null, stopAt: null, restartAt: null })), NOW)).toBe('unmeasured');
  });

  it('every reading that cannot be made is unmeasured: the turn, the row, the marker, the worker', () => {
    expect(workerReadingOf(awake(markQuiet(60 * MIN), { turn: 'busy' }), NOW)).toBe('busy');
    expect(workerReadingOf(awake(markQuiet(60 * MIN), { turn: 'unmeasured' }), NOW)).toBe('unmeasured');
    expect(workerReadingOf(awake(markQuiet(60 * MIN), { rowBusy: null }), NOW)).toBe('unmeasured');
    expect(workerReadingOf(awake({ ok: false, reason: 'absent' }), NOW)).toBe('unmeasured');
    expect(workerReadingOf({ kind: 'unmeasured' }, NOW)).toBe('unmeasured');
  });

  it('a worker asleep, stopped, archived, with no row or no pane is gone', () => {
    for (const why of ['absent', 'stopped', 'archived', 'asleep', 'no-pane'] as const) {
      expect(workerReadingOf({ kind: 'gone', why }, NOW), why).toBe('gone');
    }
  });
});

describe('resumeSkipsCap and the send-back edge (D-6093, D-8792)', () => {
  it('a dispatch resume is free only for an awake worker; a send-back also for a sleeping one', () => {
    expect(resumeSkipsCap(awake(markQuiet(MIN)), 'dispatch')).toBe(true);
    expect(resumeSkipsCap(awake(markQuiet(MIN)), 'advance')).toBe(true);
    expect(resumeSkipsCap(ASLEEP, 'advance')).toBe(true);
    expect(resumeSkipsCap(ASLEEP, 'dispatch')).toBe(false);
    for (const f of [STOPPED, { kind: 'gone', why: 'archived' }, { kind: 'gone', why: 'absent' }, { kind: 'gone', why: 'no-pane' },
      { kind: 'unmeasured' }] as WorkerFacts[]) {
      expect(resumeSkipsCap(f, 'dispatch'), JSON.stringify(f)).toBe(false);
      expect(resumeSkipsCap(f, 'advance'), JSON.stringify(f)).toBe(false);
    }
  });

  it('sendBackCharged is the advance gate\'s own cap edge: every edge the gate asks the cap on is charged', () => {
    for (const to of ADVANCE_TARGETS) {
      for (const from of RUN_STATES) {
        let asked = false;
        advanceGate({ to, read: () => ({ ok: true, run: { kind: 'work', state: from, sessionId: 'w' } }),
          reviewInFlight: () => null, overConcurrency: () => { asked = true; return null; } });
        if (asked) expect(sendBackCharged(to, from), `${from} -> ${to}`).toBe(true);
      }
    }
    for (const from of ['awaiting-review', 'merging'] as const) {
      let asked = false;
      advanceGate({ to: 'working', read: () => ({ ok: true, run: { kind: 'work', state: from, sessionId: 'w' } }),
        reviewInFlight: () => null, overConcurrency: () => { asked = true; return null; } });
      expect(asked, from).toBe(true);
      expect(sendBackCharged('working', from), from).toBe(true);
    }
    // `closing -> working` is no legal edge (`RUN_TRANSITIONS`): the gate refuses it before it asks the cap, so a
    // send-back from `closing` is never refused AT the cap, armed or not (capacity Task 3 notes, closing-not-a-send-back).
    let asked = false;
    const closing = advanceGate({ to: 'working', read: () => ({ ok: true, run: { kind: 'work', state: 'closing', sessionId: 'w' } }),
      reviewInFlight: () => null, overConcurrency: () => { asked = true; return { limit: 1, running: 1 }; } });
    expect(closing.ok).toBe(false);
    expect(JSON.stringify(closing)).not.toContain('cap-concurrency');
    expect(asked).toBe(false);
    expect(sendBackCharged('working', 'dispatched')).toBe(false);
  });
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ runId: i + 1, sessionId: `w-${i + 1}` }));
const readingsOf = (...r: WorkerReading[]) => new Map(r.map((w, i) => [i + 1, w] as const));

describe('capsReadingOf: shadow reports, only armed leaves runs out (D-8792)', () => {
  const caps = { maxConcurrentWorkers: 2 };
  it('with no readings it is today\'s count, with no waiting', () => {
    expect(capsReadingOf(caps, rows(2), null, false)).toEqual({ caps, usage: { running: 2 }, overConcurrency: { limit: 2, running: 2 } });
    expect(capsReadingOf(caps, rows(2), null, true)).toEqual({ caps, usage: { running: 2 }, overConcurrency: { limit: 2, running: 2 } });
  });

  it('shadow: the waiting runs are reported and still counted; the refusal is today\'s', () => {
    const r = capsReadingOf(caps, rows(2), readingsOf('waiting', 'gone'), false);
    expect(r.usage).toEqual({ running: 2, waiting: 2, workingOnly: false });
    expect(r.overConcurrency).toEqual({ limit: 2, running: 2 });
    expect(r.freedSlot).toBeNull();
    expect(r.shadowFreed).toEqual({ limit: 2, running: 2 });
    expect(freedSlotPending(r)).toBe(false);
    expect(capRefusalOf(r, true)).toEqual({ limit: 2, running: 2 });
  });

  it('armed: waiting and gone are left out; busy, unmeasured and a run with no reading count', () => {
    const out = capsReadingOf(caps, rows(2), readingsOf('waiting', 'gone'), true);
    expect(out).toMatchObject({ usage: { running: 2, waiting: 2, workingOnly: true }, overConcurrency: null, freedSlot: { limit: 2, running: 2 } });
    for (const kept of ['busy', 'unmeasured'] as const) {
      const r = capsReadingOf(caps, rows(2), readingsOf('waiting', kept), true);
      expect(r.usage.waiting, kept).toBe(1);
      expect(r.overConcurrency, kept).toBeNull();
    }
    expect(capsReadingOf(caps, rows(3), readingsOf('waiting', 'gone'), true).overConcurrency).toBeNull();
    expect(capsReadingOf(caps, rows(3), readingsOf('busy', 'unmeasured'), true).overConcurrency).toEqual({ limit: 2, running: 3 });
  });

  it('a freed slot is pending as data, and goes on only on the window\'s yes (review 2875 F3: no write from L1)', () => {
    const freed = capsReadingOf(caps, rows(2), readingsOf('gone', 'busy'), true);
    expect(freedSlotPending(freed)).toBe(true);
    expect(capRefusalOf(freed, true)).toBeNull();
    expect(capRefusalOf(freed, false)).toEqual({ limit: 2, running: 2 });
    // Room under the cap, and a full cap of working workers: nothing is pending, so the window is never asked.
    const room = capsReadingOf(caps, rows(1), readingsOf('gone'), true);
    expect(freedSlotPending(room)).toBe(false);
    expect(capRefusalOf(room, false)).toBeNull();
    const full = capsReadingOf(caps, rows(2), readingsOf('busy', 'busy'), true);
    expect(freedSlotPending(full)).toBe(false);
    expect(capRefusalOf(full, true)).toEqual({ limit: 2, running: 2 });
  });

  it('sendBackCapPlan (review 2875 F3): today unless armed, wired, full and on the charged edge; then free or recount', () => {
    const base: SendBackCapFacts = { armed: true, port: true, capFull: true, to: 'working', from: 'awaiting-review', worker: null };
    expect(sendBackCapPlan(base)).toBe('recount');
    for (const off of [{ armed: false }, { port: false }, { capFull: false }, { from: null }, { to: 'merging' as const },
      { from: 'dispatched' as const }]) {
      expect(sendBackCapPlan({ ...base, ...off }), JSON.stringify(off)).toBe('today');
    }
    expect(sendBackCapPlan({ ...base, worker: ASLEEP })).toBe('free');
    expect(sendBackCapPlan({ ...base, worker: LIVE_PANE })).toBe('free');
    for (const worker of [STOPPED, { kind: 'unmeasured' } as WorkerFacts, { kind: 'gone', why: 'no-pane' } as WorkerFacts]) {
      expect(sendBackCapPlan({ ...base, worker }), JSON.stringify(worker)).toBe('recount');
    }
    for (const from of RUN_STATES) {
      expect(sendBackCapPlan({ ...base, from, worker: ASLEEP }) === 'today', from).toBe(!sendBackCharged('working', from));
    }
  });

  it('the shadow line names the start, the numbers and each run left out, and only for a refusal arming would lift', () => {
    const r = readingsOf('waiting', 'gone', 'busy');
    const shadow = capsReadingOf({ maxConcurrentWorkers: 3 }, rows(3), r, false);
    expect(capShadowLine(shadow, 'dispatch of run 9', rows(3), r))
      .toBe('ccrc-server: cap-counts-working shadow: dispatch of run 9 refused at 3/3; armed, 2 left out would free a slot (run 1 waiting, run 2 gone)');
    const none = readingsOf('busy', 'busy', 'unmeasured');
    expect(capShadowLine(capsReadingOf({ maxConcurrentWorkers: 3 }, rows(3), none, false), 'x', rows(3), none)).toBeNull();
    expect(capShadowLine(capsReadingOf({ maxConcurrentWorkers: 3 }, rows(3), r, true), 'x', rows(3), r)).toBeNull();
  });
});

/** A port that answers `facts` for every session, recording who was read. */
const factsPort = (facts: WorkerFacts | ((sid: string) => WorkerFacts), calls?: string[]): NonNullable<DispatchRunDeps['workerFacts']> =>
  async (sid) => { calls?.push(sid); return typeof facts === 'function' ? facts(sid) : facts; };
/** Facts quiet for `quietMs` as of the real clock (the doors read `Date.now()`). */
const quietNow = (quietMs: number, over: Partial<Extract<TurnMarkRead, { ok: true }>> = {}): WorkerFacts => {
  const t = Date.now() - quietMs;
  return awake(markQuiet(0, { at: t, turnAt: t - MIN, stopAt: t, ...over }));
};
const LIVE_PANE = awake(markQuiet(0, { at: Date.now(), turnAt: Date.now(), stopAt: null }), { turn: 'busy' });

describe('the switch: the cap-counts-working row (D-8792)', () => {
  it('reads armed only on an exact live; a missing row and shadow are not armed', () => {
    const f = fixture();
    expect(capCountsWorkingArmed(f.coord)).toBe(false);
    f.coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'shadow', 1);
    expect(capCountsWorkingArmed(f.coord)).toBe(false);
    f.coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'live', 2);
    expect(capCountsWorkingArmed(f.coord)).toBe(true);
    f.coord.db.prepare("UPDATE lane_arm_settings SET choice = 'armed?' WHERE lane = ?").run(CAP_COUNTS_WORKING_LANE);
    expect(capCountsWorkingArmed(f.coord)).toBe(false);
  });

  it('the merge seeds it shadow, it carries no gate, and its card words name the shadow record\'s journal prefix', () => {
    const f = fixture();
    expect(f.coord.laneArmSetting(CAP_COUNTS_WORKING_LANE)).toMatchObject({ kind: 'row', choice: 'shadow' });
    expect(laneArmGate(CAP_COUNTS_WORKING_LANE)).toBeNull();
    expect(LANE_ARM_TEXT.rows[CAP_COUNTS_WORKING_LANE].shadowNote).toContain('"ccrc-server: cap-counts-working shadow:"');
  });
});

describe('the dispatch door in shadow: today\'s count and refusals, and a record of what arming would do (D-8792)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a run whose worker is gone still counts, and the refusal is recorded with each run arming would leave out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: string[] = [];
    let asked = 0;
    const f = fixture({ workerFacts: factsPort(ASLEEP, calls), admitFreedSlot: () => { asked++; return true; } });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    const a = f.holder('a', 'demo-a');
    const id = f.fresh();
    expect(await dispatchRun(f.deps, id, 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
    // Review 2875 F1: the refusal came back with no worker read on its path; the record follows it.
    expect(calls).toEqual([]);
    expect(f.deferred).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('cap-counts-working'))).toEqual([]);
    await f.settle();
    expect(calls).toEqual(['demo-a']);
    expect(asked).toBe(0);
    expect(warn.mock.calls.map((c) => c[0])).toContain(
      `ccrc-server: cap-counts-working shadow: dispatch of run ${id} refused at 1/1; armed, 1 left out would free a slot (run ${a} gone)`);
  });

  it('review 2875 F1: a worker port that never answers does not hold the shadow refusal', async () => {
    const never = (): Promise<WorkerFacts> => new Promise<WorkerFacts>(() => undefined);
    const f = fixture({ workerFacts: never });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('a', 'demo-a');
    const t0 = Date.now();
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(WORKER_READINGS_DEADLINE_MS);
  });

  it('with no deferral port the record runs on its own, after the refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture({ workerFacts: factsPort(ASLEEP) });
    const { deferShadowRecord: _held, ...deps } = f.deps;
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('a', 'demo-a');
    expect(capRefused(await dispatchRun(deps, f.fresh(), 'go', undefined))).toBe(true);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('cap-counts-working'))).toEqual([]);
    await vi.waitFor(() => expect(warn.mock.calls.filter((c) => String(c[0]).includes('cap-counts-working'))).toHaveLength(1));
  });

  it('a resume of a live worker is charged as today', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? LIVE_PANE : quietNow(MIN))) });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
  });

  it('a refusal arming would not lift writes no line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture({ workerFacts: factsPort(quietNow(MIN)) });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('a', 'demo-a');
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
    await f.settle();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('cap-counts-working'))).toEqual([]);
  });

  it('setting the row back to shadow restores today\'s count', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture({ workerFacts: factsPort(ASLEEP), admitFreedSlot: () => true, armed: true });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('a', 'demo-a');
    f.coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'shadow', 3);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });
});

describe('the dispatch door armed: a run holds a slot only while its worker works (D-8792)', () => {
  const atOneSlot = (over: Over) => {
    const f = fixture({ admitFreedSlot: () => true, armed: true, ...over });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    return f;
  };

  it('a worker quiet 29 minutes keeps its slot; quiet 30 minutes it does not', async () => {
    const busy = atOneSlot({ workerFacts: factsPort(quietNow(29 * MIN)) });
    busy.holder('a', 'demo-a');
    expect(capRefused(await dispatchRun(busy.deps, busy.fresh(), 'go', undefined))).toBe(true);
    // The resumed worker itself reads asleep, so its resume is charged and the count is what decides.
    const waiting = atOneSlot({ workerFacts: factsPort((sid) => (sid === WORKER ? ASLEEP : quietNow(30 * MIN + 1000))) });
    waiting.holder('a', 'demo-a');
    expect(await dispatchRun(waiting.deps, waiting.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
  });

  it('background work or a session cron keeps the slot whatever the quiet', async () => {
    for (const over of [{ bg: 1 }, { crons: 1 }]) {
      const f = atOneSlot({ workerFacts: factsPort(quietNow(10 * 60 * MIN, over)) });
      f.holder('a', 'demo-a');
      expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined)), JSON.stringify(over)).toBe(true);
    }
  });

  it('an asleep, stopped, dead or archived worker (gone) does not hold a slot', async () => {
    const f = atOneSlot({ workerFacts: factsPort(ASLEEP) });
    f.holder('a', 'demo-a', 3 * HOUR);
    expect(capsMeasured(f.coord, await workerReadings(f.coord, f.deps.workerFacts), true))
      .toMatchObject({ overConcurrency: null, freedSlot: { limit: 1, running: 1 }, usage: { running: 1, waiting: 1, workingOnly: true } });
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
  });

  it('an unmeasured worker keeps its slot, a port that throws included', async () => {
    for (const port of [factsPort({ kind: 'unmeasured' }), async (): Promise<WorkerFacts> => { throw new Error('tmux unreachable'); }]) {
      const f = atOneSlot({ workerFacts: port });
      f.holder('a', 'demo-a');
      expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
    }
  });

  it('review 2875 F1: a read past the deadline is unmeasured and keeps its slot; the reads that answered still count', async () => {
    const f = fixture();
    f.holder('a', 'demo-fast');
    f.holder('b', 'demo-slow');
    const port = async (sid: string): Promise<WorkerFacts> => (sid === 'demo-fast' ? ASLEEP : new Promise<WorkerFacts>(() => undefined));
    const t0 = Date.now();
    const readings = await workerReadings(f.coord, port, Date.now(), 50);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect([...(readings ?? new Map()).values()].sort()).toEqual(['gone', 'unmeasured']);
    // A port that throws synchronously reads unmeasured too.
    expect([...((await workerReadings(f.coord, () => { throw new Error('no link'); }, Date.now(), 50)) ?? new Map()).values()])
      .toEqual(['unmeasured', 'unmeasured']);
  });

  it('review 2875 F1: armed, a worker port that never answers is cut at the deadline, and the run keeps its slot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const calls: string[] = [];
      const f = atOneSlot({ workerFacts: (sid: string): Promise<WorkerFacts> => { calls.push(sid); return new Promise<WorkerFacts>(() => undefined); } });
      f.holder('a', 'demo-a');
      const out = dispatchRun(f.deps, f.resume(), 'go', undefined);
      let settled = false;
      void out.then(() => { settled = true; });
      // The real reads before it (the registry listing) finish on real time; setImmediate is not faked.
      for (let i = 0; i < 2000 && calls.length === 0; i++) await new Promise<void>((r) => { setImmediate(r); });
      expect(calls).toEqual([WORKER]);
      await vi.advanceTimersByTimeAsync(WORKER_READINGS_DEADLINE_MS - 100);
      expect(settled).toBe(false);
      // The resume's own read is cut, then the count's: two deadlines, and the run keeps its slot.
      await vi.advanceTimersByTimeAsync(2 * WORKER_READINGS_DEADLINE_MS);
      expect(calls).toEqual([WORKER, 'demo-a']);
      expect(capRefused(await out)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('a run with no session keeps its slot, and is never read', async () => {
    const calls: string[] = [];
    const f = atOneSlot({ workerFacts: factsPort(ASLEEP, calls) });
    f.holder('nosession', null, 6 * 24 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
    expect(calls).toEqual([]);
  });

  it('no worker port: every run keeps its slot', async () => {
    const f = atOneSlot({});
    f.holder('a', 'demo-a');
    expect(await workerReadings(f.coord, undefined)).toBeNull();
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('a fresh spawn at a full cap of working workers refuses with today\'s frame, and a worker is read once', async () => {
    const calls: string[] = [];
    const f = atOneSlot({ workerFacts: factsPort(quietNow(MIN), calls) });
    f.holder('a', 'demo-shared');
    f.holder('b', 'demo-shared');
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 2, running: 2 });
    expect(calls).toEqual(['demo-shared']);
  });

  it('the workers are read only when the raw count is at the limit', async () => {
    const calls: string[] = [];
    const f = fixture({ workerFacts: factsPort(ASLEEP, calls), admitFreedSlot: () => true, armed: true });
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    f.holder('a', 'demo-a');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
    expect(calls).toEqual([]);
  });

  it('a live resume at a full cap of working workers dispatches (D-6093), and reads only its own worker', async () => {
    const calls: string[] = [];
    const f = atOneSlot({ workerFacts: factsPort((sid) => (sid === WORKER ? LIVE_PANE : quietNow(MIN)), calls) });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true, sessionId: WORKER });
    expect(calls).toEqual([WORKER]);
  });

  it('a resume of a sleeping, stopped or unreadable worker is charged', async () => {
    for (const mine of [ASLEEP, STOPPED, { kind: 'unmeasured' } as WorkerFacts]) {
      const f = atOneSlot({ workerFacts: factsPort((sid) => (sid === WORKER ? mine : quietNow(MIN))) });
      f.holder('busy', 'demo-busy');
      expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined)), JSON.stringify(mine)).toBe(true);
    }
  });

  it('kept: paused and mail-disabled refuse first, with zero worker reads', async () => {
    for (const [marker, code] of [[COORDINATOR_PAUSE_MARKER, 'paused'], [MAIL_DISABLED_MARKER, 'mail-disabled']] as const) {
      const calls: string[] = [];
      const f = atOneSlot({ workerFacts: factsPort(LIVE_PANE, calls) });
      f.holder('busy', 'demo-busy');
      const id = f.resume();
      f.mark(marker);
      expect(await dispatchRun(f.deps, id, 'go', undefined)).toEqual({ ok: false, kind: 'refused', code });
      expect(calls).toEqual([]);
    }
  });

  it('a run dispatched after the readings were taken counts (no reading, fail closed)', async () => {
    const f = atOneSlot({ workerFacts: factsPort(ASLEEP) });
    f.holder('a', 'demo-a');
    const readings = await workerReadings(f.coord, f.deps.workerFacts);
    f.holder('b', 'demo-b');
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    expect(capsMeasured(f.coord, readings, true)).toMatchObject({ overConcurrency: null, usage: { waiting: 1 }, freedSlot: { limit: 2, running: 2 } });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    expect(capsMeasured(f.coord, readings, true).overConcurrency).toEqual({ limit: 1, running: 1 });
  });

  it('the counted rows are capsUsage\'s rows: a planned row and a row with dispatchedAt null are in neither', () => {
    const f = fixture();
    const a = f.holder('a', 'demo-a');
    f.coord.openRun({ program: 'planned', title: 'p', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c' });
    const inPlace = f.holder('inplace', 'demo-b');
    f.coord.db.prepare('UPDATE runs SET dispatchedAt = NULL WHERE id = ?').run(inPlace);
    expect(f.coord.capsCountedRuns()).toEqual([{ runId: a, sessionId: 'demo-a' }]);
    expect(f.coord.capsUsage().running).toBe(1);
  });
});

describe('the send-back door: a send-back to a sleeper is a resume only when armed (D-8792)', () => {
  // The three source states the spec names; `closing -> working` is no legal edge, so the gate never asks the cap there
  // (pinned above), and this reader's answer for it is never read.
  const SOURCES = ['awaiting-review', 'merging', 'closing'] as const;
  const sleeperPort = factsPort((sid) => (sid === WORKER ? ASLEEP : quietNow(MIN)));

  for (const from of SOURCES) {
    it(`shadow: a send-back to a sleeping worker at a full cap is refused as today (from ${from})`, async () => {
      const f = fixture({ workerFacts: sleeperPort, admitFreedSlot: () => true });
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      f.holder('busy', 'demo-busy');
      expect((await sendBackCapCheck(f.coord, f.deps, f.parked(from), 'working'))()).toEqual({ limit: 1, running: 1 });
    });

    for (const mine of [ASLEEP, LIVE_PANE]) {
      it(`armed: a send-back to a${mine.kind === 'gone' ? ' sleeping' : ' live'} worker at a full cap is never refused, with no slot freed (from ${from})`, async () => {
        const f = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? mine : quietNow(MIN))), armed: true });
        f.coord.setCaps({ maxConcurrentWorkers: 1 });
        f.holder('busy', 'demo-busy');
        const id = f.parked(from);
        expect(capsMeasured(f.coord, await workerReadings(f.coord, f.deps.workerFacts), true).overConcurrency).not.toBeNull();
        expect((await sendBackCapCheck(f.coord, f.deps, id, 'working'))()).toBeNull();
      });
    }
  }

  it('armed: a send-back to a stopped or unreadable worker is charged, and passes only on a freed, admitted slot', async () => {
    for (const mine of [STOPPED, { kind: 'unmeasured' } as WorkerFacts]) {
      const f = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? mine : quietNow(MIN))), armed: true, admitFreedSlot: () => true });
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      f.holder('busy', 'demo-busy');
      expect((await sendBackCapCheck(f.coord, f.deps, f.parked('awaiting-review'), 'working'))()).toEqual({ limit: 1, running: 1 });
    }
    let asked = 0;
    const g = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? STOPPED : ASLEEP)), armed: true,
      admitFreedSlot: () => { asked++; return true; } });
    g.coord.setCaps({ maxConcurrentWorkers: 1 });
    g.holder('a', 'demo-a');
    const check = await sendBackCapCheck(g.coord, g.deps, g.parked('merging'), 'working');
    expect(asked).toBe(0);
    expect(check()).toBeNull();
    expect(asked).toBe(1);
  });

  it('review 2875 F7, shadow: a send-back arming would admit as a resume is recorded after the refusal, naming the worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [mine, word] of [[ASLEEP, 'asleep'], [LIVE_PANE, 'awake']] as const) {
      warn.mockClear();
      const calls: string[] = [];
      const f = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? mine : quietNow(MIN)), calls) });
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      f.holder('busy', 'demo-busy');
      const id = f.parked('awaiting-review');
      const check = await sendBackCapCheck(f.coord, f.deps, id, 'working');
      expect(calls).toEqual([]);
      expect(check()).toEqual({ limit: 1, running: 1 });
      expect(calls).toEqual([]);
      await f.settle();
      expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('cap-counts-working')), word).toEqual([
        `ccrc-server: cap-counts-working shadow: send-back of run ${id} refused at 1/1; armed, a send-back to a worker ${word} is a resume and is not charged`]);
    }
    expect(capShadowResumeLine('send-back of run 3', { limit: 2, running: 4 }, { kind: 'unmeasured' }))
      .toBe('ccrc-server: cap-counts-working shadow: send-back of run 3 refused at 4/2; armed, a send-back to a worker unmeasured is a resume and is not charged');
    warn.mockRestore();
  });

  it('review 2875 F7, shadow: a charged send-back is recorded only when arming would free a slot; an uncharged edge, never', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? STOPPED : ASLEEP)) });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    const a = f.holder('a', 'demo-a');
    const id = f.parked('merging');
    expect((await sendBackCapCheck(f.coord, f.deps, id, 'working'))()).toEqual({ limit: 1, running: 1 });
    await f.settle();
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('cap-counts-working'))).toEqual([
      `ccrc-server: cap-counts-working shadow: send-back of run ${id} refused at 1/1; armed, 1 left out would free a slot (run ${a} gone)`]);
    warn.mockClear();
    const g = fixture({ workerFacts: factsPort((sid) => (sid === WORKER ? STOPPED : quietNow(MIN))) });
    g.coord.setCaps({ maxConcurrentWorkers: 1 });
    g.holder('busy', 'demo-busy');
    expect((await sendBackCapCheck(g.coord, g.deps, g.parked('merging'), 'working'))()).toEqual({ limit: 1, running: 1 });
    expect((await sendBackCapCheck(g.coord, g.deps, g.parked('awaiting-review'), 'merging'))()).toEqual({ limit: 1, running: 1 });
    await g.settle();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('cap-counts-working'))).toEqual([]);
    expect(g.deferred).toEqual([]);
    warn.mockRestore();
  });

  it('no worker is read on any other edge, at a free cap, or with no port', async () => {
    const calls: string[] = [];
    const f = fixture({ workerFacts: factsPort(ASLEEP, calls), armed: true });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    const held = f.holder('busy', 'demo-busy');
    expect((await sendBackCapCheck(f.coord, f.deps, held, 'working'))()).toEqual({ limit: 1, running: 1 });
    expect((await sendBackCapCheck(f.coord, f.deps, f.parked('awaiting-review'), 'merging'))()).toEqual({ limit: 1, running: 1 });
    f.coord.setCaps({ maxConcurrentWorkers: 5 });
    expect((await sendBackCapCheck(f.coord, f.deps, f.parked('closing'), 'working'))()).toBeNull();
    expect(calls).toEqual([]);
    const none = fixture({ armed: true });
    none.coord.setCaps({ maxConcurrentWorkers: 1 });
    none.holder('busy', 'demo-busy');
    expect((await sendBackCapCheck(none.coord, none.deps, none.parked('closing'), 'working'))()).toEqual({ limit: 1, running: 1 });
  });
});

describe('the freed-slot window and the mail wake (D-8792 pacing, D-8793)', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const watcher = (): FleetWatcher => {
    const home = mkTmp('ccrc-freed-slot-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const runner: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
    return quietAtTestEnd(new FleetWatcher(testDeps(home, runner), new Bus(), 10_000));
  };

  it('slots freed by the readings are handed out no faster than WAKE_BURST a window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitFreedSlot()).toBe(true);
    expect(w.admitFreedSlot()).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + WAKE_WINDOW_MS + 1000);
    expect(w.admitFreedSlot()).toBe(true);
  });

  it('a freed-slot admit never delays a mail wake: the shared wake list is untouched, and the wake reads no cap', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST + 1; i++) w.admitFreedSlot();
    expect((w as unknown as { wakeRecent: number[] }).wakeRecent).toEqual([]);
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('asked', `lane-a-project-${i}`)).toBe(true);
    expect((w as unknown as { wakeRecent: number[] }).wakeRecent).toHaveLength(WAKE_BURST);
  });
});
