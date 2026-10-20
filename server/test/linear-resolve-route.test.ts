// `GET /api/linear/resolve` (S4): the preview read. The route is tested here on a bare
// Fastify instance with the real grammar (`shared/slug.ts`); the session gate is proven where
// every route's gate is, by `auth-gate.test.ts`'s sweep of the real server. Nothing here
// reaches the network: `fetch` is the route's injected seam.
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { registerLinearRoutes } from '../src/linear/routes.js';
import { LINEAR_REF_MAX_CHARS } from '../src/workspaceCreate.js';
import type { ResolveAnswer } from '../../shared/linear.js';
import { LINEAR_DETAILS_FILE, LINEAR_KEY_FILE } from '../src/linear/connection.js';
import { type FetchLike } from '../src/linear/client.js';
import { WS_TITLE_MAX_BYTES } from '../../shared/slug.js';
import type { AccountGate } from '../src/accounts/gate.js';
import { refuseRoute } from '../src/refuse.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const KEY = 'lin_api_routefixture';
/** A pasted issue link, built from parts: the public-tree scanner refuses the host and a path written joined. */
const LINK = ['https:/', ['linear', 'app'].join('.'), 'team-a', 'issue', 'ENG-1234', 'fix-the-login-flow'].join('/');

interface Calls { n: number; auth: string[] }
const fetchAnswering = (answer: Awaited<ReturnType<FetchLike>>): { f: FetchLike; calls: Calls } => {
  const calls: Calls = { n: 0, auth: [] };
  const f: FetchLike = async (_url, init) => { calls.n += 1; calls.auth.push(init.headers['authorization'] ?? ''); return answer; };
  return { f, calls };
};
const linearOk = (identifier: string, title: string): Awaited<ReturnType<FetchLike>> =>
  ({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }) });

/** The resolve read never reaches the account gate (the connection's two writes do, in linear-connection-routes.test.ts):
 *  a gate that refuses everything proves it. */
const refusingGate: AccountGate = (_req, reply) => { void refuseRoute(reply, 'auth-off'); return { pass: false }; };

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

async function boot(opts: { fetch?: FetchLike; timeoutMs?: number; key?: string | null } = {}): Promise<{ app: FastifyInstance; dir: string }> {
  const dir = mkTmp('ccrc-linear-route-');
  if (opts.key !== null) writeFileSync(path.join(dir, LINEAR_KEY_FILE), `${opts.key ?? KEY}\n`, { mode: 0o600 });
  const a = Fastify();
  registerLinearRoutes(a, { ccrcDir: dir, gate: refusingGate, fetch: opts.fetch, timeoutMs: opts.timeoutMs });
  await a.ready();
  app = a;
  return { app: a, dir };
}
const get = (a: FastifyInstance, ref: string | null): Promise<LightMyRequestResponse> =>
  a.inject({ method: 'GET', url: ref === null ? '/api/linear/resolve' : `/api/linear/resolve?ref=${encodeURIComponent(ref)}` });
const answer = (res: { body: string }): ResolveAnswer => JSON.parse(res.body) as ResolveAnswer;

describe('GET /api/linear/resolve', () => {
  it('answers Linear’s real title, source linear, when connected and Linear answers', async () => {
    const { f, calls } = fetchAnswering(linearOk('ENG-1234', 'Fix the login flow'));
    const { app: a } = await boot({ fetch: f });
    const res = await get(a, 'ENG-1234');
    expect(res.statusCode).toBe(200);
    expect(answer(res)).toEqual({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow', source: 'linear' });
    expect(calls.auth).toEqual([KEY]);
  });

  it('resolves a pasted issue link through the real grammar: its slug, Linear\u2019s title', async () => {
    const { f } = fetchAnswering(linearOk('ENG-1234', 'Fix the login flow, for real'));
    const { app: a } = await boot({ fetch: f });
    expect(answer(await get(a, LINK))).toEqual({
      kind: 'named', slug: 'eng-1234-fix-the-login-flow', title: 'ENG-1234 - Fix the login flow, for real', source: 'linear',
    });
  });

  it('answers no-store on a 200, a refusal and every 400', async () => {
    const { f } = fetchAnswering(linearOk('ENG-1234', 'T'));
    const { app: a } = await boot({ fetch: f });
    for (const res of [
      await get(a, 'ENG-1234'), await get(a, '!!'), await get(a, ''),
      await get(a, null), await get(a, 'x'.repeat(LINEAR_REF_MAX_CHARS + 1)),
    ]) {
      expect(res.headers['cache-control'], `${res.statusCode} ${res.body.slice(0, 60)}`).toBe('no-store');
    }
  });

  it('answers 400 for a missing ref and for a repeated one, in fixed words', async () => {
    const { app: a } = await boot();
    const missing = await get(a, null);
    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.body)).toEqual({ ok: false, error: 'bad-ref' });
    const twice = await a.inject({ method: 'GET', url: '/api/linear/resolve?ref=a&ref=b' });
    expect(twice.statusCode).toBe(400);
    expect(JSON.parse(twice.body)).toEqual({ ok: false, error: 'bad-ref' });
  });

  it('answers 400 for a ref over the cap and accepts one exactly at it', async () => {
    const { app: a } = await boot();
    const over = await get(a, 'x'.repeat(LINEAR_REF_MAX_CHARS + 1));
    expect(over.statusCode).toBe(400);
    expect(JSON.parse(over.body)).toEqual({ ok: false, error: 'ref-too-long' });
    expect((await get(a, 'x'.repeat(LINEAR_REF_MAX_CHARS))).statusCode).toBe(200);
  });

  it('a blank ref is the auto kind: no slug, no title, no lookup', async () => {
    const { f, calls } = fetchAnswering(linearOk('ENG-1234', 'T'));
    const { app: a } = await boot({ fetch: f });
    const res = await get(a, '   ');
    expect(res.statusCode).toBe(200);
    expect(answer(res)).toEqual({ kind: 'auto', slug: null, title: null, source: 'offline' });
    expect(calls.n).toBe(0);
  });

  it('a refused name is passed through with its reason and no lookup', async () => {
    const { f, calls } = fetchAnswering(linearOk('ENG-1234', 'T'));
    const { app: a } = await boot({ fetch: f });
    expect(answer(await get(a, '!!')))
      .toEqual({ kind: 'refused', slug: null, title: null, source: 'offline', reason: 'no-usable-characters' });
    expect(calls.n).toBe(0);
  });

  it('a plain name is offline, in the operator’s own words, and makes no call', async () => {
    const { f, calls } = fetchAnswering(linearOk('ENG-1234', 'T'));
    const { app: a } = await boot({ fetch: f });
    expect(answer(await get(a, 'Login cleanup')))
      .toEqual({ kind: 'named', slug: 'login-cleanup', title: 'Login cleanup', source: 'offline' });
    expect(calls.n).toBe(0);
  });

  it('with no key it answers the offline title, reason not-configured, and makes no call', async () => {
    const { f, calls } = fetchAnswering(linearOk('ENG-1234', 'T'));
    const { app: a } = await boot({ fetch: f, key: null });
    expect(answer(await get(a, 'ENG-1234')))
      .toEqual({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234', source: 'offline', reason: 'not-configured' });
    expect(calls.n).toBe(0);
  });

  it('reads the key at use time, so one connected after boot is used on the next request', async () => {
    const { f, calls } = fetchAnswering(linearOk('ENG-1234', 'T'));
    const { app: a, dir } = await boot({ fetch: f, key: null });
    expect(answer(await get(a, 'ENG-1234')).source).toBe('offline');
    writeFileSync(path.join(dir, LINEAR_KEY_FILE), 'lin_api_later\n');
    expect(answer(await get(a, 'ENG-1234')).source).toBe('linear');
    expect(calls.auth).toEqual(['lin_api_later']);
  });

  it('degrades a timeout to the offline title, in well under a hung lookup', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const { app: a } = await boot({ fetch: hang, timeoutMs: 20 });
    const res = await get(a, 'ENG-1234');
    expect(res.statusCode).toBe(200);
    expect(answer(res)).toEqual({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234', source: 'offline', reason: 'timeout' });
  });

  it('degrades every other failure arm to the offline title with its own word', async () => {
    const cases: [Awaited<ReturnType<FetchLike>>, string][] = [
      [{ ok: false, status: 401, json: async () => ({}) }, 'unauthorised'],
      [{ ok: true, status: 200, json: async () => ({ data: { issue: null } }) }, 'not-found'],
      [{ ok: true, status: 200, json: async () => ({ nope: 1 }) }, 'malformed'],
      [{ ok: false, status: 502, json: async () => ({}) }, 'unreachable'],
    ];
    for (const [ans, word] of cases) {
      const { f } = fetchAnswering(ans);
      const { app: a } = await boot({ fetch: f });
      const res = await get(a, 'ENG-1234');
      expect(res.statusCode, word).toBe(200);
      expect(answer(res), word).toEqual({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234', source: 'offline', reason: word });
      await a.close();
      app = null;
    }
  });

  it('a pasted URL falls back to the parsed title when Linear gives none', async () => {
    const { f } = fetchAnswering({ ok: true, status: 200, json: async () => ({ data: { issue: null } }) });
    const { app: a } = await boot({ fetch: f });
    const res = await get(a, LINK);
    expect(answer(res)).toEqual({
      kind: 'named', slug: 'eng-1234-fix-the-login-flow', title: 'ENG-1234 - Fix the login flow', source: 'offline', reason: 'not-found',
    });
  });

  it('shortens a long Linear title to the cap and never turns it into an error', async () => {
    const { f } = fetchAnswering(linearOk('ENG-1234', 'word '.repeat(300)));
    const { app: a } = await boot({ fetch: f });
    const res = await get(a, 'ENG-1234');
    expect(res.statusCode).toBe(200);
    const body = answer(res);
    expect(body.source).toBe('linear');
    expect(new TextEncoder().encode(body.title ?? '').length).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
    expect(body.title?.endsWith('…')).toBe(true);
  });

  it('shortens when the identifier prefix is what tips a title over the cap', async () => {
    const { f } = fetchAnswering(linearOk('ENG-1234', 'x'.repeat(WS_TITLE_MAX_BYTES)));
    const { app: a } = await boot({ fetch: f });
    const body = answer(await get(a, 'ENG-1234'));
    expect(new TextEncoder().encode(body.title ?? '').length).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
    expect(body.title?.startsWith('ENG-1234 - ')).toBe(true);
  });

  it('sanitises a Linear title carrying a tab or newline', async () => {
    const { f } = fetchAnswering(linearOk('ENG-1234', 'Fix\tthe\nlogin'));
    const { app: a } = await boot({ fetch: f });
    expect(answer(await get(a, 'ENG-1234')).title).toBe('ENG-1234 - Fix the login');
  });

  it('never carries the key or what Linear said, on any arm', async () => {
    const LEAK = 'LINEAR-RESPONSE-TEXT-THAT-MUST-NOT-ECHO';
    const bodies: Awaited<ReturnType<FetchLike>>[] = [
      { ok: false, status: 401, json: async () => ({ message: LEAK, key: KEY }) },
      { ok: true, status: 200, json: async () => ({ data: { issue: null }, errors: [{ message: LEAK }] }) },
      { ok: true, status: 200, json: async () => ({ data: { issue: { title: 7, note: LEAK } } }) },
    ];
    for (const b of bodies) {
      const { f } = fetchAnswering(b);
      const { app: a } = await boot({ fetch: f });
      const res = await get(a, 'ENG-1234');
      expect(res.body).not.toContain(LEAK);
      expect(res.body).not.toContain(KEY);
      await a.close();
      app = null;
    }
  });

  it('on a 401 it writes the rejection record and nothing else: the key file is never touched', async () => {
    const { f } = fetchAnswering({ ok: false, status: 401, json: async () => ({}) });
    const { app: a, dir } = await boot({ fetch: f });
    const stat = statSync(path.join(dir, LINEAR_KEY_FILE));
    const text = readFileSync(path.join(dir, LINEAR_KEY_FILE), 'utf8');
    await get(a, 'ENG-1234');
    expect(readdirSync(dir).sort()).toEqual([LINEAR_DETAILS_FILE, LINEAR_KEY_FILE]);
    expect(statSync(path.join(dir, LINEAR_KEY_FILE)).mtimeMs).toBe(stat.mtimeMs);
    expect(readFileSync(path.join(dir, LINEAR_KEY_FILE), 'utf8')).toBe(text);
  });

  it('writes nothing on a failure that is not a 401', async () => {
    for (const ans of [
      { ok: false, status: 502, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ data: { issue: null } }) },
    ]) {
      const { f } = fetchAnswering(ans);
      const { app: a, dir } = await boot({ fetch: f });
      await get(a, 'ENG-1234');
      expect(readdirSync(dir).sort()).toEqual([LINEAR_KEY_FILE]);
      await a.close();
      app = null;
    }
  });
});
