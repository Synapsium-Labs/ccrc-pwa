// Delegation broker wave 3, Task 13: the watcher's delegation SIBLING LANE (spec §5.5, §5.12; plan Task 13 steps 1, 2, 5; W3-M68 and the
// lane's own guards). At the existing 60-second census cadence, never awaited by `tick()`, the lane reads each owner's hourly spool
// buckets, ingests them durably (Task 9 into Task 8), correlates the census against the retained evidence (Task 11), plans report-only
// effects (Task 12), applies the durable ones, repairs the SQLite projection (Task 7) and keeps the seven-day observation intervals
// that `delegation-health.test.ts` aggregates. Wave 3 is observation only: the lane writes no carrier, starts no cleanup clock, mints
// no token and takes no filesystem action; its only durable writes go through `DelegationDurability`.
//
// Every directory here is a FIXTURE home: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`, and no ccd verb runs.
//
//   M5/M6 (single flight)                   -> 'single flight' rows
//   hand-off 2 (no-op skip)                 -> 'the no-op skip' rows
//   hand-off 4 (cursors move only by ingestion) -> 'cursors' rows
//   R24 (boot refuses an active restore marker) -> 'boot refusal' rows
import { afterEach, describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { FleetWatcher, DELEGATION_PASS_BUDGET_MS, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { coordinationRestoreRefusal, openCoordDb } from '../src/coord/db.js';
import { buildServer } from '../src/server.js';
import * as policy from '../src/coord/delegation-policy.js';
import * as correlation from '../src/coord/delegation-correlation.js';
import { readWorktreeCensus, type DelegationCensusPass, type ParentIncarnation, type WorktreeCensus } from '../src/coord/gitref.js';
import {
  COORDINATION_RESTORE_MARKER_FILE,
  DELEGATION_CHECKPOINT_FILE,
  DelegationDurability,
  decodeDelegationCheckpoint,
} from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE, DELEGATION_TORN_DIR } from '../src/coord/delegation-journal.js';
import {
  DELEGATION_EVENTS_CAP,
  DELEGATION_HOUR_CLOSE_MARGIN_MS,
  DELEGATION_HOUR_MS,
  DELEGATION_UNMEASURED_INCARNATION,
  canonicalDelegationJson,
  emptyDelegationCheckpoint,
  formatDelegationInstant,
  type DelegationCensusRecord,
  type DelegationCheckpointV1,
} from '../src/coord/delegation-model.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);                       // 2026-10-15T10:30Z; the hour 10:00 is open
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const OTHER_INC = '7f3c9a10-5555-4aaa-8bbb-0123456789cd';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const HOUR10 = '2026-10-15T10:00:00.000Z';
const BUCKET10 = '2026101510';
const BUCKET09 = '2026101509';
const iso = (ms: number): string => formatDelegationInstant(ms);
const srcRoot = path.resolve(__dirname, '../src');
const watchSrc = (): string => readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');

/** Every world this file made: each one's applier is closed when its test ends (M9), so no journal descriptor is left to the collector. */
const worlds: Array<{ watcher: FleetWatcher }> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map((w) => w.watcher.closeDelegation().catch(() => undefined)));
});

// ── the world: a fixture home, a watcher over it, and the spool the hook would have written ───────────────────────────

interface Faults {
  /** owner -> what its directory listing does */
  listing: Map<string, 'unreadable' | 'throw'>;
  /** owner -> a gate its listing waits on */
  hold: Map<string, Promise<void>>;
  /** owner -> a gate its range read waits on */
  holdRange: Map<string, Promise<void>>;
  /** owner -> its range reads are unreadable */
  range: Set<string>;
}
interface World {
  home: string;
  cfg: ReturnType<typeof loadConfig>;
  watcher: FleetWatcher;
  coord: CoordStore;
  io: FleetIO;
  faults: Faults;
  calls: { listings: string[]; ranges: string[]; metas: string[]; metaListings: string[] };
  ccrcDir: string;
}
interface WorldOptions { home?: string; ccdVerbs?: string[] | null; coord?: boolean }

const sessionOf = (id: string, status: 'idle' | 'busy' | 'dead' = 'idle', project = 'demo') => ({ id, project, status });
const recordOf = (id: string, project = 'demo', child: { kind: 'none' | 'child' | 'unreadable' } = { kind: 'none' }) => ({ id, project, child });
type Sess = ReturnType<typeof sessionOf>;
type Rec = ReturnType<typeof recordOf>;

function world(opts: WorldOptions = {}): World {
  const home = opts.home ?? mkTmp('ccrc-dlane-');
  const projectsRoot = mkTmp('ccrc-dlane-projects-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const faults: Faults = { listing: new Map(), hold: new Map(), holdRange: new Map(), range: new Set() };
  const calls = { listings: [] as string[], ranges: [] as string[], metas: [] as string[], metaListings: [] as string[] };
  const spoolOwner = (p: string): string | null => (p.includes('/delegation/spool/') ? path.basename(p.endsWith('.spool') ? path.dirname(p) : p) : null);
  const io: FleetIO = {
    ...localIO,
    readdirMeasured: async (p, t, s) => {
      const owner = spoolOwner(p);
      if (owner !== null) {
        calls.listings.push(owner);
        const gate = faults.hold.get(owner);
        if (gate !== undefined) await gate;
        const f = faults.listing.get(owner);
        if (f === 'throw') throw new Error('agent socket dropped');
        if (f === 'unreadable') return { ok: false, reason: 'unreadable' };
      }
      if (p.includes('/subagents/workflows/')) calls.metaListings.push(p);
      return localIO.readdirMeasured(p, t, s);
    },
    readFileMeasured: async (p, t, s) => {
      if (p.includes('/subagents/')) calls.metas.push(p);
      return localIO.readFileMeasured(p, t, s);
    },
    readFileFromBytesMeasured: async (p, o, m, t, s) => {
      const owner = spoolOwner(p);
      if (owner !== null) {
        calls.ranges.push(`${owner}/${path.basename(p)}`);
        const gate = faults.holdRange.get(owner);
        if (gate !== undefined) await gate;
        if (faults.range.has(owner)) return { ok: false, reason: 'unreadable' };
      }
      return localIO.readFileFromBytesMeasured(p, o, m, t, s);
    },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const ccdVerbs = opts.ccdVerbs === undefined ? ['caps', DELEGATION_EVENTS_CAP] : opts.ccdVerbs;
  const deps = {
    ...testDeps(home), cfg, io, ...(opts.coord === false ? {} : { coord }),
    fleetState: { connected: true, downSince: null, ccdVerbs },
  };
  const made: World = { home, cfg, watcher: new FleetWatcher(deps as never, new Bus(), 10_000), coord, io, faults, calls, ccrcDir: path.join(home, '.ccrc') };
  worlds.push(made);
  return made;
}

const spoolDir = (w: World, owner: string): string => path.join(w.cfg.registryDir, 'delegation', 'spool', owner);
const bucketFile = (w: World, owner: string, bucket: string): string => path.join(spoolDir(w, owner), `${bucket}.spool`);
const makeOwner = (w: World, owner: string): void => { mkdirSync(spoolDir(w, owner), { recursive: true }); };
const lineOf = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const common = (owner: string, extra: Record<string, unknown>, at = '2026-10-15T10:05:00.000Z', inc = INC) =>
  ({ v: 1, observedAt: at, sessionId: owner, parentIncarnation: inc, claudeSessionId: CLAUDE, ...extra });
const startLine = (owner: string, at?: string, inc?: string): string => lineOf(common(owner, { eventKind: 'SessionStart', source: 'startup' }, at, inc));
const writeBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => {
  makeOwner(w, owner);
  writeFileSync(bucketFile(w, owner, bucket), lines.join(''));
};
const appendBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => { appendFileSync(bucketFile(w, owner, bucket), lines.join('')); };

const record = (project: string, adminRecord: string, over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({
  project, adminRecord, canonicalPath: `/w/${project}/.claude/worktrees/${adminRecord}`, headBranch: null, headSha: 'a'.repeat(40),
  claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null, ...over,
});
/** Plants a census pass the lane will consume: `null` for a project is one whose worktree listing failed (no delegation census). */
type CensusView = DelegationCensusRecord[] | null | 'not-a-checkout' | 'unreachable' | WorktreeCensus;
function setCensus(w: World, projects: Record<string, CensusView>, incarnations: Record<string, ParentIncarnation>, measuredAt: number = Date.now()): DelegationCensusPass {
  const view = (recs: CensusView): WorktreeCensus =>
    recs === null ? { read: { ok: false, reason: 'unlistable' }, delegation: null }
      : recs === 'not-a-checkout' ? { read: { ok: false, reason: 'not-a-checkout' }, delegation: null }
        : recs === 'unreachable' ? { read: { ok: false, reason: 'unreachable' }, delegation: null }
          : Array.isArray(recs) ? { read: { ok: true, records: [] }, delegation: recs } : recs;
  const pass: DelegationCensusPass = {
    measuredAt, projects: new Map(Object.entries(projects).map(([p, recs]) => [p, view(recs)] as const)),
    incarnations: new Map(Object.entries(incarnations)),
  };
  (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = pass;
  return pass;
}
const measured = (inc = INC): ParentIncarnation => ({ kind: 'measured', incarnation: inc });
const setNow = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
const pass = async (w: World, sessions: readonly Sess[] = [sessionOf('demo-a')], records: readonly Rec[] = sessions.map((s) => recordOf(s.id, s.project))): Promise<void> => {
  await w.watcher.sweepDelegation(sessions as never, records as never);
};
/** One whole pass at `at`, with a census taken at `at` for `projects` (the lane reconciles only a census it has not reconciled yet). */
const censusPass = async (w: World, at: number, projects: Record<string, CensusView>, sessions: readonly Sess[] = [sessionOf('demo-a')], records?: readonly Rec[]): Promise<void> => {
  setNow(at);
  setCensus(w, projects, Object.fromEntries(sessions.map((s) => [s.id, measured()])), at);
  await pass(w, sessions, records);
};
const disk = (home: string): { checkpoint: DelegationCheckpointV1 | null; journalLines: number } => {
  const cp = path.join(home, '.ccrc', DELEGATION_CHECKPOINT_FILE);
  const jr = path.join(home, '.ccrc', DELEGATION_JOURNAL_FILE);
  return {
    checkpoint: existsSync(cp) ? decodeDelegationCheckpoint(new Uint8Array(readFileSync(cp))) : null,
    journalLines: existsSync(jr) ? readFileSync(jr, 'utf8').split('\n').filter((l) => l !== '').length : 0,
  };
};
const intervalsOf = (home: string) => disk(home).checkpoint?.observationIntervals ?? [];
const intervalFor = (home: string, owner: string, hour = HOUR10, inc = INC) =>
  intervalsOf(home).find((r) => r.sessionId === owner && r.parentIncarnation === inc && r.utcHour === hour);

/** Counts the durable calls the lane makes, without changing what they do. */
function durableCalls() {
  const proto = DelegationDurability.prototype;
  return {
    applyAcceptedBatch: vi.spyOn(proto, 'applyAcceptedBatch'),
    applyCheckpointChange: vi.spyOn(proto, 'applyCheckpointChange'),
    createLease: vi.spyOn(proto, 'createLease'),
    repairProjection: vi.spyOn(proto, 'repairProjection'),
  };
}

// ── 1. scheduling ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the lane is a NON-AWAITED sibling at the census cadence', () => {
  it('tick() dispatches it with `void`, on its own line, and never awaits it', () => {
    const src = watchSrc();
    expect(src).toMatch(/^\s*void this\.sweepDelegation\([^\n]*\)\.catch\(/m);
    expect(src).not.toMatch(/await this\.sweepDelegation\(/);
    const dispatch = src.split('\n').filter((l) => l.includes('this.sweepDelegation('));
    expect(dispatch).toHaveLength(1);
    // run 399's fenced hand-offs are never the line the dispatch rides on
    for (const fenced of ['this.sweepDivergences(', 'this.sweepStalls(', 'renewClaims', 'lapseClaims']) expect(dispatch[0]!).not.toContain(fenced);
  });

  it('the cadence is the census\' own, not a faster one: derived from DIVERGENCE_SWEEP_MS, not a second spelling of sixty seconds', () => {
    expect(DELEGATION_SWEEP_MS).toBe(60_000);
    expect(watchSrc()).toMatch(/const DELEGATION_SWEEP_MS = DIVERGENCE_SWEEP_MS;/);
  });

  it('a tick completes while the lane never settles, and the lane is handed that tick\'s sessions and records', async () => {
    const w = world();
    const spy = vi.spyOn(w.watcher, 'sweepDelegation').mockImplementation(() => new Promise<void>(() => {}));
    await w.watcher.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Array.isArray(spy.mock.calls[0]![0])).toBe(true);
    expect(Array.isArray(spy.mock.calls[0]![1])).toBe(true);
  });

  it('a rejected pass is caught by the dispatch: it cannot become an unhandled rejection that kills the poll', async () => {
    const w = world();
    vi.spyOn(w.watcher, 'sweepDelegation').mockRejectedValue(new Error('boom'));
    await expect(w.watcher.tick()).resolves.toBeUndefined();
  });

  it('runs once a cadence: a second call inside sixty seconds reads nothing, one after sixty seconds reads again', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const first = w.calls.listings.length;
    expect(first).toBeGreaterThan(0);
    setNow(NOW + 30_000);
    await pass(w);
    expect(w.calls.listings).toHaveLength(first);
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    expect(w.calls.listings.length).toBeGreaterThan(first);
  });

  it('waits for the first census: with none taken yet the lane reads nothing and does not spend its cadence', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    await pass(w);
    expect(w.calls.listings).toEqual([]);
    expect(disk(w.home).checkpoint).toBeNull();
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);                                                    // the very next call runs: the empty pass did not consume the clock
    expect(w.calls.listings.length).toBeGreaterThan(0);
  });

  it('a session this lane does not know the incarnation of yet (born after the census) is left for the next census, not guessed', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, {}, NOW);
    await pass(w);
    expect(w.calls.listings).toEqual([]);
    expect(intervalsOf(w.home)).toEqual([]);
  });

  it('a dead session is not observed', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w, [sessionOf('demo-a', 'dead')]);
    expect(w.calls.listings).toEqual([]);
  });

  it('without a coordination database there is no lane: nothing is opened, read or written', async () => {
    const w = world({ coord: false });
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(w.calls.listings).toEqual([]);
    expect(existsSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE))).toBe(false);
    expect(w.watcher.currentDelegationHealth()).toBeUndefined();
  });
});

describe('single flight (M5/M6): a pass never starts while the previous one runs', () => {
  it('a held-open read and a second call after the cadence: the second pass does not start', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    let release!: () => void;
    w.faults.hold.set('demo-a', new Promise<void>((resolve) => { release = resolve; }));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    const first = pass(w);
    await vi.waitFor(() => expect(w.calls.listings).toEqual(['demo-a']));
    setNow(NOW + DELEGATION_SWEEP_MS + 1);                            // the cadence has elapsed, and the first pass is still reading
    await pass(w);
    expect(w.calls.listings, 'the second pass started a read beside the first').toEqual(['demo-a']);
    release();
    await first;
    expect(w.calls.listings, 'one listing per owner per pass').toEqual(['demo-a']);
    expect(disk(w.home).journalLines).toBe(1);
  });

  it('after the first pass ends the next call runs: single flight is not a latch', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const n = w.calls.listings.length;
    setNow(NOW + 2 * DELEGATION_SWEEP_MS);
    await pass(w);
    expect(w.calls.listings.length).toBeGreaterThan(n);
  });

  it('two census passes never overlap: the lane reconciles the newer measuredAt and never an older one', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, NOW, { demo: [] });
    expect(plan).toHaveBeenCalledTimes(1);
    setNow(NOW + DELEGATION_SWEEP_MS);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);       // the SAME measuredAt again (no new census yet)
    await pass(w);
    expect(plan, 'the same census was reconciled twice').toHaveBeenCalledTimes(1);
    setNow(NOW + 2 * DELEGATION_SWEEP_MS);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW - 5_000);   // an OLDER one
    await pass(w);
    expect(plan, 'an older census was reconciled').toHaveBeenCalledTimes(1);
    setNow(NOW + 3 * DELEGATION_SWEEP_MS);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW + 3 * DELEGATION_SWEEP_MS);
    await pass(w);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it('a read that never answers is cut at the pass budget by a deadline, not by the read\'s cooperation, and the lane is not wedged', async () => {
    expect(DELEGATION_PASS_BUDGET_MS).toBeLessThan(DELEGATION_SWEEP_MS);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    let release!: () => void;
    w.faults.hold.set('demo-a', new Promise<void>((resolve) => { release = resolve; }));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    const stuck = pass(w);
    await vi.waitFor(() => expect(w.calls.listings).toEqual(['demo-a']));
    await vi.advanceTimersByTimeAsync(DELEGATION_PASS_BUDGET_MS + 1);
    await stuck;                                                      // the pass ended although the read did not
    expect(disk(w.home).journalLines, 'a cut pass applied nothing').toBe(0);
    w.faults.hold.delete('demo-a');
    setNow(NOW + DELEGATION_SWEEP_MS + 1);
    await pass(w);                                                    // the next pass is not blocked by the stuck one
    expect(disk(w.home).journalLines).toBe(1);
    release();                                                        // the late answer arrives after the pass was cut: it is discarded
    await vi.advanceTimersByTimeAsync(10);
    expect(disk(w.home).journalLines).toBe(1);
  });

  it('one failed owner does not stop the next: A\'s listing throws (an unmeasured hour), B is read and measured', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    writeBucket(w, 'demo-b', BUCKET10, startLine('demo-b'));
    w.faults.listing.set('demo-a', 'throw');
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured(), 'demo-b': measured() }, NOW);
    await pass(w, [sessionOf('demo-a'), sessionOf('demo-b')]);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(/^directory-unreadable/) });
    expect(intervalFor(w.home, 'demo-b')).toMatchObject({ state: 'measured' });
    expect(disk(w.home).journalLines).toBe(1);                        // B's SessionStart
  });
});

// ── 2. durable ingestion ────────────────────────────────────────────────────────────────────────────────────────────────

describe('ingestion is durable: journal, checkpoint, then SQLite, and a restart does not apply anything twice', () => {
  it('one owner\'s bucket becomes journal records, a cursor row at the end of the bytes, a measured interval, and SQLite rows', async () => {
    const w = world();
    const lines = [startLine('demo-a', '2026-10-15T10:01:00.000Z'), startLine('demo-a', '2026-10-15T10:02:00.000Z')];
    writeBucket(w, 'demo-a', BUCKET10, ...lines);
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const d = disk(w.home);
    expect(d.journalLines).toBe(2);
    const cp = d.checkpoint!;
    const bytes = Buffer.byteLength(lines.join(''));
    expect(cp.bucketCursors).toHaveLength(1);
    expect(cp.bucketCursors[0]).toMatchObject({ sessionId: 'demo-a', parentIncarnation: INC, bucket: BUCKET10, cursor: bytes, lastSize: bytes, intervalState: 'measured', replaced: false });
    expect(cp.sessions.map((s) => [s.sessionId, s.parentIncarnation])).toEqual([['demo-a', INC]]);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured', detail: null, recordedAt: iso(NOW) });
    expect(w.coord.delegationEventStats()).toEqual({ count: 2, maxSequence: 2 });
  });

  it('the journal is appended before the checkpoint and the checkpoint is replaced before SQLite is touched (O5)', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    const order: string[] = [];
    const realOpen = DelegationDurability.open.bind(DelegationDurability);
    vi.spyOn(DelegationDurability, 'open').mockImplementation((deps) =>
      realOpen({ ...deps, onEdge: async (edge, when) => { if (when === 'after') order.push(edge); } }));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const firstApply = order.slice(order.indexOf('journal-write'));
    expect(firstApply.slice(0, 8)).toEqual(['journal-write', 'journal-fsync', 'build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync', 'project']);
  });

  it('a restart applies nothing twice: the same bucket re-read by a NEW watcher adds no journal record, no SQLite row and no application', async () => {
    const first = world();
    writeBucket(first, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startLine('demo-a', '2026-10-15T10:02:00.000Z'));
    setNow(NOW);
    setCensus(first, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(first);
    const before = disk(first.home);
    const again = world({ home: first.home });
    const calls = durableCalls();
    setNow(NOW + DELEGATION_SWEEP_MS);
    setCensus(again, { demo: [] }, { 'demo-a': measured() }, NOW + DELEGATION_SWEEP_MS);
    await pass(again);
    expect(disk(first.home).journalLines).toBe(before.journalLines);
    expect(again.coord.delegationEventStats()).toEqual({ count: 2, maxSequence: 2 });
    expect(calls.applyAcceptedBatch, 'the restarted lane re-applied a bucket it had already applied').not.toHaveBeenCalled();
    expect(disk(first.home).checkpoint!.bucketCursors).toEqual(before.checkpoint!.bucketCursors);
  });

  it('appended bytes are picked up from the durable cursor and nothing before it is read as new', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:03:00.000Z'));
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    expect(disk(w.home).journalLines).toBe(2);
    expect(w.coord.delegationEventStats().count).toBe(2);
  });

  it('SQLite drift repairs from the checkpoint and the journal: a wiped projection is restored by the next reconciliation pass', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'), startLine('demo-a', '2026-10-15T10:06:00.000Z'));
    await censusPass(w, NOW, { demo: [] });
    expect(w.coord.delegationEventStats().count).toBe(2);
    w.coord.projectDelegationCheckpoint(emptyDelegationCheckpoint());           // someone emptied the five tables...
    (w.coord as unknown as { db: { exec(sql: string): void } }).db.exec('DELETE FROM delegation_events');   // ...and the events
    expect(w.coord.delegationEventStats().count).toBe(0);
    await censusPass(w, NOW + DELEGATION_SWEEP_MS, { demo: [] });
    expect(w.coord.delegationEventStats()).toEqual({ count: 2, maxSequence: 2 });
    expect(w.coord.readDelegationProjection().sessions.map((s) => s.sessionId)).toEqual(['demo-a']);
  });
});

// ── D-4655: a torn journal tail heals itself, and the next pass loses nothing ───────────────────────────────────────────────
//
// A crash or a failed write in the middle of the lane's append leaves at most one partial line after the journal's last LF; no cursor,
// ID, interval or checkpoint row refers to it, because the checkpoint is replaced only after the journal fsync. The restarted lane
// recovers (the heal keeps the bytes and cuts the journal back to the last complete record), reads the same spool line again from its
// durable cursor and mints the same eventId. The row compares the whole result with a run that never tore.
describe('D-4655: the lane heals a torn journal tail and the next pass reproduces the run that never tore', () => {
  const lines = [startLine('demo-a', '2026-10-15T10:01:00.000Z'), startLine('demo-a', '2026-10-15T10:02:00.000Z')];
  const third = startLine('demo-a', '2026-10-15T10:03:00.000Z');
  const journalPath = (w: World): string => path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE);
  /** The world that never tore: two lines ingested, then the third on the next pass. */
  async function neverTore(): Promise<World> {
    const a = world();
    writeBucket(a, 'demo-a', BUCKET10, ...lines);
    await censusPass(a, NOW, { demo: [] });
    appendBucket(a, 'demo-a', BUCKET10, third);
    await censusPass(a, NOW + DELEGATION_SWEEP_MS, { demo: [] });
    return a;
  }

  it('at every cut of the third append: the checkpoint (rows, IDs, cursors, intervals), the journal and SQLite equal the run that never tore', async () => {
    const a = await neverTore();
    const thirdRecord = `${readFileSync(journalPath(a), 'utf8').split('\n')[2]!}\n`;
    expect(thirdRecord.length).toBeGreaterThan(300);
    const reference = canonicalDelegationJson(disk(a.home).checkpoint!);
    expect(disk(a.home).journalLines).toBe(3);
    for (const k of [1, 37, Math.floor(thirdRecord.length / 2), thirdRecord.length - 2, thirdRecord.length - 1]) {
      const b = world();
      writeBucket(b, 'demo-a', BUCKET10, ...lines);
      await censusPass(b, NOW, { demo: [] });
      await b.watcher.closeDelegation();
      appendBucket(b, 'demo-a', BUCKET10, third);
      appendFileSync(journalPath(b), thirdRecord.slice(0, k));                      // the crash: a partial third record, no LF unless k reaches it
      const torn = readFileSync(journalPath(b));
      const restarted = world({ home: b.home });                                  // a NEW server process over the same home
      await censusPass(restarted, NOW + DELEGATION_SWEEP_MS, { demo: [] });
      const what = `cut ${k} of ${thirdRecord.length}`;
      expect(canonicalDelegationJson(disk(restarted.home).checkpoint!), what).toBe(reference);
      expect(readFileSync(journalPath(restarted), 'utf8'), what).toBe(readFileSync(journalPath(a), 'utf8'));
      expect(restarted.coord.delegationEventStats(), what).toEqual(a.coord.delegationEventStats());
      // and the heal is on the record: the cut bytes are kept whole, and the health says so
      const heal = restarted.watcher.currentDelegationHealth()?.lastTailHeal;
      expect(heal, what).toMatchObject({ bytes: k });
      expect(readFileSync(heal!.quarantinePath), what).toEqual(torn.subarray(torn.length - k));
      expect(heal!.quarantinePath.startsWith(path.join(restarted.ccrcDir, DELEGATION_TORN_DIR)), what).toBe(true);
    }
  });

  it('a lane that finds NO tail heals nothing: no quarantine directory, no lastTailHeal on the health', async () => {
    const a = await neverTore();
    expect(existsSync(path.join(a.ccrcDir, DELEGATION_TORN_DIR))).toBe(false);
    expect(a.watcher.currentDelegationHealth()).not.toHaveProperty('lastTailHeal');
  });

  it('MUST 1: a heal no report of this process covers (found in the quarantine at the lane\'s boot) is on the health, with its own time, bytes and path', async () => {
    const w = world();
    const torn = path.join(w.ccrcDir, DELEGATION_TORN_DIR);
    mkdirSync(torn, { recursive: true });
    const kept = path.join(torn, `618-${'e'.repeat(64)}.tail`);
    writeFileSync(kept, 'x'.repeat(412));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await censusPass(w, at(0), { demo: [] });
    const health = w.watcher.currentDelegationHealth()!;
    expect(health.lastTailHeal).toMatchObject({ bytes: 412, quarantinePath: kept, foundAtBoot: true });
    expect(health).not.toHaveProperty('tailQuarantineUnmeasured');
  });

  it('a corrupt journal is NOT healed by the lane: the pass applies nothing, the journal is untouched, nothing is kept', async () => {
    const a = world();
    writeBucket(a, 'demo-a', BUCKET10, ...lines);
    await censusPass(a, NOW, { demo: [] });
    await a.watcher.closeDelegation();
    const text = readFileSync(journalPath(a), 'utf8');
    const damaged = `${text.replace(/"digest":"[0-9a-f]{64}"/, `"digest":"${'0'.repeat(64)}"`)}{"acceptedAt":"2026-10-1`;   // a bad first record AND a torn tail
    writeFileSync(journalPath(a), damaged);
    appendBucket(a, 'demo-a', BUCKET10, third);
    const restarted = world({ home: a.home });
    await censusPass(restarted, NOW + DELEGATION_SWEEP_MS, { demo: [] });
    expect(readFileSync(journalPath(restarted), 'utf8')).toBe(damaged);
    expect(existsSync(path.join(restarted.ccrcDir, DELEGATION_TORN_DIR))).toBe(false);
    expect(restarted.watcher.currentDelegationHealth()).not.toHaveProperty('lastTailHeal');
  });
});

describe('the no-op skip (hand-off 2): a bucket result that changes nothing makes no durable call', () => {
  it('a second pass over an unchanged bucket makes ZERO durable applications; the first made one', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    const calls = durableCalls();
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 3; i++) { setNow(NOW + i * DELEGATION_SWEEP_MS); await pass(w); }
    expect(calls.applyAcceptedBatch, 'an unchanged bucket was applied again').toHaveBeenCalledTimes(1);
  });

  it('an hour with no bucket is recorded once (measured, empty) and then left alone', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const calls = durableCalls();
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured', detail: null });
    expect(disk(w.home).checkpoint!.bucketCursors, 'an empty hour needs no cursor row').toEqual([]);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
  });

  it('a repeated unmeasured reason is recorded once, not once a minute', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    w.faults.listing.set('demo-a', 'unreadable');
    const calls = durableCalls();
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    setNow(NOW + 2 * DELEGATION_SWEEP_MS);
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured' });
  });

  it('a measured hour that turns out to have a gap IS applied: unmeasured is never skipped', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured' });
    w.faults.range.add('demo-a');
    const calls = durableCalls();
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(/^range-unreadable/) });
  });

  it('a closed hour is written ONCE more after the margin (so its record postdates its close) and is then never read again', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    const calls = durableCalls();
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
    const closeAt = Date.UTC(2026, 9, 15, 11, 2, 0);
    // 11:01 is inside the close margin: the open hour 11:00 is recorded (empty), the hour 10:00 is not yet closed
    setNow(closeAt - 60_000);
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(2);                      // the new hour's first row
    expect(intervalFor(w.home, 'demo-a')!.recordedAt).toBe(iso(NOW));
    // 11:03 is past the margin
    setNow(closeAt + 60_000);
    const readsBefore = w.calls.ranges.length;
    await pass(w);
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(3);                      // the close write for hour 10
    expect(Date.parse(intervalFor(w.home, 'demo-a')!.recordedAt)).toBeGreaterThanOrEqual(closeAt);
    const readsAfterClose = w.calls.ranges.length;
    expect(readsAfterClose).toBeGreaterThan(readsBefore);
    for (let i = 2; i <= 4; i++) { setNow(closeAt + i * 60_000); await pass(w); }
    expect(calls.applyAcceptedBatch, 'a settled hour was applied again').toHaveBeenCalledTimes(3);
    expect(w.calls.ranges.slice(readsAfterClose), 'a settled hour was read again').toEqual([]);
  });

  it('an UNMEASURED hour that has closed is read once more and then left alone: a sticky gap needs no second look every minute', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), '{"this is": not json}\n');
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured' });
    const closeAt = Date.UTC(2026, 9, 15, 11, 2, 0);
    setNow(closeAt + 60_000);
    await pass(w);                                                    // closed: read once more, found nothing new, settled
    const reads = w.calls.ranges.length;
    for (let i = 2; i <= 4; i++) { setNow(closeAt + i * 60_000); await pass(w); }
    expect(w.calls.ranges.slice(reads), 'a settled unmeasured hour was read again').toEqual([]);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured' });
  });

  it('a session that ended mid-hour still has its last hour closed: the lane visits owners with an unclosed hour, live or not', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const closeAt = Date.UTC(2026, 9, 15, 11, 3, 0);
    setNow(closeAt);
    setCensus(w, { demo: [] }, {}, closeAt);
    await pass(w, [sessionOf('demo-a', 'dead')]);                              // dead now: no live session in the fleet at all
    expect(Date.parse(intervalFor(w.home, 'demo-a')!.recordedAt)).toBeGreaterThanOrEqual(closeAt);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured' });
    expect(intervalFor(w.home, 'demo-a', '2026-10-15T11:00:00.000Z'), 'a dead session has no new hour').toBeUndefined();
  });
});

describe('cursors (hand-off 4): they move only through ingestion, and a replaced bucket stays replaced', () => {
  it('a bucket that shrinks is replaced: unmeasured, nothing accepted, and it regrowing does not make it readable again', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startLine('demo-a', '2026-10-15T10:02:00.000Z'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(disk(w.home).journalLines).toBe(2);
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:09:00.000Z'));       // shorter than what was read
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    expect(disk(w.home).checkpoint!.bucketCursors[0]).toMatchObject({ replaced: true, intervalState: 'unmeasured' });
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured' });
    writeBucket(w, 'demo-a', BUCKET10, ...Array.from({ length: 6 }, (_, i) => startLine('demo-a', `2026-10-15T10:1${i}:00.000Z`)));   // regrown past the old end
    setNow(NOW + 2 * DELEGATION_SWEEP_MS);
    await pass(w);
    expect(disk(w.home).journalLines, 'a replaced bucket accepted events again').toBe(2);
    expect(disk(w.home).checkpoint!.bucketCursors[0]).toMatchObject({ replaced: true });
  });

  it('the lane never rewrites bucketCursors through a checkpoint-only change: every change it makes (attempts, interval upkeep) returns the cursor rows it was given', async () => {
    const w = rawTreeWorld();
    const proto = DelegationDurability.prototype;
    const real = proto.applyCheckpointChange;
    const seen: Array<{ before: string; after: string; attempts: number; intervals: number }> = [];
    vi.spyOn(proto, 'applyCheckpointChange').mockImplementation(function (this: DelegationDurability, change) {
      return real.call(this, (cp) => {
        const out = change(cp);
        seen.push({ before: JSON.stringify(cp.bucketCursors), after: JSON.stringify(out.bucketCursors), attempts: out.attempts.length - cp.attempts.length, intervals: out.observationIntervals.length - cp.observationIntervals.length });
        return out;
      });
    });
    const census = { demo: [OLD, RAW] };
    await censusPass(w, at(0), census);
    // an old interval for the upkeep to prune, so BOTH kinds of change happen
    const applier = await w.watcher.delegationApplier();
    await applier!.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: [...cp.observationIntervals, {
      sessionId: 'old', parentIncarnation: INC, utcHour: iso(Date.UTC(2026, 9, 1, 0)), state: 'unmeasured', detail: 'range-unreadable: x', recordedAt: iso(Date.UTC(2026, 9, 1, 1)),
    }] }));
    seen.length = 0;
    for (let i = 1; i < 4; i++) await censusPass(w, at(i), census);
    expect(seen.some((s) => s.attempts > 0), 'the lane filed no attempt through a change').toBe(true);
    expect(seen.some((s) => s.intervals < 0), 'the upkeep pruned nothing through a change').toBe(true);
    for (const s of seen) expect(s.after).toBe(s.before);
    expect(disk(w.home).checkpoint!.bucketCursors.length).toBeGreaterThan(0);
    // and the source says so: no cursor row is assigned anywhere in the lane
    const lane = watchSrc().slice(watchSrc().indexOf('THE DELEGATION LANE'));
    expect(lane).not.toMatch(/bucketCursors\s*:\s*[^,}\n]*\.(?:map|filter|slice|concat)|bucketCursors\s*=/);
  });

  it('every ingestion reads the durable state at the moment it ingests, never one cached across the read: a row that moved during the read is not regressed', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    const opened: DelegationDurability[] = [];
    const realOpen = DelegationDurability.open.bind(DelegationDurability);
    vi.spyOn(DelegationDurability, 'open').mockImplementation(async (deps) => { const d = await realOpen(deps); opened.push(d); return d; });
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const row = disk(w.home).checkpoint!.bucketCursors[0]!;
    appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:04:00.000Z'));
    let release!: () => void;
    w.faults.holdRange.set('demo-a', new Promise<void>((resolve) => { release = resolve; }));
    setNow(NOW + DELEGATION_SWEEP_MS);
    const second = pass(w);
    await vi.waitFor(() => expect(w.calls.ranges.length).toBeGreaterThanOrEqual(2));
    // another writer moves the durable row while the lane's range read is in flight
    await opened[0]!.applyAccepted({ accepted: [], cursor: { ...row, lastSize: row.lastSize + 5 }, interval: null });
    release();
    await second;
    const after = disk(w.home).checkpoint!.bucketCursors[0]!;
    expect(after.lastSize, 'the lane overwrote a row that moved under it with its stale read').toBe(row.lastSize + 5);
    expect(after.cursor).toBe(row.cursor);
    expect(disk(w.home).journalLines, 'the stale read\'s events were applied').toBe(1);
  });
});

// ── 3. the durable intervals ────────────────────────────────────────────────────────────────────────────────────────────

describe('every observed session-hour has one checkpoint-owned interval; every unmeasured reason persists across a restart', () => {
  /** A NEW watcher on the same home with every fault gone and the fleet healthy: what a restart sees. A gap recorded before it must survive it. */
  const restartHealthy = async (w: World, owners: string[] = ['demo-a'], incarnation: ParentIncarnation = measured()): Promise<World> => {
    const again = world({ home: w.home });
    const when = NOW + 2 * DELEGATION_SWEEP_MS;
    setNow(when);
    setCensus(again, { demo: [] }, Object.fromEntries(owners.map((o) => [o, incarnation])), when);
    await pass(again, owners.map((o) => sessionOf(o)));
    return again;
  };

  it('a missing capability is an unmeasured hour: an OLD fleet (a `ccd caps` list without the token) and a capability never measured', async () => {
    for (const [verbs, word] of [[['caps', 'ws-rm'], 'capability-absent'], [null, 'capability-unmeasured'], [[], 'capability-unmeasured']] as const) {
      const w = world({ ccdVerbs: verbs === null ? null : [...verbs] });
      writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
      setNow(NOW);
      setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
      await pass(w);
      expect(intervalFor(w.home, 'demo-a'), word).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(new RegExp(`^${word}`)) });
      expect(w.calls.listings, 'a fleet that does not offer the capability is not read').toEqual([]);
      expect(disk(w.home).journalLines).toBe(0);
      await restartHealthy(w);                                                                          // the fleet is healthy now, and the hour stays a gap
      expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(new RegExp(`^${word}`)) });
    }
  });

  it('D-4651: a session with no owner spool directory is UNMEASURED, never measured-empty', async () => {
    const w = world();
    makeOwner(w, 'demo-b');                                           // demo-b has a directory; demo-a (a pane older than the spool code) does not
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured(), 'demo-b': measured() }, NOW);
    await pass(w, [sessionOf('demo-a'), sessionOf('demo-b')]);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(/^directory-absent/) });
    expect(intervalFor(w.home, 'demo-b')).toMatchObject({ state: 'measured', detail: null });
    await restartHealthy(w, ['demo-a', 'demo-b']);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(/^directory-absent/) });
    // and the directory appearing later does not erase the hour it was missing
    makeOwner(w, 'demo-a');
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w, [sessionOf('demo-a'), sessionOf('demo-b')]);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured' });
  });

  it('an unreadable directory, an unreadable range and malformed evidence are each an unmeasured hour that outlives a restart', async () => {
    const w = world();
    writeBucket(w, 'demo-dir', BUCKET10, startLine('demo-dir'));
    writeBucket(w, 'demo-range', BUCKET10, startLine('demo-range'));
    writeBucket(w, 'demo-bad', BUCKET10, startLine('demo-bad', '2026-10-15T10:01:00.000Z'), '{"this is": not json}\n');
    w.faults.listing.set('demo-dir', 'unreadable');
    w.faults.range.add('demo-range');
    const owners = ['demo-dir', 'demo-range', 'demo-bad'];
    setNow(NOW);
    setCensus(w, { demo: [] }, Object.fromEntries(owners.map((o) => [o, measured()])), NOW);
    await pass(w, owners.map((o) => sessionOf(o)));
    const want: Array<[string, RegExp]> = [['demo-dir', /^directory-unreadable/], ['demo-range', /^range-unreadable/], ['demo-bad', /refused/]];
    for (const [owner, detail] of want) {
      expect(intervalFor(w.home, owner), owner).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(detail) });
    }
    // the valid line before the malformed one was still accepted: a gap in the hour is not a reason to discard the evidence that read
    expect(disk(w.home).journalLines).toBe(1);
    w.faults.listing.clear();
    w.faults.range.clear();
    await restartHealthy(w, owners);
    for (const [owner, detail] of want) expect(intervalFor(w.home, owner), `${owner} after a restart`).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(detail) });
    // the evidence the faults hid is read once they clear (the other two owners' events), but their hours stay gaps
    expect(disk(w.home).journalLines).toBe(3);
  });

  it('generation disagreement: a parent whose incarnation is unmeasured is an unmeasured hour under a sentinel incarnation, and is never read', async () => {
    for (const reason of ['absent', 'unreadable', 'changing'] as const) {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
      setNow(NOW);
      setCensus(w, { demo: [] }, { 'demo-a': { kind: 'unmeasured', reason } }, NOW);
      await pass(w);
      expect(intervalFor(w.home, 'demo-a', HOUR10, DELEGATION_UNMEASURED_INCARNATION), reason)
        .toMatchObject({ state: 'unmeasured', detail: expect.stringContaining(reason) });
      expect(w.calls.listings, 'an owner whose incarnation is unknown must not be read').toEqual([]);
      expect(disk(w.home).journalLines).toBe(0);
      await restartHealthy(w, ['demo-a'], { kind: 'unmeasured', reason });
      expect(intervalFor(w.home, 'demo-a', HOUR10, DELEGATION_UNMEASURED_INCARNATION)).toMatchObject({ state: 'unmeasured' });
    }
  });

  it('events stamped with another incarnation are refused, and the hour is unmeasured (a reused owner name is not the same parent)', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z', OTHER_INC));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'unmeasured' });
    expect(disk(w.home).journalLines).toBe(0);
  });

  it('recovery failure: with a checkpoint that cannot be read the lane applies NOTHING, leaves the file byte for byte, and reports the basis unmeasured', async () => {
    const w = world();
    mkdirSync(w.ccrcDir, { recursive: true });
    const cpPath = path.join(w.ccrcDir, DELEGATION_CHECKPOINT_FILE);
    writeFileSync(cpPath, 'not a checkpoint\n');
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(readFileSync(cpPath, 'utf8')).toBe('not a checkpoint\n');
    expect(existsSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE))).toBe(false);
    expect(w.calls.ranges, 'a lane that cannot record must not read').toEqual([]);
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('ccrc-server: delegation recovery failed'))).toBe(true);
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null, circuitBreaker: 'unmeasured', lastCheckpointRevision: null });
    // the operator repairs the file; the lane recovers at its next retry and resumes from the evidence still on disk
    rmSync(cpPath);
    setNow(NOW + 10 * 60_000);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW + 10 * 60_000);
    await pass(w);
    expect(disk(w.home).journalLines).toBe(1);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured' });
  });

  it('an active coordination restore marker keeps the lane out of the files entirely', async () => {
    const w = world();
    mkdirSync(w.ccrcDir, { recursive: true });
    writeFileSync(path.join(w.ccrcDir, COORDINATION_RESTORE_MARKER_FILE), 'x\n');
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(existsSync(path.join(w.ccrcDir, DELEGATION_CHECKPOINT_FILE))).toBe(false);
    expect(existsSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE))).toBe(false);
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'unmeasured' });
  });

  it('retention: hours older than the window and its margin are pruned through the checkpoint, and the window\'s seven days stay', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);                                                    // opens the applier
    const seed = (back: number, state: 'measured' | 'unmeasured') => ({
      sessionId: 'old', parentIncarnation: INC, utcHour: iso(Date.UTC(2026, 9, 15, 10) - back * DELEGATION_HOUR_MS), state,
      detail: state === 'measured' ? null : 'range-unreadable: x', recordedAt: iso(Date.UTC(2026, 9, 15, 10) - (back - 1) * DELEGATION_HOUR_MS + 300_000),
    });
    const rows = [seed(1, 'measured'), seed(168, 'measured'), seed(192, 'measured'), seed(193, 'unmeasured'), seed(400, 'measured')];
    const opened = await (w.watcher as unknown as { delegationApplier(): Promise<DelegationDurability | null> }).delegationApplier();
    await opened!.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: [...cp.observationIntervals, ...rows] }));
    setNow(NOW + DELEGATION_SWEEP_MS);
    await pass(w);
    const kept = intervalsOf(w.home).filter((r) => r.sessionId === 'old').map((r) => r.utcHour);
    expect(kept.sort()).toEqual([rows[2]!, rows[1]!, rows[0]!].map((r) => r.utcHour).sort());
  });
});

// ── 4. reconciliation: correlation, policy, the durable effects ───────────────────────────────────────────────────────

const bashPre = (owner: string, toolUseId: string, listing: string[], at: string, cwd = '/w/demo'): string =>
  lineOf(common(owner, { eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing, cwd }, at));
const bashPost = (owner: string, toolUseId: string, listing: string[], at: string, cwd = '/w/demo'): string =>
  lineOf(common(owner, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing, cwd }, at));
const RAW = record('demo', 'raw-tree');
const OLD = record('demo', 'old-tree');
/** The incident's case: a session ran a raw `git worktree add`, and its before/after listings differ by exactly the one new record. */
function rawTreeWorld(): World {
  const w = world();
  writeBucket(w, 'demo-a', BUCKET10,
    startLine('demo-a', '2026-10-15T10:01:00.000Z'),
    bashPre('demo-a', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'),
    bashPost('demo-a', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'));
  return w;
}
const STEP = DELEGATION_SWEEP_MS;
const at = (n: number): number => NOW + n * STEP;
const leasesOf = (home: string) => disk(home).checkpoint?.leases ?? [];
const attemptsOf = (home: string) => disk(home).checkpoint?.attempts ?? [];

describe('rung 4 end to end: a raw worktree the session itself created becomes a journaled lease identity, and nothing else', () => {
  it('is waited on for two passes (a ccd workspace may be being BORN), then linked and leased on the third', async () => {
    const w = rawTreeWorld();
    const census = { demo: [OLD, RAW] };
    await censusPass(w, at(0), census);
    expect(leasesOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toMatchObject({ unresolved: 0 });          // both trees are inside the birth wait: not unowned work (R59)
    await censusPass(w, at(1), census);
    expect(leasesOf(w.home)).toEqual([]);
    await censusPass(w, at(2), census);
    const leases = leasesOf(w.home);
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({
      project: 'demo', adminRecord: 'raw-tree', canonicalPath: RAW.canonicalPath, creationBase: RAW.claudeBase, sourceKind: 'raw',
      parentId: 'demo-a', parentageState: 'linked', generation: 0, disposition: 'ephemeral', cleanupState: 'not-due', releasedAt: null,
    });
    expect(attemptsOf(w.home).map((a) => [a.adminRecord, a.verdict, a.rung])).toEqual([['raw-tree', 'linked', 4]]);
    // durable: the journal holds the lease-created entry, and SQLite was projected from it
    expect(readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8')).toContain('"kind":"lease-created"');
    expect(w.coord.readDelegationProjection().leases.map((l) => l.adminRecord)).toEqual(['raw-tree']);
    // old-tree has no evidence at all: it is an unresolved tree, counted, with no parent to file an attempt under
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 1, conflicting: 0, unmeasured: 0 });
    expect(attemptsOf(w.home).some((a) => a.adminRecord === 'old-tree')).toBe(false);
  });

  it('a restart keeps the evidence: a NEW watcher reads the retained journal and still links what the old one saw', async () => {
    const first = rawTreeWorld();
    const census = { demo: [OLD, RAW] };
    await censusPass(first, at(0), census);                          // the events are ingested and journaled here; no lease yet
    const again = world({ home: first.home });                       // a restart: no memory, the same ~/.ccrc
    const spy = vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords');
    for (let i = 1; i < 4; i++) await censusPass(again, at(i), census);
    expect(spy, 'the journal is streamed once, not every pass').toHaveBeenCalledTimes(1);
    expect(leasesOf(first.home).map((l) => l.adminRecord)).toEqual(['raw-tree']);
    expect(again.watcher.delegationReport().evidenceEvents).toBeGreaterThan(0);
  });

  it('hand-off 7: the listing window\'s repository and the census record\'s project are ONE key. A session registered under another project links nothing', async () => {
    const w = rawTreeWorld();
    const census = { demo: [OLD, RAW] };
    for (let i = 0; i < 4; i++) {
      await censusPass(w, at(i), census, [sessionOf('demo-a', 'idle', 'other-project')], [recordOf('demo-a', 'other-project')]);
    }
    expect(leasesOf(w.home), 'rung 4 fired across two spellings of the repository').toEqual([]);
    expect(w.watcher.delegationReport().verdicts.unresolved).toBe(2);
  });

  it('hand-off 8: the pass\'s attempts are made durable by a checkpoint change BEFORE the lease is journaled and before SQLite is repaired', async () => {
    const w = rawTreeWorld();
    const calls = durableCalls();
    const census = { demo: [OLD, RAW] };
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), census);
    const last = (spy: { mock: { invocationCallOrder: number[] } }): number => spy.mock.invocationCallOrder.at(-1)!;
    expect(calls.createLease).toHaveBeenCalledTimes(1);
    const change = calls.applyCheckpointChange.mock.invocationCallOrder.filter((n) => n < last(calls.createLease));
    expect(change.length, 'the attempt was not persisted before the lease').toBeGreaterThan(0);
    expect(last(calls.repairProjection)).toBeGreaterThan(last(calls.createLease));
  });

  it('hand-off 8: the next pass sees the attempts it filed: a decision already on file is not filed again', async () => {
    const w = world();
    const subLines = [
      lineOf(common('demo-a', { eventKind: 'SessionStart', source: 'startup', cwd: '/w/demo/.claude/worktrees/scratch-tree' }, '2026-10-15T10:01:00.000Z')),
      lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: 'ag1', agentType: null, cwd: '/w/demo' }, '2026-10-15T10:02:00.000Z')),
      lineOf(common('demo-a', { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_s1', outcome: 'completed', agentId: 'ag1', cwd: '/w/demo/.claude/worktrees/scratch-tree' }, '2026-10-15T10:03:00.000Z')),
    ];
    writeBucket(w, 'demo-a', BUCKET10, ...subLines);
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    const census = { demo: [record('demo', 'scratch-tree')] };
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), census);
    expect(attemptsOf(w.home).map((a) => [a.adminRecord, a.verdict, a.detail, a.parentId])).toEqual([['scratch-tree', 'unresolved', 'parent-cwd', 'demo-a']]);
    await censusPass(w, at(3), census);
    expect(attemptsOf(w.home)).toHaveLength(1);
    const effects = plan.mock.results.at(-1)!.value as ReturnType<typeof policy.planDelegationReconciliation>;
    expect(effects.map((e) => e.kind), 'the decision was planned again').toEqual(['repair-report-projection']);
    expect(w.watcher.delegationReport().verdicts.unresolved).toBe(1);
  });

  it('hand-off 12: a request re-emitted after a crash (the attempt is durable, the lease is not) upserts the attempt and creates the lease once', async () => {
    const w = rawTreeWorld();
    const census = { demo: [OLD, RAW] };
    const realCreate = DelegationDurability.prototype.createLease;
    const boom = vi.spyOn(DelegationDurability.prototype, 'createLease').mockRejectedValueOnce(new Error('crash between the attempt and the lease'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await censusPass(w, at(0), census);
    await censusPass(w, at(1), census);
    await censusPass(w, at(2), census);                              // the lease is requested here, and the first create throws
    expect(boom).toHaveBeenCalledTimes(1);
    expect(leasesOf(w.home)).toEqual([]);
    expect(attemptsOf(w.home)).toHaveLength(1);
    boom.mockImplementation(realCreate);
    await censusPass(w, at(3), census);                              // re-emitted with the same attempt ID
    expect(leasesOf(w.home)).toHaveLength(1);
    expect(attemptsOf(w.home), 'the attempt was filed twice').toHaveLength(1);
    await censusPass(w, at(4), census);
    expect(leasesOf(w.home)).toHaveLength(1);
  });

  it('a lease is never requested when the registry holds the tree as a ccd workspace: unresolved, no effect, never run-child-owned', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const ws = record('demo', 'brisk-ridge', { canonicalPath: '/data/worktrees/demo/brisk-ridge' });
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    const corr = vi.spyOn(correlation, 'correlateDelegation');
    const records = [recordOf('demo-a'), recordOf('demo-brisk-ridge')];
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [ws] }, [sessionOf('demo-a')], records);
    // the registry row decides it from the first pass, not the birth wait and not the absence of evidence
    expect(new Set(corr.mock.results.map((r) => (r.value as { reason?: string }).reason))).toEqual(new Set(['ccd-workspace-not-a-lease']));
    const kinds = plan.mock.results.flatMap((r) => (r.value as ReturnType<typeof policy.planDelegationReconciliation>).map((e) => e.kind));
    expect(new Set(kinds)).toEqual(new Set(['repair-report-projection']));
    expect(leasesOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toMatchObject({ unresolved: 0, conflicting: 0 });     // a registered workspace is not unowned work (R59)
  });
});

describe('the pairs and the census the policy is handed (hand-offs 12 and 14)', () => {
  it('builds the pairs in ONE expression from the census: one pair per record, the census record itself, in census order, no copy', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const a = record('demo', 'tree-a');
    const b = record('demo', 'tree-b');
    const c = record('other', 'tree-c');
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, at(0), { demo: [a, b], other: [c] });
    const input = plan.mock.calls[0]![0];
    expect(input.census).toHaveLength(3);
    expect(input.correlations).toHaveLength(3);
    input.correlations.forEach((pair, i) => { expect(pair.record, `pair ${i} is a copy`).toBe(input.census[i]); });
    expect(input.census[0]).toBe(a);
    expect(input.census[1]).toBe(b);
    expect(input.census[2]).toBe(c);
    expect(input.correlations.map((p) => p.verdict.kind)).toEqual(['unresolved', 'unresolved', 'unresolved']);
  });

  it('a (project, adminRecord) held twice is held once: the policy is never handed a duplicate key', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const first = record('demo', 'tree-a');
    const again = record('demo', 'tree-a', { headBranch: 'dup' });
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, at(0), { demo: [first, again] });
    const input = plan.mock.calls[0]![0];
    expect(input.census).toEqual([first]);
    expect(input.census[0]).toBe(first);
    expect(input.correlations).toHaveLength(1);
  });

  it('a project whose census view was NULL is left out of censusedProjects and contributes no records: never an empty list standing in for "unknown"', async () => {
    const w = rawTreeWorld();
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
    expect(leasesOf(w.home)).toHaveLength(1);
    for (let i = 3; i < 7; i++) await censusPass(w, at(i), { demo: null });
    for (const [input] of plan.mock.calls.slice(3)) {
      expect(input.censusedProjects).toEqual([]);
      expect(input.census).toEqual([]);
    }
    expect(plan.mock.calls[3]![0].previousCensusedProjects).toEqual(['demo']);
    expect(plan.mock.calls[4]![0].previousCensusedProjects).toEqual([]);
    const kinds = plan.mock.results.slice(3).flatMap((r) => (r.value as ReturnType<typeof policy.planDelegationReconciliation>).map((e) => e.kind));
    expect(kinds, 'a tree under a project nobody could list was reported absent').not.toContain('record-measured-absence');
    expect(w.watcher.delegationReport().absences).toEqual([]);
  });

  it('the first census has no previous one: previousSuccessfulCensus is null, then the last pass\'s own', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, at(0), { demo: [RAW] });
    await censusPass(w, at(1), { demo: [RAW] });
    expect(plan.mock.calls[0]![0].previousSuccessfulCensus).toBeNull();
    expect(plan.mock.calls[0]![0].previousCensusedProjects).toBeNull();
    expect(plan.mock.calls[1]![0].previousSuccessfulCensus).toEqual([RAW]);
    expect(plan.mock.calls[1]![0].previousCensusedProjects).toEqual(['demo']);
  });

  it('correlation and policy read ONE snapshot: the activities correlation was handed are the very rows the policy\'s recovery state holds', async () => {
    const w = rawTreeWorld();
    const corr = vi.spyOn(correlation, 'correlateDelegation');
    const plan = vi.spyOn(policy, 'planDelegationReconciliation');
    await censusPass(w, at(0), { demo: [OLD, RAW] });
    expect(corr).toHaveBeenCalledTimes(2);
    const recovery = plan.mock.calls[0]![0].recovery;
    for (const [input] of corr.mock.calls) expect(input.activities).toBe(recovery.checkpoint.activities);
    expect(recovery.phase).toBe('ready');
  });

  it('measured absence is recorded once per tree however often policy re-emits it, with the first instant', async () => {
    const w = rawTreeWorld();
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
    expect(leasesOf(w.home)).toHaveLength(1);
    await censusPass(w, at(3), { demo: [OLD] });                      // gone from ONE listing: not absence yet
    expect(w.watcher.delegationReport().absences).toEqual([]);
    await censusPass(w, at(4), { demo: [OLD] });
    await censusPass(w, at(5), { demo: [OLD] });
    await censusPass(w, at(6), { demo: [OLD] });
    expect(w.watcher.delegationReport().absences).toEqual([{ project: 'demo', adminRecord: 'raw-tree', observedAt: iso(at(4)) }]);
    // report-only: absence closes nothing and releases nothing
    expect(leasesOf(w.home)[0]).toMatchObject({ releasedAt: null, workspaceState: 'unmeasured' });
  });

  it('hand-off 9: a Workflow RUN is its own activity row and is never a worker or an owner in the counts', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10,
      startLine('demo-a', '2026-10-15T10:01:00.000Z'),
      lineOf(common('demo-a', {
        eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: 'toolu_wf1', outcome: 'async-launched',
        launch: { status: 'async-launched', taskId: 'task_1', taskType: 'local_workflow', workflowName: 'rev', runId: 'wf_run1', transcriptDir: '/w/t/wf_run1', scriptPath: '/w/s.js' },
      }, '2026-10-15T10:02:00.000Z')));
    await censusPass(w, at(0), { demo: [] });
    expect(disk(w.home).checkpoint!.activities.map((a) => [a.sourceKind, a.upstreamId])).toEqual([['workflow', 'wf_run1']]);
    expect(w.watcher.delegationReport().verdicts, 'a run row is not a tree').toEqual({ unresolved: 0, conflicting: 0, unmeasured: 0 });
    // a tree that merely SHARES the run's id is the run's name, not its worker: nothing links it
    for (let i = 1; i < 5; i++) await censusPass(w, at(i), { demo: [record('demo', 'wf_run1')] });
    expect(leasesOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
  });

  it('hand-off 12: the health counts come from the pass\'s VERDICTS, not from attempt rows (parentless unowned work files no attempt)', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [record('demo', 'lonely-tree')] });
    expect(attemptsOf(w.home)).toEqual([]);
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ unresolved: 1, conflicting: 0, unmeasured: 0 });
  });
});

describe('the circuit breaker is the policy\'s, fed by deaths this process watched happen', () => {
  const extras = [sessionOf('demo-x'), sessionOf('demo-y')];
  const deadExtras = [sessionOf('demo-x', 'dead'), sessionOf('demo-y', 'dead')];
  const everyone = (list: Sess[]) => [sessionOf('demo-a'), ...list];

  it('two parents seen alive and then dead inside ten minutes suspend ownership claims for that pass; ten minutes later they are old news', async () => {
    const w = rawTreeWorld();
    const census = { demo: [OLD, RAW] };
    await censusPass(w, at(0), census, everyone(extras));
    await censusPass(w, at(1), census, everyone(extras));
    await censusPass(w, at(2), census, everyone(deadExtras));         // x and y died since the last pass
    expect(w.watcher.delegationReport().breaker).toBe('suspended');
    expect(w.watcher.currentDelegationHealth()!.circuitBreaker).toBe('suspended');
    expect(leasesOf(w.home), 'a lease was requested while the breaker was suspended').toEqual([]);
    await censusPass(w, at(2) + 11 * 60_000, census, everyone(deadExtras));
    expect(w.watcher.delegationReport().breaker).toBe('clear');
    expect(leasesOf(w.home)).toHaveLength(1);
  });

  it('parents that were already dead when this process first looked are not fresh deaths: a restart is not a mass-death event', async () => {
    const w = rawTreeWorld();
    const census = { demo: [OLD, RAW] };
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), census, everyone(deadExtras));
    expect(w.watcher.delegationReport().breaker).toBe('clear');
    expect(leasesOf(w.home)).toHaveLength(1);
  });

  it('a parent that dies and comes back is not dead any more', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    await censusPass(w, at(0), { demo: [] }, everyone(extras));
    await censusPass(w, at(1), { demo: [] }, everyone([sessionOf('demo-x', 'dead'), sessionOf('demo-y')]));
    await censusPass(w, at(2), { demo: [] }, everyone([sessionOf('demo-x'), sessionOf('demo-y', 'dead')]));
    expect(w.watcher.delegationReport().breaker, 'x came back, so only y is a fresh death').toBe('clear');
  });
});

// ── rung 2: the positive meta read ──────────────────────────────────────────────────────────────────────────────────────

describe('rung 2: a tree named agent-<id> or wf_<run>-<n> is decided by a point lookup of the parent\'s own meta, or not at all', () => {
  const AGENT = 'a1b2c3d4e5f60718';
  const tdir = (w: World): string => path.join(w.home, '.claude-fix', 'projects', '-demo');
  const transcript = (w: World): string => path.join(tdir(w), `${CLAUDE}.jsonl`);
  const metaFile = (w: World, agent: string): string => path.join(tdir(w), CLAUDE, 'subagents', `agent-${agent}.meta.json`);
  const wtOf = (name: string): string => `/w/demo/.claude/worktrees/${name}`;
  const startOf = (w: World, agent: string, at = '2026-10-15T10:02:00.000Z'): string =>
    lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: agent, agentType: null, cwd: '/w/demo', transcriptPath: transcript(w) }, at));
  const putMeta = (file: string, body: unknown): void => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(body)); };
  const treeOf = (agent: string): DelegationCensusRecord => record('demo', `agent-${agent}`, { canonicalPath: wtOf(`agent-${agent}`) });

  it('a meta whose worktreePath equals the canonical path links the tree at rung 2, to the agent\'s activity, after the birth wait', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startOf(w, AGENT));
    putMeta(metaFile(w, AGENT), { agentType: 'g', toolUseId: 'toolu_1', worktreePath: wtOf(`agent-${AGENT}`), spawnedWithWorktree: true });
    const census = { demo: [treeOf(AGENT)] };
    await censusPass(w, at(0), census);
    await censusPass(w, at(1), census);
    expect(leasesOf(w.home), 'a tree inside its birth wait is not asked about').toEqual([]);
    expect(w.calls.metas).toEqual([]);
    await censusPass(w, at(2), census);
    expect(w.calls.metas).toEqual([metaFile(w, AGENT)]);
    expect(leasesOf(w.home)).toHaveLength(1);
    expect(leasesOf(w.home)[0]).toMatchObject({ adminRecord: `agent-${AGENT}`, sourceKind: 'agent', parentId: 'demo-a' });
    expect(attemptsOf(w.home).map((a) => [a.verdict, a.rung])).toEqual([['linked', 2]]);
    // the meta is read evidence: nothing about it was journaled
    expect(readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8')).not.toContain('worktreePath');
  });

  it('a meta naming another path links nothing: the tree stays unmeasured, whatever its name', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startOf(w, AGENT));
    putMeta(metaFile(w, AGENT), { worktreePath: wtOf('somewhere-else') });
    const census = { demo: [treeOf(AGENT)] };
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), census);
    expect(leasesOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
  });

  it('no meta (or an unreadable or malformed one) is unmeasured and is not asked again for five minutes', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startOf(w, AGENT));
    const census = { demo: [treeOf(AGENT)] };
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), census);
    expect(w.calls.metas).toHaveLength(1);
    await censusPass(w, at(3), census);
    await censusPass(w, at(4), census);
    expect(w.calls.metas, 'a miss was asked again inside its retry interval').toHaveLength(1);
    putMeta(metaFile(w, AGENT), { worktreePath: wtOf(`agent-${AGENT}`) });
    await censusPass(w, at(2) + 5 * 60_000 + 1, census);
    expect(w.calls.metas).toHaveLength(2);
    expect(leasesOf(w.home)).toHaveLength(1);
    // malformed JSON and a non-string path are misses too
    const bad = world();
    writeBucket(bad, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startOf(bad, AGENT));
    mkdirSync(path.dirname(metaFile(bad, AGENT)), { recursive: true });
    writeFileSync(metaFile(bad, AGENT), '{not json');
    for (let i = 0; i < 4; i++) await censusPass(bad, at(i), census);
    expect(leasesOf(bad.home)).toEqual([]);
    putMeta(metaFile(bad, AGENT), { worktreePath: 7 });
    await censusPass(bad, at(2) + 5 * 60_000 + 1, census);
    expect(leasesOf(bad.home)).toEqual([]);
  });

  it('is a bounded back-fill: at most eight meta files are read in a pass, the rest wait for the next', async () => {
    const w = world();
    const agents = Array.from({ length: 12 }, (_, i) => `a${String(i).padStart(2, '0')}b2c3d4e5f607`);
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), ...agents.map((a, i) => startOf(w, a, `2026-10-15T10:02:${String(i).padStart(2, '0')}.000Z`)));
    const census = { demo: agents.map(treeOf) };
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), census);
    expect(w.calls.metas).toHaveLength(8);
    await censusPass(w, at(3), census);
    expect(w.calls.metas).toHaveLength(12);
  });

  it('a ccd workspace (a registry row) is never asked about', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startOf(w, AGENT));
    const ws = record('demo', `agent-${AGENT}`, { canonicalPath: '/data/worktrees/demo/agent-a1b2c3d4e5f60718' });
    const records = [recordOf('demo-a'), recordOf(`demo-agent-${AGENT}`)];
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [ws] }, [sessionOf('demo-a')], records);
    expect(w.calls.metas).toEqual([]);
  });

  describe('a Workflow worker', () => {
    const RUN = 'wf_run1';
    const wfDir = (w: World): string => path.join(tdir(w), CLAUDE, 'subagents', 'workflows', RUN);
    const launchOf = (w: World): string => lineOf(common('demo-a', {
      eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: 'toolu_wf1', outcome: 'async-launched', cwd: '/w/demo', transcriptPath: transcript(w),
      launch: { status: 'async-launched', taskId: 'task_1', taskType: 'local_workflow', workflowName: 'rev', runId: RUN, transcriptDir: wfDir(w), scriptPath: '/w/s.js' },
    }, '2026-10-15T10:02:00.000Z'));
    const tree = (n: number): DelegationCensusRecord => record('demo', `${RUN}-${n}`, { canonicalPath: wtOf(`${RUN}-${n}`) });

    it('is opened by its positive meta through the applier\'s own door, and linked at rung 2 as a workflow lease', async () => {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), launchOf(w));
      putMeta(path.join(wfDir(w), 'agent-aaa111.meta.json'), { agentType: 'workflow-subagent', worktreePath: wtOf(`${RUN}-1`), spawnedWithWorktree: true });
      putMeta(path.join(wfDir(w), 'agent-bbb222.meta.json'), { agentType: 'workflow-subagent', worktreePath: wtOf(`${RUN}-2`), spawnedWithWorktree: true });
      const open = vi.spyOn(DelegationDurability.prototype, 'applyPositiveWorkflowMeta');
      const census = { demo: [tree(1)] };
      for (let i = 0; i < 2; i++) await censusPass(w, at(i), census);
      expect(open).not.toHaveBeenCalled();
      expect(disk(w.home).checkpoint!.activities.map((a) => a.upstreamId)).toEqual([RUN]);           // only the run: a worker waits for its meta
      await censusPass(w, at(2), census);
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0]![0]).toEqual({ parentId: 'demo-a', parentIncarnation: INC, runId: RUN, workerIndex: 1 });
      const cp = disk(w.home).checkpoint!;
      expect(cp.activities.map((a) => a.upstreamId).sort()).toEqual([RUN, `${RUN}-1`]);
      expect(leasesOf(w.home)).toHaveLength(1);
      expect(leasesOf(w.home)[0]).toMatchObject({ adminRecord: `${RUN}-1`, sourceKind: 'workflow', canonicalPath: wtOf(`${RUN}-1`) });
      expect(attemptsOf(w.home).map((a) => [a.verdict, a.rung])).toEqual([['linked', 2]]);
    });

    it('the worker\'s index is the meta\'s own path, and a path that is not this run\'s worker opens nothing', async () => {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), launchOf(w));
      const odd = record('demo', `${RUN}-1`, { canonicalPath: wtOf('other-9') });
      putMeta(path.join(wfDir(w), 'agent-aaa111.meta.json'), { worktreePath: wtOf('other-9') });
      const open = vi.spyOn(DelegationDurability.prototype, 'applyPositiveWorkflowMeta');
      for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [odd] });
      expect(open).not.toHaveBeenCalled();
      expect(leasesOf(w.home)).toEqual([]);
    });

    it('a workflow with no launch on record, or no meta for the tree, is unmeasured and opens nothing', async () => {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
      const open = vi.spyOn(DelegationDurability.prototype, 'applyPositiveWorkflowMeta');
      for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [tree(1)] });
      expect(open).not.toHaveBeenCalled();
      expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
    });
  });
});

// ── R57 (D-4653): an eviction never decides a link ────────────────────────────────────────────────────────────────────────

describe('evidence horizon in the lane (R57, D-4653): an event the slice no longer holds can make a verdict less decided, never more', () => {
  // `demo-a` (journaled first: owners are read in id order) ran a call whose window [10:05:01, 10:05:02] is INSIDE `demo-b`'s call, the
  // one that created raw-tree: [10:05:00, 10:05:03]. Held in full the two windows overlap, so the tree is unresolved. Evict `demo-a`'s
  // pre-listing and the overlap is invisible, and the creator's window alone would link a tree it may not own.
  function overlapWorld(): World {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10,
      bashPre('demo-a', 'toolu_o1', ['old-tree'], '2026-10-15T10:05:01.000Z'), bashPost('demo-a', 'toolu_o1', ['old-tree'], '2026-10-15T10:05:02.000Z'));
    writeBucket(w, 'demo-b', BUCKET10,
      bashPre('demo-b', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'), bashPost('demo-b', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'));
    return w;
  }
  const both = [sessionOf('demo-a'), sessionOf('demo-b')];
  const census = { demo: [OLD, RAW] };

  it('held in full the overlap keeps the tree unresolved, with no lease and no attempt (the control)', async () => {
    const w = overlapWorld();
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), census, both);
    expect(leasesOf(w.home)).toEqual([]);
    expect(attemptsOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 2, conflicting: 0, unmeasured: 0 });
  });

  it('P1: the other session\'s pre-listing evicted by the cap (a test seam): the tree is UNMEASURED, and no lease and no attempt is filed', async () => {
    const w = overlapWorld();
    w.watcher.setDelegationSeams({ evidenceCap: 3 });
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), census, both);
    expect(w.watcher.delegationReport().evidenceHorizon).toBe('2026-10-15T10:05:01.000Z');
    expect(leasesOf(w.home), 'an eviction minted a lease identity').toEqual([]);
    expect(attemptsOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 1, conflicting: 0, unmeasured: 1 });
    expect(readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8')).not.toContain('"kind":"lease-created"');
  });

  it('the same truncation at a RESTART (loadEvidence keeps only the cap of the whole journal) is the same horizon, and the same answer', async () => {
    const first = overlapWorld();
    await censusPass(first, at(0), census, both);                    // ingest everything with the shipped cap
    expect(first.watcher.delegationReport().evidenceHorizon).toBeNull();
    const again = world({ home: first.home });
    again.watcher.setDelegationSeams({ evidenceCap: 3 });
    for (let i = 1; i < 5; i++) await censusPass(again, at(i), census, both);
    expect(again.watcher.delegationReport().evidenceHorizon).toBe('2026-10-15T10:05:01.000Z');
    expect(leasesOf(first.home)).toEqual([]);
    expect(again.watcher.delegationReport().verdicts.unmeasured).toBe(1);
  });

  it('with no eviction the horizon is null, whatever the volume of ordinary events', async () => {
    const w = overlapWorld();
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), census, both);
    expect(w.watcher.delegationReport().evidenceHorizon).toBeNull();
  });

  it('the horizon only ever rises, and a reload that truncates less lowers nothing it has not recomputed', async () => {
    const w = overlapWorld();
    w.watcher.setDelegationSeams({ evidenceCap: 3 });
    await censusPass(w, at(0), census, both);
    const first = w.watcher.delegationReport().evidenceHorizon;
    expect(first).not.toBeNull();
    appendBucket(w, 'demo-a', BUCKET10, bashPre('demo-a', 'toolu_o2', ['old-tree'], '2026-10-15T10:20:00.000Z'));
    setNow(at(1));
    await pass(w, both);
    expect(w.watcher.delegationReport().evidenceHorizon! >= first!).toBe(true);
  });
});

// ── R65 (D-4653): the lane remembers what it dropped, so an eviction never links ──────────────────────────────────────────

describe('the lane remembers what it dropped (R65): a link that rests on an event the slice no longer holds is unmeasured, never made', () => {
  const C = RAW.canonicalPath!;                                                    // the raw tree's path
  const A1 = 'a1b2c3d4e5f60718';
  const tool = (owner: string, n: number, cwd: string, when: string, agentId?: string): string =>
    lineOf(common(owner, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', cwd, ...(agentId === undefined ? {} : { agentId }) }, when));
  const subStart = (owner: string, agentId: string, cwd: string, when: string): string =>
    lineOf(common(owner, { eventKind: 'SubagentStart', agentId, agentType: null, cwd }, when));
  /** PA, and the lane's one-event-per-tuple rule (PD): the parent sits in the raw tree for three events (the lane holds only the FIRST,
   *  its tuple-mates are never held), moves elsewhere, launches a subagent from there, and the subagent works inside the tree. Held in
   *  full the parent's own cwd refuses the placement. Evict the parent's first event and nothing in the slice does. */
  function paWorld(): World {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10,
      tool('demo-a', 1, C, '2026-10-15T10:01:00.000Z'), tool('demo-a', 2, C, '2026-10-15T10:01:30.000Z'), tool('demo-a', 3, C, '2026-10-15T10:01:45.000Z'),
      tool('demo-a', 4, '/w/demo', '2026-10-15T10:02:00.000Z'),
      subStart('demo-a', A1, '/w/demo', '2026-10-15T10:03:00.000Z'),
      tool('demo-a', 5, C, '2026-10-15T10:04:00.000Z', A1));
    return w;
  }
  const census = { demo: [RAW] };
  const run = async (w: World, n = 4): Promise<void> => { for (let i = 0; i < n; i++) await censusPass(w, at(i), census); };

  it('control: held in full, the parent\'s own cwd refuses the placement: unresolved, no lease, no attempt of a link', async () => {
    const w = paWorld();
    await run(w);
    expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 0 });
    expect(leasesOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 1, conflicting: 0, unmeasured: 0 });
  });

  it('PA + PD: the parent\'s first event evicted by the cap (its tuple-mates were never held): unmeasured, and no lease and no attempt is filed', async () => {
    const w = paWorld();
    w.watcher.setDelegationSeams({ evidenceCap: 3 });
    await run(w);
    expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
    expect(leasesOf(w.home), 'an eviction minted a lease identity').toEqual([]);
    expect(attemptsOf(w.home)).toEqual([]);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
    expect(readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8')).not.toContain('"kind":"lease-created"');
  });

  it('a restart that truncates the journal is the same drop, found again by loadEvidence: unmeasured, and no lease', async () => {
    const first = paWorld();
    await run(first);                                                                // default cap: held in full
    const again = world({ home: first.home });
    again.watcher.setDelegationSeams({ evidenceCap: 3 });
    for (let i = 4; i < 8; i++) await censusPass(again, at(i), census);
    expect(again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
    expect(leasesOf(first.home)).toEqual([]);
    expect(again.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
  });

  describe('a lost index is not an empty one (D-4008)', () => {
    /** A restarted lane whose journal read is held open, so the moment BEFORE loadEvidence completes can be looked at. */
    async function restartHeld(cap: number | undefined) {
      const first = paWorld();
      await run(first);
      const again = world({ home: first.home });
      if (cap !== undefined) again.watcher.setDelegationSeams({ evidenceCap: cap });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const real = DelegationDurability.prototype.visitRetainedRecords;
      const visit = vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockImplementation(async function (this: DelegationDurability, v) { await gate; return real.call(this, v); });
      const running = censusPass(again, at(4), census);
      return { first, again, release, visit, running };
    }

    it('before loadEvidence completes the index is UNMEASURED and nothing is reconciled; after it re-indexes the drops the same link is unmeasured (the cap) or what the full rules say (no cap)', async () => {
      const held = await restartHeld(3);
      await vi.waitFor(() => expect(held.visit).toHaveBeenCalled());
      expect(held.again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: false, keys: 0 });
      expect(held.again.watcher.delegationReport().reconciliations, 'a reconciliation ran on a lost index').toBe(0);
      expect(leasesOf(held.first.home)).toEqual([]);
      held.release();
      await held.running;
      for (let i = 5; i < 7; i++) await censusPass(held.again, at(i), census);                    // the restarted lane waits out the tree's birth wait again
      expect(held.again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
      expect(held.again.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
      expect(leasesOf(held.first.home)).toEqual([]);
    });

    it('with nothing to truncate the re-indexed lane answers exactly what the full evidence says: unresolved(parent-cwd), not unmeasured', async () => {
      const held = await restartHeld(undefined);
      await vi.waitFor(() => expect(held.visit).toHaveBeenCalled());
      expect(held.again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: false, keys: 0 });
      held.release();
      await held.running;
      for (let i = 5; i < 7; i++) await censusPass(held.again, at(i), census);
      expect(held.again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 0 });
      expect(held.again.watcher.delegationReport().verdicts).toEqual({ unresolved: 1, conflicting: 0, unmeasured: 0 });
    });

    it('a visit that fails midway leaves the index unmeasured again (a partial index is not a measured one), and the next whole read measures it', async () => {
      const first = paWorld();
      await run(first);
      const again = world({ home: first.home });
      again.watcher.setDelegationSeams({ evidenceCap: 3 });
      const real = DelegationDurability.prototype.visitRetainedRecords;
      let broken = true;
      vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockImplementation(function (this: DelegationDurability, visit) {
        let n = 0;
        return real.call(this, (r) => { visit(r); n += 1; if (broken && n === 6) throw new Error('journal read failed midway, after the eviction'); });
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await censusPass(again, at(4), census);
      expect(again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: false, keys: 0 });
      broken = false;
      await censusPass(again, at(5), census);
      expect(again.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
    });
  });

  describe('the index is bounded by what a present tree or an activity row can still ask about', () => {
    function farWorld(): World {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10,
        tool('demo-a', 1, C, '2026-10-15T10:01:00.000Z'), tool('demo-a', 2, '/w/demo/gone-1', '2026-10-15T10:02:00.000Z'),
        tool('demo-a', 3, '/w/demo/gone-2', '2026-10-15T10:03:00.000Z'), tool('demo-a', 4, '/w/demo/gone-3', '2026-10-15T10:04:00.000Z'),
        tool('demo-a', 5, '/w/demo/gone-4', '2026-10-15T10:05:00.000Z'));
      return w;
    }
    it('after a reconcile over a measured census, the keys that report no present tree\'s path are forgotten and the one that does is kept', async () => {
      const w = farWorld();
      w.watcher.setDelegationSeams({ evidenceCap: 2, droppedPruneEvery: 1 });
      await censusPass(w, at(0), census);
      expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
      await run(w, 3);
      expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
    });
    it('while loadEvidence streams a long journal the keys are pruned as it goes: the peak is the bound, not every key the journal ever dropped', async () => {
      const first = world();
      writeBucket(first, 'demo-a', BUCKET10, tool('demo-a', 1, C, '2026-10-15T10:01:00.000Z'),
        ...Array.from({ length: 40 }, (_, i) => tool('demo-a', 100 + i, `/w/demo/far-${i}`, `2026-10-15T10:02:${String(i).padStart(2, '0')}.000Z`)));
      await censusPass(first, at(0), census);                                          // the default cap holds all 41: nothing is dropped
      expect(first.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 0, peak: 0 });
      const again = world({ home: first.home });
      again.watcher.setDelegationSeams({ evidenceCap: 2, droppedPruneEvery: 5 });
      await censusPass(again, at(1), census);
      const dropped = again.watcher.delegationReport().droppedEvidence;
      expect(dropped.keys, 'the survivors (the key that reports a present tree\'s path) plus less than one batch').toBeLessThanOrEqual(1 + 4);
      expect(dropped.keys).toBeGreaterThanOrEqual(1);
      expect(dropped.peak, 'the load held every key it dropped at once: the bound is the survivors (1) plus one batch (5)').toBeLessThanOrEqual(1 + 5);
      expect(dropped.peak).toBeGreaterThan(1);
    });
    it('a reconcile prunes only after a batch of new keys, so a busy fleet does not pay for it on every pass', async () => {
      const w = farWorld();
      w.watcher.setDelegationSeams({ evidenceCap: 2 });
      const prune = vi.spyOn(correlation, 'planDelegationDroppedPrune');
      await run(w, 3);
      expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 3 });
      expect(prune, 'pruned with a handful of new keys').not.toHaveBeenCalled();
      w.watcher.setDelegationSeams({ evidenceCap: 2, droppedPruneEvery: 3 });
      await censusPass(w, at(3), census);
      expect(prune).toHaveBeenCalledTimes(1);
      expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
    });
    it('per project: a project whose census view is null does not stop the others pruning', async () => {
      const w = farWorld();
      w.watcher.setDelegationSeams({ evidenceCap: 2, droppedPruneEvery: 1 });
      await censusPass(w, at(0), { demo: [RAW], other: null });
      expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: true, keys: 1 });
    });
  });

  describe('R69 to R71: a dropped key is forgotten only for a tree a measured census of its own project shows gone', () => {
    const SEAMS = { evidenceCap: 8, droppedPruneEvery: 1 };
    /** paWorld, padded: seven harmless events at other directories, so later events evict harmless keys and never the ones under test. The cap
     *  of eight evicts the parent's first event (at the raw tree) and the first pad when the world is first read. */
    function padded(): World {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10,
        tool('demo-a', 1, C, '2026-10-15T10:01:00.000Z'), tool('demo-a', 2, C, '2026-10-15T10:01:30.000Z'), tool('demo-a', 3, C, '2026-10-15T10:01:45.000Z'),
        ...Array.from({ length: 7 }, (_, i) => tool('demo-a', 10 + i, `/w/demo/pad-${i}`, `2026-10-15T10:02:${String(10 + i)}.000Z`)),
        subStart('demo-a', A1, '/w/demo', '2026-10-15T10:03:00.000Z'),
        tool('demo-a', 5, C, '2026-10-15T10:04:00.000Z', A1));
      return w;
    }
    /** One more event at a fresh directory: it evicts a pad, so the lane has a new dropped key and a prune is due. */
    let more = 0;
    const another = (w: World): void => { more += 1; appendBucket(w, 'demo-a', BUCKET10, tool('demo-a', 200 + more, `/w/demo/more-${more}`, `2026-10-15T10:${String(10 + more).padStart(2, '0')}:00.000Z`)); };
    const keysOf = (w: World): number => w.watcher.delegationReport().droppedEvidence.keys;
    const unreadable = { ...RAW, state: 'unreadable' as const, canonicalPath: null };
    const settled = async (w: World, from: number, n = 4): Promise<void> => { for (let i = from; i < from + n; i++) await censusPass(w, at(i), census); };
    const unlinked = (w: World): void => {
      expect(leasesOf(w.home), 'an eviction, then a prune, minted a lease identity').toEqual([]);
      expect(attemptsOf(w.home)).toEqual([]);
      expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
    };

    it('control: the padded world holds the parent\'s event dropped and the tree unmeasured, with only the key that reports the tree\'s path', async () => {
      const w = padded();
      w.watcher.setDelegationSeams(SEAMS);
      await settled(w, 0);
      expect(keysOf(w)).toBe(1);
      expect(w.watcher.delegationReport().knownTrees).toBe(1);
      unlinked(w);
    });

    it('N8, a null path: the tree\'s record read with a null path in the pass that prunes: its keys are kept, and the next measured pass does not link', async () => {
      const w = padded();
      w.watcher.setDelegationSeams(SEAMS);
      await settled(w, 0);
      another(w);
      await censusPass(w, at(4), { demo: [unreadable] });
      expect(keysOf(w), 'the remembered path protected the key').toBe(1);
      another(w);
      await settled(w, 5);
      unlinked(w);
    });

    it('N8, an absent project: the tree\'s project is missing from the census in the pass that prunes: its keys are kept, and the next measured pass does not link', async () => {
      const w = padded();
      w.watcher.setDelegationSeams(SEAMS);
      await settled(w, 0);
      another(w);
      await censusPass(w, at(4), { other: [] });
      expect(keysOf(w)).toBe(1);
      another(w);
      await settled(w, 5);
      unlinked(w);
    });

    it('N9, a transient null: a project that answers unlistable or unreachable for a pass keeps its known paths, and does not stop the prune', async () => {
      for (const view of [null, 'unreachable'] as const) {
        const w = padded();
        w.watcher.setDelegationSeams(SEAMS);
        await settled(w, 0);
        another(w);
        await censusPass(w, at(4), { demo: view });
        expect(keysOf(w), `${String(view)}: the known path protects the key and the new pad is forgotten`).toBe(1);
        another(w);
        await settled(w, 5);
        unlinked(w);
      }
    });

    it('a tree that a measured census of its project no longer lists is gone: its key is forgotten, and its remembered path with it', async () => {
      const w = padded();
      w.watcher.setDelegationSeams(SEAMS);
      await settled(w, 0);
      const before = w.watcher.delegationReport().marks.paths;
      another(w);
      await censusPass(w, at(4), { demo: [] });
      expect(keysOf(w)).toBe(0);
      expect(w.watcher.delegationReport().knownTrees).toBe(0);
      expect(w.watcher.delegationReport().marks.paths - before, 'R73 (1): the gone tree\'s key needs no mark; only the new pad\'s directory is marked').toBe(1);
    });

    it('R69 item 5: a key is stamped with the latest event dropped under it, hidden tuple-mates included: a mate observed after the census keeps the key, until a later census', async () => {
      const w = world();
      writeBucket(w, 'demo-a', BUCKET10,
        tool('demo-a', 1, C, '2026-10-15T10:01:00.000Z'), tool('demo-a', 2, C, '2026-10-15T10:45:00.000Z'),         // the mate is observed after the first census
        ...Array.from({ length: 7 }, (_, i) => tool('demo-a', 10 + i, `/w/demo/pad-${i}`, `2026-10-15T10:02:${String(10 + i)}.000Z`)),
        subStart('demo-a', A1, '/w/demo', '2026-10-15T10:03:00.000Z'), tool('demo-a', 5, C, '2026-10-15T10:04:00.000Z', A1));
      w.watcher.setDelegationSeams(SEAMS);
      await censusPass(w, NOW, { demo: [] });
      expect(keysOf(w), 'the key was forgotten against a census that predates its latest event').toBe(1);
      another(w);
      await censusPass(w, NOW + 20 * 60_000, { demo: [] });
      expect(keysOf(w)).toBe(0);
    });

    it('a restart loses the remembered paths: until the project has been measured since, its own keys are kept, and the tree is not linked', async () => {
      const first = padded();
      first.watcher.setDelegationSeams({ evidenceCap: 3 });                           // N13: the tree stays unmeasured, so no attempt is filed and nothing seeds its path
      await settled(first, 0);
      expect(attemptsOf(first.home), 'the first lane seeded the path it is meant not to').toEqual([]);
      const again = world({ home: first.home });
      again.watcher.setDelegationSeams(SEAMS);
      await censusPass(again, at(4), { demo: null });                                  // the load drops two keys; the project has not been measured since the restart
      expect(keysOf(again), 'the unmeasured project\'s keys were forgotten').toBe(2);
      another(first);                                                                  // a new batch of keys: the project is measured now, so the pad goes
      await settled(again, 5);
      expect(keysOf(again)).toBe(1);                                                   // measured now: the pad goes, the key at the listed tree's path stays
      expect(leasesOf(again.home), 'a restart, then a prune, minted a lease identity').toEqual([]);
      expect(attemptsOf(again.home)).toEqual([]);
      expect(again.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
    });

    it('per project: after a restart one project stays unreachable and another is re-measured: the re-measured one prunes, the unreachable one keeps its keys', async () => {
      const w = padded();
      writeBucket(w, 'bad-s', BUCKET10, ...Array.from({ length: 4 }, (_, i) => tool('bad-s', 300 + i, `/w/bad/far-${i}`, `2026-10-15T10:00:0${i}.000Z`)));
      const sessions = [sessionOf('bad-s', 'idle', 'bad'), sessionOf('demo-a')];
      await censusPass(w, at(0), { demo: [RAW], bad: [] }, sessions);                  // everything is held: nothing is dropped
      const again = world({ home: w.home });
      again.watcher.setDelegationSeams(SEAMS);
      await censusPass(again, at(1), { demo: [RAW], bad: 'unreachable' }, sessions);
      expect(keysOf(again), 'the re-measured project kept its pad, or the unreachable project lost its keys').toBe(1 + 4);
      another(w);                                                                      // a new batch of keys, and `bad` has been measured since the restart
      await censusPass(again, at(2), { demo: [RAW], bad: [] }, sessions);
      expect(keysOf(again)).toBe(1);
    });

    it('a restart seeds the remembered paths from the checkpoint\'s leases and attempts', async () => {
      const first = rawTreeWorld();
      for (let i = 0; i < 3; i++) await censusPass(first, at(i), { demo: [OLD, RAW] });
      expect(leasesOf(first.home)).toHaveLength(1);
      const again = world({ home: first.home });
      await censusPass(again, at(3), { demo: null });
      expect(again.watcher.delegationReport().knownTrees, 'the lease\'s tree is not remembered after a restart').toBeGreaterThanOrEqual(1);
    });

    describe('R71: a not-a-checkout answer is trusted only after it has recurred', () => {
      const naPass = async (w: World, minute: number): Promise<void> => { another(w); await censusPass(w, NOW + minute * 60_000, { demo: 'not-a-checkout' }); };
      const good = async (w: World, minute: number): Promise<void> => { another(w); await censusPass(w, NOW + minute * 60_000, census); };
      it('a live tree, then ONE not-a-checkout pass, then a good pass: nothing the forgotten evidence would have vetoed is linked', async () => {
        const w = padded();
        w.watcher.setDelegationSeams(SEAMS);
        await settled(w, 0);
        await naPass(w, 5);
        expect(keysOf(w), 'one such pass forgot the project\'s paths').toBe(1);
        await good(w, 6);
        await settled(w, 7);
        unlinked(w);
      });
      it('three consecutive passes spanning at least ten minutes forget the project\'s paths; fewer, a shorter span, or an interrupted run do not', async () => {
        const cases: readonly { name: string; script: readonly (readonly [number, 'na' | 'ok'])[]; forgets: boolean }[] = [
          { name: '3 passes over 11 minutes', script: [[5, 'na'], [10, 'na'], [16, 'na']], forgets: true },
          { name: '3 passes over 4 minutes', script: [[5, 'na'], [7, 'na'], [9, 'na']], forgets: false },
          { name: '2 passes over 20 minutes', script: [[5, 'na'], [25, 'na']], forgets: false },
          { name: 'a good pass in the run', script: [[5, 'na'], [10, 'na'], [11, 'ok'], [16, 'na'], [17, 'na']], forgets: false },
        ];
        for (const c of cases) {
          const w = padded();
          w.watcher.setDelegationSeams(SEAMS);
          await settled(w, 0);
          for (const [minute, answer] of c.script) await (answer === 'na' ? naPass : good)(w, minute);
          expect(keysOf(w), c.name).toBe(c.forgets ? 0 : 1);
        }
      });
      it('R70: a session of a project that is a confirmed not-a-checkout does not keep its keys for ever; before it is confirmed it does', async () => {
        const w = padded();
        writeBucket(w, 'bad-s', BUCKET10, ...Array.from({ length: 4 }, (_, i) => tool('bad-s', 300 + i, `/w/bad/far-${i}`, `2026-10-15T10:00:0${i}.000Z`)));
        w.watcher.setDelegationSeams(SEAMS);
        const sessions = [sessionOf('bad-s', 'idle', 'bad'), sessionOf('demo-a')];
        const asked = async (minute: number): Promise<void> => { another(w); await censusPass(w, NOW + minute * 60_000, { demo: [RAW], bad: 'not-a-checkout' }, sessions); };
        await asked(0);
        expect(keysOf(w), 'its keys, kept until the answer is confirmed').toBe(1 + 4);
        await asked(5);
        expect(keysOf(w)).toBe(1 + 4);
        await asked(11);
        expect(keysOf(w), 'the answer recurred: it holds no tree, and its keys go').toBe(1);
      });
    });

    describe('refused-project: the name is refused before anything is read, so no path in it is ever a candidate', () => {
      it('the real census of a refused name has no records, and the lane prunes the keys of a session in it at once', async () => {
        const refused = await readWorktreeCensus(localIO, mkTmp('ccrc-dlane-root-'), '..');
        expect(refused).toEqual({ read: { ok: false, reason: 'refused-project' }, delegation: null });
        const w = padded();
        writeBucket(w, 'bad-s', BUCKET10, ...Array.from({ length: 4 }, (_, i) => tool('bad-s', 300 + i, `/w/bad/far-${i}`, `2026-10-15T10:00:0${i}.000Z`)));
        w.watcher.setDelegationSeams(SEAMS);
        for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [RAW], '..': refused }, [sessionOf('bad-s', 'idle', '..'), sessionOf('demo-a')]);
        expect(keysOf(w)).toBe(1);
        expect(w.watcher.delegationReport().verdicts, 'a refused project\'s tree was decided').toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
      });
    });

    describe('N10: each layer of the lost-index condition has its own row', () => {
      it('the load fails and the same pass ingests the events that would complete a link: nothing is reconciled and correlation is never asked', async () => {
        const w = rawTreeWorld();
        vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockRejectedValue(new Error('journal read failed'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const correlate = vi.spyOn(correlation, 'correlateDelegation');
        for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
        expect(w.watcher.delegationReport().reconciliations).toBe(0);
        expect(correlate).not.toHaveBeenCalled();
        expect(leasesOf(w.home)).toEqual([]);
        expect(w.watcher.delegationReport().droppedEvidence).toMatchObject({ measured: false });
      });
      it('a reconcile forced to run with the load incomplete (a seam) is handed an UNMEASURED index, and links nothing', async () => {
        const w = rawTreeWorld();
        w.watcher.setDelegationSeams({ reconcileBeforeLoad: true });
        vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockRejectedValue(new Error('journal read failed'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const correlate = vi.spyOn(correlation, 'correlateDelegation');
        for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
        expect(correlate).toHaveBeenCalled();
        for (const call of correlate.mock.calls) expect(call[0].droppedEvidence).toEqual({ measured: false });
        expect(leasesOf(w.home), 'a lane with a lost index made a lease').toEqual([]);
      });
    });

    describe('R73: a restart never forgets a veto it cannot prove gone (every forget is proved, or leaves a coarser mark)', () => {
      const marksOf = (w: World) => w.watcher.delegationReport().marks;
      const NONE = { path: 0, id: 0, project: 0, lossy: 0, prefix: 0, window: 0 };
      /** The raw tree's record read with a null path for a TRANSIENT reason: its `gitdir` read failed. */
      const flaky = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({ ...RAW, state: 'unreadable', canonicalPath: null, diagnostic: 'gitdir-unreadable', ...over });
      /** The reviewer's P-restart: the first lane runs at cap 3, so the tree stays unmeasured and NO attempt is filed (nothing can seed its
       *  path); then a new lane on the same home. */
      async function unseeded(seams: Parameters<FleetWatcher['setDelegationSeams']>[0] = {}): Promise<World> {
        const first = paWorld();
        first.watcher.setDelegationSeams({ evidenceCap: 3 });
        await run(first);
        expect(attemptsOf(first.home), 'an attempt would seed the path').toEqual([]);
        const again = world({ home: first.home });
        again.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, ...seams });
        return again;
      }
      /** One new event from `owner` at a fresh directory: it evicts something, so a prune is due. */
      let n = 0;
      const fresh = (w: World, owner: string): void => {
        n += 1;
        const line = tool(owner, 600 + n, `/w/demo/later-${n}`, `2026-10-15T10:${String(20 + (n % 9)).padStart(2, '0')}:00.000Z`);
        if (existsSync(bucketFile(w, owner, BUCKET10))) appendBucket(w, owner, BUCKET10, line);
        else writeBucket(w, owner, BUCKET10, line);
      };
      const farLines = (owner: string, count: number, from = 0): string[] =>
        Array.from({ length: count }, (_, i) => tool(owner, 400 + from + i, `/w/demo/far-${from + i}`, `2026-10-15T10:0${Math.floor((from + i) / 12)}:${String(((from + i) % 12) * 5).padStart(2, '0')}.000Z`));
      const other = [sessionOf('other-s', 'idle', 'other')];

      it('N11 shape A: after a restart the first census lists the unseeded tree unreadable with a null path: its project holds its keys, and no lease and no attempt follow', async () => {
        const again = await unseeded();
        await censusPass(again, at(4), { demo: [flaky()] });
        expect(keysOf(again), 'the transient null path held its project\'s key').toBe(1);
        expect(marksOf(again).heldBack).toEqual({ demo: 1 });
        fresh(again, 'demo-a');
        for (let i = 5; i < 9; i++) await censusPass(again, at(i), census);
        unlinked(again);
      });

      it('N11 shape B: after a restart the tree\'s project has no live session, so its parent\'s key belongs to no known project: it goes WITH a path mark, and when the project returns the tree is not linked', async () => {
        const again = await unseeded();
        await censusPass(again, at(4), { other: [] }, other);
        expect(keysOf(again)).toBe(0);
        fresh(again, 'demo-b');
        for (let i = 5; i < 9; i++) await censusPass(again, at(i), census, [sessionOf('demo-b')]);
        expect(leasesOf(again.home), 'a restart, then a prune, minted a lease identity').toEqual([]);
        expect(attemptsOf(again.home)).toEqual([]);
        expect(again.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
        expect(marksOf(again).paths).toBeGreaterThanOrEqual(1);
        expect(marksOf(again).forced, 'counted by kind, apart from every other unmeasured reason').toEqual({ ...NONE, path: 1 });
      });

      it('N12: a record with a STANDING null path (a relative or malformed gitdir, a refused name) never stops the prune', async () => {
        const standing: readonly DelegationCensusRecord[] = [
          record('demo', 'rel-tree', { canonicalPath: null, diagnostic: 'gitdir-relative' }),
          record('demo', 'bad-tree', { canonicalPath: null, diagnostic: 'head-unreadable,gitdir-malformed' }),
          record('demo', 'bad name', { state: 'unreadable', canonicalPath: null, diagnostic: 'name-refused' }),
        ];
        for (const r of standing) {
          const w = world();
          writeBucket(w, 'demo-a', BUCKET10, ...farLines('demo-a', 30));
          w.watcher.setDelegationSeams({ evidenceCap: 2, droppedPruneEvery: 1 });
          for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [RAW, r] });
          expect(keysOf(w), r.diagnostic!).toBe(0);
          expect(marksOf(w).heldBack, r.diagnostic!).toEqual({});
        }
      });

      it('R73 rule 1: a TRANSIENT null path with no remembered path holds its own project\'s keys only for a streak of 3 passes spanning 10 minutes; then they go, with their marks', async () => {
        const w = world();
        writeBucket(w, 'demo-a', BUCKET10, ...farLines('demo-a', 30));
        w.watcher.setDelegationSeams({ evidenceCap: 2, droppedPruneEvery: 1 });
        const flakyPass = async (minute: number): Promise<void> => {
          fresh(w, 'demo-a');
          await censusPass(w, NOW + minute * 60_000, { demo: [RAW, flaky({ adminRecord: 'flaky-tree' })] });
        };
        await flakyPass(0);
        expect(keysOf(w), 'held: the unplaced record may be at any of their paths').toBeGreaterThan(20);
        await flakyPass(5);
        expect(keysOf(w)).toBeGreaterThan(20);
        await flakyPass(9);
        expect(keysOf(w), 'three passes, but not yet ten minutes').toBeGreaterThan(20);
        await flakyPass(11);
        expect(keysOf(w), 'the streak has run its course').toBe(0);
        expect(marksOf(w).paths, 'every far directory forgotten leaves its mark').toBeGreaterThanOrEqual(30);
        expect(marksOf(w).heldBack).toEqual({});
      });

      // R74: a mark lasts until a restart. Each mark has a SAFETY row (it holds, an hour and more of passes later, with no restart) and a
      // LIVENESS row (a restart's load re-indexes the complete journal, the mark is gone, and the verdict is what the keys themselves say).
      const longAfter = async (w: World, sessions: readonly Sess[], projects: Record<string, CensusView> = census): Promise<void> => {
        for (const minute of [70, 71, 130]) await censusPass(w, NOW + minute * 60_000, projects, sessions);
      };

      it('the path mark, safety: it holds the tree back pass after pass, past an hour, with no restart', async () => {
        const again = await unseeded();
        await censusPass(again, at(4), { other: [] }, other);
        fresh(again, 'demo-b');
        for (let i = 5; i < 9; i++) await censusPass(again, at(i), census, [sessionOf('demo-b')]);
        await longAfter(again, [sessionOf('demo-b')]);
        expect(leasesOf(again.home)).toEqual([]);
        expect(attemptsOf(again.home)).toEqual([]);
        expect(marksOf(again).forced, 'still the mark, not the key').toEqual({ ...NONE, path: 1 });
        expect(keysOf(again)).toBe(0);
      });

      it('the path mark, liveness: a restart re-indexes the journal with the tree listed, the mark is gone, and the forgotten key itself vetoes again', async () => {
        const again = await unseeded();
        await censusPass(again, at(4), { other: [] }, other);
        fresh(again, 'demo-b');
        for (let i = 5; i < 9; i++) await censusPass(again, at(i), census, [sessionOf('demo-b')]);
        expect(marksOf(again).forced).toEqual({ ...NONE, path: 1 });
        const restarted = world({ home: again.home });
        restarted.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
        for (let i = 9; i < 13; i++) await censusPass(restarted, at(i), census, [sessionOf('demo-b')]);
        expect(marksOf(restarted).forced, 'the key decides now').toEqual(NONE);
        expect(keysOf(restarted), 'the parent\'s key at the listed tree\'s path, read again').toBe(1);
        expect(leasesOf(restarted.home)).toEqual([]);
        expect(restarted.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
      });

      it('the path mark, liveness to a link: when the forgotten key could not veto (the subagent\'s own event), the restart clears the mark and the tree links as the full evidence says', async () => {
        const first = world();
        writeBucket(first, 'demo-a', BUCKET10,
          subStart('demo-a', A1, '/w/demo', '2026-10-15T10:01:00.000Z'), tool('demo-a', 1, C, '2026-10-15T10:02:00.000Z', A1),
          tool('demo-a', 2, '/w/demo/pad-a', '2026-10-15T10:03:00.000Z'), tool('demo-a', 3, '/w/demo/pad-b', '2026-10-15T10:04:00.000Z'),
          tool('demo-a', 4, '/w/demo/pad-c', '2026-10-15T10:05:00.000Z'), tool('demo-a', 5, C, '2026-10-15T10:06:00.000Z', A1));
        for (let i = 0; i < 3; i++) await censusPass(first, at(i), { demo: [] });           // the tree is not there yet
        const again = world({ home: first.home });
        again.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
        await censusPass(again, at(3), { other: [] }, other);
        expect(keysOf(again)).toBe(0);
        for (let i = 4; i < 7; i++) await censusPass(again, at(i), census, [sessionOf('demo-b')]);
        await longAfter(again, [sessionOf('demo-b')]);
        expect(leasesOf(again.home), 'held back by the mark, an hour on').toEqual([]);
        expect(marksOf(again).forced).toEqual({ ...NONE, path: 1 });
        const restarted = world({ home: first.home });
        restarted.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
        for (let i = 7; i < 10; i++) await censusPass(restarted, at(i), census, [sessionOf('demo-b')]);
        expect(marksOf(restarted).forced).toEqual(NONE);
        expect(leasesOf(restarted.home).map((l) => [l.adminRecord, l.sourceKind])).toEqual([['raw-tree', 'agent']]);
        expect(attemptsOf(restarted.home).map((a) => [a.adminRecord, a.verdict, a.rung])).toEqual([['raw-tree', 'linked', 3]]);
      });

      it('the id mark: a rival\'s bare event naming the agent, forgotten while nobody asked about the agent, holds the agent\'s later link back until a restart; the restart keeps the rival\'s key itself, which holds it', async () => {
        const w = world();
        writeBucket(w, 'demo-b', BUCKET10, tool('demo-b', 1, '/w/demo/b-dir', '2026-10-15T10:01:00.000Z', A1),
          ...Array.from({ length: 4 }, (_, i) => tool('demo-b', 10 + i, `/w/demo/b-pad-${i}`, `2026-10-15T10:02:0${i}.000Z`)));
        w.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
        const both = [sessionOf('demo-a'), sessionOf('demo-b')];
        await censusPass(w, at(0), { demo: [] }, both);
        expect(keysOf(w), 'the rival\'s key is forgotten: nobody asks about the agent yet').toBe(0);
        writeBucket(w, 'demo-a', BUCKET10, subStart('demo-a', A1, '/w/demo', '2026-10-15T10:10:00.000Z'), tool('demo-a', 2, C, '2026-10-15T10:11:00.000Z', A1));
        for (let i = 1; i < 5; i++) await censusPass(w, at(i), census, both);
        await longAfter(w, both);
        expect(leasesOf(w.home), 'the forgotten rival key no longer vetoes, and nothing stood for it').toEqual([]);
        expect(attemptsOf(w.home)).toEqual([]);
        expect(marksOf(w).ids, 'the agent nobody asked about when its rival key went').toBe(1);
        expect(marksOf(w).forced, 'safety: still the mark, an hour on').toEqual({ ...NONE, id: 1 });
        const restarted = world({ home: w.home });
        restarted.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
        for (let i = 5; i < 9; i++) await censusPass(restarted, at(i), census, both);
        expect(marksOf(restarted).ids, 'the agent is asked about now: its rival key is kept, not marked').toBe(0);
        expect(marksOf(restarted).forced).toEqual(NONE);
        expect(leasesOf(restarted.home)).toEqual([]);
        expect(restarted.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 1 });
      });

      it('R73 rule 3: a project held back past the per-project cap is lost: its keys go and every tree of it answers unmeasured until a restart, whose load (the project measured) clears the mark', async () => {
        const first = padded();
        await settled(first, 0);                                                     // held in full: its unresolved attempt seeds the tree's path
        expect(attemptsOf(first.home).map((a) => a.verdict)).toEqual(['unresolved']);
        const again = world({ home: first.home });
        again.watcher.setDelegationSeams({ ...SEAMS, projectHoldCap: 1 });
        await censusPass(again, at(4), { demo: null });
        expect(marksOf(again).lostProjects).toEqual(['demo']);
        expect(keysOf(again), 'the lost project holds nothing back, and its remembered path no longer protects').toBe(0);
        another(first);
        await settled(again, 5);
        await longAfter(again, [sessionOf('demo-a')]);
        expect(leasesOf(again.home)).toEqual([]);
        expect(attemptsOf(again.home).filter((a) => a.verdict === 'linked')).toEqual([]);
        expect(marksOf(again).lostProjects, 'safety: measured for an hour, still lost').toEqual(['demo']);
        expect(marksOf(again).forced).toEqual({ ...NONE, project: 1 });
        const restarted = world({ home: first.home });
        restarted.watcher.setDelegationSeams({ ...SEAMS, projectHoldCap: 1 });
        await settled(restarted, 9);
        expect(marksOf(restarted).lostProjects, 'measured at the load: it holds its keys again').toEqual([]);
        expect(marksOf(restarted).forced).toEqual(NONE);
        expect(keysOf(restarted), 'the parent\'s key at the listed tree, read again').toBe(1);
        expect(leasesOf(restarted.home)).toEqual([]);
      });

      describe('overflow: per project first, then the global flag (R75)', () => {
        /** The agent works in the tree and nothing vetoes it (the full evidence links at rung 3); three far events come first, so the cap of
         *  the slice evicts two of them and the lane forgets two directories, under `dir`. */
        function linkable(dir: (w: World) => string): World {
          const w = world();
          writeBucket(w, 'demo-a', BUCKET10,
            ...Array.from({ length: 3 }, (_, i) => tool('demo-a', 400 + i, `${dir(w)}/far-${i}`, `2026-10-15T10:00:0${i}.000Z`)),
            subStart('demo-a', A1, '/w/demo', '2026-10-15T10:05:00.000Z'), tool('demo-a', 1, C, '2026-10-15T10:06:00.000Z', A1));
          return w;
        }
        const unattributed = (): string => '/w/demo';                                 // under no project's checkout root, nor a known tree

        it('a set at its cap turns its BIGGEST project lost, dropping its marks; the global flag stays down, and that project\'s trees answer unmeasured', async () => {
          // Pass 0: demo's three directories are read, other's two evict two of them (demo: 2 marks). Pass 1: three more of other's evict
          // the third and two of other's (demo 3, other 1: at the cap of 4 the next one turns demo, the biggest, lost). Pass 2: the agent
          // arrives and works in the tree, which belongs to demo.
          const w = world();
          const root = w.cfg.projectsRoot;
          const sessions = [sessionOf('demo-a'), sessionOf('other-s', 'idle', 'other')];
          writeBucket(w, 'demo-a', BUCKET10, ...Array.from({ length: 3 }, (_, i) => tool('demo-a', 400 + i, `${root}/demo/far-${i}`, `2026-10-15T10:00:0${i}.000Z`)));
          writeBucket(w, 'other-s', BUCKET10, tool('other-s', 500, `${root}/other/o-0`, '2026-10-15T10:00:30.000Z'), tool('other-s', 501, `${root}/other/o-1`, '2026-10-15T10:00:31.000Z'));
          w.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, markCap: 4 });
          await censusPass(w, at(0), { ...census, other: [] }, sessions);
          expect(marksOf(w).paths).toBe(2);
          appendBucket(w, 'other-s', BUCKET10, ...[2, 3, 4].map((i) => tool('other-s', 500 + i, `${root}/other/o-${i}`, `2026-10-15T10:00:3${i}.000Z`)));
          await censusPass(w, at(1), { ...census, other: [] }, sessions);
          expect(marksOf(w).lossy, 'every mark had a project: no global flag').toBe(false);
          expect(marksOf(w).lostProjects, 'demo held 3 marks, other 1').toEqual(['demo']);
          expect(marksOf(w).paths, 'demo\'s marks dropped, other\'s kept').toBe(2);
          appendBucket(w, 'demo-a', BUCKET10, subStart('demo-a', A1, '/w/demo', '2026-10-15T10:05:00.000Z'), tool('demo-a', 1, C, '2026-10-15T10:06:00.000Z', A1));
          for (let i = 2; i < 4; i++) await censusPass(w, at(i), { ...census, other: [] }, sessions);
          expect(leasesOf(w.home), 'the lost project\'s tree may not link').toEqual([]);
          expect(marksOf(w).lossy).toBe(false);
          expect(marksOf(w).forced).toEqual({ ...NONE, project: 1 });
        });

        it('unattributed marks alone over the cap raise the ONE global flag: every rung-2 and rung-3 link is unmeasured, and it holds until a restart', async () => {
          const w = linkable(unattributed);
          w.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, markCap: 1 });
          for (let i = 0; i < 4; i++) await censusPass(w, at(i), census);
          await longAfter(w, [sessionOf('demo-a')]);
          expect(leasesOf(w.home), 'two directories forgotten past a cap of one: nothing may link at rung 3').toEqual([]);
          expect(marksOf(w).lossy).toBe(true);
          expect(marksOf(w).lostProjects).toEqual([]);
          expect(marksOf(w).forced).toEqual({ ...NONE, lossy: 1 });
        });

        it('liveness: a restart whose re-index fits under the cap clears the flag and the tree links; one that overflows again raises it again', async () => {
          const w = linkable(unattributed);
          w.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, markCap: 1 });
          for (let i = 0; i < 4; i++) await censusPass(w, at(i), census);
          expect(marksOf(w).lossy).toBe(true);
          const again = world({ home: w.home });
          again.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, markCap: 1 });
          await censusPass(again, at(4), census);
          expect(marksOf(again).lossy, 'the same journal under the same cap').toBe(true);
          const fits = world({ home: w.home });
          fits.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, markCap: 100 });
          for (let i = 5; i < 9; i++) await censusPass(fits, at(i), census);
          expect(marksOf(fits).lossy).toBe(false);
          expect(leasesOf(fits.home).map((l) => [l.adminRecord, l.sourceKind])).toEqual([['raw-tree', 'agent']]);
        });
      });

      describe('R77 (N19): a lost project\'s attributing prefix keeps the veto of a tree of ANOTHER repository nested under it', () => {
        // The reviewer's probes X1, X2, X4 and X7b. demo's tree sits at `cn`, inside another project's checkout or tree. The first lane
        // runs at cap 3 (no attempt, nothing seeds the path); after a restart the parent's key at `cn` is forgotten with a path mark that
        // the attribution gives to the OTHER project (shape B), which is then lost; demo returns with the tree listed.
        const nestWorld = (cn: string): World => {
          const w = world();
          writeBucket(w, 'demo-a', BUCKET10,
            tool('demo-a', 1, cn, '2026-10-15T10:01:00.000Z'), tool('demo-a', 2, cn, '2026-10-15T10:01:30.000Z'), tool('demo-a', 3, cn, '2026-10-15T10:01:45.000Z'),
            tool('demo-a', 4, '/w/demo', '2026-10-15T10:02:00.000Z'),
            subStart('demo-a', A1, '/w/demo', '2026-10-15T10:03:00.000Z'),
            tool('demo-a', 5, cn, '2026-10-15T10:04:00.000Z', A1));
          return w;
        };
        /** The probes' root: the first world's (a real, resolvable directory), so the attribution by the root applies. */
        async function restartOn(cn: (root: string) => string, seams: Parameters<FleetWatcher['setDelegationSeams']>[0] = {}): Promise<{ again: World; tree: string }> {
          const probe = world();
          const root = probe.cfg.projectsRoot;
          const tree = cn(root);
          const first = nestWorld(tree);
          first.watcher.setDelegationSeams({ evidenceCap: 3 });
          for (let i = 0; i < 4; i++) await censusPass(first, at(i), { demo: [record('demo', 'raw-tree', { canonicalPath: tree })] });
          expect(attemptsOf(first.home)).toEqual([]);
          const again = world({ home: first.home });
          (again.cfg as { projectsRoot: string }).projectsRoot = root;
          again.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, ...seams });
          return { again, tree };
        }
        /** Shape B, then an R75 overflow at markCap 1 forced by one more forgotten key; then demo returns with the tree listed at `tree`. */
        async function shapeBOverflow(cn: (root: string) => string, firstCensus: (tree: string) => Record<string, CensusView>, back: (tree: string) => Record<string, CensusView>) {
          const { again, tree } = await restartOn(cn, { markCap: 1 });
          await censusPass(again, at(4), firstCensus(tree), other);
          fresh(again, 'demo-b');
          await censusPass(again, at(5), firstCensus(tree), [...other, sessionOf('demo-b')]);
          const lost = [...marksOf(again).lostProjects];
          for (let i = 6; i < 10; i++) await censusPass(again, at(i), back(tree), [...other, sessionOf('demo-b')]);
          await longAfter(again, [...other, sessionOf('demo-b')], back(tree));
          return { again, tree, lost };
        }
        const demoAt = (tree: string) => ({ demo: [record('demo', 'raw-tree', { canonicalPath: tree })], other: [] });

        it('X1 (SAFETY): nested in another project\'s checkout; that project lost at the cap: no lease, no attempt, an hour on, counted as `prefix`', async () => {
          const o = await shapeBOverflow((root) => `${root}/other/nest/raw-tree`, () => ({ other: [] }), demoAt);
          expect(o.lost, 'the project the nest is in').toEqual(['other']);
          expect(leasesOf(o.again.home), 'a lost project dropped the veto of a tree nested in it').toEqual([]);
          expect(attemptsOf(o.again.home)).toEqual([]);
          expect(marksOf(o.again).lostPrefixes).toBeGreaterThanOrEqual(1);
          expect(marksOf(o.again).forced, 'counted apart from every other mark').toEqual({ ...NONE, prefix: 1 });
        });

        it('X2: the worktrees directory inside the projects root (a pseudo-project) lost: no lease', async () => {
          const o = await shapeBOverflow((root) => `${root}/worktrees/demo/raw-tree`, () => ({ other: [] }), demoAt);
          expect(o.lost).toEqual(['worktrees']);
          expect(leasesOf(o.again.home)).toEqual([]);
          expect(attemptsOf(o.again.home)).toEqual([]);
        });

        it('X4: nested inside another project\'s LISTED tree (the nearest-tree rule), that project lost: no lease', async () => {
          const ot = record('other', 'o-tree');
          const o = await shapeBOverflow(() => `${ot.canonicalPath!}/nest`, () => ({ other: [ot] }),
            (tree) => ({ demo: [record('demo', 'raw-tree', { canonicalPath: tree })], other: [ot] }));
          expect(o.lost).toEqual(['other']);
          expect(leasesOf(o.again.home)).toEqual([]);
          expect(attemptsOf(o.again.home)).toEqual([]);
        });

        it('X7b: nested in another project\'s checkout, that project lost by RULE 3 at the restart load (its marks are never even made): no lease', async () => {
          const probe = world();
          const root = probe.cfg.projectsRoot;
          const cn = `${root}/other/nest/raw-tree`;
          const ao = sessionOf('a-other', 'idle', 'other');
          const first = nestWorld(cn);
          writeBucket(first, 'a-other', BUCKET10, tool('a-other', 700, `${root}/other/o-0`, '2026-10-15T10:00:10.000Z'), tool('a-other', 701, `${root}/other/o-1`, '2026-10-15T10:00:11.000Z'));
          first.watcher.setDelegationSeams({ evidenceCap: 3 });
          const rec = { demo: [record('demo', 'raw-tree', { canonicalPath: cn })], other: [] };
          for (let i = 0; i < 4; i++) await censusPass(first, at(i), rec, [ao, sessionOf('demo-a')]);
          const again = world({ home: first.home });
          (again.cfg as { projectsRoot: string }).projectsRoot = root;
          again.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1, projectHoldCap: 0 });
          await censusPass(again, at(4), { other: null }, [ao]);
          expect(marksOf(again).lostProjects).toEqual(['other']);
          const back = { demo: [record('demo', 'raw-tree', { canonicalPath: cn })], other: null };
          for (let i = 5; i < 9; i++) await censusPass(again, at(i), back, [ao, sessionOf('demo-b')]);
          await longAfter(again, [ao, sessionOf('demo-b')], back);
          expect(leasesOf(again.home)).toEqual([]);
          expect(attemptsOf(again.home)).toEqual([]);
          expect(marksOf(again).forced.prefix).toBe(1);
        });

        it('LIVENESS: a restart\'s load clears the prefix cover with the lost project, and the forgotten key itself vetoes again', async () => {
          const o = await shapeBOverflow((root) => `${root}/other/nest/raw-tree`, () => ({ other: [] }), demoAt);
          expect(marksOf(o.again).forced).toEqual({ ...NONE, prefix: 1 });
          const restarted = world({ home: o.again.home });
          (restarted.cfg as { projectsRoot: string }).projectsRoot = o.again.cfg.projectsRoot;
          restarted.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
          for (let i = 10; i < 14; i++) await censusPass(restarted, at(i), demoAt(o.tree), [...other, sessionOf('demo-b')]);
          expect(marksOf(restarted).lostProjects, 'cleared by the load').toEqual([]);
          expect(marksOf(restarted).lostPrefixes).toBe(0);
          expect(marksOf(restarted).forced, 'the key decides now').toEqual(NONE);
          expect(keysOf(restarted), 'the parent\'s key at the listed tree\'s path, read again').toBe(1);
          expect(leasesOf(restarted.home)).toEqual([]);
        });
      });

      it('N16: the counts are CUMULATIVE since the last hourly line, one per tree and kind, and the line resets them', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lines = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('dropped-evidence marks'));
        const again = await unseeded();
        await censusPass(again, at(4), { other: [] }, other);
        fresh(again, 'demo-b');
        for (let i = 5; i < 8; i++) await censusPass(again, at(i), census, [sessionOf('demo-b')]);
        expect(lines(), 'the first verdict a mark held back is reported at once').toHaveLength(1);
        expect(lines()[0]).toContain('path 1, id 0, project 0, lossy 0');
        expect(marksOf(again).forcedSinceLine, 'reset by the line').toEqual(NONE);
        for (let i = 8; i < 14; i++) await censusPass(again, at(i), census, [sessionOf('demo-b')]);
        expect(lines(), 'within the hour: no second line').toHaveLength(1);
        expect(marksOf(again).forcedSinceLine, 'six reconciles held the same tree back: counted once').toEqual({ ...NONE, path: 1 });
        await censusPass(again, NOW + 61 * 60_000, census, [sessionOf('demo-b')]);
        expect(lines()).toHaveLength(2);
        expect(lines()[1]).toContain('path 1, id 0, project 0, lossy 0');
        expect(marksOf(again).forcedSinceLine).toEqual(NONE);
        expect(marksOf(again).forced, 'the gauge of the last reconcile is kept beside it').toEqual({ ...NONE, path: 1 });
      });

      it('visibility: once per UTC hour while a project is held back or lost or the flag is up, one warn line names them, and never a path', async () => {
        const first = padded();
        await settled(first, 0);
        const again = world({ home: first.home });
        again.watcher.setDelegationSeams({ ...SEAMS, projectHoldCap: 1 });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lines = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('dropped-evidence marks'));
        await censusPass(again, at(4), { demo: null });
        await censusPass(again, at(5), { demo: null });
        expect(lines()).toHaveLength(1);
        expect(lines()[0]).toMatch(/^ccrc-server: /);
        expect(lines()[0]).toContain('demo');
        expect(lines()[0]).not.toContain('/w/');
        await censusPass(again, NOW + 61 * 60_000, { demo: null });
        expect(lines()).toHaveLength(2);
      });
    });
  });

  it('the index lives in lane memory only: the source names no file for it and writes it nowhere (no new file, no SQLite-only state, the journal untouched)', () => {
    const lane = watchSrc().slice(watchSrc().indexOf('THE DELEGATION LANE'));
    expect(lane).toMatch(/lane memory/i);
    expect(lane).toContain('delegationDroppedKeyOf(');
    expect(lane).toContain('planDelegationDroppedPrune(');
    expect(lane).toContain('indexDelegationDropped(');
    // R73: the marks live beside the index, in lane memory, and the docstring says what sets and clears each.
    expect(lane).toMatch(/Lane memory only, like the index: no file, no\s*\/\/\s*SQLite-only state, the journal untouched/);
    expect(lane).toContain('delegationHashSetAdd(');
    for (const mark of ['PATH MARKS', 'ID MARKS', 'LOST PROJECTS', 'THE GLOBAL LOSSY FLAG']) expect(lane, mark).toContain(`//     - ${mark}`);
    for (const word of ['Set by', 'Set when', 'Set only when', 'Cleared only by a restart']) expect(lane).toContain(word);
    // R74: the liveness answer is stated, and the lane has no re-read of its own: a mark clears only at a restart's load.
    expect(lane).toContain('THE LIVENESS ANSWER (R74)');
    expect(lane).not.toMatch(/reread|re-read for|markReload/i);
    expect(lane.match(/this\.evidenceLoaded = false;/g) ?? [], 'only a recovery unmeasures the index').toHaveLength(1);
  });
});

// ── N4, N5, N6 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('fix round 2, minors N4 to N6', () => {
  it('N4: a project whose census view was null in a pass keeps its cached metas and misses; a measured census that no longer has the tree still prunes them', async () => {
    const w = world();
    const AGENT = 'a1b2c3d4e5f60718';
    const tdirA = path.join(w.home, '.claude-fix', 'projects', '-demo');
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'),
      lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: AGENT, agentType: null, cwd: '/w/demo', transcriptPath: path.join(tdirA, `${CLAUDE}.jsonl`) }, '2026-10-15T10:02:00.000Z')));
    const tree = record('demo', `agent-${AGENT}`, { canonicalPath: `/w/demo/.claude/worktrees/agent-${AGENT}` });
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [tree] });
    expect(w.watcher.delegationReport().metaMisses).toBe(1);
    mkdirSync(path.join(tdirA, CLAUDE, 'subagents'), { recursive: true });
    writeFileSync(path.join(tdirA, CLAUDE, 'subagents', `agent-${AGENT}.meta.json`), JSON.stringify({ worktreePath: tree.canonicalPath }));
    await censusPass(w, at(2) + 6 * 60_000, { demo: [tree] });
    expect(w.watcher.delegationReport()).toMatchObject({ pointMetas: 1 });
    await censusPass(w, at(3) + 6 * 60_000, { demo: null });                           // the project's worktree listing failed this pass
    expect(w.watcher.delegationReport(), 'a flapping census erased the project\'s cached reads').toMatchObject({ pointMetas: 1 });
    await censusPass(w, at(4) + 6 * 60_000, { demo: [] });                             // measured, and the tree is gone
    expect(w.watcher.delegationReport()).toMatchObject({ metaMisses: 0, pointMetas: 0 });
  });

  it('N4: a miss stays through a null view too (the miss is keyed by project)', async () => {
    const w = world();
    const AGENT = 'a1b2c3d4e5f60718';
    const tdirA = path.join(w.home, '.claude-fix', 'projects', '-demo');
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'),
      lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: AGENT, agentType: null, cwd: '/w/demo', transcriptPath: path.join(tdirA, `${CLAUDE}.jsonl`) }, '2026-10-15T10:02:00.000Z')));
    const tree = record('demo', `agent-${AGENT}`, { canonicalPath: `/w/demo/.claude/worktrees/agent-${AGENT}` });
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [tree] });
    expect(w.watcher.delegationReport().metaMisses).toBe(1);
    await censusPass(w, at(3), { demo: null });
    expect(w.watcher.delegationReport().metaMisses).toBe(1);
  });

  it('N5: a tree that holds an unreleased lease is owned: as its evidence leaves the slice it is counted as neither unresolved, conflicting nor unmeasured', async () => {
    const w = rawTreeWorld();
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
    expect(leasesOf(w.home)).toHaveLength(1);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 1, conflicting: 0, unmeasured: 0 });       // OLD, which nothing explains
    w.watcher.setDelegationSeams({ evidenceCap: 1 });
    appendBucket(w, 'demo-a', BUCKET10, lineOf(common('demo-a', { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_late', outcome: 'completed', cwd: '/w/demo/late' }, '2026-10-15T10:20:00.000Z')));
    await censusPass(w, at(3), { demo: [OLD, RAW] });
    await censusPass(w, at(4), { demo: [OLD, RAW] });
    expect(w.watcher.delegationReport().evidenceEvents).toBe(1);                                                    // the creating window is gone
    expect(w.watcher.delegationReport().verdicts, 'the leased tree was counted as the evidence aged').toEqual({ unresolved: 1, conflicting: 0, unmeasured: 0 });
    expect(leasesOf(w.home)).toHaveLength(1);
  });

  it('N6: a prune that FAILED is retried at most once per UTC hour, like one that succeeded', async () => {
    const DAY3 = 72 * 3_600_000;
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    await censusPass(w, NOW, { demo: [] });
    await censusPass(w, Date.UTC(2026, 9, 15, 11, 3, 0), { demo: [] });                // the close write
    const prune = vi.spyOn(DelegationDurability.prototype, 'pruneBucketCursors').mockRejectedValue(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await censusPass(w, NOW + DAY3, { demo: [] });
    await censusPass(w, NOW + DAY3 + 60_000, { demo: [] });
    await censusPass(w, NOW + DAY3 + 120_000, { demo: [] });
    expect(prune, 'a failed prune was retried on every pass').toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('cursor retention failed'))).toHaveLength(1);
    await censusPass(w, NOW + DAY3 + 3_600_000, { demo: [] });
    expect(prune).toHaveBeenCalledTimes(2);
  });
});

// ── R58 (D-4654): the lane reads nothing past the lookback, and cursors retire behind that horizon ─────────────────────

describe('the read horizon and cursor retention in the lane (R58, D-4654)', () => {
  const DAY3 = 72 * 3_600_000;
  const closeOf = Date.UTC(2026, 9, 15, 11, 3, 0);

  /** One session with a closed, measured hour at 10:00 and a cursor behind it, three days before the lane's next pass. */
  async function agedWorld(): Promise<World> {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    await censusPass(w, NOW, { demo: [] });                                          // read at 10:30
    await censusPass(w, closeOf, { demo: [] });                                      // the close write at 11:03
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured' });
    expect(Date.parse(intervalFor(w.home, 'demo-a')!.recordedAt)).toBeGreaterThanOrEqual(closeOf);
    expect(disk(w.home).checkpoint!.bucketCursors).toHaveLength(1);
    return w;
  }

  it('an old bucket of a LIVE idle session is never range-read, and its interval is unchanged', async () => {
    const w = await agedWorld();
    const before = JSON.stringify(intervalFor(w.home, 'demo-a'));
    const reads = w.calls.ranges.length;
    await censusPass(w, NOW + DAY3, { demo: [] });
    await censusPass(w, NOW + DAY3 + 60_000, { demo: [] });
    expect(w.calls.ranges.slice(reads), 'the three-day-old bucket was range-read').toEqual([]);
    expect(JSON.stringify(intervalFor(w.home, 'demo-a'))).toBe(before);
    expect(disk(w.home).journalLines).toBe(1);
  });

  it('a three-day-old bucket left in a DEAD session\'s spool directory is never range-read, and the hour it was recorded before closing becomes a gap', async () => {
    const w = world();
    writeBucket(w, 'demo-x', BUCKET10, startLine('demo-x', '2026-10-15T10:01:00.000Z'));
    await censusPass(w, NOW, { demo: [] }, [sessionOf('demo-x')]);                    // recorded mid-hour, never closed
    const reads = w.calls.ranges.length;
    setNow(NOW + DAY3);
    setCensus(w, { demo: [] }, {}, NOW + DAY3);
    await pass(w, [sessionOf('demo-x', 'dead')]);
    expect(w.calls.ranges.slice(reads), 'a dead owner\'s three-day-old bucket was range-read').toEqual([]);
    expect(w.calls.listings.filter((o) => o === 'demo-x')).toHaveLength(1);          // not even listed again: nothing to close
    expect(intervalFor(w.home, 'demo-x')).toMatchObject({ state: 'unmeasured', detail: expect.stringMatching(/^hour-never-closed/) });
  });

  it('a cursor past the retention whose interval is on file is dropped by the lane\'s upkeep, once per UTC hour, and a bucket still listed is not read as new', async () => {
    const w = await agedWorld();
    const prune = vi.spyOn(DelegationDurability.prototype, 'pruneBucketCursors');
    await censusPass(w, NOW + DAY3, { demo: [] });
    expect(prune).toHaveBeenCalledTimes(1);
    expect(disk(w.home).checkpoint!.bucketCursors).toEqual([]);
    expect(w.watcher.delegationReport().cursorsPruned).toBe(1);
    await censusPass(w, NOW + DAY3 + 60_000, { demo: [] });                           // the same UTC hour
    expect(prune, 'the prune ran twice in one hour').toHaveBeenCalledTimes(1);
    await censusPass(w, NOW + DAY3 + 2 * 3_600_000, { demo: [] });                    // a later hour with nothing droppable
    expect(prune, 'the prune ran with nothing to drop').toHaveBeenCalledTimes(1);
    expect(disk(w.home).journalLines).toBe(1);
  });

  it('the prune runs at most once per UTC hour even when a droppable cursor reappears inside it, and again in the next hour', async () => {
    const w = await agedWorld();
    const prune = vi.spyOn(DelegationDurability.prototype, 'pruneBucketCursors');
    await censusPass(w, NOW + DAY3, { demo: [] });
    expect(prune).toHaveBeenCalledTimes(1);
    w.watcher.setDelegationSeams({ readEveryListedBucket: true });                    // the old bucket is read again: its cursor is back, and droppable
    await censusPass(w, NOW + DAY3 + 60_000, { demo: [] });
    expect(disk(w.home).checkpoint!.bucketCursors, 'the seam did not bring the cursor back').toHaveLength(1);
    expect(prune, 'a second prune inside the same UTC hour').toHaveBeenCalledTimes(1);
    await censusPass(w, NOW + DAY3 + 3_600_000, { demo: [] });
    expect(prune).toHaveBeenCalledTimes(2);
    expect(disk(w.home).checkpoint!.bucketCursors).toEqual([]);
  });

  it('the prune is called only when the planner has something to drop: a fleet of young cursors never calls it', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    const prune = vi.spyOn(DelegationDurability.prototype, 'pruneBucketCursors');
    for (let i = 0; i < 3; i++) await censusPass(w, NOW + i * 3_600_000, { demo: [] });
    expect(prune).not.toHaveBeenCalled();
  });

  it('with the read horizon bypassed (a test seam), re-ingesting a pruned bucket accepts nothing new: the eventIds dedupe against the retained journal', async () => {
    const w = await agedWorld();
    await censusPass(w, NOW + DAY3, { demo: [] });
    expect(disk(w.home).checkpoint!.bucketCursors).toEqual([]);
    const journalBefore = readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8');
    const stats = w.coord.delegationEventStats();
    const reads = w.calls.ranges.length;
    w.watcher.setDelegationSeams({ readEveryListedBucket: true });
    await censusPass(w, NOW + DAY3 + 3_600_000, { demo: [] });
    expect(w.calls.ranges.length, 'the seam did not make the lane read the old bucket').toBeGreaterThan(reads);
    expect(readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8'), 'a pruned bucket was journaled twice').toBe(journalBefore);
    expect(w.coord.delegationEventStats()).toEqual(stats);
  });

  it('the lane\'s prune is not a checkpoint-only change: it never reaches applyCheckpointChange, and the source names the one door', () => {
    const lane = watchSrc().slice(watchSrc().indexOf('THE DELEGATION LANE'));
    expect(lane).toContain('pruneBucketCursors(');
    expect(lane).toContain('delegationBucketReadable(');
    expect(lane).toContain('planDelegationCursorRetention(');
  });
});

// ── R59: unresolved and conflicting count unowned work only ────────────────────────────────────────────────────────────────

describe('the verdict counts count unowned work (R59): a workspace or a tree being born is not work', () => {
  it('a fleet of registered ccd workspaces plus trees in the birth wait, with no unowned tree, reports unresolved 0 and conflicting 0', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const ws = [record('demo', 'one', { canonicalPath: '/data/worktrees/demo/one' }), record('demo', 'two', { canonicalPath: '/data/worktrees/demo/two' })];
    const born = record('demo', 'fresh-tree');
    const records = [recordOf('demo-a'), recordOf('demo-one'), recordOf('demo-two', 'demo', { kind: 'child' })];
    await censusPass(w, at(0), { demo: [...ws, born] }, [sessionOf('demo-a')], records);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 0 });
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ unresolved: 0, conflicting: 0, unmeasured: 0 });
    await censusPass(w, at(1), { demo: [...ws, born] }, [sessionOf('demo-a')], records);
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 0, conflicting: 0, unmeasured: 0 });
  });

  it('once the wait is over, a tree nothing explains IS unowned work and is counted; a tree the lane could not decide is counted as unmeasured', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const lonely = record('demo', 'lonely-tree');
    const unreadable = record('demo', 'broken-tree', { state: 'unreadable', canonicalPath: null });
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), { demo: [lonely, unreadable] });
    expect(w.watcher.delegationReport().verdicts).toEqual({ unresolved: 1, conflicting: 0, unmeasured: 1 });
  });
});

// ── M1 (D-4652), M3: a failed evidence read leaves the lane unmeasured ─────────────────────────────────────────────────────

describe('the evidence read can fail (M1, M3): partial evidence never reaches correlation, and the counts read as unknown while the breaker is unmeasured', () => {
  it('a visit that fails midway leaves the lane unmeasured: no reconciliation, no lease, no attempt; a later pass that reads whole proceeds', async () => {
    const first = rawTreeWorld();
    await censusPass(first, at(0), { demo: [OLD, RAW] });                           // everything is ingested; the lane is reconciled once
    const again = world({ home: first.home });
    const real = DelegationDurability.prototype.visitRetainedRecords;
    let broken = true;
    vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockImplementation(function (this: DelegationDurability, visit) {
      let n = 0;
      return real.call(this, (r) => { visit(r); n += 1; if (broken && n === 2) throw new Error('journal read failed midway'); });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 1; i < 5; i++) await censusPass(again, at(i), { demo: [OLD, RAW] });
    expect(again.watcher.delegationReport().reconciliations, 'a reconciliation ran on partial evidence').toBe(0);
    expect(leasesOf(first.home)).toEqual([]);
    expect(attemptsOf(first.home)).toEqual([]);
    // M3: while the evidence is unread the counts are zero, and the breaker says so: a reader treats the counts as unknown
    expect(again.watcher.currentDelegationHealth()).toMatchObject({ circuitBreaker: 'unmeasured', unresolved: 0, conflicting: 0, unmeasured: 0 });
    broken = false;
    for (let i = 5; i < 9; i++) await censusPass(again, at(i), { demo: [OLD, RAW] });
    expect(again.watcher.delegationReport().reconciliations).toBeGreaterThan(0);
    expect(again.watcher.currentDelegationHealth()!.circuitBreaker).toBe('clear');
    expect(leasesOf(first.home)).toHaveLength(1);
  });

  it('M3: before the first reconciliation the health says breaker unmeasured while its counts are 0; they are numbers only once the breaker is measured', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    setNow(NOW);
    await w.watcher.delegationApplier();
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ circuitBreaker: 'unmeasured', unresolved: 0, conflicting: 0, unmeasured: 0 });
    await censusPass(w, at(0), { demo: [record('demo', 'lonely-tree')] });
    expect(w.watcher.currentDelegationHealth()!.circuitBreaker).toBe('clear');
  });
});

// ── M2, M5, M6 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the lane\'s documented relaxations and its bounds (M2, M5, M6)', () => {
  const lane = (): string => watchSrc().slice(watchSrc().indexOf('THE DELEGATION LANE'));

  it('M2: the docstring states that a budget cut releases the latch while the cut pass\'s late work is inert, and that statMeasured takes no signal', () => {
    const src = lane();
    expect(src).toMatch(/releases the (?:single-flight )?latch/);
    expect(src).toMatch(/statMeasured/);
    expect(src).toMatch(/dedupe/i);
  });

  it('M5: a workflow\'s meta directory listing is charged to the per-pass budget, and claimants are indexed once per reconcile (no scan of the evidence map per tree)', async () => {
    const w = world();
    const runs = Array.from({ length: 12 }, (_, i) => `wf_r${String(i).padStart(2, '0')}`);
    const tdir = path.join(w.home, '.claude-fix', 'projects', '-demo', CLAUDE, 'subagents', 'workflows');
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), ...runs.map((r, i) => lineOf(common('demo-a', {
      eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_${r}`, outcome: 'async-launched', cwd: '/w/demo',
      launch: { status: 'async-launched', taskId: `task_${i}`, taskType: 'local_workflow', workflowName: 'rev', runId: r, transcriptDir: path.join(tdir, r), scriptPath: '/w/s.js' },
    }, `2026-10-15T10:02:${String(i).padStart(2, '0')}.000Z`))));
    const trees = runs.map((r) => record('demo', `${r}-1`, { canonicalPath: `/w/demo/.claude/worktrees/${r}-1` }));
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: trees });
    expect(w.calls.metaListings.length, 'more than eight workflow directories were listed in one pass').toBe(8);
    await censusPass(w, at(3), { demo: trees });
    expect(w.calls.metaListings.length).toBe(12);
    const body = (name: string): string => { const m = new RegExp(`private async ${name}\\([\\s\\S]*?\\n  }\\n`).exec(lane()); return m === null ? '' : m[0]; };
    for (const name of ['readAgentMeta', 'readWorkflowMeta']) {
      expect(body(name), `${name} not found`).not.toBe('');
      expect(body(name), `${name} scans the evidence map`).not.toMatch(/of this\.evidence\b/);
    }
  });

  it('M6: the lane\'s memory is bounded by the census: meta misses and positive metas leave with their tree, and an absence leaves when the tree returns', async () => {
    const w = world();
    const AGENT = 'a1b2c3d4e5f60718';
    const tdirA = path.join(w.home, '.claude-fix', 'projects', '-demo');
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'),
      lineOf(common('demo-a', { eventKind: 'SubagentStart', agentId: AGENT, agentType: null, cwd: '/w/demo', transcriptPath: path.join(tdirA, `${CLAUDE}.jsonl`) }, '2026-10-15T10:02:00.000Z')));
    const tree = record('demo', `agent-${AGENT}`, { canonicalPath: `/w/demo/.claude/worktrees/agent-${AGENT}` });
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [tree] });
    expect(w.watcher.delegationReport().metaMisses).toBe(1);                         // no meta file: a miss, remembered
    mkdirSync(path.join(tdirA, CLAUDE, 'subagents'), { recursive: true });
    writeFileSync(path.join(tdirA, CLAUDE, 'subagents', `agent-${AGENT}.meta.json`), JSON.stringify({ worktreePath: tree.canonicalPath }));
    await censusPass(w, at(2) + 6 * 60_000, { demo: [tree] });
    expect(w.watcher.delegationReport().pointMetas).toBe(1);
    await censusPass(w, at(3) + 6 * 60_000, { demo: [] });                           // the tree is gone from the census
    expect(w.watcher.delegationReport()).toMatchObject({ metaMisses: 0, pointMetas: 0 });
  });

  it('M6: a measured absence is dropped when the tree comes back, and re-recorded with its new first instant if it goes again', async () => {
    const w = rawTreeWorld();
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
    for (let i = 3; i < 6; i++) await censusPass(w, at(i), { demo: [OLD] });
    expect(w.watcher.delegationReport().absences).toHaveLength(1);
    await censusPass(w, at(6), { demo: [OLD, RAW] });
    expect(w.watcher.delegationReport().absences, 'a tree that is back is not absent').toEqual([]);
  });
});

// ── 5. the health surface ───────────────────────────────────────────────────────────────────────────────────────────────

describe('currentDelegationHealth: absent until the lane has tried, then report-only and honest', () => {
  it('is absent (unknown to a reader) before the lane has ever run', () => {
    const w = world();
    expect(w.watcher.currentDelegationHealth()).toBeUndefined();
  });

  it('after a pass it is present, report-only, and unmeasured: one hour of history is not a seven-day window', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    await censusPass(w, at(0), { demo: [] });
    const h = w.watcher.currentDelegationHealth()!;
    expect(h).toMatchObject({ mode: 'report-only', stageGate: 'unmeasured', unmeasuredRate: null });
    expect(h.lastCheckpointRevision).toBe(disk(w.home).checkpoint!.revision);
    expect(h.lastIngestedAt).toBe(iso(at(0)));
  });

  it('an unreadable registry makes it unmeasured and suspends the breaker, as of the moment it is asked', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    await censusPass(w, at(0), { demo: [] });
    w.watcher.noteDelegationRegistry(false);
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null, circuitBreaker: 'suspended' });
    w.watcher.noteDelegationRegistry(true);
    expect(w.watcher.currentDelegationHealth()!.circuitBreaker).toBe('clear');
  });

  it('tick() tells the lane whether the registry listed, on the tick that measured it', () => {
    const src = watchSrc();
    expect(src).toMatch(/this\.noteDelegationRegistry\(registryRead\.listed\);\s*\n\s*if \(!registryRead\.listed\)/);
  });

  it('the fleet\'s capability is read as of the request: an old fleet makes the gate unmeasured whatever the checkpoint says', async () => {
    const w = world({ ccdVerbs: ['caps', 'ws-rm'] });
    makeOwner(w, 'demo-a');
    await censusPass(w, at(0), { demo: [] });
    expect(w.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'unmeasured', unmeasuredRate: null });
  });

  it('a lost coord.db does not change it: the same checkpoint on a new store reports the same basis', async () => {
    const w = rawTreeWorld();
    for (let i = 0; i < 3; i++) await censusPass(w, at(i), { demo: [OLD, RAW] });
    const before = w.watcher.currentDelegationHealth()!;
    for (const f of ['coord.db', 'coord.db-wal', 'coord.db-shm']) rmSync(path.join(w.ccrcDir, f), { force: true });
    const again = world({ home: w.home });
    setNow(at(3));
    setCensus(again, { demo: [OLD, RAW] }, { 'demo-a': measured() }, at(3));
    await pass(again);
    const after = again.watcher.currentDelegationHealth()!;
    expect(after.measuredSessionHours).toBe(before.measuredSessionHours);
    expect(after.unmeasuredSessionHours).toBe(before.unmeasuredSessionHours);
    expect(after.lastJournalSequence).toBe(before.lastJournalSequence);
    expect(again.coord.readDelegationProjection().leases.map((l) => l.adminRecord)).toEqual(['raw-tree']);   // and SQLite was rebuilt from the checkpoint
  });

  it('a complete window of measured hours is eligible, comes from the CHECKPOINT alone, and survives losing coord.db (W3-M68 at the lane)', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    await censusPass(w, at(0), { demo: [] });
    const nowHour = Date.UTC(2026, 9, 15, 10);
    const rows = Array.from({ length: 168 }, (_, i) => ({
      sessionId: 'demo-a', parentIncarnation: INC, utcHour: iso(nowHour - (i + 1) * DELEGATION_HOUR_MS), state: 'measured' as const, detail: null,
      recordedAt: iso(nowHour - i * DELEGATION_HOUR_MS + 300_000),
    }));
    const applier = await w.watcher.delegationApplier();
    await applier!.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: [...cp.observationIntervals, ...rows] }));
    const before = w.watcher.currentDelegationHealth()!;
    expect(before).toMatchObject({ stageGate: 'eligible', measuredSessionHours: 168, unmeasuredSessionHours: 0, unmeasuredRate: 0, windowStartedAt: iso(nowHour - 168 * DELEGATION_HOUR_MS), windowEndedAt: iso(nowHour) });
    expect(w.coord.readDelegationProjection().observationIntervals, 'SQLite carries no interval').toEqual([]);
    for (const f of ['coord.db', 'coord.db-wal', 'coord.db-shm']) rmSync(path.join(w.ccrcDir, f), { force: true });
    const again = world({ home: w.home });
    await censusPass(again, at(1), { demo: [] });
    expect(again.watcher.currentDelegationHealth()).toMatchObject({ stageGate: 'eligible', measuredSessionHours: 168, unmeasuredSessionHours: 0 });
  });

  it('GET /api/fleet/health carries it as the optional `delegation` member, and omits it when the lane has not run', async () => {
    const w = world();
    makeOwner(w, 'demo-a');
    const deps = { ...testDeps(w.home), cfg: w.cfg, io: w.io, coord: w.coord, fleetState: { connected: true, downSince: null, ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] } };
    const app = await buildServer(deps as never, new Bus(), w.watcher);
    try {
      const body0 = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
      expect('delegation' in body0).toBe(false);
      await censusPass(w, at(0), { demo: [] });
      const body1 = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as { delegation?: Record<string, unknown> };
      expect(body1.delegation).toMatchObject({ mode: 'report-only', stageGate: 'unmeasured' });
    } finally { await app.close(); }
  });
});

// ── 6. a realistic pass, measured (hand-off 2) ──────────────────────────────────────────────────────────────────────────

describe('hand-off 2 and D-4658: one pass over a realistic fixture (20 owners, 2 buckets each)', () => {
  it('applies every bucket in ONE durable application (one checkpoint replacement, one projection), a second pass applies nothing, and the cost is reported', async () => {
    const w = world();
    const owners = Array.from({ length: 20 }, (_, i) => `demo-s${String(i).padStart(2, '0')}`);
    for (const o of owners) {
      writeBucket(w, o, BUCKET09, ...Array.from({ length: 20 }, (_, k) => startLine(o, `2026-10-15T09:${String(10 + k).padStart(2, '0')}:00.000Z`)));
      writeBucket(w, o, BUCKET10, ...Array.from({ length: 20 }, (_, k) => startLine(o, `2026-10-15T10:${String(10 + k).padStart(2, '0')}:00.000Z`)));
    }
    const calls = durableCalls();
    const replaced = vi.spyOn(DelegationDurability.prototype as never as { replaceCheckpoint: (b: Uint8Array) => Promise<void> }, 'replaceCheckpoint');
    const projected = vi.spyOn(DelegationDurability.prototype as never as { projectLocked: (...a: never[]) => Promise<unknown> }, 'projectLocked');
    const repaired = vi.spyOn(DelegationDurability.prototype, 'repairProjection');
    setNow(NOW);
    setCensus(w, { demo: [] }, Object.fromEntries(owners.map((o) => [o, measured()])), NOW);
    const sessions = owners.map((o) => sessionOf(o));
    const t0 = performance.now();
    await pass(w, sessions);
    const firstMs = performance.now() - t0;
    // D-4658: ONE application per pass, carrying all 40 bucket results (the hour 09:00 is closed after its margin only); one checkpoint
    // replacement and one projection for all of it (the pass files no attempt, and the census lists no tree). The reconcile's own
    // `repair-report-projection` effect is a separate step, once per reconciled census, unchanged by D-4658.
    expect(calls.applyAcceptedBatch).toHaveBeenCalledTimes(1);
    expect(calls.applyAcceptedBatch.mock.calls[0]![0]).toHaveLength(40);
    expect(replaced).toHaveBeenCalledTimes(1);
    expect(projected).toHaveBeenCalledTimes(1);
    expect(repaired).toHaveBeenCalledTimes(1);
    expect(disk(w.home).journalLines).toBe(800);
    setNow(NOW + DELEGATION_SWEEP_MS);
    const t1 = performance.now();
    await pass(w, sessions);
    const secondMs = performance.now() - t1;
    expect(calls.applyAcceptedBatch, 'an unchanged fleet was applied again').toHaveBeenCalledTimes(1);
    expect(replaced).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line no-console
    console.info(`delegation lane tick measurement: first pass ${firstMs.toFixed(0)} ms (1 application of 40 bucket results, 800 events), steady pass ${secondMs.toFixed(0)} ms (0 applications); checkpoint ${readFileSync(path.join(w.ccrcDir, DELEGATION_CHECKPOINT_FILE)).length} bytes`);
    expect(firstMs).toBeLessThan(120_000);
  }, 180_000);
});

// ── 7. R24: the server refuses to boot over an active coordination restore marker ─────────────────────────────────────────

describe('boot refusal (R24): an active restore marker, or one that cannot be measured, stops the server before coord.db is opened', () => {
  const fixtureCcrc = (): string => { const dir = path.join(mkTmp('ccrc-boot-'), '.ccrc'); mkdirSync(dir, { recursive: true }); return dir; };
  const refusalOf = (dir: string): string | null => coordinationRestoreRefusal(dir, COORDINATION_RESTORE_MARKER_FILE);

  it('a marker present is a refusal that names the recovery command and says it is the server', () => {
    const dir = fixtureCcrc();
    writeFileSync(path.join(dir, COORDINATION_RESTORE_MARKER_FILE), '{"state":"replacing"}\n');
    const refusal = refusalOf(dir);
    expect(refusal).toMatch(/^ccrc-server: /);
    expect(refusal).toContain('ccrc coordination-snapshot recover');
    expect(refusal).toContain(COORDINATION_RESTORE_MARKER_FILE);
  });

  it('no marker (ENOENT, even when the directory itself does not exist yet) is no refusal', () => {
    expect(refusalOf(fixtureCcrc())).toBeNull();
    expect(refusalOf(path.join(mkTmp('ccrc-boot-'), 'never-made'))).toBeNull();
  });

  it('fail closed: any other answer than "absent" is a refusal, because an unmeasurable marker is not a missing one', () => {
    const base = mkTmp('ccrc-boot-');
    writeFileSync(path.join(base, 'a-file'), 'x');
    const refusal = refusalOf(path.join(base, 'a-file'));         // the "directory" is a file: ENOTDIR, not ENOENT
    expect(refusal).toMatch(/^ccrc-server: /);
    expect(refusal).toContain('could not be measured');
    expect(refusal).toContain('ccrc coordination-snapshot recover');
  });

  it('a marker that is a directory or a dangling link is still a marker', () => {
    const dir = fixtureCcrc();
    mkdirSync(path.join(dir, COORDINATION_RESTORE_MARKER_FILE));
    expect(refusalOf(dir)).not.toBeNull();
    const dir2 = fixtureCcrc();
    symlinkSync('/nonexistent-target-of-a-fixture-link', path.join(dir2, COORDINATION_RESTORE_MARKER_FILE));
    expect(refusalOf(dir2)).not.toBeNull();
  });

  it('index.ts checks it BEFORE the line that opens coord.db, says it with console.error, and exits nonzero', () => {
    const src = readFileSync(path.join(srcRoot, 'index.ts'), 'utf8');
    const check = src.indexOf('coordinationRestoreRefusal(');
    const open = src.indexOf('new CoordStore(openCoordDb(');
    expect(check).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
    expect(check, 'the refusal must come first').toBeLessThan(open);
    const block = src.slice(check - 200, check + 400);
    expect(block).toMatch(/console\.error\(/);
    expect(block).toMatch(/process\.exit\(1\)/);
  });

  it('the real server process exits 1 with the refusal on stderr and never opens coord.db', async () => {
    const home = mkTmp('ccrc-boot-home-');
    seedRoster(home);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', COORDINATION_RESTORE_MARKER_FILE), '{"state":"replacing"}\n');
    const tsx = path.resolve(__dirname, '../node_modules/.bin/tsx');
    // A process GROUP of its own (`tsx` runs the server as its child), so that a server that did NOT refuse to boot, and would be left
    // listening, is killed whole: only the PIDs this test started are ever signalled.
    const child = spawn(tsx, [path.resolve(srcRoot, 'index.ts')], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        PATH: process.env['PATH'] ?? '', HOME: home, CCRC_HOME: home, CCRC_PORT: String(23000 + (process.pid % 3000)), CCRC_HOST: '127.0.0.1',
        // Fail-safe insurance for a mutant that disables the refusal: a server that DID boot would find a fixture tmux directory, never
        // the caller's default tmux socket (M7).
        TMUX_TMPDIR: mkTmp('ccrc-boot-tmux-'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.stdout.on('data', () => {});
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { killGroup(); resolve(null); }, 30_000);
      child.on('exit', (c) => { clearTimeout(timer); killGroup(); resolve(c); });
    });
    expect(code, `stderr: ${stderr}`).toBe(1);
    expect(stderr).toContain('ccrc coordination-snapshot recover');
    expect(existsSync(path.join(home, '.ccrc', 'coord.db'))).toBe(false);
  }, 60_000);
});

// ── the final fix of wave 3 (final review I-1 and M-1; Task 13 N20) ─────────────────────────────────────────────────────

describe('final review I-1: a restart never re-creates an evicted-session veto as a link', () => {
  // `demo-a`'s call [10:05:01, 10:05:02] is inside `demo-b`'s, which created raw-tree [10:05:00, 10:05:03]: held in full, unresolved. After a
  // restart with `demo-a` gone from the registry (a reclaimed child, a forgotten session) the lane cannot name `demo-a`'s project.
  function overlapWorld(aWindow: readonly [string, string] = ['2026-10-15T10:05:01.000Z', '2026-10-15T10:05:02.000Z']): World {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, bashPre('demo-a', 'toolu_o1', ['old-tree'], aWindow[0]), bashPost('demo-a', 'toolu_o1', ['old-tree'], aWindow[1]));
    writeBucket(w, 'demo-b', BUCKET10,
      bashPre('demo-b', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'), bashPost('demo-b', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'));
    return w;
  }
  const census = { demo: [OLD, RAW] };
  const both = [sessionOf('demo-a'), sessionOf('demo-b')];
  const onlyB = [sessionOf('demo-b')];
  /** The first lane sees both sessions and makes no lease; then `demo-a` leaves the registry and the server restarts. */
  async function restarted(aWindow?: readonly [string, string], passes = 4): Promise<World> {
    const first = overlapWorld(aWindow);
    for (let i = 0; i < passes; i++) await censusPass(first, at(i), census, both);
    expect(leasesOf(first.home), 'control: held in full, no lease').toEqual([]);
    await first.watcher.closeDelegation();
    return world({ home: first.home });
  }

  it('SAFETY (FINALRV-P1): the unknown session\'s window still vetoes: no lease and no attempt, pass after pass past an hour, counted as `window`', async () => {
    const again = await restarted();
    for (let i = 4; i < 8; i++) await censusPass(again, at(i), census, onlyB);
    for (const minute of [70, 71, 130]) await censusPass(again, NOW + minute * 60_000, census, onlyB);
    expect(leasesOf(again.home), 'a restart dropped the overlap veto of a session no longer in the registry').toEqual([]);
    expect(attemptsOf(again.home)).toEqual([]);
    expect(again.watcher.delegationReport().verdicts).toEqual({ unresolved: 2, conflicting: 0, unmeasured: 0 });
    expect(again.watcher.delegationReport().marks.forced, 'counted apart from every other mark').toMatchObject({ window: 1, path: 0, id: 0, project: 0, lossy: 0, prefix: 0 });
  });

  it('LIVENESS: a registry row naming the session\'s project again clears it: under another project the tree links; under the same one the overlap stands', async () => {
    const again = await restarted();
    for (let i = 4; i < 7; i++) await censusPass(again, at(i), census, onlyB);
    expect(leasesOf(again.home)).toEqual([]);
    await censusPass(again, at(7), census, onlyB, [recordOf('demo-b'), recordOf('demo-a', 'demo')]);
    expect(leasesOf(again.home), 'the same project: the full evidence\'s answer, unresolved').toEqual([]);
    await censusPass(again, at(8), census, onlyB, [recordOf('demo-b'), recordOf('demo-a', 'other')]);
    expect(leasesOf(again.home).map((l) => [l.adminRecord, l.parentId]), 'another project: no veto on this repository').toEqual([['raw-tree', 'demo-b']]);
  });

  it('LIVENESS: an unknown window that does not overlap the creator\'s in time leaves the link possible', async () => {
    const again = await restarted(['2026-10-15T10:06:00.000Z', '2026-10-15T10:06:01.000Z'], 1);    // ingested; still inside the birth wait
    for (let i = 4; i < 8; i++) await censusPass(again, at(i), census, onlyB);
    expect(leasesOf(again.home).map((l) => [l.adminRecord, l.parentId])).toEqual([['raw-tree', 'demo-b']]);
  });
});

describe('Task 13 N20 (coordinator 5439): the projects root is RESOLVED before the attribution compares paths', () => {
  /** demo-a reports five directories under `dir`, none of them a tree; the slice's cap of 3 evicts two, and a measured census forgets them
   *  with path marks. */
  const farUnder = (w: World, dir: string, from = 0, count = 5): void => {
    const lines = Array.from({ length: count }, (_, i) => lineOf(common('demo-a', {
      eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_far${from + i}`, outcome: 'completed', cwd: `${dir}/far-${from + i}`,
    }, `2026-10-15T10:0${Math.floor((from + i) / 6)}:${String(((from + i) % 6) * 5).padStart(2, '0')}.000Z`)));
    if (existsSync(bucketFile(w, 'demo-a', BUCKET10))) appendBucket(w, 'demo-a', BUCKET10, ...lines);
    else writeBucket(w, 'demo-a', BUCKET10, ...lines);
  };

  it('a SYMLINKED projects root (the documented layout): the marks under its physical path are attributed to their project', async () => {
    const w = world();
    const phys = mkTmp('ccrc-dlane-physroot-');
    const link = path.join(mkTmp('ccrc-dlane-linkroot-'), 'projects');
    symlinkSync(phys, link);
    (w.cfg as { projectsRoot: string }).projectsRoot = link;
    farUnder(w, `${phys}/demo`);
    w.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
    await censusPass(w, at(0), { demo: [] });
    const r = w.watcher.delegationReport();
    expect(r.projectsRoot).toBe('resolved');
    expect(r.marks.paths, 'two directories forgotten').toBe(2);
    expect(r.marks.unattributedPaths, 'the configured (logical) spelling would attribute none of them').toBe(0);
  });

  it('a root that does not resolve: attribution by the root is UNMEASURED (never the configured spelling), and the next pass resolves it again', async () => {
    const w = world();
    const root = w.cfg.projectsRoot;
    const realpath = w.io.realpath;
    w.io.realpath = async () => null;                                       // the remote io, or a root that cannot be resolved this pass
    farUnder(w, `${root}/demo`);
    w.watcher.setDelegationSeams({ evidenceCap: 3, droppedPruneEvery: 1 });
    await censusPass(w, at(0), { demo: [] });
    let r = w.watcher.delegationReport();
    expect(r.projectsRoot).toBe('unmeasured');
    expect(r.marks.paths).toBe(2);
    expect(r.marks.unattributedPaths, 'attributed to no project: never by a spelling git may not report').toBe(2);
    w.io.realpath = realpath;
    farUnder(w, `${root}/demo`, 5, 2);
    await censusPass(w, at(1), { demo: [] });
    r = w.watcher.delegationReport();
    expect(r.projectsRoot, 'retried on the next pass').toBe('resolved');
    expect(r.marks.paths).toBe(4);
    expect(r.marks.unattributedPaths, 'the new marks are attributed').toBe(2);
  });
});

describe('final review M-1: after a recovery or a failed evidence load the verdict counts are unknown, never an earlier pass\'s', () => {
  const census = { demo: [OLD, RAW] };
  const counts = (w: World) => { const h = w.watcher.currentDelegationHealth()!; return { breaker: h.circuitBreaker, unresolved: h.unresolved, conflicting: h.conflicting, unmeasured: h.unmeasured }; };
  const UNKNOWN = { breaker: 'unmeasured', unresolved: 0, conflicting: 0, unmeasured: 0 };

  it('an applier found failed, a recovery, then a load that fails: unmeasured with 0 throughout, until a reconcile vouches again', async () => {
    const w = rawTreeWorld();
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), census);
    expect(counts(w)).toEqual({ breaker: 'clear', unresolved: 1, conflicting: 0, unmeasured: 0 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = vi.spyOn(DelegationDurability.prototype, 'failure').mockReturnValue({ code: 'journal-unreadable', detail: 'a fixture failure' } as never);
    await censusPass(w, at(4), census);
    expect(counts(w), 'the applier is failed: what was counted is not this state\'s').toEqual(UNKNOWN);
    await censusPass(w, at(10), census);                                    // past the retry interval: recover() runs
    expect(counts(w)).toEqual(UNKNOWN);
    failed.mockRestore();
    const visit = vi.spyOn(DelegationDurability.prototype, 'visitRetainedRecords').mockRejectedValue(new Error('journal read failed'));
    await censusPass(w, at(11), census);
    expect(w.watcher.delegationReport().droppedEvidence.measured).toBe(false);
    expect(counts(w), 'the load failed: nothing is reconciled, so nothing is vouched for').toEqual(UNKNOWN);
    visit.mockRestore();
    await censusPass(w, at(12), census);
    expect(counts(w), 'a reconcile vouches again').toEqual({ breaker: 'clear', unresolved: 1, conflicting: 0, unmeasured: 0 });
  });

  it('a reconcile older than three census cadences no longer vouches for its counts', async () => {
    const w = rawTreeWorld();
    for (let i = 0; i < 4; i++) await censusPass(w, at(i), census);
    setNow(at(3) + 3 * STEP);
    expect(counts(w).breaker, 'three cadences: still vouched for').toBe('clear');
    setNow(at(3) + 3 * STEP + 1);
    expect(counts(w)).toEqual(UNKNOWN);
  });
});

describe('D-4658 (ruling R79): one durable application per pass, with per-bucket semantics unchanged', () => {
  // Four owners in id order: `demo-a` (two hours), `demo-b/x` (an owner the reader refuses: `input-invalid`, never applied), `demo-c`, and
  // `demo-d`, whose bucket is cut below its cursor on the second pass (replaced, sticky). Run twice, batched and unbatched.
  const owners = ['demo-a', 'demo-b/x', 'demo-c', 'demo-d'];
  const sessions = owners.map((o) => sessionOf(o));
  function fixture(seams: Parameters<FleetWatcher['setDelegationSeams']>[0]): World {
    const w = world();
    w.watcher.setDelegationSeams(seams);
    writeBucket(w, 'demo-a', BUCKET09, startLine('demo-a', '2026-10-15T09:10:00.000Z'), startLine('demo-a', '2026-10-15T09:20:00.000Z'));
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'));
    writeBucket(w, 'demo-c', BUCKET10, startLine('demo-c', '2026-10-15T10:02:00.000Z'), startLine('demo-c', '2026-10-15T10:03:00.000Z'));
    writeBucket(w, 'demo-d', BUCKET10, startLine('demo-d', '2026-10-15T10:04:00.000Z'), startLine('demo-d', '2026-10-15T10:05:00.000Z'));
    return w;
  }
  const passAt = async (w: World, n: number): Promise<void> => {
    setNow(at(n));
    setCensus(w, { demo: [] }, Object.fromEntries(owners.map((o) => [o, measured()])), at(n));
    await pass(w, sessions);
  };
  async function run(seams: Parameters<FleetWatcher['setDelegationSeams']>[0], between?: (w: World) => void): Promise<World> {
    const w = fixture(seams);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await passAt(w, 0);
    writeFileSync(bucketFile(w, 'demo-d', BUCKET10), startLine('demo-d', '2026-10-15T10:04:00.000Z').slice(0, 20));   // cut below the cursor
    appendBucket(w, 'demo-c', BUCKET10, startLine('demo-c', '2026-10-15T10:06:00.000Z'));
    between?.(w);
    await passAt(w, 1);
    return w;
  }
  const outcome = (w: World) => {
    const cp = disk(w.home).checkpoint!;
    return {
      journal: readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8'),
      rows: canonicalDelegationJson({ ...cp, revision: 0 }),
      projection: canonicalDelegationJson(w.coord.readDelegationProjection()),
    };
  };

  it('ROWS: batched and unbatched leave the same journal, checkpoint rows and SQLite, the input-invalid bucket and the replaced one included', async () => {
    const batched = await run({});
    const unbatched = await run({ unbatched: true });
    expect(outcome(batched)).toEqual(outcome(unbatched));
    const cp = disk(batched.home).checkpoint!;
    expect(cp.observationIntervals.some((r) => r.sessionId === 'demo-b/x'), 'an input-invalid result is never applied').toBe(false);
    expect(cp.bucketCursors.find((c) => c.sessionId === 'demo-d')).toMatchObject({ replaced: true });
    expect(cp.bucketCursors.find((c) => c.sessionId === 'demo-c')!.cursor).toBe(readFileSync(bucketFile(batched, 'demo-c', BUCKET10)).length);
  });

  it('R82 (c): a failure AFTER the first byte still fails the applier closed and stops the WHOLE pass; once recovered, the next pass re-reads every bucket to the same state', async () => {
    const reference = await run({});
    const w = fixture({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // the checkpoint replacement fails once: the journal records were written (and fsynced) first, so this is after the first byte
    vi.spyOn(DelegationDurability.prototype as never as { replaceCheckpoint: (b: Uint8Array) => Promise<void> }, 'replaceCheckpoint')
      .mockImplementationOnce(async () => { throw new Error('EIO: a fixture fault at the checkpoint rename'); });
    await passAt(w, 0);
    const durable = (await w.watcher.delegationApplier())!;
    expect(durable.failure(), 'failed closed').not.toBeNull();
    expect(disk(w.home).checkpoint?.bucketCursors ?? [], 'no bucket advanced: the whole pass stopped').toEqual([]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('failed after it began writing'))).toBe(true);
    await passAt(w, 6);                                                    // past the recovery interval: recovered, and every bucket re-read
    expect(durable.failure()).toBeNull();
    expect(disk(w.home).journalLines, "every staged record: the crash's own, replayed, and nothing twice").toBe(7);
    writeFileSync(bucketFile(w, 'demo-d', BUCKET10), startLine('demo-d', '2026-10-15T10:04:00.000Z').slice(0, 20));
    appendBucket(w, 'demo-c', BUCKET10, startLine('demo-c', '2026-10-15T10:06:00.000Z'));
    await passAt(w, 7);
    // the same records (their acceptance instants are the passes' own) and the same cursors as a run whose first pass did not fail
    const eventsOf = (home: string) => readFileSync(path.join(home, '.ccrc', DELEGATION_JOURNAL_FILE), 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => (JSON.parse(l) as { entry: { event: { eventId: string } } }).entry.event.eventId);
    expect(eventsOf(w.home)).toEqual(eventsOf(reference.home));
    const coordinates = (home: string) => disk(home).checkpoint!.bucketCursors.map((c) => [c.sessionId, c.bucket, c.cursor, c.lastSize, c.replaced, c.anchor]);
    expect(coordinates(w.home)).toEqual(coordinates(reference.home));
  });

  it('an hour is remembered as settled only once the pass\'s application is durable: a failed one leaves its close write to the next pass', async () => {
    const w = world();
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    const closeAt = Date.parse(HOUR10) + DELEGATION_HOUR_MS + DELEGATION_HOUR_CLOSE_MARGIN_MS;
    expect(Date.parse(intervalFor(w.home, 'demo-a')!.recordedAt), 'recorded while the hour was open').toBeLessThan(closeAt);
    vi.spyOn(DelegationDurability.prototype as never as { replaceCheckpoint: (b: Uint8Array) => Promise<void> }, 'replaceCheckpoint')
      .mockImplementationOnce(async () => { throw new Error('EIO: a fixture fault at the checkpoint rename'); });
    setNow(closeAt + 60_000);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, closeAt + 60_000);
    await pass(w);                                                         // the close write is staged, and the application fails closed
    expect(Date.parse(intervalFor(w.home, 'demo-a')!.recordedAt)).toBeLessThan(closeAt);
    setNow(closeAt + 60_000 + DELEGATION_SWEEP_MS);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, closeAt + 60_000 + DELEGATION_SWEEP_MS);
    await pass(w);
    expect(Date.parse(intervalFor(w.home, 'demo-a')!.recordedAt), 'the next pass made the close write: the hour was not settled').toBeGreaterThanOrEqual(closeAt);
  });

  /** R82: a REAL pre-write refusal for one owner's result: its cursor is handed to the real applier with an anchor past the cursor, which
   *  the checkpoint's own `readCursor` refuses before anything is written (the applier stays ready). */
  const poison = (owner: string) => {
    const real = DelegationDurability.prototype.applyAcceptedBatch;
    return vi.spyOn(DelegationDurability.prototype, 'applyAcceptedBatch').mockImplementation(function (this: DelegationDurability, batches) {
      return real.call(this, batches.map((b) => (b.cursor !== null && b.cursor.sessionId === owner
        ? { ...b, cursor: { ...b.cursor, anchor: { start: b.cursor.cursor + 1, sha256: 'a'.repeat(64) } } } : b)));
    });
  };
  const threeOwners = (seams: Parameters<FleetWatcher['setDelegationSeams']>[0], withPoison: boolean): World => {
    const w = world();
    w.watcher.setDelegationSeams(seams);
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a', '2026-10-15T10:01:00.000Z'), startLine('demo-a', '2026-10-15T10:02:00.000Z'));
    if (withPoison) writeBucket(w, 'demo-p', BUCKET10, startLine('demo-p', '2026-10-15T10:03:00.000Z'), startLine('demo-p', '2026-10-15T10:04:00.000Z'));
    writeBucket(w, 'demo-c', BUCKET10, startLine('demo-c', '2026-10-15T10:05:00.000Z'), startLine('demo-c', '2026-10-15T10:06:00.000Z'));
    return w;
  };
  const passOver = async (w: World, n: number, ids: readonly string[]): Promise<void> => {
    setNow(at(n));
    setCensus(w, { demo: [] }, Object.fromEntries(ids.map((o) => [o, measured()])), at(n));
    await pass(w, ids.map((o) => sessionOf(o)));
  };

  it('R82 (a): a refused result among valid ones: the valid ones are durable in THAT pass, exactly as unbatched, and the refused one has its warn line, no cursor and no interval', async () => {
    const reference = threeOwners({ unbatched: true }, false);
    await passOver(reference, 0, ['demo-a', 'demo-c']);
    vi.restoreAllMocks();
    const w = threeOwners({}, true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    poison('demo-p');
    await passOver(w, 0, ['demo-a', 'demo-c', 'demo-p']);
    expect((await w.watcher.delegationApplier())!.failure(), 'a refusal never fails the applier').toBeNull();
    const cp = disk(w.home).checkpoint!;
    expect(cp.bucketCursors.map((c) => c.sessionId).sort()).toEqual(['demo-a', 'demo-c']);
    expect(cp.observationIntervals.some((r) => r.sessionId === 'demo-p'), 'no interval of its own').toBe(false);
    expect(readFileSync(path.join(w.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8')).toBe(readFileSync(path.join(reference.ccrcDir, DELEGATION_JOURNAL_FILE), 'utf8'));
    expect(canonicalDelegationJson({ ...cp, revision: 0 })).toBe(canonicalDelegationJson({ ...disk(reference.home).checkpoint!, revision: 0 }));
    expect(canonicalDelegationJson(w.coord.readDelegationProjection())).toBe(canonicalDelegationJson(reference.coord.readDelegationProjection()));
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('refused before anything was written'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ccrc-server: delegation bucket demo-p\/2026101510 was refused before anything was written: /);
  });

  it('R82 (b): a STANDING refusal across several passes: every other bucket keeps advancing, and the refused one costs one small application a pass, never a bisection', async () => {
    const w = threeOwners({}, true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = poison('demo-p');
    const ids = ['demo-a', 'demo-c', 'demo-p'];
    const cursorA = (): number => disk(w.home).checkpoint!.bucketCursors.find((c) => c.sessionId === 'demo-a')!.cursor;
    await passOver(w, 0, ids);
    const seen: number[] = [cursorA()];
    for (let n = 1; n <= 3; n++) {
      appendBucket(w, 'demo-a', BUCKET10, startLine('demo-a', `2026-10-15T10:1${n}:00.000Z`));
      appendBucket(w, 'demo-p', BUCKET10, startLine('demo-p', `2026-10-15T10:1${n}:30.000Z`));
      const before = calls.mock.calls.length;
      await passOver(w, n, ids);
      expect(calls.mock.calls.length - before, `pass ${n}: the standing refusal alone, then the rest as one`).toBe(2);
      seen.push(cursorA());
      expect(seen[n]!, `pass ${n}: demo-a advanced`).toBeGreaterThan(seen[n - 1]!);
    }
    expect(disk(w.home).checkpoint!.bucketCursors.some((c) => c.sessionId === 'demo-p')).toBe(false);
  });

  it('cursors only move forward across batched passes, and a replaced bucket stays replaced when it grows again', async () => {
    const w = fixture({});
    const seen: number[] = [];
    const cursorD = () => disk(w.home).checkpoint?.bucketCursors.find((c) => c.sessionId === 'demo-d');
    await passAt(w, 0);
    seen.push(cursorD()!.cursor);
    appendBucket(w, 'demo-d', BUCKET10, startLine('demo-d', '2026-10-15T10:07:00.000Z'));
    await passAt(w, 1);
    seen.push(cursorD()!.cursor);
    writeFileSync(bucketFile(w, 'demo-d', BUCKET10), startLine('demo-d', '2026-10-15T10:04:00.000Z').slice(0, 20));
    await passAt(w, 2);
    seen.push(cursorD()!.cursor);
    expect(cursorD()!.replaced).toBe(true);
    writeFileSync(bucketFile(w, 'demo-d', BUCKET10), Array.from({ length: 6 }, (_, i) => startLine('demo-d', `2026-10-15T10:1${i}:00.000Z`)).join(''));
    await passAt(w, 3);
    seen.push(cursorD()!.cursor);
    expect(cursorD()!.replaced, 'sticky').toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!, `pass ${i}`).toBeGreaterThanOrEqual(seen[i - 1]!);
  });
});

describe('how session-hours count toward spec §5.3\'s gate (coordinator 5443): measured from the code, no behaviour change', () => {
  const hoursOf = (w: World) => { const h = w.watcher.currentDelegationHealth()!; return { measured: h.measuredSessionHours, unmeasured: h.unmeasuredSessionHours }; };

  it('(a) a home with NO hook registered: ccd still made its session\'s spool directory, which holds no bucket, so the hour is MEASURED-EMPTY (in the denominator, as measured)', async () => {
    const w = world();
    makeOwner(w, 'demo-a');                                          // ccd makes the owner directory at spawn; no hook ever writes a bucket
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w);
    expect(intervalFor(w.home, 'demo-a'), 'measured, with no evidence: indistinguishable from a quiet session').toMatchObject({ state: 'measured', detail: null });
    expect(disk(w.home).journalLines).toBe(0);
    const cp = disk(w.home).checkpoint!;
    expect(cp.observationIntervals.filter((r) => r.sessionId === 'demo-a').map((r) => r.state)).toEqual(['measured']);
    expect(hoursOf(w).unmeasured, 'nothing about it is unmeasured').toBe(0);
  });

  it('(b) a session the lane never saw live: its spool is never read, it has no interval, and its hours are in NEITHER count (not in the denominator)', async () => {
    const w = world();
    writeBucket(w, 'demo-gone', BUCKET10, startLine('demo-gone'));      // born and gone while the lane was not running
    writeBucket(w, 'demo-a', BUCKET10, startLine('demo-a'));
    setNow(NOW);
    setCensus(w, { demo: [] }, { 'demo-a': measured() }, NOW);
    await pass(w, [sessionOf('demo-a')], [recordOf('demo-a'), recordOf('demo-gone')]);
    expect(w.calls.listings, 'its owner directory is never listed').not.toContain('demo-gone');
    expect(intervalsOf(w.home).some((r) => r.sessionId === 'demo-gone'), 'no interval at all').toBe(false);
    expect(intervalFor(w.home, 'demo-a')).toMatchObject({ state: 'measured' });
  });
});
