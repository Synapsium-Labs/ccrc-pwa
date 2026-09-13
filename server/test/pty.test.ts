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
    // THE WINDOW FOLLOWS THE CLIENT, at attach and at every refit. The close
    // handler's own `resize-window` sets `window-size manual` — measured on
    // the live fleet, every window reads `manual` — so tmux stops sizing the
    // window to whoever attaches, and a drawer on any other grid than the
    // spawn's sees a clipped viewport: the right of each line cut and the
    // status row hidden. Delete either call and the drawer goes back to
    // showing a window it does not fit.
    await vi.waitFor(() => expect(calls).toContainEqual(
      ['tmux', 'resize-window', '-t', 'cc-claude2-MekWarLive', '-x', '120', '-y', '40']), wait);
    await vi.waitFor(() => expect(calls).toContainEqual(
      ['tmux', 'resize-window', '-t', 'cc-claude2-MekWarLive', '-x', '90', '-y', '28']), wait);

    // close: kill the pty AND restore the canonical tmux window size via the Runner
    ws.close();
    await vi.waitFor(() => expect(stub.killed).toBe(true), wait);
    await vi.waitFor(() =>
      expect(calls).toContainEqual(['tmux', 'resize-window', '-t', 'cc-claude2-MekWarLive', '-x', '220', '-y', '50']),
      wait);
  });

  /**
   * THE FLOOR UNDER "the window follows the client".
   *
   * The route sizes a LIVE agent's tmux window from a query string, so the
   * drawer can now do something no reader could do before it: make a working
   * pane narrower than any real terminal. `inject/send.ts` cannot survive that
   * — its `paneWidth` clamps what it reads off a capture with `Math.max(80,
   * …)` ("the floor, 80, the narrowest real terminal") and `visualRows` spends
   * 2 blind presses per visual row from that number, so on a genuinely
   * narrower pane it UNDER-counts, under-clears, and the next send comes back
   * carrying the draft that feature exists to keep out of the box.
   *
   * Below the floor the drawer clips instead — exactly what it did before the
   * window followed anything. The pty still takes the client's real grid;
   * only the WINDOW is left alone.
   */
  const boot = async (): Promise<{ port: number; calls: string[][]; stubs: StubPty[];
                                   spawnedAt: () => { id: string; cols: number; rows: number } | undefined }> => {
    const calls: string[][] = [];
    // ONE STUB PER ATTACHMENT, because a test with two drawers open needs a
    // barrier tied to the socket it just closed: the server may process two
    // closes in either order, and `stub.killed` on a shared stub cannot say
    // WHOSE close has landed. Measured — asserting straight after `close()`
    // read the other drawer's teardown and made the case flap.
    const stubs: StubPty[] = [];
    let spawned: { id: string; cols: number; rows: number } | undefined;
    const deps = {
      ...testDeps(undefined, async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args]);
        return { code: 0, stdout: '', stderr: '' };
      }),
      spawnPty: (id: string, cols: number, rows: number) => {
        spawned = { id, cols, rows };
        const s = new StubPty();
        stubs.push(s);
        return s;
      },
    };
    app = await buildServer(deps);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    return {
      port: typeof addr === 'object' && addr !== null ? addr.port : 0,
      calls, stubs, spawnedAt: () => spawned,
    };
  };

  /** Every `resize-window` the Runner was asked for, as `<cols>x<rows>`. */
  const sized = (calls: string[][]): string[] =>
    calls.filter((c) => c[0] === 'tmux' && c[1] === 'resize-window')
      .map((c) => `${c[c.indexOf('-x') + 1]}x${c[c.indexOf('-y') + 1]}`);

  it('a client narrower than a real terminal does not reshape the pane — it clips', async () => {
    const { port, calls, stubs, spawnedAt } = await boot();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=20&rows=5`);
    await opened(ws);

    // The PTY still takes the client's real grid: the xterm in the browser is
    // 20x5 and a pty of any other size would put the wrap mismatch back.
    await vi.waitFor(() => expect(spawnedAt()).toEqual({ id: 'claude2-MekWarLive', cols: 20, rows: 5 }), wait);

    // A round trip proves the handler ran past the attach-time resize.
    ws.send(JSON.stringify({ type: 'input', data: 'x' }));
    await vi.waitFor(() => expect(stubs[0]?.written).toContain('x'), wait);
    expect(sized(calls)).toEqual([]);

    // A refit that is still below the floor moves the client, never the window.
    ws.send(JSON.stringify({ type: 'resize', cols: 40, rows: 10 }));
    await vi.waitFor(() => expect(stubs[0]?.resized).toContainEqual({ cols: 40, rows: 10 }), wait);
    expect(sized(calls)).toEqual([]);

    // Cross the floor and the window follows again — the floor is a floor,
    // not an off switch.
    ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    await vi.waitFor(() => expect(sized(calls)).toEqual(['80x24']), wait);

    ws.close();
    await vi.waitFor(() => expect(sized(calls)).toEqual(['80x24', '220x50']), wait);
  });

  it('a client that states no size does not reshape the pane either', async () => {
    const { port, calls, stubs, spawnedAt } = await boot();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive`);
    await opened(ws);

    // ABSENT IS NOT A MEASUREMENT. The pty has to be some size, so it takes
    // the default; the window must not be reshaped to a number the client
    // never said. Two conditions the caller handles differently.
    await vi.waitFor(() => expect(spawnedAt()).toEqual({ id: 'claude2-MekWarLive', cols: 80, rows: 24 }), wait);
    ws.send(JSON.stringify({ type: 'input', data: 'x' }));
    await vi.waitFor(() => expect(stubs[0]?.written).toContain('x'), wait);
    expect(sized(calls)).toEqual([]);
  });

  it('one measured dimension is not a measurement', async () => {
    const { port, calls, stubs } = await boot();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=171`);
    await opened(ws);
    ws.send(JSON.stringify({ type: 'input', data: 'x' }));
    await vi.waitFor(() => expect(stubs[0]?.written).toContain('x'), wait);
    expect(sized(calls)).toEqual([]);
  });

  /**
   * WHAT A LEAVING DRAWER OWES THE ONE STILL WATCHING.
   *
   * The close handler has always restored a hard-coded 220x50, which was
   * harmless while the window was the only thing that size and nobody else was
   * looking. It is not harmless now that the window follows a client: measured
   * live on this fleet, a phone drawer closing left `window 220x50,
   * window-size=manual` under a desktop client of 171x58 — the reader watched
   * every line run off the right edge, which is the defect the sizing was
   * added to cure, handed back to them by the exit.
   *
   * tmux's own answer to this is `window-size latest`, which snaps the window
   * to whatever client remains (measured on a private socket: a 60x20 client
   * leaving restored the window to the remaining 120x40 one, unaided). Setting
   * that option is not in the exec whitelist and putting it there would grant
   * `set-window-option` in full — prefix-matched, so every window option with
   * it. The server does not need the grant: it is holding every drawer's last
   * reported grid already, and `resize-window` it may already call.
   */
  it('a drawer leaving hands the window to the one still attached', async () => {
    const { port, calls, stubs } = await boot();

    const desk = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=171&rows=58`);
    await opened(desk);
    await vi.waitFor(() => expect(sized(calls)).toEqual(['171x58']), wait);

    const phone = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=100&rows=40`);
    await opened(phone);
    await vi.waitFor(() => expect(sized(calls)).toEqual(['171x58', '100x40']), wait);

    // The phone goes away. The desk is still looking at this pane, and the
    // window belongs to it now — not to a constant. `stubs[1]` is the phone's
    // own pty: waiting on ITS kill is what says the phone's close has landed.
    phone.close();
    await vi.waitFor(() => expect(stubs[1]?.killed).toBe(true), wait);
    expect(sized(calls)).toEqual(['171x58', '100x40', '171x58']);

    // Only when the last one leaves does the canonical size come back.
    desk.close();
    await vi.waitFor(() => expect(stubs[0]?.killed).toBe(true), wait);
    expect(sized(calls)).toEqual(['171x58', '100x40', '171x58', '220x50']);
  });

  it('a leaving drawer does not hand the window to a client too narrow to hold it', async () => {
    const { port, calls, stubs } = await boot();

    // The one that stays is below the floor: it never sized the window on the
    // way in, and it must not be handed the window on someone else's way out.
    const phone = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=45&rows=20`);
    await opened(phone);
    const desk = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=171&rows=58`);
    await opened(desk);
    await vi.waitFor(() => expect(sized(calls)).toEqual(['171x58']), wait);

    desk.close();
    await vi.waitFor(() => expect(stubs[1]?.killed).toBe(true), wait);
    // Nothing more: the window keeps the last size a real terminal asked for.
    expect(sized(calls)).toEqual(['171x58']);

    phone.close();
    await vi.waitFor(() => expect(stubs[0]?.killed).toBe(true), wait);
    expect(sized(calls)).toEqual(['171x58', '220x50']);
  });

  it('the window follows the drawer that moved last, not the one that arrived last', async () => {
    const { port, calls, stubs } = await boot();

    const a = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=100&rows=30`);
    await opened(a);
    const b = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/claude2-MekWarLive?cols=120&rows=40`);
    await opened(b);
    await vi.waitFor(() => expect(sized(calls)).toEqual(['100x30', '120x40']), wait);

    // A rotates — it is the most recently active client now, which is the
    // question tmux's own `latest` asks.
    a.send(JSON.stringify({ type: 'resize', cols: 160, rows: 50 }));
    await vi.waitFor(() => expect(sized(calls)).toEqual(['100x30', '120x40', '160x50']), wait);

    b.close();
    await vi.waitFor(() => expect(stubs[1]?.killed).toBe(true), wait);
    expect(sized(calls)).toEqual(['100x30', '120x40', '160x50', '160x50']);
  });
});
