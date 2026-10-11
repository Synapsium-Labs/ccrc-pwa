// A userland throttled TCP link for the Docs console-latency test (design 2026-10-01, section 6.8; W3 Task 10).
// `throttledProxy(targetPort, bytesPerSecond)` listens on 127.0.0.1 and pipes every accepted connection to
// `127.0.0.1:targetPort`, each direction through its own time-based credit bucket flushed every 2 ms, so bytes
// leave in arrival order at no more than `bytesPerSecond` (12 500 000 is 100 Mbit). A frame queued behind others
// waits for them: exactly the head-of-line blocking the read lane bounds.
import net from 'node:net';

/** How often each direction's bucket is flushed (section 6.8: "2 ms flush"). */
const FLUSH_MS = 2;
/** The credit an IDLE direction may bank, in milliseconds of rate: a burst after idleness, never a backlog's
 *  catch-up. A backlogged direction banks no cap, so a late flush (a busy event loop) loses no link time. */
const IDLE_BURST_MS = 10;
/** Above this many queued bytes a direction pauses its source socket, and resumes at or below it, so the
 *  backlog waits in the sender's own buffers in the order it was written. */
const HIGH_WATER_BYTES = 1048576;

export interface ThrottledProxy {
  /** The port the proxy listens on, on 127.0.0.1. */
  port: number;
  /** Stop listening, stop every bucket, and destroy both sockets of every connection. */
  close(): Promise<void>;
}

/** One direction of one connection: `from`'s bytes reach `to` at most `bytesPerSecond`, in order. */
function throttle(from: net.Socket, to: net.Socket, bytesPerSecond: number): { stop(): void } {
  const perMs = bytesPerSecond / 1000;
  const queue: Buffer[] = [];
  let queued = 0;
  let credit = 0;
  let last = performance.now();

  const flush = (): void => {
    const now = performance.now();
    const earned = (now - last) * perMs;
    last = now;
    credit = queue.length === 0 ? Math.min(credit + earned, perMs * IDLE_BURST_MS) : credit + earned;
    while (queue.length > 0 && credit >= 1) {
      const head = queue[0] as Buffer;
      const n = Math.min(head.length, Math.floor(credit));
      if (n === head.length) queue.shift();
      else queue[0] = head.subarray(n);
      if (!to.destroyed) to.write(head.subarray(0, n));
      queued -= n;
      credit -= n;
    }
    if (queued <= HIGH_WATER_BYTES && from.isPaused()) from.resume();
  };

  const timer = setInterval(flush, FLUSH_MS);
  from.on('data', (chunk: Buffer) => {
    queue.push(chunk);
    queued += chunk.length;
    if (queued > HIGH_WATER_BYTES) from.pause();
  });
  return { stop: () => clearInterval(timer) };
}

/**
 * A throttled proxy to `127.0.0.1:targetPort` (section 6.8). Each accepted connection opens one upstream
 * connection; both sockets are `setNoDelay`, and each direction has its own bucket at `bytesPerSecond`. Either
 * side closing or failing destroys both. `close()` resolves once the listener has closed.
 */
export async function throttledProxy(targetPort: number, bytesPerSecond: number): Promise<ThrottledProxy> {
  const live = new Set<{ stop(): void }>();
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    sockets.add(client);
    sockets.add(upstream);
    const up = throttle(client, upstream, bytesPerSecond);
    const down = throttle(upstream, client, bytesPerSecond);
    live.add(up);
    live.add(down);
    const end = (): void => {
      up.stop();
      down.stop();
      live.delete(up);
      live.delete(down);
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('close', end);
    upstream.on('close', end);
    client.on('error', end);
    upstream.on('error', end);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    close: () => new Promise<void>((resolve) => {
      for (const t of live) t.stop();
      live.clear();
      for (const s of sockets) s.destroy();
      sockets.clear();
      server.close(() => resolve());
    }),
  };
}
