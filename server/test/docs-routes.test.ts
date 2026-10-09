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
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { DOCS_CAP } from '../src/ccdargv.js';
import type { CcdResult } from '../src/lifecycle.js';
import { UNMEASURED } from '../src/exec.js';
import {
  composeDocs, registerDocsReadRoutes, type DocsComposition, type DocsNodeLanes, type DocsNodes,
} from '../src/docs/routes.js';
import type { DocsReader } from '../src/docs/ports.js';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  DOCS_FETCH_GLOBAL, DOCS_FETCH_QUEUE, DOCS_INDEX_CACHE_MS, DOCS_LANE_MAX_WAIT_MS, DOCS_LANE_QUEUE, DOCS_REF_PREFIXES,
  DOCS_REFUSAL_LOG_MS, LISTING_JOB, parseDocsApiQuery, refreshDue,
} from '../src/docs/policy.js';
import {
  DOCS_RESPONSE_HEADERS, docsApi, type DocPin, type DocsFailureBody, type DocsFailure, type DocsFetchOk,
} from '../../shared/docs.js';
import {
  FIXTURE_COMMIT, FIXTURE_SERVED, PWA_HEADERS, blocker, committedEntry, docsApp, faultRes, indexOk, line, nodeLanes,
  okRes, scripted, sha256Hex, showLine, treeOk, until,
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

// ===== Task 7: the refresh route (section 3.4's refresh flow, section 6.4; row 51, M6.9, M6.10) =====

/** A complete ok `docs-fetch` answer line's object (`DocsFetchOk`): the default branch moved; `over` replaces any
 *  field. The adapter checks a fetch line's envelope only, so the route answers exactly this object. */
function fetchOk(over: Partial<DocsFetchOk> = {}): DocsFetchOk {
  return {
    v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 6, branch: 'main', trackedRef: FIXTURE_SERVED,
    before: FIXTURE_COMMIT, after: 'b'.repeat(40), moved: 'updated', stamp: 'written', ...over,
  };
}

/** A ccd failure line of `verb` carrying `ctx` (its `failure` word and context keys). */
function failLine(verb: string, ctx: Record<string, unknown>): CcdResult {
  return okRes(line({ v: 1, verb, ok: false, elapsedMs: 4, ...ctx }));
}

type Answer = (argv: string[]) => CcdResult | Promise<CcdResult>;

/** The refresh URL of `demo`, for the real-socket case. */
const REFRESH_PATH = '/api/docs/demo/refresh';

/** A recording runner that answers `docs-fetch` with `fetch`, `docs-tree` with `tree` and `docs-index` with `index`
 *  (defaults: an ok fetch, the fixture tree, the fixture index); any other verb is a ccd fault. */
function fleet(o: { fetch?: Answer; tree?: Answer; index?: Answer } = {}): ReturnType<typeof scripted> {
  return scripted((argv) => {
    if (argv[0] === 'docs-fetch') return (o.fetch ?? (() => okRes(line(fetchOk()))))(argv);
    if (argv[0] === 'docs-tree') return (o.tree ?? (() => okRes(line(treeOk()))))(argv);
    if (argv[0] === 'docs-index') return (o.index ?? (() => okRes(line(indexOk()))))(argv);
    return faultRes();
  });
}

/** The argv a runner recorded for one verb. */
function verb(calls: string[][], name: string): string[][] {
  return calls.filter((argv) => argv[0] === name);
}

/** A refresh POST of `payload` (sent as written) with content type `type`, with the PWA's request headers. */
function postRaw(app: FastifyInstance, payload: string, type = 'application/json', project = 'demo') {
  return app.inject({
    method: 'POST', url: REFRESH_PATH.replace('/demo/', `/${project}/`), headers: { ...PWA_HEADERS, 'content-type': type },
    payload,
  });
}

/** A refresh POST of `{ref, reason}` as JSON. */
function refresh(app: FastifyInstance, ref: string | null, reason: 'auto' | 'manual' = 'auto', project = 'demo') {
  return postRaw(app, JSON.stringify({ ref, reason }), 'application/json', project);
}

describe('T7: a refresh body or :project that fails its parser is refused before any exec (section 3.4; refinement (e))', () => {
  const REFUSED: readonly (readonly [string, string, string, DocsFailureBody])[] = [
    ['a text/plain body', 'text/plain', 'hello', badQuery('body')],
    ['invalid JSON', 'application/json', '{"ref":', badQuery('body')],
    ['an empty JSON body', 'application/json', '', badQuery('body')],
    ['a JSON array [1]', 'application/json', '[1]', badQuery('body')],
    ['a JSON null', 'application/json', 'null', badQuery('body')],
    ['a JSON string', 'application/json', '"main"', badQuery('body')],
    ['reason missing', 'application/json', '{"ref":null}', badQuery('body', 'reason')],
    ['ref missing', 'application/json', '{"reason":"auto"}', badQuery('body', 'ref')],
    ['ref a number', 'application/json', '{"ref":1,"reason":"auto"}', badQuery('body', 'ref')],
    ['reason neither auto nor manual', 'application/json', '{"ref":null,"reason":"later"}', badQuery('body', 'reason')],
    ['an unknown key x', 'application/json', '{"ref":null,"reason":"auto","x":1}', badQuery('unknown', 'x')],
    ['a ref in neither grammar', 'application/json', '{"ref":"a..b","reason":"auto"}', word('bad-ref')],
    ['a body of 1 MiB + 1', 'application/json', `{"ref":"${'x'.repeat(1048577)}","reason":"auto"}`, badQuery('body')],
    ['a form-encoded body', 'application/x-www-form-urlencoded', 'ref=main&reason=auto', badQuery('body')],
  ];

  it.each(REFUSED)('%s', async (_label, type, payload, body) => {
    const rec = fleet();
    const { app } = await open({ run: rec.run });
    const res = await postRaw(app, payload, type);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(body);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['retry-after']).toBeUndefined();
    expect(rec.calls).toEqual([]);
  });

  it(':project -x with a valid body: bad-project, zero execs', async () => {
    const rec = fleet();
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, null, 'auto', '-x');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toStrictEqual(word('bad-project'));
    expect(rec.calls).toEqual([]);
  });
});

describe('T7: fetchBranchFor maps the request onto one docs-fetch, then a docs-tree of the requested ref (section 3.4)', () => {
  it('ref null: one docs-fetch with no --branch, then one docs-tree with no --ref; 200 {ok, fetch: ran, tree}', async () => {
    const rec = fleet();
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      ok: true, fetch: { state: 'ran', answer: fetchOk() }, tree: { ok: true, tree: treeOk(), refreshDue: true },
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['retry-after']).toBeUndefined();
    expect(rec.calls).toEqual([['docs-fetch', '--project', 'demo'], ['docs-tree', '--project', 'demo']]);
  });

  it.each([
    ['bare ws/a', 'ws/a'],
    ['origin-qualified ws/a', `${DOCS_REF_PREFIXES[1]}ws/a`],
  ])('%s: docs-fetch --branch ws/a, then docs-tree --ref as requested', async (_label, ref) => {
    const rec = fleet();
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, ref);
    expect(res.statusCode).toBe(200);
    expect(res.json().fetch).toStrictEqual({ state: 'ran', answer: fetchOk() });
    expect(rec.calls).toEqual([
      ['docs-fetch', '--project', 'demo', '--branch', 'ws/a'], ['docs-tree', '--project', 'demo', '--ref', ref],
    ]);
  });

  it('local-qualified ws/a: ZERO docs-fetch, fetch {state: skipped, why: local-ref}, and the tree still runs: 200', async () => {
    const rec = fleet();
    const { app } = await open({ run: rec.run });
    const ref = `${DOCS_REF_PREFIXES[0]}ws/a`;
    const res = await refresh(app, ref, 'manual');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      ok: true, fetch: { state: 'skipped', why: 'local-ref' }, tree: { ok: true, tree: treeOk(), refreshDue: true },
    });
    expect(rec.calls).toEqual([['docs-tree', '--project', 'demo', '--ref', ref]]);
  });
});

describe('T7: each half carries its own word; a refusal before any exec is the whole answer (section 3.4; refinement (m))', () => {
  const FAILED_FETCH: readonly (readonly [string, Record<string, unknown>])[] = [
    ['fetch-too-soon {retryAfterMs: 9000}', { failure: 'fetch-too-soon', retryAfterMs: 9000 }],
    ['remote-branch-absent', { failure: 'remote-branch-absent' }],
    ['ref-locked with lockAgeMs ABSENT', { failure: 'ref-locked' }],
  ];

  it.each(FAILED_FETCH)('a failed fetch (%s): 200, fetch {state: failed, failure: the body verbatim}, no Retry-After, and the tree half still answers', async (_label, ctx) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = fleet({ fetch: () => failLine('docs-fetch', ctx) });
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      ok: true, fetch: { state: 'failed', failure: { ok: false, ...ctx } }, tree: { ok: true, tree: treeOk(), refreshDue: true },
    });
    expect(Object.hasOwn(res.json().fetch.failure, 'lockAgeMs')).toBe(false);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(verb(rec.calls, 'docs-tree')).toHaveLength(1);
  });

  it('a failed tree half (unresolved-ref): 200 with tree: its body verbatim, and the fetch half ran', async () => {
    const ctx = { failure: 'unresolved-ref', ref: 'ws/x', tried: [{ ref: 'refs/remotes/origin/ws/x', result: 'absent' }] };
    const rec = fleet({ tree: () => failLine('docs-tree', ctx) });
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, 'ws/x');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true, fetch: { state: 'ran', answer: fetchOk() }, tree: { ok: false, ...ctx } });
  });

  it('a fetch answer nested past DOCS_ANSWER_MAX_DEPTH: the fetch half is failed malformed-answer {why: schema}, never a 500, and the tree half answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const text = `${JSON.stringify(fetchOk()).slice(0, -1)},"deep":${'['.repeat(500000)}${']'.repeat(500000)}}\n`;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LISTING_JOB.wire);
    const rec = fleet({ fetch: () => okRes(text) });
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      ok: true, fetch: { state: 'failed', failure: { ok: false, failure: 'malformed-answer', why: 'schema' } },
      tree: { ok: true, tree: treeOk(), refreshDue: true },
    });
    expect(warn).toHaveBeenCalledWith('ccrc-server: docs fetch answer failed its shape check');
  });

  it('caps-unknown (ccdVerbs null): 503 Retry-After 5, the WHOLE body caps-unknown, zero execs; unsupported: 501, no Retry-After, zero execs', async () => {
    const rec = fleet();
    const { app, state } = await open({ run: rec.run, verbs: null });
    const unknown = await refresh(app, null);
    expect(unknown.statusCode).toBe(503);
    expect(unknown.headers['retry-after']).toBe('5');
    expect(unknown.json()).toStrictEqual(word('caps-unknown'));
    state.ccdVerbs = ['caps'];
    const unsupported = await refresh(app, 'ws/a');
    expect(unsupported.statusCode).toBe(501);
    expect(unsupported.headers['retry-after']).toBeUndefined();
    expect(unsupported.json()).toStrictEqual(word('unsupported'));
    expect(rec.calls).toEqual([]);
  });

  it('a local ref (no fetch exec) whose tree half the gate refuses: the WHOLE answer is that word, 503 Retry-After 5 or 501, zero execs', async () => {
    const rec = fleet();
    const { app, state } = await open({ run: rec.run, verbs: null });
    const ref = `${DOCS_REF_PREFIXES[0]}ws/a`;
    const unknown = await refresh(app, ref);
    expect(unknown.statusCode).toBe(503);
    expect(unknown.headers['retry-after']).toBe('5');
    expect(unknown.json()).toStrictEqual(word('caps-unknown'));
    state.ccdVerbs = ['caps'];
    const unsupported = await refresh(app, ref, 'manual');
    expect(unsupported.statusCode).toBe(501);
    expect(unsupported.headers['retry-after']).toBeUndefined();
    expect(unsupported.json()).toStrictEqual(word('unsupported'));
    expect(rec.calls).toEqual([]);
  });

  it('a tree half the full read lane refuses rides the 200 as its body, docs-busy {lane: read}, with no Retry-After header', async () => {
    const b = blocker<CcdResult>();
    const rec = fleet({ tree: () => b.exec() });
    const { app, docs } = await open({ run: rec.run });
    const lane = nodeLanes(docs).read;
    const held = ['a', 'b'].map((ref) => app.inject({ url: `/api/docs/demo/tree?ref=${ref}`, headers: PWA_HEADERS }));
    await until(() => b.started() === 2, 'two tree execs');
    const queued = Array.from({ length: DOCS_LANE_QUEUE },
      (_, i) => app.inject({ url: committedAt(`f${i}.md`), headers: PWA_HEADERS }));
    await until(() => lane.load().queued === DOCS_LANE_QUEUE, 'a full queue');
    const res = await refresh(app, null);
    expect(res.statusCode).toBe(200);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.json()).toStrictEqual({
      ok: true, fetch: { state: 'ran', answer: fetchOk() },
      tree: { ok: false, failure: 'docs-busy', lane: 'read', retryAfterMs: 2000 },
    });
    expect(verb(rec.calls, 'docs-tree')).toHaveLength(2);
    await app.close();
    await Promise.all(queued);
    b.release(0, faultRes());
    b.release(1, faultRes());
    await Promise.all(held);
  });

  it('a failed refresh logs one line per word a minute, naming its reason; reason changes nothing else in the response', async () => {
    let now = 1000;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = fleet({ fetch: () => failLine('docs-fetch', { failure: 'fetch-too-soon', retryAfterMs: 9000 }) });
    const { app } = await open({ run: rec.run, nowMs: () => now });
    const logged = (): unknown[] => warn.mock.calls.map((c) => c[0]).filter((m) => String(m).includes('refresh of'));
    const auto = await refresh(app, null, 'auto');
    expect(logged()).toEqual(['ccrc-server: docs auto refresh of demo failed: fetch-too-soon']);
    now += DOCS_REFUSAL_LOG_MS - 1;
    const manual = await refresh(app, null, 'manual');
    expect(logged()).toHaveLength(1);
    expect(manual.statusCode).toBe(auto.statusCode);
    expect(manual.json()).toStrictEqual(auto.json());
    now += 1;
    await refresh(app, null, 'manual');
    expect(logged()).toEqual([
      'ccrc-server: docs auto refresh of demo failed: fetch-too-soon',
      'ccrc-server: docs manual refresh of demo failed: fetch-too-soon',
    ]);
  });
});

describe('T7: row 51 and M6.9 — single-flight, and a refresh\'s tree never joins a flight begun before its fetch', () => {
  it('row 51: two concurrent refreshes of one (project, branch) make exactly ONE docs-fetch and share one tree; both 200 with the same halves', async () => {
    const f = blocker<CcdResult>();
    const rec = fleet({ fetch: () => f.exec() });
    const { app, docs } = await open({ run: rec.run });
    const two = [refresh(app, 'ws/a', 'auto'), refresh(app, 'ws/a', 'manual')];
    await until(() => f.started() === 1, 'one fetch exec');
    await until(() => nodeLanes(docs).flights.size() === 1, 'one refresh flight');
    f.release(0, okRes(line(fetchOk({ branch: 'ws/a' }))));
    const [a, b] = await Promise.all(two);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json()).toStrictEqual(b.json());
    expect(a.json().fetch).toStrictEqual({ state: 'ran', answer: fetchOk({ branch: 'ws/a' }) });
    expect(verb(rec.calls, 'docs-fetch')).toEqual([['docs-fetch', '--project', 'demo', '--branch', 'ws/a']]);
    expect(verb(rec.calls, 'docs-tree')).toHaveLength(1);
  });

  it('row 51: at most 2 reads in flight under refresh load: the tree halves ride the read lane', async () => {
    const t = blocker<CcdResult>();
    const rec = fleet({ tree: () => t.exec() });
    const { app, docs } = await open({ run: rec.run });
    const lane = nodeLanes(docs).read;
    const three = ['demo', 'a', 'b'].map((project) => refresh(app, null, 'auto', project));
    await until(() => lane.load().queued === 1, 'the third tree half queued');
    expect(lane.load().execs).toBe(2);
    expect(verb(rec.calls, 'docs-fetch')).toHaveLength(3);
    expect(t.started()).toBe(2);
    t.release(0, okRes(line(treeOk())));
    await until(() => t.started() === 3, 'the third tree half started');
    t.release(1, okRes(line(treeOk())));
    t.release(2, okRes(line(treeOk())));
    expect((await Promise.all(three)).map((r) => r.statusCode)).toEqual([200, 200, 200]);
  });

  it('M6.9: two concurrent tree GETs for one (project, ref): one exec, two equal answers', async () => {
    const t = blocker<CcdResult>();
    const rec = fleet({ tree: () => t.exec() });
    const { app } = await open({ run: rec.run });
    const two = [0, 1].map(() => app.inject({ url: '/api/docs/demo/tree?ref=ws%2Fa', headers: PWA_HEADERS }));
    await until(() => t.started() === 1, 'one tree exec');
    await new Promise((resolve) => setTimeout(resolve, 20));
    t.release(0, okRes(line(treeOk())));
    const [a, b] = await Promise.all(two);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json()).toStrictEqual(b.json());
    expect(rec.calls).toEqual([['docs-tree', '--project', 'demo', '--ref', 'ws/a']]);
  });

  it('M6.9: two concurrent file GETs for one pin: one docs-show exec', async () => {
    const s = blocker<CcdResult>();
    const rec = scripted(() => s.exec());
    const { app } = await open({ run: rec.run });
    const two = [0, 1].map(() => app.inject({ url: fileUrl(COMMITTED_Q), headers: PWA_HEADERS }));
    await until(() => s.started() === 1, 'one show exec');
    await new Promise((resolve) => setTimeout(resolve, 20));
    s.release(0, faultRes('boom'));
    expect((await Promise.all(two)).map((r) => r.statusCode)).toEqual([502, 502]);
    expect(rec.calls).toHaveLength(1);
  });

  it('M6.9: a refresh\'s tree half is a SECOND docs-tree, never the tree GET in flight before its fetch; a tree GET after the bump joins the refresh\'s tree', async () => {
    const t = blocker<CcdResult>();
    const rec = fleet({ tree: () => t.exec() });
    const { app } = await open({ run: rec.run });
    const before = app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    await until(() => t.started() === 1, 'the tree GET in flight');
    const refreshed = refresh(app, null);
    await until(() => t.started() === 2, 'the refresh\'s own tree exec');
    const after = app.inject({ url: '/api/docs/demo/tree', headers: PWA_HEADERS });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.started()).toBe(2);
    t.release(1, okRes(line(treeOk({ elapsedMs: 2 }))));
    t.release(0, okRes(line(treeOk({ elapsedMs: 1 }))));
    const [b, r, a] = await Promise.all([before, refreshed, after]);
    expect(b.json().tree.elapsedMs).toBe(1);
    expect(r.json().tree.tree.elapsedMs).toBe(2);
    expect(a.json().tree.elapsedMs).toBe(2);
    expect(rec.calls).toEqual([
      ['docs-tree', '--project', 'demo'], ['docs-fetch', '--project', 'demo'], ['docs-tree', '--project', 'demo'],
    ]);
  });
  it('M6.9: a skipped fetch (a local ref) bumps the generation too: its tree half is a second docs-tree, never the GET in flight', async () => {
    const t = blocker<CcdResult>();
    const rec = fleet({ tree: () => t.exec() });
    const { app } = await open({ run: rec.run });
    const ref = `${DOCS_REF_PREFIXES[0]}ws/a`;
    const before = app.inject({ url: `/api/docs/demo/tree?ref=${enc(ref)}`, headers: PWA_HEADERS });
    await until(() => t.started() === 1, 'the tree GET in flight');
    const refreshed = refresh(app, ref);
    await until(() => t.started() === 2, 'the refresh\'s own tree exec');
    t.release(0, okRes(line(treeOk())));
    t.release(1, okRes(line(treeOk())));
    const [b, r] = await Promise.all([before, refreshed]);
    expect([b.statusCode, r.statusCode]).toEqual([200, 200]);
    expect(r.json().fetch).toStrictEqual({ state: 'skipped', why: 'local-ref' });
    expect(verb(rec.calls, 'docs-fetch')).toEqual([]);
    expect(verb(rec.calls, 'docs-tree')).toHaveLength(2);
  });
});

describe('T7: M6.10 — the fetch lane at the route: serial per project, 2 globally, 8 queued, then docs-busy {lane: fetch}', () => {
  it('two refreshes of one project on different branches fetch one after the other', async () => {
    const f = blocker<CcdResult>();
    const rec = fleet({ fetch: () => f.exec() });
    const { app, docs } = await open({ run: rec.run });
    const lane = nodeLanes(docs).fetch;
    const two = [refresh(app, null), refresh(app, 'ws/a')];
    await until(() => lane.load().queued === 1, 'the second fetch queued behind its project');
    expect(lane.load().running).toBe(1);
    expect(verb(rec.calls, 'docs-fetch')).toEqual([['docs-fetch', '--project', 'demo']]);
    f.release(0, okRes(line(fetchOk())));
    await until(() => f.started() === 2, 'the second fetch started');
    expect(verb(rec.calls, 'docs-fetch')[1]).toEqual(['docs-fetch', '--project', 'demo', '--branch', 'ws/a']);
    f.release(1, okRes(line(fetchOk({ branch: 'ws/a' }))));
    expect((await Promise.all(two)).map((r) => r.statusCode)).toEqual([200, 200]);
  });

  it(`three projects: ${DOCS_FETCH_GLOBAL} fetch at once and the third waits for a global slot`, async () => {
    const f = blocker<CcdResult>();
    const rec = fleet({ fetch: () => f.exec() });
    const { app, docs } = await open({ run: rec.run });
    const lane = nodeLanes(docs).fetch;
    const three = ['demo', 'a', 'b'].map((project) => refresh(app, null, 'auto', project));
    await until(() => lane.load().queued === 1, 'the third fetch queued');
    expect(lane.load().running).toBe(DOCS_FETCH_GLOBAL);
    expect(f.started()).toBe(DOCS_FETCH_GLOBAL);
    f.release(0, okRes(line(fetchOk())));
    await until(() => f.started() === 3, 'the third fetch started');
    f.release(1, okRes(line(fetchOk())));
    f.release(2, okRes(line(fetchOk())));
    expect((await Promise.all(three)).map((r) => r.statusCode)).toEqual([200, 200, 200]);
  });

  it(`${DOCS_FETCH_GLOBAL} running and ${DOCS_FETCH_QUEUE} queued: the next refresh is 503 docs-busy {lane: fetch} Retry-After 5 with no new exec, and a read is still served`, async () => {
    const f = blocker<CcdResult>();
    // The tree answers the project it was asked (argv[2]): the routes refuse a tree naming another one.
    const rec = fleet({ fetch: () => f.exec(), tree: (argv) => okRes(line(treeOk({ project: argv[2] }))) });
    const { app, docs } = await open({ run: rec.run });
    const lane = nodeLanes(docs).fetch;
    const running = ['demo', 'a'].map((project) => refresh(app, null, 'auto', project));
    await until(() => f.started() === DOCS_FETCH_GLOBAL, 'two fetches running');
    const queued = Array.from({ length: DOCS_FETCH_QUEUE }, (_, i) => refresh(app, `ws/q${i}`));
    await until(() => lane.load().queued === DOCS_FETCH_QUEUE, 'a full fetch queue');
    const busy = await refresh(app, 'ws/next');
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('5');
    expect(busy.json()).toStrictEqual({ ok: false, failure: 'docs-busy', lane: 'fetch', retryAfterMs: 5000 });
    expect(verb(rec.calls, 'docs-fetch')).toHaveLength(DOCS_FETCH_GLOBAL);
    const read = await app.inject({ url: '/api/docs/b/tree', headers: PWA_HEADERS });
    expect(read.statusCode).toBe(200);
    expect(verb(rec.calls, 'docs-tree')).toEqual([['docs-tree', '--project', 'b']]);
    await app.close();
    expect((await Promise.all(queued)).map((r) => r.statusCode)).toEqual(Array(DOCS_FETCH_QUEUE).fill(503));
    f.release(0, okRes(line(fetchOk())));
    f.release(1, okRes(line(fetchOk())));
    await Promise.all(running);
    expect(verb(rec.calls, 'docs-fetch')).toHaveLength(DOCS_FETCH_GLOBAL);
  });

  it('refinement (j): a refresh whose client goes while its fetch is queued is dequeued over a real socket and never fetches', async () => {
    const f = blocker<CcdResult>();
    const rec = fleet({ fetch: () => f.exec() });
    const { app, docs } = await open({ run: rec.run });
    const lane = nodeLanes(docs).fetch;
    const first = refresh(app, null);
    await until(() => f.started() === 1, 'the first fetch running');
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: REFRESH_PATH,
      headers: { ...PWA_HEADERS, 'content-type': 'application/json' },
    });
    req.on('error', () => undefined);
    req.end(JSON.stringify({ ref: 'ws/a', reason: 'auto' }));
    await until(() => lane.load().queued === 1, 'the socket\'s fetch queued');
    req.destroy();
    await until(() => lane.load().queued === 0, 'the fetch dequeued');
    f.release(0, okRes(line(fetchOk())));
    expect((await first).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(verb(rec.calls, 'docs-fetch')).toEqual([['docs-fetch', '--project', 'demo']]);
  });
});

describe('T7: a project named like an Object.prototype key is an ordinary project to every map (W2 review: L0 admits __proto__)', () => {
  it.each(['__proto__', 'constructor'])('%s: its tree, a committed file from ccd then from the cache, and a refresh', async (project) => {
    const blob = 'b'.repeat(40);
    const bytes = Buffer.from('# a', 'utf8');
    const pin = {
      kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path: 'a.md',
    } as const;
    const rec = scripted((argv) => {
      if (argv[0] === 'docs-tree') {
        return okRes(line(treeOk({ project, entries: [committedEntry('a.md', blob, bytes.byteLength)] })));
      }
      if (argv[0] === 'docs-show') return okRes(showLine(pin, bytes, { blob }));
      if (argv[0] === 'docs-fetch') return okRes(line(fetchOk()));
      return faultRes();
    });
    const { app } = await open({ run: rec.run });
    const file = `/api/docs/${project}/file?${COMMITTED_Q}`;
    expect((await app.inject({ url: `/api/docs/${project}/tree`, headers: PWA_HEADERS })).statusCode).toBe(200);
    expect((await app.inject({ url: file, headers: PWA_HEADERS })).json()).toMatchObject({ ok: true, from: 'ccd' });
    expect((await app.inject({ url: file, headers: PWA_HEADERS })).json()).toMatchObject({ ok: true, from: 'cache' });
    const res = await refresh(app, null, 'auto', project);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, fetch: { state: 'ran' }, tree: { ok: true } });
    expect(rec.calls.map((argv) => argv.slice(0, 3))).toEqual([
      ['docs-tree', '--project', project], ['docs-show', '--project', project], ['docs-fetch', '--project', project],
      ['docs-tree', '--project', project],
    ]);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});

describe("T7: an agent that grants no docs verb: every route carries the adapter's not-granted (W2 review: its gate row ran on tree only)", () => {
  /** The agent's refusal of an argv its whitelist lacks, as the link carries it (both halves unmeasured): the word
   *  `docs-source.test.ts`'s `agentRefusalWord()` reads from `agent/src/server.ts`. */
  const refusal = (): CcdResult =>
    ({ ok: false, stdout: '', stderr: 'forbidden', killed: UNMEASURED, signal: UNMEASURED });

  it.each([
    ['projects', '/api/docs/projects'],
    ['tree', '/api/docs/demo/tree'],
    ['a committed file', fileUrl(COMMITTED_Q)],
    ['a draft file', fileUrl(DRAFT_Q)],
  ])('%s: 501 not-granted, the body verbatim, no Retry-After, after exactly one exec', async (_what, url) => {
    const rec = scripted(() => refusal());
    const { app } = await open({ run: rec.run });
    const res = await app.inject({ url, headers: PWA_HEADERS });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toStrictEqual(word('not-granted'));
    expect(res.headers['retry-after']).toBeUndefined();
    expect(rec.calls).toHaveLength(1);
  });

  it('the refresh: the agent refused an exec it was sent, not a pre-exec word, so both halves carry it in the 200', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = scripted(() => refusal());
    const { app } = await open({ run: rec.run });
    const res = await refresh(app, null);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      ok: true, fetch: { state: 'failed', failure: word('not-granted') }, tree: word('not-granted'),
    });
    expect(rec.calls.map((argv) => argv[0])).toEqual(['docs-fetch', 'docs-tree']);
  });
});

describe('T7: an index flight begun before a refresh\'s fetch neither answers a later GET nor fills the micro-cache (section 6.5: "dropped by any refresh")', () => {
  it('a projects GET issued after the refresh never joins the index flight begun before its fetch: a second docs-index', async () => {
    const ix = blocker<CcdResult>();
    const rec = fleet({ index: () => ix.exec() });
    const { app } = await open({ run: rec.run });
    const projects = () => app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    const before = projects();
    await until(() => ix.started() === 1, 'the index flight in flight');
    expect((await refresh(app, null)).statusCode).toBe(200);
    const after = projects();
    await until(() => ix.started() === 2, 'a second docs-index for the GET issued after the refresh', 2000);
    ix.release(1, okRes(line(indexOk({ unlisted: 2 }))));
    ix.release(0, okRes(line(indexOk({ unlisted: 1 }))));
    expect((await before).json().index.unlisted).toBe(1);
    expect((await after).json()).toMatchObject({ cacheAgeMs: null, index: { unlisted: 2 } });
    expect(verb(rec.calls, 'docs-index')).toHaveLength(2);
  });

  it('an index answered after the refresh settled is served to its own GET but never cached: the next GET execs again', async () => {
    const ix = blocker<CcdResult>();
    const rec = fleet({ index: () => ix.exec() });
    const { app } = await open({ run: rec.run });
    const projects = () => app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    const before = projects();
    await until(() => ix.started() === 1, 'the index flight in flight');
    expect((await refresh(app, null)).statusCode).toBe(200);
    ix.release(0, okRes(line(indexOk({ unlisted: 1 }))));
    expect((await before).json()).toMatchObject({ cacheAgeMs: null, index: { unlisted: 1 } });
    const next = projects();
    await until(() => ix.started() === 2, 'the next GET execs: the pre-fetch index was not cached', 2000);
    ix.release(1, okRes(line(indexOk({ unlisted: 2 }))));
    expect((await next).json()).toMatchObject({ cacheAgeMs: null, index: { unlisted: 2 } });
    const cached = (await projects()).json();
    expect(cached.cacheAgeMs).not.toBeNull();
    expect(cached.index.unlisted).toBe(2);
    expect(verb(rec.calls, 'docs-index')).toHaveLength(2);
  });
});

describe('T7: the index micro-cache is dropped by a refresh, when its fetch settles and again when it completes (section 6.4; refinement (m))', () => {
  it('projects GET (exec), projects GET (0 execs), refresh, projects GET (exec again)', async () => {
    const rec = fleet();
    const { app } = await open({ run: rec.run });
    const projects = () => app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    expect((await projects()).json().cacheAgeMs).toBeNull();
    expect((await projects()).json().cacheAgeMs).not.toBeNull();
    expect(verb(rec.calls, 'docs-index')).toHaveLength(1);
    expect((await refresh(app, null)).statusCode).toBe(200);
    expect((await projects()).json().cacheAgeMs).toBeNull();
    expect(verb(rec.calls, 'docs-index')).toHaveLength(2);
  });

  it('dropped when the fetch settles (an index GET during the tree half execs) and again when the refresh completes', async () => {
    const t = blocker<CcdResult>();
    const rec = fleet({ tree: () => t.exec() });
    const { app } = await open({ run: rec.run });
    const projects = () => app.inject({ url: '/api/docs/projects', headers: PWA_HEADERS });
    await projects();
    const refreshed = refresh(app, null);
    await until(() => t.started() === 1, 'the tree half in flight');
    expect((await projects()).json().cacheAgeMs).toBeNull();
    expect((await projects()).json().cacheAgeMs).not.toBeNull();
    expect(verb(rec.calls, 'docs-index')).toHaveLength(2);
    t.release(0, okRes(line(treeOk())));
    expect((await refreshed).statusCode).toBe(200);
    expect((await projects()).json().cacheAgeMs).toBeNull();
    expect(verb(rec.calls, 'docs-index')).toHaveLength(3);
  });
});

// ===== Task 9: the Docs API in the real server (section 2 (g)'s walls, section 2 (j) rows 49 and 50, M3.8; W3
// refinements (d) and (i)) =====
//
// These cases boot the REAL server (`buildServer` over `testDeps`), not `docsApp`: the gate, the plugin and the
// composition are the ones production registers. `testDeps` wraps the runner in `guardRunner`, so every docs argv
// these cases make is also checked against the agent's real exec whitelist. The runner records `[cmd, ...args]` and
// answers by ccd verb; `ccd()` is the recorded ccd argv, the spy section 2 (g)'s third wall names.

/** The passphrase and the fast scrypt parameters of an armed fixture (`update-routes.test.ts`'s pair). */
const REAL_PASSPHRASE = 'correct horse battery staple';
const REAL_FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
/** The four docs routes as `METHOD path` keys (section 3.4). */
const DOCS_KEYS = [
  'GET /api/docs/projects', 'GET /api/docs/:project/tree', 'GET /api/docs/:project/file',
  'POST /api/docs/:project/refresh',
] as const;
/** The bytes every fixture show answers, and the two pins the corpus reads them through, as `docsApi` writes them. */
const REAL_MD = new TextEncoder().encode('# a\n');
const REAL_COMMITTED: DocPin = {
  kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path: 'a.md',
};
const REAL_DRAFT: DocPin = {
  kind: 'draft', branch: 'ws/a', head: FIXTURE_COMMIT, section: 'specs', path: 'a.md', fp: sha256Hex(REAL_MD),
};

/** A handshaken fleet state carrying the docs cap: a NEW object each call, so a case can swap one in. */
function readyFleet(): FleetState {
  return { connected: true, downSince: null, ccdVerbs: ['caps', DOCS_CAP], rosterFp: null, build: null };
}

/** A measured, clean exit of the runner (`ExecResult`), so the adapter's check 1 reads both halves as measured. */
function realOk(stdout: string): ExecResult {
  return { code: 0, stdout, stderr: '', killed: false, signal: null };
}

/** The fixture fleet: ok answers for the four docs verbs (a show answers the pin its argv names); any other ccd argv
 *  exits 1 with nothing on stdout. */
function realAnswer(args: string[]): ExecResult {
  if (args[0] === 'docs-index') return realOk(line(indexOk()));
  if (args[0] === 'docs-tree') return realOk(line(treeOk()));
  if (args[0] === 'docs-show') return realOk(showLine(args.includes('--commit') ? REAL_COMMITTED : REAL_DRAFT, REAL_MD));
  if (args[0] === 'docs-fetch') return realOk(line(fetchOk()));
  return { code: 1, stdout: '', stderr: 'usage', killed: false, signal: null };
}

/**
 * The real server over a fixture HOME (never the live one): `testDeps` with a recording runner, `authEnabled` as
 * asked (armed: a passphrase is written first, and `cookieSecure` is off for inject), and NO `fleetState` (testDeps
 * builds none; each case sets the one it needs, AFTER `buildServer`, which is the point of the getter). Closed after
 * the case with the module's other apps.
 */
async function realServer(o: { auth?: boolean } = {}): Promise<{
  app: FastifyInstance; deps: Deps; ccd: () => string[][];
}> {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return realAnswer(args);
  };
  const home = mkTmp('ccrc-docs-w3-');
  const base = testDeps(home, run);
  if (o.auth) {
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(REAL_PASSPHRASE, REAL_FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: o.auth ?? false, cookieSecure: false } };
  const app = await buildServer(deps);
  await app.ready();
  apps.push(app);
  return { app, deps, ccd: () => calls.filter((c) => c[0] === deps.cfg.ccdBin).map((c) => c.slice(1)) };
}

/** A live session cookie for an armed `app`, minted through the real login route. */
async function realLogin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: REAL_PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : String(set);
  return first.slice(0, first.indexOf(';'));
}

/** One request per docs route, with no body and no header unless given: what a signed-out browser tab could send. */
function eachDocsRoute(app: FastifyInstance, headers: Record<string, string> = {}) {
  return [
    app.inject({ method: 'GET', url: docsApi.projects(), headers }),
    app.inject({ method: 'GET', url: docsApi.tree('demo', null), headers }),
    app.inject({ method: 'GET', url: docsApi.file('demo', REAL_COMMITTED), headers }),
    app.inject({ method: 'POST', url: docsApi.refresh('demo'), headers }),
  ];
}

describe('T9: the real server — the composition reads deps.fleetState through a getter (refinement (i); W2 carry)', () => {
  it('no fleet state: caps-unknown; a state SWAPPED in after buildServer is read; the same object mutated in place is read', async () => {
    const { app, deps, ccd } = await realServer();
    const tree = () => app.inject({ url: docsApi.tree('demo', null), headers: PWA_HEADERS });
    const none = await tree();
    expect(none.statusCode).toBe(503);
    expect(none.headers['retry-after']).toBe('5');
    expect(none.json()).toStrictEqual(word('caps-unknown'));
    const state = readyFleet();
    deps.fleetState = state;
    const swapped = await tree();
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json()).toEqual({ ok: true, tree: treeOk(), refreshDue: true });
    state.ccdVerbs = null;
    const mutated = await tree();
    expect(mutated.statusCode).toBe(503);
    expect(mutated.json()).toStrictEqual(word('caps-unknown'));
    expect(ccd()).toEqual([['docs-tree', '--project', 'demo']]);
  });
});

describe('T9: row 49 — GET never fetches, on the real server (section 2 (g), the third wall: the recorder)', () => {
  const [LOCAL_PREFIX, ORIGIN_PREFIX] = DOCS_REF_PREFIXES;
  /** Every GET shape: the index; the tree with no ref, a bare ref, an origin-qualified and a local-qualified one;
   *  the file under a committed and a draft pin; and each route with a refused query. */
  const GETS: readonly (readonly [string, number])[] = [
    [docsApi.projects(), 200],
    [docsApi.tree('demo', null), 200],
    ['/api/docs/demo/tree?ref=main', 200],
    [`/api/docs/demo/tree?ref=${enc(`${ORIGIN_PREFIX}main`)}`, 200],
    [`/api/docs/demo/tree?ref=${enc(`${LOCAL_PREFIX}ws/a`)}`, 200],
    [docsApi.file('demo', REAL_COMMITTED), 200],
    [docsApi.file('demo', REAL_DRAFT), 200],
    [`${docsApi.projects()}?x=1`, 400],
    ['/api/docs/demo/tree?ref=a&ref=b', 400],
    [`${docsApi.file('demo', REAL_COMMITTED)}&size=1`, 400],
  ];

  it('a spy across every GET never sees docs-fetch; CONTROL: one refresh POST records exactly one', async () => {
    const { app, deps, ccd } = await realServer();
    deps.fleetState = readyFleet();
    for (const [url, status] of GETS) {
      expect((await app.inject({ url, headers: PWA_HEADERS })).statusCode, url).toBe(status);
    }
    expect(verb(ccd(), 'docs-fetch'), 'a GET ran docs-fetch').toEqual([]);
    expect([...new Set(ccd().map((argv) => argv[0]))].sort(), 'the spy saw the reads it guards')
      .toEqual(['docs-index', 'docs-show', 'docs-tree']);
    const posted = await app.inject({
      method: 'POST', url: docsApi.refresh('demo'), headers: { ...PWA_HEADERS, 'content-type': 'application/json' },
      payload: JSON.stringify({ ref: null, reason: 'manual' }),
    });
    expect(posted.statusCode).toBe(200);
    expect(verb(ccd(), 'docs-fetch'), 'the spy cannot see a fetch').toEqual([['docs-fetch', '--project', 'demo']]);
  });
});

describe('T9: row 50 — the refresh is gated (section 2 (j) row 50, section 3.4)', () => {
  it('armed: no session 401; a foreign Origin 403; the session with no Origin 200; none of the four keys is EXEMPT', async () => {
    const { app, deps, ccd } = await realServer({ auth: true });
    deps.fleetState = readyFleet();
    const post = (headers: Record<string, string>) => app.inject({
      method: 'POST', url: docsApi.refresh('demo'),
      headers: { ...PWA_HEADERS, 'content-type': 'application/json', ...headers },
      payload: JSON.stringify({ ref: null, reason: 'manual' }),
    });
    const anonymous = await post({});
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toStrictEqual({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    const cookie = await realLogin(app);
    const foreign = await post({ cookie, origin: 'https://other.example' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toStrictEqual({ ok: false, error: 'foreign-origin' });
    expect(ccd(), 'a refused refresh made an exec').toEqual([]);
    const allowed = await post({ cookie });
    expect(allowed.statusCode).toBe(200);
    expect(verb(ccd(), 'docs-fetch')).toEqual([['docs-fetch', '--project', 'demo']]);
    for (const k of DOCS_KEYS) expect(EXEMPT.has(k), `${k} is EXEMPT`).toBe(false);
  });
});

describe('T9: M3.8 — the gate before provenance, on the real server (spec F1)', () => {
  it('armed, no cookie and no marker: each docs route answers the gate\'s 401 with its verdict, decorated, with zero execs', async () => {
    const { app, deps, ccd } = await realServer({ auth: true });
    deps.fleetState = readyFleet();
    const answers = await Promise.all(eachDocsRoute(app));
    expect(answers).toHaveLength(DOCS_KEYS.length);
    for (const [i, res] of answers.entries()) {
      expect(res.statusCode, DOCS_KEYS[i]).toBe(401);
      expect(res.json(), DOCS_KEYS[i]).toStrictEqual({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
      expect(res.headers['content-type'], DOCS_KEYS[i]).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control'], DOCS_KEYS[i]).toBe('no-store');
      for (const name of DOCS_HEADER_NAMES) {
        expect(res.headers[name], `${DOCS_KEYS[i]} ${name}`)
          .toBe(DOCS_RESPONSE_HEADERS[name as keyof typeof DOCS_RESPONSE_HEADERS]);
      }
    }
    expect(ccd()).toEqual([]);
  });

  it('refinement (d), measured on the real server: an over-long :project (414) and a malformed path escape (400) are the router\'s, before the gate, with no docs header and zero execs', async () => {
    const { app, deps, ccd } = await realServer({ auth: true });
    deps.fleetState = readyFleet();
    for (const [url, status, code] of [
      [`/api/docs/${'a'.repeat(101)}/tree`, 414, 'FST_ERR_MAX_PARAM_LENGTH'],
      ['/api/docs/%ZZ/tree', 400, 'FST_ERR_BAD_URL'],
    ] as const) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(status);
      expect(res.json().code, url).toBe(code);
      expect(res.json().verdict, `${url}: the gate ran`).toBeUndefined();
      for (const name of DOCS_HEADER_NAMES) expect(res.headers[name], `${url} ${name}`).toBeUndefined();
    }
    expect(ccd()).toEqual([]);
  });
});

/** Equal types, in either direction (the standard deferred-conditional form). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
/** Row 49's type wall (section 2 (g)'s wall 1), compiled by `typecheck-tests`: the read registration takes the app,
 *  the readers and the lanes, and nothing that can fetch. A fetcher parameter added to it fails this alias. */
type ReadRegistrationTakesNoFetcher = Assert<Equals<Parameters<typeof registerDocsReadRoutes>,
  [FastifyInstance, DocsNodes<DocsReader>, DocsNodes<DocsNodeLanes>]>>;

describe('T9: row 49 — the read registration\'s type has no fetcher (section 2 (g), wall 1; typecheck-tests)', () => {
  it('its parameters are pinned, and a fetcher map cannot be passed as the readers', () => {
    const pinned: ReadRegistrationTakesNoFetcher = true;
    /** Never called: it exists for the compiler. Were a fetcher map assignable to a reader map, the directive would
     *  be unused, and `typecheck-tests` would fail on it. */
    const fetcherAsReader = (app: FastifyInstance, docs: DocsComposition): void => {
      // @ts-expect-error -- a DocsFetcher map is not a DocsReader map: the read registration is never handed a fetcher
      registerDocsReadRoutes(app, docs.fetchers, docs.lanes);
    };
    expect(pinned).toBe(true);
    expect(fetcherAsReader).toBeTypeOf('function');
  });
});

describe('T11 review 3-1: a tree answer naming another project is refused, never filed under it', () => {
  const BLOB_X = 'a'.repeat(40);
  const BLOB_Y = 'e'.repeat(40);
  const PIN_REFUSED = { ok: false, failure: 'malformed-answer', why: 'pin' };

  it('GET /api/docs/a/tree answered with project demo: 502 malformed-answer {why: pin}, logged, nothing recorded under a or demo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = scripted(() => okRes(line(treeOk({ project: 'demo', entries: [committedEntry('a.md', BLOB_X, 4)] }))));
    const { app, docs } = await open({ run: rec.run });
    const res = await app.inject({ url: '/api/docs/a/tree', headers: PWA_HEADERS });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toStrictEqual(PIN_REFUSED);
    const caches = nodeLanes(docs).caches;
    expect(caches.listing.commits()).toBe(0);
    expect(caches.listing.lookup('primary', 'a', FIXTURE_COMMIT, 'specs', 'a.md')).toBeUndefined();
    expect(caches.listing.lookup('primary', 'demo', FIXTURE_COMMIT, 'specs', 'a.md')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('ccrc-server: docs tree answer named another project');
  });

  it.each([['an other project', 'Demo'], ['an absent project', undefined], ['a non-string project', ['a']]])(
    'a tree for a answered with %s is refused the same way', async (_label, project) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const rec = scripted(() => okRes(line({ ...treeOk({ entries: [committedEntry('a.md', BLOB_X, 4)] }), project })));
      const { app, docs } = await open({ run: rec.run });
      const res = await app.inject({ url: '/api/docs/a/tree', headers: PWA_HEADERS });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toStrictEqual(PIN_REFUSED);
      expect(nodeLanes(docs).caches.listing.commits()).toBe(0);
    });

  it('the refresh\'s tree half: a tree answered with another project is the tree half\'s failure, nothing recorded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = fleet({ tree: () => okRes(line(treeOk({ project: 'demo', entries: [committedEntry('a.md', BLOB_X, 4)] }))) });
    const { app, docs } = await open({ run: rec.run });
    const res = await refresh(app, null, 'auto', 'a');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true, fetch: { state: 'ran', answer: fetchOk() }, tree: PIN_REFUSED });
    const caches = nodeLanes(docs).caches;
    expect(caches.listing.commits()).toBe(0);
    expect(caches.listing.lookup('primary', 'demo', FIXTURE_COMMIT, 'specs', 'a.md')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('ccrc-server: docs tree answer named another project');
  });

  it('review 1-1: a tree for b naming a never poisons a\'s listing, so no cache hit serves another file\'s bytes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bytesOf = new Map([['x.md', Buffer.from('# x', 'utf8')], ['z.md', Buffer.from('# z', 'utf8')]]);
    const blobOf = new Map([['x.md', BLOB_Y], ['z.md', BLOB_X]]);
    const pinOf = (p: string) => ({
      kind: 'committed', commit: FIXTURE_COMMIT, servedRef: FIXTURE_SERVED, section: 'specs', path: p,
    }) as const;
    const rec = scripted((argv) => {
      if (argv[0] === 'docs-tree') {
        const entries = argv[2] === 'a'
          ? [committedEntry('x.md', BLOB_Y, 3), committedEntry('z.md', BLOB_X, 3)]
          : [committedEntry('x.md', BLOB_X, 3)];
        return okRes(line(treeOk({ project: 'a', entries })));
      }
      if (argv[0] === 'docs-show') {
        const p = argv[argv.indexOf('--path') + 1] as string;
        return okRes(showLine(pinOf(p), bytesOf.get(p) as Buffer, { blob: blobOf.get(p) }));
      }
      return faultRes();
    });
    const { app } = await open({ run: rec.run });
    const file = (p: string) => `/api/docs/a/file?commit=${FIXTURE_COMMIT}&servedRef=${enc(FIXTURE_SERVED)}&section=specs&path=${p}`;
    expect((await app.inject({ url: '/api/docs/a/tree', headers: PWA_HEADERS })).statusCode).toBe(200);
    expect((await app.inject({ url: file('z.md'), headers: PWA_HEADERS })).json()).toMatchObject({ ok: true, from: 'ccd' });
    const foreign = await app.inject({ url: '/api/docs/b/tree', headers: PWA_HEADERS });
    expect(foreign.statusCode).toBe(502);
    expect(foreign.json()).toStrictEqual(PIN_REFUSED);
    const x = (await app.inject({ url: file('x.md'), headers: PWA_HEADERS })).json();
    expect(x).toMatchObject({ ok: true, from: 'ccd', show: { path: 'x.md', blob: BLOB_Y } });
    expect(Buffer.from(x.show.b64 ?? Buffer.from(x.show.text).toString('base64'), 'base64').toString()).toBe('# x');
  });
});
