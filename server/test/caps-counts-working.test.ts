// The concurrency cap's count and refusals, pinned at `dispatchRun` (spec 2026-11-19 "waiting workers sleep and hold no
// slot", Part 3). The first block is the CHARACTERIZATION of today's count, green on `main` before the change: every
// dispatched run in an active state counts, whatever its worker is doing, and a resume is charged like a fresh spawn.
// Rows marked "today:" are the ones Part 3 changes; rows marked "kept:" stay.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  capsMeasured, dispatchRun, sessionReadsLive, workerReadings, type DispatchOutcome, type DispatchRunDeps,
} from '../src/coord/dispatch.js';
import { workerReadingOf, type WorkerFacts } from '../src/coord/dispatchDecide.js';
import { STOP_DONE_PARKED_IDLE_MS } from '../src/stopDone.js';
import type { TurnMarkRead } from '../src/coord/stall.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { WAKE_BURST, WAKE_WINDOW_MS } from '../src/coord/wakeBudget.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';
const HOUR = 60 * 60 * 1000;

interface Over {
  paneLive?: DispatchRunDeps['paneLive'];
  workerFacts?: DispatchRunDeps['workerFacts'];
  admitFreedSlot?: DispatchRunDeps['admitFreedSlot'];
}

function fixture(over: Over = {}) {
  const home = mkTmp('ccrc-caps-working-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return { ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' };
  };
  const probes = { paneLive: 0, verdict: 0 };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => { probes.verdict++; return 'idle' as const; },
    ...(over.paneLive === undefined ? {} : {
      paneLive: async (rec: Parameters<NonNullable<DispatchRunDeps['paneLive']>>[0]) => { probes.paneLive++; return over.paneLive!(rec); },
    }),
    ...(over.workerFacts === undefined ? {} : { workerFacts: over.workerFacts }),
    ...(over.admitFreedSlot === undefined ? {} : { admitFreedSlot: over.admitFreedSlot }),
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
  return { coord, deps, mark, seed, holder, resume, fresh, home, calls, probes };
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

  it('today (kept with no worker port): a run whose worker is asleep counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.seed('demo-asleep');
    f.mark('demo-asleep.hibernated', '1700000000');
    f.holder('asleep', 'demo-asleep', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('today (kept with no worker port): a run whose worker has no registry row counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('gone', 'demo-gone', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

});

const LIVE = async (): Promise<boolean> => true;

describe('a live resume skips the concurrency check (D-6093)', () => {
  it('a live resume at a full cap dispatches, and its liveness is read once', async () => {
    const f = fixture({ paneLive: LIVE });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true, sessionId: WORKER });
    expect(f.probes.paneLive).toBe(1);
  });

  it('the liveness is read only when the cap would refuse', async () => {
    const f = fixture({ paneLive: LIVE });
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
    expect(f.probes.paneLive).toBe(0);
  });

  it('kept: a fresh spawn at a full cap refuses with the same frame, and reads no liveness', async () => {
    const f = fixture({ paneLive: LIVE });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
    expect(f.probes.paneLive).toBe(0);
  });

  it('kept: a hibernated, stopped or archived resume at a full cap refuses', async () => {
    for (const [suffix, body] of [['hibernated', '1700000000'], ['stopped', '1700000000 pane'], ['archived', '1700000000']] as const) {
      const f = fixture({ paneLive: LIVE });
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      f.holder('busy', 'demo-busy');
      const id = f.resume();
      f.mark(`${WORKER}.${suffix}`, body);
      expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined)), suffix).toBe(true);
    }
  });

  it('kept: a resume whose pane is gone refuses', async () => {
    const f = fixture({ paneLive: async () => false });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('busy', 'demo-busy');
    expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
  });

  it('an unmeasurable liveness is charged: a throwing port, a missing port, a session with no registry row', async () => {
    const throwing = fixture({ paneLive: async () => { throw new Error('tmux unreachable'); } });
    const missing = fixture();
    for (const f of [throwing, missing]) {
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      f.holder('busy', 'demo-busy');
      expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
    }
    const unlisted = fixture({ paneLive: LIVE });
    unlisted.coord.setCaps({ maxConcurrentWorkers: 1 });
    unlisted.holder('busy', 'demo-busy');
    const id = unlisted.resume();
    unlisted.coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('demo-not-in-registry', id);
    expect(capRefused(await dispatchRun(unlisted.deps, id, 'go', undefined))).toBe(true);
  });

  it('kept: paused and mail-disabled refuse first, with zero liveness reads', async () => {
    for (const [marker, code] of [[COORDINATOR_PAUSE_MARKER, 'paused'], [MAIL_DISABLED_MARKER, 'mail-disabled']] as const) {
      const f = fixture({ paneLive: LIVE });
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      f.holder('busy', 'demo-busy');
      const id = f.resume();
      f.mark(marker);
      f.calls.length = 0;
      expect(await dispatchRun(f.deps, id, 'go', undefined)).toEqual({ ok: false, kind: 'refused', code });
      expect(f.probes).toEqual({ paneLive: 0, verdict: 0 });
      expect(f.calls).toEqual([]);
    }
  });

  it('sessionReadsLive reads live only for a listed, measured, awake session whose pane is alive', async () => {
    const f = fixture({ paneLive: LIVE });
    f.seed(WORKER);
    expect(await sessionReadsLive(f.deps, WORKER)).toBe(true);
    expect(await sessionReadsLive(f.deps, 'demo-other')).toBe(false);
    expect(await sessionReadsLive(f.deps, '--actor')).toBe(false);
  });
});

// ── D-TBD-cap-counts-working (spec 2026-11-19 Part 3, building on D-6094) ──────────────────────────────────────────

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

describe('workerReadingOf, the one rule for a worker reading (D-TBD-cap-counts-working)', () => {
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

  it('background work or a session cron is busy whatever the quiet; an unmeasured one too', () => {
    for (const over of [{ bg: 1 }, { bg: -1 }, { crons: 1 }, { crons: -1 }, { crons: null }]) {
      expect(workerReadingOf(awake(markQuiet(10 * 60 * MIN, over)), NOW), JSON.stringify(over)).toBe('busy');
    }
    expect(workerReadingOf(awake(markQuiet(10 * 60 * MIN), { rowBusy: true }), NOW)).toBe('busy');
  });

  it('a busy turn is busy; every reading that could not be made is unmeasured', () => {
    expect(workerReadingOf(awake(markQuiet(60 * MIN), { turn: 'busy' }), NOW)).toBe('busy');
    expect(workerReadingOf(awake(markQuiet(60 * MIN), { turn: 'unmeasured' }), NOW)).toBe('unmeasured');
    expect(workerReadingOf(awake(markQuiet(60 * MIN), { rowBusy: null }), NOW)).toBe('unmeasured');
    expect(workerReadingOf(awake({ ok: false, reason: 'absent' }), NOW)).toBe('unmeasured');
    expect(workerReadingOf(awake(markQuiet(60 * MIN, { turnAt: null, stopAt: null, restartAt: null })), NOW)).toBe('unmeasured');
    expect(workerReadingOf({ kind: 'unmeasured' }, NOW)).toBe('unmeasured');
    expect(workerReadingOf({ kind: 'gone' }, NOW)).toBe('gone');
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

describe('a run holds a slot only while its worker works (D-TBD-cap-counts-working)', () => {
  const atOneSlot = (over: Over) => {
    const f = fixture({ admitFreedSlot: () => true, ...over });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    return f;
  };

  it('a worker quiet 29 minutes keeps its slot; quiet 30 minutes it does not', async () => {
    const busy = atOneSlot({ workerFacts: factsPort(quietNow(29 * MIN)) });
    busy.holder('a', 'demo-a');
    expect(capRefused(await dispatchRun(busy.deps, busy.fresh(), 'go', undefined))).toBe(true);
    const waiting = atOneSlot({ workerFacts: factsPort(quietNow(30 * MIN + 1000)) });
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
    const f = atOneSlot({ workerFacts: factsPort({ kind: 'gone' }) });
    f.holder('a', 'demo-a', 3 * HOUR);
    expect(capsMeasured(f.coord, await workerReadings(f.coord, f.deps.workerFacts)))
      .toMatchObject({ overConcurrency: null, freedSlot: { limit: 1, running: 1 }, waiting: 1, usage: { running: 1 } });
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
  });

  it('an unmeasured worker keeps its slot, a port that throws included', async () => {
    for (const port of [factsPort({ kind: 'unmeasured' }), async (): Promise<WorkerFacts> => { throw new Error('tmux unreachable'); }]) {
      const f = atOneSlot({ workerFacts: port });
      f.holder('a', 'demo-a');
      expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
    }
  });

  it('a run with no session keeps its slot, and is never read', async () => {
    const calls: string[] = [];
    const f = atOneSlot({ workerFacts: factsPort({ kind: 'gone' }, calls) });
    f.holder('nosession', null, 6 * 24 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
    expect(calls).toEqual([]);
  });

  it('no worker port: every run keeps its slot', async () => {
    const f = atOneSlot({});
    f.holder('a', 'demo-a');
    expect(await workerReadings(f.coord, undefined)).toEqual(new Map());
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('a fresh spawn at a full cap of working workers refuses with the same frame as today, and a worker is read once', async () => {
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
    const f = fixture({ workerFacts: factsPort({ kind: 'gone' }, calls), admitFreedSlot: () => true });
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    f.holder('a', 'demo-a');
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
    expect(calls).toEqual([]);
  });

  it('a run dispatched after the readings were taken counts (no reading, fail closed)', async () => {
    const f = atOneSlot({ workerFacts: factsPort({ kind: 'gone' }) });
    f.holder('a', 'demo-a');
    const readings = await workerReadings(f.coord, f.deps.workerFacts);
    f.holder('b', 'demo-b');
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    expect(capsMeasured(f.coord, readings)).toMatchObject({ overConcurrency: null, waiting: 1, freedSlot: { limit: 2, running: 2 } });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    expect(capsMeasured(f.coord, readings).overConcurrency).toEqual({ limit: 1, running: 1 });
  });

  it('the counted rows are capsUsage\'s rows: a planned row and a row with dispatchedAt null are in neither', () => {
    const f = fixture();
    const a = f.holder('a', 'demo-a');
    f.coord.openRun({ program: 'planned', title: 'p', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c' });
    const inPlace = f.holder('inplace', 'demo-b');
    f.coord.db.prepare('UPDATE runs SET dispatchedAt = NULL WHERE id = ?').run(inPlace);
    expect(f.coord.activeRunWorkers()).toEqual([{ runId: a, sessionId: 'demo-a' }]);
    expect(f.coord.capsUsage().running).toBe(1);
  });
});

describe('freed slots are paced (D-6094)', () => {
  it('a freed slot is handed out only when the window admits it, refused with running = the raw count otherwise', async () => {
    const full = fixture({ workerFacts: factsPort({ kind: 'gone' }), admitFreedSlot: () => false });
    full.coord.setCaps({ maxConcurrentWorkers: 1 });
    full.holder('a', 'demo-a');
    expect(await dispatchRun(full.deps, full.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
  });

  it('no freed-slot window refuses the freed slot (fail closed)', async () => {
    const f = fixture({ workerFacts: factsPort({ kind: 'gone' }) });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('a', 'demo-a');
    expect(capRefused(await dispatchRun(f.deps, f.fresh(), 'go', undefined))).toBe(true);
  });

  it('the window is asked only for a freed slot, and a room check or a view never asks it', async () => {
    let asked = 0;
    const admit = (): boolean => { asked++; return true; };
    const free = fixture({ workerFacts: factsPort({ kind: 'gone' }), admitFreedSlot: admit });
    free.coord.setCaps({ maxConcurrentWorkers: 2 });
    free.holder('a', 'demo-a');
    expect(await dispatchRun(free.deps, free.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
    const busy = fixture({ workerFacts: factsPort(quietNow(MIN)), admitFreedSlot: admit });
    busy.coord.setCaps({ maxConcurrentWorkers: 1 });
    busy.holder('a', 'demo-a');
    expect(capRefused(await dispatchRun(busy.deps, busy.fresh(), 'go', undefined))).toBe(true);
    const gone = fixture({ workerFacts: factsPort({ kind: 'gone' }), admitFreedSlot: admit });
    gone.coord.setCaps({ maxConcurrentWorkers: 1 });
    gone.holder('a', 'demo-a');
    for (let i = 0; i < 3; i++) capsMeasured(gone.coord, await workerReadings(gone.coord, gone.deps.workerFacts));
    expect(asked).toBe(0);
    expect(await dispatchRun(gone.deps, gone.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
    expect(asked).toBe(1);
  });
});

describe('the freed-slot window (FleetWatcher.admitFreedSlot, D-6094)', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const watcher = (): FleetWatcher => {
    const home = mkTmp('ccrc-freed-slot-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const runner: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
    return new FleetWatcher(testDeps(home, runner), new Bus(), 10_000);
  };

  it('slots freed by the readings are handed out no faster than WAKE_BURST a window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitFreedSlot()).toBe(true);
    expect(w.admitFreedSlot()).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + WAKE_WINDOW_MS + 1000);
    expect(w.admitFreedSlot()).toBe(true);
  });

  it('a freed-slot admit does not delay a mail wake: the shared wake list is untouched', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST + 1; i++) w.admitFreedSlot();
    expect((w as unknown as { wakeRecent: number[] }).wakeRecent).toEqual([]);
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('asked', `lane-a-project-${i}`)).toBe(true);
    expect((w as unknown as { wakeRecent: number[] }).wakeRecent).toHaveLength(WAKE_BURST);
  });
});
