// Wave 27 (D-6514 to D-6526): the link to the fleet agent cannot wait forever before `ready`.
// Every row runs on real timers against an in-process loopback peer (`linkPeer`), never a real agent: a node:http
// server whose upgrade handling is chosen per attempt, so one port can be silent first and healthy later.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { ConnectedFleet } from '../src/remote/client.js';
import { connectToAgent } from './remoteHelpers.js';

type PeerMode =
  | 'silent-upgrade'   // accept TCP, read the upgrade request, never answer
  | 'trickle-upgrade'  // answer with a partial 101 status line, then one byte every 50 ms, never finishing
  | 'refuse'           // destroy the socket as soon as the upgrade request arrives
  | 'silent-hello'     // complete the upgrade, read hello, never send ready
  | 'ready'            // answer hello with ready and every ping with pong
  | 'ready-no-pong'    // answer hello with ready, never answer a ping
  | 'ready-then-drop'; // answer hello with ready, then terminate the socket 100 ms later

interface LinkPeer {
  port: number;
  accepts(): number; // TCP connections the listener accepted
  hellos(): number;  // hello frames received
  upgraded(attempt: number): boolean; // whether that accept's upgrade request arrived, whatever the mode
  close(): Promise<void>;
}

async function linkPeer(modeOf: (attempt: number) => PeerMode): Promise<LinkPeer> {
  const sockets = new Set<Socket>();
  const intervals = new Set<NodeJS.Timeout>();
  // The attempt number is the TCP accept index, not the upgrade index: an attempt the client aborts before it
  // writes its upgrade request (a stalled loop lets the deadline win) still uses up its slot.
  const attemptOf = new Map<Duplex, number>();
  let accepted = 0;
  let hellos = 0;
  const upgradedAttempts = new Set<number>();
  const wss = new WebSocketServer({ noServer: true });
  const http = createServer();
  http.on('connection', (s: Socket) => {
    attemptOf.set(s, accepted++);
    sockets.add(s);
    s.on('error', () => undefined);
    s.on('close', () => { sockets.delete(s); attemptOf.delete(s); });
  });
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => undefined);
    const attempt = attemptOf.get(socket);
    if (attempt === undefined) { socket.destroy(); return; } // never: node:http upgrades the accepted socket
    upgradedAttempts.add(attempt);
    const mode = modeOf(attempt);
    if (mode === 'silent-upgrade') return;
    if (mode === 'refuse') { socket.destroy(); return; }
    if (mode === 'trickle-upgrade') {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nX-Pad: ');
      const t = setInterval(() => { if (!socket.destroyed) socket.write('a'); }, 50);
      intervals.add(t);
      socket.on('close', () => { clearInterval(t); intervals.delete(t); });
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { t?: unknown };
        if (msg.t === 'hello') {
          hellos++;
          if (mode === 'silent-hello') return;
          ws.send(JSON.stringify({ t: 'ready', v: 1 }));
          if (mode === 'ready-then-drop') setTimeout(() => ws.terminate(), 100);
        } else if (msg.t === 'ping' && mode !== 'ready-no-pong') {
          ws.send(JSON.stringify({ t: 'pong' }));
        }
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    port,
    accepts: () => accepted,
    hellos: () => hellos,
    upgraded: (attempt) => upgradedAttempts.has(attempt),
    close: () => new Promise<void>((resolve) => {
      for (const t of intervals) clearInterval(t);
      for (const s of sockets) s.destroy();
      wss.close();
      http.close(() => resolve());
    }),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The link's own log lines, in order, from a `console.warn` spy. */
const linkLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: agent link: '));

describe('W27: the link to the fleet agent cannot wait forever before ready (D-6514 to D-6526)', () => {
  let peer: LinkPeer | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    await peer?.close();
    peer = undefined;
    vi.restoreAllMocks();
  });

  it('W27-L1: an upgrade never answered is dropped at the deadline and retried', async () => {
    peer = await linkPeer(() => 'silent-upgrade');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 150 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(fleet.state.connected).toBe(false);
  });

  it('W27-L2: an upgrade answered a byte at a time is dropped too (a wall clock, not idle)', async () => {
    peer = await linkPeer(() => 'trickle-upgrade');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 150 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });

  it('W27-L3: a hello never answered with ready is dropped at the deadline and retried', async () => {
    // 1000 ms, not 150: this row's line names the OPEN phase, so the first attempt must have upgraded by then.
    peer = await linkPeer(() => 'silent-hello');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    expect(peer.hellos()).toBeGreaterThanOrEqual(1);
  });

  it('W27-L4: once the peer answers, the next attempt reaches ready', async () => {
    // 1000 ms, not 150: the attempt meant to reach ready runs under the same deadline, and must not be cut.
    peer = await linkPeer((n) => (n < 2 ? 'silent-upgrade' : 'ready'));
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 8000 });
    expect(peer.accepts()).toBe(3);
  });

  it('W27-L5: a ready inside the deadline holds: the deadline never cuts a ready link', async () => {
    peer = await linkPeer(() => 'ready');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 5000 });
    await sleep(2000); // the deadline lies inside this window on purpose: M4 fires it here
    expect(peer.accepts()).toBe(1);
    expect(fleet.state.connected).toBe(true);
  });

  it('W27-L7: close() during the upgrade settles, retries nothing and logs nothing', async () => {
    peer = await linkPeer(() => 'silent-upgrade');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 2000 });
    await vi.waitFor(() => expect(peer!.accepts()).toBe(1), { timeout: 5000 });
    await fleet.close();
    fleet = undefined;
    await sleep(2600);
    expect(peer.accepts()).toBe(1);
    expect(linkLines(warn)).toEqual([]);
  });

  it('W27-L12: the deadline runs from socket creation, before the TCP connect completes', async () => {
    // A loop held past the deadline right after the socket is created: expired timers run before the poll phase
    // that completes the TCP connect and writes the upgrade, so attempt 0 ends with no upgrade request sent.
    // A deadline armed at TCP connect or later would let attempt 0 write its upgrade first.
    peer = await linkPeer(() => 'silent-upgrade');
    // Start from the check phase, so the next phase to run is timers: a row that starts inside the timers phase
    // (after a row that ended on a timer) would reach the poll phase, and the TCP connect, before the deadline.
    await new Promise<void>((resolve) => setImmediate(resolve));
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 150 });
    const held = Date.now();
    while (Date.now() - held < 300) { /* hold the event loop past the deadline */ }
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(peer.upgraded(0)).toBe(false); // M18 is what proves `upgraded` can read true
  });

  it('W27-L8: a ready link that misses two pongs is terminated and retried', async () => {
    peer = await linkPeer(() => 'ready-no-pong');
    fleet = connectToAgent(peer.port, { heartbeatMs: 50 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });
});
