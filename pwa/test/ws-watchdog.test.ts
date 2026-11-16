// Console speed, task C1 (the link and the start): the socket watchdog. Part one is the pure decider
// (`lib/socketWatch.ts`); part two drives `ReconnectingSocket` with a scripted socket and fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_MS, SILENCE_MS, isBeatFrame, nextWatchStep, staleOnVisible, type WatchState } from '../src/lib/socketWatch';
import { ReconnectingSocket, type AuthGate } from '../src/lib/ws';

const at = (phase: WatchState['phase'], since: number, lastMessageAt: number | null = null): WatchState =>
  ({ phase, since, lastMessageAt });

describe('nextWatchStep, the watchdog decider', () => {
  it('the bounds are the spec’s: 30 s of silence, 10 s to connect', () => {
    expect(SILENCE_MS).toBe(30_000);
    expect(CONNECT_MS).toBe(10_000);
  });

  it('connecting at 9.9 s waits, at 10 s closes', () => {
    expect(nextWatchStep(at('connecting', 0), 9_900)).toBe('wait');
    expect(nextWatchStep(at('connecting', 0), 10_000)).toBe('close-connect');
    expect(nextWatchStep(at('connecting', 1_000), 10_500)).toBe('wait');
  });

  it('open (no beat seen) never closes for silence', () => {
    expect(nextWatchStep(at('open', 0), 60 * 60_000)).toBe('wait');
    expect(nextWatchStep(at('open', 0, 0), 60 * 60_000)).toBe('wait');
  });

  it('armed at 29.9 s of silence waits, at 30 s closes', () => {
    expect(nextWatchStep(at('armed', 0, 0), 29_900)).toBe('wait');
    expect(nextWatchStep(at('armed', 0, 0), 30_000)).toBe('close-silent');
  });

  it('a message resets the silence', () => {
    expect(nextWatchStep(at('armed', 0, 25_000), 50_000)).toBe('wait');
    expect(nextWatchStep(at('armed', 0, 25_000), 55_000)).toBe('close-silent');
  });
});

describe('staleOnVisible', () => {
  it('null is stale; 31 s old is stale; 5 s old is not', () => {
    expect(staleOnVisible(null, 1_000)).toBe(true);
    expect(staleOnVisible(0, 31_000)).toBe(true);
    expect(staleOnVisible(0, 5_000)).toBe(false);
  });
});

describe('isBeatFrame', () => {
  it('reads only {type:"beat"}', () => {
    expect(isBeatFrame({ type: 'beat' })).toBe(true);
    expect(isBeatFrame({ type: 'fleet', sessions: [] })).toBe(false);
    expect(isBeatFrame('beat')).toBe(false);
    expect(isBeatFrame(null)).toBe(false);
  });
});

/** Scripted stand-in for the browser WebSocket (the same shape as `ws.test.ts`'s). */
class FakeSocket {
  static instances: FakeSocket[] = [];
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  close(): void { this.closed = true; }
  open(): void { this.onopen?.(new Event('open')); }
  message(data: unknown): void { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}

const last = (): FakeSocket => {
  const s = FakeSocket.instances[FakeSocket.instances.length - 1];
  if (!s) throw new Error('no socket yet');
  return s;
};

interface Harness { socket: ReconnectingSocket; onMessage: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> }

const harness = (extra: { watch?: false } = {}): Harness => {
  const onMessage = vi.fn();
  const check = vi.fn();
  const auth: AuthGate = { lost: () => false, check, onRegained: () => () => {} };
  const socket = new ReconnectingSocket({
    url: () => '/ws/fleet',
    onMessage,
    onState: () => {},
    makeSocket: (u) => new FakeSocket(u) as unknown as WebSocket,
    auth,
    ...extra,
  });
  return { socket, onMessage, check };
};

const MINUTE = 60_000;

describe('ReconnectingSocket, the watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('no beat, no close in ten minutes of silence', () => {
    const h = harness();
    h.socket.start();
    last().open();
    last().message({ type: 'hello', proto: 1, min: 1 });
    vi.advanceTimersByTime(10 * MINUTE);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });

  it('after a beat, 30 s of silence closes and reconnects', () => {
    const h = harness();
    h.socket.start();
    const first = last();
    first.open();
    first.message({ type: 'beat' });
    vi.advanceTimersByTime(SILENCE_MS - 1_000);
    expect(first.closed, 'not yet: 29 s of silence').toBe(false);
    vi.advanceTimersByTime(6_000);
    expect(first.closed, 'closed within one check of 30 s').toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances, 'and reconnected after the first backoff rung').toHaveLength(2);
    expect(h.check, 'a socket that opened was not refused, so no auth probe').not.toHaveBeenCalled();
    h.socket.stop();
  });

  it('a beat every 10 s keeps it open for ten minutes', () => {
    const h = harness();
    h.socket.start();
    last().open();
    for (let t = 0; t < 10 * MINUTE; t += 10_000) {
      last().message({ type: 'beat' });
      vi.advanceTimersByTime(10_000);
    }
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });

  it('fleet frames every 20 s with no beats after the first keep it open', () => {
    const h = harness();
    h.socket.start();
    last().open();
    last().message({ type: 'beat' });
    for (let t = 0; t < 10 * MINUTE; t += 20_000) {
      vi.advanceTimersByTime(20_000);
      last().message({ type: 'fleet', sessions: [] });
    }
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });

  it('a beat is the socket’s own frame: it never reaches onMessage', () => {
    const h = harness();
    h.socket.start();
    last().open();
    last().message({ type: 'beat' });
    last().message({ type: 'fleet', sessions: [] });
    expect(h.onMessage.mock.calls).toEqual([[{ type: 'fleet', sessions: [] }]]);
    h.socket.stop();
  });

  it('a socket that never opens is closed after 10 s and retried', () => {
    const h = harness();
    h.socket.start();
    const first = last();
    vi.advanceTimersByTime(CONNECT_MS - 1_000);
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(6_000);
    expect(first.closed).toBe(true);
    expect(h.check, 'it never opened, so it may have been refused: ask').toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    h.socket.stop();
  });

  // A hidden tab's timers are throttled, so the check may not have run when the page comes back: the clock moves on
  // without them (`setSystemTime` fires no timer), and the nudge is what notices.
  it('nudge on visible with a 40 s old last message reconnects at once', () => {
    const h = harness();
    h.socket.start();
    const first = last();
    first.open();
    first.message({ type: 'beat' });
    vi.setSystemTime(Date.now() + 40_000);
    h.socket.nudge();
    expect(first.closed).toBe(true);
    expect(FakeSocket.instances, 'a new attempt, with no backoff wait').toHaveLength(2);
    h.socket.stop();
  });

  it('visible return with no beat ever seen leaves the open socket alone', () => {
    const h = harness();
    h.socket.start();
    last().open();
    last().message({ type: 'hello', proto: 1, min: 1 });
    vi.advanceTimersByTime(40_000);
    h.socket.nudge();
    vi.setSystemTime(Date.now() + 10 * MINUTE);
    h.socket.nudge();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });

  it('nudge on visible with a fresh socket does nothing', () => {
    const h = harness();
    h.socket.start();
    last().open();
    vi.advanceTimersByTime(20_000);
    last().message({ type: 'beat' });
    vi.advanceTimersByTime(5_000);
    h.socket.nudge();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });

  it('nudge while connecting leaves the attempt to its connect limit', () => {
    const h = harness();
    h.socket.start();
    vi.advanceTimersByTime(5_000);
    h.socket.nudge();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });

  it('stop clears the check timer', () => {
    const h = harness();
    h.socket.start();
    last().open();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.socket.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a drop clears the check timer: only the backoff timer is left', () => {
    const h = harness();
    h.socket.start();
    last().open();
    last().onclose?.(new Event('close') as CloseEvent);
    expect(vi.getTimerCount()).toBe(1);
    h.socket.stop();
  });

  it('watch: false never closes, for silence, a slow connect or a nudge', () => {
    const h = harness({ watch: false });
    h.socket.start();
    vi.advanceTimersByTime(MINUTE);
    expect(last().closed).toBe(false);
    last().open();
    last().message({ type: 'beat' });
    vi.advanceTimersByTime(10 * MINUTE);
    h.socket.nudge();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().closed).toBe(false);
    h.socket.stop();
  });
});
