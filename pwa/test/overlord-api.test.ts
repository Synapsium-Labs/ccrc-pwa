// The Overlord's three reads at the adapter (Overlord W1 home, Task 2; review 3319 A2). `getJsonOrAbsent` answers the read's
// own 404 as `{ absent: true }` (an older server has no such read) and lets every other failure throw as `getJson` does, so
// the store can tell "this server has no Overlord" from "the read failed". The caps read (`/health`) has no absent form: a
// 404 there is a failure.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiTimeout, createApi, READ_TIMEOUT_MS } from '../src/lib/api';
import { clearAuthLost } from '../src/lib/auth';

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchAnswering = (status: number, body: unknown) => vi.fn(async () => answer(status, body)) as unknown as typeof fetch;

afterEach(() => { vi.useRealTimers(); clearAuthLost(); vi.restoreAllMocks(); });

describe('the Overlord reads at the adapter', () => {
  it('a 404 from the designation and the ladder reads is absent', async () => {
    const api = createApi(fetchAnswering(404, { error: 'not-found' }));
    await expect(api.overlordDesignation()).resolves.toEqual({ absent: true });
    await expect(api.overlordLadder()).resolves.toEqual({ absent: true });
  });

  it('a 401, a 500 and a 503 throw ApiError with their status, never absent', async () => {
    for (const status of [401, 500, 503]) {
      const api = createApi(fetchAnswering(status, { error: 'x' }));
      await expect(api.overlordDesignation(), `${status}`).rejects.toMatchObject({ status });
      await expect(api.overlordLadder(), `${status}`).rejects.toBeInstanceOf(ApiError);
    }
  });

  it('a timeout throws ApiTimeout, never absent', async () => {
    vi.useFakeTimers();
    const api = createApi(vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch);
    const read = api.overlordDesignation().then(() => 'answered', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(await read).toBeInstanceOf(ApiTimeout);
  });

  it('a 2xx body is handed on as it came', async () => {
    const api = createApi(fetchAnswering(200, { designation: null }));
    await expect(api.overlordDesignation()).resolves.toEqual({ designation: null });
  });

  it('the caps read has no absent form: a 404 from /health is a failure', async () => {
    const api = createApi(fetchAnswering(404, { error: 'not-found' }));
    await expect(api.serverCaps()).rejects.toMatchObject({ status: 404 });
    const ok = createApi(fetchAnswering(200, { ok: true, caps: ['overlord-v1'] }));
    await expect(ok.serverCaps()).resolves.toEqual({ ok: true, caps: ['overlord-v1'] });
  });
});
