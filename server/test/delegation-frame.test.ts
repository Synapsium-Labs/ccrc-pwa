// Delegation broker wave 4, PR1 Task 1.3: the lane's projection and the watcher's `delegation` emit (L4).
//
// After a delegation pass that RAN, the watcher reads the narrow run stamps, asks the lane for its projection (decided in L1,
// `projectDelegation`) and broadcasts it on the bus when its content changed (`asOf` excluded). An absent frame is "unavailable": the
// lane withholds a projection until two reconciles, a listed registry and a ready applier, and a lane that can no longer project
// WITHDRAWS a frame it sent (one `null`). W4-W7 and W4-W8 drive the lane directly (`sweepDelegation`, an unlisted registry noted by
// hand); W4-W10 drives `tick()`, which returns on an unlistable registry before any lane runs and withdraws there. Rows W4-W1 to
// W4-W10; mutants W4-M05, W4-M02b, W4-M20, W4-M10, W4-M12, W4-M17, W4-M18, W4-M26 (W4-M24 retired with `workdir`, D-7006).
//
// THE RIG IS COPIED, minimally, from `delegation-watch.test.ts` (`world`, `setCensus`, `censusPass`, `primed`, `rawTreeWorld`, `bashPre`,
// `bashPost`), which is follow-up 10's file and is not edited here; `bus` is kept on the `World`. Folding the two into one shared helper is
// a rider item, after #1558 lands. Fixture HOMEs only: no live file is read.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { DelegationProjectionWire, FleetSession } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { capsMeasured } from '../src/coord/dispatch.js';
import type { DelegationCensusPass, ParentIncarnation, WorktreeCensus } from '../src/coord/gitref.js';
import { DELEGATION_EVENTS_CAP, type DelegationCensusRecord } from '../src/coord/delegation-model.js';
import { DELEGATION_PROJECTION_CLOSED_RUNS } from '../src/coord/delegation-projection.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.UTC(2026, 9, 15, 10, 30, 0);
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const BUCKET10 = '2026101510';
const STEP = DELEGATION_SWEEP_MS;
const at = (n: number): number => NOW + n * STEP;
const PRIMED_AT = Date.UTC(2026, 9, 15, 10, 0, 30);

const worlds: Array<{ watcher: FleetWatcher }> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map((w) => w.watcher.closeDelegation().catch(() => undefined)));
});

interface World {
  home: string;
  cfg: ReturnType<typeof loadConfig>;
  watcher: FleetWatcher;
  coord: CoordStore;
  bus: Bus;
  /** Every `delegation` value the bus carried, in order. */
  frames: Array<DelegationProjectionWire | null>;
  /** While true, the registry directory does not list (`io.readdir` answers null), as `tick()` meets an unlistable registry. */
  unlisted: boolean;
}

const sessionOf = (id: string, status: 'idle' | 'busy' | 'dead' = 'idle', project = 'demo') =>
  ({ id, project, status, stoppedBy: null as FleetSession['stoppedBy'], archivedAt: null as FleetSession['archivedAt'] });
const recordOf = (id: string, project = 'demo') => ({ id, project, child: { kind: 'none' as const } });
type Sess = ReturnType<typeof sessionOf>;

function world(opts: { coord?: boolean } = {}): World {
  const home = mkTmp('ccrc-dframe-');
  const projectsRoot = mkTmp('ccrc-dframe-projects-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const flags = { unlisted: false };
  const io: FleetIO = { ...localIO, readdir: async (p, t) => (flags.unlisted && p === cfg.registryDir ? null : localIO.readdir(p, t)) };
  const deps = {
    ...testDeps(home), monotonicMs: () => Date.now(), cfg, io, ...(opts.coord === false ? {} : { coord }),
    fleetState: { connected: true, downSince: null, ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] },
  };
  const bus = new Bus();
  const frames: Array<DelegationProjectionWire | null> = [];
  bus.on('delegation', (d) => { frames.push(d); });
  const made: World = {
    home, cfg, watcher: new FleetWatcher(deps as never, bus, 10_000), coord, bus, frames,
    get unlisted() { return flags.unlisted; }, set unlisted(v: boolean) { flags.unlisted = v; },
  };
  worlds.push(made);
  return made;
}

const spoolDir = (w: World, owner: string): string => path.join(w.cfg.registryDir, 'delegation', 'spool', owner);
const lineOf = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const common = (owner: string, extra: Record<string, unknown>, atIso: string) =>
  ({ v: 1, observedAt: atIso, sessionId: owner, parentIncarnation: INC, claudeSessionId: CLAUDE, ...extra });
const writeBucket = (w: World, owner: string, bucket: string, ...lines: string[]): void => {
  mkdirSync(spoolDir(w, owner), { recursive: true });
  writeFileSync(path.join(spoolDir(w, owner), `${bucket}.spool`), lines.join(''));
};
const startLine = (owner: string, atIso: string): string => lineOf(common(owner, { eventKind: 'SessionStart', source: 'startup' }, atIso));
const bashPre = (owner: string, toolUseId: string, listing: string[], atIso: string, cwd = '/w/demo'): string =>
  lineOf(common(owner, { eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing, cwd }, atIso));
const bashPost = (owner: string, toolUseId: string, listing: string[], atIso: string, cwd = '/w/demo'): string =>
  lineOf(common(owner, { eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing, cwd }, atIso));

const record = (project: string, adminRecord: string): DelegationCensusRecord => ({
  project, adminRecord, canonicalPath: `/w/${project}/.claude/worktrees/${adminRecord}`, headBranch: null, headSha: 'a'.repeat(40),
  claudeBase: 'b'.repeat(40), locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null,
});
const RAW = record('demo', 'raw-tree');
const OLD = record('demo', 'old-tree');
const CENSUS = { demo: [OLD, RAW] };

function setCensus(w: World, projects: Record<string, DelegationCensusRecord[]>, incarnations: Record<string, ParentIncarnation>, measuredAt: number): void {
  const view = (recs: DelegationCensusRecord[]): WorktreeCensus => ({ read: { ok: true, records: [] }, delegation: recs });
  const pass: DelegationCensusPass = {
    measuredAt, projects: new Map(Object.entries(projects).map(([p, recs]) => [p, view(recs)] as const)),
    incarnations: new Map(Object.entries(incarnations)),
  };
  (w.watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = pass;
}
const setNow = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
const measured = (): ParentIncarnation => ({ kind: 'measured', incarnation: INC });
const sweep = (w: World, sessions: readonly Sess[]): Promise<void> =>
  w.watcher.sweepDelegation(sessions as never, sessions.map((s) => recordOf(s.id, s.project)) as never);
/** One whole pass at `t`, with a census taken at `t`. */
const censusPass = async (w: World, t: number, sessions: readonly Sess[] = [sessionOf('demo-a')], census = CENSUS): Promise<void> => {
  setNow(t);
  setCensus(w, census, Object.fromEntries(sessions.map((s) => [s.id, measured()])), t);
  await sweep(w, sessions);
};
const primed = async (w: World): Promise<World> => {
  setNow(PRIMED_AT);
  setCensus(w, {}, {}, PRIMED_AT);
  await sweep(w, []);
  return w;
};
/** The incident's case: `demo-a` ran a raw `git worktree add`; its before and after listings differ by the one new record. */
async function rawTreeWorld(): Promise<World> {
  const w = world();
  writeBucket(w, 'demo-a', BUCKET10,
    startLine('demo-a', '2026-10-15T10:01:00.000Z'),
    bashPre('demo-a', 'toolu_wt1', ['old-tree'], '2026-10-15T10:05:00.000Z'),
    bashPost('demo-a', 'toolu_wt1', ['old-tree', 'raw-tree'], '2026-10-15T10:05:03.000Z'));
  return primed(w);
}
/** W4-W1's three passes: the raw tree is waited on twice, then leased. */
async function leasedWorld(sessions: readonly Sess[] = [sessionOf('demo-a')], census = CENSUS): Promise<World> {
  const w = await rawTreeWorld();
  for (const n of [0, 1, 2]) await censusPass(w, at(n), sessions, census);
  return w;
}
const EMPTY = { activities: [], leases: [], unowned: [] };
const RAW_ROW = {
  parentId: 'demo-a', via: null, group: 'parent', sourceKind: 'raw', adminRecord: 'raw-tree', workspace: 'present', liveness: 'ended',
  inferred: { creator: { kind: 'bash-call', toolUseId: 'toolu_wt1' } },
};

describe('the delegation frame: projected after a pass that ran, broadcast on a change', () => {
  it('W4-W1 (the incident, end to end): an empty measured frame once the gate opens, then the raw lease, nested and marked inferred', async () => {
    const w = await leasedWorld();
    const now = w.watcher.currentDelegation()!;
    expect(now.leases).toHaveLength(1);
    expect(now.leases[0]).toMatchObject(RAW_ROW);
    expect(now.activities).toEqual([]);
    expect(w.frames).toHaveLength(2);
    expect(w.frames[0]).toMatchObject({ ...EMPTY, asOf: new Date(at(0)).toISOString() });
    expect(w.frames[1]).toMatchObject({ asOf: new Date(at(2)).toISOString() });
    expect(w.frames.at(-1)).toEqual(now);
  });

  it('W4-W2 (absent is unavailable): one census pass withholds the frame; without a coordination database there is none', async () => {
    const w = world();
    await censusPass(w, at(0));
    expect(w.watcher.currentDelegation()).toBeNull();
    expect(w.frames).toEqual([]);
    const bare = world({ coord: false });
    await censusPass(bare, at(0));
    await censusPass(bare, at(1));
    expect(bare.watcher.currentDelegation()).toBeNull();
    expect(bare.frames).toEqual([]);
  });

  it('W4-W3 (byte-equal dedupe): an unchanged projection is not re-sent though asOf moved; a parent leaving the registry is a change', async () => {
    const w = await leasedWorld();
    await censusPass(w, at(3));
    expect(w.frames).toHaveLength(2);
    expect(w.watcher.currentDelegation()!.asOf).toBe(new Date(at(2)).toISOString());
    await censusPass(w, at(4), []);
    expect(w.frames).toHaveLength(3);
    expect(w.frames[2]!.leases.map((l) => [l.parentId, l.group])).toEqual([['demo-a', 'offline-coordinator']]);
  });

  it('W4-W4 (refused pass): a sweep inside the cadence, which the lane refuses, sends nothing even when the projection would differ', async () => {
    const w = await leasedWorld();
    setNow(at(2) + 1);
    await sweep(w, []);
    expect(w.frames).toHaveLength(2);
  });

  it('W4-W5 (closed runs are read, narrowly): the emit reads the run stamps, never runs(); a refused read skips the frame with one warning', async () => {
    const w = await rawTreeWorld();
    const opened = w.coord.openRun({ program: 'program-a', title: 'run-a', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-c' });
    if (!('id' in opened)) throw new Error('openRun refused');
    w.coord.bindSession(opened.id, 'demo-w');
    expect(w.coord.advance(opened.id, 'failed', 'test-close').ok).toBe(true);
    const stamps = vi.spyOn(w.coord, 'delegationRunStamps');
    const runs = vi.spyOn(w.coord, 'runs');
    for (const n of [0, 1, 2]) await censusPass(w, at(n));
    expect(stamps).toHaveBeenCalledWith(DELEGATION_PROJECTION_CLOSED_RUNS);
    expect(runs).not.toHaveBeenCalled();
    const answer = stamps.mock.results.at(-1)!.value as { ok: true; runs: { id: number; sessionId: string | null; closedAt: number | null }[] };
    expect(answer.ok).toBe(true);
    expect(answer.runs.find((r) => r.id === opened.id)).toMatchObject({ sessionId: 'demo-w', claimedBy: 'demo-c' });
    expect(answer.runs.find((r) => r.id === opened.id)!.closedAt).not.toBeNull();
    const before = w.frames.length;
    const last = w.watcher.currentDelegation();
    stamps.mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'x' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await censusPass(w, at(3), []);
    expect(w.frames).toHaveLength(before);
    expect(w.watcher.currentDelegation()).toBe(last);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('delegation frame'))).toHaveLength(1);
  });

  it('W4-W6 (leases consume no run slot): the lease is in the store, and the cap counts no running run', async () => {
    const w = await leasedWorld();
    expect(w.coord.readDelegationProjection().leases).toHaveLength(1);
    expect(capsMeasured(w.coord).usage.running).toBe(0);
  });

  it('W4-W7: an unlisted registry, with no frame sent before, sends nothing', async () => {
    const w = await rawTreeWorld();
    w.watcher.noteDelegationRegistry(false);
    for (const n of [0, 1, 2, 3]) await censusPass(w, at(n));
    expect(w.frames).toEqual([]);
    expect(w.watcher.currentDelegation()).toBeNull();
  });

  it('W4-W8 (a frame is withdrawn): a lane that cannot project sends one null; the next projection is sent in full', async () => {
    const w = await leasedWorld();
    const sent = w.watcher.currentDelegation();
    w.watcher.noteDelegationRegistry(false);
    await censusPass(w, at(3));
    expect(w.frames.slice(2)).toEqual([null]);
    expect(w.watcher.currentDelegation()).toBeNull();
    await censusPass(w, at(4));
    expect(w.frames).toHaveLength(3);
    w.watcher.noteDelegationRegistry(true);
    await censusPass(w, at(5));
    expect(w.frames).toHaveLength(4);
    expect({ ...w.frames[3]!, asOf: '' }).toEqual({ ...sent!, asOf: '' });
    // the applier not ready: one null
    const applier = (await w.watcher.delegationApplier())!;
    const real = applier.state();
    vi.spyOn(applier, 'state').mockReturnValue({ ...real, phase: 'reconstructing' } as never);
    await censusPass(w, at(6));
    expect(w.frames.slice(4)).toEqual([null]);
  });

  it('W4-W10 (the withdrawal through tick()): an unlistable registry withdraws a sent frame once, before any lane runs', async () => {
    const w = await leasedWorld();
    const sent = w.watcher.currentDelegation();
    w.unlisted = true;
    await w.watcher.tick();
    expect(w.frames.slice(2)).toEqual([null]);
    expect(w.watcher.currentDelegation()).toBeNull();
    await w.watcher.tick();
    expect(w.frames).toHaveLength(3);
    w.unlisted = false;
    w.watcher.noteDelegationRegistry(true);
    await censusPass(w, at(3));
    expect(w.frames).toHaveLength(4);
    expect({ ...w.frames[3]!, asOf: '' }).toEqual({ ...sent!, asOf: '' });
  });

  it('W4-W9 (programme ownership on the L4 path): a listed session whose id is the raw tree\'s ccd id removes its lease row', async () => {
    // ccd's layout: the tree at `<root>/demo/raw-tree` is the workspace `demo-raw-tree` (D-7006's id join). The lane never leases a
    // tree whose ccd workspace is listed (`ccd-workspace-not-a-lease`), so the session is listed only once the lease exists.
    const ccdTree = { ...RAW, canonicalPath: '/w/worktrees/demo/raw-tree' };
    const w = await leasedWorld([sessionOf('demo-a')], { demo: [OLD, ccdTree] });
    expect(w.watcher.currentDelegation()!.leases.map((l) => l.adminRecord)).toEqual(['raw-tree']);
    await censusPass(w, at(3), [sessionOf('demo-a'), sessionOf('demo-raw-tree')], { demo: [OLD, ccdTree] });
    expect(w.watcher.currentDelegation()!.leases).toEqual([]);
    // listing the workspace makes the policy file a `conflicting` attempt for the tree, so the unowned arm is load-bearing here too
    expect(w.watcher.currentDelegation()!.unowned).toEqual([]);
    expect(w.coord.readDelegationProjection().leases).toHaveLength(1);
  });
});
