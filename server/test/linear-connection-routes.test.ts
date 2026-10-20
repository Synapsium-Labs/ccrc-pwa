// The Linear connection's four routes (named workspaces S4b, design 2026-10-20 §5.1), on a bare Fastify instance
// with the REAL account gate and the real step-up store, so the credential posture is measured here and not
// assumed. The session gate of the whole server is proven by `auth-gate.test.ts`'s sweep. Nothing reaches the
// network: `fetch` is the routes' injected seam, and every Linear answer below is a stub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest, type LightMyRequestResponse } from 'fastify';
import { LINEAR_KEY_MAX_CHARS, LINEAR_KEY_MIN_CHARS, type LinearConnectionView } from '../../shared/linear.js';
import { createAccountGate } from '../src/accounts/gate.js';
import { measureSecret, sessionVerdict } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { createStepUp } from '../src/auth/stepup.js';
import { PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { valueDigestHex } from '../src/token/files.js';
import { LINEAR_DETAILS_FILE, LINEAR_KEY_FILE, parseLinearDetails } from '../src/linear/connection.js';
import { registerLinearRoutes } from '../src/linear/routes.js';
import type { FetchLike } from '../src/linear/client.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const KEY = 'lin_api_fixture_key_one_0001';
const KEY2 = 'lin_api_fixture_key_two_0002';
const LEAK = 'LINEAR-RESPONSE-TEXT-THAT-MUST-NOT-ECHO';
const LOOPBACK_ORIGIN = 'http://localhost:7788';
const NOW = 1_800_000_000_000;

type Answer = Awaited<ReturnType<FetchLike>>;
const viewerOk = (org = 'team-a', user = 'user-a'): Answer =>
  ({ ok: true, status: 200, json: async () => ({ data: { viewer: { name: user }, organization: { name: org } } }) });
const status = (n: number): Answer => ({ ok: false, status: n, json: async () => ({ errors: [{ message: LEAK }], key: LEAK }) });

interface Call { auth: string; body: string }
interface Rig {
  app: FastifyInstance;
  dir: string;
  cookie: string;
  calls: Call[];
  /** Records a step-up on the session, as the real step-up route would. */
  stamp: () => Promise<void>;
  /** Sets what Linear answers next; the function form can act mid-flight. */
  answer: (a: Answer | ((init: { headers: Record<string, string>; body: string }) => Promise<Answer>)) => void;
  clock: { now: number };
}
interface RigOpts { enabled?: boolean; origin?: string; timeoutMs?: number }

let open: FastifyInstance | null = null;
afterEach(async () => { vi.restoreAllMocks(); await open?.close(); open = null; });

async function rig(o: RigOpts = {}): Promise<Rig> {
  const home = mkTmp('ccrc-linear-conn-');
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  const secretPath = path.join(dir, 'auth.scrypt');
  writeFileSync(secretPath, `${await hashLine('a test passphrase', FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const store = new SessionStore(path.join(dir, 'sessions.json'));
  const { token } = await store.create('a test phone', 1, Date.now());
  const enabled = o.enabled ?? true;
  const stepUp = createStepUp({
    enabled, store, passkeys: new PasskeyStore(path.join(dir, 'passkeys.json')),
    secretNow: () => measureSecret(secretPath), rpProblem: () => null, rpId: 'localhost', device: () => null,
  });
  const gate = createAccountGate({
    enabled, origin: o.origin ?? LOOPBACK_ORIGIN,
    sessionAuth: (req: FastifyRequest) => sessionVerdict(req, { enabled, secret: measureSecret(secretPath), store }, Date.now()),
    // No ccd caps at all: the connection's routes involve no ccd verb, so an unmeasured fleet must not refuse them.
    fleetState: () => undefined,
    stepUp,
  });
  const calls: Call[] = [];
  let next: Parameters<Rig['answer']>[0] = viewerOk();
  const fetchStub: FetchLike = async (_url, init) => {
    calls.push({ auth: init.headers['authorization'] ?? '', body: init.body });
    const pending = typeof next === 'function' ? next({ headers: init.headers, body: init.body }) : Promise.resolve(next);
    // A real `fetch` rejects when its signal aborts; the stub does the same, or a hung answer would hang the test.
    return Promise.race([pending, new Promise<never>((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })]);
  };
  const clock = { now: NOW };
  const app = Fastify({ logger: false });
  registerLinearRoutes(app, { ccrcDir: dir, gate, fetch: fetchStub, timeoutMs: o.timeoutMs, now: () => clock.now });
  await app.ready();
  open = app;
  return {
    app, dir, calls, clock,
    cookie: `${SESSION_COOKIE}=${token}`,
    stamp: async () => { expect(await store.stampAsserted(sessionIdHash(token), Date.now())).toBe(true); },
    answer: (a) => { next = a; },
  };
}

const PATH = '/api/linear/connection';
const req = (r: Rig, method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse> =>
  r.app.inject({
    method, url, headers: { cookie: r.cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(payload === undefined ? {} : { payload: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
  });
const get = (r: Rig): Promise<LightMyRequestResponse> => req(r, 'GET', PATH);
const put = (r: Rig, key: unknown): Promise<LightMyRequestResponse> => req(r, 'PUT', PATH, { key });
const check = (r: Rig): Promise<LightMyRequestResponse> => req(r, 'POST', `${PATH}/check`);
const del = (r: Rig): Promise<LightMyRequestResponse> => req(r, 'DELETE', PATH);
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const view = (res: { body: string }): LinearConnectionView => (json(res)['connection'] as LinearConnectionView);
const keyPath = (r: Rig): string => path.join(r.dir, LINEAR_KEY_FILE);
const detailsPath = (r: Rig): string => path.join(r.dir, LINEAR_DETAILS_FILE);
const files = (r: Rig): string[] => readdirSync(r.dir).filter((n) => n.startsWith('linear')).sort();

/** A stored, verified connection, as a successful PUT leaves it. */
const connect = async (r: Rig, key = KEY): Promise<void> => {
  await r.stamp();
  const res = await put(r, key);
  expect(res.statusCode, res.body).toBe(200);
  r.calls.length = 0;
};

describe('GET /api/linear/connection', () => {
  it('a box with no files is not connected', async () => {
    const r = await rig();
    const res = await get(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, connection: { state: 'not-connected' } });
  });

  it('a connected key shows the organisation, the user, the key tail and the check time, and nothing else', async () => {
    const r = await rig();
    await connect(r);
    expect(view(await get(r))).toEqual({
      state: 'connected', outcome: 'ok', org: 'team-a', user: 'user-a', keyTail: '0001', checkedAt: NOW,
    });
  });

  it('each outcome the details file records is its own state', async () => {
    const r = await rig();
    await connect(r);
    r.answer(status(401));
    r.clock.now = NOW + 1;
    expect(view(await check(r))).toMatchObject({ state: 'key-rejected', outcome: 'rejected', org: 'team-a', keyTail: '0001', checkedAt: NOW + 1 });
    r.answer(status(403));
    expect(view(await check(r))).toMatchObject({ state: 'key-forbidden', outcome: 'forbidden', org: 'team-a', keyTail: '0001' });
    r.answer(status(502));
    expect(view(await check(r))).toMatchObject({ state: 'unreachable', outcome: 'unreachable', org: 'team-a' });
    r.answer(viewerOk());
    expect(view(await check(r))).toMatchObject({ state: 'connected', outcome: 'ok' });
  });

  it('each way the key file can fail is its own state, never not-connected', async () => {
    const cases: [string, (r: Rig) => void, LinearConnectionView][] = [
      // A directory where the file should be: present, and the read fails (EISDIR), the portable stand-in for EACCES.
      ['unreadable', (r) => mkdirSync(keyPath(r)), { state: 'unreadable' }],
      ['unusable', (r) => writeFileSync(keyPath(r), '# only a comment\n'), { state: 'unusable' }],
      ['placeholder', (r) => writeFileSync(keyPath(r), `${PLACEHOLDER_TOKEN}\n`), { state: 'placeholder' }],
    ];
    for (const [name, arrange, expected] of cases) {
      const r = await rig();
      arrange(r);
      expect(view(await get(r)), name).toEqual(expected);
      await r.app.close();
      open = null;
    }
  });

  it('a key with no details beside it is connected, details unknown, and says which way the details failed', async () => {
    const cases: [string, (r: Rig) => void][] = [
      ['absent', () => undefined],
      ['malformed', (r) => writeFileSync(detailsPath(r), '{not json')],
      ['unreadable', (r) => mkdirSync(detailsPath(r))],
      ['stale', (r) => writeFileSync(detailsPath(r), readFileSync(detailsPath(r), 'utf8').replace(/[0-9a-f]{64}/, 'a'.repeat(64)))],
    ];
    for (const [why, arrange] of cases) {
      const r = await rig();
      await connect(r);
      if (why === 'absent') await fsp.rm(detailsPath(r));
      if (why === 'unreadable') { await fsp.rm(detailsPath(r)); }
      arrange(r);
      expect(view(await get(r)), why).toEqual({ state: 'details-unknown', why });
      await r.app.close();
      open = null;
    }
  });

  it('details with no key (a half-finished Disconnect) read as not connected', async () => {
    const r = await rig();
    await connect(r);
    await fsp.rm(keyPath(r));
    expect(view(await get(r))).toEqual({ state: 'not-connected' });
  });

  it('never carries the key, in any state, and never its digest', async () => {
    const r = await rig();
    await connect(r);
    const digest = valueDigestHex(KEY);
    const bodies: string[] = [(await get(r)).body];
    r.answer(status(401));
    bodies.push((await check(r)).body);
    await fsp.rm(detailsPath(r));
    bodies.push((await get(r)).body);
    for (const b of bodies) {
      expect(b).not.toContain(KEY);
      expect(b).not.toContain(KEY.slice(0, -4));
      expect(b).not.toContain(digest);
    }
  });

  it('answers no-store', async () => {
    const r = await rig();
    expect((await get(r)).headers['cache-control']).toBe('no-store');
  });
});

describe('PUT and DELETE take the credential posture', () => {
  const writes: [string, (r: Rig) => Promise<LightMyRequestResponse>][] = [
    ['PUT', (r) => put(r, KEY)],
    ['DELETE', (r) => del(r)],
  ];

  for (const [name, act] of writes) {
    it(`${name} is refused while auth is unarmed, and nothing is asked or written`, async () => {
      const r = await rig({ enabled: false });
      const res = await act(r);
      expect(res.statusCode).toBe(501);
      expect(json(res)['error']).toBe('auth-off');
      expect(r.calls).toEqual([]);
      expect(files(r)).toEqual([]);
    });

    it(`${name} is refused from an insecure origin`, async () => {
      const r = await rig({ origin: 'http://box.example.invalid:7788' });
      await r.stamp();
      const res = await act(r);
      expect(res.statusCode).toBe(403);
      expect(json(res)['error']).toBe('insecure-origin');
      expect(r.calls).toEqual([]);
      expect(files(r)).toEqual([]);
    });

    it(`${name} is refused with no session`, async () => {
      const r = await rig();
      const res = await r.app.inject({ method: name as 'PUT' | 'DELETE', url: PATH, payload: { key: KEY } });
      expect(res.statusCode).toBe(401);
      expect(r.calls).toEqual([]);
    });

    it(`${name} is refused without a recent step-up, and nothing is asked or written`, async () => {
      const r = await rig();
      const res = await act(r);
      expect(res.statusCode).toBe(403);
      expect(json(res)['error']).toBe('step-up-required');
      expect(r.calls).toEqual([]);
      expect(files(r)).toEqual([]);
    });

    it(`${name} refuses before it reads the body: a bad key does not outrank the missing step-up`, async () => {
      const r = await rig();
      const res = await req(r, name as 'PUT' | 'DELETE', PATH, name === 'PUT' ? { key: 'x' } : undefined);
      expect(json(res)['error']).toBe('step-up-required');
    });

    it(`${name} does not need a ccd cap: an unmeasured fleet does not refuse it`, async () => {
      const r = await rig();
      await r.stamp();
      const res = await act(r);
      expect(res.statusCode, res.body).toBe(200);
    });
  }

  it('a PUT or DELETE refused for want of a step-up leaves a stored connection exactly as it was', async () => {
    const r = await rig();
    // Stored by hand, so this session has never stepped up.
    writeFileSync(keyPath(r), `${KEY}\n`, { mode: 0o600 });
    writeFileSync(detailsPath(r), `${JSON.stringify({
      v: 1, org: 'team-a', user: 'user-a', keyTail: '0001', keyDigest: valueDigestHex(KEY), checkedAt: NOW, outcome: 'ok',
    })}\n`, { mode: 0o600 });
    const before = [readFileSync(keyPath(r), 'utf8'), readFileSync(detailsPath(r), 'utf8')];
    for (const res of [await del(r), await put(r, KEY2)]) {
      expect(res.statusCode).toBe(403);
      expect(json(res)['error']).toBe('step-up-required');
    }
    expect([readFileSync(keyPath(r), 'utf8'), readFileSync(detailsPath(r), 'utf8')]).toEqual(before);
    expect(r.calls).toEqual([]);
  });

  it('GET and POST check are session reads: no step-up is asked of them', async () => {
    const r = await rig();
    expect((await get(r)).statusCode).toBe(200);
    // Nothing stored, so the check answers 409 not-connected, and never step-up-required.
    const res = await check(r);
    expect(res.statusCode).toBe(409);
    expect(json(res)['error']).toBe('not-connected');
  });

  it('every answer of all four routes is no-store, refusals included', async () => {
    const r = await rig();
    const all: LightMyRequestResponse[] = [
      await get(r), await check(r), await put(r, KEY), await del(r),
    ];
    await r.stamp();
    all.push(await put(r, 'x'), await put(r, KEY), await check(r), await del(r));
    for (const res of all) expect(res.headers['cache-control'], `${res.statusCode} ${res.body.slice(0, 50)}`).toBe('no-store');
  });
});

describe('PUT /api/linear/connection', () => {
  it('a key failing the shape rule or the length cap is 400 bad-key and Linear is never called', async () => {
    const r = await rig();
    await r.stamp();
    const bad = [
      '', 'short', 'a'.repeat(LINEAR_KEY_MIN_CHARS - 1), 'a'.repeat(LINEAR_KEY_MAX_CHARS + 1),
      `${KEY} `, ` ${KEY}`, `${KEY}\n`, `${KEY}\nsecond_line_value`, `#${KEY}`, `${KEY} extra`, 'lin_api_ünïcode_key_0001', `${KEY}\u0000`,
    ];
    for (const key of bad) {
      const res = await put(r, key);
      expect(res.statusCode, JSON.stringify(key)).toBe(400);
      expect(json(res), JSON.stringify(key)).toEqual({ ok: false, error: 'bad-key' });
    }
    expect(r.calls).toEqual([]);
    expect(files(r)).toEqual([]);
  });

  it('accepts a key exactly at the floor and exactly at the cap', async () => {
    for (const len of [LINEAR_KEY_MIN_CHARS, LINEAR_KEY_MAX_CHARS]) {
      const r = await rig();
      await r.stamp();
      const res = await put(r, 'k'.repeat(len));
      expect(res.statusCode, `${len}: ${res.body}`).toBe(200);
      await r.app.close();
      open = null;
    }
  });

  it('a body that is not {key: string} is 400 bad-request, in fixed words, without quoting the body', async () => {
    const r = await rig();
    await r.stamp();
    for (const payload of [{}, { key: 7 }, { key: null }, [KEY], `{"key":"${KEY}"`, `not json ${KEY}`]) {
      const res = await req(r, 'PUT', PATH, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(json(res)).toEqual({ ok: false, error: 'bad-request' });
      expect(res.body).not.toContain(KEY);
    }
    expect(r.calls).toEqual([]);
  });

  it('a body over its bound is refused before it is parsed', async () => {
    const r = await rig();
    await r.stamp();
    const res = await req(r, 'PUT', PATH, { key: KEY, pad: 'x'.repeat(4096) });
    expect(res.statusCode).toBe(413);
    expect(json(res)).toEqual({ ok: false, error: 'oversize' });
    expect(r.calls).toEqual([]);
  });

  it('a key Linear rejects is 400 key-rejected and NOTHING is written', async () => {
    const r = await rig();
    await r.stamp();
    r.answer(status(401));
    const res = await put(r, KEY);
    expect(res.statusCode).toBe(400);
    expect(json(res)).toEqual({ ok: false, error: 'key-rejected' });
    expect(res.body).not.toContain(LEAK);
    expect(files(r)).toEqual([]);
  });

  it('a key Linear forbids is 400 key-forbidden, its own word and not key-rejected, and NOTHING is written', async () => {
    const r = await rig();
    await r.stamp();
    r.answer(status(403));
    const res = await put(r, KEY);
    expect(res.statusCode).toBe(400);
    expect(json(res)).toEqual({ ok: false, error: 'key-forbidden' });
    expect(res.body).not.toContain(LEAK);
    expect(files(r)).toEqual([]);
  });

  it('a Linear that does not answer is 503, one word per arm, and NOTHING is written', async () => {
    const r = await rig({ timeoutMs: 20 });
    await r.stamp();
    const cases: [Parameters<Rig['answer']>[0], string][] = [
      [status(500), 'unreachable'],
      [status(429), 'unreachable'],
      [async () => { throw new Error(`connect ECONNREFUSED ${LEAK}`); }, 'unreachable'],
      [{ ok: true, status: 200, json: async () => ({ nope: LEAK }) }, 'malformed'],
      [{ ok: true, status: 200, json: async () => ({ data: { viewer: {}, organization: {} } }) }, 'malformed'],
      [{ ok: true, status: 200, json: async () => ({ errors: [{ message: LEAK }] }) }, 'unreachable'],
    ];
    for (const [ans, word] of cases) {
      r.answer(ans);
      const res = await put(r, KEY);
      expect(res.statusCode, word).toBe(503);
      expect(json(res), word).toEqual({ ok: false, error: word });
      expect(res.body).not.toContain(LEAK);
      expect(files(r), word).toEqual([]);
    }
    // The deadline: an answer that never comes is `timeout`, in well under a hung request.
    r.answer(() => new Promise<Answer>(() => undefined));
    const hung = await put(r, KEY);
    expect(hung.statusCode).toBe(503);
    expect(json(hung)).toEqual({ ok: false, error: 'timeout' });
    expect(files(r)).toEqual([]);
  });

  it('a good key asks Linear with the bare key and the viewer query, then writes both files at 0600', async () => {
    const r = await rig();
    await r.stamp();
    const res = await put(r, KEY);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({
      ok: true,
      connection: { state: 'connected', outcome: 'ok', org: 'team-a', user: 'user-a', keyTail: '0001', checkedAt: NOW },
    });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.auth).toBe(KEY);
    expect(r.calls[0]?.body).toContain('viewer');
    expect(r.calls[0]?.body).toContain('organization');
    expect(readFileSync(keyPath(r), 'utf8')).toBe(`${KEY}\n`);
    expect(statSync(keyPath(r)).mode & 0o777).toBe(0o600);
    expect(statSync(detailsPath(r)).mode & 0o777).toBe(0o600);
    const details = parseLinearDetails(readFileSync(detailsPath(r), 'utf8'));
    expect(details).toEqual({
      org: 'team-a', user: 'user-a', keyTail: '0001', keyDigest: valueDigestHex(KEY), checkedAt: NOW, outcome: 'ok',
    });
    // The details file is a display record: the key is in the key file alone.
    expect(readFileSync(detailsPath(r), 'utf8')).not.toContain(KEY);
    expect(res.body).not.toContain(KEY);
  });

  it('writes the key FIRST and the details second', async () => {
    const r = await rig();
    await r.stamp();
    const order: string[] = [];
    const real = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      order.push(path.basename(String(to)));
      return real(from, to);
    });
    expect((await put(r, KEY)).statusCode).toBe(200);
    expect(order).toEqual([LINEAR_KEY_FILE, LINEAR_DETAILS_FILE]);
  });

  it('a crash between the two writes leaves the key and no details: connected, details unknown', async () => {
    const r = await rig();
    await r.stamp();
    const real = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === LINEAR_DETAILS_FILE) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return real(from, to);
    });
    const res = await put(r, KEY);
    expect(res.statusCode).toBe(503);
    expect(json(res)).toEqual({ ok: false, error: 'write-failed' });
    vi.restoreAllMocks();
    expect(readFileSync(keyPath(r), 'utf8')).toBe(`${KEY}\n`);
    expect(view(await get(r))).toEqual({ state: 'details-unknown', why: 'absent' });
    // No temp file is left behind.
    expect(readdirSync(r.dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('a replace verifies the new key first: a rejected replacement leaves the old connection untouched', async () => {
    const r = await rig();
    await connect(r);
    const keyBefore = readFileSync(keyPath(r), 'utf8');
    const detailsBefore = readFileSync(detailsPath(r), 'utf8');
    r.answer(status(401));
    expect((await put(r, KEY2)).statusCode).toBe(400);
    expect(readFileSync(keyPath(r), 'utf8')).toBe(keyBefore);
    expect(readFileSync(detailsPath(r), 'utf8')).toBe(detailsBefore);
    r.answer(viewerOk('team-b', 'user-b'));
    const res = await put(r, KEY2);
    expect(view(res)).toMatchObject({ state: 'connected', org: 'team-b', user: 'user-b', keyTail: '0002' });
    expect(readFileSync(keyPath(r), 'utf8')).toBe(`${KEY2}\n`);
  });

  it('a replace of a rejected key connects again', async () => {
    const r = await rig();
    await connect(r);
    r.answer(status(401));
    expect(view(await check(r)).state).toBe('key-rejected');
    r.answer(viewerOk());
    expect(view(await put(r, KEY2))).toMatchObject({ state: 'connected', keyTail: '0002' });
  });

  it('cleans what Linear calls the organisation and the user, and bounds it', async () => {
    const r = await rig();
    await r.stamp();
    r.answer(viewerOk('Team\tA\n', `${'u'.repeat(200)}`));
    const v = view(await put(r, KEY));
    expect(v).toMatchObject({ state: 'connected', org: 'Team A' });
    expect(v.state === 'connected' ? v.user?.length : 0).toBe(80);
  });
});

describe('POST /api/linear/connection/check', () => {
  it('with no stored key it answers 409 not-connected and the view says which kind of nothing', async () => {
    const r = await rig();
    const res = await check(r);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toEqual({ ok: false, error: 'not-connected', connection: { state: 'not-connected' } });
    expect(r.calls).toEqual([]);
    mkdirSync(keyPath(r));
    const unreadable = await check(r);
    expect(unreadable.statusCode).toBe(409);
    expect(json(unreadable)['connection']).toEqual({ state: 'unreadable' });
    expect(r.calls).toEqual([]);
  });

  it('re-verifies the stored key and records the time and the outcome, leaving the key file alone', async () => {
    const r = await rig();
    await connect(r);
    const keyStat = statSync(keyPath(r));
    r.clock.now = NOW + 5 * 60_000;
    r.answer(viewerOk('team-a', 'user-a2'));
    const res = await check(r);
    expect(res.statusCode).toBe(200);
    expect(view(res)).toEqual({
      state: 'connected', outcome: 'ok', org: 'team-a', user: 'user-a2', keyTail: '0001', checkedAt: NOW + 5 * 60_000,
    });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.auth).toBe(KEY);
    expect(statSync(keyPath(r)).mtimeMs).toBe(keyStat.mtimeMs);
  });

  it('a check that finds the key rejected, or Linear down, keeps the names it knew and answers 200', async () => {
    const r = await rig();
    await connect(r);
    r.answer(status(401));
    const rejected = await check(r);
    expect(rejected.statusCode).toBe(200);
    expect(view(rejected)).toMatchObject({ state: 'key-rejected', org: 'team-a', user: 'user-a' });
    r.answer(async () => { throw new Error('down'); });
    expect(view(await check(r))).toMatchObject({ state: 'unreachable', org: 'team-a', user: 'user-a' });
  });

  it('a key with no details is checked into a full record (the details-unknown cure)', async () => {
    const r = await rig();
    await connect(r);
    await fsp.rm(detailsPath(r));
    expect(view(await get(r)).state).toBe('details-unknown');
    expect(view(await check(r))).toMatchObject({ state: 'connected', org: 'team-a', keyTail: '0001' });
  });

  it('a key with no details that Linear rejects is recorded rejected, with no names to show', async () => {
    const r = await rig();
    await connect(r);
    await fsp.rm(detailsPath(r));
    r.answer(status(401));
    expect(view(await check(r))).toMatchObject({ state: 'key-rejected', org: null, user: null, keyTail: '0001' });
  });

  it('a result for a key that was replaced while Linear was being asked is dropped', async () => {
    const r = await rig();
    await connect(r);
    // While the check is in flight, a Connect lands: the key file and its details become KEY2's.
    r.answer(async () => {
      writeFileSync(keyPath(r), `${KEY2}\n`);
      writeFileSync(detailsPath(r), `${JSON.stringify({
        v: 1, org: 'team-b', user: 'user-b', keyTail: '0002', keyDigest: valueDigestHex(KEY2), checkedAt: NOW, outcome: 'ok',
      })}\n`);
      return status(401);
    });
    const res = await check(r);
    // KEY's 401 must not condemn KEY2.
    expect(view(res)).toMatchObject({ state: 'connected', org: 'team-b', keyTail: '0002' });
  });

  it('never carries Linear\'s text or the key', async () => {
    const r = await rig();
    await connect(r);
    for (const ans of [status(401), status(500), { ok: true, status: 200, json: async () => ({ viewer: LEAK }) }]) {
      r.answer(ans);
      const res = await check(r);
      expect(res.body).not.toContain(LEAK);
      expect(res.body).not.toContain(KEY);
    }
  });
});

describe('DELETE /api/linear/connection', () => {
  it('removes the key FIRST, then the details, and answers not-connected', async () => {
    const r = await rig();
    await connect(r);
    const order: string[] = [];
    const real = fsp.rm.bind(fsp);
    vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => {
      order.push(path.basename(String(p)));
      return real(p, o);
    });
    const res = await del(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, connection: { state: 'not-connected' } });
    expect(order).toEqual([LINEAR_KEY_FILE, LINEAR_DETAILS_FILE]);
    expect(files(r)).toEqual([]);
  });

  it('a crash between the two removals leaves details with no key: not connected, and the next Disconnect finishes it', async () => {
    const r = await rig();
    await connect(r);
    const real = fsp.rm.bind(fsp);
    vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => {
      if (path.basename(String(p)) === LINEAR_DETAILS_FILE) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return real(p, o);
    });
    const res = await del(r);
    expect(res.statusCode).toBe(503);
    expect(json(res)).toEqual({ ok: false, error: 'write-failed' });
    vi.restoreAllMocks();
    expect(files(r)).toEqual([LINEAR_DETAILS_FILE]);
    expect(view(await get(r))).toEqual({ state: 'not-connected' });
    expect((await del(r)).statusCode).toBe(200);
    expect(files(r)).toEqual([]);
  });

  it('disconnecting a box that holds nothing is a success', async () => {
    const r = await rig();
    await r.stamp();
    const res = await del(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, connection: { state: 'not-connected' } });
  });

  it('removes a placeholder or unusable key file too: Disconnect is the way out of every state', async () => {
    const r = await rig();
    await r.stamp();
    writeFileSync(keyPath(r), `${PLACEHOLDER_TOKEN}\n`);
    writeFileSync(detailsPath(r), '{garbage');
    expect((await del(r)).statusCode).toBe(200);
    expect(files(r)).toEqual([]);
  });
});

describe('a Linear 401 on the resolve read marks the connection rejected (only for the key that earned it)', () => {
  const resolve = (r: Rig): Promise<LightMyRequestResponse> => req(r, 'GET', '/api/linear/resolve?ref=ENG-1234');

  it('marks a stored key rejected, so the next read of the section says so', async () => {
    const r = await rig();
    await connect(r);
    r.clock.now = NOW + 60_000;
    r.answer(status(401));
    const res = await resolve(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)['reason']).toBe('unauthorised');
    expect(view(await get(r))).toMatchObject({ state: 'key-rejected', org: 'team-a', keyTail: '0001', checkedAt: NOW + 60_000 });
  });

  it('does NOT mark when the key has been replaced since the lookup began', async () => {
    const r = await rig();
    await connect(r);
    r.answer(async () => {
      // The operator connects a new key while the lookup with the old one is in flight.
      writeFileSync(keyPath(r), `${KEY2}\n`);
      writeFileSync(detailsPath(r), `${JSON.stringify({
        v: 1, org: 'team-b', user: 'user-b', keyTail: '0002', keyDigest: valueDigestHex(KEY2), checkedAt: NOW, outcome: 'ok',
      })}\n`);
      return status(401);
    });
    await resolve(r);
    expect(view(await get(r))).toMatchObject({ state: 'connected', org: 'team-b', keyTail: '0002' });
  });

  it('does not mark on a failure that is not a 401, a 403 included (spec 5.1: only a 401 condemns the key)', async () => {
    const r = await rig();
    await connect(r);
    for (const ans of [status(403), status(502), status(429), { ok: true, status: 200, json: async () => ({ data: { issue: null } }) }]) {
      r.answer(ans);
      await resolve(r);
      expect(view(await get(r)).state).toBe('connected');
    }
  });

  it('a 401 with no details file records the rejection with no names', async () => {
    const r = await rig();
    await connect(r);
    await fsp.rm(detailsPath(r));
    r.answer(status(401));
    await resolve(r);
    expect(view(await get(r))).toMatchObject({ state: 'key-rejected', org: null, user: null, keyTail: '0001' });
  });

  it('a failed write never changes the resolve answer', async () => {
    const r = await rig();
    await connect(r);
    r.answer(status(401));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const real = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === LINEAR_DETAILS_FILE) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return real(from, to);
    });
    const res = await resolve(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)['reason']).toBe('unauthorised');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(KEY);
  });
});
