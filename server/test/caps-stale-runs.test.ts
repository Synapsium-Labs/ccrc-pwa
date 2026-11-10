// D-6094 (fleet-capacity W1-3; spec §3.4 "Stale runs never hold capacity", §5.1 W1-3; D-8126): the concurrency cap
// counts a dispatched run only while its worker reads busy (background work, subagents and crons included) or could not
// be read, or the run was dispatched within `STALE_RUN_COUNTED_MS`. A run whose worker is dead, asleep, stopped, archived
// or long idle stops holding a slot, and the slots the predicate frees are handed out no faster than the wake budget's
// rate, in a window of their own. TEMPORARY: W3-4 deletes the predicate, its port and its constant.
//
// The first block is the CHARACTERIZATION: with no `workerReading` port (every dispatched run counts) the answers are
// today's, and they stay the answers when the port is absent.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  capsMeasured, countedRuns, dispatchRun, STALE_RUN_COUNTED_MS, type DispatchOutcome, type DispatchRunDeps, type WorkerReading,
} from '../src/coord/dispatch.js';
import { WAKE_BURST } from '../src/coord/wakeBudget.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterEach(() => { vi.restoreAllMocks(); });

interface Over {
  workerReading?: DispatchRunDeps['workerReading'];
  admitFreedSlot?: DispatchRunDeps['admitFreedSlot'];
}

function fixture(over: Over = {}) {
  const home = mkTmp('ccrc-caps-stale-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const run: Runner = async (_cmd, args) => ({ ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' });
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => 'idle' as const,
    paneLive: async () => false,   // never a live resume: the cap check is the one under test
    ...(over.workerReading === undefined ? {} : { workerReading: over.workerReading }),
    ...(over.admitFreedSlot === undefined ? {} : { admitFreedSlot: over.admitFreedSlot }),
  };
  const seed = (id: string): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };
  /** A dispatched run holding a slot, its worker `session`, dispatched `ageMs` ago. */
  const holder = (program: string, session: string | null, ageMs: number): number => {
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-${program}` }) as { id: number };
    coord.markDispatched(o.id, session ?? 'demo-x', `${program}-ws`, `ws/${program}`, false, Date.now() - ageMs);
    if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: holder did not dispatch');
    if (session === null) coord.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(o.id);
    return o.id;
  };
  /** A planned wave-2 run bound to WORKER (the resume arm): the dispatch under test. */
  const resume = (): number => {
    seed(WORKER);
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 2, claimedBy: 'c' });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(WORKER, o.id);
    return o.id;
  };
  return { coord, deps, holder, resume, home };
}

const capRefused = (out: DispatchOutcome): boolean => !out.ok && out.kind === 'refused' && out.code === 'cap-concurrency';
const reading = (word: WorkerReading, calls?: string[]): NonNullable<DispatchRunDeps['workerReading']> =>
  async (sid) => { calls?.push(sid); return word; };

describe('characterization: with no worker port every dispatched run counts (today)', () => {
  it('today: a 6-day dispatched run counts toward running, whatever its worker', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('old', 'demo-dead', 6 * DAY);
    expect(f.coord.capsUsage().running).toBe(1);
    expect(capsMeasured(f.coord).overConcurrency).toEqual({ limit: 1, running: 1 });
    expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
  });

  it('today: a run whose worker has been idle for 3 h counts', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('idle', 'demo-idle', 3 * HOUR);
    expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
  });

  it('kept: a run dispatched an hour ago counts; so does a row with no session', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 2 });
    f.holder('recent', 'demo-recent', HOUR);
    f.holder('nosession', null, 6 * DAY);
    expect(f.coord.capsUsage().running).toBe(2);
    expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
  });
});

describe('stale runs are not counted (D-6094)', () => {
  const atOneSlot = (over: Over) => {
    const f = fixture({ admitFreedSlot: () => true, ...over });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    return f;
  };

  it('a 6-day dispatched run with a dead worker is not counted', async () => {
    const f = atOneSlot({ workerReading: reading('gone') });
    f.holder('old', 'demo-dead', 6 * DAY);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(0);
    expect(await dispatchRun(f.deps, f.resume(), 'go', undefined)).toMatchObject({ ok: true, resumed: true });
  });

  it('a busy one is counted', async () => {
    const f = atOneSlot({ workerReading: reading('busy') });
    f.holder('old', 'demo-busy', 6 * DAY);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(1);
    expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
  });

  it('an idle, awake worker is counted for its first 2 h and not after', async () => {
    const f = atOneSlot({ workerReading: reading('idle') });
    const id = f.holder('idle', 'demo-idle', STALE_RUN_COUNTED_MS - 1000);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(1);
    f.coord.db.prepare('UPDATE runs SET dispatchedAt = ? WHERE id = ?').run(Date.now() - STALE_RUN_COUNTED_MS - 1000, id);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(0);
  });

  it('a run dispatched within the window is counted whatever its worker reads, and is not even read', async () => {
    const calls: string[] = [];
    const f = atOneSlot({ workerReading: reading('gone', calls) });
    f.holder('fresh', 'demo-fresh', HOUR);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(1);
    expect(calls).toEqual([]);
  });

  it('a hibernated worker\'s run is not counted (a gone reading covers asleep)', async () => {
    const f = atOneSlot({ workerReading: reading('gone') });
    f.holder('asleep', 'demo-asleep', 3 * DAY);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(0);
  });

  it('an unmeasured worker is counted, a reading that throws included', async () => {
    for (const port of [reading('unmeasured'), async (): Promise<WorkerReading> => { throw new Error('tmux unreachable'); }]) {
      const f = atOneSlot({ workerReading: port });
      f.holder('old', 'demo-unknown', 6 * DAY);
      expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(1);
      expect(capRefused(await dispatchRun(f.deps, f.resume(), 'go', undefined))).toBe(true);
    }
  });

  it('a row with no session is counted; a worker is read once however many runs name it', async () => {
    const calls: string[] = [];
    const f = atOneSlot({ workerReading: reading('gone', calls) });
    f.holder('nosession', null, 6 * DAY);
    f.holder('a', 'demo-shared', 6 * DAY);
    f.holder('b', 'demo-shared', 6 * DAY);
    expect(await countedRuns(f.coord, f.deps.workerReading)).toBe(1);
    expect(calls).toEqual(['demo-shared']);
  });

  it('no port counts everything', async () => {
    const f = atOneSlot({});
    f.holder('old', 'demo-dead', 6 * DAY);
    expect(await countedRuns(f.coord, undefined)).toBe(1);
  });

  it('the filtered rows are a subset of capsUsage\'s rows: a planned row and a row with dispatchedAt null are in neither', () => {
    const f = fixture();
    const a = f.holder('a', 'demo-a', 6 * DAY);
    f.coord.openRun({ program: 'planned', title: 'p', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c' });
    const inPlace = f.holder('inplace', 'demo-b', HOUR);
    f.coord.db.prepare('UPDATE runs SET dispatchedAt = NULL WHERE id = ?').run(inPlace);
    const rows = f.coord.activeRunWorkers();
    expect(rows.map((r) => r.runId)).toEqual([a]);
    expect(rows.length).toBe(f.coord.capsUsage().running);
  });

  it('a room check consumes no freed-slot admit: capsMeasured and the caps view, three times, leave the window empty', async () => {
    let asked = 0;
    const f = fixture({ workerReading: reading('gone'), admitFreedSlot: () => { asked++; return true; } });
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('old', 'demo-dead', 6 * DAY);
    for (let i = 0; i < 3; i++) { capsMeasured(f.coord); f.coord.capsUsage(); await countedRuns(f.coord, f.deps.workerReading); }
    expect(asked).toBe(0);
  });

  it('a full freed-slot window refuses with running = the raw count; a missing port refuses the freed slot', async () => {
    const full = fixture({ workerReading: reading('gone'), admitFreedSlot: () => false });
    full.coord.setCaps({ maxConcurrentWorkers: 1 });
    full.holder('old', 'demo-dead', 6 * DAY);
    expect(await dispatchRun(full.deps, full.resume(), 'go', undefined))
      .toMatchObject({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
    const missing = fixture({ workerReading: reading('gone') });
    missing.coord.setCaps({ maxConcurrentWorkers: 1 });
    missing.holder('old', 'demo-dead', 6 * DAY);
    expect(capRefused(await dispatchRun(missing.deps, missing.resume(), 'go', undefined))).toBe(true);
  });

  it('the freed-slot port is asked only for a freed slot: a free slot and a full cap of busy workers never ask', async () => {
    let asked = 0;
    const admit = (): boolean => { asked++; return true; };
    const free = fixture({ workerReading: reading('busy'), admitFreedSlot: admit });
    free.coord.setCaps({ maxConcurrentWorkers: 2 });
    free.holder('a', 'demo-a', 6 * DAY);
    expect(await dispatchRun(free.deps, free.resume(), 'go', undefined)).toMatchObject({ ok: true });
    const full = fixture({ workerReading: reading('busy'), admitFreedSlot: admit });
    full.coord.setCaps({ maxConcurrentWorkers: 1 });
    full.holder('a', 'demo-a', 6 * DAY);
    expect(capRefused(await dispatchRun(full.deps, full.resume(), 'go', undefined))).toBe(true);
    expect(asked).toBe(0);
  });
});

describe('the freed-slot window (FleetWatcher.admitFreedSlot, D-6094)', () => {
  const watcher = (): FleetWatcher => {
    const home = mkTmp('ccrc-freed-slot-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const runner: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
    return quietAtTestEnd(new FleetWatcher(testDeps(home, runner), new Bus(), 10_000));
  };

  it('slots freed by the predicate are handed out no faster than WAKE_BURST a window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitFreedSlot()).toBe(true);
    expect(w.admitFreedSlot()).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000 + 61_000);
    expect(w.admitFreedSlot()).toBe(true);
  });

  it('a freed-slot admit does not delay a mail wake: the shared wake list is untouched', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST + 1; i++) w.admitFreedSlot();
    expect((w as unknown as { wakeRecent: number[] }).wakeRecent).toEqual([]);
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
  });
});
