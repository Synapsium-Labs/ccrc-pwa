// X5 A5.1: `api.docs.artifacts`, the artifact doors' adapter (`lib/api.ts`'s `artifactRead`). Every call goes through
// `createApi`'s one `request` funnel with the marker header and resolves an `ArtifactAnswer`: the success body, a refusal word of
// the scope read or the mint, or the docs reads' union. Every fetch is injected: no case reaches a server. Placeholders only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, docsApi, type DocListPin } from '../../shared/docs';
import { createApi } from '../src/lib/api';
import { clearAuthLost } from '../src/lib/auth';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const apiOver = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(impl);
  return { doors: createApi(spy as unknown as typeof fetch).docs.artifacts, spy };
};
const callOf = (spy: { mock: { calls: unknown[][] } }, i = 0): [string, RequestInit] => spy.mock.calls[i] as [string, RequestInit];

afterEach(() => { clearAuthLost(); vi.restoreAllMocks(); });

const PIN: DocListPin = { kind: 'committed', commit: 'c'.repeat(40), servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' };
const LIST_OK = { ok: true, available: true, live: [] };

describe('api.docs.artifacts: classifies every answer', () => {
  it('a 200 list answer is ok, with its body', async () => {
    const { doors } = apiOver(async () => jsonResponse(200, LIST_OK));
    expect(await doors.list()).toEqual({ s: 'ok', value: LIST_OK });
  });

  it('a 409 {ok: false, error: "pin-moved"} on the scope read is refused with that word', async () => {
    const { doors } = apiOver(async () => jsonResponse(409, { ok: false, error: 'pin-moved' }));
    expect(await doors.scope('demo', PIN)).toEqual({ s: 'refused', word: 'pin-moved' });
  });

  it('a 401 {ok: false, error: "unauthenticated"} is the docs auth slot, not a refusal', async () => {
    const { doors } = apiOver(async () => jsonResponse(401, { ok: false, error: 'unauthenticated' }));
    expect(await doors.mint({ pin: PIN, project: 'demo', origins: [], windows: false })).toEqual({ s: 'auth' });
  });

  it('a docs failure body keeps its status and is the docs failure word, not a refusal', async () => {
    const body = { ok: false, failure: 'bad-query', why: 'x' };
    const { doors } = apiOver(async () => jsonResponse(400, body));
    expect(await doors.scope('demo', PIN)).toEqual({ s: 'failed', body });
  });

  it('an error word that is not a refusal word is not refused: an unexpected response with its status', async () => {
    const { doors } = apiOver(async () => jsonResponse(500, { ok: false, error: 'who-knows' }));
    expect(await doors.list()).toEqual({ s: 'unexpected-response', status: 500, contentType: 'application/json; charset=utf-8' });
  });

  it('a network failure (a TypeError) is the docs unreachable slot', async () => {
    const { doors } = apiOver(async () => { throw new TypeError('Failed to fetch'); });
    expect(await doors.revokeAll()).toEqual({ s: 'unreachable' });
  });

  it('a 200 answer that lacks a field the door needs is an unexpected response, never ok', async () => {
    const { doors } = apiOver(async () => jsonResponse(200, { ok: true, available: true }));
    expect((await doors.list()).s).toBe('unexpected-response');
  });

  it('an aborted scope read rejects with the signal\'s reason, as the docs reads do', async () => {
    const abort = new AbortController();
    const { doors } = apiOver(async (_url, init) => {
      abort.abort(new Error('stopped'));
      throw init.signal?.reason;
    });
    await expect(doors.scope('demo', PIN, abort.signal)).rejects.toThrow('stopped');
  });
});

describe('api.docs.artifacts: the URL, the method and the marker of each door', () => {
  it('each door sends the marker to docsApi\'s URL; mint and revoke POST', async () => {
    const { doors, spy } = apiOver(async (url) =>
      jsonResponse(200, url.includes('revoke') ? { ok: true, revoked: 1 }
        : url.includes('/scope') ? { ok: true, files: 1, uncommitted: 0, unsized: 0, bytes: 1, artifactHost: 'a.test', contentHost: 'c.test' }
          : url.endsWith('/artifacts') && spy.mock.calls.length === 3 ? { ok: true, id: 'i', url: 'https://a.test/x', expiresAt: 1, files: 1, uncommitted: 0, unsized: 0 }
            : LIST_OK));
    const ask = { pin: PIN, project: 'demo', origins: ['https://cdn.example'], windows: true };
    await doors.list();
    await doors.scope('demo', PIN);
    await doors.mint(ask);
    await doors.revoke('id 1');
    await doors.revokeAll();
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      docsApi.artifacts(), docsApi.artifactScope('demo', PIN), docsApi.artifactMint(), docsApi.artifactRevoke('id 1'), docsApi.artifactRevokeAll(),
    ]);
    for (let i = 0; i < 5; i += 1) {
      expect(new Headers(callOf(spy, i)[1].headers).get(DOCS_REQUEST_HEADER), `call ${i} carries the marker`).toBe(DOCS_REQUEST_HEADER_VALUE);
    }
    expect(callOf(spy, 0)[1].method).toBeUndefined();
    expect(callOf(spy, 2)[1].method).toBe('POST');
    expect(JSON.parse(String(callOf(spy, 2)[1].body))).toEqual(ask);
    expect(callOf(spy, 3)[1].method).toBe('POST');
    expect(callOf(spy, 4)[1].method).toBe('POST');
  });
});
