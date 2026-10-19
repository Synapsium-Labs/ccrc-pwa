/**
 * The account gate (D-5511; spec §3.2, §13; plan Task A7): the ONE chokepoint every account route calls first.
 *
 * Every case runs on a test-only fastify instance whose one route calls `accountGate` and nothing else. The
 * server's session gate (`installGate`) is deliberately NOT installed here: the account gate must refuse on its
 * own, so a route that some day lands in `EXEMPT`, or a gate that some day stops refusing, is still caught here.
 *
 * It refuses, in this order: a dark gate (`auth-off`, no loopback exception); a plain-HTTP non-loopback
 * `cfg.origin` (`insecure-origin`, from `cfg.origin` only); any verdict but `session` (401, a box token never
 * passes); a missing cap word (`501 unsupported`, refusing on no evidence); and, when asked, a stale step-up
 * (`step-up-required`). Every answer carries `Cache-Control: no-store`, refusals included.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ACCOUNT_GATE_REFUSALS } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { createAccountGate, accountOriginClass, type AccountGateDeps } from '../src/accounts/gate.js';
import { EXEMPT, measureSecret, sessionVerdict } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { createStepUp } from '../src/auth/stepup.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const BOX_TOKEN = 'box-token-for-the-account-gate-suite';
const CAP = 'cap-under-test';
const LOOPBACK_ORIGIN = 'http://localhost:7788';

interface Rig { app: FastifyInstance; cookie: string; stamp: () => Promise<void> }

interface RigOpts {
  enabled?: boolean;
  origin?: string;
  ccdVerbs?: string[] | null;
  noFleetState?: boolean;
  stepUp?: boolean;
}

/** One test-only app: one POST route that calls the chokepoint and answers `{ok: true}` when it passes. */
const rig = async (o: RigOpts = {}): Promise<Rig> => {
  const home = mkTmp('ccrc-account-gate-');
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
  const fleetState = o.noFleetState === true ? undefined : { ccdVerbs: o.ccdVerbs === undefined ? [CAP] : o.ccdVerbs };
  const deps: AccountGateDeps = {
    enabled,
    origin: o.origin ?? LOOPBACK_ORIGIN,
    sessionAuth: (req: FastifyRequest) => sessionVerdict(req, { enabled, secret: measureSecret(secretPath), store }, Date.now()),
    fleetState: () => fleetState,
    stepUp,
  };
  // The box token is in scope on purpose: it is what a session or `ccrc-api` holds, and the gate must refuse it.
  const gate = createAccountGate({ ...deps, mailToken: BOX_TOKEN } as AccountGateDeps);
  const app = Fastify({ logger: false });
  app.post('/api/accounts/under-test', async (req, reply) => {
    const ans = gate(req, reply, { cap: CAP, stepUp: o.stepUp === true });
    if (!ans.pass) return reply;
    return { ok: true };
  });
  await app.ready();
  return {
    app,
    cookie: `${SESSION_COOKIE}=${token}`,
    stamp: async () => { expect(await store.stampAsserted(sessionIdHash(token), Date.now())).toBe(true); },
  };
};

const post = (r: Rig, headers: Record<string, string> = { cookie: r.cookie }) =>
  r.app.inject({ method: 'POST', url: '/api/accounts/under-test', headers, payload: {} });

const errorOf = (res: { body: string }): unknown => (JSON.parse(res.body) as { error?: unknown }).error;

describe('the account gate (D-5511)', () => {
  it('the default deployment refuses: dark gate, default host and origin → auth-off', async () => {
    // The shipped defaults: `CCRC_AUTH` off, `CCRC_HOST` 127.0.0.1, `CCRC_ORIGIN` http://localhost:<port>, and the
    // request arriving over loopback (inject's remote address is 127.0.0.1). No loopback exception.
    const r = await rig({ enabled: false, origin: LOOPBACK_ORIGIN });
    const tries: Record<string, string>[] = [{}, { cookie: r.cookie }, { [MAIL_TOKEN_HEADER]: BOX_TOKEN }, { host: 'localhost:7788' }];
    for (const headers of tries) {
      const res = await post(r, headers);
      expect(res.statusCode, res.body).toBe(REFUSAL_STATUS['auth-off']);
      expect(errorOf(res)).toBe('auth-off');
    }
    await r.app.close();
  });

  it('gate armed, cfg.origin http:// and not loopback → insecure-origin; http://localhost and https:// pass', async () => {
    for (const origin of ['http://box.example.invalid:7788', 'http://203.0.113.7:7788', 'http://localhost.example.invalid']) {
      const r = await rig({ origin });
      const res = await post(r);
      expect(res.statusCode, origin).toBe(403);
      expect(errorOf(res), origin).toBe('insecure-origin');
      await r.app.close();
    }
    for (const origin of [LOOPBACK_ORIGIN, 'http://127.0.0.1:7788', 'http://[::1]:7788', 'https://box.example.invalid']) {
      const r = await rig({ origin });
      const res = await post(r);
      expect(res.statusCode, `${origin}: ${res.body}`).toBe(200);
      await r.app.close();
    }
  });

  it('the origin class is derived from cfg.origin alone', () => {
    expect(accountOriginClass('https://box.example.invalid')).toBe('https');
    expect(accountOriginClass('http://localhost:7788')).toBe('loopback');
    expect(accountOriginClass('http://127.0.0.1:7788')).toBe('loopback');
    expect(accountOriginClass('http://127.9.9.9')).toBe('loopback');
    expect(accountOriginClass('http://[::1]:7788')).toBe('loopback');
    expect(accountOriginClass('http://box.example.invalid')).toBe('insecure');
    expect(accountOriginClass('http://localhost.example.invalid')).toBe('insecure');
    expect(accountOriginClass('not a url')).toBe('insecure');
    expect(accountOriginClass('ftp://localhost')).toBe('insecure');
  });

  it('a forged Host or X-Forwarded-Proto: https changes nothing', async () => {
    const insecure = await rig({ origin: 'http://box.example.invalid:7788' });
    const forgeries: Record<string, string>[] = [
      { host: 'localhost:7788' },
      { host: '127.0.0.1:7788' },
      { 'x-forwarded-proto': 'https' },
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'localhost' },
      { host: 'localhost', 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' },
      { origin: 'https://box.example.invalid' },
    ];
    for (const forged of forgeries) {
      const res = await post(insecure, { cookie: insecure.cookie, ...forged });
      expect(res.statusCode, JSON.stringify(forged)).toBe(403);
      expect(errorOf(res)).toBe('insecure-origin');
    }
    await insecure.app.close();
    // And the other way round: an https origin is not demoted by a request that claims plain HTTP from elsewhere.
    const secure = await rig({ origin: 'https://box.example.invalid' });
    const res = await post(secure, { cookie: secure.cookie, host: 'evil.example.invalid', 'x-forwarded-proto': 'http' });
    expect(res.statusCode, res.body).toBe(200);
    await secure.app.close();
  });

  it('a box token answers 401; a session cookie passes', async () => {
    const r = await rig();
    const box = await post(r, { [MAIL_TOKEN_HEADER]: BOX_TOKEN });
    expect(box.statusCode, box.body).toBe(401);
    expect(errorOf(box)).toBe('unauthenticated');
    const bearer = await post(r, { authorization: `Bearer ${BOX_TOKEN}` });
    expect(bearer.statusCode).toBe(401);
    const none = await post(r, {});
    expect(none.statusCode).toBe(401);
    const dead = await post(r, { cookie: `${SESSION_COOKIE}=not-a-live-session` });
    expect(dead.statusCode).toBe(401);
    const ok = await post(r);
    expect(ok.statusCode, ok.body).toBe(200);
    await r.app.close();
  });

  it('with the cap word absent the answer is 501 unsupported; an unmeasured fleet state refuses too', async () => {
    for (const o of [{ ccdVerbs: ['account-v1', 'stop-surface'] }, { ccdVerbs: [] }, { ccdVerbs: null }, { noFleetState: true }]) {
      const r = await rig(o);
      const res = await post(r);
      expect(res.statusCode, JSON.stringify(o)).toBe(501);
      expect(errorOf(res)).toBe('unsupported');
      await r.app.close();
    }
    const r = await rig({ ccdVerbs: ['account-v1', CAP] });
    expect((await post(r)).statusCode).toBe(200);
    await r.app.close();
  });

  it('asked for a step-up, a session that has none refuses step-up-required; a fresh one passes', async () => {
    const r = await rig({ stepUp: true });
    const stale = await post(r);
    expect(stale.statusCode).toBe(403);
    expect(errorOf(stale)).toBe('step-up-required');
    await r.stamp();
    expect((await post(r)).statusCode).toBe(200);
    await r.app.close();
  });

  it('the refusals come in their order: dark, then origin, then the verdict, then the cap, then the step-up', async () => {
    const dark = await rig({ enabled: false, origin: 'http://box.example.invalid', ccdVerbs: null, stepUp: true });
    expect(errorOf(await post(dark, {}))).toBe('auth-off');
    await dark.app.close();
    const insecure = await rig({ origin: 'http://box.example.invalid', ccdVerbs: null, stepUp: true });
    expect(errorOf(await post(insecure, {}))).toBe('insecure-origin');
    await insecure.app.close();
    const anon = await rig({ ccdVerbs: null, stepUp: true });
    expect(errorOf(await post(anon, {}))).toBe('unauthenticated');
    expect(errorOf(await post(anon))).toBe('unsupported');
    await anon.app.close();
  });

  it('every answer carries Cache-Control: no-store, a refusal included', async () => {
    const cases: Array<[RigOpts, Record<string, string> | null, number]> = [
      [{ enabled: false }, null, 501],
      [{ origin: 'http://box.example.invalid' }, null, 403],
      [{}, {}, 401],
      [{ ccdVerbs: null }, null, 501],
      [{ stepUp: true }, null, 403],
      [{}, null, 200],
    ];
    for (const [o, headers, status] of cases) {
      const r = await rig(o);
      const res = await post(r, headers ?? { cookie: r.cookie });
      expect(res.statusCode, JSON.stringify(o)).toBe(status);
      expect(res.headers['cache-control'], JSON.stringify(o)).toBe('no-store');
      await r.app.close();
    }
  });

  it('no account route is ever in EXEMPT, so the install gate\'s Origin (CSRF) check always runs before it (D-5621)', () => {
    // The account gate restates the session check but not the request-Origin check: that one is `installGate`'s,
    // which skips the exempt routes. An account route in EXEMPT would therefore lean on SameSite=Lax alone.
    const accountKeys = [...EXEMPT.keys()].filter((k) => /^[A-Z]+ \/api\/accounts?(\/|$)/.test(k.replace(/\?.*$/, '')));
    expect(accountKeys).toEqual([]);
  });

  it('every gate refusal word has its one status', () => {
    expect([...ACCOUNT_GATE_REFUSALS].sort()).toEqual(['auth-off', 'insecure-origin', 'step-up-required', 'unauthenticated', 'unsupported']);
    expect(ACCOUNT_GATE_REFUSALS.map((w) => [w, REFUSAL_STATUS[w]])).toEqual([
      ['auth-off', 501], ['insecure-origin', 403], ['unauthenticated', 401], ['unsupported', 501], ['step-up-required', 403],
    ]);
  });
});
