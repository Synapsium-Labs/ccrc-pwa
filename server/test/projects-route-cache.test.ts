// GET /api/projects answers from the watcher's listed tick and a cached project walk (desktop polish C4, D-6436).
//
// Every case runs over a fixture HOME of plain files (a projects root, a registry, linked worktrees as `.git` FILES)
// read through a wrapped `localIO` that logs every request in issue order, and can hold each one at a gate or delay
// it per path, so what the route asks the agent link for is the thing measured. No live fleet, no real ccd.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { CcrcConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import {
  FLEET_ROWS_MAX_AGE_MS, PROJECT_WALK_CONCURRENCY, PROJECT_WALK_TTL_MS, ProjectWalkCache, fleetRowsUsable, listProjects,
  type FleetRowsListing, type ProjectSourceRow,
} from '../src/lifecycle.js';
import { readRegistryMeasured } from '../src/registry.js';
import { buildServer, type Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

interface Req { op: string; path: string }
/** Holds calls until the driver releases them. `open` makes it sticky: once set, a call passes at once, so a late
 *  call can never park forever. `holds`, when given, picks which calls wait at all (every call by default). */
interface Gate {
  pending: (() => void)[]; open?: boolean; holds?: (op: string, p: string) => boolean;
  /** Hold the ANSWER rather than the call: the read happens at once, its result waits at the gate. */
  after?: boolean;
}
/** Opens a gate for good and lets every parked call go. */
const openGate = (g: Gate): void => { g.open = true; g.pending.splice(0).forEach((go) => { go(); }); };
interface CountingOptions {
  gate?: Gate;
  /** Paths whose next `lstatMeasured` answers `unmeasured` (an agent that could not ask); each fires once. */
  lstatUnmeasuredOnce?: Set<string>;
  /** A request's delay, from its path and its issue index (0 for the first request this io saw). */
  delayMs?: (p: string, index: number) => number;
  /** Directories whose listing fails (`readdir` null, `readdirMeasured` unreadable). Mutable between requests. */
  unlistable?: Set<string>;
}

/** A counting wrapper over `localIO`: every call is logged, counted in flight, and held at `gate` or delayed. A call
 *  that reaches a sibling (`readdir` calls `this.readdirMeasured`) runs on `localIO`, so it is one request, as on the
 *  agent link. */
const countingIO = (opts: CountingOptions = {}) => {
  const requests: Req[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const io = { ...localIO } as Record<string, unknown>;
  for (const [op, fn] of Object.entries(localIO)) {
    if (typeof fn !== 'function') continue;
    io[op] = async (...args: unknown[]) => {
      const p = String(args[0]);
      const index = requests.length;
      requests.push({ op, path: p });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const gate = opts.gate;
        const held = (): boolean => gate !== undefined && !gate.open && (gate.holds?.(op, p) ?? true);
        if (gate?.after === true && held()) {
          const answer = await (fn as (...a: unknown[]) => unknown).apply(localIO, args);
          await new Promise<void>((go) => { gate.pending.push(go); });
          return answer;
        }
        if (held()) await new Promise<void>((go) => { gate!.pending.push(go); });
        else if (opts.delayMs !== undefined) {
          const ms = opts.delayMs(p, index);
          await new Promise<void>((go) => { setTimeout(go, ms); });
        }
        if (op === 'lstatMeasured' && opts.lstatUnmeasuredOnce?.delete(p)) return { ok: false, reason: 'unmeasured' };
        if (opts.unlistable?.has(p)) {
          if (op === 'readdir') return null;
          if (op === 'readdirMeasured') return { ok: false, reason: 'unreadable' };
        }
        return await (fn as (...a: unknown[]) => unknown).apply(localIO, args);
      } finally {
        inFlight -= 1;
      }
    };
  }
  return {
    io: io as unknown as FleetIO, requests,
    maxInFlight: () => maxInFlight,
    reset: () => { requests.length = 0; maxInFlight = 0; },
  };
};

/** One registry row as plain files. */
const plant = (cfg: CcrcConfig, id: string, project: string, workdir: string): void => {
  mkdirSync(cfg.registryDir, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project, workdir, uuid: `u-${id}`, started: '1', workspace: id, branch: `ws/${id}`,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(cfg.registryDir, `${id}.${k}`), v);
};

/** A directory, optionally a main checkout (`.git` a directory) or a linked worktree (`.git` a FILE). */
const dir = (p: string, git: 'none' | 'main' | 'linked' = 'none'): string => {
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, 'README'), 'x');
  if (git === 'main') mkdirSync(path.join(p, '.git'), { recursive: true });
  if (git === 'linked') writeFileSync(path.join(p, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
  return p;
};

/**
 * The recorded fixture (Step 1):
 * - `alpha`, a main checkout under the root, and a registry row on the same workdir under another name;
 * - two registry rows sharing a workdir outside the root, the first in record order named `zeta`;
 * - a linked worktree reached through both doors: `linked` under the root, and a registry row on it;
 * - a second linked worktree reached only through the registry;
 * - a registry-only project, `solo`;
 * - a plain directory, a dot directory and a plain file under the root.
 */
const projectsFixture = (prefix: string) => {
  const home = mkTmp(prefix);
  const deps = testDeps(home);
  const { cfg } = deps;
  const root = cfg.projectsRoot;
  const away = path.join(home, 'elsewhere');
  dir(path.join(root, 'alpha'), 'main');
  dir(path.join(root, 'plain'));
  dir(path.join(root, '.hidden'), 'main');
  dir(path.join(root, 'linked'), 'linked');
  writeFileSync(path.join(root, 'notes.txt'), 'not a project');
  dir(path.join(away, 'shared'));
  dir(path.join(away, 'linked-two'), 'linked');
  dir(path.join(away, 'solo'), 'main');
  plant(cfg, 'lane-a-r1', 'alpha-renamed', path.join(root, 'alpha'));
  plant(cfg, 'lane-a-r2', 'zeta', path.join(away, 'shared'));
  plant(cfg, 'lane-a-r3', 'beta', path.join(away, 'shared'));
  plant(cfg, 'lane-a-r4', 'linked', path.join(root, 'linked'));
  plant(cfg, 'lane-a-r5', 'linked-two', path.join(away, 'linked-two'));
  plant(cfg, 'lane-a-r6', 'solo', path.join(away, 'solo'));
  return { home, deps, cfg, root, away };
};
type Fixture = ReturnType<typeof projectsFixture>;

/** Today's answer for `projectsFixture`, recorded on the serial code (Step 1), workdirs relative to the HOME. */
const RECORDED = {
  registry: 'listed',
  projects: [
    { name: 'alpha', workdir: 'projects/alpha' },
    { name: 'plain', workdir: 'projects/plain' },
    { name: 'solo', workdir: 'elsewhere/solo' },
    { name: 'zeta', workdir: 'elsewhere/shared' },
  ],
} as const;

const relative = (home: string, r: { projects: { name: string; workdir: string }[]; registry?: string }) => ({
  registry: r.registry,
  projects: r.projects.map((p) => ({ name: p.name, workdir: path.relative(home, p.workdir) })),
});

/** The fixture's registry rows in record order, as the watcher's listing carries them. */
const fixtureRows = async (f: Fixture): Promise<ProjectSourceRow[]> => {
  const read = await readRegistryMeasured(localIO, f.cfg);
  if (!read.listed) throw new Error('fixture: the registry did not list');
  return read.records.map((r) => ({ project: r.project, workdir: r.workdir }));
};

/** A read of one session's field file: `<registryDir>/<id>.<field>`. */
const fieldReads = (cfg: CcrcConfig, requests: Req[]): Req[] =>
  requests.filter((q) => (q.op === 'readFile' || q.op === 'readFileMeasured') && path.dirname(q.path) === cfg.registryDir
    && /^lane-a-r\d\./.test(path.basename(q.path)));

/** Every request about the projects' own directories: the root walk and the registry workdirs' probes. */
const walkReads = (f: Fixture, requests: Req[]): Req[] =>
  requests.filter((q) => q.path === f.root || q.path.startsWith(f.root + path.sep) || q.path.startsWith(f.away + path.sep));

/** A server over the fixture with a counting io and a real, never-ticked watcher whose listing a case sets. */
const routeRig = async (f: Fixture, c: ReturnType<typeof countingIO>) => {
  const deps: Deps = { ...f.deps, io: c.io, stateCachePath: path.join(f.home, 'state-cache.json') };
  const watcher = new FleetWatcher(withFakeClock(deps), new Bus(), 2000);
  const state: { listing: FleetRowsListing | null; fleet: ProjectSourceRow[] | null } = { listing: null, fleet: null };
  Object.assign(watcher, {
    currentFleetListing: () => state.listing,
    currentFleet: () => state.fleet,
  });
  const app = await buildServer(deps, new Bus(), watcher);
  const get = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    return res.json() as { registry: string; projects: { name: string; workdir: string; pool?: unknown }[] };
  };
  return { app, state, get };
};

const T0 = Date.parse('2026-11-03T12:00:00Z');
const fakeDate = (at: number): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('the recorded answer (Step 1, green on the serial code)', () => {
  it('listProjects over the fixture answers the recorded rows', async () => {
    const f = projectsFixture('ccrc-projects-recorded-');
    const got = await listProjects(countingIO().io, f.cfg);
    expect(got.roots).toEqual([f.root]);
    expect(relative(f.home, got)).toEqual(RECORDED);
  });
});

describe('the registry half comes from the watcher only while its listing is current (D-6436)', () => {
  it('a fresh listed tick: no session field read', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-fresh-');
    const c = countingIO();
    const r = await routeRig(f, c);
    try {
      r.state.listing = { sessions: await fixtureRows(f), listedAt: T0 - (FLEET_ROWS_MAX_AGE_MS - 1) };
      c.reset();
      const body = await r.get();
      expect(fieldReads(f.cfg, c.requests), 'no session field file is read').toEqual([]);
      expect(relative(f.home, body)).toEqual(RECORDED);
    } finally { await r.app.close(); }
  });

  it("after an unlistable tick: own read, registry 'unlistable'", async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-unlistable-tick-');
    const unlistable = new Set<string>();
    const c = countingIO({ unlistable });
    const r = await routeRig(f, c);
    try {
      // The watcher keeps its last broadcast through an unlistable tick, but its listing answers null; and the
      // route's own read cannot list the registry either.
      r.state.fleet = await fixtureRows(f);
      r.state.listing = null;
      unlistable.add(f.cfg.registryDir);
      c.reset();
      const body = await r.get();
      expect(body.registry).toBe('unlistable');
      expect(c.requests.some((q) => q.op === 'readdir' && q.path === f.cfg.registryDir), 'the route listed the registry itself')
        .toBe(true);
      expect(relative(f.home, body).projects, 'the root walk alone').toEqual([
        { name: 'alpha', workdir: 'projects/alpha' }, { name: 'plain', workdir: 'projects/plain' },
      ]);
    } finally { await r.app.close(); }
  });

  it('a listed tick past the bound is not used', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-stale-');
    const c = countingIO();
    const r = await routeRig(f, c);
    try {
      // A listing that would answer differently if it were used: one extra registry-only project.
      const extra = dir(path.join(f.away, 'from-the-stale-listing'), 'main');
      r.state.listing = { sessions: [...await fixtureRows(f), { project: 'stale', workdir: extra }], listedAt: T0 - FLEET_ROWS_MAX_AGE_MS };
      c.reset();
      const body = await r.get();
      expect(fieldReads(f.cfg, c.requests).length, 'the route read the registry itself').toBeGreaterThan(0);
      expect(relative(f.home, body)).toEqual(RECORDED);
    } finally { await r.app.close(); }
  });

  it('before the first broadcast: own read, as today', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-cold-');
    const c = countingIO();
    const r = await routeRig(f, c);
    try {
      c.reset();
      const body = await r.get();
      expect(fieldReads(f.cfg, c.requests).length, 'the route read the registry itself').toBeGreaterThan(0);
      expect(relative(f.home, body)).toEqual(RECORDED);
    } finally { await r.app.close(); }
  });

  it('an empty listed fleet: the route answers listed and lists the registry no more than from a full one', async () => {
    // Review 1375, F4: with zero sessions "no session field read" is vacuous, so this counts listings of the
    // registry DIRECTORY itself (the pools and limits reads list it too, so it is counted against a full listing).
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-empty-listing-');
    const c = countingIO();
    const r = await routeRig(f, c);
    const registryListings = (): number => c.requests
      .filter((q) => (q.op === 'readdir' || q.op === 'readdirMeasured') && q.path === f.cfg.registryDir).length;
    try {
      r.state.listing = { sessions: await fixtureRows(f), listedAt: T0 - 1 };
      c.reset();
      await r.get();
      const fromRows = registryListings();
      r.state.listing = null;
      c.reset();
      await r.get();
      expect(registryListings(), 'control: the route\'s own read lists the registry once more').toBeGreaterThan(fromRows);
      r.state.listing = { sessions: [], listedAt: T0 - 1 };
      c.reset();
      const body = await r.get();
      expect(registryListings(), 'an empty listing is still a listing').toBe(fromRows);
      expect(body.registry).toBe('listed');
      expect(relative(f.home, body).projects, 'the root walk alone').toEqual([
        { name: 'alpha', workdir: 'projects/alpha' }, { name: 'plain', workdir: 'projects/plain' },
      ]);
    } finally { await r.app.close(); }
  });

  it('the watcher answers a listing after a listed tick, none after an unlistable one, and stamps when its read began', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-watcher-');
    const unlistable = new Set<string>();
    const c = countingIO({ unlistable });
    const deps: Deps = { ...f.deps, io: c.io, stateCachePath: path.join(f.home, 'state-cache.json') };
    const w = new FleetWatcher(withFakeClock(deps), new Bus(), 2000);
    expect(w.currentFleetListing(), 'before the first tick').toBeNull();
    await w.tick();
    const listed = w.currentFleetListing();
    expect(listed?.listedAt).toBe(T0);
    expect(listed?.sessions.map((s) => [s.project, path.relative(f.home, s.workdir)])).toEqual([
      ['alpha-renamed', 'projects/alpha'], ['zeta', 'elsewhere/shared'], ['beta', 'elsewhere/shared'],
      ['linked', 'projects/linked'], ['linked-two', 'elsewhere/linked-two'], ['solo', 'elsewhere/solo'],
    ]);
    unlistable.add(f.cfg.registryDir);
    vi.setSystemTime(T0 + 5_000);
    await w.tick();
    expect(w.currentFleet(), 'the broadcast fleet is kept').not.toBeNull();
    expect(w.currentFleetListing(), 'but it is not a current listing').toBeNull();
    unlistable.delete(f.cfg.registryDir);
    vi.setSystemTime(T0 + 9_000);
    await w.tick();
    expect(w.currentFleetListing()?.listedAt, 'an unchanged fleet still restamps').toBe(T0 + 9_000);
    w.stop();
  });

  it('fleetRowsUsable: null, a future stamp and an age at the bound all answer null; inside it, the rows', () => {
    const sessions = [{ project: 'p', workdir: '/w/p' }];
    expect(fleetRowsUsable(null, T0, 1000)).toBeNull();
    expect(fleetRowsUsable({ sessions, listedAt: T0 + 1 }, T0, 1000)).toBeNull();
    expect(fleetRowsUsable({ sessions, listedAt: T0 - 1000 }, T0, 1000)).toBeNull();
    expect(fleetRowsUsable({ sessions, listedAt: T0 - 999 }, T0, 1000)).toEqual(sessions);
    expect(fleetRowsUsable({ sessions, listedAt: T0 }, T0, 1000)).toEqual(sessions);
  });
});

describe('the walk is concurrent and bounded, and its answer is today\'s (D-6436)', () => {
  /** A wider root than the recorded fixture, so the bound can bind: 3 x the bound directories, half main checkouts. */
  const wide = (prefix: string): Fixture => {
    const f = projectsFixture(prefix);
    for (let i = 0; i < 3 * PROJECT_WALK_CONCURRENCY; i += 1) dir(path.join(f.root, `wide-${String(i).padStart(2, '0')}`), i % 2 === 0 ? 'main' : 'none');
    for (let i = 0; i < 2 * PROJECT_WALK_CONCURRENCY; i += 1) dir(path.join(f.away, `ws-${String(i).padStart(2, '0')}`), 'linked');
    return f;
  };
  const wideRows = (f: Fixture, base: ProjectSourceRow[]): ProjectSourceRow[] => [
    ...base,
    ...Array.from({ length: 2 * PROJECT_WALK_CONCURRENCY }, (_, i) => ({ project: 'alpha', workdir: path.join(f.away, `ws-${String(i).padStart(2, '0')}`) })),
  ];

  it('the second readdir is issued before the first resolves', async () => {
    // Conditions, not ticks (review 1375, F1): wait until the root listing is the one call out, let it alone go,
    // then wait until the entries are being listed. The gate stays closed, so no entry listing has answered while
    // they are counted; then it opens for good, so no later call can park.
    const f = wide('ccrc-projects-concurrent-');
    const gate: Gate = { pending: [] };
    const c = countingIO({ gate });
    const p = listProjects(c.io, f.cfg, await fixtureRows(f));
    try {
      await vi.waitFor(() => { expect(gate.pending).toHaveLength(1); }, { timeout: 10_000 });
      expect(c.requests).toEqual([{ op: 'readdir', path: f.root }]);
      gate.pending.splice(0).forEach((go) => { go(); });
      const entryListings = () => c.requests.filter((q) => q.op === 'readdir' && path.dirname(q.path) === f.root);
      await vi.waitFor(() => {
        expect(entryListings().length, 'several entries are listed while none has answered').toBeGreaterThan(1);
      }, { timeout: 10_000 });
      expect(entryListings()).toHaveLength(gate.pending.length);
    } finally {
      openGate(gate);
    }
    await p;
  });

  it('never more than the bound in flight', async () => {
    const f = wide('ccrc-projects-bound-');
    const c = countingIO({ delayMs: () => 2 });
    await listProjects(c.io, f.cfg, wideRows(f, await fixtureRows(f)));
    expect(PROJECT_WALK_CONCURRENCY).toBe(8);
    expect(c.maxInFlight()).toBeLessThanOrEqual(PROJECT_WALK_CONCURRENCY);
    expect(c.maxInFlight(), 'and the bound is reached').toBe(PROJECT_WALK_CONCURRENCY);
  });

  it('the answer equals the recorded one', async () => {
    // Reads finish in reverse issue order within each batch: a later request waits less.
    const reverse = (_p: string, index: number): number => Math.max(0, 40 - index);
    const f = projectsFixture('ccrc-projects-reverse-');
    const fromRows = await listProjects(countingIO({ delayMs: reverse }).io, f.cfg, await fixtureRows(f));
    expect(relative(f.home, fromRows), 'from the watcher\'s rows').toEqual(RECORDED);
    const ownRead = await listProjects(countingIO({ delayMs: reverse }).io, f.cfg);
    expect(relative(f.home, ownRead), 'from the route\'s own read').toEqual(RECORDED);
    const cached = new ProjectWalkCache();
    await listProjects(countingIO().io, f.cfg, undefined, cached);
    expect(relative(f.home, await listProjects(countingIO({ delayMs: reverse }).io, f.cfg, undefined, cached)), 'from the cache')
      .toEqual(RECORDED);
  });
});

describe('the walk cache (D-6436)', () => {
  it('within the TTL nothing is walked; after it, a new directory appears', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-ttl-');
    const c = countingIO();
    const r = await routeRig(f, c);
    try {
      expect(relative(f.home, await r.get())).toEqual(RECORDED);
      dir(path.join(f.root, 'newcomer'), 'main');
      vi.setSystemTime(T0 + PROJECT_WALK_TTL_MS - 1);
      c.reset();
      const within = await r.get();
      expect(walkReads(f, c.requests), 'no walk and no probe inside the TTL').toEqual([]);
      expect(within.projects.map((p) => p.name)).not.toContain('newcomer');
      vi.setSystemTime(T0 + PROJECT_WALK_TTL_MS);
      c.reset();
      const after = await r.get();
      expect(walkReads(f, c.requests).length, 'walked again').toBeGreaterThan(0);
      expect(after.projects.map((p) => p.name)).toContain('newcomer');
    } finally { await r.app.close(); }
  });

  it('an unlistable projects root is not cached', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-root-fail-');
    const unlistable = new Set<string>();
    const c = countingIO({ unlistable });
    const r = await routeRig(f, c);
    try {
      unlistable.add(f.root);
      const failed = await r.get();
      expect(failed.projects.map((p) => p.name), 'the registry half alone').toEqual(['alpha-renamed', 'solo', 'zeta']);
      unlistable.delete(f.root);
      vi.setSystemTime(T0 + 1);
      expect(relative(f.home, await r.get()), 'the next request walks the root').toEqual(RECORDED);
    } finally { await r.app.close(); }
  });

  it('an unmeasured probe is not served from the cache on the next request', async () => {
    // Review 1375, F2: only a MEASURED verdict is kept. The answer to the request that met the unmeasured probe is
    // today's: the row stays (D-5967). The next request, inside the TTL, asks that workdir again and nothing else.
    const f = projectsFixture('ccrc-projects-unmeasured-probe-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    const gitOf = path.join(f.away, 'linked-two', '.git');
    const c = countingIO({ lstatUnmeasuredOnce: new Set([gitOf]) });
    const first = await listProjects(c.io, f.cfg, undefined, cache);
    expect(relative(f.home, first).projects, 'an unmeasured probe keeps the row')
      .toContainEqual({ name: 'linked-two', workdir: 'elsewhere/linked-two' });
    now = T0 + 1;
    c.reset();
    const second = await listProjects(c.io, f.cfg, undefined, cache);
    expect(c.requests.filter((q) => q.op === 'lstatMeasured'), 'that probe alone is asked again')
      .toEqual([{ op: 'lstatMeasured', path: gitOf }]);
    expect(relative(f.home, second)).toEqual(RECORDED);
  });

  it('a walk with an unmeasured slot is not kept', async () => {
    const f = projectsFixture('ccrc-projects-unmeasured-slot-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    const c = countingIO({ lstatUnmeasuredOnce: new Set([path.join(f.root, 'linked', '.git')]) });
    const first = await listProjects(c.io, f.cfg, undefined, cache);
    expect(relative(f.home, first).projects, 'an unmeasured slot keeps the row')
      .toContainEqual({ name: 'linked', workdir: 'projects/linked' });
    now = T0 + 1;
    c.reset();
    const second = await listProjects(c.io, f.cfg, undefined, cache);
    expect(c.requests.filter((q) => q.op === 'readdir' && q.path === f.root), 'the root is walked again').toHaveLength(1);
    expect(relative(f.home, second)).toEqual(RECORDED);
  });

  it('an older walk finishing last never replaces a newer one', async () => {
    // Review 1375, F3: each walk is stamped when it STARTS, and a result is kept only over an older stamp.
    const f = projectsFixture('ccrc-projects-walk-order-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    const gate: Gate = { pending: [], holds: (op, p) => op === 'readdir' && path.dirname(p) === f.root };
    const older = listProjects(countingIO({ gate }).io, f.cfg, [], cache);
    try {
      // the older walk has listed the root and holds its entries
      await vi.waitFor(() => { expect(gate.pending.length).toBeGreaterThan(0); }, { timeout: 10_000 });
      dir(path.join(f.root, 'newcomer'), 'main');
      now = T0 + 1;
      const newer = await listProjects(countingIO().io, f.cfg, [], cache);
      expect(newer.projects.map((p) => p.name)).toContain('newcomer');
    } finally {
      openGate(gate);
    }
    expect((await older).projects.map((p) => p.name), 'the older listing finishes last').not.toContain('newcomer');
    now = T0 + 2;
    const c = countingIO();
    const kept = await listProjects(c.io, f.cfg, [], cache);
    expect(walkReads(f, c.requests), 'served from the cache').toEqual([]);
    expect(kept.projects.map((p) => p.name), 'the newer walk is the one kept').toContain('newcomer');
  });

  it('an older probe finishing last never replaces a newer verdict', async () => {
    // Review 1378, F1: the probe twin of the walk-order case. The older request's `.git` probe reads a main checkout
    // and its answer is held; the workdir then becomes a linked worktree, and a newer request measures that first.
    const f = projectsFixture('ccrc-projects-probe-order-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    const solo = path.join(f.away, 'solo');
    const gitOf = path.join(solo, '.git');
    const rows = [{ project: 'solo', workdir: solo }];
    const gate: Gate = { pending: [], after: true, holds: (op, p) => op === 'lstatMeasured' && p === gitOf };
    const older = listProjects(countingIO({ gate }).io, f.cfg, rows, cache);
    try {
      await vi.waitFor(() => { expect(gate.pending).toHaveLength(1); }, { timeout: 10_000 });
      rmSync(gitOf, { recursive: true });
      writeFileSync(gitOf, 'gitdir: /elsewhere/.git/worktrees/solo\n');
      now = T0 + 1;
      const newer = await listProjects(countingIO().io, f.cfg, rows, cache);
      expect(newer.projects.map((p) => p.name), 'the newer probe measures a linked worktree').not.toContain('solo');
    } finally {
      openGate(gate);
    }
    expect((await older).projects.map((p) => p.name), 'the older probe finishes last').toContain('solo');
    now = T0 + 2;
    const c = countingIO();
    const kept = await listProjects(c.io, f.cfg, rows, cache);
    expect(c.requests.filter((q) => q.path === solo || q.path === gitOf), 'served from the cache').toEqual([]);
    expect(kept.projects.map((p) => p.name), 'the newer verdict is the one kept').not.toContain('solo');
  });

  it('a registry workdir that cannot be listed is not served from the cache', async () => {
    // Review 1378, F2: the view's listing half. The row is kept both times; the second request asks again.
    const f = projectsFixture('ccrc-projects-unlistable-workdir-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    const solo = path.join(f.away, 'solo');
    const unlistable = new Set([solo]);
    const c = countingIO({ unlistable });
    const first = await listProjects(c.io, f.cfg, undefined, cache);
    expect(relative(f.home, first).projects, 'an unlistable workdir keeps its row').toContainEqual({ name: 'solo', workdir: 'elsewhere/solo' });
    unlistable.clear();
    now = T0 + 1;
    c.reset();
    const second = await listProjects(c.io, f.cfg, undefined, cache);
    expect(c.requests.filter((q) => q.path === solo), 'that workdir is asked again').toEqual([{ op: 'readdirMeasured', path: solo }]);
    expect(relative(f.home, second)).toEqual(RECORDED);
  });

  it('a registry workdir measured absent is served from the cache', async () => {
    // Review 1378, F3: a proven absence is a measurement, so it is kept like any verdict (the row stays, as today).
    const f = projectsFixture('ccrc-projects-absent-workdir-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    const gone = path.join(f.away, 'gone');
    const rows = [...await fixtureRows(f), { project: 'gone', workdir: gone }];
    const c = countingIO();
    const first = await listProjects(c.io, f.cfg, rows, cache);
    expect(c.requests.filter((q) => q.path === gone), 'the first request asks').toEqual([{ op: 'readdirMeasured', path: gone }]);
    expect(first.projects.map((p) => p.name), 'and keeps the row, as today').toContain('gone');
    now = T0 + 1;
    c.reset();
    const second = await listProjects(c.io, f.cfg, rows, cache);
    expect(c.requests.filter((q) => q.path === gone), 'the second does not').toEqual([]);
    expect(second.projects.map((p) => p.name)).toContain('gone');
  });

  it('after the clock steps back, the next measured walk is kept', async () => {
    // Review 1378, F4: a kept walk whose age reads negative is not fresh, so the next measured walk replaces it
    // whatever its start stamp, as the probe cache already heals.
    const f = projectsFixture('ccrc-projects-clock-back-');
    let now = T0;
    const cache = new ProjectWalkCache(() => now);
    await listProjects(countingIO().io, f.cfg, [], cache);
    now = T0 - 10_000;
    dir(path.join(f.root, 'newcomer'), 'main');
    const c = countingIO();
    expect((await listProjects(c.io, f.cfg, [], cache)).projects.map((p) => p.name), 'walked again').toContain('newcomer');
    expect(walkReads(f, c.requests).length).toBeGreaterThan(0);
    now = T0 - 9_000;
    c.reset();
    const later = await listProjects(c.io, f.cfg, [], cache);
    expect(walkReads(f, c.requests), 'the walk after the step is the one kept').toEqual([]);
    expect(later.projects.map((p) => p.name)).toContain('newcomer');
  });

  it('a pool write shows on the next request', async () => {
    fakeDate(T0);
    const f = projectsFixture('ccrc-projects-pool-');
    const c = countingIO();
    const r = await routeRig(f, c);
    const poolsDir = path.join(f.cfg.registryDir, 'pools');
    try {
      const before = (await r.get()).projects.find((p) => p.name === 'alpha')!.pool;
      mkdirSync(poolsDir, { recursive: true });
      writeFileSync(path.join(poolsDir, 'alpha'), 'pool-b\n');
      vi.setSystemTime(T0 + 1);
      const after = (await r.get()).projects.find((p) => p.name === 'alpha')!.pool;
      expect(after).not.toEqual(before);
      // and it is what a server with no cache at all answers
      const fresh = await buildServer({ ...f.deps, stateCachePath: path.join(f.home, 'state-cache.json') });
      try {
        const res = (await fresh.inject({ method: 'GET', url: '/api/projects' })).json() as { projects: { name: string; pool?: unknown }[] };
        expect(after).toEqual(res.projects.find((p) => p.name === 'alpha')!.pool);
      } finally { await fresh.close(); }
    } finally { await r.app.close(); }
  });

  // Review 1383 F2 (desktop-polish carry): an entry stamped in the future after the clock steps back is dropped the
  // first time its age reads negative, so it is not served once the clock reaches its stamp again with no measured walk or
  // probe in between.
  it('a kept walk or verdict whose age reads negative is dropped, not served again when the clock catches up', () => {
    let now = T0 + 100_000;
    const cache = new ProjectWalkCache(() => now);
    cache.keepWalk([], cache.stamp());
    cache.keepProbe('/w/a', true, cache.stamp());
    expect(cache.keptWalk(), 'CONTROL: the walk is kept while fresh').toEqual([]);
    expect(cache.keptProbe('/w/a'), 'CONTROL: the verdict is kept while fresh').toBe(true);
    now = T0;
    expect(cache.keptWalk(), 'a negative age is not fresh').toBeNull();
    expect(cache.keptProbe('/w/a'), 'a negative age is not fresh').toBeNull();
    now = T0 + 100_000;
    expect(cache.keptWalk(), 'the walk was dropped, not kept for later').toBeNull();
    expect(cache.keptProbe('/w/a'), 'the verdict was dropped, not kept for later').toBeNull();
  });
});
