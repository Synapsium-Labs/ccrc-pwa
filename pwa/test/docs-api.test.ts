// Docs W5 part 1, Task 2: `api.docs.*` (spec 2026-10-01 4.3, 5.4; refinement (k)). Every call goes through
// `createApi`'s one `request` funnel with the marker header, answers a union and never throws for a docs word, and
// a raster is checked twice on the client (M5.18). Every fetch is injected: no case reaches a server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOCS_RASTER_TYPES, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, docsApi, type DocPin,
} from '../../shared/docs';
import { ApiError, createApi } from '../src/lib/api';
import { authLost, clearAuthLost } from '../src/lib/auth';

const jsonResponse = (status: number, body: unknown, contentType: string | null = 'application/json; charset=utf-8'): Response =>
  new Response(JSON.stringify(body), { status, headers: contentType === null ? {} : { 'content-type': contentType } });

const bytesResponse = (status: number, bytes: Uint8Array<ArrayBuffer>, contentType: string): Response =>
  new Response(bytes, { status, headers: { 'content-type': contentType } });

// Magic bytes come from L0's own table (single-definition holds the PNG signature to shared/docs.ts), padded so a
// fixture is longer than its magic.
const magicOf = (t: keyof typeof DOCS_RASTER_TYPES): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(16);
  for (const run of DOCS_RASTER_TYPES[t].magic[0] ?? []) out.set(run.bytes, run.at);
  return out;
};
const PNG = magicOf('png');
const GIF = magicOf('gif');
const JPEG = magicOf('jpeg');

const C = 'c'.repeat(40);
const committed = (path: string): DocPin =>
  ({ kind: 'committed', commit: C, servedRef: 'refs/remotes/origin/main', section: 'specs', path });
const DRAFT: DocPin =
  { kind: 'draft', branch: 'ws/a', head: 'd'.repeat(40), section: 'plans', path: 'a b+c.md', fp: 'f'.repeat(64) };

const TREE_OK = { ok: true, tree: { project: 'demo' }, refreshDue: false };
const FILE_OK = { ok: true, contentClass: 'markdown', show: { text: '# a' }, from: 'ccd' };

const apiOver = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(impl);
  return { api: createApi(spy as unknown as typeof fetch), spy };
};
const callOf = (spy: { mock: { calls: unknown[][] } }, i = 0): [string, RequestInit] =>
  spy.mock.calls[i] as [string, RequestInit];

afterEach(() => { clearAuthLost(); vi.restoreAllMocks(); });

describe('api.docs: the marker header and the URL on every call', () => {
  it('projects, tree (default and ref view), file (committed and draft pins), raster and refresh each send the marker through the constants, to docsApi\'s URL', async () => {
    const { api, spy } = apiOver(async (url) =>
      url.includes('/file') ? (url.includes('.png') ? bytesResponse(200, PNG, 'image/png') : jsonResponse(200, FILE_OK))
        : url.endsWith('/refresh') ? jsonResponse(200, { ok: true, fetch: { state: 'skipped', why: 'local-ref' }, tree: TREE_OK })
          : url.endsWith('/projects') ? jsonResponse(200, { ok: true, index: { projects: [] }, cacheAgeMs: null })
            : jsonResponse(200, TREE_OK));
    await api.docs.projects();
    await api.docs.tree('demo', null);
    await api.docs.tree('demo', { kind: 'bare', name: 'ws/a' });
    await api.docs.file('demo', committed('a.md'));
    await api.docs.file('demo', DRAFT);
    await api.docs.raster('demo', committed('img/a.png'));
    await api.docs.refresh('demo', { ref: null, reason: 'auto' });
    const expected = [
      docsApi.projects(), docsApi.tree('demo', null), docsApi.tree('demo', { kind: 'bare', name: 'ws/a' }),
      docsApi.file('demo', committed('a.md')), docsApi.file('demo', DRAFT), docsApi.file('demo', committed('img/a.png')),
      docsApi.refresh('demo'),
    ];
    expect(spy.mock.calls.map((c) => c[0])).toEqual(expected);
    for (let i = 0; i < expected.length; i += 1) {
      const [, init] = callOf(spy, i);
      expect(new Headers(init.headers).get(DOCS_REQUEST_HEADER), `call ${i} carries the marker`).toBe(DOCS_REQUEST_HEADER_VALUE);
    }
  });

  it('refresh POSTs exactly {ref, reason} as JSON, with the marker', async () => {
    const { api, spy } = apiOver(async () =>
      jsonResponse(200, { ok: true, fetch: { state: 'skipped', why: 'local-ref' }, tree: TREE_OK }));
    const answer = await api.docs.refresh('demo', { ref: 'refs/heads/main', reason: 'manual' });
    expect(answer.s).toBe('ok');
    const [url, init] = callOf(spy);
    expect(url).toBe(docsApi.refresh('demo'));
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get(DOCS_REQUEST_HEADER)).toBe(DOCS_REQUEST_HEADER_VALUE);
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'refs/heads/main', reason: 'manual' });
  });

  it('refresh sends only ref and reason, whatever else the caller\'s object holds (the route refuses any other key)', async () => {
    const { api, spy } = apiOver(async () =>
      jsonResponse(200, { ok: true, fetch: { state: 'skipped', why: 'local-ref' }, tree: TREE_OK }));
    const wide = { ref: null, reason: 'auto' as const, page: 'demo' };
    await api.docs.refresh('demo', wide);
    expect(JSON.parse(callOf(spy)[1].body as string)).toEqual({ ref: null, reason: 'auto' });
  });

  it('an ok answer is {s: ok, value} with the server\'s envelope as is', async () => {
    const { api } = apiOver(async () => jsonResponse(200, TREE_OK));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'ok', value: TREE_OK });
  });
});

describe('api.docs: every answer that is not a page is a union arm, never an exception', () => {
  it('a 401 with a verdict raises the login overlay through request, and answers auth', async () => {
    const { api } = apiOver(async () => jsonResponse(401, { ok: false, error: 'unauthenticated', verdict: 'no-session' }));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'auth' });
    expect(authLost()).toEqual({ lost: true, verdict: 'no-session' });
  });

  it('a 401 with no verdict answers auth and raises nothing (request\'s positive-evidence rule)', async () => {
    const { api } = apiOver(async () => jsonResponse(401, { ok: false, error: 'unauthenticated' }));
    expect(await api.docs.projects()).toEqual({ s: 'auth' });
    expect(authLost().lost).toBe(false);
  });

  it('a 403 foreign-request body answers failed with the body whole, and raises nothing', async () => {
    const body = { ok: false, failure: 'foreign-request', site: 'cross-site' };
    const { api } = apiOver(async () => jsonResponse(403, body));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'failed', body });
    expect(authLost().lost).toBe(false);
  });

  it('a 404 {error: not-found} with no failure is a pre-Docs server: no-docs-route (M7.1)', async () => {
    const { api } = apiOver(async () => jsonResponse(404, { ok: false, error: 'not-found' }));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'no-docs-route' });
  });

  it('a 404 carrying a failure word is that word, never no-docs-route', async () => {
    const body = { ok: false, failure: 'unknown-project', root: 'demo-root', error: 'not-found' };
    const { api } = apiOver(async () => jsonResponse(404, body));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'failed', body });
  });

  it('no-docs-route needs the status AND the code: a 404 with another code, and a 500 not-found, are unexpected-response', async () => {
    const a = apiOver(async () => jsonResponse(404, { error: 'gone' }));
    expect(await a.api.docs.projects()).toEqual({ s: 'unexpected-response', status: 404, contentType: 'application/json; charset=utf-8' });
    const b = apiOver(async () => jsonResponse(500, { error: 'not-found' }));
    expect(await b.api.docs.projects()).toEqual({ s: 'unexpected-response', status: 500, contentType: 'application/json; charset=utf-8' });
  });

  it('an unknown word from a newer server is kept whole, never folded', async () => {
    const body = { ok: false, failure: 'brand-new-word', detail: 'x' };
    const { api } = apiOver(async () => jsonResponse(409, body));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'failed', body });
  });

  it('a fetch that rejects with a TypeError (offline) answers unreachable', async () => {
    const { api } = apiOver(async () => { throw new TypeError('Failed to fetch'); });
    expect(await api.docs.projects()).toEqual({ s: 'unreachable' });
  });

  it('a 502 proxy page answers unexpected-response with its status and content type', async () => {
    const { api } = apiOver(async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'unexpected-response', status: 502, contentType: 'text/html' });
  });

  it('a failure answer with no content-type header reads contentType as the empty string', async () => {
    // A null body: the Response constructor adds a content type for a string body, never for none.
    const { api } = apiOver(async () => new Response(null, { status: 500 }));
    const answer = await api.docs.projects();
    expect(answer).toEqual({ s: 'unexpected-response', status: 500, contentType: '' });
  });

  it('a 200 that is not the envelope is unexpected-response: not JSON, ok not true, or a route field missing', async () => {
    const html = apiOver(async () => new Response('<html>portal</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await html.api.docs.tree('demo', null)).toEqual({ s: 'unexpected-response', status: 200, contentType: 'text/html' });
    const notOk = apiOver(async () => jsonResponse(200, { ok: false, tree: {}, refreshDue: false }));
    expect((await notOk.api.docs.tree('demo', null)).s).toBe('unexpected-response');
    const noTree = apiOver(async () => jsonResponse(200, { ok: true, refreshDue: false }));
    expect((await noTree.api.docs.tree('demo', null)).s).toBe('unexpected-response');
    const noShow = apiOver(async () => jsonResponse(200, { ok: true, contentClass: 'markdown' }));
    expect((await noShow.api.docs.file('demo', committed('a.md'))).s).toBe('unexpected-response');
    const noIndex = apiOver(async () => jsonResponse(200, { ok: true, cacheAgeMs: null }));
    expect((await noIndex.api.docs.projects()).s).toBe('unexpected-response');
    const noFetch = apiOver(async () => jsonResponse(200, { ok: true, tree: TREE_OK }));
    expect((await noFetch.api.docs.refresh('demo', { ref: null, reason: 'auto' })).s).toBe('unexpected-response');
    const array = apiOver(async () => jsonResponse(200, [TREE_OK]));
    expect((await array.api.docs.tree('demo', null)).s).toBe('unexpected-response');
    const nul = apiOver(async () => jsonResponse(200, null));
    expect(await nul.api.docs.tree('demo', null))
      .toEqual({ s: 'unexpected-response', status: 200, contentType: 'application/json; charset=utf-8' });
  });

  it('an aborted signal rejects with the AbortError: the caller aborted, so there is no slot', async () => {
    const { api } = apiOver((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = api.docs.file('demo', committed('a.md'), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('raster: an aborted signal rejects with the AbortError: the caller aborted, so there is no slot', async () => {
    const { api } = apiOver((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = api.docs.raster('demo', committed('i.png'), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('an abort while a non-2xx body is being read rejects with the AbortError, never a slot (file and raster)', async () => {
    // The body stream errors with an AbortError once the caller's signal aborts: `request` folds an unreadable error
    // body to '' and throws ApiError, so only the signal tells the abort apart.
    const stalled = (init: RequestInit): Response => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          init.signal?.addEventListener('abort', () => c.error(new DOMException('The operation was aborted.', 'AbortError')));
        },
      });
      return new Response(body, { status: 503, headers: { 'content-type': 'text/plain' } });
    };
    for (const call of ['file', 'raster'] as const) {
      const { api } = apiOver(async (_url, init) => stalled(init));
      const controller = new AbortController();
      const pending = call === 'file'
        ? api.docs.file('demo', committed('a.md'), controller.signal)
        : api.docs.raster('demo', committed('i.png'), controller.signal);
      const settled = pending.then((v) => ({ v }), (e: unknown) => ({ e }));
      await new Promise((r) => setTimeout(r, 0));
      controller.abort();
      const outcome = await settled;
      expect(outcome, call).toHaveProperty('e');
      expect((outcome as { e: { name: string } }).e.name, call).toBe('AbortError');
    }
  });

  it('a 401 whose body names a docs word is that word: a docs word beats every status', async () => {
    const body = { ok: false, failure: 'foreign-request' };
    const { api } = apiOver(async () => jsonResponse(401, body));
    expect(await api.docs.tree('demo', null)).toEqual({ s: 'failed', body });
  });

  it('a non-2xx records its content type on ApiError (null when the header is absent); nothing else about ApiError changes', async () => {
    const typed = createApi((async () => new Response('x', { status: 500, headers: { 'content-type': 'text/plain' } })) as typeof fetch);
    const err = await typed.updates().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).contentType).toBe('text/plain');
    expect((err as ApiError).status).toBe(500);
    const bare = createApi((async () => new Response(null, { status: 500 })) as typeof fetch);
    expect(((await bare.updates().then(() => null, (e: unknown) => e)) as ApiError).contentType).toBeNull();
    expect(new ApiError(409, { error: 'x' }).contentType).toBeNull();
  });
});

describe('api.docs.raster: the two client checks (M5.18) and the representation split', () => {
  it('a 200 text/html holding PNG bytes is unexpected-response: the content type must be the declared raster MIME', async () => {
    const { api } = apiOver(async () => bytesResponse(200, PNG, 'text/html'));
    expect(await api.docs.raster('demo', committed('img/a.png')))
      .toEqual({ s: 'unexpected-response', status: 200, contentType: 'text/html' });
  });

  it('a 200 image/png holding GIF bytes is a client-built raster-mismatch with the declared type and the size', async () => {
    const { api } = apiOver(async () => bytesResponse(200, GIF, 'image/png'));
    expect(await api.docs.raster('demo', committed('img/a.png'))).toEqual({
      s: 'failed', body: { ok: false, failure: 'raster-mismatch', declared: 'png', size: GIF.byteLength },
    });
  });

  it('a 200 image/png holding PNG bytes answers the bytes and the MIME from the table', async () => {
    const { api } = apiOver(async () => bytesResponse(200, PNG, 'image/png'));
    const answer = await api.docs.raster('demo', committed('img/a.png'));
    expect(answer.s).toBe('ok');
    if (answer.s !== 'ok') return;
    expect(Array.from(answer.value.bytes)).toEqual(Array.from(PNG));
    expect(answer.value.mime).toBe('image/png');
  });

  it('a .JPG path is the jpeg type: image/jpeg with JPEG bytes loads, the non-standard image/jpg is refused', async () => {
    const ok = apiOver(async () => bytesResponse(200, JPEG, 'image/jpeg'));
    const answer = await ok.api.docs.raster('demo', committed('a.JPG'));
    expect(answer.s === 'ok' ? answer.value.mime : answer.s).toBe('image/jpeg');
    const odd = apiOver(async () => bytesResponse(200, JPEG, 'image/jpg'));
    expect(await odd.api.docs.raster('demo', committed('a.JPG')))
      .toEqual({ s: 'unexpected-response', status: 200, contentType: 'image/jpg' });
  });

  it('a raster failure body (422 raster-mismatch from the server) is that word', async () => {
    const body = { ok: false, failure: 'raster-mismatch', declared: 'png', size: 9 };
    const { api } = apiOver(async () => jsonResponse(422, body));
    expect(await api.docs.raster('demo', committed('a.png'))).toEqual({ s: 'failed', body });
  });

  it('file() on a raster path and raster() on a non-raster path are programming errors: wrong-representation, before any fetch', () => {
    const { api, spy } = apiOver(async () => jsonResponse(200, FILE_OK));
    expect(() => api.docs.file('demo', committed('img/a.png'))).toThrow('wrong-representation');
    expect(() => api.docs.raster('demo', committed('a.md'))).toThrow('wrong-representation');
    expect(() => api.docs.raster('demo', committed('a.svg'))).toThrow('wrong-representation');
    expect(spy).not.toHaveBeenCalled();
  });
});
