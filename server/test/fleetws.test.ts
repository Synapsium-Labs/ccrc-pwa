import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { localIO, type FleetIO } from '../src/io.js';
import { loadSnapshot } from '../src/fleetstate.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const seedSession = (home: string, id: string, wrapper: string) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

// Queue-based collector so no message is dropped between sequential awaits.
//
// `divergence` FRAMES ARE DROPPED HERE, and that is about a race this file
// cannot otherwise win. `tick()` VOID-dispatches `sweepDivergences` (its own
// slower clock, its own lane), so `await watcher.tick()` in `connect` below does
// NOT await it — the census sweep is still in flight when the socket opens, and
// its frame lands wherever it lands, including between this file's `hello` and
// `fleet` assertions. Measured: 2 of 5 full-suite runs, none in isolation, which
// is exactly the load-sensitivity that shape produces.
//
// Dropping it is not looking away from a defect. The wire contract these tests
// pin is the COLD-START BURST's order — hello, fleet, runs, coord, all four
// chained inside one `.then` in `server.ts` — and frames are additive:
// `FLEET_PROTO` discipline says a client must tolerate an unknown frame arriving
// at any point, so asserting positional ADJACENCY over-specifies it. The census
// lane has its own suite (`divergence-sweep.test.ts`), which owns both the
// classifier and the `bus.on('divergence', …)` wiring pin.
const collect = (ws: WebSocket) => {
  const queue: unknown[] = [];
  const waiters: Array<(m: unknown) => void> = [];
  ws.on('message', (d) => {
    const m: unknown = JSON.parse(String(d));
    if ((m as { type?: unknown }).type === 'divergence') return;
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
    seedRoster(home);
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

    // Build 4: the cold start's LAST frame — this watcher has ticked, so it has
    // measured the markers and says so. Consumed here rather than ignored,
    // because the frames after it are what this test is actually about.
    expect((await next()).type).toBe('coord');

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
    const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
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
      ...testDeps(home), cfg, fleetState: { connected: false, downSince: Date.now(), ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath,
    };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick();

    expect(await loadSnapshot(cachePath)).toBeNull();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // C0.4: `fleetState.connected` alone does not mean the read that just
  // happened was COMPLETE — a wedged-yet-connected agent or a mid-sweep
  // socket hiccup still leaves `connected: true` while `assembleFleet`
  // returns fewer rows than last time. Without a guard, that partial tick
  // overwrites the fuller last-known-good cache — which `/api/fleet`
  // (server.ts) then serves as `stale: true` for the REST of a subsequent
  // real outage, not just for this one tick.
  it('a connected-but-degraded tick does not clobber a fuller last-known-good snapshot', async () => {
    const cacheDir = mkTmp('ccrc-cache-');
    const cachePath = path.join(cacheDir, 'state-cache.json');
    seedSession(home, 'claude-corp-orchard-api', 'claude-corp');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick(); // both sessions readable — writes a 2-row cache
    let snap = await loadSnapshot(cachePath);
    expect(snap?.sessions.map((s) => s.id).sort()).toEqual(
      ['claude-corp-orchard-api', 'claude2-MekWarLive'].sort(),
    );

    // One session's own `workdir` field goes unreadable — the exact shape a
    // partial/degraded read produces (registry.ts's "incomplete registry
    // entry" — readRegistry drops the row whole) — while `connected` stays
    // true throughout.
    rmSync(path.join(home, '.cc-sessions', 'claude-corp-orchard-api.workdir'));
    await watcher.tick(); // assembles only 1 row now

    snap = await loadSnapshot(cachePath);
    // The fuller 2-row snapshot survives; a 1-row assembly must never
    // clobber it.
    expect(snap?.sessions.map((s) => s.id).sort()).toEqual(
      ['claude-corp-orchard-api', 'claude2-MekWarLive'].sort(),
    );
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('a tick that GROWS the fleet still overwrites the cache — the guard only refuses a shrink', async () => {
    const cacheDir = mkTmp('ccrc-cache-');
    const cachePath = path.join(cacheDir, 'state-cache.json');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick(); // 1 row
    expect((await loadSnapshot(cachePath))?.sessions).toHaveLength(1);

    seedSession(home, 'claude-corp-orchard-api', 'claude-corp');
    await watcher.tick(); // 2 rows — a growth, not a shrink

    expect((await loadSnapshot(cachePath))?.sessions).toHaveLength(2);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('writes the very first snapshot even from an empty fleet — nothing on disk yet to clobber', async () => {
    const cacheDir = mkTmp('ccrc-cache-');
    const cachePath = path.join(cacheDir, 'state-cache.json');
    // No seeded session in this fresh home — an empty registry. The
    // DIRECTORY itself still has to exist, though (blocking review findings
    // 1/3): `tick()` now takes the typed `readRegistryMeasured` read, and
    // `io.readdir` on a directory that was NEVER created answers `null` —
    // the exact same shape as a directory that exists but cannot be read.
    // Without creating it, this test would exercise "unlistable", not
    // "genuinely empty", and `tick()` correctly (per THE PRINCIPLE's
    // evidence-not-time bound) fails shut on that rather than treating an
    // absent directory as proof of an empty fleet — the overloaded-null
    // conflation this whole ladder exists to remove.
    const emptyHome = mkTmp('ccrc-empty-');
    seedRoster(emptyHome);
    mkdirSync(path.join(emptyHome, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: emptyHome, CCRC_FLEET: 'remote' });
    const deps: Deps = { ...testDeps(emptyHome), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
    const watcher = new FleetWatcher(deps, new Bus());

    await watcher.tick();

    const snap = await loadSnapshot(cachePath);
    expect(snap?.sessions).toEqual([]);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // C0.4-FOLLOWUP (blocking review findings 1/2 on the shrink guard above): a
  // bare length comparison cannot tell "the fleet genuinely shrank" apart
  // from "this tick's read was partial" — and treating every shrink as the
  // latter turns one ordinary `ccd` purge (`_reg_purge`, called from
  // `cmd_ws_rm`/session rm, `ws-reap`, and `ws-gc --prune` alike — routine
  // teardown, not an edge case) into a PERMANENT freeze: every later tick,
  // however healthy, still sees fewer sessions than the pre-purge high-water
  // mark and refuses to write forever, silently.
  describe('the shrink guard tells a genuine purge from a partial read (C0.4-followup)', () => {
    const purgeRegistryEntry = (id: string) => {
      // `_reg_purge`'s own shape (ccd:110): every "$REG/$id.<field>" file for
      // the id is unlinked, the `.uuid` included — not just one field going
      // unreadable the way a mid-sweep hiccup would leave it.
      const reg = path.join(home, '.cc-sessions');
      for (const field of ['wrapper', 'project', 'workdir', 'uuid', 'started']) {
        rmSync(path.join(reg, `${id}.${field}`), { force: true });
      }
    };

    it('a genuine purge is allowed through immediately, and the cache keeps updating on every tick afterwards', async () => {
      const cacheDir = mkTmp('ccrc-cache-');
      const cachePath = path.join(cacheDir, 'state-cache.json');
      seedSession(home, 'claude-corp-orchard-api', 'claude-corp');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
      const watcher = new FleetWatcher(deps, new Bus());

      await watcher.tick(); // both sessions readable — writes a 2-row cache
      let snap = await loadSnapshot(cachePath);
      expect(snap?.sessions.map((s) => s.id).sort()).toEqual(
        ['claude-corp-orchard-api', 'claude2-MekWarLive'].sort(),
      );
      const firstSavedAt = snap!.savedAt;

      purgeRegistryEntry('claude-corp-orchard-api');
      await new Promise((r) => setTimeout(r, 3)); // guarantee Date.now() moves

      await watcher.tick(); // 1 row now — confirmed absent from the listing, not just unreadable
      snap = await loadSnapshot(cachePath);
      expect(snap?.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);
      expect(snap!.savedAt).toBeGreaterThan(firstSavedAt);
      const secondSavedAt = snap!.savedAt;

      // Not a one-tick exception — the survivor keeps getting a fresh
      // snapshot on every subsequent healthy tick, exactly as an unshrunk
      // fleet would.
      await new Promise((r) => setTimeout(r, 3));
      await watcher.tick();
      const laterSnap = await loadSnapshot(cachePath);
      expect(laterSnap!.savedAt).toBeGreaterThan(secondSavedAt);

      rmSync(cacheDir, { recursive: true, force: true });
    });

    it('reproduces the reported freeze scenario and proves it now heals: 5 healthy ticks after a purge all keep the cache at the true, current size', async () => {
      const cacheDir = mkTmp('ccrc-cache-');
      const cachePath = path.join(cacheDir, 'state-cache.json');
      seedSession(home, 'claude-corp-orchard-api', 'claude-corp');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
      const watcher = new FleetWatcher(deps, new Bus());

      await watcher.tick();
      expect((await loadSnapshot(cachePath))?.sessions).toHaveLength(2);

      purgeRegistryEntry('claude-corp-orchard-api');

      // On the OLD guard (`sessions.length >= prior.sessions.length` alone,
      // re-read from disk every tick) every one of these 5 ticks would still
      // read back 2 rows and an unchanged `savedAt` — the exact freeze the
      // review reproduced. The fix must drop to 1 and STAY there on every
      // single one of them, not just the first.
      for (let i = 0; i < 5; i++) {
        await watcher.tick();
        const snap = await loadSnapshot(cachePath);
        expect(snap?.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);
      }

      rmSync(cacheDir, { recursive: true, force: true });
    });

    it('a genuinely PARTIAL read (the id stays listed — a failed field read, not a purge) still refuses to shrink the cache, and warns exactly once', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cacheDir = mkTmp('ccrc-cache-');
      const cachePath = path.join(cacheDir, 'state-cache.json');
      seedSession(home, 'claude-corp-orchard-api', 'claude-corp');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const deps: Deps = { ...testDeps(home), cfg, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
      const watcher = new FleetWatcher(deps, new Bus());

      await watcher.tick();
      expect((await loadSnapshot(cachePath))?.sessions).toHaveLength(2);

      // Only ONE field goes unreadable — `.uuid` (and every sibling field)
      // stays listed, so the registry directory itself still names this id:
      // a read failure, never a purge.
      rmSync(path.join(home, '.cc-sessions', 'claude-corp-orchard-api.workdir'));

      await watcher.tick();
      await watcher.tick();
      await watcher.tick();

      const snap = await loadSnapshot(cachePath);
      expect(snap?.sessions.map((s) => s.id).sort()).toEqual(
        ['claude-corp-orchard-api', 'claude2-MekWarLive'].sort(),
      );
      // Warned once across all three refused ticks, not once per tick — the
      // freeze must be visible in the logs, but not spammed forever.
      const shrinkWarnings = warnSpy.mock.calls.filter(
        ([msg]) => typeof msg === 'string' && msg.includes('snapshot write skipped'),
      );
      expect(shrinkWarnings).toHaveLength(1);

      warnSpy.mockRestore();
      rmSync(cacheDir, { recursive: true, force: true });
    });
  });

  // Task 2 (registry ladder, the heal side): a DEGRADED row (listed, but one
  // identity field's BYTES came back null — `.workdir` etc STAYS in the
  // directory listing, unlike the "genuinely partial read" tests above, which
  // delete the field's file outright and so DROP the row instead) survives
  // `sessions.length` unchanged — `assembleFleet` still emits one
  // `FleetSession` per degraded record, carrying `unmeasured` non-empty. The
  // shrink guard above has nothing to say about it (no shrink occurred), so
  // it needs its own gate: never persist a degraded row as last-known-good.
  describe('a degraded row is never persisted as last-known-good, even at an unchanged length (Task 2)', () => {
    /** One specific field's BYTES come back null while the directory listing
     *  still names the file — the degrade shape, never the drop shape (see
     *  the block comment above). `degrade` is a closure flag, not a second
     *  `Deps`/`FleetWatcher`: the watcher instance (and its warn-once flags)
     *  must be the SAME one across ticks for the warn-once-per-episode
     *  assertions below to mean anything. */
    const degradableIO = (id: string, field: string): { io: FleetIO; setDegraded: (v: boolean) => void } => {
      let degrade = false;
      const io: FleetIO = { ...localIO, readFile: async (p) => (degrade && p.endsWith(`${id}.${field}`) ? null : localIO.readFile(p)) };
      return { io, setDegraded: (v) => { degrade = v; } };
    };

    it('skips the write on a degraded row and warns once — the fuller PRIOR snapshot (pre-degrade) survives untouched', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cacheDir = mkTmp('ccrc-cache-');
      const cachePath = path.join(cacheDir, 'state-cache.json');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const { io, setDegraded } = degradableIO('claude2-MekWarLive', 'workdir');
      const deps: Deps = { ...testDeps(home), cfg, io, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
      const watcher = new FleetWatcher(deps, new Bus());

      await watcher.tick(); // clean read — writes a 1-row cache
      let snap = await loadSnapshot(cachePath);
      expect(snap?.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);
      expect(snap?.sessions[0]?.unmeasured).toEqual([]);
      const firstSavedAt = snap!.savedAt;

      // Same length as before — this row DEGRADES, it is never dropped: the
      // file stays listed, only its content comes back null.
      setDegraded(true);
      await watcher.tick();

      snap = await loadSnapshot(cachePath);
      // The write was SKIPPED: the cache is still the pre-degrade snapshot,
      // byte for byte (same savedAt), never a fresh write of the guess.
      expect(snap?.savedAt).toBe(firstSavedAt);
      expect(snap?.sessions.map((s) => s.id)).toEqual(['claude2-MekWarLive']);

      const skipWarnings = warnSpy.mock.calls.filter(
        ([msg]) => typeof msg === 'string' && msg.includes('snapshot write skipped') && msg.includes('unmeasured identity field'),
      );
      expect(skipWarnings).toHaveLength(1);

      warnSpy.mockRestore();
      rmSync(cacheDir, { recursive: true, force: true });
    });

    it('resumes writing, with no further warning, the moment the row measures clean again', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cacheDir = mkTmp('ccrc-cache-');
      const cachePath = path.join(cacheDir, 'state-cache.json');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const { io, setDegraded } = degradableIO('claude2-MekWarLive', 'workdir');
      const deps: Deps = { ...testDeps(home), cfg, io, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
      const watcher = new FleetWatcher(deps, new Bus());

      await watcher.tick();
      const firstSavedAt = (await loadSnapshot(cachePath))!.savedAt;

      setDegraded(true);
      await watcher.tick(); // skipped
      expect((await loadSnapshot(cachePath))!.savedAt).toBe(firstSavedAt);

      await new Promise((r) => setTimeout(r, 3)); // guarantee Date.now() moves
      setDegraded(false); // healed
      await watcher.tick();
      const healedSnap = await loadSnapshot(cachePath);
      expect(healedSnap!.savedAt).toBeGreaterThan(firstSavedAt);
      expect(healedSnap?.sessions[0]?.unmeasured).toEqual([]);

      // One more degrade/heal cycle, to prove the warn-once flag actually
      // reset rather than staying permanently spent.
      setDegraded(true);
      await watcher.tick();

      const skipWarnings = warnSpy.mock.calls.filter(
        ([msg]) => typeof msg === 'string' && msg.includes('snapshot write skipped') && msg.includes('unmeasured identity field'),
      );
      expect(skipWarnings).toHaveLength(2); // one per episode, not one total and not one per tick

      warnSpy.mockRestore();
      rmSync(cacheDir, { recursive: true, force: true });
    });

    it('the very FIRST tick, with nothing on disk yet, also refuses to write a degraded assembly — there is no last-known-good to prefer over silence', async () => {
      const cacheDir = mkTmp('ccrc-cache-');
      const cachePath = path.join(cacheDir, 'state-cache.json');
      const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
      const { io, setDegraded } = degradableIO('claude2-MekWarLive', 'workdir');
      setDegraded(true);
      const deps: Deps = { ...testDeps(home), cfg, io, fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null }, stateCachePath: cachePath };
      const watcher = new FleetWatcher(deps, new Bus());

      await watcher.tick();

      expect(await loadSnapshot(cachePath)).toBeNull();
      rmSync(cacheDir, { recursive: true, force: true });
    });
  });

  // C0.1: `tick()` had no re-entrancy guard, so a tick still in flight past
  // the next `intervalMs` edge got a second one stacked on top of it.
  describe('tick() re-entrancy (C0.1)', () => {
    it('a second tick() called while the first is still awaiting its registry read returns immediately', async () => {
      let readdirCalls = 0;
      let releaseFirst: (() => void) | null = null;
      const gatedIO: FleetIO = {
        ...localIO,
        readdir: async (p) => {
          readdirCalls++;
          if (readdirCalls === 1) {
            await new Promise<void>((resolve) => { releaseFirst = resolve; });
          }
          return localIO.readdir(p);
        },
      };
      const deps: Deps = { ...testDeps(home), io: gatedIO };
      const watcher = new FleetWatcher(deps, new Bus(), 10_000);
      const tick = (): Promise<void> => (watcher as unknown as { tick: () => Promise<void> }).tick();

      const p1 = tick();
      await vi.waitFor(() => expect(readdirCalls).toBeGreaterThanOrEqual(1));
      const callsBeforeSecondTick = readdirCalls;

      const p2 = tick();
      // The guard must return p2 WITHOUT waiting for the first tick's blocked
      // read — if it stacked instead, p2 would still be pending 300ms later
      // (it would be blocked on the SAME unresolved read, or a fresh one).
      await Promise.race([
        p2,
        new Promise((_, reject) => setTimeout(() => reject(new Error('second tick() did not return early — it stacked')), 300)),
      ]);
      // And it did no new work: no second readdir was fired.
      expect(readdirCalls).toBe(callsBeforeSecondTick);

      releaseFirst!();
      await p1;

      // The guard resets after the in-flight tick finishes: a later tick runs normally.
      await tick();
      expect(readdirCalls).toBeGreaterThan(callsBeforeSecondTick);
    });
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
      expect((await next()).type).toBe('coord');   // Build 4: hello, fleet, runs, coord

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
      expect((await next()).type).toBe('coord');

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
      // Build 4: `coord` still arrives on a coord-LESS server — a pause is a
      // fleet-host file, not a run, so it does not ride `deps.coord`.
      expect((await next()).type).toBe('coord');

      await watcher.tick();
      bus.emit('notice', { message: 'unrelated' });
      // The very next frame is the notice — never a `runs` frame in between,
      // on the initial connect OR on any later tick.
      const msg = await next();
      expect(msg).toEqual({ type: 'notice', message: 'unrelated' });

      ws.close();
    });

    // Review finding 1. `coord.runs()` here sits inside a `.then()` callback
    // with no `.catch` anywhere on its chain: an unguarded throw becomes an
    // unhandled promise rejection and kills the WHOLE server, not just this
    // one connecting socket. Closing the connection reproduces the same class
    // of synchronous `node:sqlite` throw a full disk or a lock race would.
    it('a broken coord.db degrades the cold-start runs frame instead of crashing the connect handler', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      coord.openRun({
        program: 'build7', title: 'Fleet coordination', project: 'ccrc-pwa',
        wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
      });
      coord.db.close();
      const deps = { ...testDeps(home), coord };
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      app = await buildServer(deps, bus, watcher);
      // Deliberately NOT ticked — this isolates the `/ws/fleet` connect
      // handler's own guard from `FleetWatcher`'s (which has its own tests).

      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const next = collect(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });

      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      // No `runs` frame ever arrives — the read failed and was swallowed,
      // never sent broken — and, more importantly, the SERVER survived: a
      // second, unrelated frame still reaches this same socket afterward.
      bus.emit('notice', { message: 'still alive' });
      const msg = await next();
      expect(msg).toEqual({ type: 'notice', message: 'still alive' });

      expect(warnSpy.mock.calls.some(([line]) =>
        String(line).includes('/ws/fleet cold-start runs() failed'))).toBe(true);

      ws.close();
    });
  });

  // — Build 4 Task 8: the `{type:'coord'}` frame — the pause marker and the
  //   mail kill-switch reach the wire, off the tick's OWN registry listing —
  describe('the `coord` frame', () => {
    /** A server + watcher + connected socket, with the boilerplate every case
     *  below repeats. `tick` false leaves the watcher unprimed, which is the
     *  "never measured" state one case exists to pin. */
    const connect = async (over: Partial<Deps> = {}, opts: { tick?: boolean } = {}) => {
      const deps = { ...testDeps(home), ...over };
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      app = await buildServer(deps, bus, watcher);
      if (opts.tick !== false) await watcher.tick();
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const next = collect(ws);
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
      return { ws, next, watcher, bus };
    };

    const marker = (name: string) => writeFileSync(path.join(home, '.cc-sessions', name), '');

    it('sends coord after hello/fleet/runs on connect, when it has ever measured', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      const { ws, next } = await connect({ coord });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('runs');
      // LAST, deliberately: chained after `runs` inside the same `.then`, so
      // the wire order every client relies on is hello, fleet, runs, coord.
      const frame = await next();
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear' });
      ws.close();
    });

    it('sends NOTHING for coord before the first tick — never a fabricated "clear"', async () => {
      // `currentCoord()` is null until a tick has measured. A cold start that
      // invented `clear` would tell the phone the fleet is running on a box
      // this process has never looked at.
      const { ws, next, bus } = await connect({}, { tick: false });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      bus.emit('notice', { message: 'unrelated' });
      expect(await next()).toEqual({ type: 'notice', message: 'unrelated' });
      ws.close();
    });

    it('re-emits only on CHANGE, byte-equality guarded like runs', async () => {
      const { ws, next, watcher, bus } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('coord');

      await watcher.tick();                       // nothing moved
      bus.emit('notice', { message: 'unrelated' });
      expect(await next()).toEqual({ type: 'notice', message: 'unrelated' });

      marker('coordinator-paused');               // now it moved
      await watcher.tick();
      const frame = await next();
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'set', mail: 'clear' });
      ws.close();
    });

    it('reports set for coordinator-paused and clear for mail-disabled independently', async () => {
      marker('mail-disabled');
      const { ws, next, watcher } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set' });

      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'set' });
      ws.close();
    });

    // THE TWO CASES THE EMITTER EXISTS FOR. `dispatchRun` treats an unlistable
    // registry as a pause it cannot rule out and FAILS SHUT, so the wire must
    // be able to say the same thing — on the very tick it happens.
    it('reports unmeasurable for BOTH markers when the registry cannot be listed', async () => {
      const unlistable: FleetIO = { ...localIO, readdir: async () => null };
      const { ws, next, watcher } = await connect({ io: unlistable }, { tick: false });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      await watcher.tick();
      const frame = await next();
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable' });
      ws.close();
    });

    it('emits coord on the tick that FAILS SHUT — before the early return, not after it', async () => {
      // A whole tick, driven from a healthy read into an unlistable one. The
      // `!listed` arm returns 236 lines above `emitRuns()`, so an emitter
      // placed beside THAT one never runs here: the banner would sit frozen on
      // `clear` while the server refused every dispatch — the precise lie
      // `unmeasurable` was minted to prevent.
      let listable = true;
      const flaky: FleetIO = { ...localIO, readdir: async (p) => (listable ? localIO.readdir(p) : null) };
      const { ws, next, watcher } = await connect({ io: flaky });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear' });

      listable = false;
      await watcher.tick();     // this tick returns early — and still reports
      const frame = await next();
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable' });

      // And nothing ELSE was broadcast on that tick: the fail-shut return still
      // skips the fleet snapshot, exactly as it did before this frame existed.
      listable = true;
      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear' });
      ws.close();
    });

    it('an old client still shrugs: an unknown frame type is dropped silently', async () => {
      // The additive-frame rule, exercised against the reader every deployed
      // PWA runs — `asFleetMsg` in `pwa/src/stores/fleet.ts` owns the client
      // half; here the pin is that the frame is additive on the WIRE: a client
      // that only knows hello/fleet/runs receives coord as an ordinary JSON
      // object with a `type` it does not match, and the socket stays usable.
      const { ws, next, bus } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      const coordFrame = await next();
      expect(Object.keys(coordFrame).sort()).toEqual(['coord', 'type']);
      bus.emit('notice', { message: 'still alive' });
      expect(await next()).toEqual({ type: 'notice', message: 'still alive' });
      ws.close();
    });

    it('does not bump FLEET_PROTO', async () => {
      // Additive frames are the one-way new-writer/old-reader rule this repo
      // already states; bumping the handshake would be a lie about the change.
      const { ws, next } = await connect();
      const hello = await next();
      expect(hello).toEqual({ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN });
      expect(FLEET_PROTO).toBe(1);
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
