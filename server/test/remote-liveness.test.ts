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

  it('W27-L8: a ready link that misses two pongs is terminated and retried', async () => {
    peer = await linkPeer(() => 'ready-no-pong');
    fleet = connectToAgent(peer.port, { heartbeatMs: 50 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });
});
