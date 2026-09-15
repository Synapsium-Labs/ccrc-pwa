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

  it('PINS the canonical grid BEFORE the pty attaches, so the client cannot reflow the history', async () => {
    // F14, measured end to end on one session with `window-size latest` as ccd
    // spawns it, 1153 stored lines / 1203 logical:
    //   UNPINNED  a 43-column pty client attaches, the window follows it to 43,
    //             `history_size` 1153 -> 5771, one line of output, detach,
    //             restore 220 -> 1046 logical of 1203. 157 DESTROYED.
    //   PINNED    `resize-window -x 220 -y 50` first: the option reads `manual`
    //             (F3), the window stays 220 THROUGHOUT the 43-column attach,
    //             `history_size` unchanged at 1153, 1205 logical after detach.
    //
    // ORDER IS THE WHOLE GUARD, not presence: the close handler has always run
    // the same argv, so a test that only asserts the call exists passes on
    // `main` and passes with the pin deleted. One ordered log, shared by the
    // spawn stub and the Runner, is what can tell them apart.
    const log: string[] = [];
    const run = async (cmd: string, args: string[]) => {
      log.push([cmd, ...args].join(' '));
      return { code: 0, stdout: '', stderr: '' };
    };
    const stub = new StubPty();
    const deps = {
      ...testDeps(undefined, run),
      spawnPty: (id: string, cols: number, rows: number) => {
        log.push(`spawnPty ${id} ${cols}x${rows}`);
        return stub;
      },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=43&rows=40`);
    await opened(ws);
    await vi.waitFor(() => expect(log).toContain('spawnPty claude2-MekWarLive 43x40'), wait);

    const pin = 'tmux resize-window -t cc-claude2-MekWarLive -x 220 -y 50';
    const spawn = 'spawnPty claude2-MekWarLive 43x40';
    expect(log.indexOf(pin), 'the canonical pin never ran — the client reflows the history')
      .toBeGreaterThanOrEqual(0);
    expect(log.indexOf(pin), 'the pin ran AFTER the attach: by then tmux has already reflowed')
      .toBeLessThan(log.indexOf(spawn));

    // AND THE CLIENT'S OWN GRID IS STILL THE PTY'S. The pin is the WINDOW's
    // size, not the pty's — the phone keeps the 43x40 it measured and sees a
    // clipped view, exactly as it does today. Wave 3 is where that changes.
    expect(log.filter((l) => l.startsWith('tmux resize-window')),
      'the window was sized to the client — wave 1 carries no per-client grid map')
      .toEqual([pin]);

    // AND THE REFIT HALF, which is the half that had no guard at all. The
    // dropped window-follow sized the window at the attach AND on every
    // `resize` frame, and a rotation or a keyboard opening sends one. The
    // assertion above never sent a resize frame, so it only ever saw the attach:
    // measured, putting `void deps.tmux.resizeWindow(id, m.cols, m.rows)` back
    // into the route's `resize` arm left EVERY test in this repo green, while
    // the phone narrowed the window on every rotation and F14's loss returned
    // through the half nobody pinned.
    //
    // TWO FRAMES, AND THE FIRST ONE CHANGES THE WIDTH. A single frame at the
    // attach width pins only the mutation that refits unconditionally: with
    // `{cols: 43}` alone — the same cols the socket attached with — a refit
    // written `if (m.cols !== cols)`, `if (m.cols > 100)`, `if (m.rows > 24)`
    // or "skip the first frame" all stayed GREEN against the whole server
    // suite (measured). `120x40` is a rotation: it changes the width, clears
    // any plausible threshold, and is not the first thing the route sees by
    // the time the second frame lands. All four of those refits red on it.
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await vi.waitFor(() => expect(stub.resized).toContainEqual({ cols: 120, rows: 40 }), wait);
    ws.send(JSON.stringify({ type: 'resize', cols: 43, rows: 20 }));
    await vi.waitFor(() => expect(stub.resized).toContainEqual({ cols: 43, rows: 20 }), wait);
    expect(log.filter((l) => l.startsWith('tmux resize-window')),
      'a resize frame moved the window — the refit half of the window-follow is back')
      .toEqual([pin]);

    ws.close();
    await vi.waitFor(() => expect(stub.killed).toBe(true), wait);
    // The close handler's restore is now a no-op against a window that never
    // moved, which is exactly what §5.1 says it becomes.
    await vi.waitFor(() => expect(log.filter((l) => l === pin)).toHaveLength(2), wait);
  });
});
