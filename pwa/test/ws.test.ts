import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectingSocket, wsUrl } from '../src/lib/ws';

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

// ── THE ARMS NOTHING ASKED (measured: 10 uncovered statements at 90.74%) ──
//
// Every one is a condition the socket distinguishes on purpose, and three of
// them are about the SAME question asked twice: is this callback still the
// current socket's? A stale socket that writes through is the bug the identity
// guards exist for, and nothing had driven one.
describe('ReconnectingSocket — the identity guards and the refused-attempt rung', () => {
  // ITS OWN SETUP, because the block above keeps its in the describe that owns
  // it: without this the instance list carries sockets from earlier cases and
  // the clock is real, which made four of these cases read as failures of the
  // code rather than of the harness (measured — `expected 3 to be 1`).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeSocket.instances = [];
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('start() twice is one socket — the second call is a no-op', () => {
    // `if (!this.stopped) return`. Two sockets for one stream means two `since`
    // cursors and a transcript delivered twice.
    const { socket } = makeHarness();
    socket.start();
    socket.start();
    expect(instances()).toHaveLength(1);
    socket.stop();
  });

  it('a STALE socket\'s open is ignored — only the current one may report open', () => {
    // The first socket drops, a second is made, and then the first one's
    // `onopen` lands late. Without the guard the state machine would report
    // `open` for a socket nobody is listening to, and the real one's frames
    // would arrive into a connection the UI thinks is already up.
    const { socket, onState } = makeHarness();
    socket.start();
    const first = last();
    first.open();
    first.onclose?.(new CloseEvent('close'));
    vi.advanceTimersByTime(10_000);
    const second = last();
    expect(second, 'a second socket was made').not.toBe(first);
    onState.mockClear();
    first.open();
    expect(onState, 'the stale socket cannot move the state').not.toHaveBeenCalled();
    socket.stop();
  });

  it('a STALE socket\'s frames are dropped', () => {
    const { socket, onMessage } = makeHarness();
    socket.start();
    const first = last();
    first.open();
    first.onclose?.(new CloseEvent('close'));
    vi.advanceTimersByTime(10_000);
    onMessage.mockClear();
    first.message(JSON.stringify({ type: 'hello' }));
    expect(onMessage, "a replaced socket's frame describes a connection nobody has")
      .not.toHaveBeenCalled();
    socket.stop();
  });

  it('a non-string frame is dropped without parsing', () => {
    // These streams are JSON TEXT only; a binary frame is not a frame this
    // protocol has, and `JSON.parse` on a Blob would throw inside the handler.
    const { socket, onMessage } = makeHarness();
    socket.start();
    last().open();
    last().message(new ArrayBuffer(4));
    expect(onMessage).not.toHaveBeenCalled();
    socket.stop();
  });

  it('send() answers false, never throws, when the socket dies mid-call', () => {
    // The window between the readyState check and the write. `send` returns a
    // BOOLEAN precisely so a caller can re-state on the next open rather than
    // queue — the docstring's own argument — and a throw here would reach a
    // caller that has no catch.
    const { socket } = makeHarness();
    socket.start();
    const sock = last() as unknown as { readyState: number; send: () => void; open: () => void };
    sock.readyState = 1;
    sock.open();
    sock.send = () => { throw new DOMException('InvalidStateError'); };
    expect(socket.send({ type: 'ping' })).toBe(false);
    socket.stop();
  });

  it('a constructor that THROWS goes down and schedules a retry', () => {
    // A `new WebSocket()` can throw synchronously (a malformed URL, a blocked
    // scheme). Unhandled it would escape `connect()` and leave the ladder
    // never scheduled — the socket would simply stop existing.
    const onState = vi.fn();
    const socket = new ReconnectingSocket({
      url: () => '/ws/session/s1',
      onMessage: vi.fn(),
      onState,
      makeSocket: () => { throw new DOMException('SyntaxError'); },
    });
    socket.start();
    expect(onState).toHaveBeenCalledWith('down');
    expect(vi.getTimerCount(), 'a retry is pending — the ladder did not stop').toBeGreaterThan(0);
    socket.stop();
  });

  it('an attempt that never OPENED asks whether the box is refusing us', () => {
    // The browser cannot tell a refusal from a drop, so the socket asks. Only
    // for an attempt that never opened: a connection that opened and later
    // dropped was plainly not refused, and asking then would spend a request
    // on every ordinary network blip.
    const check = vi.fn();
    const auth = { lost: () => false, check, onRegained: () => () => {} };
    const socket = new ReconnectingSocket({
      url: () => '/ws/session/s1',
      onMessage: vi.fn(),
      onState: vi.fn(),
      makeSocket: (u) => new FakeSocket(u) as unknown as WebSocket,
      auth,
    });
    socket.start();
    last().onclose?.(new CloseEvent('close'));
    expect(check, 'never opened — it may have been refused').toHaveBeenCalledTimes(1);

    check.mockClear();
    vi.advanceTimersByTime(10_000);
    last().open();
    last().onclose?.(new CloseEvent('close'));
    expect(check, 'it opened, so the drop was a drop').not.toHaveBeenCalled();
    socket.stop();
  });
});

// THE IDENTITY GUARDS, REACHED. The three stale-socket cases above prove
// `detach` works — they invoke the FakeSocket's driver, which finds the
// handler already gone, so the guard inside it never runs (measured:
// statements 165, 172 and 188 of `lib/ws.ts` uncovered with those cases
// green). That is one of two mechanisms, and only one of them is the
// browser's own hazard: an event can already be IN FLIGHT when `detach`
// removes the handler, and the handler it was dispatched to still runs. So
// these cases capture the handler first and call it after the swap — exactly
// the frame a browser has already queued.
describe('an event already in flight when the socket was replaced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeSocket.instances = [];
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  /** The first socket's handlers, held across its own replacement. */
  const firstAndSecond = () => {
    const h = makeHarness();
    h.socket.start();
    const first = last();
    const held = {
      onopen: first.onopen, onmessage: first.onmessage,
      onclose: first.onclose, onerror: first.onerror,
    };
    first.open();
    first.drop();
    vi.advanceTimersByTime(10_000);
    const second = last();
    expect(second, 'a second socket was made').not.toBe(first);
    return { ...h, held, second };
  };

  it('a queued `open` for the replaced socket cannot report open', () => {
    const { socket, onState, held } = firstAndSecond();
    onState.mockClear();
    held.onopen?.(new Event('open'));
    expect(onState, 'a socket nobody listens to reported the stream up').not.toHaveBeenCalled();
    socket.stop();
  });

  it('a queued FRAME for the replaced socket is not delivered', () => {
    // The damaging one: the frame carries a `since` cursor from the old
    // connection, so delivering it would move the reader's position
    // backwards in a stream the new socket is already ahead of.
    const { socket, onMessage, held } = firstAndSecond();
    onMessage.mockClear();
    held.onmessage?.({ data: JSON.stringify({ type: 'events', offset: 7 }) } as MessageEvent);
    expect(onMessage, "the replaced socket's frame was delivered").not.toHaveBeenCalled();
    socket.stop();
  });

  it('a queued close for the replaced socket does not take the LIVE one down', () => {
    // `handleDown` is shared by close and error, and it nulls `this.ws`. Run
    // for a stale socket it would drop the live connection and start the
    // backoff ladder over — a reconnect storm out of one late event.
    const { socket, onState, held, second } = firstAndSecond();
    onState.mockClear();
    held.onclose?.(new Event('close') as CloseEvent);
    held.onerror?.(new Event('error'));
    expect(onState, 'a stale close took the live socket down').not.toHaveBeenCalled();
    expect(second.closed, 'the live socket was torn down by a stale event').toBe(false);
    // And the live socket still works, which is the claim that matters.
    second.open();
    expect(onState).toHaveBeenCalledWith('open');
    socket.stop();
  });
});

describe('wsUrl follows the page’s own scheme', () => {
  it('a page on https gets wss, and one on http gets ws', () => {
    // A `ws://` socket from an `https://` page is blocked outright as mixed
    // content — the console is simply dead there, with no frame and no
    // refusal to read. The gate's own HTTPS arm (Caddy + DuckDNS) is the
    // ordinary deployment, so this is the arm that ships.
    const original = window.location;
    try {
      Reflect.deleteProperty(window, 'location');
      Object.defineProperty(window, 'location',
        { value: { protocol: 'https:', host: 'box.example.org' }, configurable: true, writable: true });
      expect(wsUrl('/ws/fleet')).toBe('wss://box.example.org/ws/fleet');

      Object.defineProperty(window, 'location',
        { value: { protocol: 'http:', host: 'localhost:7788' }, configurable: true, writable: true });
      expect(wsUrl('/ws/fleet')).toBe('ws://localhost:7788/ws/fleet');
    } finally {
      Reflect.deleteProperty(window, 'location');
      Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
    }
  });
});
