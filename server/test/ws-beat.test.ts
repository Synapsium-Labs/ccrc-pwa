/**
 * Console speed S2: the per-socket heartbeat of both sockets (`BEAT_MS`, `server/src/sessionws.ts`).
 *
 * A beat is an app frame because a browser cannot see pings, and it comes from a timer of the socket's own because
 * a beat driven by the watcher's tick would stop exactly when the tick is slow.
 *
 * Fake timers fake ONLY `setInterval` and `clearInterval`: the sockets are real (a loopback `ws` client), so message
 * delivery is real-time and only the beat's cadence is advanced by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { BEAT_MS, SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude-a-project-f';
const UUID_A = 'a'.repeat(36);
const WORKDIR = '/data/projects/project-f';
const MUNGED = '-data-projects-project-f';
const PID = 40613;

const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const sess = path.join(home, '.claude-a', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
  }));
  const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), JSON.stringify({
    uuid: 'u1', parentUuid: null, isSidechain: false, timestamp: '2026-07-20T21:00:00.000Z', type: 'user', message: { role: 'user', content: 'one' },
  }) + '\n');
};

const mkDeps = (home: string, io: FleetIO): Deps => {
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  return { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue() };
};

/** Every frame the socket receives, parsed, in arrival order. */
const record = (ws: WebSocket): Array<{ type: string; at?: number }> => {
  const frames: Array<{ type: string; at?: number }> = [];
  ws.on('message', (d) => { frames.push(JSON.parse(String(d))); });
  return frames;
};
const opened = (ws: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));
const beatsOf = (frames: Array<{ type: string }>): number => frames.filter((f) => f.type === 'beat').length;

describe('console speed S2: the beat of both sockets', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  let port: number;

  beforeEach(async () => {
    home = mkTmp('ccrc-beat-');
    seedRoster(home);
    seed(home);
    app = await buildServer(mkDeps(home, localIO), new Bus());
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
    app = undefined;
    rmSync(home, { recursive: true, force: true });
  });

  it('/ws/fleet sends a beat every 10 s on a quiet fleet', async () => {
    expect(BEAT_MS).toBe(10_000);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    const frames = record(ws);
    await opened(ws);
    await settle();
    expect(beatsOf(frames)).toBe(0);
    for (let i = 1; i <= 3; i += 1) {
      vi.advanceTimersByTime(BEAT_MS);
      await settle();
      expect(beatsOf(frames)).toBe(i);
    }
    const beat = frames.filter((f) => f.type === 'beat').at(-1);
    expect(typeof beat?.at).toBe('number');
    ws.close();
  });

  it('the beat timer stops on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const before = vi.getTimerCount();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    const frames = record(ws);
    await opened(ws);
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(before);
    ws.close();
    await settle();
    expect(vi.getTimerCount()).toBe(before);
    const seen = beatsOf(frames);
    vi.advanceTimersByTime(BEAT_MS * 3);
    await settle();
    expect(beatsOf(frames)).toBe(seen);
  });

  it('/ws/session/:id sends beats', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const frames = record(ws);
    await opened(ws);
    await settle(400);
    expect(beatsOf(frames)).toBe(0);
    for (let i = 1; i <= 2; i += 1) {
      vi.advanceTimersByTime(BEAT_MS);
      await settle();
      // the 2 s poll fakes along too and may emit other frames; only the beat count is in question
      expect(beatsOf(frames)).toBe(i);
    }
    ws.close();
  });

  it('a beat is sent while a tick is held', async () => {
    // Every read of the box never answers: `start()` is held at its first resolve, as a slow tick would be. The
    // beat is started before that first await, from the stream's own interval, so it still arrives.
    const held: FleetIO = new Proxy(localIO, {
      get: (target, prop, receiver) => {
        const v: unknown = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? () => new Promise(() => { /* never resolves */ }) : v;
      },
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const frames: Array<{ type: string }> = [];
    const stream = new SessionStream(mkDeps(home, held), new Bus(), ID, (m) => frames.push(m));
    void stream.start();
    await settle(50);
    expect(beatsOf(frames)).toBe(0);
    vi.advanceTimersByTime(BEAT_MS * 3);
    expect(beatsOf(frames)).toBe(3);
    stream.stop();
    vi.advanceTimersByTime(BEAT_MS * 3);
    expect(beatsOf(frames)).toBe(3);
  });
});
