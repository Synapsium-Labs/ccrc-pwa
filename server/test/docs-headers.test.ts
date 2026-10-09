// `server/src/docs/hooks.ts`, the docs plugin's request and response policy (design 2026-10-01, section 3.8, section
// 5.3, section 3.4's registration; W3 refinements (e) and (o)). Task 3 drives the hooks on a BARE Fastify: a root
// `onRequest` stub stands in for the gate (it is registered before the plugin, as `installGate` is in `buildServer`),
// the plugin is registered exactly as section 3.4 registers the docs plugin, and planted routes stand in for the docs
// routes (a handler entry is a planted route's "exec"). M3.5-M3.7 (provenance), the refusal log, F1's analogue (a
// gate refusal still carries the docs headers), the request-body error handler, M5.5 (the content-type allowlist),
// Cache-Control at the hook, and `sendDocsFailure`. Task 9 appends M5.4 (every route of the REAL server's table).
//
// The PWA's own headers are built from L0's constants, never the quoted marker; the response headers and the raster
// magic are read from L0's tables, never typed here.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { installDocsRequestPolicy, installDocsResponsePolicy, sendDocsFailure } from '../src/docs/hooks.js';
import { DOCS_CACHE_IMMUTABLE, docsBusyBody } from '../src/docs/policy.js';
import {
  DOCS_RASTER_TYPES, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RESPONSE_HEADERS, type DocsFailureBody,
} from '../../shared/docs.js';

const HOOKS_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/docs/hooks.ts'), 'utf8');

/** What the PWA's `fetch()` sends (section 3.8): the marker, a same-origin site and a non-navigation mode. */
const PWA: Readonly<Record<string, string>> = {
  [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
};
const JSON_TYPE = 'application/json; charset=utf-8';
/** A PNG's own magic followed by four bytes, from L0's table. */
const PNG_BYTES = Uint8Array.from([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 1, 2, 3, 4]);

/** A planted response: its content type (`null`: the route sets none), body, and any extra headers it sets. */
interface Sent { type: string | null; body: string | Uint8Array; status?: number; headers?: Record<string, string> }

/** Handler entries: a planted route's "exec". Reset before each case. */
let entered = 0;

/** M5.5's refused responses and the passing ones (by name, so each case names its route). */
const SENT: Readonly<Record<string, Sent>> = {
  html: { type: 'text/html', body: '<p>x</p>' },
  'html-utf8': { type: 'text/html; charset=utf-8', body: '<p>x</p>' },
  svg: { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  'bare-string': { type: null, body: 'plain words' },
  'bare-buffer': { type: null, body: Buffer.from([0, 1, 2, 3]) },
  xml: { type: 'application/xml', body: '<a/>' },
  attachment: { type: 'text/html', body: '<p>x</p>', headers: { 'content-disposition': 'attachment; filename="x.html"' } },
  'own-length': { type: 'text/html', body: '<p>x</p>', headers: { 'content-length': '8' } },
  'png-spaced': { type: 'image/png ; x', body: PNG_BYTES },
  bmp: { type: 'image/bmp', body: PNG_BYTES },
  png: { type: 'image/png', body: PNG_BYTES },
  'png-immutable': { type: 'image/png', body: PNG_BYTES, headers: { 'cache-control': DOCS_CACHE_IMMUTABLE } },
  'json-404-immutable': {
    type: JSON_TYPE, body: JSON.stringify({ ok: false, x: 1 }), status: 404,
    headers: { 'cache-control': DOCS_CACHE_IMMUTABLE },
  },
  'json-422': { type: JSON_TYPE, body: JSON.stringify({ ok: false, x: 2 }), status: 422 },
};

/** The failure bodies `sendDocsFailure` is driven with, by name. */
const FAILURES: Readonly<Record<string, DocsFailureBody>> = {
  'busy-read': docsBusyBody('read'),
  'caps-unknown': { ok: false, failure: 'caps-unknown' },
  'fetch-too-soon': { ok: false, failure: 'fetch-too-soon', retryAfterMs: 9000 },
  'bad-query': { ok: false, failure: 'bad-query', key: 'ref', why: 'repeated' },
};

/** What the planted defect throws: a host path and a line of stderr, which no docs response may carry. */
const DEFECT_TEXT = "ENOENT: open '/var/example/docs/a.md'; stderr: fatal: not a git repository";

/**
 * A bare app: the gate stub at the root (`x-test-gate: deny` is the gate's 401 with its `verdict`; `origin` is its
 * 403 `foreign-origin`), then the docs plugin as section 3.4 registers it, holding the planted routes, then one route
 * OUTSIDE the plugin.
 */
async function bareApp(clock: () => number = () => 0): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req, reply) => {
    const gate = req.headers['x-test-gate'];
    if (gate === 'deny') return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    if (gate === 'origin') return reply.code(403).send({ ok: false, error: 'foreign-origin' });
  });
  await app.register(async (app) => {
    installDocsRequestPolicy(app, clock);
    installDocsResponsePolicy(app);
    app.get('/api/docs/:project/tree', async () => {
      entered += 1;
      return { ok: true };
    });
    app.post('/api/docs/:project/refresh', async (req) => {
      entered += 1;
      return { ok: true, bodyType: typeof req.body, body: req.body };
    });
    app.get('/api/docs/boom', async () => {
      entered += 1;
      throw new Error(DEFECT_TEXT);
    });
    app.get('/api/docs/sent/:name', async (req, reply) => {
      entered += 1;
      const s = SENT[(req.params as { name: string }).name];
      if (s.status !== undefined) reply.code(s.status);
      if (s.type !== null) reply.type(s.type);
      for (const [k, v] of Object.entries(s.headers ?? {})) reply.header(k, v);
      return reply.send(s.body);
    });
    app.get('/api/docs/fail/:name', async (req, reply) => {
      entered += 1;
      return sendDocsFailure(reply, FAILURES[(req.params as { name: string }).name]);
    });
  });
  app.get('/api/outside', async () => {
    entered += 1;
    return { ok: true };
  });
  await app.ready();
  return app;
}

/** The four section 5.3 headers, exactly as L0's table holds them. */
function expectDocsHeaders(headers: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(DOCS_RESPONSE_HEADERS)) expect(headers[name], name).toBe(value);
}
function expectNoDocsHeaders(headers: Record<string, unknown>): void {
  for (const name of Object.keys(DOCS_RESPONSE_HEADERS)) expect(headers[name], name).toBeUndefined();
}

let warn: MockInstance<(...args: unknown[]) => void>;
const opened: FastifyInstance[] = [];
beforeEach(() => {
  entered = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  for (const app of opened.splice(0)) await app.close();
});
async function open(clock?: () => number): Promise<FastifyInstance> {
  const app = await bareApp(clock);
  opened.push(app);
  return app;
}
const TREE = '/api/docs/demo/tree';

describe('W3 T3: provenance, refused before any handler (M3.5-M3.7, section 3.8)', () => {
  it.each([
    ['M3.5 a top-level navigation', { ...PWA, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }],
    ["M3.5 the service worker's navigation (dest empty)", { ...PWA, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'empty' }],
  ])('%s is 403 foreign-request {why:navigation}, no verdict, no handler', async (_what, headers) => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: TREE, headers });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'navigation' });
    expect(Object.hasOwn(res.json(), 'verdict')).toBe(false);
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
    expect(entered).toBe(0);
  });

  it.each([
    ['same-site', 'same-site'], ['cross-site', 'cross-site'], ['none', 'none'], ['an empty value', ''],
    ['a 100-character value, cut to 64', 'x'.repeat(100)],
  ])('M3.6 sec-fetch-site %s is 403 foreign-request {why:site}, carrying the value', async (_what, site) => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: TREE, headers: { ...PWA, 'sec-fetch-site': site } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'site', site: site.slice(0, 64) });
    expectDocsHeaders(res.headers);
    expect(entered).toBe(0);
  });

  it.each([
    ['no marker and no Sec-Fetch-*', {}],
    ['marker 0', { [DOCS_REQUEST_HEADER]: '0' }],
    ['marker true', { [DOCS_REQUEST_HEADER]: 'true' }],
    ['the marker sent twice', { [DOCS_REQUEST_HEADER]: [DOCS_REQUEST_HEADER_VALUE, DOCS_REQUEST_HEADER_VALUE] }],
    ['a same-origin fetch without the marker', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }],
  ])('M3.7 %s is 403 foreign-request {why:marker}', async (_what, headers) => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: TREE, headers });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'marker' });
    expectDocsHeaders(res.headers);
    expect(entered).toBe(0);
  });

  it.each([
    ["the PWA's own fetch", PWA],
    ['the marker alone, from a browser that sends no Sec-Fetch-*', { [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE }],
  ])('M3.7 %s reaches the handler', async (_what, headers) => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: TREE, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true });
    expect(entered).toBe(1);
  });
});

describe('W3 T3: the refusal log, at most one line a minute per why (refinement (o), section 3.8)', () => {
  const NAV = { ...PWA, 'sec-fetch-mode': 'navigate' };
  const SITE = { ...PWA, 'sec-fetch-site': 'cross-site' };
  const lines = (): unknown[] => warn.mock.calls.map((c) => c[0]);

  it('logs a navigation refusal once in a minute, again at the minute, and a site refusal on its own clock', async () => {
    let now = 0;
    const app = await open(() => now);
    await app.inject({ method: 'GET', url: TREE, headers: NAV });
    now = 1;
    await app.inject({ method: 'GET', url: TREE, headers: SITE });
    for (const t of [30000, 59999]) {
      now = t;
      await app.inject({ method: 'GET', url: TREE, headers: NAV });
    }
    expect(lines()).toEqual([
      'ccrc-server: docs refused a navigation request', 'ccrc-server: docs refused a site request',
    ]);
    now = 60000;
    const res = await app.inject({ method: 'GET', url: TREE, headers: NAV });
    expect(res.statusCode).toBe(403);
    expect(lines()).toEqual([
      'ccrc-server: docs refused a navigation request', 'ccrc-server: docs refused a site request',
      'ccrc-server: docs refused a navigation request',
    ]);
  });

  it('every refusal is answered, logged or not', async () => {
    const app = await open(() => 0);
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: TREE, headers: NAV });
      expect(res.statusCode).toBe(403);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(entered).toBe(0);
  });

  it('two server instances keep separate minutes', async () => {
    const a = await open(() => 0);
    const b = await open(() => 1);
    await a.inject({ method: 'GET', url: TREE, headers: NAV });
    await b.inject({ method: 'GET', url: TREE, headers: NAV });
    expect(lines()).toEqual([
      'ccrc-server: docs refused a navigation request', 'ccrc-server: docs refused a navigation request',
    ]);
  });
});

describe("W3 T3: the gate's refusals still carry the docs headers (F1's analogue)", () => {
  it('a 401 with its verdict, decorated, no handler; the gate runs before provenance', async () => {
    const app = await open();
    for (const headers of [{ ...PWA, 'x-test-gate': 'deny' }, { 'x-test-gate': 'deny' }]) {
      const res = await app.inject({ method: 'GET', url: TREE, headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toStrictEqual({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
      expect(res.headers['content-type']).toBe(JSON_TYPE);
      expect(res.headers['cache-control']).toBe('no-store');
      expectDocsHeaders(res.headers);
    }
    expect(entered).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("the gate's 403 foreign-origin on the POST, decorated", async () => {
    const app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/docs/demo/refresh', headers: { ...PWA, 'x-test-gate': 'origin' },
      payload: { ref: null, reason: 'manual' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toStrictEqual({ ok: false, error: 'foreign-origin' });
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
    expect(entered).toBe(0);
  });

  it('a route outside the plugin and an unmatched docs URL get none of the docs headers', async () => {
    const app = await open();
    const outside = await app.inject({ method: 'GET', url: '/api/outside', headers: { 'sec-fetch-mode': 'navigate' } });
    expect(outside.statusCode).toBe(200);
    expectNoDocsHeaders(outside.headers);
    expect(outside.headers['cache-control']).toBeUndefined();
    const unmatched = await app.inject({ method: 'GET', url: '/api/docs/nothing/x', headers: PWA });
    expect(unmatched.statusCode).toBe(404);
    expectNoDocsHeaders(unmatched.headers);
  });
});

describe('W3 T3: request-body refusals are bad-query {why:body} (refinement (e))', () => {
  const REFRESH = '/api/docs/demo/refresh';
  const BAD_BODY = { ok: false, failure: 'bad-query', why: 'body' };

  it.each([
    ['invalid JSON', 'application/json', '{"ref":'],
    ['an empty body with a JSON type', 'application/json', ''],
    ['a __proto__ key', 'application/json', '{"__proto__":{},"ref":null,"reason":"auto"}'],
    ['a body over 1 MiB', 'application/json', `{"ref":"${'x'.repeat(1048577)}","reason":"auto"}`],
    ['a form-encoded body', 'application/x-www-form-urlencoded', 'ref=main&reason=auto'],
  ])('%s', async (_what, type, payload) => {
    const app = await open();
    const res = await app.inject({ method: 'POST', url: REFRESH, headers: { ...PWA, 'content-type': type }, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(BAD_BODY);
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['retry-after']).toBeUndefined();
    expectDocsHeaders(res.headers);
    expect(entered).toBe(0);
  });

  it('a text/plain body reaches the route as a string (the route refuses it, Task 7)', async () => {
    const app = await open();
    const res = await app.inject({
      method: 'POST', url: REFRESH, headers: { ...PWA, 'content-type': 'text/plain' }, payload: 'hello',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true, bodyType: 'string', body: 'hello' });
    expect(entered).toBe(1);
  });

  it("a defect stays Fastify's default 500, still decorated, never a docs word", async () => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: '/api/docs/boom', headers: PWA });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toStrictEqual({ statusCode: 500, error: 'Internal Server Error', message: 'docs route defect' });
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
    expect(entered).toBe(1);
  });

  it("a defect's 500 body carries no absolute path and no stderr text: never the thrower's message", async () => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: '/api/docs/boom', headers: PWA });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(DEFECT_TEXT);
    expect(res.body).not.toMatch(/\/[A-Za-z0-9._-]+\//);
    expect(res.body).not.toContain('stderr');
    expect(res.body).not.toContain('fatal:');
  });
});

describe('W3 T3: the response policy (M5.5, section 5.3)', () => {
  const sent = async (name: string) => {
    const app = await open();
    return app.inject({ method: 'GET', url: `/api/docs/sent/${name}`, headers: PWA });
  };

  it.each([
    ['html', 'text/html'], ['html-utf8', 'text/html; charset=utf-8'], ['svg', 'image/svg+xml'],
    ['bare-string', 'text/plain; charset=utf-8'], ['bare-buffer', 'application/octet-stream'], ['xml', 'application/xml'],
    ['attachment', 'text/html'], ['own-length', 'text/html'], ['png-spaced', 'image/png ; x'], ['bmp', 'image/bmp'],
  ])('M5.5 %s (%s) is refused: 500 response-type-refused, JSON, no-store, logged once', async (name, type) => {
    const res = await sent(name);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'response-type-refused' });
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(res.body));
    expectDocsHeaders(res.headers);
    expect(warn.mock.calls).toEqual([[`ccrc-server: docs response refused, content-type ${JSON.stringify(type)}`]]);
    expect(entered).toBe(1);
  });

  it('image/png passes byte for byte, decorated; a 200 that set no cache-control gets no-store', async () => {
    const res = await sent('png');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(new Uint8Array(res.rawPayload)).toEqual(PNG_BYTES);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a JSON 200 passes, decorated, no-store', async () => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: TREE, headers: PWA });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
  });

  it('a 200 raster that set immutable keeps it (section 6.6)', async () => {
    const res = await sent('png-immutable');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(DOCS_CACHE_IMMUTABLE);
  });

  it.each([['json-404-immutable', 404], ['json-422', 422]])('%s: a non-200 is always no-store', async (name, status) => {
    const res = await sent(name);
    expect(res.statusCode).toBe(status);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
  });
});

describe('W3 T3: sendDocsFailure, the status and Retry-After from L1 (section 3.7)', () => {
  it.each([
    ['busy-read', 503, '2'], ['caps-unknown', 503, '5'], ['fetch-too-soon', 429, undefined], ['bad-query', 400, undefined],
  ] as const)('%s answers %i, Retry-After %s', async (name, status, retryAfter) => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: `/api/docs/fail/${name}`, headers: PWA });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toStrictEqual(FAILURES[name]);
    expect(res.headers['retry-after']).toBe(retryAfter);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
  });
});

describe('W3 T3: hooks.ts spells none of the response-policy headers (it sets what the verdict carries)', () => {
  it('no quoted header name or value from DOCS_RESPONSE_HEADERS, and no quoted request marker', () => {
    const quoted = (s: string): string[] => [`'${s}'`, `"${s}"`, `\`${s}\``];
    const spelled = [
      ...Object.entries(DOCS_RESPONSE_HEADERS).flat(), DOCS_REQUEST_HEADER,
    ].flatMap(quoted).filter((q) => HOOKS_SRC.includes(q));
    expect(spelled).toEqual([]);
  });
});
