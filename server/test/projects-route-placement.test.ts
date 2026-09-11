// Spec §5.6, §11 row 48. `GET /api/accounts`'s `projected` is the forecast for
// an UNTAGGED project and stays global; the per-project answer rides
// `ProjectRow.placement`, and its third member — `unmeasurable` — is a VALUE.
// Collapsing it into `none` would tell an operator that nothing can take a
// project when in fact nobody looked.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';
import { mkTmp } from './tmpHelpers.js';
import type { FleetIO } from '../src/io.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';

let home: string;
let projectsRoot: string;
let app: FastifyInstance | undefined;

const POOLED = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) =>
    a.id === 'claude' ? { ...a, pool: 'pool-a' }
    : a.id === 'claude-a' ? { ...a, pool: 'pool-b' }
    : a.id === 'claude-b' ? { ...a, pool: 'pool-b' }
    : a.id === 'claude-d' ? { ...a, pool: 'pool-b' } : a),
};

const dead: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

const open = async (io: FleetIO = localIO): Promise<FastifyInstance> => {
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(dead, cfg), tmux: new Tmux(dead), io, queue: new KeyedQueue(),
  });
  await a.ready();
  return a;
};

const rows = async (a: FastifyInstance): Promise<Record<string, { pool: ProjectPoolWire; placement: ProjectPlacement }>> => {
  const res = await a.inject({ method: 'GET', url: '/api/projects' });
  expect(res.statusCode).toBe(200);
  return Object.fromEntries((res.json().projects as Array<{ name: string; pool: ProjectPoolWire; placement: ProjectPlacement }>)
    .map((p) => [p.name, { pool: p.pool, placement: p.placement }]));
};

const tag = (project: string, bytes: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, project), bytes);
};

const limits = (w: string, five: number, seven: number): void => {
  const dir = path.join(home, '.cc-limits');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${w}.json`), JSON.stringify({
    five, seven, ts: Math.floor(Date.now() / 1000) - 60,
    fiveResetAt: Math.floor(Date.now() / 1000) + 9000,
    sevenResetAt: Math.floor(Date.now() / 1000) + 400000,
  }));
};

beforeEach(() => {
  home = mkTmp('ccrc-projects-pool-');
  seedRoster(home, POOLED);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  projectsRoot = mkTmp('ccrc-projects-root-');
  mkdirSync(path.join(projectsRoot, 'demo'));
  mkdirSync(path.join(projectsRoot, 'quiet-basin'));
  limits('claude', 70, 70);
  limits('claude-a', 10, 10);
  limits('claude-b', 20, 20);
  limits('claude-d', 30, 30);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(projectsRoot, { recursive: true, force: true });
});

describe('GET /api/projects — pool and placement per row', () => {
  it('an untagged project is untagged, and its placement is the unconstrained forecast', async () => {
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'untagged' },
      placement: { kind: 'projected', wrapper: 'claude-a', score: 10 },
    });
  });

  it('a tagged project forecasts the cheapest account IN ITS POOL, not the cheapest account', async () => {
    // `claude-a` at 10 is cheapest on the box and is in pool-b; pool-a's only
    // member is `claude` at 70. A row that named claude-a would be forecasting
    // a placement ccd would refuse.
    tag('demo', 'pool-a');
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'tagged', name: 'pool-a' },
      placement: { kind: 'projected', wrapper: 'claude', score: 70 },
    });
  });

  it('a pool with no member forecasts NONE, naming the pool', async () => {
    tag('demo', 'pool-c');
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'tagged', name: 'pool-c' },
      placement: { kind: 'none', pool: 'pool-c' },
    });
  });

  it('a malformed tag is malformed and UNMEASURABLE, never none and never untagged', async () => {
    tag('demo', 'Pool A');
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'malformed' },
      placement: { kind: 'unmeasurable' },
    });
  });

  it('an unreadable tag is unreadable and UNMEASURABLE, and only that project is affected', async () => {
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-a');
    app = await open(degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`)));
    const r = await rows(app);
    expect(r.demo).toEqual({ pool: { state: 'unreadable' }, placement: { kind: 'unmeasurable' } });
    expect(r['quiet-basin']).toEqual({
      pool: { state: 'tagged', name: 'pool-a' },
      placement: { kind: 'projected', wrapper: 'claude', score: 70 },
    });
  });

  it('bounds the pool leg when the request root listing never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const reg = path.join(home, '.cc-sessions');
    const rootRead = vi.fn(async (p: string, timeoutMs?: number) => p === reg && timeoutMs !== undefined
      ? new Promise<never>(() => {})
      : localIO.readdir(p, timeoutMs));
    const io: FleetIO = { ...localIO, readdir: rootRead };
    app = await open(io);

    const pending = app.inject({ method: 'GET', url: '/api/projects' });
    await vi.waitFor(() => {
      expect(rootRead.mock.calls.find(([p, timeoutMs]) => p === reg && timeoutMs !== undefined)?.[1],
        'the projects route to start its bounded registry read').toBe(10_000);
    }, { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();

    const result = await pending;
    expect(result.statusCode).toBe(200);
    expect((result.json().projects as Array<{ pool: ProjectPoolWire }>).every(
      (project) => project.pool.state === 'unreadable',
    )).toBe(true);
  });

  it('bounds the pool leg when a request marker read never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    tag('demo', 'pool-a');
    const readMarker = vi.fn(async (p: string, timeoutMs?: number) => p.endsWith(`${POOLS_DIR_NAME}/demo`)
      ? new Promise<never>(() => {})
      : localIO.readFileMeasured(p, timeoutMs));
    const io: FleetIO = { ...localIO, readFileMeasured: readMarker };
    app = await open(io);

    const pending = app.inject({ method: 'GET', url: '/api/projects' });
    await vi.waitFor(() => {
      expect(readMarker).toHaveBeenCalled();
      expect(readMarker.mock.calls.find(([p]) => p.endsWith(`${POOLS_DIR_NAME}/demo`))?.[1],
        'the projects route to start its bounded marker read').toBe(10_000);
    }, { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const observed = Promise.race([
      pending,
      new Promise<'route-still-pending'>((resolve) => {
        watchdog = setTimeout(() => resolve('route-still-pending'), 10_000);
      }),
    ]);

    const result = await observed;
    if (watchdog !== undefined) clearTimeout(watchdog);
    expect(result).not.toBe('route-still-pending');
    if (result === 'route-still-pending') return;
    expect(result.statusCode).toBe(200);
    expect(Object.fromEntries((result.json().projects as Array<{ name: string; pool: ProjectPoolWire }>)
      .map((p) => [p.name, p.pool])).demo).toEqual({ state: 'unreadable' });
  });

  it('the global `projected` on GET /api/accounts is still the UNTAGGED forecast, whatever is tagged', async () => {
    // The two fields are different questions and this pins that they stay so:
    // tagging every project must not move the accounts screen's `+` forecast.
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-a');
    app = await open();
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.json().projected).toEqual({ wrapper: 'claude-a', score: 10 });
  });
});
