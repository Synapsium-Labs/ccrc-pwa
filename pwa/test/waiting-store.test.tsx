// The fleet store's `waiting` frame and the Waiting list's refetch (desktop-polish PL5a, D-7712).
//
// `waiting` is `null` until a frame (or a refetch) lands: "no frame yet" is not an empty list, so a reader that needs
// the difference reads `null`, never `items.length === 0`. The server re-sends the frame only when the fleet changes,
// so a quiet fleet sends none when an item crosses its 30 minutes (review 1336): `useWaitingRefetch` reads
// `GET /api/waiting` again when the tab regains focus or becomes visible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { api, createApi } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { createFleetStore } from '../src/stores/fleet';
import { refetchWaiting, useWaitingRefetch } from '../src/ledgers/waitingStore';
import { itemView, waitingView } from './ledgersFixture';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  close(): void {}
  open(): void { this.onopen?.(new Event('open')); }
  message(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;
const lastSocket = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1]!;

beforeEach(() => { FakeSocket.instances = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const connected = () => {
  const store = createFleetStore({ makeSocket });
  store.getState().connect();
  lastSocket().open();
  return store;
};

describe('the `waiting` frame', () => {
  it('starts null, and a well-formed frame is held whole', () => {
    expect(createFleetStore({ makeSocket }).getState().waiting).toBeNull();
    const store = connected();
    expect(store.getState().waiting).toBeNull();
    const view = waitingView({ items: [itemView({ id: 3 })] });
    lastSocket().message(JSON.stringify({ type: 'waiting', waiting: view }));
    expect(store.getState().waiting).toEqual(view);
    store.getState().disconnect();
  });

  it('a malformed frame is dropped and the held view stays', () => {
    const store = connected();
    const view = waitingView({ items: [itemView({ id: 3 })] });
    lastSocket().message(JSON.stringify({ type: 'waiting', waiting: view }));
    for (const bad of [
      { type: 'waiting' },
      { type: 'waiting', waiting: null },
      { type: 'waiting', waiting: { items: {}, cleared: [], goals: [] } },
      { type: 'waiting', waiting: { items: [], cleared: 'x', goals: [] } },
      { type: 'waiting', waiting: { items: [], cleared: [] } },
    ]) {
      lastSocket().message(JSON.stringify(bad));
      expect(store.getState().waiting, JSON.stringify(bad)).toEqual(view);
    }
    store.getState().disconnect();
  });

  it('a reconnect keeps the last view: a blip is not an empty list', () => {
    const store = connected();
    const view = waitingView({ items: [itemView({ id: 3 })] });
    lastSocket().message(JSON.stringify({ type: 'waiting', waiting: view }));
    store.getState().connect();
    lastSocket().open();
    expect(store.getState().waiting).toEqual(view);
    store.getState().disconnect();
  });
});

function Mount({ store, load }: { store: ReturnType<typeof createFleetStore>; load: () => Promise<unknown> }) {
  useWaitingRefetch(store, load as never);
  return null;
}

describe('the refetch', () => {
  const fresh = waitingView({ items: [itemView({ id: 11, title: 'Raised while the tab was away' })] });

  it('reads GET /api/waiting again when the tab regains focus', async () => {
    const store = createFleetStore({ makeSocket });
    const load = vi.fn(async () => ({ ok: true, waiting: fresh }));
    render(<Mount store={store} load={load} />);
    expect(load).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().waiting).toEqual(fresh);
  });

  it('reads it again when the page becomes visible, and not when it is hidden', async () => {
    const store = createFleetStore({ makeSocket });
    const load = vi.fn(async () => ({ ok: true, waiting: fresh }));
    render(<Mount store={store} load={load} />);
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(load).not.toHaveBeenCalled();
    vis.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().waiting).toEqual(fresh);
  });

  it('a failed read leaves the held view alone', async () => {
    const store = createFleetStore({ makeSocket });
    const held = waitingView({ items: [itemView({ id: 2 })] });
    act(() => store.setState({ waiting: held }));
    const load = vi.fn(async () => { throw new TypeError('offline'); });
    render(<Mount store={store} load={load} />);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().waiting).toEqual(held);
  });

  it('stops listening when it unmounts', async () => {
    const store = createFleetStore({ makeSocket });
    const load = vi.fn(async () => ({ ok: true, waiting: fresh }));
    const view = render(<Mount store={store} load={load} />);
    view.unmount();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('what a read puts on the store (review 1359 F5)', () => {
  it('takes exactly what the frame takes: a list of three arrays, and nothing else', async () => {
    const store = createFleetStore({ makeSocket });
    const held = waitingView({ items: [itemView({ id: 2 })] });
    act(() => store.setState({ waiting: held }));
    for (const bad of [{ items: [] }, { items: [], cleared: [] }, { items: {}, cleared: [], goals: [] }, null]) {
      expect(await refetchWaiting(store, async () => ({ ok: true, waiting: bad }) as never), JSON.stringify(bad)).toBe('failed');
      expect(store.getState().waiting, JSON.stringify(bad)).toEqual(held);
    }
    const fresh = waitingView({ items: [itemView({ id: 3 })] });
    expect(await refetchWaiting(store, async () => ({ ok: true, waiting: fresh }))).toBe('read');
    expect(store.getState().waiting).toEqual(fresh);
  });

  it('says why a read gave nothing: a box with no coordination database is not an offline tab', async () => {
    const store = createFleetStore({ makeSocket });
    expect(await refetchWaiting(store, async () => { throw new ApiError(503, { ok: false, error: 'not-configured' }); })).toBe('not-configured');
    expect(await refetchWaiting(store, async () => { throw new ApiError(500, { ok: false, error: 'boom' }); })).toBe('failed');
    expect(await refetchWaiting(store, async () => { throw new TypeError('offline'); })).toBe('failed');
    expect(store.getState().waiting).toBeNull();
  });
});

describe('one read in flight at a time (review 1359 F12d)', () => {
  const later = <T,>() => { let release!: (v: T) => void; const done = new Promise<T>((r) => { release = r; }); return { done, release }; };
  const answer = (id: number) => ({ ok: true as const, waiting: waitingView({ items: [itemView({ id })] }) });

  it('a tab that becomes visible and focused reads once', async () => {
    const store = createFleetStore({ makeSocket });
    const first = later<ReturnType<typeof answer>>();
    const load = vi.fn(() => first.done);
    render(<Mount store={store} load={load} />);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { first.release(answer(1)); });
    expect(store.getState().waiting?.items[0]?.id).toBe(1);
    // Joined, not queued: nothing starts a second read behind the first once it has come back.
    expect(load).toHaveBeenCalledTimes(1);
    vis.mockRestore();
  });

  it('a read asked for after a move starts after the one on the wire, so it sees the move', async () => {
    const store = createFleetStore({ makeSocket });
    const first = later<ReturnType<typeof answer>>();
    const load = vi.fn().mockReturnValueOnce(first.done).mockResolvedValueOnce(answer(2));
    const joined = refetchWaiting(store, load, true);        // a focus read, on the wire
    const after = refetchWaiting(store, load);               // the tick's own re-read
    expect(load).toHaveBeenCalledTimes(1);
    first.release(answer(1));
    expect(await joined).toBe('read');
    expect(await after).toBe('read');
    expect(load).toHaveBeenCalledTimes(2);                   // its own read, started after the first came back
    expect(store.getState().waiting?.items[0]?.id).toBe(2);
  });

  it('reads that join the one on the wire share its answer, and a later ask starts a new read', async () => {
    const store = createFleetStore({ makeSocket });
    const first = later<ReturnType<typeof answer>>();
    const load = vi.fn().mockReturnValueOnce(first.done).mockResolvedValueOnce(answer(5));
    const a = refetchWaiting(store, load, true);
    const b = refetchWaiting(store, load, true);
    first.release(answer(4));
    await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    await refetchWaiting(store, load, true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getState().waiting?.items[0]?.id).toBe(5);
  });
});

describe('the Waiting on you api calls', () => {
  const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('reads the list with GET /api/waiting', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ ok: true, waiting: waitingView() }));
    await createApi(fetchImpl as unknown as typeof fetch).waiting();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/waiting');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('a tick carries the answer only when there is one, and a do item sends no body at all', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => ok({ ok: true, item: itemView() }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.tickItem(7, 'Library first');
    await api.tickItem(8);
    const [u1, i1] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [u2, i2] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect([u1, i1.method, i1.body]).toEqual(['/api/items/7/tick', 'POST', JSON.stringify({ answer: 'Library first' })]);
    expect([u2, i2.method, i2.body]).toEqual(['/api/items/8/tick', 'POST', undefined]);
  });

  it('dismiss posts to /api/items/:id/dismiss', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ ok: true, item: itemView() }));
    await createApi(fetchImpl as unknown as typeof fetch).dismissItem(9);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect([url, init.method]).toEqual(['/api/items/9/dismiss', 'POST']);
  });
});

describe('the shell mounts the refetch once', () => {
  it('FleetChromeProvider reads GET /api/waiting when the tab regains focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const store = createFleetStore({ makeSocket });
    const fresh = waitingView({ items: [itemView({ id: 21 })] });
    const spy = vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: fresh });
    render(<FleetChromeProvider store={store}><span /></FleetChromeProvider>);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.getState().waiting).toEqual(fresh);
    vi.unstubAllGlobals();
  });
});
