import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { FLEET_PROTO, FLEET_PROTO_MIN } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { loadSnapshot } from '../src/fleetstate.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
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

    // The dormant handshake (Rider E): `hello` is the FIRST frame, ahead of
    // the (awaited) fleet snapshot below — sent synchronously in the handler
    // before assembleFleet is even called.
    const hello = await next();
    expect(hello).toEqual({ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN });

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

    const hello = await next(); // hello precedes every fleet frame — see the test above
    expect(hello.type).toBe('hello');

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

  // — Task 10: the `runs` WS frame — additive, no FLEET_PROTO bump —
  describe('the `runs` frame', () => {
    it('a connecting client receives hello, then fleet, then runs — and a later transition re-emits it', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      const opened = coord.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      }) as { id: number };
      const deps = { ...testDeps(home), coord };
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      app = await buildServer(deps, bus, watcher);
      await watcher.tick();

      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const next = collect(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });

      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      const runs = await next();
      expect(runs.type).toBe('runs');
      expect(runs.runs.map((r: { id: number; state: string }) => [r.id, r.state])).toEqual([[opened.id, 'planned']]);

      // A real transition (`coord.advance`, the ONLY writer of `runs.state` —
      // `store.ts`'s own docstring) must re-emit the frame on the next tick.
      coord.advance(opened.id, 'dispatched', 'coordinator');
      await watcher.tick();
      const pushed = await next();
      expect(pushed.type).toBe('runs');
      expect(pushed.runs[0].state).toBe('dispatched');

      ws.close();
    });

    it('drops the frame from the broadcast when the JSON is unchanged', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      coord.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      });
      const deps = { ...testDeps(home), coord };
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      app = await buildServer(deps, bus, watcher);
      await watcher.tick();

      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const next = collect(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('runs');

      // Nothing about the run changed — a second tick must NOT re-emit.
      // Proven the same way the file's own `fleet` no-change test proves it:
      // fire a distinguishable frame afterwards and assert IT is what
      // arrives next, with no `runs` frame sitting in between.
      await watcher.tick();
      bus.emit('notice', { message: 'unrelated' });
      const msg = await next();
      expect(msg).toEqual({ type: 'notice', message: 'unrelated' });

      ws.close();
    });

    it('a server with no coord sends no runs frame at all', async () => {
      const deps = testDeps(home);
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      app = await buildServer(deps, bus, watcher);
      await watcher.tick();

      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const next = collect(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');

      await watcher.tick();
      bus.emit('notice', { message: 'unrelated' });
      // The very next frame is the notice — never a `runs` frame in between,
      // on the initial connect OR on any later tick.
      const msg = await next();
      expect(msg).toEqual({ type: 'notice', message: 'unrelated' });

      ws.close();
    });
  });

  // — Task 10, orchestrator-added scope: the durable feed table behind
  //   NotifyLog's in-memory ring —
  describe('GET /api/feed', () => {
    it('answers 501 without a coordination database', async () => {
      app = await buildServer(testDeps(home));
      const res = await app.inject({ method: 'GET', url: '/api/feed' });
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
    });

    it('answers recorded events oldest-first, with the limit clamped', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      // Recorded directly through the store — the same call `FleetWatcher.
      // pushOne` makes beside `notifyLog.record` — so this test does not
      // depend on the notify lanes' own triggering mechanism to prove the
      // route reads the table honestly.
      for (let i = 1; i <= 3; i++) {
        coord.recordFeedEvent('epoch-1', { seq: i, at: 1000 + i, kind: 'done', sessionId: 'cc-a', title: `t${i}`, body: '' });
      }
      app = await buildServer({ ...testDeps(home), coord });

      const all = await app.inject({ method: 'GET', url: '/api/feed' });
      expect(all.statusCode).toBe(200);
      expect((all.json() as { events: { seq: number }[] }).events.map((e) => e.seq)).toEqual([1, 2, 3]);

      // Clamped to the newest N, oldest-first within that window — never the
      // OLDEST N (a limited read must still show what just happened).
      const limited = await app.inject({ method: 'GET', url: '/api/feed?limit=2' });
      expect((limited.json() as { events: { seq: number }[] }).events.map((e) => e.seq)).toEqual([2, 3]);
    });

    it('survives a restart: the durable table still answers once the ring is empty', async () => {
      const dbPath = path.join(home, '.ccrc', 'coord.db');
      const logPath = path.join(home, '.ccrc', 'notify-log.json');

      // Round 1: a NotifyLog records one event and flushes its watermark;
      // the SAME event is written into the durable table, exactly as
      // `FleetWatcher.pushOne` does, beside each other, from the one call.
      const logA = new NotifyLog(logPath);
      await logA.load();
      const coordA = new CoordStore(openCoordDb(dbPath));
      const recorded = logA.record({ kind: 'mail', sessionId: 'cc-a', title: 'm1', body: 'b1' });
      await logA.flush();
      coordA.recordFeedEvent(logA.epoch, recorded);

      const appA = await buildServer({ ...testDeps(home), coord: coordA });
      const resA = await appA.inject({ method: 'GET', url: '/api/feed' });
      expect((resA.json() as { events: unknown[] }).events).toHaveLength(1);
      await appA.close();
      coordA.db.close();

      // Round 2 ("restart"): a FRESH CoordStore over the SAME coord.db file
      // still answers `GET /api/feed` — the archive is the point.
      const coordB = new CoordStore(openCoordDb(dbPath));
      const appB = await buildServer({ ...testDeps(home), coord: coordB });
      const resB = await appB.inject({ method: 'GET', url: '/api/feed' });
      const eventsB = (resB.json() as { events: { seq: number; title: string }[] }).events;
      expect(eventsB.map((e) => e.title)).toEqual(['m1']);
      await appB.close();

      // A FRESH NotifyLog over the SAME notify-log.json — the ring
      // `pushOne` reads — is the OTHER half of the same restart, and it is
      // NOT durable the way the table above is: `load()` adopts the
      // persisted {epoch,seq} pair, but the in-memory ring itself starts
      // empty, so a client that watermarked seq 0 (before this event was
      // ever recorded) cannot be proven caught up any more and resyncs to
      // an empty list — exactly the gap `feed_events` exists to answer.
      const logB = new NotifyLog(logPath);
      await logB.load();
      expect(logB.epoch).toBe(logA.epoch);       // the watermark survived...
      const caughtUp = logB.catchUp(logB.epoch, 0);
      expect(caughtUp.resync).toBe(true);         // ...the RING did not
      expect(caughtUp.events).toEqual([]);
    });
  });
});
