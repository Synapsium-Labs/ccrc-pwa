import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';

/** Stub in place of node-pty: records writes/resizes/kill, emits one queued output frame. */
class StubPty implements PtyLike {
  written: string[] = [];
  resized: Array<{ cols: number; rows: number }> = [];
  killed = false;
  onData(listener: (data: string) => void): { dispose(): void } {
    queueMicrotask(() => listener('WELCOME-FROM-TMUX'));   // tmux repaints the screen on attach
    return { dispose: () => {} };
  }
  write(data: string): void { this.written.push(data); }
  resize(cols: number, rows: number): void { this.resized.push({ cols, rows }); }
  kill(): void { this.killed = true; }
}

const opened = (ws: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

const wait = { timeout: 3000 };

describe('pty drawer bridge', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('WS /ws/pty/:id streams output, forwards input/resize, kills + restores size on close', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: '', stderr: '' };
    };
    const stub = new StubPty();
    let spawned: { id: string; cols: number; rows: number } | undefined;
    const deps = {
      ...testDeps(undefined, run),
      spawnPty: (id: string, cols: number, rows: number) => {
        spawned = { id, cols, rows };
        return stub;
      },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=120&rows=40`);
    const frames: string[] = [];
    ws.on('message', (d) => frames.push(String(d)));   // attach before open: no frame may slip past
    await opened(ws);

    // spawned with the id and the client's dimensions
    await vi.waitFor(() => expect(spawned).toEqual({ id: 'claude2-MekWarLive', cols: 120, rows: 40 }), wait);

    // server -> client: raw utf8 text frames of terminal output
    await vi.waitFor(() => expect(frames).toContain('WELCOME-FROM-TMUX'), wait);

    // client -> server: input + resize JSON frames
    ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
    await vi.waitFor(() => expect(stub.written).toContain('ls\r'), wait);
    ws.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));
    await vi.waitFor(() => expect(stub.resized).toContainEqual({ cols: 90, rows: 28 }), wait);

    // close: kill the pty AND restore the canonical tmux window size via the Runner
    ws.close();
    await vi.waitFor(() => expect(stub.killed).toBe(true), wait);
    await vi.waitFor(() =>
      expect(calls).toContainEqual(['tmux', 'resize-window', '-t', 'cc-claude2-MekWarLive', '-x', '220', '-y', '50']),
      wait);
  });
});
