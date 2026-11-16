// Characterization (consolidation, GitHub #1279; D-6615, D-6624, D-6631): the BEATS of the three disk-retention sweeps
// the watcher fires from `tick()`. The sweeps' decisions are pinned by `disk-sweep`, `disk-notice` and `fleet-health`;
// this file pins what those leave open and a move of the sweeps out of `watch.ts` could lose: when each is due, on which
// clock, and that a coord-less server stamps nothing. Green on the old code, and the move changes only where the
// clocks live. D-7895 (GitHub #1391) then made each beat a `LANE_SCHEDULE` row, which moves its clock from the wall
// clock to the watcher's monotonic one (OA-C4 (a), #803): those rows drive `Deps.monotonicMs` and freeze or step the
// wall clock, and each beat has a MUTANT row, its own row with the cadence halved (and, for the stale-archive arm, its
// single flight removed), that the same trace tells apart.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { localIO, type FleetIO, type MeasuredDisk } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import type { Deps } from '../src/server.js';
import { CHILD_RECLAIM_SWEEP_MS, DISK_SWEEP_MS, STALE_ARCHIVE_SWEEP_MS, TMP_SWEEP_CENSUS_MS, laneRow, type LaneRow } from '../src/laneSchedule.js';
import { LaneRunner } from '../src/laneRunner.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.useRealTimers(); });

const deadRunner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
const MINUTE = 60_000;

/** A beat's cadence trace on a `LaneRunner` over `row` alone, on a monotonic clock moved by hand: the passes counted after
 *  the first call, after a call 1 ms short of `cadence`, and after a call at it. The real row answers `[1, 1, 2]`. */
async function cadenceTrace(row: LaneRow, cadence: number): Promise<number[]> {
  let mono = 5_000;
  let passes = 0;
  const runner = new LaneRunner({ wall: () => 0, mono: () => mono }, [row]);
  const counts: number[] = [];
  for (const at of [5_000, 5_000 + cadence - 1, 5_000 + cadence]) {
    mono = at;
    await runner.run(row.name, () => { passes++; });
    counts.push(passes);
  }
  return counts;
}

describe('the disk alarm beat (D-6615, D-7895): the `diskAlarm` row, the monotonic clock, one pass a minute, the first at once', () => {
  function build(): { watcher: FleetWatcher; reads: () => number; setMono: (n: number) => void } {
    let reads = 0;
    let mono = 5_000;
    const io: FleetIO = { ...localIO, statfsMeasured: async (): Promise<MeasuredDisk> => { reads++; return { ok: false, reason: 'unreadable' }; } };
    const watcher = new FleetWatcher({ ...testDeps(), io, monotonicMs: () => mono }, new Bus());
    return { watcher, reads: () => reads, setMono: (n) => { mono = n; } };
  }

  it('measures on the first call, holds a call inside the minute, and measures again at the minute, on the monotonic clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const { watcher, reads, setMono } = build();
    await watcher.sweepDisk();
    expect(reads(), 'the first call measures, though the monotonic reading is below the cadence').toBe(1);
    setMono(5_000 + DISK_SWEEP_MS - 1);
    await watcher.sweepDisk();
    expect(reads(), 'a call 1 ms short of the cadence is held').toBe(1);
    setMono(5_000 + DISK_SWEEP_MS);
    await watcher.sweepDisk();
    expect(reads(), 'the cadence elapsed on the monotonic clock, the wall clock frozen').toBe(2);
  });

  it('a wall clock stepped forward never measures early, and one stepped back never holds the beat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000_000);
    const { watcher, reads, setMono } = build();
    await watcher.sweepDisk();
    vi.setSystemTime(10_000_000 + 10 * DISK_SWEEP_MS);
    await watcher.sweepDisk();
    expect(reads(), 'a wall step forward ran the beat early').toBe(1);
    vi.setSystemTime(10_000_000 - 3_600_000);
    setMono(5_000 + DISK_SWEEP_MS);
    await watcher.sweepDisk();
    expect(reads(), 'a wall step back held the beat past its cadence').toBe(2);
  });

  it('the row is the 60 s, overlapping, catch-free row, and its cadence keeps its value', () => {
    expect(DISK_SWEEP_MS).toBe(60_000);
    expect(laneRow('diskAlarm')).toMatchObject({ cadenceMs: DISK_SWEEP_MS, clock: 'mono', flight: 'none', warnKey: null, derivedFrom: null });
  });

  it('MUTANT: the row with its cadence halved runs a second pass inside the minute, and the trace tells it apart', async () => {
    expect(await cadenceTrace(laneRow('diskAlarm'), DISK_SWEEP_MS)).toEqual([1, 1, 2]);
    expect(await cadenceTrace({ ...laneRow('diskAlarm'), cadenceMs: DISK_SWEEP_MS / 2 }, DISK_SWEEP_MS)).not.toEqual([1, 1, 2]);
  });
});

describe('the tmp sweep census beat (D-6624, D-7895): the `tmpCensus` row, the monotonic clock, one pass in five minutes, the first at once', () => {
  function build(): { watcher: FleetWatcher; reads: () => number; setMono: (n: number) => void } {
    let reads = 0;
    let mono = 5_000;
    const io: FleetIO = { ...localIO, lstatMeasured: async (p) => { if (/tmp-sweep/.test(p)) reads++; return localIO.lstatMeasured(p); } };
    const watcher = new FleetWatcher({ ...testDeps(), io, monotonicMs: () => mono }, new Bus());
    return { watcher, reads: () => reads, setMono: (n) => { mono = n; } };
  }

  it('reads the census on the first call, holds a call inside five minutes, and reads again at five, on the monotonic clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2_000_000);
    const { watcher, reads, setMono } = build();
    await watcher.sweepTmpSweepCensus();
    expect(reads(), 'the first call asks for the census file, though the monotonic reading is below the cadence').toBe(1);
    setMono(5_000 + TMP_SWEEP_CENSUS_MS - 1);
    await watcher.sweepTmpSweepCensus();
    expect(reads(), 'a call 1 ms short of five minutes is held').toBe(1);
    setMono(5_000 + TMP_SWEEP_CENSUS_MS);
    await watcher.sweepTmpSweepCensus();
    expect(reads(), 'the cadence elapsed on the monotonic clock, the wall clock frozen').toBe(2);
  });

  it('a wall clock stepped forward never reads early, and one stepped back never holds the beat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000_000);
    const { watcher, reads, setMono } = build();
    await watcher.sweepTmpSweepCensus();
    vi.setSystemTime(10_000_000 + 10 * TMP_SWEEP_CENSUS_MS);
    await watcher.sweepTmpSweepCensus();
    expect(reads(), 'a wall step forward ran the beat early').toBe(1);
    vi.setSystemTime(10_000_000 - 3_600_000);
    setMono(5_000 + TMP_SWEEP_CENSUS_MS);
    await watcher.sweepTmpSweepCensus();
    expect(reads(), 'a wall step back held the beat past its cadence').toBe(2);
  });

  it('the row is the five-minute, overlapping, catch-free row, and its cadence keeps its value', () => {
    expect(TMP_SWEEP_CENSUS_MS).toBe(5 * 60_000);
    expect(laneRow('tmpCensus')).toMatchObject({ cadenceMs: TMP_SWEEP_CENSUS_MS, clock: 'mono', flight: 'none', warnKey: null, derivedFrom: null });
  });

  it('MUTANT: the row with its cadence halved runs a second pass inside five minutes, and the trace tells it apart', async () => {
    expect(await cadenceTrace(laneRow('tmpCensus'), TMP_SWEEP_CENSUS_MS)).toEqual([1, 1, 2]);
    expect(await cadenceTrace({ ...laneRow('tmpCensus'), cadenceMs: TMP_SWEEP_CENSUS_MS / 2 }, TMP_SWEEP_CENSUS_MS)).not.toEqual([1, 1, 2]);
  });
});

describe('the tmp sweep census beat hands the last good registry listing to the lane (D-6624)', () => {
  const T0 = 1_800_000_000_000;
  const ID = 'project-a-quiet-basin';
  const subject = `tmp-sweep: moved 1 entries (seq 1-1, pass ${T0})`;
  function build(): { watcher: FleetWatcher; coord: CoordStore } {
    const home = mkTmp('ccrc-tmp-beat-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    mkdirSync(cfg.ccrcDir, { recursive: true });
    const row = { seq: 1, id: ID, uuid: 'a'.repeat(36), name: 'entry-1', kind: 'scratch', bytes: 1024, at: T0, shadow: false, quarantine: '/q/a/1.entry-1' };
    writeFileSync(path.join(cfg.ccrcDir, 'tmp-sweep.json'), JSON.stringify({ v: 1, at: T0, pressure: false, arm: 'live', seq: 1, sessions: [], moved: [row] }));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return { watcher: new FleetWatcher({ ...testDeps(home), coord } as Deps, new Bus()), coord };
  }

  it('mails a receipt to a session the listing names, and none while no listing has landed', async () => {
    const held = build();
    await held.watcher.sweepTmpSweepCensus();
    expect(held.coord.hasMailWithSubject('operator', null, ID, subject), 'no listing yet: nothing is mailed').toBe(false);
    const listed = build();
    (listed.watcher as unknown as { registryIds: ReadonlySet<string> }).registryIds = new Set([ID]);
    await listed.watcher.sweepTmpSweepCensus();
    expect(listed.coord.hasMailWithSubject('operator', null, ID, subject)).toBe(true);
  });
});

describe('the orphan-worktree beat (D-6631): the monotonic clock at the child-reclaim cadence, the first at once', () => {
  const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', killed: false, signal: null });
  function build(withCoord: boolean): { watcher: FleetWatcher; passes: () => number; setMono: (n: number) => void } {
    const home = mkTmp('ccrc-orphan-beat-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    mkdirSync(cfg.registryDir, { recursive: true });
    const coord = withCoord ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) : undefined;
    // A pass reads the registry listing once, for its switches, and a census only every six hours: count the listings.
    let passes = 0;
    const io: FleetIO = { ...localIO, readdirMeasured: async (dir) => { if (dir === cfg.registryDir) passes++; return localIO.readdirMeasured(dir); } };
    const runCcd = async (argv: readonly string[]) => {
      if (argv[1] === '--orphans') return ok(JSON.stringify({ mode: 'orphans', truncated: false, rows: [] }));
      return ok('{}');
    };
    let mono = 5_000;
    const full = {
      cfg, runCcd, tmux: new Tmux(deadRunner), io, queue: new KeyedQueue(), coord, monotonicMs: () => mono,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['orphan-v1'], rosterFp: null, build: null },
    } as never as Deps;
    return { watcher: new FleetWatcher(full, new Bus()), passes: () => passes, setMono: (n) => { mono = n; } };
  }

  it('runs on the first call, is held inside the cadence on the monotonic clock, and runs again at it', async () => {
    const { watcher, passes, setMono } = build(true);
    await watcher.sweepOrphanTrees();
    expect(passes()).toBe(1);
    setMono(5_000 + CHILD_RECLAIM_SWEEP_MS - 1);
    await watcher.sweepOrphanTrees();
    expect(passes(), 'held 1 ms short of the cadence').toBe(1);
    setMono(5_000 + CHILD_RECLAIM_SWEEP_MS);
    await watcher.sweepOrphanTrees();
    expect(passes(), 'the cadence elapsed').toBe(2);
  });

  it('a server with no coord store never runs the lane and never spends its slot', async () => {
    const { watcher, passes } = build(false);
    await watcher.sweepOrphanTrees();
    await watcher.sweepOrphanTrees();
    expect(passes()).toBe(0);
    expect(watcher.orphanTreesHealth()).toBeNull();
  });
});

/** A single-flight trace on a `LaneRunner` over `row` alone: a pass is started and held open, a second call comes at the
 *  cadence while it is in flight, and the passes started are counted. The real `skip` row answers 1. */
async function overlapTrace(row: LaneRow): Promise<number> {
  let mono = 5_000;
  let started = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const runner = new LaneRunner({ wall: () => 0, mono: () => mono }, [row]);
  const first = runner.run(row.name, () => { started++; return held; });
  mono = 5_000 + row.cadenceMs;
  const second = runner.run(row.name, () => { started++; });
  release();
  await Promise.all([first, second]);
  return started;
}

describe('the stale-archive beat (D-6643, D-7895): the `staleArchive` row, the monotonic clock, one pass an hour, one at a time, never rejecting', () => {
  // A pass reads `viewers` off the deps once it starts: count the reads. (A pass with no coord ends at once, which is enough.)
  function build(throwOnPass = false): { watcher: FleetWatcher; passes: () => number; setMono: (n: number) => void } {
    let passes = 0;
    let mono = 5_000;
    const deps = { ...testDeps(), monotonicMs: () => mono } as Deps;
    Object.defineProperty(deps, 'viewers', { get: () => { passes++; if (throwOnPass) throw new Error('boom'); return undefined; } });
    return { watcher: new FleetWatcher(deps, new Bus()), passes: () => passes, setMono: (n) => { mono = n; } };
  }

  it('runs on the first call, holds a call 1 ms short of the cadence, and runs again at it, on the monotonic clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(3_000_000);
    const { watcher, passes, setMono } = build();
    await watcher.sweepStaleArchive([], []);
    expect(passes(), 'the first call runs, though the monotonic reading is below the cadence').toBe(1);
    setMono(5_000 + STALE_ARCHIVE_SWEEP_MS - 1);
    await watcher.sweepStaleArchive([], []);
    expect(passes(), 'held 1 ms short of the cadence').toBe(1);
    setMono(5_000 + STALE_ARCHIVE_SWEEP_MS);
    await watcher.sweepStaleArchive([], []);
    expect(passes(), 'the cadence elapsed on the monotonic clock, the wall clock frozen').toBe(2);
  });

  it('a wall clock stepped forward never runs it early, and one stepped back never holds it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000_000);
    const { watcher, passes, setMono } = build();
    await watcher.sweepStaleArchive([], []);
    vi.setSystemTime(10_000_000 + 10 * STALE_ARCHIVE_SWEEP_MS);
    await watcher.sweepStaleArchive([], []);
    expect(passes(), 'a wall step forward ran the arm early').toBe(1);
    vi.setSystemTime(10_000_000 - 3_600_000);
    setMono(5_000 + STALE_ARCHIVE_SWEEP_MS);
    await watcher.sweepStaleArchive([], []);
    expect(passes(), 'a wall step back held the arm past its cadence').toBe(2);
  });

  it('skips a call while a pass is still in flight, even one past the cadence, and spends no slot on it', async () => {
    const { watcher, passes, setMono } = build();
    const first = watcher.sweepStaleArchive([], []);
    setMono(5_000 + STALE_ARCHIVE_SWEEP_MS);
    const second = watcher.sweepStaleArchive([], []);
    await Promise.all([first, second]);
    expect(passes(), 'the second call met a pass in flight').toBe(1);
    await watcher.sweepStaleArchive([], []);
    expect(passes(), 'the flight cleared, and the refused call did not restart the cadence').toBe(2);
  });

  it('a throwing pass is caught, never rejects, and frees the flight', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { watcher, passes, setMono } = build(true);
      await expect(watcher.sweepStaleArchive([], [])).resolves.toBeUndefined();
      expect(warn.mock.calls.some((c) => /sweepStaleArchive failed \(boom\)/.test(String(c[0]))), 'the throw is warned').toBe(true);
      setMono(5_000 + STALE_ARCHIVE_SWEEP_MS);
      await watcher.sweepStaleArchive([], []);
      expect(passes(), 'the flight was released by the throw').toBe(2);
    } finally { warn.mockRestore(); }
  });

  it('the row is the hourly skip row with no stuck-run age and no warnKey, and its cadence keeps its value', () => {
    expect(STALE_ARCHIVE_SWEEP_MS).toBe(60 * 60_000);
    expect(laneRow('staleArchive')).toMatchObject({ cadenceMs: STALE_ARCHIVE_SWEEP_MS, clock: 'mono', flight: 'skip', warnKey: null, derivedFrom: null });
    expect(laneRow('staleArchive').staleAfterMs, 'a pass in flight is never abandoned, as before').toBeUndefined();
  });

  it('MUTANT: the row with its cadence halved runs a second pass inside the hour, and the trace tells it apart', async () => {
    expect(await cadenceTrace(laneRow('staleArchive'), STALE_ARCHIVE_SWEEP_MS)).toEqual([1, 1, 2]);
    expect(await cadenceTrace({ ...laneRow('staleArchive'), cadenceMs: STALE_ARCHIVE_SWEEP_MS / 2 }, STALE_ARCHIVE_SWEEP_MS)).not.toEqual([1, 1, 2]);
  });

  it('MUTANT: the row with its single flight removed overlaps a pass in flight, and the trace tells it apart', async () => {
    expect(await overlapTrace(laneRow('staleArchive'))).toBe(1);
    expect(await overlapTrace({ ...laneRow('staleArchive'), flight: 'none' })).toBe(2);
  });
});
