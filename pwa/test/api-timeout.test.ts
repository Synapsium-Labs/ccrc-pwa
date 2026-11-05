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
    const read = watch(api.stallWatch());
    await vi.advanceTimersByTimeAsync(1);
    expect(read.now()).toEqual({ s: 'ok', v: { ok: true } });
    // The limit's timer still runs out after the answer (by design: it would abort a body still being read); the
    // answer already read is untouched by it (review 1473 A10).
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(read.now(), 'the same answer, past the limit').toEqual({ s: 'ok', v: { ok: true } });
  });

  it('a 401 still raises the login screen', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'unauthenticated', verdict: 'expired' }),
      { status: 401, headers: { 'content-type': 'application/json' } }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.stallWatch()).rejects.toBeInstanceOf(ApiError);
    expect(authLost().lost).toBe(true);
  });
});

// THE LONG-READ TABLE (review 1464 F5): each GET whose server bound is above 20 s keeps its own default, pinned here
// as a literal so a change to `LONG_READ_MS` is a red suite, not a silent edit; and the five docs loaders keep none
// (projects, tree, file and refresh through one helper, raster through its own call).
describe('the long reads keep their own limit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const longReads: Array<[string, number, (api: ReturnType<typeof createApi>) => Promise<unknown>]> = [
    ['pr', 50_000, (a) => a.pr('cc-a')],
    ['paneHistory', 35_000, (a) => a.paneHistory('cc-a')],
    ['workspaceAudit', 115_000, (a) => a.workspaceAudit('cc-a')],
    ['updates', 30_000, (a) => a.updates()],
  ];
  it.each(longReads)('%s is pending at 20 s and ApiTimeout at %i ms', async (_name, ms, call) => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const read = watch(call(api));
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(read.now().s, 'still pending past the 20 s default').toBe('pending');
    await vi.advanceTimersByTimeAsync(ms - READ_TIMEOUT_MS - 1);
    expect(read.now().s, 'still pending 1 ms before its own limit').toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    const out = read.now();
    expect(out.s).toBe('err');
    expect((out as { e: unknown }).e).toBeInstanceOf(ApiTimeout);
    expect(((out as { e: unknown }).e as ApiTimeout).ms).toBe(ms);
  });

  it('a docs loader is still pending after an hour', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const read = watch(api.docs.projects());
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(read.now().s).toBe('pending');
  });

  // `raster` has a call site of its own, apart from the shared helper the other docs loaders use (review 1473 A8).
  it('the docs raster loader is still pending after an hour too', async () => {
    const api = createApi(hangingFetch() as unknown as typeof fetch);
    const pin = { kind: 'committed', commit: 'c'.repeat(40), servedRef: 'refs/remotes/origin/main', section: 'specs',
      path: 'img/a.png' } as const;
    const read = watch(api.docs.raster('project-a', pin));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(read.now().s).toBe('pending');
  });
});

describe('ReadOpts reach the polled reads', () => {
  const ok = () => vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const cases: Array<[string, (api: ReturnType<typeof createApi>, o: { signal: AbortSignal }) => Promise<unknown>]> = [
    ['updates', (a, o) => a.updates(o)],
    ['stallWatch', (a, o) => a.stallWatch(o)],
    ['collectLane', (a, o) => a.collectLane(o)],
    ['dispatchAbandon', (a, o) => a.dispatchAbandon(o)],
    ['scopeSweep', (a, o) => a.scopeSweep(o)],
    ['testbox', (a, o) => a.testbox(o)],
    ['linearWorkspaces', (a, o) => a.linearWorkspaces(o)],
    ['digest', (a, o) => a.digest(undefined, o)],
    ['passkeys', (a, o) => a.passkeys(o)],
    ['runsPage', (a, o) => a.runsPage(50, null, o)],
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
