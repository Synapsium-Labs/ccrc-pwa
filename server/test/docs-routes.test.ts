// `server/src/docs/routes.ts`, part 1: the three docs reads (design 2026-10-01, section 3.4, section 3.6, section
// 6.3-6.5; W3 refinements (c), (d), (f), (i), (j) and (k)). Task 6 drives `composeDocs` and
// `registerDocsReadRoutes` over W2's REAL adapter and a scripted `CcdRunner` (`docsRouteHelpers.ts`), through
// Fastify's REAL query parser (`app.inject` with a raw URL; W2's review carry), and every case counts the argv the
// runner recorded: M3.4 (each refusal with zero execs, the router-level refusals of refinement (d), no HEAD), the
// differential against W2's test decoder, the answers and ccd failures carried verbatim, the gate and its live state,
// the ok-answer shape guard, and M6.2 at the routes (the read lane's bounds, a non-docs route unaffected, a client
// that left dequeued). Task 7 appends the refresh describes; Task 9 the real server's.
//
// Fixtures carry placeholders only; the marker is L0's constant, never quoted here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { DOCS_CAP } from '../src/ccdargv.js';
import type { CcdResult } from '../src/lifecycle.js';
import { composeDocs } from '../src/docs/routes.js';
import {
  DOCS_INDEX_CACHE_MS, DOCS_LANE_MAX_WAIT_MS, DOCS_LANE_QUEUE, LISTING_JOB, parseDocsApiQuery, refreshDue,
} from '../src/docs/policy.js';
import { DOCS_RESPONSE_HEADERS, type DocsFailureBody, type DocsFailure } from '../../shared/docs.js';
import {
  FIXTURE_COMMIT, FIXTURE_SERVED, PWA_HEADERS, blocker, docsApp, faultRes, indexOk, line, nodeLanes, okRes, scripted,
  treeOk, until,
} from './docsRouteHelpers.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
});

/** `docsApp`, closed after the case. */
async function open(o: Parameters<typeof docsApp>[0]): Promise<Awaited<ReturnType<typeof docsApp>>> {
  const made = await docsApp(o);
  apps.push(made.app);
  return made;
}

const enc = encodeURIComponent;
const FP = 'c'.repeat(64);
/** A complete committed pin's query and a complete draft pin's, as `docsApi` writes them. */
const COMMITTED_Q = `commit=${FIXTURE_COMMIT}&servedRef=${enc(FIXTURE_SERVED)}&section=specs&path=a.md`;
const DRAFT_Q = `branch=${enc('ws/a')}&head=${FIXTURE_COMMIT}&section=specs&path=a.md&fp=${FP}`;
const fileUrl = (q: string): string => `/api/docs/demo/file?${q}`;
/** A committed file GET for `path` (no listing: the class cap is the bound). */
const committedAt = (path: string): string => fileUrl(COMMITTED_Q.replace('path=a.md', `path=${enc(path)}`));

const badQuery = (why: string, key?: string): DocsFailureBody =>
  (key === undefined ? { ok: false, failure: 'bad-query', why } : { ok: false, failure: 'bad-query', key, why });
const word = (failure: DocsFailure): DocsFailureBody => ({ ok: false, failure });

/** The four response-policy headers, as names. */
const DOCS_HEADER_NAMES = Object.keys(DOCS_RESPONSE_HEADERS);

describe('M3.4 — every refusal before an exec answers its word and status, with zero execs', () => {
  const REFUSED: readonly (readonly [string, string, DocsFailureBody])[] = [
    ['tree: an unknown key node', '/api/docs/demo/tree?node=primary', badQuery('unknown', 'node')],
    ['file: an unknown key size', fileUrl(`${COMMITTED_Q}&size=1`), badQuery('unknown', 'size')],
    ['file: an unknown key maxBytes', fileUrl(`${COMMITTED_Q}&maxBytes=1`), badQuery('unknown', 'maxBytes')],
    ['projects: any key', '/api/docs/projects?x=1', badQuery('unknown', 'x')],
    ['tree: __proto__ is an own key, so an unknown one', '/api/docs/demo/tree?__proto__=x', badQuery('unknown', '__proto__')],
    ['tree: constructor', '/api/docs/demo/tree?constructor=x', badQuery('unknown', 'constructor')],
    ['tree: a repeated ref', '/api/docs/demo/tree?ref=a&ref=b', badQuery('repeated', 'ref')],
    ['file: a repeated path', fileUrl(`${COMMITTED_Q}&path=b.md`), badQuery('repeated', 'path')],
    ['file: a mixed pin', fileUrl(`${COMMITTED_Q}&branch=main`), badQuery('pin-shape')],
    ['file: an incomplete pin', fileUrl(`commit=${FIXTURE_COMMIT}&section=specs&path=a.md`), badQuery('pin-shape')],
    ['tree: ?ref with no =', '/api/docs/demo/tree?ref', word('bad-ref')],
    ['tree: ?ref=%ZZ', '/api/docs/demo/tree?ref=%ZZ', word('bad-ref')],
    ['tree: ?ref=a;b=c', '/api/docs/demo/tree?ref=a;b=c', word('bad-ref')],
    ['file: a commit that is not one', fileUrl(COMMITTED_Q.replace(FIXTURE_COMMIT, 'x')), word('bad-commit')],
    ['file: a bare servedRef', fileUrl(COMMITTED_Q.replace(enc(FIXTURE_SERVED), 'main')), word('bad-ref')],
    ['file: an unknown section', fileUrl(COMMITTED_Q.replace('section=specs', 'section=nope')), word('bad-section')],
    ['file: an absolute path', fileUrl(COMMITTED_Q.replace('path=a.md', 'path=%2Fa.md')), word('bad-path')],
    ['file: a fingerprint that is not one', fileUrl(DRAFT_Q.replace(FP, 'x')), word('bad-fingerprint')],
    ['tree: :project a%2Fb', '/api/docs/a%2Fb/tree', word('bad-project')],
    ['tree: :project %00', '/api/docs/%00/tree', word('bad-project')],
    ['tree: :project -x', '/api/docs/-x/tree', word('bad-project')],
    ['file: :project .hidden', `/api/docs/.hidden/file?${COMMITTED_Q}`, word('bad-project')],
  ];

  it.each(REFUSED)('%s', async (_label, url, body) => {
    const rec = scripted(() => okRes(line(treeOk())));
    const { app } = await open({ run: rec.run });
    const res = await app.inject({ url, headers: PWA_HEADERS });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(body);
    expect(res.headers['cache-control']).toBe('no-store');
    for (const name of DOCS_HEADER_NAMES) expect(res.headers[name], name).toBe(DOCS_RESPONSE_HEADERS[name as keyof typeof DOCS_RESPONSE_HEADERS]);
    expect(rec.calls).toEqual([]);
  });

  it('refinement (d): a 101-character :project is the router\'s 414 and a malformed path escape its 400, before any hook (no docs header, zero execs); 100 characters reach the route', async () => {
    const rec = scripted(() => faultRes());
    const { app } = await open({ run: rec.run });
    const ROUTER: readonly (readonly [string, number, string])[] = [
      [`/api/docs/${'a'.repeat(101)}/tree`, 414, 'FST_ERR_MAX_PARAM_LENGTH'],
      ['/api/docs/%ZZ/tree', 400, 'FST_ERR_BAD_URL'],
    ];
    for (const [url, status, code] of ROUTER) {
      const res = await app.inject({ url, headers: PWA_HEADERS });
      expect(res.statusCode, url).toBe(status);
      expect(res.json().code, url).toBe(code);
      for (const name of DOCS_HEADER_NAMES) expect(res.headers[name], `${url} ${name}`).toBeUndefined();
    }
    expect(rec.calls).toEqual([]);
    const longest = await app.inject({ url: `/api/docs/${'a'.repeat(100)}/tree`, headers: PWA_HEADERS });
    expect(longest.statusCode).toBe(502);
    expect(rec.calls).toEqual([['docs-tree', '--project', 'a'.repeat(100)]]);
  });

  it('a dot-dot :project is resolved away by the URL before routing: no docs route, zero execs', async () => {
    const rec = scripted(() => faultRes());
    const { app } = await open({ run: rec.run });
    for (const url of ['/api/docs/../tree', '/api/docs/%2E%2E/tree']) {
      expect((await app.inject({ url, headers: PWA_HEADERS })).statusCode, url).toBe(404);
    }
    expect(rec.calls).toEqual([]);
  });

  it.each(['/api/docs/projects', '/api/docs/demo/tree', fileUrl(COMMITTED_Q)])(
    'refinement (c): HEAD %s matches no docs route: 404, zero execs', async (url) => {
      const rec = scripted(() => okRes(line(indexOk())));
      const { app } = await open({ run: rec.run });
      const res = await app.inject({ method: 'HEAD', url, headers: PWA_HEADERS });
      expect(res.statusCode).toBe(404);
      expect(rec.calls).toEqual([]);
    });
});

describe('the query reaches L1 as Fastify\'s real parser decodes it (W2 review carry)', () => {
  /** `docs-policy.test.ts`'s decoder, copied verbatim: W2's L1 cases ran through this, not through Fastify. */
  function form(search: string): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(search)) {
      const had = Object.hasOwn(out, key) ? out[key] : undefined;
      out[key] = had === undefined ? value : Array.isArray(had) ? [...had, value] : [had, value];
    }
    return out;
  }

  const CORPUS: readonly string[] = [
    'ref', 'ref=', 'ref=a;b=c', 'ref=%ZZ', 'a[b]=1', '=2', 'ref=a+b', 'ref=a%2Bb', '__proto__=x', 'constructor=x',
    'ref=a&ref=b', 'x=1&x', 'ref=%E0%A4%A', 'ref=%C3%A9', 'ref=ws%2Fa', 'ref=main#frag',
  ];

  /** What Fastify's default parser hands a route for `?search`, as own entries (so `__proto__` stays a key). */
  async function fastifyDecode(search: string): Promise<Record<string, unknown>> {
    const probe = Fastify({ logger: false });
    apps.push(probe);
    probe.get('/probe', async (req) => Object.entries(req.query as Record<string, unknown>));
    return Object.fromEntries((await probe.inject({ url: `/probe?${search}` })).json() as [string, unknown][]);
  }

  it('Fastify and form() differ on exactly three: __proto__ (an own key, against form\'s prototype write), a malformed UTF-8 escape (kept, against U+FFFD) and a fragment (never sent)', async () => {
    const differ: string[] = [];
    for (const s of CORPUS) {
      const fastify = Object.entries(await fastifyDecode(s));
      if (JSON.stringify(fastify) !== JSON.stringify(Object.entries(form(s)))) differ.push(s);
    }
    expect(differ).toEqual(['__proto__=x', 'ref=%E0%A4%A', 'ref=main#frag']);
  });

  it.each(CORPUS)('the tree route\'s answer to ?%s is L1\'s verdict over Fastify\'s decode', async (s) => {
    const verdict = parseDocsApiQuery('tree', await fastifyDecode(s));
    const rec = scripted(() => okRes(line(treeOk())));
    const { app } = await open({ run: rec.run });
    const res = await app.inject({ url: `/api/docs/demo/tree?${s}`, headers: PWA_HEADERS });
    if (verdict.ok) {
      expect(res.statusCode).toBe(200);
      expect(rec.calls).toHaveLength(1);
    } else {
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(verdict);
      expect(rec.calls).toEqual([]);
    }
  });
});

describe('answers, ccd failures and the gate (section 3.4, section 3.5)', () => {
  it('projects: 200 {ok, index, cacheAgeMs: null}; within DOCS_INDEX_CACHE_MS a hit with zero execs and its age; at the bound, ccd again', async () => {
    let now = 1000;
    const rec = scripted(() => okRes(line(indexOk())));
    const { app } = await open({ run: rec.run, nowMs: () => now });
    const first = await app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, index: indexOk(), cacheAgeMs: null });
    expect(rec.calls).toEqual([['docs-index', '--all']]);
    now += 7;
    const second = await app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    expect(second.json()).toEqual({ ok: true, index: indexOk(), cacheAgeMs: 7 });
    expect(rec.calls).toHaveLength(1);
    now = 1000 + DOCS_INDEX_CACHE_MS;
    const third = await app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    expect(third.json()).toEqual({ ok: true, index: indexOk(), cacheAgeMs: null });
    expect(rec.calls).toHaveLength(2);
  });

  it('tree: 200 {ok, tree, refreshDue} with L1\'s refreshDue over the same tree, due and not due; the default view sends no --ref', async () => {
    const due = treeOk();
    const notDue = treeOk({
      freshness: {
        remote: 'origin', trackedRef: FIXTURE_SERVED, fetchHead: null,
        stamp: { okAgeMs: 0, attemptAgeMs: 0, lastOutcome: 'ok', okCommit: FIXTURE_COMMIT },
      },
    });
    expect([refreshDue(due), refreshDue(notDue)]).toEqual([true, false]);
    let next = due;
    const rec = scripted(() => okRes(line(next)));
    const { app } = await open({ run: rec.run });
    const a = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ ok: true, tree: due, refreshDue: true });
    next = notDue;
    const b = await app.inject({ url: '/api/docs/demo/tree?ref=ws%2Fa', headers: PWA_HEADERS });
    expect(b.json()).toEqual({ ok: true, tree: notDue, refreshDue: false });
    expect(rec.calls).toEqual([['docs-tree', '--project', 'demo'], ['docs-tree', '--project', 'demo', '--ref', 'ws/a']]);
  });

  const FAILED: readonly (readonly [string, Record<string, unknown>, number])[] = [
    ['ref-locked with lockAgeMs null', { failure: 'ref-locked', lockAgeMs: null }, 409],
    ['ref-locked with lockAgeMs ABSENT', { failure: 'ref-locked' }, 409],
    ['unresolved-ref with tried', {
      failure: 'unresolved-ref', ref: 'ws/x',
      tried: [{ ref: 'refs/remotes/origin/ws/x', result: 'absent' }, { ref: 'refs/heads/ws/x', result: 'absent' }],
    }, 404],
  ];

  it.each(FAILED)('a ccd failure line (%s) answers its status and the adapter\'s body verbatim, absent staying absent', async (_l, ctx, status) => {
    const rec = scripted(() => okRes(line({ v: 1, verb: 'docs-tree', ok: false, elapsedMs: 4, ...ctx })));
    const { app } = await open({ run: rec.run });
    const res = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toStrictEqual({ ok: false, ...ctx });
    expect(Object.hasOwn(res.json(), 'lockAgeMs')).toBe(Object.hasOwn(ctx, 'lockAgeMs'));
    expect(res.headers['retry-after']).toBeUndefined();
    expect(rec.calls).toHaveLength(1);
  });

  it('ccd-fault: 502 with the adapter\'s stderrHead', async () => {
    const rec = scripted(() => faultRes('boom'));
    const { app } = await open({ run: rec.run });
    const res = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'ccd-fault', stderrHead: 'boom' });
    expect(rec.calls).toHaveLength(1);
  });

  it('caps-unknown (ccdVerbs null): 503 Retry-After 5; unsupported: 501, no Retry-After; both with zero execs; the state mutated in place is read at the next call (W2 carry, the mutate half)', async () => {
    const rec = scripted(() => okRes(line(treeOk())));
    const { app, state } = await open({ run: rec.run, verbs: null });
    const unknown = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(unknown.statusCode).toBe(503);
    expect(unknown.headers['retry-after']).toBe('5');
    expect(unknown.json()).toStrictEqual(word('caps-unknown'));
    state.ccdVerbs = ['caps'];
    const unsupported = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(unsupported.statusCode).toBe(501);
    expect(unsupported.headers['retry-after']).toBeUndefined();
    expect(unsupported.json()).toStrictEqual(word('unsupported'));
    expect(rec.calls).toEqual([]);
    state.ccdVerbs = ['caps', DOCS_CAP];
    expect((await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS })).statusCode).toBe(200);
    expect(rec.calls).toHaveLength(1);
  });

  it('composeDocs builds the reader and the fetcher over the SAME source: a fleetState getter is read at every call (refinement (i))', async () => {
    let current: { ccdVerbs: string[] | null } = { ccdVerbs: null };
    const rec = scripted(() => okRes(line(indexOk())));
    const docs = composeDocs({ runCcd: rec.run, get fleetState() { return current; } });
    const node = docs.readers.primary;
    const reader = docs.readers.byNode.get(node);
    const fetcher = docs.fetchers.byNode.get(node);
    if (reader === undefined || fetcher === undefined) throw new Error('composeDocs: no primary reader or fetcher');
    expect(await reader.index({ node })).toStrictEqual(word('caps-unknown'));
    expect(await fetcher.fetch({ node, project: 'demo' }, null)).toStrictEqual(word('caps-unknown'));
    current = { ccdVerbs: ['caps', DOCS_CAP] };
    expect((await reader.index({ node })).ok).toBe(true);
    await fetcher.fetch({ node, project: 'demo' }, null);
    expect(rec.calls).toEqual([['docs-index', '--all'], ['docs-fetch', '--project', 'demo']]);
  });
});

describe('an ok answer the adapter passed is shape-checked before it is believed (refinement (f); W2 carry)', () => {
  it('a tree without freshness: 502 malformed-answer {why: schema}, never a 500, logged, and nothing recorded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { freshness: _dropped, ...noFreshness } = treeOk();
    const rec = scripted(() => okRes(line(noFreshness)));
    const { app, docs } = await open({ run: rec.run });
    const res = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
    expect(nodeLanes(docs).caches.listing.commits()).toBe(0);
    expect(warn).toHaveBeenCalledWith('ccrc-server: docs tree answer failed its shape check');
    expect(rec.calls).toHaveLength(1);
  });

  it('a tree carrying a 500 000-deep unknown key inside the listing bound: 502 schema, no RangeError at serialisation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const text = `${JSON.stringify(treeOk()).slice(0, -1)},"deep":${'['.repeat(500000)}${']'.repeat(500000)}}\n`;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LISTING_JOB.wire);
    const rec = scripted(() => okRes(text));
    const { app, docs } = await open({ run: rec.run });
    const res = await app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
    expect(nodeLanes(docs).caches.listing.commits()).toBe(0);
  });

  it('an index whose projects is not an array: 502 schema, and nothing enters the micro-cache', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = scripted(() => okRes(line({ ...indexOk(), projects: {} })));
    const { app } = await open({ run: rec.run });
    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
    }
    expect(rec.calls).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith('ccrc-server: docs index answer failed its shape check');
  });
});

describe('M6.2 at the routes — the read lane: two in flight, a strict queue, its wait, and a client that left', () => {
  /** Two tree GETs held in flight on distinct refs (two flights), with the runner's blocker. */
  async function twoHeld(): Promise<{
    app: FastifyInstance; docs: Awaited<ReturnType<typeof docsApp>>['docs']; rec: ReturnType<typeof scripted>;
    b: ReturnType<typeof blocker<CcdResult>>; held: Promise<unknown>[];
  }> {
    const b = blocker<CcdResult>();
    const rec = scripted(() => b.exec());
    const { app, docs } = await open({ run: rec.run });
    const held = ['a', 'b'].map((ref) => app.inject({ url: `/api/docs/demo/tree?ref=${ref}`, headers: PWA_HEADERS }));
    await until(() => rec.calls.length === 2, 'two tree execs');
    return { app, docs, rec, b, held };
  }

  it('the 33rd queued read answers docs-busy 503 Retry-After 2 with zero extra execs; a non-docs route is unaffected; closing answers every queued read busy', async () => {
    const { app, docs, rec, b, held } = await twoHeld();
    const lane = nodeLanes(docs).read;
    const queued = Array.from({ length: DOCS_LANE_QUEUE },
      (_, i) => app.inject({ url: committedAt(`f${i}.md`), headers: PWA_HEADERS }));
    await until(() => lane.load().queued === DOCS_LANE_QUEUE, 'a full queue');
    const busy = await app.inject({ url: committedAt('over.md'), headers: PWA_HEADERS });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('2');
    expect(busy.json()).toStrictEqual({ ok: false, failure: 'docs-busy', lane: 'read', retryAfterMs: 2000 });
    expect(rec.calls).toHaveLength(2);
    expect((await app.inject({ url: '/api/other' })).statusCode).toBe(200);
    await app.close();
    expect(lane.load().queued).toBe(0);
    expect((await Promise.all(queued)).map((r) => r.statusCode)).toEqual(Array(DOCS_LANE_QUEUE).fill(503));
    b.release(0, faultRes());
    b.release(1, faultRes());
    await Promise.all(held);
    expect(rec.calls).toHaveLength(2);
  });

  it('a read queued for DOCS_LANE_MAX_WAIT_MS answers docs-busy, and its show never runs', async () => {
    const { app, docs, rec, b, held } = await twoHeld();
    const lane = nodeLanes(docs).read;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const waiting = app.inject({ url: committedAt('f0.md'), headers: PWA_HEADERS });
    await until(() => lane.load().queued === 1, 'one queued read');
    vi.advanceTimersByTime(DOCS_LANE_MAX_WAIT_MS - 1);
    expect(lane.load().queued).toBe(1);
    vi.advanceTimersByTime(1);
    const res = await waiting;
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.json()).toStrictEqual({ ok: false, failure: 'docs-busy', lane: 'read', retryAfterMs: 2000 });
    b.release(0, faultRes());
    b.release(1, faultRes());
    await Promise.all(held);
    expect(rec.calls).toHaveLength(2);
  });

  it('refinement (j): a client that goes while its read is queued is dequeued over a real socket, and its show never runs', async () => {
    const { app, docs, rec, b, held } = await twoHeld();
    const lane = nodeLanes(docs).read;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const req = http.get({ host: '127.0.0.1', port, path: committedAt('f0.md'), headers: PWA_HEADERS });
    req.on('error', () => undefined);
    await until(() => lane.load().queued === 1, 'the socket\'s read queued');
    req.destroy();
    await until(() => lane.load().queued === 0, 'the read dequeued');
    b.release(0, faultRes());
    b.release(1, faultRes());
    await Promise.all(held);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rec.calls).toHaveLength(2);
  });

  it('refinement (j): a client that went before the handler ran starts no exec', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    const rec = scripted(() => okRes(line(treeOk())));
    const { app } = await open({
      run: rec.run,
      root: (root) => root.addHook('onRequest', async (req) => {
        if (req.headers['x-test-hold'] === undefined) return;
        entered += 1;
        await hold;
      }),
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const req = http.get({
      host: '127.0.0.1', port, path: '/api/docs/demo/tree', headers: { ...PWA_HEADERS, 'x-test-hold': '1' },
    });
    req.on('error', () => undefined);
    await until(() => entered === 1, 'the request held in the root hook');
    req.destroy();
    let connections = 1;
    await until(() => {
      app.server.getConnections((_e, n) => { connections = n; });
      return connections === 0;
    }, 'the server saw the client go');
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rec.calls).toEqual([]);
  });

  it('measured (refinement (j)): on a completed GET over a real socket the response closes finished, so an answered request never aborts its flight', async () => {
    const seen: string[] = [];
    const rec = scripted(() => okRes(line(treeOk())));
    const { app } = await open({
      run: rec.run,
      root: (root) => root.addHook('onRequest', async (req, reply) => {
        req.raw.once('close', () => seen.push(`request close, response finished ${reply.raw.writableFinished}`));
        reply.raw.once('close', () => seen.push(`response close, finished ${reply.raw.writableFinished}`));
      }),
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const status = await new Promise<number | undefined>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/docs/demo/tree', headers: PWA_HEADERS }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
    });
    expect(status).toBe(200);
    await until(() => seen.some((s) => s.startsWith('response close')), 'the response closed');
    expect(seen).toContain('response close, finished true');
    expect(rec.calls).toHaveLength(1);
  });
});
