// The reader lab's door through the real server (native Docs reader, the reader lab plan of 2026-11-03, Task 3; the
// rich-docs spec's rows M10.2, M10.3, M10.4, M10.5, M10.7, M10.8, M10.17; the reader lab design, section 4): `buildServer`
// with the gate dark and armed. The run routes are session-gated and a run answers only the session that opened it; every
// probe answer is one empty 204, whatever it is sent; the counter sees a probe before the gate and keeps only classes; a
// frame's WebSocket upgrade is refused by the gate, which logs its foreign-origin line, and still counted; a CORS
// preflight to the probe is never approved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { DOCS_REQUEST_HEADER } from '../../shared/docs.js';
import {
  READER_LAB_PROBE_ROUTE, READER_LAB_RUNS_PATH, readerLabProbePath, type LabOpenAnswer, type LabReadAnswer,
} from '../../shared/readerLab.js';
import { READER_LAB_PROBE_BODY_MAX, labOwnerOf } from '../src/readerLab/routes.js';
import { READER_LAB_RUN_HITS_MAX, READER_LAB_RUN_TTL_MS } from '../src/readerLab/runs.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** A cheap scrypt line verifies through the identical code path (auth-gate.test.ts' FAST_PARAMS). */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** A pty that never touches tmux (auth-gate.test.ts' stubPty). */
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });
const UNKNOWN = 'ZZZZZZZZZZZZZZZZZZZZZZ';

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
});

/** The real server in a fixture home, the gate armed or dark, with a passphrase so a session can be minted. */
async function openApp(armed: boolean, seen?: string[]): Promise<FastifyInstance> {
  const home = mkTmp('ccrc-reader-lab-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false }, spawnPty: stubPty };
  app = await buildServer(deps);
  // Fastify runs a route's onError hooks before its errorHandler, so this sees what the probe's errorHandler is handed.
  if (seen !== undefined) app.addHook('onError', async (_req, _reply, err) => { seen.push((err as { code?: string }).code ?? err.name); });
  await app.ready();
  return app;
}

/** A live session cookie, minted through the real login route. */
async function login(a: FastifyInstance): Promise<string> {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
}

const headersOf = (cookie?: string): Record<string, string> => (cookie === undefined ? {} : { cookie });

async function openRun(a: FastifyInstance, cookie?: string): Promise<string> {
  const res = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, headers: headersOf(cookie) });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as LabOpenAnswer).nonce;
}

async function readRun(a: FastifyInstance, nonce: string, cookie?: string): Promise<LabReadAnswer> {
  const res = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: headersOf(cookie) });
  return JSON.parse(res.body) as LabReadAnswer;
}

const counted = (r: LabReadAnswer): Extract<LabReadAnswer, { ok: true }>['run'] => {
  if (!r.ok) throw new Error('the run is not open');
  return r.run;
};

describe('the reader lab door (reader lab plan, Task 3)', () => {
  it('registers the run routes and the probe pair at the paths the vocabulary names, as literals', async () => {
    const a = await openApp(false);
    expect(a.hasRoute({ method: 'POST', url: READER_LAB_RUNS_PATH })).toBe(true);
    expect(a.hasRoute({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/:nonce` })).toBe(true);
    expect(a.hasRoute({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/:nonce/close` })).toBe(true);
    expect(a.hasRoute({ method: 'GET', url: READER_LAB_PROBE_ROUTE })).toBe(true);
    expect(a.hasRoute({ method: 'POST', url: READER_LAB_PROBE_ROUTE })).toBe(true);
    // Refinement (f): no HEAD on either GET (a HEAD route would share the probe's counter and answer 204).
    expect(a.hasRoute({ method: 'HEAD', url: READER_LAB_PROBE_ROUTE })).toBe(false);
    expect(a.hasRoute({ method: 'HEAD', url: `${READER_LAB_RUNS_PATH}/:nonce` })).toBe(false);
    const src = readFileSync(path.join(here, '..', 'src', 'readerLab', 'routes.ts'), 'utf8');
    for (const lit of [`app.post('${READER_LAB_RUNS_PATH}'`, `app.get('${READER_LAB_PROBE_ROUTE}'`, `app.post('${READER_LAB_PROBE_ROUTE}'`]) {
      expect(src, lit).toContain(lit);
    }
  });

  it('armed: a session opens, reads and closes a run; an anonymous caller gets the gate\'s 401 on all three (M10.8)', async () => {
    const a = await openApp(true);
    for (const [method, url] of [['POST', READER_LAB_RUNS_PATH], ['GET', `${READER_LAB_RUNS_PATH}/${UNKNOWN}`],
      ['POST', `${READER_LAB_RUNS_PATH}/${UNKNOWN}/close`]] as const) {
      const anon = await a.inject({ method, url });
      expect(anon.statusCode, `${method} ${url}`).toBe(401);
      expect((JSON.parse(anon.body) as { verdict?: unknown }).verdict, `${method} ${url}`).toBe('no-session');
    }
    const cookie = await login(a);
    const opened = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, headers: { cookie } });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(opened.body) as LabOpenAnswer;
    expect(body.ok).toBe(true);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.ttlMs).toBe(READER_LAB_RUN_TTL_MS);
    expect(counted(await readRun(a, body.nonce, cookie)).counted).toBe(0);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${body.nonce}/close`, headers: { cookie } });
    expect(JSON.parse(closed.body)).toEqual({ ok: true, closed: true });
    const gone = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${body.nonce}`, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
    expect(JSON.parse(gone.body)).toEqual({ ok: false, error: 'unknown-run' });
    const again = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${body.nonce}/close`, headers: { cookie } });
    expect(JSON.parse(again.body)).toEqual({ ok: true, closed: false });
  });

  it('the server mints every nonce: two opens differ, and a nonce sent in the body is not taken (M10.2)', async () => {
    const a = await openApp(false);
    const offered = 'AAAAAAAAAAAAAAAAAAAAAA';
    const res = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, payload: { nonce: offered } });
    const first = (JSON.parse(res.body) as LabOpenAnswer).nonce;
    const second = await openRun(a);
    expect(first).not.toBe(offered);
    expect(second).not.toBe(first);
    const r = await readRun(a, offered);
    expect(r).toEqual({ ok: false, error: 'unknown-run' });
  });

  it('every probe answer is the same empty 204, by GET and POST, for a live, unknown, malformed, closed, expired or saturated run and an unknown name (M10.4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_784_600_000_000);
    const a = await openApp(false);
    const expired = await openRun(a);
    vi.setSystemTime(1_784_600_000_000 + READER_LAB_RUN_TTL_MS - 1000);
    const live = await openRun(a);
    const closed = await openRun(a);
    await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${closed}/close` });
    const full = await openRun(a);
    for (let i = 0; i < READER_LAB_RUN_HITS_MAX; i += 1) await a.inject({ method: 'GET', url: readerLabProbePath(full, 'cookie-image') });
    vi.setSystemTime(1_784_600_000_000 + READER_LAB_RUN_TTL_MS);
    expect(await readRun(a, expired)).toEqual({ ok: false, error: 'unknown-run' });
    expect(counted(await readRun(a, full)).saturated).toBe(true);
    const urls = [
      readerLabProbePath(live, 'cookie-image'), `/api/reader-lab/probe/${live}/not-a-probe`, readerLabProbePath(UNKNOWN, 'cookie-image'),
      '/api/reader-lab/probe/x/cookie-image', readerLabProbePath(closed, 'cookie-image'), readerLabProbePath(expired, 'cookie-image'),
      readerLabProbePath(full, 'cookie-image'),
    ];
    const shapes = new Set<string>();
    for (const url of urls) {
      for (const method of ['GET', 'POST'] as const) {
        const res = await a.inject({ method, url, ...(method === 'POST' ? { payload: 'x', headers: { 'content-type': 'text/plain' } } : {}) });
        const what = `${method} ${url}`;
        expect(res.statusCode, what).toBe(204);
        expect(res.body, what).toBe('');
        expect(res.headers['cache-control'], what).toBe('no-store');
        expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-') || h === 'set-cookie'), what).toEqual([]);
        shapes.add(Object.keys(res.headers).filter((h) => h !== 'date').sort().join(','));
      }
    }
    expect([...shapes], 'every probe answer carries the same header names').toHaveLength(1);
    expect(counted(await readRun(a, live)).counted).toBe(4);
  }, 60_000);

  it('a POST probe whose body the server will not take still answers 204, and is counted (M10.4)', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    const report = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-beacon'),
      payload: '{"csp-report":{}}', headers: { 'content-type': 'application/csp-report' } });
    const big = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-xhr'),
      payload: 'x'.repeat(4096), headers: { 'content-type': 'text/plain' } });
    expect([report.statusCode, report.body, big.statusCode, big.body]).toEqual([204, '', 204, '']);
    const run = counted(await readRun(a, nonce));
    expect([run.probes['cookie-beacon'].hits, run.probes['cookie-xhr'].hits]).toEqual([1, 1]);
  });

  it('a probe POST body over 1 KiB is refused by the route\'s own limit and still answers 204; one under it is not refused (M10.4)', async () => {
    const seen: string[] = [];
    const a = await openApp(false, seen);
    const nonce = await openRun(a);
    const post = (n: number) => a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-xhr'),
      payload: 'x'.repeat(n), headers: { 'content-type': 'text/plain' } });
    const small = await post(READER_LAB_PROBE_BODY_MAX - 1);
    expect([small.statusCode, small.body, seen], 'a body under the limit is parsed, not refused').toEqual([204, '', []]);
    const big = await post(2 * READER_LAB_PROBE_BODY_MAX);
    expect([big.statusCode, big.body], 'a refused body answers as an accepted one does').toEqual([204, '']);
    expect(seen, 'the 2 KiB body went through the route\'s error path as a too-large body').toEqual(['FST_ERR_CTP_BODY_TOO_LARGE']);
    expect(counted(await readRun(a, nonce)).probes['cookie-xhr'].hits).toBe(2);
  });

  it('the probe handlers never read a body: no body or raw-stream access in either registration (refinement (f))', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'readerLab', 'routes.ts'), 'utf8');
    const from = src.indexOf(`app.get('${READER_LAB_PROBE_ROUTE}'`);
    expect(from, 'the probe registrations are the last in the file').toBeGreaterThan(src.indexOf(`app.post('${READER_LAB_RUNS_PATH}'`));
    expect(src.indexOf(`app.post('${READER_LAB_PROBE_ROUTE}'`)).toBeGreaterThan(from);
    // Comments are blanked, so a sentence ABOUT a body is not a read; `bodyLimit` is not the word `body`.
    const reads = (text: string): boolean => /\bbody\b|\.\s*raw\b|\.\s*stream\b/.test(
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1'));
    expect(reads(src.slice(from)), 'a probe handler reads the request body').toBe(false);
    // CONTROL: every shape of a read is seen; a comment and the limit option are not.
    for (const t of ['async (req, reply) => { const b = req.body; }', 'async ({ body }, reply) => {}', 'req.raw.on("data", f)',
      'async (req) => { for await (const c of req.stream) {} }']) expect(reads(t), t).toBe(true);
    for (const t of ['bodyLimit: READER_LAB_PROBE_BODY_MAX,', '// the handler never reads the body\nasync (_req, reply) => 1', '/* a body */ x']) {
      expect(reads(t), t).toBe(false);
    }
  });

  it('a nonce is 128 bits from node:crypto: minted by randomBytes(16), imported from node:crypto, with no Math.random in the door (M10.2)', () => {
    // The shape is pinned elsewhere; its entropy source is pinned here, because a Math.random- or counter-derived string of
    // the same 22 characters would pass every shape check.
    const src = readFileSync(path.join(here, '..', 'src', 'readerLab', 'routes.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    expect(code.split("const nonce = randomBytes(16).toString('base64url');"), 'the open handler mints the nonce once').toHaveLength(2);
    expect(code).toMatch(/import\s*\{[^}]*\brandomBytes\b[^}]*\}\s*from\s*'node:crypto'/);
    expect(code, 'the door draws no randomness from Math').not.toMatch(/\bMath\s*\.\s*random\b/);
  });

  it('a HEAD to the probe is neither answered as a probe nor counted (refinement (f))', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    await a.inject({ method: 'HEAD', url: readerLabProbePath(nonce, 'cookie-image') });
    const run = counted(await readRun(a, nonce));
    expect([run.counted, run.probes['cookie-image'].hits]).toEqual([0, 0]);
  });

  it('armed: the counter keeps classes, never a value: the cookie by name, Sec-Fetch-Site and Origin (M10.7)', async () => {
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    const withCookie = await a.inject({ method: 'GET', url: readerLabProbePath(nonce, 'cookie-fetch'),
      headers: { cookie, 'sec-fetch-site': 'cross-site', origin: 'null' } });
    const bare = await a.inject({ method: 'GET', url: readerLabProbePath(nonce, 'cookie-image'),
      headers: { 'sec-fetch-site': 'same-origin' } });
    expect([withCookie.statusCode, bare.statusCode]).toEqual([204, 204]);
    const res = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: { cookie } });
    const run = counted(JSON.parse(res.body) as LabReadAnswer);
    expect(run.probes['cookie-fetch']).toMatchObject({ hits: 1, cookie: 1, upgrade: 0 });
    expect(run.probes['cookie-fetch'].site['cross-site']).toBe(1);
    expect(run.probes['cookie-fetch'].origin.null).toBe(1);
    expect(run.probes['cookie-image']).toMatchObject({ hits: 1, cookie: 0 });
    expect(run.probes['cookie-image'].site['same-origin']).toBe(1);
    expect(run.probes['cookie-image'].origin.absent).toBe(1);
    expect(res.body, 'the read never carries the cookie\'s value').not.toContain(cookie.slice(cookie.indexOf('=') + 1));
  });

  it('armed: a frame\'s WebSocket upgrade to the probe is refused by the gate (403), logged by the gate once, and still counted (M10.3)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    await expect(a.injectWS(readerLabProbePath(nonce, 'cookie-websocket'), { headers: { origin: 'null' } }))
      .rejects.toThrow('Unexpected server response: 403');
    const run = counted(await readRun(a, nonce, cookie));
    expect(run.probes['cookie-websocket']).toMatchObject({ hits: 1, upgrade: 1, cookie: 0 });
    expect(run.probes['cookie-websocket'].origin.null).toBe(1);
    // The gate's own CSRF line, unchanged: on an armed box each lab frame's upgrade writes it once, which the design's
    // section 4.4 and the page call expected. The door adds no line of its own.
    const refusals = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('foreign origin'));
    expect(refusals, 'the gate logs one foreign-origin line for the upgrade').toHaveLength(1);
    expect(refusals[0]).toContain('refused a websocket upgrade from a foreign origin');
    expect(refusals[0]).toContain('"null"');
  });

  it('armed: a frame\'s POST probe from origin null skips the origin check (reason 8): the same 204, counted, and no refusal logged (M10.4)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    const res = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-beacon'), payload: 'x',
      headers: { origin: 'null', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' } });
    expect([res.statusCode, res.body, res.headers['cache-control']]).toEqual([204, '', 'no-store']);
    const run = counted(await readRun(a, nonce, cookie));
    expect(run.probes['cookie-beacon']).toMatchObject({ hits: 1, cookie: 0 });
    expect(run.probes['cookie-beacon'].origin.null).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('foreign origin'))).toEqual([]);
  });

  it('a run answers only the session that opened it: any other gets exactly the unknown-nonce answer, and cannot close it (M10.17)', async () => {
    const a = await openApp(false);
    const mine = 'ccrc_session=lab-a';
    const other = 'ccrc_session=lab-b';
    const nonce = await openRun(a, mine);
    const theirs = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: { cookie: other } });
    const unknown = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${UNKNOWN}`, headers: { cookie: mine } });
    expect([theirs.statusCode, theirs.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(theirs.statusCode).toBe(404);
    const anon = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}` });
    expect(anon.statusCode, 'a caller with no session is another owner').toBe(404);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${nonce}/close`, headers: { cookie: other } });
    expect(JSON.parse(closed.body)).toEqual({ ok: true, closed: false });
    expect(counted(await readRun(a, nonce, mine)).counted).toBe(0);
    // The owner is a one-way digest: never the cookie, stable for one session, distinct between two; no cookie is one owner.
    expect(labOwnerOf(mine)).not.toContain('lab-a');
    expect(labOwnerOf(mine)).toBe(labOwnerOf(`${mine}; theme=dark`));
    expect(labOwnerOf(mine)).not.toBe(labOwnerOf(other));
    expect(labOwnerOf(undefined)).toBe(labOwnerOf('theme=dark'));
  });

  it('a CORS preflight to the probe is never approved: no CORS header, a refusal, and nothing counted, dark or armed', async () => {
    // The cookie check's marker request needs this preflight; the browser case cannot see it, because Playwright answers
    // preflights itself while it intercepts requests, so the refusal is pinned here, at the server.
    for (const armed of [false, true]) {
      const a = await openApp(armed);
      const cookie = armed ? await login(a) : undefined;
      const nonce = await openRun(a, cookie);
      const res = await a.inject({ method: 'OPTIONS', url: readerLabProbePath(nonce, 'cookie-fetch-marker'), headers: {
        origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': DOCS_REQUEST_HEADER } });
      expect(res.statusCode, `armed ${armed}`).toBeGreaterThanOrEqual(400);
      expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-')), `armed ${armed}`).toEqual([]);
      expect(counted(await readRun(a, nonce, cookie)).counted, `armed ${armed}`).toBe(0);
      await a.close();
      app = undefined;
    }
  });

  it('with no run open under a nonce, probes naming it record nothing anywhere (M10.5)', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    for (const name of ['cookie-image', 'busy-start', 'csp-canary'] as const) {
      await a.inject({ method: 'GET', url: readerLabProbePath(UNKNOWN, name) });
    }
    const run = counted(await readRun(a, nonce));
    expect([run.counted, run.ignored]).toEqual([0, 0]);
  });

  it('the probe pair is EXEMPT under reason 8; the run routes are not (M10.8)', () => {
    for (const k of [`GET ${READER_LAB_PROBE_ROUTE}`, `POST ${READER_LAB_PROBE_ROUTE}`]) {
      expect(EXEMPT.has(k), k).toBe(true);
      expect(EXEMPT.get(k), k).toContain('reason 8');
      expect(EXEMPT.get(k), k).not.toContain('EXEMPT-BUT-AUTHENTICATED');
    }
    for (const k of [`POST ${READER_LAB_RUNS_PATH}`, `GET ${READER_LAB_RUNS_PATH}/:nonce`, `POST ${READER_LAB_RUNS_PATH}/:nonce/close`]) {
      expect(EXEMPT.has(k), k).toBe(false);
    }
  });
});
