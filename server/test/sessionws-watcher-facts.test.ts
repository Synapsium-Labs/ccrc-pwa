// Console speed S2: a chat stream takes its row facts from the watcher's last tick and re-resolves on change
// (a `row:<id>` event, the tailer's rotation, a 30 s backstop) instead of every 2 s. D-8611: the stream has no timer of
// its own but the backstop. A status change reaches it in the watcher's fleet frame (`'fleet'`), and a box with no
// watcher (`NO_TICK`) re-resolves on the backstop alone.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { NO_TICK, SessionStream, STREAM_BACKSTOP_MS, type RowFactsSource } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import type { FleetSession, SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const ID = 'claude-a-project-f';
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const WORKDIR = '/data/projects/project-f';
const MUNGED = '-data-projects-project-f';
const PID = 40613;

const line = (uuid: string, text: string): string =>
  JSON.stringify({ uuid, parentUuid: null, isSidechain: false, timestamp: '2026-07-20T21:00:00.000Z', type: 'user',
    message: { role: 'user', content: text } }) + '\n';

describe('a chat stream and the watcher\'s row facts (console speed S2)', () => {
  let home: string;
  let deps: Deps;
  let hasSession: number;
  let listPanes: number;
  let registryListings: number;
  let record: SessionRecord;
  let factsReads: number;
  let listedAgeMs: number;
  /** The row the watcher's next fleet frame holds for the session; null is a frame without it. */
  let listing: { status: 'busy' | 'idle' | 'dead'; statusUpdatedAt: number | null } | null;
  /** While set, every io read waits on it: a tick held in flight. */
  let hold: Promise<void> | null;
  let bus: Bus;
  const LIVE_AT = 1784582728369;
  const frames: SessionStreamMsg[] = [];

  const source: RowFactsSource = {
    currentRowFacts: () => {
      factsReads += 1;
      onFactsRead?.();
      return { record: structuredClone(record), verdict: { verdict: 'live' }, pid: PID, listedAt: Date.now() - listedAgeMs };
    },
  };
  /** The watcher's fleet frame, as its tick sends one when the listing changed. */
  const fleetFrame = (): void => { bus.emit('fleet', listing === null ? [] : [{ id: ID, ...listing } as FleetSession]); };
  let onFactsRead: (() => void) | undefined;
  const liveFile = (status: string, at: number): void => {
    writeFileSync(path.join(home, '.claude-a', 'sessions', `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status, statusUpdatedAt: at, version: '2.1.210',
    }));
  };
  const statusFrames = (): unknown[] => frames.filter((f) => f.type === 'status');

  const regField = (name: string, v: string): void => writeFileSync(path.join(home, '.cc-sessions', `${ID}.${name}`), v);

  beforeEach(async () => {
    home = mkTmp('ccrc-sws-facts-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const fields = { wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' };
    for (const [k, v] of Object.entries(fields)) regField(k, v);
    const sess = path.join(home, '.claude-a', 'sessions');
    mkdirSync(sess, { recursive: true });
    writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
    mkdirSync(tdir, { recursive: true });
    writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), line('u1', 'one'));
    writeFileSync(path.join(tdir, `${UUID_B}.jsonl`), line('w1', 'after the swap'));
    hasSession = 0; listPanes = 0; registryListings = 0; factsReads = 0; listedAgeMs = 0;
    listing = { status: 'idle', statusUpdatedAt: LIVE_AT }; hold = null; onFactsRead = undefined; bus = new Bus();
    frames.length = 0;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') { hasSession += 1; return { ran: true, code: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'list-panes') { listPanes += 1; return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' }; }
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const wait = async (): Promise<void> => { if (hold) await hold; };
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => { if (p === cfg.registryDir) registryListings += 1; await wait(); return localIO.readdir(p); },
      stat: async (p) => { await wait(); return localIO.stat(p); },
      statMeasured: async (p) => { await wait(); return localIO.statMeasured(p); },
      readFileMeasured: async (p) => { await wait(); return localIO.readFileMeasured(p); },
    };
    deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue(), time: fakeTime().ports };
    const read = await readSessionRecord(localIO, cfg, ID);
    if (read.kind !== 'found') throw new Error('fixture row unreadable');
    record = read.record;
    registryListings = 0;
  });
  afterEach(() => { vi.useRealTimers(); rmSync(home, { recursive: true, force: true }); });

  const open = async (watcher: RowFactsSource): Promise<SessionStream> => {
    const s = new SessionStream(deps, bus, ID, (m) => frames.push(m), undefined, watcher);
    await s.start();
    return s;
  };
  const rotatedUuids = (): string[] => frames.flatMap((f) => (f.type === 'rotated' ? [f.uuid] : []));

  it('opening a chat with fresh facts makes no has-session, list-panes or registry read', async () => {
    const s = await open(source);
    try {
      expect(frames.some((f) => f.type === 'backlog')).toBe(true);
      expect(frames.filter((f) => f.type === 'status')).toEqual([{ type: 'status', status: 'idle', statusUpdatedAt: 1784582728369 }]);
      expect({ hasSession, listPanes, registryListings }).toEqual({ hasSession: 0, listPanes: 0, registryListings: 0 });
    } finally { s.stop(); }
  });

  it('a quiet open chat makes no resolve for 25 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(source);
    try {
      const reads = factsReads;
      await vi.advanceTimersByTimeAsync(25_000);
      expect(factsReads).toBe(reads);
      expect({ hasSession, listPanes, registryListings }).toEqual({ hasSession: 0, listPanes: 0, registryListings: 0 });
    } finally { s.stop(); }
  });

  it('a swap re-resolves within one row event and sends rotated', async () => {
    const s = await open(source);
    try {
      record = { ...record, uuid: UUID_B };
      bus.emit(`row:${ID}`, { listedAt: Date.now() });
      await vi.waitFor(() => expect(rotatedUuids()).toEqual([UUID_B]));
      expect(factsReads).toBeGreaterThan(1);
    } finally { s.stop(); }
  });

  it('the 30 s backstop re-resolves', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(source);
    try {
      record = { ...record, uuid: UUID_B };
      await vi.advanceTimersByTimeAsync(STREAM_BACKSTOP_MS - 1000);
      expect(rotatedUuids()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(rotatedUuids()).toEqual([UUID_B]));   // the tick's file reads are real I/O
    } finally { s.stop(); }
  });

  it('stale facts fall back to today\'s resolve', async () => {
    listedAgeMs = 60_000;
    const s = await open(source);
    try {
      expect(frames.some((f) => f.type === 'backlog')).toBe(true);
      expect(hasSession).toBe(1);
      expect(listPanes).toBeGreaterThan(0);
      expect(registryListings).toBeGreaterThan(0);
    } finally { s.stop(); }
  });

  it('a stream given a watcher reads its row facts', async () => {
    const s = await open(source);
    try { expect(factsReads).toBeGreaterThan(0); } finally { s.stop(); }
  });

  it('a box with no watcher (NO_TICK): the stream reads for itself and re-resolves on the backstop alone (D-8611)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(NO_TICK);
    try {
      expect({ hasSession, listPanes }).toEqual({ hasSession: 1, listPanes: 1 });
      expect(registryListings).toBeGreaterThan(0);
      const before = registryListings;
      await vi.advanceTimersByTimeAsync(STREAM_BACKSTOP_MS - 1000);
      expect(registryListings, 'no 2 s poll: nothing re-reads before the backstop').toBe(before);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(registryListings).toBeGreaterThan(before));
      expect(factsReads).toBe(0);
      expect({ row: bus.listenerCount(`row:${ID}`), fleet: bus.listenerCount('fleet') }, 'it listens as a watched stream does')
        .toEqual({ row: 1, fleet: 1 });
    } finally { s.stop(); }
  });

  it('NO_TICK has no row facts (D-8611)', () => {
    expect(NO_TICK.currentRowFacts(ID)).toBeNull();
  });

  it('a stream is never built without a row-facts source (D-8611)', () => {
    // @ts-expect-error -- the source is required: the server hands the watcher, or NO_TICK on a box without one
    const make = (): SessionStream => new SessionStream(deps, bus, ID, () => undefined, undefined);
    expect(typeof make).toBe('function');
  });

  it('a stream given a watcher stops listening for its row and the fleet when it stops', async () => {
    const s = await open(source);
    expect({ row: bus.listenerCount(`row:${ID}`), fleet: bus.listenerCount('fleet') }).toEqual({ row: 1, fleet: 1 });
    s.stop();
    expect({ row: bus.listenerCount(`row:${ID}`), fleet: bus.listenerCount('fleet') }).toEqual({ row: 0, fleet: 0 });
  });

  it('a row event during an in-flight tick is not lost', async () => {
    const s = await open(source);
    try {
      let release: () => void = () => undefined;
      hold = new Promise<void>((r) => { release = r; });
      bus.emit(`row:${ID}`, { listedAt: Date.now() });            // a tick starts and waits on its reads
      await vi.waitFor(() => expect(factsReads).toBeGreaterThan(1));
      record = { ...record, uuid: UUID_B };                       // the second half of a swap lands mid-tick
      bus.emit(`row:${ID}`, { listedAt: Date.now() });            // skipped by the no-overlap rule, and kept
      hold = null; release();
      await vi.waitFor(() => expect(rotatedUuids()).toEqual([UUID_B]));
    } finally { s.stop(); }
  });

  it('a backstop that finds a tick in flight drops, as before: only a change is kept (fix round 1, F2)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(source);
    const ticking = (): boolean => (s as unknown as { ticking: boolean }).ticking;
    try {
      const before = factsReads;
      let release: () => void = () => undefined;
      hold = new Promise<void>((r) => { release = r; });
      await vi.advanceTimersByTimeAsync(STREAM_BACKSTOP_MS);      // the backstop's tick starts and waits on its reads
      await vi.waitFor(() => expect(factsReads).toBe(before + 1));
      await vi.advanceTimersByTimeAsync(STREAM_BACKSTOP_MS);      // the next backstop finds it in flight
      expect(ticking()).toBe(true);
      hold = null; release();
      await vi.waitFor(() => expect(ticking()).toBe(false));
      await new Promise((r) => setTimeout(r, 50));                // room for a kept trigger's tick to start
      expect(factsReads, 'a dropped backstop ran no tick when the held one ended').toBe(before + 1);
    } finally { s.stop(); }
  });

  it('a status change in a fleet frame during an in-flight tick is kept (D-8611)', async () => {
    const s = await open(source);
    try {
      let release: () => void = () => undefined;
      hold = new Promise<void>((r) => { release = r; });
      bus.emit(`row:${ID}`, { listedAt: Date.now() });            // a tick starts and waits on its reads
      await vi.waitFor(() => expect(factsReads).toBeGreaterThan(1));
      record = { ...record, uuid: UUID_B };
      listing = { status: 'busy', statusUpdatedAt: LIVE_AT + 1000 };
      fleetFrame();                                               // skipped by the no-overlap rule, and kept
      hold = null; release();
      await vi.waitFor(() => expect(rotatedUuids()).toEqual([UUID_B]));
    } finally { s.stop(); }
  });

  it('a row event during start runs a tick once the stream is armed', async () => {
    let first = true;
    onFactsRead = () => { if (first) { first = false; bus.emit(`row:${ID}`, { listedAt: Date.now() }); queueMicrotask(() => { record = { ...record, uuid: UUID_B }; }); } };
    const s = await open(source);
    try { await vi.waitFor(() => expect(rotatedUuids()).toEqual([UUID_B])); } finally { s.stop(); }
  });

  it('a working-to-idle flip in the watcher\'s fleet frame reaches the stream (D-8611)', async () => {
    liveFile('busy', LIVE_AT - 5000);
    listing = { status: 'busy', statusUpdatedAt: LIVE_AT - 5000 };
    const s = await open(source);
    try {
      expect(statusFrames()).toEqual([{ type: 'status', status: 'busy', statusUpdatedAt: LIVE_AT - 5000 }]);
      liveFile('idle', LIVE_AT);
      listing = { status: 'idle', statusUpdatedAt: LIVE_AT };
      fleetFrame();
      await vi.waitFor(() => expect(statusFrames().at(-1)).toEqual({ type: 'status', status: 'idle', statusUpdatedAt: LIVE_AT }));
    } finally { s.stop(); }
  });

  it('a new statusUpdatedAt under the same status runs a tick', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(source);
    const tick = vi.spyOn(s as unknown as { tick: () => Promise<void> }, 'tick');
    try {
      listing = { status: 'idle', statusUpdatedAt: LIVE_AT + 1000 };
      fleetFrame();
      expect(tick).toHaveBeenCalledTimes(1);
    } finally { s.stop(); }
  });

  it('an unchanged row in a fleet frame runs no tick', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(source);
    const tick = vi.spyOn(s as unknown as { tick: () => Promise<void> }, 'tick');
    try {
      fleetFrame();
      await vi.advanceTimersByTimeAsync(10_000);
      fleetFrame();
      expect(tick).not.toHaveBeenCalled();
    } finally { s.stop(); }
  });

  it('a fleet frame without the row runs no tick: its row event says it left, and the backstop covers the rest (D-8611)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open(source);
    const tick = vi.spyOn(s as unknown as { tick: () => Promise<void> }, 'tick');
    try {
      listing = null;
      fleetFrame();
      await vi.advanceTimersByTimeAsync(STREAM_BACKSTOP_MS - 1000);
      expect(tick, 'no frame of its own and no 2 s look at the listing').not.toHaveBeenCalled();
    } finally { s.stop(); }
  });

  it('a stream given a watcher installs no triggers when it starts absent', async () => {
    rmSync(path.join(home, '.cc-sessions', `${ID}.uuid`));
    listedAgeMs = 60_000;                                          // stale facts: the stream reads the registry itself
    const s = await open(source);
    try {
      expect(frames.some((f) => f.type === 'notice')).toBe(true);
      expect({ row: bus.listenerCount(`row:${ID}`), fleet: bus.listenerCount('fleet') }).toEqual({ row: 0, fleet: 0 });
      expect((s as unknown as { backstop: unknown }).backstop).toBeNull();
    } finally { s.stop(); }
  });
});
