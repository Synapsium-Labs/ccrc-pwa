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
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import Fastify, { type FastifyInstance } from 'fastify';
import { installDocsRequestPolicy, installDocsResponsePolicy, sendDocsFailure } from '../src/docs/hooks.js';
import { DOCS_CACHE_IMMUTABLE, docsBusyBody } from '../src/docs/policy.js';
import { buildServer, type Deps } from '../src/server.js';
import { DOCS_CAP } from '../src/ccdargv.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import {
  DOCS_API_PREFIX, DOCS_RASTER_TYPES, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RESPONSE_HEADERS, docsApi,
  type DocPin, type DocsFailureBody,
} from '../../shared/docs.js';
import { FIXTURE_COMMIT, FIXTURE_SERVED, indexOk, line, showLine, treeOk } from './docsRouteHelpers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

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

// ===== Task 9: M5.4 over the REAL server's route table (design 2026-10-01 section 5.3, section 5.8) =====
//
// The docs routes are DERIVED from Fastify's own `printRoutes` of a server `buildServer` built (the walk is a copy
// of `auth-gate.test.ts`'s `realRouteTable`: HEAD rows dropped, a line it cannot read recorded as `UNPARSED` so it
// fails), filtered to `DOCS_API_PREFIX`, never hand-listed: a docs route registered outside the plugin joins the set
// and fails for want of the headers. Each probe below runs over that derived set. `RECIPES` says only how to make
// each route answer a 200 or a 4xx; a derived route without a recipe fails by name.

/** The passphrase and the fast scrypt parameters of an armed fixture (`update-routes.test.ts`'s pair). */
const M54_PASSPHRASE = 'correct horse battery staple';
const M54_FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
/** The four docs routes as `METHOD path` keys (section 3.4): what the derived set must equal. */
const M54_DOCS_KEYS = [
  'GET /api/docs/:project/file', 'GET /api/docs/:project/tree', 'GET /api/docs/projects',
  'POST /api/docs/:project/refresh',
];
/** The bytes the fixture show answers, and the committed pin the file route is read through. */
const M54_MD = new TextEncoder().encode('# a\n');
const M54_PIN: DocPin = {
  kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path: 'a.md',
};

/** One request: its method, URL and, for the POST, a JSON body. */
interface M54Req { method: 'GET' | 'POST'; url: string; payload?: string }
/** How to make one docs route answer a 200 and a 4xx (a refused query or body), by its derived key. */
const RECIPES: Readonly<Record<string, { ok: M54Req; refused: M54Req }>> = {
  'GET /api/docs/projects': {
    ok: { method: 'GET', url: docsApi.projects() },
    refused: { method: 'GET', url: `${docsApi.projects()}?x=1` },
  },
  'GET /api/docs/:project/tree': {
    ok: { method: 'GET', url: docsApi.tree('demo', null) },
    refused: { method: 'GET', url: '/api/docs/demo/tree?ref=a&ref=b' },
  },
  'GET /api/docs/:project/file': {
    ok: { method: 'GET', url: docsApi.file('demo', M54_PIN) },
    refused: { method: 'GET', url: `${docsApi.file('demo', M54_PIN)}&branch=main` },
  },
  'POST /api/docs/:project/refresh': {
    ok: { method: 'POST', url: docsApi.refresh('demo'), payload: JSON.stringify({ ref: null, reason: 'manual' }) },
    refused: { method: 'POST', url: docsApi.refresh('demo'), payload: '{"ref":1,"reason":"auto"}' },
  },
};

/** Every route Fastify itself says it has, as `METHOD path` (`auth-gate.test.ts`'s walk, copied). */
function m54RouteTable(app: FastifyInstance): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];
  let matched = 0;
  for (const row of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^([│\s]*)[├└]──\s(\S*)\s\(([^)]+)\)\s*$/.exec(row);
    if (row.trim() === '') continue;
    if (!m) { out.add(`UNPARSED ${row}`); continue; }
    matched++;
    const depth = m[1].length / 4;
    stack.length = depth;
    stack[depth] = m[2];
    const full = stack.slice(0, depth + 1).join('') || '/';
    for (const method of m[3].split(',')) {
      const v = method.trim();
      if (v === 'HEAD') continue;
      out.add(`${v} ${full === '*' ? '/*' : full}`);
    }
  }
  if (matched === 0) out.add('UNPARSED the whole tree — printRoutes changed shape');
  return out;
}

/** The derived docs routes, sorted: every row under `DOCS_API_PREFIX`, and every row the walk could not read. */
function derivedDocsRoutes(app: FastifyInstance): string[] {
  return [...m54RouteTable(app)].filter((k) => k.startsWith('UNPARSED')
    || k.slice(k.indexOf(' ') + 1) === DOCS_API_PREFIX || k.slice(k.indexOf(' ') + 1).startsWith(`${DOCS_API_PREFIX}/`))
    .sort();
}

/** A route key's path with `:project` filled in: the request a probe with no recipe sends. */
function concreteUrl(key: string): string {
  return key.slice(key.indexOf(' ') + 1).replace(':project', 'demo');
}

/** A measured runner exit (`ExecResult`), so the adapter's check 1 reads both halves as measured. */
function m54Exit(code: number, stdout: string): ExecResult {
  return { code, stdout, stderr: code === 0 ? '' : 'boom', killed: false, signal: null };
}

/**
 * The real server over a fixture HOME (never the live one), its runner answering every docs verb ok (`fault`: every
 * exec exits 1 with no output, ccd's `ccd-fault`), `authEnabled` as asked, and a handshaken fleet state carrying the
 * docs cap, returned so a probe can mutate it in place.
 */
async function m54Server(o: { auth?: boolean; fault?: boolean } = {}): Promise<{ app: FastifyInstance; state: FleetState }> {
  const run: Runner = async (_cmd, args) => {
    if (o.fault) return m54Exit(1, '');
    if (args[0] === 'docs-index') return m54Exit(0, line(indexOk()));
    if (args[0] === 'docs-tree') return m54Exit(0, line(treeOk()));
    if (args[0] === 'docs-show') return m54Exit(0, showLine(M54_PIN, M54_MD));
    if (args[0] === 'docs-fetch') {
      return m54Exit(0, line({
        v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 6, branch: 'main', trackedRef: FIXTURE_SERVED,
        before: FIXTURE_COMMIT, after: 'b'.repeat(40), moved: 'updated', stamp: 'written',
      }));
    }
    return m54Exit(1, '');
  };
  const home = mkTmp('ccrc-docs-m54-');
  const base = testDeps(home, run);
  if (o.auth) {
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(M54_PASSPHRASE, M54_FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['caps', DOCS_CAP], rosterFp: null, build: null };
  const deps: Deps = {
    ...base, cfg: { ...base.cfg, authEnabled: o.auth ?? false, cookieSecure: false }, fleetState: state,
  };
  const app = await buildServer(deps);
  await app.ready();
  opened.push(app);
  return { app, state };
}

/** Send `req` with `headers` (a JSON content type added when it has a body). */
function sendM54(app: FastifyInstance, req: M54Req, headers: Record<string, string>) {
  return app.inject({
    method: req.method, url: req.url, payload: req.payload,
    headers: req.payload === undefined ? headers : { ...headers, 'content-type': 'application/json' },
  });
}

/** The recipe for a derived key; a route with none fails by name. */
function recipeFor(key: string): { ok: M54Req; refused: M54Req } {
  const r = RECIPES[key];
  expect(r, `${key} is a docs route with no recipe here — was a route added outside this plan?`).toBeDefined();
  return r;
}

/** The four headers with exact values, and `no-store` on every non-200. */
function expectDecorated(key: string, res: { statusCode: number; headers: Record<string, unknown> }): void {
  for (const [name, value] of Object.entries(DOCS_RESPONSE_HEADERS)) expect(res.headers[name], `${key} ${name}`).toBe(value);
  if (res.statusCode !== 200) expect(res.headers['cache-control'], `${key} cache-control`).toBe('no-store');
}

describe('M5.4 — every docs route in the real server\'s table carries the four headers (section 5.3, section 5.8)', () => {
  it('the derived set: the real table under /api/docs is exactly the four docs routes, and the walk read every row', async () => {
    const { app } = await m54Server();
    expect(derivedDocsRoutes(app)).toEqual(M54_DOCS_KEYS);
  });

  it('a 200: dark, the PWA headers, ok answers (the POST with its JSON body)', async () => {
    const { app } = await m54Server();
    for (const key of derivedDocsRoutes(app)) {
      const res = await sendM54(app, recipeFor(key).ok, PWA);
      expect(res.statusCode, key).toBe(200);
      expectDecorated(key, res);
    }
  });

  it('a 4xx: a refused query or body, before any exec', async () => {
    const { app } = await m54Server();
    for (const key of derivedDocsRoutes(app)) {
      const res = await sendM54(app, recipeFor(key).refused, PWA);
      expect(res.statusCode, key).toBe(400);
      expectDecorated(key, res);
    }
  });

  it('a 5xx: a read\'s ccd fault (502); the refresh\'s caps-unknown (503: a refusal before any exec keeps its status)', async () => {
    const { app, state } = await m54Server({ fault: true });
    for (const key of derivedDocsRoutes(app)) {
      const req = recipeFor(key).ok;
      state.ccdVerbs = req.method === 'POST' ? null : ['caps', DOCS_CAP];
      const res = await sendM54(app, req, PWA);
      expect(res.statusCode, key).toBe(req.method === 'POST' ? 503 : 502);
      expectDecorated(key, res);
    }
  });

  it('armed, no cookie: the gate\'s 401 with its verdict', async () => {
    const { app } = await m54Server({ auth: true });
    for (const key of derivedDocsRoutes(app)) {
      const res = await sendM54(app, recipeFor(key).ok, PWA);
      expect(res.statusCode, key).toBe(401);
      expect(res.json().verdict, key).toBe('no-session');
      expectDecorated(key, res);
    }
  });

  it('armed, a session, a POST from a foreign Origin: the gate\'s 403', async () => {
    const { app } = await m54Server({ auth: true });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: M54_PASSPHRASE } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : String(set);
    const cookie = first.slice(0, first.indexOf(';'));
    const posts = derivedDocsRoutes(app).filter((k) => k.startsWith('POST '));
    expect(posts.length, 'no docs POST in the derived set').toBeGreaterThan(0);
    for (const key of posts) {
      const res = await sendM54(app, recipeFor(key).ok, { ...PWA, cookie, origin: 'https://other.example' });
      expect(res.statusCode, key).toBe(403);
      expect(res.json(), key).toStrictEqual({ ok: false, error: 'foreign-origin' });
      expectDecorated(key, res);
    }
  });

  it('dark, no marker: the provenance 403 foreign-request — for every derived route, recipe or none', async () => {
    const { app } = await m54Server();
    for (const key of derivedDocsRoutes(app)) {
      const res = await app.inject({ method: key.slice(0, key.indexOf(' ')) as 'GET' | 'POST', url: concreteUrl(key) });
      expect(res.statusCode, key).toBe(403);
      expect(res.json(), key).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'marker' });
      expectDecorated(key, res);
    }
  });
});

// ===== Task 11 review 2-1: a bodiless gate refusal on a docs route keeps its status, decorated =====
// The gate answers a WebSocket upgrade it refuses with `reply.code(401).send()` / `reply.code(403).send()`: no payload
// and no content type. Over a REAL listening armed server and a real `ws` client (the upgrade request is the only
// way to reach those two lines).

/** The armed real server, listening on loopback. */
async function listeningArmed(): Promise<FastifyInstance> {
  const { app } = await m54Server({ auth: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

/** Upgrade `url` with `headers`; resolve with the refusal the server answered (status, headers, body). */
function upgradeRefusal(app: FastifyInstance, url: string, headers: Record<string, string>):
    Promise<{ status: number | undefined; headers: Record<string, unknown>; body: string }> {
  const port = (app.server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const c = new WebSocket(`ws://127.0.0.1:${port}${url}`, { headers });
    c.on('upgrade', () => { c.close(); reject(new Error('the upgrade was accepted')); });
    c.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += String(d); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    c.on('error', () => { /* the refusal is reported by unexpected-response */ });
  });
}

describe('T11 review 2-1: a bodiless gate refusal on a docs route keeps its status, decorated', () => {
  it('an upgrade with no cookie and the right Origin: the gate\'s 401, the four headers, no-store, no defect line', async () => {
    const app = await listeningArmed();
    const res = await upgradeRefusal(app, '/api/docs/projects', { ...PWA, origin: 'http://localhost:7788' });
    expect(res.status).toBe(401);
    expectDecorated('ws 401', { statusCode: 401, headers: res.headers });
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('response refused'))).toStrictEqual([]);
  });

  it('an upgrade from a foreign Origin: the gate\'s 403, decorated, no defect line', async () => {
    const app = await listeningArmed();
    const res = await upgradeRefusal(app, '/api/docs/projects', { ...PWA, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expectDecorated('ws 403', { statusCode: 403, headers: res.headers });
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('response refused'))).toStrictEqual([]);
  });

  it('a response WITH a body and no content type is still refused at the hook (M5.5 kept)', async () => {
    const app = await open();
    const res = await app.inject({ method: 'GET', url: '/api/docs/sent/bare-string', headers: PWA });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'response-type-refused' });
  });
});

// ===== Task 11 review 2-2: a WebSocket upgrade to a docs route escapes onSend only after the gate and provenance =====
// `@fastify/websocket`, registered at the root, wraps every route's handler: an upgrade that passes the gate and the
// docs provenance hijacks the reply and is answered `101` before the plugin's `onSend`, so the 101 carries none of
// the four headers. The departure is safe because the gate and provenance run first (a browser cannot set the marker
// on an upgrade), and the hijacked socket runs no docs exec. Real listening servers, a real `ws` client, and a
// recording runner (every docs verb is an exec, so an empty record is "no lane, cache or flight was reached").

/** The origin an armed fixture accepts (the gate's own default for a loopback server). */
const WS_ORIGIN = 'http://localhost:7788';

/**
 * The real server on loopback over a fixture HOME, its runner RECORDING every call (each answers ok), `auth` armed or
 * dark; armed, a session cookie is returned too.
 */
async function listeningRecording(auth: boolean):
    Promise<{ app: FastifyInstance; execs: string[][]; cookie: string }> {
  const execs: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    execs.push([...args]);
    if (args[0] === 'docs-index') return m54Exit(0, line(indexOk()));
    if (args[0] === 'docs-tree') return m54Exit(0, line(treeOk()));
    if (args[0] === 'docs-show') return m54Exit(0, showLine(M54_PIN, M54_MD));
    return m54Exit(1, '');
  };
  const home = mkTmp('ccrc-docs-ws-');
  const base = testDeps(home, run);
  if (auth) {
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(M54_PASSPHRASE, M54_FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['caps', DOCS_CAP], rosterFp: null, build: null };
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: auth, cookieSecure: false }, fleetState: state };
  const app = await buildServer(deps);
  await app.ready();
  opened.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  let cookie = '';
  if (auth) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: M54_PASSPHRASE } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : String(set);
    cookie = first.slice(0, first.indexOf(';'));
  }
  return { app, execs, cookie };
}

/** What an upgrade that was ACCEPTED saw: its 101 headers, every message before the close, and the close itself. */
interface Accepted { status: number; headers: Record<string, unknown>; messages: string[]; closed: boolean }

/** Upgrade `url` with `headers`; resolve once the accepted socket has closed (the server closes it at once). */
function upgradeAccepted(app: FastifyInstance, url: string, headers: Record<string, string>): Promise<Accepted> {
  const port = (app.server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const c = new WebSocket(`ws://127.0.0.1:${port}${url}`, { headers });
    const seen: Accepted = { status: 0, headers: {}, messages: [], closed: false };
    c.on('upgrade', (res) => { seen.status = res.statusCode ?? 0; seen.headers = res.headers; });
    c.on('message', (d) => { seen.messages.push(String(d)); });
    c.on('unexpected-response', () => { c.terminate(); reject(new Error('the upgrade was refused')); });
    c.on('error', () => { /* an abrupt close after the 101 is the expected end */ });
    c.on('close', () => { seen.closed = true; resolve(seen); });
  });
}

describe('T11 review 2-2: a WebSocket upgrade to a docs route escapes onSend only after the gate and provenance, with zero execs', () => {
  it('(a) dark: a browser-shaped upgrade (same origin, no marker) is refused 403 foreign-request {why:marker}, decorated, no exec', async () => {
    const { app, execs } = await listeningRecording(false);
    const res = await upgradeRefusal(app, '/api/docs/projects',
      { origin: WS_ORIGIN, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'websocket' });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'marker' });
    expectDecorated('ws marker', { statusCode: 403, headers: res.headers });
    expect(execs).toStrictEqual([]);
  });

  it('(a) armed, with a session: the same browser-shaped upgrade is refused by provenance, decorated, no exec', async () => {
    const { app, execs, cookie } = await listeningRecording(true);
    const res = await upgradeRefusal(app, '/api/docs/projects',
      { origin: WS_ORIGIN, cookie, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'websocket' });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'marker' });
    expectDecorated('ws marker armed', { statusCode: 403, headers: res.headers });
    expect(execs).toStrictEqual([]);
  });

  it('(b) armed, no session: the gate refuses the upgrade 401 before provenance, and the refusal carries the four headers', async () => {
    const { app, execs } = await listeningRecording(true);
    const res = await upgradeRefusal(app, '/api/docs/projects', { ...PWA, origin: WS_ORIGIN });
    expect(res.status).toBe(401);
    expectDecorated('ws gate 401', { statusCode: 401, headers: res.headers });
    expect(execs).toStrictEqual([]);
  });

  it('(c) an upgrade that passes the gate and provenance gets 101 and runs ZERO docs execs: no body, the socket closed', async () => {
    for (const auth of [false, true]) {
      const { app, execs, cookie } = await listeningRecording(auth);
      const headers: Record<string, string> = { ...PWA, origin: WS_ORIGIN, ...(auth ? { cookie } : {}) };
      for (const url of ['/api/docs/projects', '/api/docs/demo/tree']) {
        const seen = await upgradeAccepted(app, url, headers);
        expect(seen.status, `${url} armed=${auth}`).toBe(101);
        expect(seen.messages, `${url} armed=${auth}: no docs body`).toStrictEqual([]);
        expect(seen.closed, `${url} armed=${auth}`).toBe(true);
      }
      expect(execs, `armed=${auth}: an upgrade reaches no exec, lane, cache or flight`).toStrictEqual([]);
      // The same server still answers a plain GET as before: the closed upgrade left no lane slot held.
      const plain = await app.inject({ method: 'GET', url: '/api/docs/projects', headers: auth ? { ...PWA, cookie } : PWA });
      expect(plain.statusCode).toBe(200);
      expect(execs.map((e) => e[0])).toStrictEqual(['docs-index']);
    }
  });
});

describe('FR1 review F2: provenance runs at onRequest, so an unproven request\'s body is never parsed', () => {
  const REFRESH = '/api/docs/demo/refresh';
  const { [DOCS_REQUEST_HEADER]: _marker, ...MARKERLESS } = PWA;
  const FOREIGN = { ok: false, failure: 'foreign-request', why: 'marker' };

  it.each([
    ['an invalid JSON body', '{bad'],
    ['a 2 MiB body', `{"ref":"${'x'.repeat(2 * 1024 * 1024)}","reason":"auto"}`],
  ])('a marker-less POST refresh with %s answers 403 foreign-request {why: marker}, not 400, and runs no handler', async (_what, payload) => {
    const app = await open();
    const res = await app.inject({
      method: 'POST', url: REFRESH, headers: { ...MARKERLESS, 'content-type': 'application/json' }, payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toStrictEqual(FOREIGN);
    expect(res.headers['content-type']).toBe(JSON_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expectDocsHeaders(res.headers);
    expect(entered).toBe(0);
  });
});
