import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectingSocket } from '../src/lib/ws';

/** Scripted stand-in for the browser WebSocket — tests drive open/message/drop. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  // — test drivers —
  open(): void {
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  drop(): void {
    this.onclose?.(new Event('close') as CloseEvent);
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }
}

interface Harness {
  socket: ReconnectingSocket;
  url: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
  onState: ReturnType<typeof vi.fn>;
}

const makeHarness = (): Harness => {
  let attempt = 0;
  const url = vi.fn(() => `/ws/session/s1?since=u:${attempt++}`);
  const onMessage = vi.fn();
  const onState = vi.fn();
  const socket = new ReconnectingSocket({
    url,
    onMessage,
    onState,
    makeSocket: (u) => new FakeSocket(u) as unknown as WebSocket,
  });
  return { socket, url, onMessage, onState };
};

const instances = (): FakeSocket[] => FakeSocket.instances;
const last = (): FakeSocket => {
  const sock = FakeSocket.instances[FakeSocket.instances.length - 1];
  if (!sock) throw new Error('no FakeSocket created yet');
  return sock;
};

describe('ReconnectingSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin jitter to its midpoint (factor 1.0) so backoff delays are exact.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects on start() using a fresh url() and reports connecting → open', () => {
    const h = makeHarness();
    expect(instances()).toHaveLength(0);

    h.socket.start();

    expect(instances()).toHaveLength(1);
    expect(h.url).toHaveBeenCalledTimes(1);
    expect(last().url).toBe('/ws/session/s1?since=u:0');
    expect(h.onState).toHaveBeenLastCalledWith('connecting');

    last().open();
    expect(h.onState).toHaveBeenLastCalledWith('open');
  });

  it('parses JSON frames to onMessage and drops malformed frames silently', () => {
    const h = makeHarness();
    h.socket.start();
    last().open();

    last().message(JSON.stringify({ type: 'status', status: 'busy' }));
    expect(h.onMessage).toHaveBeenCalledTimes(1);
    expect(h.onMessage).toHaveBeenCalledWith({ type: 'status', status: 'busy' });

    expect(() => last().message('{not json')).not.toThrow();
    expect(() => last().message(new Blob(['x']))).not.toThrow();
    expect(h.onMessage).toHaveBeenCalledTimes(1);
  });

  it('schedules reconnects with exponentially growing delay after close', () => {
    const h = makeHarness();
    h.socket.start();
    const first = last();
    first.open();

    first.drop();
    expect(h.onState).toHaveBeenLastCalledWith('down');

    // First retry: base delay 500 ms.
    vi.advanceTimersByTime(499);
    expect(instances()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(instances()).toHaveLength(2);
    expect(h.onState).toHaveBeenLastCalledWith('connecting');

    // Second retry (attempt never opened): doubled to 1000 ms.
    last().drop();
    vi.advanceTimersByTime(999);
    expect(instances()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(instances()).toHaveLength(3);

    // Third retry: doubled again to 2000 ms.
    last().drop();
    vi.advanceTimersByTime(1999);
    expect(instances()).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(instances()).toHaveLength(4);
  });

  it('caps the backoff delay at 10 s', () => {
    const h = makeHarness();
    h.socket.start();

    // Burn through attempts: 500, 1000, 2000, 4000, 8000 — the next would be
    // 16000 uncapped.
    for (const delay of [500, 1000, 2000, 4000, 8000]) {
      last().drop();
      vi.advanceTimersByTime(delay);
    }
    const before = instances().length;

    last().drop();
    vi.advanceTimersByTime(10_000);
    expect(instances()).toHaveLength(before + 1);
  });

  it('calls url() afresh for every attempt', () => {
    const h = makeHarness();
    h.socket.start();
    last().open();
    last().drop();
    vi.advanceTimersByTime(500);

    expect(h.url).toHaveBeenCalledTimes(2);
    const urls = instances().map((s) => s.url);
    expect(urls[1]).not.toBe(urls[0]);
    expect(urls[1]).toBe('/ws/session/s1?since=u:1');
  });

  it('nudge() while down reconnects immediately and cancels the pending retry', () => {
    const h = makeHarness();
    h.socket.start();
    last().open();
    last().drop();
    expect(instances()).toHaveLength(1);

    h.socket.nudge();
    expect(instances()).toHaveLength(2);
    expect(h.onState).toHaveBeenLastCalledWith('connecting');

    // The previously scheduled retry must not fire on top of the nudge.
    last().open();
    vi.advanceTimersByTime(60_000);
    expect(instances()).toHaveLength(2);
  });

  it('nudge() is a no-op while connecting or open', () => {
    const h = makeHarness();
    h.socket.start();
    h.socket.nudge(); // connecting
    expect(instances()).toHaveLength(1);

    last().open();
    h.socket.nudge(); // open
    expect(instances()).toHaveLength(1);
  });

  it('stop() closes the socket and prevents any further reconnects', () => {
    const h = makeHarness();
    h.socket.start();
    const sock = last();
    sock.open();

    h.socket.stop();
    expect(sock.closed).toBe(true);

    sock.drop(); // close event arriving after stop must not resurrect it
    vi.advanceTimersByTime(60_000);
    expect(instances()).toHaveLength(1);
  });

  it('stop() cancels a pending reconnect timer', () => {
    const h = makeHarness();
    h.socket.start();
    last().open();
    last().drop(); // schedules retry in 500 ms

    h.socket.stop();
    vi.advanceTimersByTime(60_000);
    expect(instances()).toHaveLength(1);

    h.socket.nudge(); // nudge after stop is also inert
    expect(instances()).toHaveLength(1);
  });

  it('treats a socket error like a drop: goes down and schedules a retry', () => {
    const h = makeHarness();
    h.socket.start();
    const sock = last();
    sock.open();

    sock.fail();
    expect(h.onState).toHaveBeenLastCalledWith('down');
    expect(sock.closed).toBe(true);

    sock.drop(); // the close that trails a browser error must not double-schedule
    vi.advanceTimersByTime(500);
    expect(instances()).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(instances()).toHaveLength(2); // one retry, no duplicate from the trailing close
  });
});
