// Console speed S2: a chat stream takes its row facts from the watcher's last tick and re-resolves on change
// (a `row:<id>` event, the tailer's rotation, a 30 s backstop) instead of every 2 s. With no watcher the stream is
// exactly what it was: the 2 s poll and today's reads.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { SessionStream, STREAM_BACKSTOP_MS, type RowFactsSource } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

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
  const frames: SessionStreamMsg[] = [];

  const source: RowFactsSource = {
    currentRowFacts: () => {
      factsReads += 1;
      return { record: structuredClone(record), verdict: { verdict: 'live' }, pid: PID, listedAt: Date.now() - listedAgeMs };
    },
  };

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
    frames.length = 0;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') { hasSession += 1; return { ran: true, code: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'list-panes') { listPanes += 1; return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' }; }
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const io: FleetIO = {
      ...localIO,
      readdir: (p) => { if (p === cfg.registryDir) registryListings += 1; return localIO.readdir(p); },
    };
    deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue() };
    const read = await readSessionRecord(localIO, cfg, ID);
    if (read.kind !== 'found') throw new Error('fixture row unreadable');
    record = read.record;
    registryListings = 0;
  });
  afterEach(() => { vi.useRealTimers(); rmSync(home, { recursive: true, force: true }); });

  const open = async (watcher?: RowFactsSource, bus = new Bus()): Promise<SessionStream> => {
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
    const bus = new Bus();
    const s = await open(source, bus);
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

  it('a stream with no watcher behaves as before', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = await open();
    try {
      expect({ hasSession, listPanes }).toEqual({ hasSession: 1, listPanes: 1 });
      expect(registryListings).toBeGreaterThan(0);
      const before = registryListings;
      await vi.advanceTimersByTimeAsync(2000);
      expect(registryListings).toBeGreaterThan(before);   // the 2 s poll still resolves
      expect(factsReads).toBe(0);
    } finally { s.stop(); }
  });

  it('a stream given a watcher stops listening for its row when it stops', async () => {
    const bus = new Bus();
    const s = await open(source, bus);
    expect(bus.listenerCount(`row:${ID}`)).toBe(1);
    s.stop();
    expect(bus.listenerCount(`row:${ID}`)).toBe(0);
  });
});
