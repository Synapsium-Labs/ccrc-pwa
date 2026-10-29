// Task G1 (D-7334): the runs frame says when each run last moved, and carries the stall watch's quiet time, so the app's
// stalled word and the stall watch mean one thing by quiet. Both are additive: `lastMoveAt` on every run (one read a frame,
// `withLastMoves`), `stallQuietMs` beside `runs`, by the stall resolver's own quiet half (the Settings choice, else
// STALL_QUIET_MS).
// Movement reaches the app on the watcher's next tick: no mail write or run_events write pushes the frame itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { STALL_QUIET_MS } from '../src/coord/stall.js';
import { parseStallSettings, resolveStallWatch, stallBoxArmingOf, stallQuietOf } from '../src/coord/stallsettings.js';
import { CoordStore } from '../src/coord/store.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { watcherTeardown } from './watcherTeardown.js';

const COORDINATOR = 'lane-a-coordinator';
const WORKER = 'lane-a-worker';

const seedSession = (home: string, id: string, wrapper: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

interface RunsFrame { type: 'runs'; runs: { id: number; lastMoveAt?: number | null }[]; stallQuietMs?: number }

/** Every `runs` frame the socket receives, in order; other frame types are not this file's subject. */
const runsFrames = (ws: WebSocket): { next: () => Promise<RunsFrame>; seen: RunsFrame[] } => {
  const seen: RunsFrame[] = [];
  const waiters: ((m: RunsFrame) => void)[] = [];
  let read = 0;
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as { type?: unknown };
    if (m.type !== 'runs') return;
    seen.push(m as RunsFrame);
    const w = waiters.shift();
    if (w) { read += 1; w(m as RunsFrame); }
  });
  const next = (): Promise<RunsFrame> => new Promise((resolve, reject) => {
    if (seen.length > read) { read += 1; resolve(seen[read - 1]!); return; }
    const t = setTimeout(() => reject(new Error('timed out waiting for a runs frame')), 3000);
    waiters.push((m) => { clearTimeout(t); resolve(m); });
  });
  return { next, seen };
};

describe('the runs frame carries lastMoveAt and stallQuietMs (D-7334)', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  const teardown = watcherTeardown();
  const mkWatcher = (...a: ConstructorParameters<typeof FleetWatcher>) => teardown.track(new FleetWatcher(...a));

  beforeEach(() => {
    home = mkTmp('ccrc-runs-move-');
    seedRoster(home);
    seedSession(home, COORDINATOR, 'claude-a');
    seedSession(home, WORKER, 'claude-a');
  });

  afterEach(async () => {
    const closing = app;
    app = undefined;
    await teardown.remove(home, closing);
    vi.restoreAllMocks();
  });

  /** A server over a real coord store with one open run and its watcher primed. */
  async function start(): Promise<{ coord: CoordStore; watcher: FleetWatcher; runId: number; emitted: unknown[]; connect: () => Promise<ReturnType<typeof runsFrames>> }> {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'program-a', title: 'Program A', project: 'project-a', wave: 1, waveOf: 3, claimedBy: COORDINATOR }) as { id: number };
    const deps = { ...testDeps(home), coord };
    const bus = new Bus();
    // Every array the watcher broadcasts, in order: `maskedFrame`'s cache is keyed on that object.
    const emitted: unknown[] = [];
    bus.on('runs', (runs) => emitted.push(runs));
    const watcher = mkWatcher(deps, bus);
    app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const frames = runsFrames(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
      return frames;
    };
    return { coord, watcher, runId: opened.id, emitted, connect };
  }

  it('the cold frame carries each run\'s lastMoveAt (null with no move) and the built-in quiet time with no choice stored', async () => {
    const { runId, connect } = await start();
    const frames = await connect();
    const cold = await frames.next();
    expect(cold.runs.map((r) => [r.id, r.lastMoveAt])).toEqual([[runId, null]]);
    expect(cold.stallQuietMs).toBe(STALL_QUIET_MS);
  });

  it('a worker mail naming the run reaches the app as lastMoveAt on the next tick', async () => {
    const { coord, watcher, runId, connect } = await start();
    const frames = await connect();
    await frames.next();
    const at = Date.now();
    coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, ?, 'u', 'coordinator', ?, 'status', 's', 'b')")
      .run(at, WORKER, runId);
    await watcher.tick();
    const pushed = await frames.next();
    expect(pushed.runs.map((r) => [r.id, r.lastMoveAt])).toEqual([[runId, at]]);
  });

  it('a system mail moves nothing, so no runs frame is pushed for it', async () => {
    const { coord, watcher, runId, connect } = await start();
    const frames = await connect();
    await frames.next();
    coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, 'coordinator', 'u', ?, ?, 'status', 's', 'b')")
      .run(Date.now(), WORKER, runId);
    await watcher.tick();
    await watcher.tick();
    expect(frames.seen).toHaveLength(1);
  });

  it('the frame carries the Settings choice once one is set, and a change re-emits the frame with no run changing', async () => {
    const { coord, watcher, connect } = await start();
    const frames = await connect();
    expect((await frames.next()).stallQuietMs).toBe(STALL_QUIET_MS);
    const chosen = 4 * 3_600_000;
    const before = coord.stallSettings();
    expect(coord.setStallSettings({ quiet: { kind: 'set', ms: chosen } }, Date.now(), before)).toMatchObject({ kind: 'written' });
    await watcher.tick();
    expect((await frames.next()).stallQuietMs).toBe(chosen);
    // And a socket that connects now gets it on its cold frame.
    const later = await connect();
    expect((await later.next()).stallQuietMs).toBe(chosen);
  });
});

describe('the frame cache cannot serve a stale quiet time (maskedFrame keys on the runs array)', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  const teardown = watcherTeardown();
  const mkWatcher = (...a: ConstructorParameters<typeof FleetWatcher>) => teardown.track(new FleetWatcher(...a));
  beforeEach(() => { home = mkTmp('ccrc-runs-move-cache-'); seedRoster(home); seedSession(home, COORDINATOR, 'claude-a'); });
  afterEach(async () => { const closing = app; app = undefined; await teardown.remove(home, closing); vi.restoreAllMocks(); });

  it('a Settings-only change emits a NEW runs array, and two sockets sharing the cache both get the new stallQuietMs', async () => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'program-a', title: 'Program A', project: 'project-a', wave: 1, waveOf: 3, claimedBy: COORDINATOR }) as { id: number };
    const deps = { ...testDeps(home), coord };
    const bus = new Bus();
    const emitted: unknown[] = [];
    bus.on('runs', (runs) => emitted.push(runs));
    const watcher = mkWatcher(deps, bus);
    app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const frames = runsFrames(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
      return frames;
    };
    const a = await open();
    const b = await open();
    const coldA = await a.next();
    const coldB = await b.next();
    expect([coldA.stallQuietMs, coldB.stallQuietMs]).toEqual([STALL_QUIET_MS, STALL_QUIET_MS]);
    expect(emitted).toHaveLength(1);

    // A broadcast both sockets receive, so the cache holds that array's frame, serialised with the built-in quiet time.
    coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, ?, 'u', 'coordinator', ?, 'status', 's', 'b')")
      .run(Date.now(), COORDINATOR, opened.id);
    await watcher.tick();
    expect(emitted).toHaveLength(2);
    const [movedA, movedB] = [await a.next(), await b.next()];
    expect([movedA.stallQuietMs, movedB.stallQuietMs]).toEqual([STALL_QUIET_MS, STALL_QUIET_MS]);

    const chosen = 6 * 3_600_000;
    expect(coord.setStallSettings({ quiet: { kind: 'set', ms: chosen } }, Date.now(), coord.stallSettings())).toMatchObject({ kind: 'written' });
    await watcher.tick();

    // The producer's guarantee: the re-emit is a fresh array (no run changed, so its content is equal), so the cache misses.
    expect(emitted).toHaveLength(3);
    expect(emitted[2]).not.toBe(emitted[1]);
    expect(emitted[2]).toEqual(emitted[1]);
    // And end to end, through `maskedFrame`, both sockets (the second send is a cache hit on the new array) carry it.
    const [pushedA, pushedB] = [await a.next(), await b.next()];
    expect([pushedA.stallQuietMs, pushedB.stallQuietMs]).toEqual([chosen, chosen]);
    expect(pushedA.runs).toEqual(movedA.runs);
  });
});

describe('stallQuietOf: the resolver\'s quiet half, which the runs frame reads', () => {
  const box = stallBoxArmingOf([], false);
  const row = (quietMs: unknown, level: unknown = 'follow') =>
    parseStallSettings({ kind: 'row', row: { level, quietMs, updatedAt: 1 } } as Parameters<typeof parseStallSettings>[0]);
  it.each([
    ['no stored row', parseStallSettings({ kind: 'absent' })],
    ['an unreadable read', parseStallSettings({ kind: 'unreadable', detail: 'boom' })],
    ['a row on the default', row(null)],
    ['a row with a set quiet time', row(4 * 3_600_000)],
    ['a set quiet time under a chosen level', row(3 * 3_600_000, 'live')],
    ['a set quiet time beside an unreadable level (the whole row falls back)', row(4 * 3_600_000, 'nonsense')],
    ['an unreadable quiet time', row(12_345)],
  ])('%s: the frame\'s value is the one the stall watch applies', (_name, parsed) => {
    expect(stallQuietOf(parsed)).toEqual({ quietMs: resolveStallWatch(box, parsed).quietMs, quietSource: resolveStallWatch(box, parsed).quietSource });
  });
  it('a set quiet time in a row that applies is chosen; anything else is the built-in', () => {
    expect(stallQuietOf(row(4 * 3_600_000)).quietMs).toBe(4 * 3_600_000);
    expect(stallQuietOf(row(4 * 3_600_000, 'nonsense')).quietMs).toBe(STALL_QUIET_MS);
    expect(stallQuietOf(parseStallSettings({ kind: 'absent' })).quietMs).toBe(STALL_QUIET_MS);
  });
});
