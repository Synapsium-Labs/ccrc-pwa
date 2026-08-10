// The two things the client tells the server about a live connection: which
// session is on screen (so notifications for it are suppressed) and how far
// through the notification log this device has got.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSessionStore } from '../src/stores/session';
import { createFleetStore } from '../src/stores/fleet';
import { saveMark, loadMark } from '../src/lib/notifymark';
import { PRESENCE_TTL_MS, type CatchUp } from '../../shared/api';

/** A WebSocket fake that records what was sent and can be opened at will. */
function fakeSocket(): { ws: WebSocket; sent: unknown[]; open: () => void } {
  const sent: unknown[] = [];
  const ws = {
    onopen: null as null | (() => void),
    onmessage: null,
    onclose: null,
    onerror: null,
    readyState: 1,
    send(raw: string): void { sent.push(JSON.parse(raw)); },
    close(): void { /* noop */ },
  };
  return {
    ws: ws as unknown as WebSocket,
    sent,
    open: () => ws.onopen?.(),
  };
}

const setVisibility = (v: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};

beforeEach(() => {
  localStorage.clear();
  setVisibility('visible');
});

describe('reporting which session is on screen', () => {
  it('says so as soon as the socket opens', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    expect(f.sent).toEqual([{ type: 'visible', visible: true }]);
  });

  it('re-states it on every reconnect, because presence is per-connection', () => {
    // The server keys presence by the socket, so a reconnect starts with no
    // claim at all — a session the operator is still looking at would quietly
    // start pushing again if this were only sent once.
    const f = fakeSocket();
    const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    f.open();
    expect(f.sent).toEqual([
      { type: 'visible', visible: true },
      { type: 'visible', visible: true },
    ]);
  });

  it('reports hidden when the tab is backgrounded, and visible again after', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.sent.at(-1)).toEqual({ type: 'visible', visible: false });
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.sent.at(-1)).toEqual({ type: 'visible', visible: true });
  });

  it('says it is gone when the screen is left', () => {
    const f = fakeSocket();
    const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    store.getState().disconnect();
    expect(f.sent.at(-1)).toEqual({ type: 'visible', visible: false });
  });

  it('opens hidden when the tab was never in the foreground', () => {
    setVisibility('hidden');
    const f = fakeSocket();
    const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
    store.getState().connect();
    f.open();
    expect(f.sent).toEqual([{ type: 'visible', visible: false }]);
  });

  // PR F whole-branch review, Important 6. The server releases a claim on the
  // socket's 'close' — and a phone that loses signal in a lift or a tunnel
  // sends no FIN, so 'close' never fires and the claim would suppress every
  // notification for that session indefinitely. The server therefore expires
  // claims, and this is what keeps a live one alive.
  it('re-states the claim on a heartbeat, so a socket that dies silently stops suppressing', () => {
    vi.useFakeTimers();
    try {
      const f = fakeSocket();
      const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
      store.getState().connect();
      f.open();
      expect(f.sent).toHaveLength(1);
      vi.advanceTimersByTime(PRESENCE_TTL_MS);
      // Strictly more than one refresh inside a TTL — that ratio is the whole
      // point: a claim survives a lost frame, but not a dead client.
      expect(f.sent.length).toBeGreaterThan(2);
      expect(f.sent.every((m) => (m as { visible: boolean }).visible)).toBe(true);
      // And it stops with the screen: nothing beats on after teardown, or a
      // closed session would keep claiming presence through a pooled socket.
      store.getState().disconnect();
      const after = f.sent.length;
      vi.advanceTimersByTime(PRESENCE_TTL_MS * 3);
      expect(f.sent).toHaveLength(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep claiming a session while the tab is in the background', () => {
    vi.useFakeTimers();
    try {
      const f = fakeSocket();
      const store = createSessionStore('cc-a', { makeSocket: () => f.ws });
      store.getState().connect();
      f.open();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      const after = f.sent.length;
      vi.advanceTimersByTime(PRESENCE_TTL_MS * 3);
      // The hidden report already deleted the claim server-side; repeating a
      // deletion says nothing new.
      expect(f.sent).toHaveLength(after);
      store.getState().disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the reconnect catch-up', () => {
  const resp = (r: Partial<CatchUp> = {}): CatchUp =>
    ({ epoch: 'e1', seq: 5, resync: false, events: [], ...r });

  it('sends the stored pair and adopts what comes back', async () => {
    saveMark({ epoch: 'e1', seq: 3 });
    const seen: [string | null, number][] = [];
    const catchUp = vi.fn(async (e: string | null, s: number) => {
      seen.push([e, s]);
      return resp({ seq: 5, events: [
        { seq: 4, at: 1, kind: 'ask', sessionId: 'cc-a', title: 'q', body: '' },
        { seq: 5, at: 2, kind: 'done', sessionId: 'cc-b', title: 'f', body: '' },
      ] });
    });
    const f = fakeSocket();
    const store = createFleetStore({ makeSocket: () => f.ws, catchUp });
    store.getState().connect();
    f.open();
    await vi.waitFor(() => expect(store.getState().feed).toHaveLength(2));
    expect(seen).toEqual([['e1', 3]]);
    expect(loadMark()).toEqual({ epoch: 'e1', seq: 5 });
  });

  it('asks with no mark at all on a fresh install', async () => {
    const catchUp = vi.fn(async () => resp());
    const f = fakeSocket();
    createFleetStore({ makeSocket: () => f.ws, catchUp }).getState().connect();
    f.open();
    await vi.waitFor(() => expect(catchUp).toHaveBeenCalledWith(null, 0));
  });

  it('badges nothing retroactively when the server says resync', async () => {
    saveMark({ epoch: 'old', seq: 9 });
    const catchUp = vi.fn(async () => resp({
      epoch: 'new', seq: 2, resync: true,
      events: [{ seq: 1, at: 1, kind: 'ask', sessionId: 'cc-a', title: 'q', body: '' }],
    }));
    const f = fakeSocket();
    const store = createFleetStore({ makeSocket: () => f.ws, catchUp });
    store.getState().connect();
    f.open();
    await vi.waitFor(() => expect(loadMark()).toEqual({ epoch: 'new', seq: 2 }));
    // The events came back, and are deliberately dropped: the server could not
    // prove this device saw everything, so anything shown would be fabricated.
    expect(store.getState().feed).toEqual([]);
  });

  it('asks again on every reconnect — a slept phone is the point', async () => {
    const catchUp = vi.fn(async () => resp());
    const f = fakeSocket();
    createFleetStore({ makeSocket: () => f.ws, catchUp }).getState().connect();
    f.open();
    f.open();
    await vi.waitFor(() => expect(catchUp).toHaveBeenCalledTimes(2));
  });

  it('a failing catch-up leaves the fleet stream alone', async () => {
    const catchUp = vi.fn(async () => { throw new Error('offline'); });
    const f = fakeSocket();
    const store = createFleetStore({ makeSocket: () => f.ws, catchUp });
    store.getState().connect();
    f.open();
    await vi.waitFor(() => expect(catchUp).toHaveBeenCalled());
    expect(store.getState().feed).toEqual([]);
    expect(store.getState().conn).toBe('open');
  });

  // PR F whole-branch review (triage). A reconnect storm can open the socket
  // again while the first catch-up is still in flight. Unserialised, the second
  // reads the same STALE mark, asks for the same range, and whichever response
  // lands last is what gets persisted — so `feed` gains duplicates and the
  // durable mark can go BACKWARDS, which on a one-way advance is the one
  // direction that can lose events for good.
  it('serialises catch-ups, so a reconnect storm cannot re-ask or rewind the mark', async () => {
    saveMark({ epoch: 'e1', seq: 3 });
    const seen: [string | null, number][] = [];
    let release: ((r: CatchUp) => void) | null = null;
    const catchUp = vi.fn((e: string | null, s: number) => {
      seen.push([e, s]);
      // The FIRST call hangs until the test releases it; the second (fired
      // while it is still in flight) must not have read the mark yet.
      if (release === null) return new Promise<CatchUp>((r) => { release = r; });
      return Promise.resolve(resp({ seq: 9, events: [] }));
    });
    const f = fakeSocket();
    const store = createFleetStore({ makeSocket: () => f.ws, catchUp });
    store.getState().connect();
    f.open();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    f.open();                                    // reconnect while #1 is in flight
    expect(seen).toHaveLength(1);                // queued behind it, not fired
    release!(resp({ seq: 7, events: [
      { seq: 6, at: 1, kind: 'ask', sessionId: 'cc-a', title: 'q', body: '' },
      { seq: 7, at: 2, kind: 'done', sessionId: 'cc-b', title: 'f', body: '' },
    ] }));
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    // The second request read what the first one WROTE.
    expect(seen[1]).toEqual(['e1', 7]);
    await vi.waitFor(() => expect(loadMark()).toEqual({ epoch: 'e1', seq: 9 }));
    expect(store.getState().feed.map((e) => e.seq)).toEqual([6, 7]);
  });

  it('clearFeed empties the list', async () => {
    const catchUp = vi.fn(async () => resp({
      events: [{ seq: 5, at: 1, kind: 'ask', sessionId: 'cc-a', title: 'q', body: '' }],
    }));
    const f = fakeSocket();
    const store = createFleetStore({ makeSocket: () => f.ws, catchUp });
    store.getState().connect();
    f.open();
    await vi.waitFor(() => expect(store.getState().feed).toHaveLength(1));
    store.getState().clearFeed();
    expect(store.getState().feed).toEqual([]);
  });
});
