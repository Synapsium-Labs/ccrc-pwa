// W7 Task C7n's single readers (D-7192, D-7209; ARCH-75; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md).
// The fleet store owns the one `GET /api/feed` read: `refreshFeed()` is its on-demand door, beside `refreshAccounts()`,
// and the connect-time durable read goes through the same reader. `useColdRuns` keeps its three transition re-reads
// by default and drops them when a caller asks for once-per-mount.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import type { NotifyEvent } from '../../shared/api';
import { createFleetStore, type FleetStore, type FleetStoreDeps } from '../src/stores/fleet';
import { api } from '../src/lib/api';

/** A socket that never opens, so `connect()` is driven by hand through its `onopen`. */
interface FakeSocket { onopen: (() => void) | null; onmessage: unknown; onclose: unknown; onerror: unknown; close(): void }
const sockets: FakeSocket[] = [];
const makeStore = (deps: FleetStoreDeps = {}): FleetStore => createFleetStore({
  makeSocket: () => {
    const s: FakeSocket = { onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} };
    sockets.push(s);
    return s as unknown as WebSocket;
  },
  catchUp: async () => ({ epoch: 'epoch-a', seq: 0, events: [] }) as never,
  ...deps,
});
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

const event = (seq: number): NotifyEvent => ({ seq, at: 1_784_500_000_000, kind: 'mail', sessionId: 'session-a', title: 'a finding', body: 'a record', runId: null });

beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('refreshFeed(): the store\'s one feed reader, on demand', () => {
  it('one request per call, limit 100, through the injected reader', async () => {
    const fetchFeed = vi.fn(async (_limit: number) => ({ events: [] as NotifyEvent[] }));
    const store = makeStore({ fetchFeed });
    await store.getState().refreshFeed();
    expect(fetchFeed.mock.calls).toEqual([[100]]);
    await store.getState().refreshFeed();
    expect(fetchFeed.mock.calls).toEqual([[100], [100]]);
  });

  it('the default reader is api.feed(100)', async () => {
    const feed = vi.spyOn(api, 'feed').mockResolvedValue({ events: [] } as never);
    await makeStore().getState().refreshFeed();
    expect(feed.mock.calls).toEqual([[100]]);
  });

  it('the answer is merged through mergeFeed, its dropped count included, and resolves ok', async () => {
    const unreadable = { seq: 9, at: 1, kind: 'mail' } as unknown as NotifyEvent;   // no title: not revivable
    const store = makeStore({ fetchFeed: async () => ({ events: [event(2), event(1), unreadable] }) });
    await expect(store.getState().refreshFeed()).resolves.toBe('ok');
    expect(store.getState().feed.map((e) => e.seq)).toEqual([1, 2]);
    expect(store.getState().feedDropped).toBe(1);
  });

  it('a rejected read resolves error and writes nothing', async () => {
    const store = makeStore({ fetchFeed: async () => { throw new Error('down'); } });
    store.getState().mergeFeed([event(1)], 0);
    await expect(store.getState().refreshFeed()).resolves.toBe('error');
    expect(store.getState().feed.map((e) => e.seq)).toEqual([1]);
    expect(store.getState().feedDropped).toBe(0);
  });

  it('the connect-time durable read and refreshFeed share the one reader', async () => {
    const fetchFeed = vi.fn(async (_limit: number) => ({ events: [event(1)] }));
    const store = makeStore({ fetchFeed });
    store.getState().connect();
    act(() => { sockets[0]!.onopen?.(); });
    await flush();
    expect(fetchFeed.mock.calls).toEqual([[100]]);
    expect(store.getState().feed.map((e) => e.seq)).toEqual([1]);
    await store.getState().refreshFeed();
    expect(fetchFeed.mock.calls).toEqual([[100], [100]]);
    store.getState().disconnect();
  });
});
