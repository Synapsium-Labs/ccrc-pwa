// Console speed, task C1 (the link and the start): the read time limit in `lib/api.ts`'s one funnel. A GET gets
// `READ_TIMEOUT_MS` unless it passes its own; a POST never gets a default; a timeout is a distinct `ApiTimeout`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiTimeout, READ_TIMEOUT_MS, createApi } from '../src/lib/api';
import { authLost, clearAuthLost } from '../src/lib/auth';

/** A fetch that never settles on its own: it rejects only if its signal aborts, with the signal's reason. */
const hangingFetch = () => vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
}));

/** A fetch that never settles, whatever its signal does. */
const deafFetch = () => vi.fn(() => new Promise<Response>(() => {}));

type Outcome = { s: 'pending' } | { s: 'ok'; v: unknown } | { s: 'err'; e: unknown };
const watch = (p: Promise<unknown>): { now: () => Outcome } => {
  let out: Outcome = { s: 'pending' };
  p.then((v) => { out = { s: 'ok', v }; }, (e: unknown) => { out = { s: 'err', e }; });
  return { now: () => out };
};

describe('the read time limit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); clearAuthLost(); vi.restoreAllMocks(); });

  it('is 20 s', () => {
    expect(READ_TIMEOUT_MS).toBe(20_000);
  });

  it('a GET rejects ApiTimeout at 20 s', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const read = watch(api.coordCaps());
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(read.now().s).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    const out = read.now();
    expect(out.s).toBe('err');
    const e = (out as { e: unknown }).e;
    expect(e).toBeInstanceOf(ApiTimeout);
    expect(e).not.toBeInstanceOf(ApiError);
    expect((e as ApiTimeout).path).toBe('/api/coord/caps');
    expect((e as ApiTimeout).ms).toBe(READ_TIMEOUT_MS);
  });

  it('a GET rejects ApiTimeout even when the fetch ignores its signal', async () => {
    const api = createApi(deafFetch() as unknown as typeof fetch);
    const read = watch(api.coordCaps());
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect((read.now() as { e?: unknown }).e).toBeInstanceOf(ApiTimeout);
  });

  it('the fetch is aborted when the limit passes', async () => {
    const fetchImpl = hangingFetch();
    const api = createApi(fetchImpl as unknown as typeof fetch);
    void api.coordCaps().catch(() => {});
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(init.signal?.aborted).toBe(true);
  });

  it('a GET with timeoutMs 60000 is still pending at 20 s', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const read = watch(api.updates({ timeoutMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(read.now().s).toBe('pending');
    await vi.advanceTimersByTimeAsync(40_000);
    expect((read.now() as { e?: unknown }).e).toBeInstanceOf(ApiTimeout);
  });

  it('a GET with timeoutMs null never times out', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const read = watch(api.updates({ timeoutMs: null }));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(read.now().s).toBe('pending');
  });

  it('a POST never times out by default', async () => {
    const fetchImpl = hangingFetch();
    const api = createApi(fetchImpl as unknown as typeof fetch);
    const write = watch(api.setCoordCaps({ maxActiveRuns: 1 } as never));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(write.now().s).toBe('pending');
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it('a DELETE never times out by default', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const write = watch(api.revokePasskey('abc'));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(write.now().s).toBe('pending');
  });

  it('a caller signal aborts the GET', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const ctl = new AbortController();
    const read = watch(api.stallWatch({ signal: ctl.signal }));
    await vi.advanceTimersByTimeAsync(1_000);
    ctl.abort();
    await vi.advanceTimersByTimeAsync(0);
    const out = read.now();
    expect(out.s).toBe('err');
    const e = (out as { e: unknown }).e;
    expect(e).not.toBeInstanceOf(ApiTimeout);
    expect((e as Error).name).toBe('AbortError');
  });

  it('a caller signal already aborted rejects at once, and the fetch is never left running', async () => {
    const fetchImpl = hangingFetch();
    const api = createApi(fetchImpl as unknown as typeof fetch);
    const ctl = new AbortController();
    ctl.abort();
    const read = watch(api.stallWatch({ signal: ctl.signal }));
    await vi.advanceTimersByTimeAsync(0);
    expect((read.now() as { e?: unknown }).e).toMatchObject({ name: 'AbortError' });
  });

  it('a GET that answers in time resolves and is not cut off later', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.stallWatch()).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
  });

  it('a 401 still raises the login screen', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'unauthenticated', verdict: 'expired' }),
      { status: 401, headers: { 'content-type': 'application/json' } }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.stallWatch()).rejects.toBeInstanceOf(ApiError);
    expect(authLost().lost).toBe(true);
  });
});

describe('ReadOpts reach the polled reads', () => {
  const ok = () => vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const cases: Array<[string, (api: ReturnType<typeof createApi>, o: { signal: AbortSignal }) => Promise<unknown>]> = [
    ['updates', (a, o) => a.updates(o)],
    ['stallWatch', (a, o) => a.stallWatch(o)],
    ['collectLane', (a, o) => a.collectLane(o)],
    ['dispatchAbandon', (a, o) => a.dispatchAbandon(o)],
    ['testbox', (a, o) => a.testbox(o)],
    ['linearWorkspaces', (a, o) => a.linearWorkspaces(o)],
    ['digest', (a, o) => a.digest(undefined, o)],
    ['passkeys', (a, o) => a.passkeys(o)],
  ];
  it.each(cases)('%s honours the caller signal', async (_name, call) => {
    const api = createApi(ok() as unknown as typeof fetch);
    const ctl = new AbortController();
    ctl.abort();
    await expect(call(api, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const live = new AbortController();
    await expect(call(api, { signal: live.signal }), 'a live signal reads as before').resolves.toBeDefined();
  });
});

describe('runsPage, the archive page read', () => {
  it('asks for one page and reads nextBefore', async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify({ runs: [], nextBefore: 41 }), { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.runsPage(50, 100)).resolves.toEqual({ runs: [], nextBefore: 41 });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/runs?closed=1&limit=50&before=100');
  });

  it('the first page sends no before', async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify({ runs: [] }), { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.runsPage(50, null)).resolves.toEqual({ runs: [] });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/runs?closed=1&limit=50');
  });
});
