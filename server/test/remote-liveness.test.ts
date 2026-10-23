// Wave 27 (D-6514 to D-6529): the link to the fleet agent cannot wait forever before `ready`.
// Every row runs on real timers against an in-process loopback peer (`linkPeer`), never a real agent: a node:http
// server whose upgrade handling is chosen per attempt, so one port can be silent first and healthy later.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer as createNetServer, type Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { connectFleet, type ConnectedFleet } from '../src/remote/client.js';
import { connectToAgent, TOKEN } from './remoteHelpers.js';

type PeerMode =
  | 'silent-upgrade'   // accept TCP, read the upgrade request, never answer
  | 'trickle-upgrade'  // answer with a partial 101 status line, then one byte every 50 ms, never finishing
  | 'refuse'           // destroy the socket as soon as the upgrade request arrives
  | 'silent-hello'     // complete the upgrade, read hello, never send ready
  | 'ready'            // answer hello with ready and every ping with pong
  | 'ready-no-pong'    // answer hello with ready, never answer a ping
  | 'ready-then-drop'  // answer hello with ready, then terminate the socket 100 ms later
  | 'refuse-hello'     // complete the upgrade, count the hello, close the socket with 4401 and a long reason
  | 'echo-hello'       // complete the upgrade, count the hello, close the socket with 4401 and the hello as reason
  | 'close-hello';     // complete the upgrade, count the hello, close with the code and reason `closeOf` names

interface HelloClose { code: number; reason: string }

interface LinkPeer {
  port: number;
  accepts(): number; // TCP connections the listener accepted
  hellos(): number;  // hello frames received
  upgraded(attempt: number): boolean; // whether that accept's upgrade request arrived, whatever the mode
  acceptTimes(): number[]; // Date.now() at each TCP accept, in order
  close(): Promise<void>;
}

async function linkPeer(
  modeOf: (attempt: number) => PeerMode,
  closeOf: (attempt: number) => HelloClose = () => ({ code: 4401, reason: 'unauthorized' }),
): Promise<LinkPeer> {
  const sockets = new Set<Socket>();
  const intervals = new Set<NodeJS.Timeout>();
  // The attempt number is the TCP accept index, not the upgrade index: an attempt the client aborts before it
  // writes its upgrade request (a stalled loop lets the deadline win) still uses up its slot.
  const attemptOf = new Map<Duplex, number>();
  let accepted = 0;
  let hellos = 0;
  const times: number[] = [];
  const upgradedAttempts = new Set<number>();
  const wss = new WebSocketServer({ noServer: true });
  const http = createServer();
  http.on('connection', (s: Socket) => {
    attemptOf.set(s, accepted++);
    times.push(Date.now());
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
          if (mode === 'refuse-hello') { ws.close(4401, REFUSE_REASON); return; }
          if (mode === 'echo-hello') { ws.close(4401, raw.toString()); return; }
          if (mode === 'close-hello') { const c = closeOf(attempt); ws.close(c.code, c.reason); return; }
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
    acceptTimes: () => [...times],
    close: () => new Promise<void>((resolve) => {
      for (const t of intervals) clearInterval(t);
      for (const s of sockets) s.destroy();
      wss.close();
      http.close(() => resolve());
    }),
  };
}

// 120 bytes, with a control character at index 10: the printable form of its first 64 characters is
// `abcdefghij?` followed by 53 `x`.
const REFUSE_REASON = `abcdefghij\x07${'x'.repeat(109)}`;

/** A hand-written peer on a TCP server that allows half-open sockets: it completes the upgrade by hand, writes one raw
 *  close frame after the hello, and never ends or destroys its own side, so the client's socket stays CLOSING. */
async function rawClosePeer(code: number, reason: string): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const srv = createNetServer({ allowHalfOpen: true }, (s) => {
    sockets.add(s);
    s.on('error', () => undefined);
    s.on('close', () => sockets.delete(s));
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let closed = false;
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString('latin1');
        buf = buf.subarray(end + 4);
        const key = /sec-websocket-key:\s*(\S+)/i.exec(head)?.[1] ?? '';
        const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
          + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
        upgraded = true;
      }
      if (upgraded && !closed && buf.length >= 2) { // the hello frame has arrived
        closed = true;
        const text = Buffer.from(reason, 'utf8');
        const payload = Buffer.alloc(2 + text.length);
        payload.writeUInt16BE(code, 0);
        text.copy(payload, 2);
        s.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
      }
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const address = srv.address();
  return {
    port: typeof address === 'object' && address !== null ? address.port : 0,
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); srv.close(() => resolve()); }),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The link's own log lines, in order, from a `console.warn` spy. */
const linkLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: agent link: '));

const NO_READY = (ms: number, phase: string): string =>
  `ccrc-server: agent link: no ready within ${ms}ms (${phase}); terminating this attempt and retrying`;
const NO_PONG = (ms: number): string =>
  `ccrc-server: agent link: no pong to 2 heartbeats ${ms}ms apart; terminating the socket and reconnecting`;
const LOST = (code: number): string => `ccrc-server: agent link: lost (close ${code}); reconnecting`;
const NEVER_READY = (code: number): string =>
  `ccrc-server: agent link: no ready since the server started (close ${code}); retrying`;
const READY_AFTER = (failed: number): RegExp => new RegExp('^ccrc-server: agent link: ready again, \\d+ms after '
  + `this stretch's first line \\(${failed} attempts ended without a ready\\)$`);
const NOT_CREATED = (name: string): string =>
  `ccrc-server: agent link: no ready since the server started (socket not created: ${name}); retrying`;
const REFUSED = (code: number, reason: string): string =>
  `ccrc-server: agent link: agent refused the hello (close ${code} ${reason}); retrying`;

describe('W27: the link to the fleet agent cannot wait forever before ready (D-6514 to D-6529)', () => {
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 150 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(fleet.state.connected).toBe(false);
    expect(linkLines(warn)[0]).toBe(NO_READY(150, 'connect or upgrade unanswered'));
  });

  it('W27-L2: an upgrade answered a byte at a time is dropped too (a wall clock, not idle)', async () => {
    peer = await linkPeer(() => 'trickle-upgrade');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 150 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(linkLines(warn)[0]).toBe(NO_READY(150, 'connect or upgrade unanswered'));
  });

  it('W27-L3: a hello never answered with ready is dropped at the deadline and retried', async () => {
    // 1000 ms, not 150: this row's line names the OPEN phase, so the first attempt must have upgraded by then.
    peer = await linkPeer(() => 'silent-hello');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 1000 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    expect(peer.hellos()).toBeGreaterThanOrEqual(1);
    expect(linkLines(warn)[0]).toBe(NO_READY(1000, 'ready not sent'));
  });

  it('W27-L4: once the peer answers, the next attempt reaches ready', async () => {
    // 1000 ms, not 150: the attempt meant to reach ready runs under the same deadline, and must not be cut.
    peer = await linkPeer((n) => (n < 2 ? 'silent-upgrade' : 'ready'));
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 8000 });
    expect(peer.accepts()).toBe(3);
  });

  it('W27-L5: a ready inside the deadline holds: the deadline never cuts a ready link', async () => {
    peer = await linkPeer(() => 'ready');
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 5000 });
    await sleep(2000); // the deadline lies inside this window on purpose: M4 fires it here
    expect(peer.accepts()).toBe(1);
    expect(fleet.state.connected).toBe(true);
  });

  it('W27-L7: close() during the upgrade settles, retries nothing and logs nothing', async () => {
    peer = await linkPeer(() => 'silent-upgrade');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 2000 });
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
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 150 });
    const held = Date.now();
    while (Date.now() - held < 300) { /* hold the event loop past the deadline */ }
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(peer.upgraded(0)).toBe(false); // M18 is what proves `upgraded` can read true
  });

  it('W27-L8: a ready link that misses two pongs is terminated and retried', async () => {
    peer = await linkPeer(() => 'ready-no-pong');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { heartbeatMs: 50 });
    await vi.waitFor(() => {
      expect(peer!.accepts()).toBeGreaterThanOrEqual(3);
      expect(linkLines(warn).length).toBeGreaterThanOrEqual(3);
    }, { timeout: 5000 });
    expect(linkLines(warn).slice(0, 3)).toEqual([NO_PONG(50), expect.stringMatching(READY_AFTER(0)), NO_PONG(50)]);
  });

  it('W27-L6: a deadline left over from a replaced attempt speaks for nothing current', async () => {
    // Attempt 0 is refused at once (the boot line); attempt 1 starts about 500 ms later and never gets ready.
    // Attempt 0's deadline fires at about 2000 ms, while attempt 1 is current and not ready: it must stay silent,
    // so the next line is attempt 1's own, at about 2500 ms. Either pre-ready word passes, so the green does not
    // depend on how fast attempt 1 upgrades; only a stale deadline can print `(closed)`.
    peer = await linkPeer((n) => (n === 0 ? 'refuse' : 'silent-hello'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 2000, reconnectMinMs: 500, reconnectMaxMs: 500 });
    await vi.waitFor(() => expect(linkLines(warn).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    expect(linkLines(warn)[0]).toBe(NEVER_READY(1006));
    expect(linkLines(warn)[1]).toMatch(new RegExp('^ccrc-server: agent link: no ready within 2000ms '
      + '\\((connect or upgrade unanswered|ready not sent)\\); terminating this attempt and retrying$'));
  });

  it('W27-L9: one no-ready line per stretch, naming its phase, and one recovery line with a count', async () => {
    // 1000 ms, not 150: the attempt meant to reach ready runs under the same deadline, and must not be cut.
    peer = await linkPeer((n) => (n < 3 ? 'silent-upgrade' : 'ready'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 8000 });
    expect(linkLines(warn)).toEqual([
      NO_READY(1000, 'connect or upgrade unanswered'), expect.stringMatching(READY_AFTER(3)),
    ]);
  });

  it('W27-L10: a ready link that drops logs lost with its close code, then ready again', async () => {
    // Attempt 1 is refused: counted inside the open episode, and never a boot line, because a link was ready.
    peer = await linkPeer((n) => (n === 0 ? 'ready-then-drop' : n === 1 ? 'refuse' : 'ready'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port);
    await vi.waitFor(() => {
      expect(peer!.accepts()).toBeGreaterThanOrEqual(3);
      expect(fleet!.state.connected).toBe(true);
      expect(linkLines(warn)).toHaveLength(2);
    }, { timeout: 5000 });
    expect(linkLines(warn)).toEqual([LOST(1006), expect.stringMatching(READY_AFTER(1))]);
  });

  it('W27-L11: a stretch with no ready since start is logged at its first failed attempt and at its first ready',
    async () => {
      peer = await linkPeer((n) => (n < 2 ? 'refuse' : 'ready'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fleet = connectToAgent(peer.port);
      await vi.waitFor(() => {
        expect(fleet!.state.connected).toBe(true);
        expect(linkLines(warn)).toHaveLength(2);
      }, { timeout: 5000 });
      expect(linkLines(warn)).toEqual([NEVER_READY(1006), expect.stringMatching(READY_AFTER(2))]);
    });

  it('W27-L13: an attempt whose socket cannot be created prints the boot line once, naming the error, not the URL',
    async () => {
      // `new WebSocket` throws synchronously for this URL, so the line is printed inside `connectFleet`; the sleep
      // gives the retries (30 ms backoff, growing to 100 ms) time to print a second line, which they must not.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fleet = connectFleet({
        url: 'not-a-url', token: 'unused', reconnectMinMs: 30, reconnectMaxMs: 100, heartbeatMs: 60_000,
      });
      await sleep(500);
      expect(linkLines(warn)).toEqual([NOT_CREATED('SyntaxError')]);
      expect(fleet.state.connected).toBe(false);
    });

  it('W27-L14: an agent that refuses each hello is logged once, with a printable reason', async () => {
    // A ready link is lost, then every attempt's hello is closed with 4401 and a 120-byte reason that carries a
    // control character: one `refused` line, the reason cut to 64 printable characters.
    peer = await linkPeer((n) => (n === 0 ? 'ready-then-drop' : 'refuse-hello'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port);
    await vi.waitFor(() => {
      expect(peer!.accepts()).toBeGreaterThanOrEqual(4);
      expect(linkLines(warn).length).toBeGreaterThanOrEqual(2);
    }, { timeout: 8000 });
    const lines = linkLines(warn);
    expect(lines.filter((l) => l.includes('refused'))).toEqual([REFUSED(4401, `abcdefghij?${'x'.repeat(53)}`)]);
    expect(lines[0]).toBe(LOST(1006));
    expect(lines.some((l) => l.includes(TOKEN))).toBe(false);
  });

  it('W27-L15: a refusal reason that repeats the token is withheld, never printed', async () => {
    // The peer closes each hello with the hello frame itself as the reason: all printable ASCII, 47 bytes, so it
    // would survive the cut and the character replacement and put the token in the journal.
    peer = await linkPeer((n) => (n === 0 ? 'ready-then-drop' : 'echo-hello'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port);
    await vi.waitFor(() => {
      expect(peer!.accepts()).toBeGreaterThanOrEqual(3);
      expect(linkLines(warn).length).toBeGreaterThanOrEqual(2);
    }, { timeout: 8000 });
    const lines = linkLines(warn);
    expect(lines.filter((l) => l.includes('refused')))
      .toEqual([REFUSED(4401, '[withheld: repeats the token]')]);
    for (let i = 0; i + 8 <= TOKEN.length; i++) {
      expect(lines.some((l) => l.includes(TOKEN.slice(i, i + 8)))).toBe(false);
    }
  });

  /** Closes the pair the row opened, so a row can open another; `afterEach` finds nothing left. */
  async function closePair(): Promise<void> {
    await fleet?.close();
    fleet = undefined;
    await peer?.close();
    peer = undefined;
    vi.restoreAllMocks();
  }

  /** Every attempt's hello is closed with `code` and `reason`; returns the link lines once `accepts` attempts ran. */
  async function refusalLines(token: string, code: number, reason: string, accepts = 3): Promise<string[]> {
    peer = await linkPeer(() => 'close-hello', () => ({ code, reason }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectFleet({
      url: `ws://127.0.0.1:${peer.port}`, token, reconnectMinMs: 30, reconnectMaxMs: 100, heartbeatMs: 60_000,
      connectTimeoutMs: 5000,
    });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(accepts), { timeout: 8000 });
    return linkLines(warn);
  }

  const WITHHELD = '[withheld: repeats the token]';

  it('W27-L16: the token check runs on the full reason, before the 64-character cut (D-6529)', async () => {
    // 58 `x` then the token: only 6 token characters lie inside the cut, which is fewer than the 8-character window.
    const token = randomBytes(32).toString('hex');
    expect(await refusalLines(token, 4401, `${'x'.repeat(58)}${token}`))
      .toEqual([NEVER_READY(4401), REFUSED(4401, WITHHELD)]);
  });

  it('W27-L17: 8 token characters in a row are enough to withhold the reason', async () => {
    const token = randomBytes(32).toString('hex');
    expect(await refusalLines(token, 4401, `bad token ${token.slice(20, 28)} seen`))
      .toEqual([NEVER_READY(4401), REFUSED(4401, WITHHELD)]);
  });

  it('W27-L18: 7 token characters in a row are printed (the window is 8)', async () => {
    const token = randomBytes(32).toString('hex');
    const reason = `bad token ${token.slice(20, 27)} seen`;
    expect(await refusalLines(token, 4401, reason)).toEqual([NEVER_READY(4401), REFUSED(4401, reason)]);
  });

  it('W27-L19: a token shorter than the window withholds a reason that holds all of it', async () => {
    expect(await refusalLines('abc', 4401, 'xabcx')).toEqual([NEVER_READY(4401), REFUSED(4401, WITHHELD)]);
  });

  it('W27-L20: an empty token checks nothing, so the reason is printed', async () => {
    expect(await refusalLines('', 4401, 'unauthorized'))
      .toEqual([NEVER_READY(4401), REFUSED(4401, 'unauthorized')]);
  });

  it('W27-L21: a boot-time refusal logs the boot line, one refused line, then ready (D-6527)', async () => {
    const token = randomBytes(32).toString('hex');
    peer = await linkPeer((n) => (n < 3 ? 'close-hello' : 'ready'), () => ({ code: 4401, reason: 'unauthorized' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectFleet({
      url: `ws://127.0.0.1:${peer.port}`, token, reconnectMinMs: 30, reconnectMaxMs: 100, heartbeatMs: 60_000,
      connectTimeoutMs: 5000,
    });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 8000 });
    expect(linkLines(warn))
      .toEqual([NEVER_READY(4401), REFUSED(4401, 'unauthorized'), expect.stringMatching(READY_AFTER(3))]);
  });

  it('W27-L22: the refused range is 4400 to 4499: 4399 and 4500 print the boot line only', async () => {
    for (const [code, refused] of [[4399, false], [4400, true], [4499, true], [4500, false]] as const) {
      const token = randomBytes(32).toString('hex');
      const lines = await refusalLines(token, code, 'unauthorized');
      expect(lines).toEqual(refused ? [NEVER_READY(code), REFUSED(code, 'unauthorized')] : [NEVER_READY(code)]);
      await closePair();
    }
  });

  it('W27-L23: a close frame with the TCP side never ended logs (closing), then the refused line', async () => {
    // The peer writes one raw 4401 close frame and keeps its side open, so the client's socket stays CLOSING until
    // the deadline fires: that line names the phase `closing`, and the close handler then prints the refusal.
    // 3000 ms: the connect, the hand-made upgrade, the hello and the close frame all fit inside the deadline, or it
    // would fire while the socket is still CONNECTING.
    const raw = await rawClosePeer(4401, 'unauthorized');
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fleet = connectFleet({
        url: `ws://127.0.0.1:${raw.port}`, token: randomBytes(32).toString('hex'), reconnectMinMs: 5000,
        reconnectMaxMs: 5000, heartbeatMs: 60_000, connectTimeoutMs: 3000,
      });
      await vi.waitFor(() => expect(linkLines(warn).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
      expect(linkLines(warn)).toEqual([NO_READY(3000, 'closing'), REFUSED(4401, 'unauthorized')]);
    } finally {
      await fleet?.close();
      fleet = undefined;
      await raw.close();
    }
  });

  it('W27-L24: the deadline timer never keeps the process alive (D-6517)', async () => {
    // A child process connects with a 60 s deadline to a peer that never answers, closes the client and returns. The
    // deadline is never cleared, so only `unref` lets the child exit before it fires. The row races the child's exit
    // against EXIT_BOUND_MS and asserts on the race, so a deadline that holds the process fails this assertion at the
    // bound (the row's own timeout is longer than the bound), not vitest's clock.
    // The child's stderr is the failure message only: a loader warning on another Node version is not the property.
    const EXIT_BOUND_MS = 25_000;
    peer = await linkPeer(() => 'silent-upgrade');
    const serverDir = fileURLToPath(new URL('..', import.meta.url));
    const script = [
      'const { connectFleet } = await import(process.env.CLIENT_URL);',
      'const f = connectFleet({ url: process.env.PEER_URL, token: \'unused\', reconnectMinMs: 30, reconnectMaxMs: 100,',
      '  heartbeatMs: 60000, connectTimeoutMs: 60000 });',
      'await new Promise((r) => setTimeout(r, 300));',
      'await f.close();',
    ].join('\n');
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: serverDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        CLIENT_URL: pathToFileURL(fileURLToPath(new URL('../src/remote/client.ts', import.meta.url))).href,
        PEER_URL: `ws://127.0.0.1:${peer.port}`,
      },
    });
    let stderr = '';
    let bound: NodeJS.Timeout | undefined;
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    try {
      // 'close', not 'exit': it follows the end of the child's stderr, so the assertion reads all of it.
      const outcome = await new Promise<{ code: number | null; signal: string | null } | 'timeout'>((resolve) => {
        bound = setTimeout(() => resolve('timeout'), EXIT_BOUND_MS);
        child.once('close', (code, signal) => resolve({ code, signal }));
        child.once('error', () => resolve({ code: -1, signal: null }));
      });
      expect(outcome, stderr).toEqual({ code: 0, signal: null });
    } finally {
      clearTimeout(bound);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 40_000);

  it('W27-L25: the deadline keeps the backoff growing: five attempts take at least the timers they wait on', async () => {
    // Five attempts: four deadlines of 100 ms and backoffs of 50, 100, 200 and 400 ms between them, so about 1150 ms
    // after `t0`, which precedes the first timer. The floor is that sum less slack: Node arms a timer from libuv's cached
    // loop time, refreshed once per loop iteration, so a timer armed after a stall inside one iteration fires early, by
    // the length of the stall, as `Date.now()` sees it. A deadline that reset the backoff flattens the sum to about 600 ms.
    peer = await linkPeer(() => 'silent-upgrade');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t0 = Date.now();
    fleet = connectToAgent(peer.port, { connectTimeoutMs: 100, reconnectMinMs: 50, reconnectMaxMs: 400 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(5), { timeout: 8000 });
    expect(peer.acceptTimes()[4]! - t0).toBeGreaterThanOrEqual(950);
  });
});
