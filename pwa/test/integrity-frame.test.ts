// THE INTEGRITY CENSUS REACHES THE STORE (D-5104, the audit's F5, data half).
//
// The server has sent a `divergence` frame on `/ws/fleet` since §1.6's census
// landed (`server/src/server.ts`, `onDivergence`), and `FleetMsg` has declared
// it ever since (`shared/api.ts`). The fleet store's `asFleetMsg` had no arm
// for it, so every frame was dropped as an unknown type. These cases drive the
// store through its own socket seam (`createFleetStore`'s `deps.makeSocket`),
// with `stores.test.ts`'s `FakeSocket` pattern, never by poking `setState`.
//
// THE ONE FACT THAT SHAPES THE STATE: the frame has NO COLD START. The server
// sends it only when the census changes, so a client that connected after the
// last change has seen nothing at all — and `[]` would be a claim of
// "measured, none" that this page cannot stand behind. So the store keeps
// `null` for "no frame since this page loaded" apart from an empty census, and
// a reconnect keeps the last census it had, with the time it arrived: that is
// still the last measurement, and its age says how old it is.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Divergence } from '../../shared/api';
import { createFleetStore, type FleetStoreDeps } from '../src/stores/fleet';
import { integrityView } from '../src/fleet/integrityWords';
import { saveFleetSnapshot } from '../src/lib/offline';
import { fleetSession } from './fleetFixture';

/** Minimal scripted WebSocket stand-in — `stores.test.ts`'s own, plus `drop()`
 *  for a socket that dies under an open stream. */
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

  open(): void {
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  /** The server went away mid-stream: `ReconnectingSocket` schedules its own
   *  reconnect off this, exactly as it does in a browser. */
  drop(): void {
    this.onclose?.({} as CloseEvent);
  }
}

const lastSocket = (): FakeSocket => {
  const sock = FakeSocket.instances[FakeSocket.instances.length - 1];
  if (!sock) throw new Error('no FakeSocket created yet');
  return sock;
};

/** Every network seam the store has, made inert: the census is the subject, and
 *  a catch-up or roster read reaching jsdom's absent server is noise. */
const deps: FleetStoreDeps = {
  makeSocket: (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket,
  catchUp: () => new Promise(() => {}),
  fetchFeed: () => new Promise(() => {}),
  fetchAccounts: () => new Promise(() => {}),
};

const drift: Divergence = {
  kind: 'branch-drift', id: 'lane-a-project-a', path: '/w/project-a',
  detail: "the registry says main, the worktree's own HEAD says topic",
};
const leak: Divergence = {
  kind: 'unregistered-worktree', id: null, path: '/w/project-a-stray',
  detail: 'git records a worktree at /w/project-a-stray that no registry row claims',
};

const frame = (divergences: unknown): string => JSON.stringify({ type: 'divergence', divergences });

const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);

beforeEach(() => {
  FakeSocket.instances = [];
  window.localStorage.clear();
  // Fake time, so the census's receive time is a known number and the
  // reconnect case below can advance the socket's own backoff timer.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the `divergence` frame', () => {
  it('a divergence frame lands in the store with its time', () => {
    const store = createFleetStore(deps);
    store.getState().connect();
    lastSocket().open();

    vi.setSystemTime(T0 + 5_000);
    lastSocket().message(frame([drift, leak]));
    expect(store.getState().divergenceCensus).toEqual({ items: [drift, leak], at: T0 + 5_000 });

    // A later census replaces the whole of the earlier one, time included:
    // the server sends the census entire on every change, never a delta.
    vi.setSystemTime(T0 + 65_000);
    lastSocket().message(frame([leak]));
    expect(store.getState().divergenceCensus).toEqual({ items: [leak], at: T0 + 65_000 });

    // And an empty census is a MEASUREMENT — "measured, none" — so it lands
    // as one, with its time, never as the absence `null` stands for.
    vi.setSystemTime(T0 + 125_000);
    lastSocket().message(frame([]));
    expect(store.getState().divergenceCensus).toEqual({ items: [], at: T0 + 125_000 });
    store.getState().disconnect();
  });

  it('a frame without an array is dropped, and the last census stands', () => {
    const store = createFleetStore(deps);
    store.getState().connect();
    lastSocket().open();

    // Before any good frame: a malformed one leaves "no frame yet" standing.
    expect(() => lastSocket().message(JSON.stringify({ type: 'divergence' }))).not.toThrow();
    expect(store.getState().divergenceCensus).toBeNull();

    lastSocket().message(frame([drift]));
    const prior = store.getState().divergenceCensus;
    expect(prior).toEqual({ items: [drift], at: T0 });

    vi.setSystemTime(T0 + 30_000);
    for (const bad of [
      JSON.stringify({ type: 'divergence' }),
      frame(null),
      frame({ 0: drift, length: 1 }),
      frame('branch-drift'),
      frame(3),
    ]) {
      expect(() => lastSocket().message(bad)).not.toThrow();
      // The SAME object, so neither its items nor its time moved: a bad frame
      // is not a newer measurement.
      expect(store.getState().divergenceCensus).toBe(prior);
    }
    store.getState().disconnect();
  });

  it('a member of a kind this build cannot name is kept and counted, never dropped', () => {
    // The plan's rule at the BOUNDARY: `asFleetMsg` checks the envelope only,
    // and the store keeps every member as it arrived. A filter here, in the arm
    // or in the `set`, would store a newer server's census of nothing but new
    // kinds as `{ items: [] }`, which `integrityView` reads as clean: the false
    // all-clear the plan's review focus 10 names. The model's own case
    // (`integrity-words.test.ts`) feeds the model directly, so it cannot see a
    // member lost before the model is reached.
    const strangers: unknown[] = [
      { kind: 'from-a-newer-server', id: 'lane-a-project-a', path: null, detail: 'a kind this build never heard of' },
      { kind: 42, id: null, path: null, detail: 'a kind that is not a string' },
      { id: null, path: '/w/project-a', detail: 'no kind at all' },
      null,
    ];
    const store = createFleetStore(deps);
    store.getState().connect();
    lastSocket().open();

    // Beside a member this build can name, in the frame's own order.
    lastSocket().message(frame([drift, ...strangers]));
    expect(store.getState().divergenceCensus).toEqual({ items: [drift, ...strangers], at: T0 });

    // Nothing but strangers: still a census of four, read through the model,
    // so the whole path from the socket to the view is pinned.
    vi.setSystemTime(T0 + 10_000);
    lastSocket().message(frame(strangers));
    const census = store.getState().divergenceCensus;
    expect(census).toEqual({ items: strangers, at: T0 + 10_000 });
    const view = integrityView(census, T0 + 10_000);
    expect(view.state).toBe('diverged');
    expect(view.state === 'diverged' && view.total).toBe(strangers.length);
    store.getState().disconnect();
  });

  it('before any frame the census is null, not an empty list', () => {
    // A persisted snapshot on disk, so a cold store hydrates SOMETHING — the
    // census must not ride it: a census from an earlier page load is not a
    // frame this page has received.
    saveFleetSnapshot([fleetSession({ id: 'lane-a-project-a', project: 'project-a' })], []);
    const store = createFleetStore(deps);
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['lane-a-project-a']);
    expect(store.getState().divergenceCensus).toBeNull();

    // Every other frame the stream sends, and the census is still unmeasured.
    store.getState().connect();
    lastSocket().open();
    lastSocket().message(JSON.stringify({ type: 'hello', proto: 1, min: 1 }));
    lastSocket().message(JSON.stringify({ type: 'fleet', sessions: [] }));
    lastSocket().message(JSON.stringify({ type: 'runs', runs: [] }));
    lastSocket().message(JSON.stringify({ type: 'coord', coord: { pause: 'clear', mail: 'clear' } }));
    expect(store.getState().divergenceCensus).toBeNull();
    store.getState().disconnect();
  });

  it('a reconnect keeps the last census', () => {
    const store = createFleetStore(deps);
    store.getState().connect();
    lastSocket().open();
    lastSocket().message(frame([drift, leak]));
    const prior = store.getState().divergenceCensus;
    expect(prior).toEqual({ items: [drift, leak], at: T0 });

    // (1) The server goes away mid-stream, and the socket's own backoff brings
    // it back: a NEW socket, a second `onOpen`. The server sends no census on
    // connect, so nothing replaces the last one — and nothing may clear it.
    const first = lastSocket();
    vi.setSystemTime(T0 + 40_000);
    first.drop();
    expect(store.getState().conn).toBe('down');
    vi.advanceTimersByTime(10_000);
    expect(lastSocket()).not.toBe(first);
    lastSocket().open();
    expect(store.getState().conn).toBe('open');
    expect(store.getState().divergenceCensus).toBe(prior);

    // (2) A genuine `disconnect()` then `connect()` (the app's own teardown and
    // remount) tears the socket down and asks for a fresh one. A reset hiding in
    // `connect()`, in `disconnect()` or in `onOpen` is caught here too.
    const second = lastSocket();
    store.getState().disconnect();
    expect(store.getState().divergenceCensus).toBe(prior);
    store.getState().connect();
    expect(lastSocket()).not.toBe(second);
    lastSocket().open();
    expect(store.getState().divergenceCensus).toBe(prior);
    expect(store.getState().divergenceCensus?.at).toBe(T0);
    store.getState().disconnect();
  });
});
