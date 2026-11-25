import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  REVIEW_IDLE_MS, REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_OPEN_BODY_BYTES, type ReviewSource,
} from '../../shared/docsReview.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { hashLine } from '../src/auth/secret.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import { buildServer } from '../src/server.js';
import { nodeReviewFs, openReviewStore } from '../src/review/store.js';
import { fakeTime } from './fakeTime.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PASS = 'fixture review passphrase';
const BOX = 'fixture review box token';
const route = '/api/review/open';
const marker = { [REVIEW_MARKER_HEADER]: REVIEW_MARKER_VALUE };
const source: ReviewSource = {
  project: 'project-a', section: 'specs', path: 'draft.md', branch: 'b', head: 'a'.repeat(40),
  servedRef: 'refs/remotes/origin/b', baseCommit: 'b'.repeat(40), fp: 'd'.repeat(64), committedBlob: null,
};
const unavailable = '{"ok":false,"error":"not-found"}';
const guardHeaders = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'content-disposition': 'attachment',
};

async function fixture(armed = false, unreadable = false) {
  const home = mkTmp('review-route-');
  const fs = { ...nodeReviewFs };
  const calls = [vi.spyOn(fs, 'mkdir'), vi.spyOn(fs, 'open'), vi.spyOn(fs, 'write'), vi.spyOn(fs, 'fsync'),
    vi.spyOn(fs, 'rename'), vi.spyOn(fs, 'unlink'), vi.spyOn(fs, 'readdirMeasured'), vi.spyOn(fs, 'readFile'), vi.spyOn(fs, 'stat')];
  const opened = await openReviewStore(path.join(home, 'store'), fs);
  if (!opened.ok) throw new Error(opened.why);
  const { store } = opened;
  const time = fakeTime();
  const runner = vi.fn(async () => ({ ran: true as const, code: 1, stdout: '', stderr: '' }));
  const deps = testDeps(home, runner);
  if (armed) {
    mkdirSync(deps.cfg.ccrcDir, { recursive: true });
    const line = await hashLine(PASS, { n: 1024, r: 8, p: 1, keylen: 32 }, 1);
    writeFileSync(deps.cfg.authSecretPath, `${line}\n`, { mode: 0o600 });
  }
  const app = await buildServer({ ...deps, cfg: { ...deps.cfg, authEnabled: armed, cookieSecure: false },
    mailToken: BOX, time: time.ports, review: unreadable
      ? { fs: { ...fs, mkdir: async () => { throw new Error('fixture unwritable'); } } }
      : { store } });
  const views = vi.spyOn(store, 'markViewed');
  const close = async () => {
    // A connection whose response has not finished when the server closes is not idle, so `app.close()` would wait out
    // its keep-alive timeout (72 s) past the case's 20 s: the case is over, so its connections go first.
    app.server.closeAllConnections();
    await app.close();
    await Promise.allSettled(views.mock.results.map(result => result.value));
  };
  try {
    if (unreadable) expect(app.reviewSweep).toBeNull();
    else {
      if (!app.reviewSweep) throw new Error('review sweep unavailable');
      await app.reviewSweep.started;
      await app.reviewSweep.stop();
    }
    let streamed: unknown;
    app.addHook('onSend', (req, _reply, payload, done) => {
      if (req.routeOptions.url === route) streamed = payload;
      done(null, payload);
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    runner.mockClear();
    runner.mockImplementation(async () => { throw new Error('unexpected fixture runner call'); });
    const post = (body: string, headers: Record<string, string> = marker) => fetch(`${address}${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
      signal: AbortSignal.timeout(3000),
    });
    const open = (token: string, headers: Record<string, string> = marker) => post(JSON.stringify({ token }), headers);
    const save = async (name = 'draft.md', bytes = Buffer.from('draft bytes'), age = 0) => {
      const saved = await store.put({ ...source, path: name }, bytes, 0, time.ports.clock.wall() - age);
      if (!saved.ok) throw new Error(saved.why);
      return saved.entry;
    };
    return { app, address, store, time, calls, runner, post, open, save, close, views, streamed: () => streamed };
  } catch (err) {
    await close();
    throw err;
  }
}

const measured = async (response: Response) => ({
  status: response.status,
  headers: Object.fromEntries([...response.headers].filter(([name]) => name !== 'date')),
  body: await response.text(),
});

async function expectUnavailable(response: Response, label?: string) {
  const actual = await measured(response);
  expect(actual, label).toMatchObject({ status: 404, body: unavailable, headers: guardHeaders });
  return actual;
}

describe('draft review read door', () => {
  it('opens a seeded share through the real server, streaming the same bytes object', async () => {
    const f = await fixture();
    try {
      // Synthetic shape only, with a non-text byte to catch decoding even apart from masking.
      const shaped = `${'sk-'}${'A'.repeat(12)}`;
      expect(SHAPE_ONLY_MASKER.maskText(`draft ${shaped}`).includes(shaped), 'fixture shape is actually masked').toBe(false);
      const bytes = Buffer.concat([Buffer.from(`draft ${shaped}`), Buffer.from([0xff])]);
      const entry = await f.save('draft.md', bytes);
      const readBytes = vi.spyOn(f.store, 'readBytes');
      const original = f.store.openBytes.bind(f.store);
      let sourceStream: Readable | undefined;
      const openBytes = vi.spyOn(f.store, 'openBytes').mockImplementation(async (...args) => {
        const answer = await original(...args);
        sourceStream = answer?.stream;
        return answer;
      });
      const response = await f.open(entry.token);
      expect(response.status).toBe(200);
      const received = Buffer.from(await response.arrayBuffer());
      expect(received.includes(Buffer.from(shaped)), 'the binary response preserves the shape').toBe(true);
      expect(received.equals(bytes)).toBe(true);
      expect(Object.fromEntries(response.headers)).toMatchObject({
        ...guardHeaders, 'content-type': 'application/octet-stream',
        'x-ccrc-review-shared-at': String(entry.sharedAt), 'x-ccrc-review-version': '1', 'x-ccrc-review-idle-days': '7',
      });
      expect(openBytes).toHaveBeenCalledExactlyOnceWith(entry.tokenHash, entry.version);
      expect(readBytes).not.toHaveBeenCalled();
      expect(sourceStream !== undefined && f.streamed() === sourceStream).toBe(true);
      expect(f.runner).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it.each([false, true])('keeps refusals identical and rejects malformed inputs before storage (armed=%s)', async armed => {
    const f = await fixture(armed);
    try {
      const live = await f.save();
      const lookup = vi.spyOn(f.store, 'byToken');
      for (const call of f.calls) call.mockClear();
      const invalid = {
        '42-character token': () => f.open('a'.repeat(42)),
        '44-character token': () => f.open('a'.repeat(44)),
        'missing token': () => f.post('{}'),
        'malformed JSON': () => f.post('{'),
        'empty JSON body': () => f.post(''),
        'text body': () => f.post(JSON.stringify({ token: live.token }), { ...marker, 'content-type': 'text/plain' }),
        'unsupported media type': () => f.post('{}', { ...marker, 'content-type': 'application/x-fixture' }),
        'malformed media type': () => f.post(JSON.stringify({ token: live.token }), { ...marker, 'content-type': 'invalid' }),
      };
      const first = await expectUnavailable(await f.open(live.token, {}));
      for (const [label, send] of Object.entries(invalid)) {
        expect.soft(await expectUnavailable(await send()), label).toEqual(first);
      }
      const large = await measured(await f.post(' '.repeat(REVIEW_OPEN_BODY_BYTES + 1)));
      expect(large).toMatchObject({ status: 413, body: '{"ok":false,"error":"too-large"}' });
      expect(lookup.mock.calls.length, 'invalid requests made no token lookups').toBe(0);
      for (const call of f.calls) expect(call.mock.calls.length, 'invalid requests did not touch snapshot storage').toBe(0);

      const revoked = await f.save('revoked.md');
      expect((await f.store.remove(revoked.tokenHash, revoked.rev, 'revoked', f.time.ports.clock.wall())).ok).toBe(true);
      const expired = await f.save('expired.md', undefined, REVIEW_IDLE_MS);
      const cleanup = vi.spyOn(f.store, 'remove');
      const missing = await f.save('missing.md');
      expect(f.store.byId(expired.id) !== null, 'expired fixture must exist with the sweep stopped').toBe(true);
      const realOpen = f.store.openBytes.bind(f.store);
      vi.spyOn(f.store, 'openBytes').mockImplementation((hash, version) =>
        hash === missing.tokenHash ? Promise.resolve(null) : realOpen(hash, version));
      const unknown = await measured(await f.open('a'.repeat(43)));
      expect.soft(unknown, 'unknown token').toEqual(first);
      // These requests differ only in the 43-character token; keep transport headers in the comparison.
      for (const [label, token] of Object.entries({ revoked: revoked.token, expired: expired.token, 'missing bytes': missing.token })) {
        const answer = await measured(await f.open(token));
        expect.soft(answer, `${label}: common 404`).toEqual(first);
        if (unknown.status === 404) expect.soft(answer, `${label}: same as unknown`).toEqual(unknown);
      }
      expect(cleanup).toHaveBeenCalledTimes(1);
      await cleanup.mock.results[0]!.value;
      expect(f.store.byId(expired.id) === null).toBe(true);
      expect(f.runner).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('bounds unsupported media before refusing it, after the marker', async () => {
    const f = await fixture();
    try {
      const lookup = vi.spyOn(f.store, 'byToken');
      for (const call of f.calls) call.mockClear();
      const body = ' '.repeat(REVIEW_OPEN_BODY_BYTES + 1);
      const marked = await measured(await f.post(body, { ...marker, 'content-type': 'application/x-fixture' }));
      expect(marked).toMatchObject({ status: 413, body: '{"ok":false,"error":"too-large"}' });
      for (const contentType of [undefined, 'application/x-fixture', 'invalid']) {
        for (const streamed of [false, true]) {
          const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            const headers: Record<string, string> = { ...marker };
            if (contentType) headers['content-type'] = contentType;
            if (!streamed) headers['content-length'] = String(Buffer.byteLength(body));
            const req = request(`${f.address}${route}`, { method: 'POST', headers }, res => {
              let text = '';
              res.setEncoding('utf8');
              res.on('data', chunk => { text += chunk; });
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
              res.on('error', reject);
            });
            req.setTimeout(2000, () => req.destroy(new Error('fixture request timed out')));
            req.on('error', reject);
            if (streamed) req.write(body.slice(0, 128));
            req.end(streamed ? body.slice(128) : body);
          });
          expect.soft(result, `${contentType ?? 'missing type'}, streamed=${streamed}`)
            .toEqual({ status: 413, body: '{"ok":false,"error":"too-large"}' });
        }
      }
      for (const contentType of ['application/x-fixture', 'invalid']) {
        const unmarked = await measured(await f.post(body, { 'content-type': contentType }));
        expect(unmarked).toMatchObject({ status: 404, body: unavailable });
      }
      expect(lookup).not.toHaveBeenCalled();
      for (const call of f.calls) expect(call).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('accepts JSON with a charset parameter', async () => {
    const f = await fixture();
    try {
      const entry = await f.save();
      const response = await f.open(entry.token, { ...marker, 'content-type': 'application/json; charset=utf-8' });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('draft bytes');
    } finally { await f.close(); }
  });

  it('answers expired opens while one cleanup is held', async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const real = f.store.remove.bind(f.store);
    const remove = vi.spyOn(f.store, 'remove').mockImplementation(async (...args) => {
      await gate;
      return real(...args);
    });
    const openBytes = vi.spyOn(f.store, 'openBytes');
    try {
      const entry = await f.save('expired.md', undefined, REVIEW_IDLE_MS);
      const expected = await measured(await f.open('a'.repeat(43)));
      const responses = await Promise.all([f.open(entry.token), f.open(entry.token)]);
      for (const response of responses) expect(await measured(response)).toEqual(expected);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(openBytes).not.toHaveBeenCalled();
      expect(f.views).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.allSettled(remove.mock.results.map(result => result.value));
      await f.close();
    }
  });

  it('refuses and disposes an open that crosses idle expiry', async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const opened = new Promise<void>(resolve => { entered = resolve; });
    let pending: Promise<Response> | undefined;
    try {
      const entry = await f.save();
      const expected = await measured(await f.open('a'.repeat(43)));
      const real = f.store.openBytes.bind(f.store);
      let stream: Readable | undefined;
      const spy = vi.spyOn(f.store, 'openBytes').mockImplementationOnce(async (...args) => {
        const result = await real(...args);
        if (!result) throw new Error('fixture descriptor unavailable');
        stream = result.stream;
        entered();
        await gate;
        return result;
      });
      pending = f.open(entry.token);
      await Promise.race([opened, pending.then(() => { throw new Error('fixture request finished before descriptor opened'); })]);
      f.time.stepWall(REVIEW_IDLE_MS);
      release();
      expect(await measured(await pending)).toEqual(expected);
      expect(stream?.destroyed).toBe(true);
      expect(f.views).not.toHaveBeenCalled();
      spy.mockRestore();
      const fresh = await f.save('fresh.md');
      // The body is read to its end, so the server has ended this response before `close()` begins. Read only the
      // status and `close()` can start while the response is still in flight: Fastify closes the connections that are
      // idle at that moment, once, so this one, idle a moment later, stays open until its keep-alive timeout, past the
      // test's limit (measured: one hang in about 50 to 150 repeats, 2026-11-25; the X3 R2 carry).
      const freshOpen = await f.open(fresh.token);
      expect(freshOpen.status).toBe(200);
      expect(await freshOpen.text()).toBe('draft bytes');
    } finally {
      release();
      if (pending) await Promise.allSettled([pending]);
      await f.close();
    }
  });

  it('keeps an early stream failure identical to an unavailable share', async () => {
    const f = await fixture();
    try {
      const entry = await f.save();
      const expected = await measured(await f.open('a'.repeat(43)));
      const stream = new Readable({ read() { this.destroy(new Error('fixture read failed')); } });
      vi.spyOn(f.store, 'openBytes').mockResolvedValueOnce({ stream, size: 1 });
      expect(await measured(await f.open(entry.token))).toEqual(expected);
      expect(f.views).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it('uses the same refusal when the store did not open', async () => {
    const f = await fixture(true, true);
    try {
      const unknown = 'b'.repeat(43);
      const absent = await expectUnavailable(await f.open(unknown, {}));
      expect(await expectUnavailable(await f.open(unknown))).toEqual(absent);
    } finally { await f.close(); }
  });

  it('records a view only after bytes start and coarsens a second view', async () => {
    const f = await fixture();
    try {
      const entry = await f.save();
      const view = f.views;
      const missing = vi.spyOn(f.store, 'openBytes').mockResolvedValueOnce(null);
      await expectUnavailable(await f.open(entry.token));
      expect(view).not.toHaveBeenCalled();
      expect(f.store.byId(entry.id)?.lastViewedAt).toBeNull();
      missing.mockRestore();

      const first = await f.open(entry.token);
      expect(first.status).toBe(200);
      await first.arrayBuffer();
      await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
      await view.mock.results[0]!.value;
      const before = f.store.byId(entry.id);
      expect(before?.lastViewedAt).toBe(f.time.ports.clock.wall());
      f.time.stepWall(30_000);
      const second = await f.open(entry.token);
      expect(second.status).toBe(200);
      await second.arrayBuffer();
      await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
      await view.mock.results[1]!.value;
      expect(f.store.byId(entry.id)?.lastViewedAt).toBe(before?.lastViewedAt);
      expect(f.store.byId(entry.id)?.rev).toBe(before?.rev);
    } finally { await f.close(); }
  });

  it('does not count an empty snapshot as a view when no bytes start', async () => {
    const f = await fixture();
    try {
      const entry = await f.save('empty.md', Buffer.alloc(0));
      const response = await f.open(entry.token);
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBe(0);
      expect(f.views.mock.calls.length).toBe(0);
      expect(f.store.byId(entry.id)?.lastViewedAt).toBeNull();
    } finally { await f.close(); }
  });

  it('gives the same armed response with a session, box token, or neither', async () => {
    const f = await fixture(true);
    try {
      const entry = await f.save();
      const login = await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
      expect(login.statusCode).toBe(204);
      const rawCookie = login.headers['set-cookie'];
      const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)?.split(';', 1)[0];
      if (!cookie) throw new Error('fixture login did not set a cookie');
      const anonymous = await measured(await f.open(entry.token));
      expect(anonymous.status).toBe(200);
      expect(await measured(await f.open(entry.token, { ...marker, cookie }))).toEqual(anonymous);
      expect(await measured(await f.open(entry.token, { ...marker, [MAIL_TOKEN_HEADER]: BOX }))).toEqual(anonymous);
      expect(await expectUnavailable(await f.open('b'.repeat(43), { ...marker, cookie })))
        .toEqual(await expectUnavailable(await f.open('b'.repeat(43), { ...marker, [MAIL_TOKEN_HEADER]: BOX })));
    } finally { await f.close(); }
  });
});

// The review page's routes (draft-review design §3.5, Task R2.2). The real `buildServer`, with `deps.pwaRoot`
// pointing at a fixture root that holds a stand-in page and a stand-in shell, so no build is needed.
const PAGE_BYTES = '<!doctype html><title>stand-in review page</title><script src="/assets/review-STANDIN.js"></script>';
const SHELL_BYTES = '<!doctype html><title>stand-in app shell</title>';
// The spec's string, written out here and never imported: a drifted constant must not pass its own test.
const SPEC_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' data:; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function pageRoot(): string {
  const root = mkTmp('review-root-');
  writeFileSync(path.join(root, 'review.html'), PAGE_BYTES);
  writeFileSync(path.join(root, 'index.html'), SHELL_BYTES);
  return root;
}

async function pageFixture(armed: boolean, root: string | null) {
  const home = mkTmp('review-page-');
  const fs = { ...nodeReviewFs };
  const opened = await openReviewStore(path.join(home, 'store'), fs);
  if (!opened.ok) throw new Error(opened.why);
  const deps = testDeps(home);
  if (armed) {
    mkdirSync(deps.cfg.ccrcDir, { recursive: true });
    const line = await hashLine(PASS, { n: 1024, r: 8, p: 1, keylen: 32 }, 1);
    writeFileSync(deps.cfg.authSecretPath, `${line}\n`, { mode: 0o600 });
  }
  const app = await buildServer({ ...deps, cfg: { ...deps.cfg, authEnabled: armed, cookieSecure: false },
    mailToken: BOX, review: { store: opened.store }, pwaRoot: root });
  try {
    if (!app.reviewSweep) throw new Error('review sweep unavailable');
    await app.reviewSweep.started;
    await app.reviewSweep.stop();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const get = (url: string, headers: Record<string, string> = {}) => fetch(`${address}${url}`, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(3000),
    });
    // A request line exactly as written: fetch would fold `//x` and `/a/../x` before sending.
    const raw = (target: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const { port } = new URL(address);
        const req = request({ host: '127.0.0.1', port: Number(port), path: target, method: 'GET', headers }, res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          res.on('error', reject);
        });
        req.setTimeout(2000, () => req.destroy(new Error('fixture request timed out')));
        req.on('error', reject);
        req.end();
      });
    const cookie = async (): Promise<string> => {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
      expect(login.statusCode).toBe(204);
      const set = login.headers['set-cookie'];
      const first = (Array.isArray(set) ? set[0] : set)?.split(';', 1)[0];
      if (!first) throw new Error('fixture login did not set a cookie');
      return first;
    };
    return { app, get, raw, cookie, close: () => app.close() };
  } catch (err) {
    await app.close();
    throw err;
  }
}

describe('draft review page routes', () => {
  it.each([false, true])('GET /review answers the spec policy exactly, with no inline script and no allow- token (armed=%s)', async armed => {
    const f = await pageFixture(armed, pageRoot());
    try {
      const response = await f.get('/review');
      expect(response.status).toBe(200);
      const csp = response.headers.get('content-security-policy');
      expect(csp).toBe(SPEC_CSP);
      const script = csp!.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
      expect(script).toBe("script-src 'self'");
      expect(script).not.toContain("'unsafe-inline'");
      expect(csp).not.toMatch(/allow-/);
      // Read to its end before close: an unread keep-alive answer can hold close() past the test's limit (R1 carry).
      expect(await response.text()).toBe(PAGE_BYTES);
    } finally { await f.close(); }
  });

  it.each([
    ['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'],
    ['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'],
  ])('GET /review carries %s: %s', async (name, value) => {
    const f = await pageFixture(false, pageRoot());
    try {
      const response = await f.get('/review');
      expect(response.status).toBe(200);
      expect(response.headers.get(name)).toBe(value);
      expect(await response.text()).toBe(PAGE_BYTES);
    } finally { await f.close(); }
  });

  it('GET /review answers no-store with the static filter in place, which a sendFile route would not', async () => {
    const f = await pageFixture(false, pageRoot());
    try {
      const response = await f.get('/review');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe(PAGE_BYTES);
    } finally { await f.close(); }
  });

  // Fastify's automatic HEAD route runs the GET handler, so HEAD carries the whole policy too (review of R2.2, minor 7).
  it('HEAD /review carries all five page headers and no body', async () => {
    const f = await pageFixture(false, pageRoot());
    try {
      const response = await f.app.inject({ method: 'HEAD', url: '/review' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-security-policy']).toBe(SPEC_CSP);
      for (const [name, value] of [['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'],
        ['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY']] as const) {
        expect(response.headers[name], name).toBe(value);
      }
      expect(response.body).toBe('');
    } finally { await f.close(); }
  });

  it('GET /review sends the page as HTML', async () => {
    const f = await pageFixture(false, pageRoot());
    try {
      const response = await f.get('/review');
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await response.text()).toBe(PAGE_BYTES);
    } finally { await f.close(); }
  });

  it.each([false, true])('GET /review answers the stand-in page bytes exactly, with and without a cookie (armed=%s)', async armed => {
    const f = await pageFixture(armed, pageRoot());
    try {
      const anonymous = await f.get('/review');
      expect(anonymous.status).toBe(200);
      expect(await anonymous.text()).toBe(PAGE_BYTES);
      const headers = armed ? { cookie: await f.cookie() } : { cookie: 'ccrc_session=fixture' };
      const withCookie = await f.get('/review', headers);
      expect(withCookie.status).toBe(200);
      expect(await withCookie.text()).toBe(PAGE_BYTES);
    } finally { await f.close(); }
  });

  it.each([false, true])('GET /review?utm_source=x reaches the page route and carries the policy (armed=%s)', async armed => {
    const f = await pageFixture(armed, pageRoot());
    try {
      const response = await f.get('/review?utm_source=x');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toBe(SPEC_CSP);
      expect(await response.text()).toBe(PAGE_BYTES);
    } finally { await f.close(); }
  });

  it.each(['/review.html', '/review/'])('GET %s is a 404 when dark, with neither the page nor the shell', async url => {
    const f = await pageFixture(false, pageRoot());
    try {
      const response = await f.get(url);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.text();
      expect(body).toBe(unavailable);
      expect(body).not.toContain('stand-in');
    } finally { await f.close(); }
  });

  // Armed and without a session the gate answers first: neither route is EXEMPT (only `GET /review` is, reason 9).
  it.each(['/review.html', '/review/'])('GET %s is a 401 when armed without a session, with neither the page nor the shell', async url => {
    const f = await pageFixture(true, pageRoot());
    try {
      const response = await f.get(url);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain('stand-in');
    } finally { await f.close(); }
  });

  // Characterisation (A0): the router and the static plugin's own path checks already refuse these spellings, so
  // these rows describe today; the filter's own unit rows are in `pwa-static-cache.test.ts`.
  it.each([false, true])('no odd spelling of the built file answers the page bytes (armed=%s)', async armed => {
    const f = await pageFixture(armed, pageRoot());
    try {
      for (const target of ['//review.html', '/assets/../review.html', '/review%2Ehtml', '/Review.html']) {
        const response = await f.raw(target);
        expect(response.body, target).not.toBe(PAGE_BYTES);
        expect(response.body, target).not.toContain('stand-in review page');
      }
    } finally { await f.close(); }
  });

  it('a null PWA root answers 404 on /review, never a shell', async () => {
    const f = await pageFixture(false, null);
    try {
      const response = await f.get('/review');
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe(unavailable);
    } finally { await f.close(); }
  });

  it('a root with no readable page answers 404 on /review, never the shell', async () => {
    const root = mkTmp('review-root-');
    writeFileSync(path.join(root, 'index.html'), SHELL_BYTES);
    const f = await pageFixture(false, root);
    try {
      const response = await f.get('/review');
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.text();
      expect(body).toBe(unavailable);
      expect(body).not.toContain('stand-in');
    } finally { await f.close(); }
  });
});
