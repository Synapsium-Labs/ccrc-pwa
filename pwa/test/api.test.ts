import { describe, expect, it, vi } from 'vitest';
import { ApiError, clipUrl, createApi } from '../src/lib/api';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('api client', () => {
  // Task 8: DELETE /api/sessions/:id/workspace is gone, and so is this method.
  // A mutation sweep found that restoring workspaceRemove (and the `del`
  // helper it needs) in isolation — without touching SessionActionsSheet's
  // button — compiles clean and leaves every other test green, because
  // nothing else in the client ever called it. This pins the client shape
  // directly so that gap can't reopen unnoticed.
  it('has no workspaceRemove — the route it called no longer exists', () => {
    const api = createApi();
    expect('workspaceRemove' in api).toBe(false);
  });

  it('prompt posts a JSON body to /api/sessions/:id/prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.prompt('x', 'ship it', { replaceDraft: true });

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

describe('attachments', () => {
  it('returns where an upload landed', async () => {
    const clip = { path: '/home/u/.cc-clips/s/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, clip }), { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.upload('s', new File(['x'], 'a.png', { type: 'image/png' }))).resolves.toEqual(clip);
  });

  it('posts attachments alongside the text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.prompt('s', 'hi', { attachments: ['/home/u/.cc-clips/s/clip-1-a1b2.png'] });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hi', attachments: ['/home/u/.cc-clips/s/clip-1-a1b2.png'],
    });
  });

  it('builds an origin-qualified clip URL — a bare path breaks openExternal', () => {
    expect(clipUrl('claude2-Proj', 'clip-1-a1b2.png'))
      .toBe(`${location.origin}/api/sessions/claude2-Proj/clip/clip-1-a1b2.png`);
  });
});
