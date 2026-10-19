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
import { STEP_UP_FRESH_MS, isStepUpFresh } from '../../shared/accounts.js';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { STEP_UP_MAX_FAILURES, StepUpRateLimiter } from '../src/auth/ratelimit.js';
import { SECRET_UNREAD, measureSecret } from '../src/auth/gate.js';
import { createStepUp, type StepUpLockedEvent } from '../src/auth/stepup.js';
import { ChallengeStore } from '../src/auth/webauthn.js';
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

describe('the guard is bound to the SAME session (D-5512, spec §3.2)', () => {
  it("session A's step-up opens the guard for A and never for session B", async () => {
    const home = mkTmp('ccrc-step-up-two-');
    const store = new SessionStore(path.join(home, '.ccrc', 'sessions.json'));
    const t0 = 1_800_000_000_000;
    const a = (await store.create('device a', 1, t0)).token;
    const b = (await store.create('device b', 1, t0)).token;
    expect(await store.stampAsserted(sessionIdHash(a), t0)).toBe(true);
    const stepUp = createStepUp({
      enabled: true, store, passkeys: new PasskeyStore(path.join(home, '.ccrc', 'passkeys.json')),
      secretNow: () => SECRET_UNREAD, rpProblem: () => null, rpId: 'localhost', device: () => null,
      now: () => t0 + 1000,
    });
    const app = Fastify({ logger: false });
    const guard = stepUp.requireRecentAssertion();
    app.post('/probe', async (req, reply) => {
      if (guard(req, reply)) return;
      return { ok: true };
    });
    await app.ready();
    const probe = (token: string) =>
      app.inject({ method: 'POST', url: '/probe', headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    try {
      expect((await probe(a)).statusCode).toBe(200);
      const refused = await probe(b);
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused)).toBe('step-up-required');
      expect(stepUp.stepUpFreshUntil({ headers: { cookie: `${SESSION_COOKIE}=${b}` } })).toBeNull();
      expect(stepUp.stepUpFreshUntil({ headers: { cookie: `${SESSION_COOKIE}=${a}` } })).toBe(t0 + STEP_UP_FRESH_MS);
    } finally { await app.close(); }
  });

  it('a stamp survives a SessionStore reload (the guard reads it from disk after a restart)', async () => {
    const home = mkTmp('ccrc-step-up-reload-');
    const file = path.join(home, '.ccrc', 'sessions.json');
    const t0 = 1_800_000_000_000;
    const first = new SessionStore(file);
    const { token } = await first.create('a test device', 1, t0);
    expect(await first.stampAsserted(sessionIdHash(token), t0 + 5)).toBe(true);
    const second = new SessionStore(file);
    await second.load();
    expect(second.assertedAtOf(sessionIdHash(token))).toBe(t0 + 5);
  });

  it('a stamp later than now is not fresh (the clock stepped back)', () => {
    const now = 1_800_000_000_000;
    expect(isStepUpFresh(now + 1, now)).toBe(false);
    expect(isStepUpFresh(now, now)).toBe(true);
    expect(isStepUpFresh(undefined, now)).toBe(false);
  });
});

describe('the step-up budget and challenge slot (D-5512, D-5618)', () => {
  it('one step-up in flight per session: a second reserve is refused `busy` until the first releases', () => {
    const limiter = new StepUpRateLimiter();
    const first = limiter.reserve('a'.repeat(64));
    expect(first.ok).toBe(true);
    expect(limiter.reserve('a'.repeat(64))).toEqual({ ok: false, reason: 'busy' });
    // Another session is not held up by this one.
    const other = limiter.reserve('b'.repeat(64));
    expect(other.ok).toBe(true);
    if (first.ok) first.release();
    expect(limiter.reserve('a'.repeat(64)).ok).toBe(true);
  });

  it('a second start on one session invalidates its first challenge; another session keeps its own', () => {
    const store = new ChallengeStore('step-up');
    const now = 1_800_000_000_000;
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const firstA = store.issue(now, a);
    const onlyB = store.issue(now, b);
    const secondA = store.issue(now, a);
    expect(store.consume(firstA, now, a)).toBe(false);
    expect(store.consume(secondA, now, a)).toBe(true);
    expect(store.consume(onlyB, now, b)).toBe(true);
  });

  it('onStepUpLocked fires exactly once, with the session and its device, on the failure that locks', async () => {
    const home = mkTmp('ccrc-step-up-locked-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const store = new SessionStore(path.join(home, '.ccrc', 'sessions.json'));
    const { token } = await store.create('a test device', 1, Date.now());
    const secretPath = path.join(home, '.ccrc', 'auth.scrypt');
    writeFileSync(secretPath, `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const measured = measureSecret(secretPath);
    expect(measured.kind).toBe('ok');
    const events: StepUpLockedEvent[] = [];
    const passkeys = new PasskeyStore(path.join(home, '.ccrc', 'passkeys.json'));
    await passkeys.load();
    const stepUp = createStepUp({
      enabled: true, store, passkeys,
      secretNow: () => measured,
      rpProblem: () => null, rpId: 'localhost', device: () => 'a test device',
      onStepUpLocked: (e) => events.push(e),
    });
    const app = Fastify({ logger: false });
    app.post('/api/auth/step-up/passphrase', stepUp.passphrase);
    await app.ready();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const attempt = () => app.inject({
        method: 'POST', url: '/api/auth/step-up/passphrase',
        headers: { cookie: `${SESSION_COOKIE}=${token}` }, payload: { passphrase: 'wrong' },
      });
      for (let i = 0; i < STEP_UP_MAX_FAILURES - 1; i++) await attempt();
      expect(events).toHaveLength(0);
      await attempt();
      expect(events).toEqual([{ idHash: sessionIdHash(token), device: 'a test device' }]);
      expect(errorOf(await attempt())).toBe('step-up-locked');
      expect(events).toHaveLength(1);
    } finally { warn.mockRestore(); await app.close(); }
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

  it('every answer of every step-up route, each refusal included (box token, dark gate, unknown credential, locked), carries `Cache-Control: no-store`', async () => {
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
    // An unknown credential (the foreign-challenge refusal's no-store is checked in step-up-binding.test.ts).
    const bad = await armed.app.inject({
      method: 'POST', url: ROUTES[1]!, headers: { cookie },
      payload: { credentialIdB64url: 'AAAA', authenticatorDataB64url: 'AAAA', clientDataJsonB64url: 'AAAA', signatureB64url: 'AAAA' },
    });
    expect(bad.statusCode).toBe(403);
    noStore(bad, 'finish unknown credential');
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

  it('a percent-encoded step-up path still carries no-store (the router decodes it; the hook keys on the route)', async () => {
    const armed = await openApp(true); app = armed.app;
    const url = '/api/auth/step%2Dup/passphrase';
    const anon = await armed.app.inject({ method: 'POST', url });
    expect(anon.statusCode, anon.body).toBe(401);
    expect(anon.headers['cache-control'], 'anonymous').toBe('no-store');
    const cookie = await login(armed.app);
    const ok = await armed.app.inject({ method: 'POST', url, headers: { cookie }, payload: { passphrase: PASSPHRASE } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers['cache-control'], 'authed').toBe('no-store');
  });
});
