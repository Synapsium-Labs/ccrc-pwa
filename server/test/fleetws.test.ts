import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { loadSnapshot } from '../src/fleetstate.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

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
    home = mkTmp('ccrc-');
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

  it('a NEW /ws/fleet client sees an ALREADY-pending dialog on connect', async () => {
    const menuPane = [
      'Which fix?',
      '❯ 1. Flip the default (Recommended)',
      '  2. Keep safe-by-default',
      '',
      'Enter to select · ↑/↓ to navigate · Esc to cancel',
    ].join('\n');
    const run: Runner = async (_cmd, args) => {
      if (args.includes('has-session')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('list-panes')) return { code: 0, stdout: '4242\n', stderr: '' };
      if (args.includes('capture-pane')) return { code: 0, stdout: menuPane, stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const deps = testDeps(home, run);
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    app = await buildServer(deps, bus, watcher);
    await watcher.tick(); // watcher detects the dialog BEFORE any client connects

    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    const next = collect(ws);
    await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });

    const snapshot = await next();
    expect(snapshot.type).toBe('fleet');
    const s = snapshot.sessions.find((x: { id: string }) => x.id === 'claude2-MekWarLive');
    // The bug: this was `false` — the initial push omitted pendingDialogs, so the
    // "needs you" marker never showed on the fleet overview for a pre-existing dialog.
    expect(s.dialogPending).toBe(true);
    ws.close();
  });

  it('FleetWatcher persists a snapshot to the state cache on each poll while remote+connected', async () => {
    const cacheDir = mkTmp('ccrc-cache-');
    const cachePath = path.join(cacheDir, 'state-cache.json');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null }, stateCachePath: cachePath };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick();

    const snap = await loadSnapshot(cachePath);
    expect(snap?.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('does NOT persist a snapshot while remote+disconnected — the cache keeps the last-known-good data', async () => {
    const cacheDir = mkTmp('ccrc-cache-');
    const cachePath = path.join(cacheDir, 'state-cache.json');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const deps: Deps = {
      ...testDeps(home), cfg, fleetState: { connected: false, downSince: Date.now(), ccdVerbs: null }, stateCachePath: cachePath,
    };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick();

    expect(await loadSnapshot(cachePath)).toBeNull();
    rmSync(cacheDir, { recursive: true, force: true });
  });
});
