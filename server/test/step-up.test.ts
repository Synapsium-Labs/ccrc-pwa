/**
 * The step-up guard and the step-up routes' outer walls (D-5512; spec §3.2, §3.3; plan Task A5).
 *
 *  - `requireRecentAssertion` measures the five-minute window on a fake clock.
 *  - Each step-up route is session-only: a box token gets the gate's 401, a dark gate
 *    answers `auth-off`, and none of the three is in `EXEMPT`.
 *  - Every answer of every step-up route carries `Cache-Control: no-store`, the
 *    refusals included (they do not sit behind A7's account gate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { STEP_UP_FRESH_MS } from '../../shared/accounts.js';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { STEP_UP_MAX_FAILURES } from '../src/auth/ratelimit.js';
import { SECRET_UNREAD } from '../src/auth/gate.js';
import { createStepUp } from '../src/auth/stepup.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-for-the-step-up-suite';
const ROUTES = ['/api/auth/step-up/start', '/api/auth/step-up/finish', '/api/auth/step-up/passphrase'];

const stubPty = (): PtyLike => ({
  onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {},
});

const openApp = async (enabled: boolean): Promise<{ app: FastifyInstance; home: string }> => {
  const home = mkTmp('ccrc-step-up-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`,
    { mode: 0o600 });
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: enabled, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' },
    mailToken: BOX_TOKEN,
    spawnPty: stubPty,
  };
  const app = await buildServer(deps);
  await app.ready();
  return { app, home };
};

const login = async (app: FastifyInstance): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

const errorOf = (res: { body: string }): unknown => (JSON.parse(res.body) as { error?: unknown }).error;

describe('requireRecentAssertion (D-5512)', () => {
  it('requireRecentAssertion passes at 4:59 and refuses at 5:00 plus 1 ms', async () => {
    const home = mkTmp('ccrc-step-up-clock-');
    const store = new SessionStore(path.join(home, '.ccrc', 'sessions.json'));
    const t0 = 1_800_000_000_000;
    let clock = t0;
    const { token } = await store.create('a test device', 1, t0);
    expect(await store.stampAsserted(sessionIdHash(token), t0)).toBe(true);
    const stepUp = createStepUp({
      enabled: true, store, passkeys: new PasskeyStore(path.join(home, '.ccrc', 'passkeys.json')),
      secretNow: () => SECRET_UNREAD, rpProblem: () => null, rpId: 'localhost', device: () => null,
      now: () => clock,
    });
    const app = Fastify({ logger: false });
    const guard = stepUp.requireRecentAssertion();
    app.post('/probe', async (req, reply) => {
      if (guard(req, reply)) return;
      return { ok: true };
    });
    await app.ready();
    const probe = async (): Promise<number> =>
      (await app.inject({ method: 'POST', url: '/probe', headers: { cookie: `${SESSION_COOKIE}=${token}` } })).statusCode;
    try {
      expect(STEP_UP_FRESH_MS).toBe(5 * 60 * 1000);
      clock = t0 + 4 * 60 * 1000 + 59 * 1000;
      expect(await probe()).toBe(200);
      clock = t0 + STEP_UP_FRESH_MS - 1;
      expect(await probe()).toBe(200);
      // The window is the last five minutes: its edge is outside it.
      clock = t0 + STEP_UP_FRESH_MS;
      expect(await probe()).toBe(403);
      clock = t0 + STEP_UP_FRESH_MS + 1;
      const res = await app.inject({ method: 'POST', url: '/probe', headers: { cookie: `${SESSION_COOKIE}=${token}` } });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toBe('step-up-required');
      // No cookie at all, and a session never stepped up, are refused alike.
      expect((await app.inject({ method: 'POST', url: '/probe' })).statusCode).toBe(403);
      // The one reader `GET /api/accounts` will carry (A12).
      expect(stepUp.stepUpFreshUntil({ headers: { cookie: `${SESSION_COOKIE}=${token}` } }))
        .toBe(t0 + STEP_UP_FRESH_MS);
      expect(stepUp.stepUpFreshUntil({ headers: {} })).toBeNull();
    } finally { await app.close(); }
  });
});

describe('the step-up routes are session-only (D-5512, D-5511)', () => {
  let app: FastifyInstance | undefined;
  let warn: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    warn?.mockRestore();
  });

  it('each step-up route refuses a box token (401) and answers auth-off while the gate is dark', async () => {
    const armed = await openApp(true); app = armed.app;
    for (const url of ROUTES) {
      const res = await armed.app.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': BOX_TOKEN } });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(401);
      expect((JSON.parse(res.body) as { verdict?: unknown }).verdict).toBe('no-session');
    }
    await armed.app.close();
    const dark = await openApp(false); app = dark.app;
    for (const url of ROUTES) {
      const res = await dark.app.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': BOX_TOKEN } });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(501);
      expect(errorOf(res)).toBe('auth-off');
    }
  });

  it('no step-up route is in EXEMPT', () => {
    for (const url of ROUTES) expect(EXEMPT.has(`POST ${url}`), url).toBe(false);
    for (const k of EXEMPT.keys()) expect(k.includes('/step-up/'), k).toBe(false);
    // …and the gate sweep reads all three: `auth-gate.test.ts` scans `server.ts`'s
    // literal registrations, so each must be registered there, by its literal path.
    const src = readFileSync(path.join(here, '..', 'src', 'server.ts'), 'utf8');
    for (const url of ROUTES) expect(src.includes(`app.post('${url}'`), url).toBe(true);
  });

  it('every answer of every step-up route, each refusal included (box token, dark gate, bad challenge, locked), carries `Cache-Control: no-store`', async () => {
    const noStore = (res: { headers: Record<string, unknown> }, what: string): void => {
      expect(res.headers['cache-control'], what).toBe('no-store');
    };
    const armed = await openApp(true); app = armed.app;
    // Box token: the gate's own 401.
    for (const url of ROUTES) {
      noStore(await armed.app.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': BOX_TOKEN } }), `${url} box token`);
    }
    const cookie = await login(armed.app);
    // Successes.
    const start = await armed.app.inject({ method: 'POST', url: ROUTES[0]!, headers: { cookie } });
    expect(start.statusCode).toBe(200);
    noStore(start, 'start ok');
    const ok = await armed.app.inject({ method: 'POST', url: ROUTES[2]!, headers: { cookie }, payload: { passphrase: PASSPHRASE } });
    expect(ok.statusCode).toBe(200);
    noStore(ok, 'passphrase ok');
    // A bad challenge.
    const bad = await armed.app.inject({
      method: 'POST', url: ROUTES[1]!, headers: { cookie },
      payload: { credentialIdB64url: 'AAAA', authenticatorDataB64url: 'AAAA', clientDataJsonB64url: 'AAAA', signatureB64url: 'AAAA' },
    });
    expect(bad.statusCode).toBe(403);
    noStore(bad, 'finish bad challenge');
    // Locked.
    for (let i = 0; i < STEP_UP_MAX_FAILURES; i++) {
      noStore(await armed.app.inject({ method: 'POST', url: ROUTES[2]!, headers: { cookie }, payload: { passphrase: 'wrong' } }), 'wrong passphrase');
    }
    for (const url of ROUTES) {
      const locked = await armed.app.inject({ method: 'POST', url, headers: { cookie }, payload: { passphrase: PASSPHRASE } });
      expect(errorOf(locked), url).toBe('step-up-locked');
      noStore(locked, `${url} locked`);
    }
    await armed.app.close();
    // Dark.
    const dark = await openApp(false); app = dark.app;
    for (const url of ROUTES) noStore(await dark.app.inject({ method: 'POST', url }), `${url} dark`);
  });
});
