import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src/lib/api';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('api client', () => {
  it('prompt posts a JSON body to /api/sessions/:id/prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.prompt('x', 'ship it', true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/x/prompt');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'ship it', replaceDraft: true });
  });

  it('prompt omits replaceDraft from the body when not passed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.prompt('x', 'hello');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hello' });
  });

  it('prompt throws ApiError with the parsed body on 409', async () => {
    const draftBody = { ok: false, error: 'draft-present', draft: 'half-typed thought' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, draftBody));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.prompt('x', 'new text').then(
      () => { throw new Error('expected prompt to reject'); },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(409);
    expect(apiErr.body).toEqual(draftBody);
  });
});
