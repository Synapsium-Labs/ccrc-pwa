import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { loadSnapshot } from '../src/fleetstate.js';
import { testDeps } from './helpers.js';

const seedSession = (home: string, id: string, wrapper: string) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

// Queue-based collector so no message is dropped between sequential awaits.
const collect = (ws: WebSocket) => {
  const queue: unknown[] = [];
  const waiters: Array<(m: unknown) => void> = [];
  ws.on('message', (d) => {
    const m: unknown = JSON.parse(String(d));
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return (): Promise<any> =>
    new Promise((resolve, reject) => {
      if (queue.length > 0) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error('timed out waiting for ws message')), 3000);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
};

describe('fleet REST + WS', () => {
  let home: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude2-MekWarLive', 'claude2');
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    rmSync(home, { recursive: true, force: true });
  });

  it('GET /api/fleet returns assembled sessions', async () => {
    app = await buildServer(testDeps(home));
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<{ id: string; status: string }> };
    expect(body.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);
    expect(body.sessions[0]!.status).toBe('dead');
  });

  it('WS /ws/fleet sends a snapshot on connect, then pushes fleet changes and notices', async () => {
    const deps = testDeps(home);
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    app = await buildServer(deps, bus, watcher);
    await watcher.tick(); // prime the watcher's diff state before any client connects

    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    const next = collect(ws);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const snapshot = await next();
    expect(snapshot.type).toBe('fleet');
    expect(snapshot.sessions.map((s: { id: string }) => s.id)).toEqual(['claude2-MekWarLive']);

    seedSession(home, 'claude-corp-orchard-api', 'claude-corp');
    await watcher.tick(); // registry changed -> emits
    const pushed = await next();
    expect(pushed.type).toBe('fleet');
    expect(pushed.sessions.map((s: { id: string }) => s.id)).toEqual([
      'claude-corp-orchard-api',
      'claude2-MekWarLive',
    ]);

    await watcher.tick(); // no change -> must NOT emit; next message must be the notice below
    bus.emit('notice', { message: 'cc swap: claude2-MekWarLive moved claude2 -> claude' });
    const notice = await next();
    expect(notice).toEqual({ type: 'notice', message: 'cc swap: claude2-MekWarLive moved claude2 -> claude' });

    ws.close();
  });

  it('FleetWatcher persists a snapshot to the state cache on each poll while remote+connected', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'ccrc-cache-'));
    const cachePath = path.join(cacheDir, 'state-cache.json');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null }, stateCachePath: cachePath };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick();

    const snap = await loadSnapshot(cachePath);
    expect(snap?.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('does NOT persist a snapshot while remote+disconnected — the cache keeps the last-known-good data', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'ccrc-cache-'));
    const cachePath = path.join(cacheDir, 'state-cache.json');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const deps: Deps = {
      ...testDeps(home), cfg, fleetState: { connected: false, downSince: Date.now() }, stateCachePath: cachePath,
    };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick();

    expect(await loadSnapshot(cachePath)).toBeNull();
    rmSync(cacheDir, { recursive: true, force: true });
  });
});
