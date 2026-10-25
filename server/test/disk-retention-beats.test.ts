// Characterization (consolidation, GitHub #1279; D-6615, D-6624, D-6631): the BEATS of the three disk-retention sweeps
// the watcher fires from `tick()`. The sweeps' decisions are pinned by `disk-sweep`, `disk-notice` and `fleet-health`;
// this file pins what those leave open and a move of the sweeps out of `watch.ts` could lose: when each is due, on which
// clock, and that a coord-less server stamps nothing. Green on the old code, and the move changes only where the
// clocks live.
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
import { CHILD_RECLAIM_SWEEP_MS } from '../src/laneSchedule.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.useRealTimers(); });

const deadRunner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
const MINUTE = 60_000;

describe('the disk alarm beat (D-6615): the wall clock, one pass a minute, the first at once', () => {
  it('measures on the first call, holds a call inside the minute, and measures again at the minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    let reads = 0;
    const io: FleetIO = { ...localIO, statfsMeasured: async (): Promise<MeasuredDisk> => { reads++; return { ok: false, reason: 'unreadable' }; } };
    const watcher = new FleetWatcher({ ...testDeps(), io }, new Bus());
    await watcher.sweepDisk();
    expect(reads).toBe(1);
    vi.setSystemTime(1_000_000 + MINUTE - 1);
    await watcher.sweepDisk();
    expect(reads, 'a call 1 ms short of the cadence is held').toBe(1);
    vi.setSystemTime(1_000_000 + MINUTE);
    await watcher.sweepDisk();
    expect(reads, 'the cadence elapsed').toBe(2);
  });
});

describe('the tmp sweep census beat (D-6624): the wall clock, one pass in five minutes, the first at once', () => {
  it('reads the census on the first call, holds a call inside five minutes, and reads again at five', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2_000_000);
    let reads = 0;
    const io: FleetIO = { ...localIO, lstatMeasured: async (p) => { if (/tmp-sweep/.test(p)) reads++; return localIO.lstatMeasured(p); } };
    const watcher = new FleetWatcher({ ...testDeps(), io }, new Bus());
    await watcher.sweepTmpSweepCensus();
    const first = reads;
    expect(first, 'the first call asks for the census file').toBe(1);
    vi.setSystemTime(2_000_000 + 5 * MINUTE - 1);
    await watcher.sweepTmpSweepCensus();
    expect(reads, 'a call 1 ms short of five minutes is held').toBe(first);
    vi.setSystemTime(2_000_000 + 5 * MINUTE);
    await watcher.sweepTmpSweepCensus();
    expect(reads, 'the cadence elapsed').toBe(2);
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
