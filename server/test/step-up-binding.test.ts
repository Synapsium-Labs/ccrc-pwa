/**
 * Step-up that keeps the session (D-5512; spec §3.2, §16 "Step-up binding"; plan Task A5).
 *
 * Against the REAL fastify app with the gate armed by a test passphrase: the three
 * step-up routes stamp `assertedAt` on the requesting session and nothing else. They
 * mint no session, set no cookie and keep `generation`; a challenge is bound to the
 * session that started it; the passphrase arm is refused once a passkey exists; and
 * the step-up budget is per session and is not the login door's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { COSE_ES256 } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { STEP_UP_MAX_FAILURES } from '../src/auth/ratelimit.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:7788';

const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();
const b64 = (b: Buffer): string => b.toString('base64url');

/** One simulated authenticator: a real P-256 key and the byte layouts a real one sends. */
function makeAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const credentialId = randomBytes(32);
  const authData = (flags: number, signCount: number, attested?: Buffer): Buffer => {
    const head = Buffer.alloc(37);
    sha256(Buffer.from(RP_ID, 'utf8')).copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(signCount, 33);
    return attested ? Buffer.concat([head, attested]) : head;
  };
  const clientData = (type: string, challenge: string): Buffer =>
    Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }), 'utf8');
  const sign = (ad: Buffer, cd: Buffer): Buffer =>
    createSign('SHA256').update(Buffer.concat([ad, sha256(cd)])).end().sign(privateKey);
  return {
    register(challenge: string) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credentialId.length, 0);
      const attested = Buffer.concat([randomBytes(16), len, credentialId, randomBytes(77)]);
      return {
        credentialIdB64url: b64(credentialId), publicKeySpkiB64url: b64(spki), algorithm: COSE_ES256,
        authenticatorDataB64url: b64(authData(0x01 | 0x04 | 0x40, 0, attested)),
        clientDataJsonB64url: b64(clientData('webauthn.create', challenge)),
      };
    },
    assert(challenge: string, signCount: number) {
      const ad = authData(0x01 | 0x04, signCount);
      const cd = clientData('webauthn.get', challenge);
      return {
        credentialIdB64url: b64(credentialId), authenticatorDataB64url: b64(ad),
        clientDataJsonB64url: b64(cd), signatureB64url: b64(sign(ad, cd)),
      };
    },
  };
}
type Authenticator = ReturnType<typeof makeAuthenticator>;

const stubPty = (): PtyLike => ({
  onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {},
});

const openApp = async (opts: { passkeysFile?: string } = {}): Promise<{ app: FastifyInstance; home: string }> => {
  const home = mkTmp('ccrc-step-up-binding-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  // A passkey file the server finds at boot, as bytes (a corrupt one, for the `unmeasured` case).
  if (opts.passkeysFile !== undefined) writeFileSync(base.cfg.passkeysPath, opts.passkeysFile, { mode: 0o600 });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`,
    { mode: 0o600 });
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: RP_ID, origin: ORIGIN },
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

/** The session id hash a cookie names — what the store keeps in place of the token. */
const idHashOf = (cookie: string): string =>
  createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest('hex');

interface Row { idHash: string; generation: number; assertedAt?: number }
const rows = (home: string): Row[] =>
  JSON.parse(readFileSync(path.join(home, '.ccrc', 'sessions.json'), 'utf8')) as Row[];
const rowOf = (home: string, cookie: string): Row | undefined => rows(home).find((r) => r.idHash === idHashOf(cookie));

const enrol = async (app: FastifyInstance, auth: Authenticator, cookie: string): Promise<void> => {
  const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/start', headers: { cookie } });
  expect(start.statusCode, start.body).toBe(200);
  const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
  const finish = await app.inject({
    method: 'POST', url: '/api/auth/passkey/register/finish', headers: { cookie }, payload: auth.register(challengeB64url),
  });
  expect(finish.statusCode, finish.body).toBe(204);
};

const stepUpStart = async (app: FastifyInstance, cookie: string): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/step-up/start', headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { challengeB64url: string }).challengeB64url;
};

const passphraseStepUp = (app: FastifyInstance, cookie: string, passphrase = PASSPHRASE) =>
  app.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', headers: { cookie }, payload: { passphrase } });

const errorOf = (res: { body: string }): unknown => (JSON.parse(res.body) as { error?: unknown }).error;

describe('step-up keeps the session (D-5512)', () => {
  let app: FastifyInstance | undefined;
  let warn: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    warn?.mockRestore();
  });

  it('finish stamps assertedAt on this session only, sets no cookie, creates no session row and keeps generation', async () => {
    const w = await openApp(); app = w.app;
    const a = await login(app);
    const b = await login(app);
    const auth = makeAuthenticator();
    await enrol(app, auth, a);
    const before = rows(w.home);
    expect(before).toHaveLength(2);

    const challenge = await stepUpStart(app, a);
    const finish = await app.inject({
      method: 'POST', url: '/api/auth/step-up/finish', headers: { cookie: a }, payload: auth.assert(challenge, 1),
    });
    expect(finish.statusCode, finish.body).toBe(200);
    expect(finish.headers['set-cookie']).toBeUndefined();
    const body = JSON.parse(finish.body) as { ok: boolean; stepUpFreshUntil: number };
    expect(body.ok).toBe(true);

    const after = rows(w.home);
    expect(after).toHaveLength(2);
    expect(after.map((r) => r.idHash).sort()).toEqual(before.map((r) => r.idHash).sort());
    expect(after.map((r) => r.generation)).toEqual([1, 1]);
    const rowA = rowOf(w.home, a)!;
    expect(typeof rowA.assertedAt).toBe('number');
    expect(body.stepUpFreshUntil).toBe(rowA.assertedAt! + 5 * 60 * 1000);
    expect(rowOf(w.home, b)!.assertedAt).toBeUndefined();
    // The same cookie still opens the gate: nothing was rotated.
    const still = await app.inject({ method: 'GET', url: '/api/auth/passkeys', headers: { cookie: a } });
    expect(still.statusCode).toBe(200);
  });

  it('a challenge started by session A is refused when session B finishes it', async () => {
    const w = await openApp(); app = w.app;
    const a = await login(app);
    const b = await login(app);
    const auth = makeAuthenticator();
    await enrol(app, auth, a);

    const challenge = await stepUpStart(app, a);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/step-up/finish', headers: { cookie: b }, payload: auth.assert(challenge, 1),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('step-up-required');
    // The foreign-challenge refusal is an answer of a step-up route too: no-store (spec §3.3).
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rowOf(w.home, a)!.assertedAt).toBeUndefined();
    expect(rowOf(w.home, b)!.assertedAt).toBeUndefined();
    // …and B's own challenge, finished by B, is accepted: the refusal was the binding.
    const own = await stepUpStart(app, b);
    const ok = await app.inject({
      method: 'POST', url: '/api/auth/step-up/finish', headers: { cookie: b }, payload: auth.assert(own, 2),
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('the passphrase arm keeps the session, and is refused passkey-enrolled once any passkey exists', async () => {
    const w = await openApp(); app = w.app;
    const a = await login(app);
    const before = rows(w.home);

    const res = await passphraseStepUp(app, a);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const after = rows(w.home);
    expect(after.map((r) => r.idHash)).toEqual(before.map((r) => r.idHash));
    expect(after[0]!.generation).toBe(1);
    expect(typeof after[0]!.assertedAt).toBe('number');

    await enrol(app, makeAuthenticator(), a);
    const refused = await passphraseStepUp(app, a);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused)).toBe('passkey-enrolled');
  });

  it('a passkey store this process cannot read refuses the passphrase arm `unmeasured` and stamps nothing', async () => {
    // A corrupt passkeys.json reads as `count() === 0` (D-132), so without the state check this box, which
    // HAS a passkey enrolled, would open the weaker factor: the step-down `passkey-enrolled` exists to stop.
    const w = await openApp({ passkeysFile: '{"this is": "somebody\'s credentials, garbled' }); app = w.app;
    const a = await login(app);
    const res = await passphraseStepUp(app, a);
    expect(res.statusCode, res.body).toBe(502);
    expect(errorOf(res)).toBe('unmeasured');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rowOf(w.home, a)!.assertedAt).toBeUndefined();
  });

  it('two concurrent passphrase step-ups on one session: one runs, the other is refused `rate-limited`', async () => {
    const w = await openApp(); app = w.app;
    const a = await login(app);
    const [one, two] = await Promise.all([
      passphraseStepUp(app, a, 'not the passphrase'),
      passphraseStepUp(app, a, 'not the passphrase'),
    ]);
    const codes = [one, two].map((r) => [r.statusCode, errorOf(r)]);
    expect(codes).toContainEqual([403, 'step-up-required']);
    expect(codes).toContainEqual([429, 'rate-limited']);
    // Only the one that ran was counted: four failures remain before the lock.
    for (let i = 0; i < STEP_UP_MAX_FAILURES - 2; i++) {
      expect((await passphraseStepUp(app, a, 'not the passphrase')).statusCode).toBe(403);
    }
    expect((await passphraseStepUp(app, a)).statusCode).toBe(200);
  });

  it('an exhausted step-up limiter locks this session (`step-up-locked`), and session B still steps up', async () => {
    const w = await openApp(); app = w.app;
    const a = await login(app);
    const b = await login(app);
    for (let i = 0; i < STEP_UP_MAX_FAILURES; i++) {
      const wrong = await passphraseStepUp(app, a, 'not the passphrase');
      expect(wrong.statusCode, wrong.body).toBe(403);
      expect(errorOf(wrong)).toBe('step-up-required');
    }
    // Locked: even the right passphrase is refused for this session.
    const locked = await passphraseStepUp(app, a);
    expect(locked.statusCode, locked.body).toBe(429);
    expect(errorOf(locked)).toBe('step-up-locked');
    const lockedStart = await app.inject({ method: 'POST', url: '/api/auth/step-up/start', headers: { cookie: a } });
    expect(errorOf(lockedStart)).toBe('step-up-locked');
    expect(rowOf(w.home, a)!.assertedAt).toBeUndefined();

    const other = await passphraseStepUp(app, b);
    expect(other.statusCode, other.body).toBe(200);
    expect(typeof rowOf(w.home, b)!.assertedAt).toBe('number');
  });

  it("failed step-ups leave `LoginRateLimiter`'s budget untouched", async () => {
    const w = await openApp(); app = w.app;
    const a = await login(app);
    const b = await login(app);
    // More failures than the login door's whole window allows (eight), spread over two
    // sessions so neither one's own lock stops the count first.
    let failures = 0;
    for (const cookie of [a, b]) {
      for (let i = 0; i < STEP_UP_MAX_FAILURES; i++) {
        const wrong = await passphraseStepUp(app, cookie, 'not the passphrase');
        expect(wrong.statusCode, wrong.body).toBe(403);
        failures++;
      }
    }
    expect(failures).toBeGreaterThan(8);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
  });
});
