// The three `/api/auth/*` routes, the cookie they hand out, and the four config
// keys that arm the whole thing.
//
// `auth-gate.test.ts` is the sweep — it asserts the PROPERTY that every route is
// covered. This file asserts the BEHAVIOUR of the surface that lets a person
// through it: what the Set-Cookie line actually says, what a wrong passphrase
// costs, what a logout revokes, and what the status route reports.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inspect } from 'node:util';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { SESSION_COOKIE, expireCookie, parseCookies, serializeCookie } from '../src/auth/cookie.js';
import { ABSOLUTE_TTL_MS, SessionStore } from '../src/auth/sessions.js';
import { MAX_FAILURES } from '../src/auth/ratelimit.js';
import { AuthSecretUnusable, hashLine, readAuthSecret, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** See `auth-gate.test.ts`'s note: the shipped cost factor is the brute-force
 *  brake and belongs in production, not in a suite that logs in forty times. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

const stubPty = (): PtyLike => ({
  onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {},
});

interface AppOpts { enabled?: boolean; secret?: boolean; secretText?: string; cookieSecure?: boolean }

const openApp = async (opts: AppOpts = {}): Promise<{ app: FastifyInstance; home: string }> => {
  const home = mkTmp('ccrc-auth-routes-');
  const base = testDeps(home);
  if (opts.secretText !== undefined || opts.secret !== false) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      opts.secretText ?? `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: opts.enabled ?? true, cookieSecure: opts.cookieSecure ?? false },
    spawnPty: stubPty,
  };
  return { app: await buildServer(deps), home };
};

const postLogin = (app: FastifyInstance, passphrase: unknown) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase } as Record<string, unknown> });

const setCookieOf = (res: { headers: Record<string, unknown> }): string => {
  const set = res.headers['set-cookie'];
  return Array.isArray(set) ? String(set[0]) : String(set);
};

const cookieHeader = (line: string): string => line.slice(0, line.indexOf(';'));

// ── the cookie, on its own ───────────────────────────────────────────────

describe('serializeCookie', () => {
  it('always carries HttpOnly, SameSite=Lax, Path=/ and a Max-Age', () => {
    const line = serializeCookie(SESSION_COOKIE, 'tok', { secure: false, maxAgeSeconds: 90 });
    expect(line).toContain(`${SESSION_COOKIE}=tok`);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    expect(line).toContain('Max-Age=90');
  });

  it('adds Secure only when the CALLER says so — there is no other input', () => {
    expect(serializeCookie('c', 'v', { secure: true, maxAgeSeconds: 1 })).toContain('Secure');
    expect(serializeCookie('c', 'v', { secure: false, maxAgeSeconds: 1 })).not.toContain('Secure');
  });

  it('floors and clamps Max-Age rather than emitting a fraction or a negative', () => {
    expect(serializeCookie('c', 'v', { secure: false, maxAgeSeconds: 1.9 })).toContain('Max-Age=1');
    expect(serializeCookie('c', 'v', { secure: false, maxAgeSeconds: -5 })).toContain('Max-Age=0');
  });

  it('expireCookie is the same line with Max-Age=0 and an empty value', () => {
    // Built through the SAME function on purpose: a browser only replaces a
    // cookie whose name/Path/Domain match, so an expiry line assembled
    // separately could drift and leave a dead token in the jar for ever.
    const gone = expireCookie(SESSION_COOKIE, { secure: true });
    expect(gone).toContain(`${SESSION_COOKIE}=;`);
    expect(gone).toContain('Max-Age=0');
    expect(gone).toContain('Path=/');
    expect(gone).toContain('HttpOnly');
    expect(gone).toContain('Secure');
  });
});

describe('parseCookies', () => {
  it('reads a multi-cookie header, trimming the spaces browsers send', () => {
    const jar = parseCookies('a=1; ccrc_session=tok; b=2');
    expect(jar.get('a')).toBe('1');
    expect(jar.get(SESSION_COOKIE)).toBe('tok');
    expect(jar.get('b')).toBe('2');
  });

  it('takes the FIRST of a duplicated name — the order the browser chose, not a defence', () => {
    expect(parseCookies('ccrc_session=mine; ccrc_session=theirs').get(SESSION_COOKIE)).toBe('mine');
    // NOT anti-shadowing, and the docstring says so (review Important 4 corrected
    // the claim that it was): RFC 6265 §5.4 orders by DESCENDING path length, and
    // our cookie is pinned at `Path=/` — the shortest — so a shadow set for a
    // longer path arrives FIRST and is what this returns. What is guaranteed is
    // that a shadow cannot become a bypass: whatever comes back still has to
    // survive `SessionStore.verify`, so the worst case is a 401.
    expect(parseCookies('ccrc_session=longer-path-shadow; ccrc_session=ours').get(SESSION_COOKIE))
      .toBe('longer-path-shadow');
  });

  it('never throws on a header a browser (or an attacker) can send', () => {
    for (const header of ['', 'nonsense', '=novalue', 'a', 'a=%E0%A4%A', 'a=1;;b=2', '   ']) {
      expect(() => parseCookies(header)).not.toThrow();
    }
    // A throw here would be a 500 from inside the gate — the wrong polarity for
    // a hook whose only correct refusal is a 401.
    expect(parseCookies('a=%E0%A4%A').get('a')).toBe('%E0%A4%A');
    expect(parseCookies(undefined).size).toBe(0);
  });

  it('strips a DQUOTE-wrapped value, and round-trips what serializeCookie writes', () => {
    expect(parseCookies('a="quoted"').get('a')).toBe('quoted');
    const line = serializeCookie(SESSION_COOKIE, 'aB-9_xyz', { secure: false, maxAgeSeconds: 1 });
    expect(parseCookies(cookieHeader(line)).get(SESSION_COOKIE)).toBe('aB-9_xyz');
  });

  it('is a Map, so a `__proto__` cookie cannot pollute anything', () => {
    const jar = parseCookies('__proto__=polluted; a=1');
    expect(jar.get('__proto__')).toBe('polluted');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

// ── POST /api/auth/login ─────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; vi.restoreAllMocks(); });

  it('answers 501 not-configured when the gate is not armed', async () => {
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    const res = await postLogin(app, PASSPHRASE);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('answers 400 on a body that is not {passphrase: a non-empty string}', async () => {
    const w = await openApp(); app = w.app;
    for (const bad of [undefined, '', 42, null, {}]) {
      const res = await postLogin(app, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
  });

  it('answers 401 `wrong` for a passphrase that does not verify', async () => {
    const w = await openApp(); app = w.app;
    const res = await postLogin(app, 'not the passphrase');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated', verdict: 'wrong' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 401 `unconfigured` — not `wrong` — on a box with no passphrase file', async () => {
    // The distinction IS the feature: nothing the operator types will ever match,
    // so the screen must say `ccrc passwd`, not "try again".
    const w = await openApp({ secret: false }); app = w.app;
    const res = await postLogin(app, PASSPHRASE);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ verdict: 'unconfigured' });
  });

  it('answers 401 `unconfigured` when the file breaks while the server runs, and says so once', async () => {
    const w = await openApp(); app = w.app;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(path.join(w.home, '.ccrc', 'auth.scrypt'), 'garbage\n');
    const res = await postLogin(app, PASSPHRASE);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ verdict: 'unconfigured' });
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('auth.scrypt'))).toBe(true);
    // …and the journal never carries the secret, the guess, or the contents.
    for (const l of lines) expect(l).not.toContain(PASSPHRASE);
  });

  it('answers 204 with a Set-Cookie and NO body on success', async () => {
    const w = await openApp(); app = w.app;
    const res = await postLogin(app, PASSPHRASE);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const line = setCookieOf(res);
    expect(line.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    // The browser's own copy of the session's ABSOLUTE ttl, derived from the
    // store's constant rather than a number typed twice.
    expect(line).toContain(`Max-Age=${Math.floor(ABSOLUTE_TTL_MS / 1000)}`);
  });

  it('never puts the passphrase or the minted token in a log line', async () => {
    const w = await openApp(); app = w.app;
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const)
      .map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const res = await postLogin(app, PASSPHRASE);
    const token = cookieHeader(setCookieOf(res)).slice(SESSION_COOKIE.length + 1);
    expect(token.length).toBeGreaterThan(20);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const text = call.map((a) => String(a)).join(' ');
        expect(text).not.toContain(PASSPHRASE);
        expect(text).not.toContain(token);
      }
    }
  });

  describe('the Secure attribute comes from CONFIG, never from the request', () => {
    it('is set on an http request when cookieSecure is on — the behind-a-proxy case', async () => {
      // `tailscale serve` (and Caddy in 3b) speaks https to the browser and
      // plain http to this process. `app.inject` is that plain-http hop. A
      // `Secure` derived from `req.protocol` would be DROPPED here — on exactly
      // the deployment that needs it — and the flag would look fine in dev.
      const w = await openApp({ cookieSecure: true }); app = w.app;
      const res = await postLogin(app, PASSPHRASE);
      expect(res.statusCode).toBe(204);
      expect(setCookieOf(res)).toContain('Secure');
    });

    it('is absent under the explicit localhost-http dev opt-out', async () => {
      const w = await openApp({ cookieSecure: false }); app = w.app;
      const res = await postLogin(app, PASSPHRASE);
      expect(setCookieOf(res)).not.toContain('Secure');
    });
  });

  describe('the rate limiter', () => {
    it('locks after the window\'s failure budget and answers 429 with Retry-After', async () => {
      const w = await openApp(); app = w.app;
      for (let i = 0; i < MAX_FAILURES; i++) {
        expect((await postLogin(app, 'wrong')).statusCode, `attempt ${i + 1}`).toBe(401);
      }
      const locked = await postLogin(app, 'wrong');
      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toMatchObject({ ok: false, verdict: 'locked-out' });
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      // …and the brake is AHEAD of the passphrase check: even the CORRECT
      // passphrase is refused while the window is closed, which is what makes it
      // a brake rather than an oracle.
      expect((await postLogin(app, PASSPHRASE)).statusCode).toBe(429);
    });

    it('bounds CONCURRENT logins, not just sequential ones (review Important 1)', async () => {
      // THE DEFECT THIS PINS: the brake used to `check()` — a pure read of a
      // counter that only moves ~100 ms later, when the scrypt derivation
      // resolves and `fail()` runs. Every test above is `for (…) await …`, i.e.
      // strictly sequential, so all of them stayed green while N requests fired
      // AT ONCE all read `count === 0`, all passed, and all queued a 64 MiB
      // derivation onto libuv's 4-slot threadpool — starving every `fs/promises`
      // caller in the server. `reserve()` takes the slot at admission, so the
      // budget shrinks as callers are let in rather than as they finish.
      const w = await openApp(); app = w.app;
      const burst = MAX_FAILURES * 4;
      const results = await Promise.all(
        Array.from({ length: burst }, () => postLogin(app!, 'wrong')),
      );
      const admitted = results.filter((r) => r.statusCode === 401).length;
      const refused = results.filter((r) => r.statusCode === 429).length;
      expect(admitted + refused).toBe(burst);
      // At most the budget's worth of derivations were ever admitted; the rest
      // were refused without spending any scrypt at all.
      expect(admitted).toBeLessThanOrEqual(MAX_FAILURES);
      expect(refused).toBeGreaterThanOrEqual(burst - MAX_FAILURES);
    });

    it('gives every slot back — a leaked one would brick login until restart', async () => {
      // A slot never times out, so `MAX_FAILURES` leaks are permanent. Each of
      // these bursts drives a DIFFERENT early exit out of the handler: a 400 on a
      // malformed body, and a 401 on a box with no passphrase file. Neither is a
      // failure (the window is untouched), so if the slot were not released in a
      // `finally` the budget would simply never refill and the correct passphrase
      // below would 429.
      const w = await openApp(); app = w.app;
      await Promise.all(Array.from({ length: MAX_FAILURES * 3 }, () => postLogin(app!, 42)));
      expect((await postLogin(app, PASSPHRASE)).statusCode, 'after a burst of 400s').toBe(204);

      const bare = await openApp({ secret: false });
      try {
        await Promise.all(Array.from({ length: MAX_FAILURES * 3 },
          () => postLogin(bare.app, PASSPHRASE)));
        // Still `unconfigured`, never `locked-out`: the slots came back.
        expect((await postLogin(bare.app, PASSPHRASE)).json()).toMatchObject({ verdict: 'unconfigured' });
      } finally { await bare.app.close(); }
    });

    it('gives the slot back when the handler THROWS, not only when it returns', async () => {
      // RE-ANCHORED (review R5): this used to reach the throw with a secret line
      // that PARSED but that `crypto.scrypt` refused — a huge `p`. Bounding `p`
      // in `secret.ts` closed that door on purpose (it was an hour-long login,
      // not merely a 500), so the lever is now an injected failure at the LAST
      // await inside the try: `SessionStore.create`, which the route reaches only
      // after a correct passphrase and after `succeed()` has already reset the
      // window. That makes this test purely about the `finally` — the failure
      // counter cannot be what refuses, because nothing here is a failure.
      const w = await openApp(); app = w.app;
      const spy = vi.spyOn(SessionStore.prototype, 'create').mockRejectedValue(new Error('disk on fire'));
      try {
        for (let i = 0; i < MAX_FAILURES + 2; i++) {
          expect((await postLogin(app, PASSPHRASE)).statusCode, `throw ${i + 1}`).toBe(500);
        }
        // MAX_FAILURES + 2 throws and the budget is untouched: every slot came
        // back through the `finally`. Without it the 9th call would have been a
        // 429, and login would stay bricked until the process restarted.
        expect((await postLogin(app, PASSPHRASE)).statusCode).toBe(500);
      } finally {
        // Review F3. A PROTOTYPE spy is global state, and `vitest.config` sets no
        // `restoreMocks` — so an assertion failing above would have leaked a
        // permanently-rejecting `SessionStore.create` into every later test in
        // this file and cascaded one real failure into a dozen confusing ones.
        // The same discipline the route under test uses, for the same reason.
        spy.mockRestore();
      }
      // …and once the injected failure is gone, login works again — proving the
      // 500s left nothing behind.
      expect((await postLogin(app, PASSPHRASE)).statusCode).toBe(204);
    });

    it('counts failures, not attempts — a fat-finger then a correct login costs nothing', async () => {
      const w = await openApp(); app = w.app;
      for (let i = 0; i < MAX_FAILURES - 1; i++) await postLogin(app, 'wrong');
      expect((await postLogin(app, PASSPHRASE)).statusCode).toBe(204);
      // The window was reset by the success: a full new budget is available.
      for (let i = 0; i < MAX_FAILURES; i++) {
        expect((await postLogin(app, 'wrong')).statusCode, `post-reset attempt ${i + 1}`).toBe(401);
      }
    });

    it('the handler RESERVES — a structural kill for the read-do-not-admit mutation', () => {
      // Review R3. The concurrent-burst test above reds when `reserve()` is
      // swapped back for `check()`, but its assertion (`admitted <= MAX_FAILURES`)
      // is ALSO satisfied by fully serialized execution, so its discriminating
      // power rests on runtime interleaving — empirical on one box at one cost
      // factor, not structural. This is the deterministic half: the login
      // handler's own text, sliced from its registration to the next one, must
      // take a slot and must not merely read one. (`/api/auth/status` calls
      // `check()` legitimately, which is why the slice is scoped rather than the
      // file.)
      const src = readFileSync(path.resolve(__dirname, '../src/server.ts'), 'utf8');
      const at = src.indexOf("app.post('/api/auth/login'");
      expect(at, 'the login route is not registered').toBeGreaterThan(0);
      const end = src.indexOf("\n  app.", at + 1);
      expect(end, 'no following registration to bound the slice').toBeGreaterThan(at);
      const handler = src.slice(at, end);
      expect(handler, 'the brake must ADMIT').toContain('loginLimiter.reserve(');
      expect(handler, 'a pure read cannot bound concurrency').not.toContain('loginLimiter.check(');
      // …and the slot must come back on every path, which is what `finally` is.
      expect(handler).toContain('} finally {');
      expect(handler).toContain('slot.release();');
      // Guard the guard: a slice that had gone empty (a rename, a moved route)
      // would satisfy all four negatives above by having nothing in it.
      expect(handler.length).toBeGreaterThan(1500);
      expect(handler).toContain('verifyPassphrase(');
    });

    it('is per server, not per process — one test box\'s lockout is not another\'s', async () => {
      const a = await openApp(); const b = await openApp();
      try {
        for (let i = 0; i <= MAX_FAILURES; i++) await postLogin(a.app, 'wrong');
        expect((await postLogin(a.app, PASSPHRASE)).statusCode).toBe(429);
        expect((await postLogin(b.app, PASSPHRASE)).statusCode).toBe(204);
      } finally { await a.app.close(); await b.app.close(); }
    });
  });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('answers 501 not-configured when the gate is not armed', async () => {
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(501);
  });

  it('is BEHIND the gate — an anonymous caller cannot revoke a session', async () => {
    const w = await openApp(); app = w.app;
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ verdict: 'no-session' });
  });

  it('revokes THIS session and clears the cookie, leaving the other device signed in', async () => {
    const w = await openApp(); app = w.app;
    const phone = cookieHeader(setCookieOf(await postLogin(app, PASSPHRASE)));
    const laptop = cookieHeader(setCookieOf(await postLogin(app, PASSPHRASE)));
    expect(phone).not.toBe(laptop);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: phone } });
    expect(out.statusCode).toBe(204);
    expect(setCookieOf(out)).toContain('Max-Age=0');

    const gone = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: phone } });
    expect(gone.statusCode).toBe(401);
    // `revokeThis`, not `revokeAll`: the phone logging out must not sign the
    // laptop out too.
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: laptop } })).statusCode)
      .toBe(200);
  });

  it('the expiry line takes Secure from CONFIG too, so the browser will match it', async () => {
    // A browser replaces a cookie only when the name, Path and Domain all match;
    // an expiry line whose attributes had drifted from the login line's would
    // leave the original sitting in the jar with the server's record already
    // revoked — a logout that looks like it worked. Measured both ways, like the
    // login line's own.
    for (const cookieSecure of [true, false]) {
      const w = await openApp({ cookieSecure }); const a = w.app;
      try {
        const cookie = cookieHeader(setCookieOf(await postLogin(a, PASSPHRASE)));
        const out = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
        const line = setCookieOf(out);
        expect(line.includes('Secure'), `cookieSecure=${cookieSecure}`).toBe(cookieSecure);
        expect(line).toContain('Path=/');
      } finally { await a.close(); }
    }
  });
});

// ── GET /api/auth/status ─────────────────────────────────────────────────

describe('GET /api/auth/status', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('reports mode `off` on the shipped default, with everyone authed', async () => {
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authed: true, passkeysEnrolled: 0, mode: 'off' });
  });

  it('reports mode `passphrase` to a logged-in caller', async () => {
    const w = await openApp(); app = w.app;
    const cookie = cookieHeader(setCookieOf(await postLogin(app, PASSPHRASE)));
    const res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } });
    expect(res.json()).toEqual({ authed: true, passkeysEnrolled: 0, mode: 'passphrase' });
  });

  it('reports mode `locked-out` while the login window is closed', async () => {
    const w = await openApp(); app = w.app;
    const cookie = cookieHeader(setCookieOf(await postLogin(app, PASSPHRASE)));
    for (let i = 0; i <= MAX_FAILURES; i++) await postLogin(app, 'wrong');
    expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } })).json())
      .toMatchObject({ mode: 'locked-out' });
  });

  it('is EXEMPT: an anonymous caller gets an answer, not the gate\'s 401', async () => {
    // Operator ruling, overriding the plan's exempt list: the login screen has to
    // read this BEFORE anyone types (`AuthStatus`'s own docstring says so three
    // times over), and gated it could never be read at all.
    const w = await openApp(); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
  });

  it('tells an ANONYMOUS caller `authed:false` — never `true` off the exempt allow', async () => {
    // THE TRAP: the gate's `allow` is `true` here, because the route is EXEMPT —
    // a fact about the ROUTE, not about the caller. Reading `authed` off it would
    // tell every cold browser it was signed in. `reason === 'session'` is the only
    // value that means a credential verified, and this test reds the moment the
    // handler goes back to `decision.allow`.
    const w = await openApp(); app = w.app;
    expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json())
      .toMatchObject({ authed: false, mode: 'passphrase' });
    // …and the same box with a garbage cookie, which is `allow: true` for the
    // identical reason.
    const junk = await app.inject({
      method: 'GET', url: '/api/auth/status', headers: { cookie: `${SESSION_COOKIE}=nope` },
    });
    expect(junk.json()).toMatchObject({ authed: false });
  });

  it('says `authed:false` on an armed box with NO passphrase file, of all places', async () => {
    // The state the D-39 arm exists to refuse. An exempt route that reported
    // `authed: true` here would be announcing a session on the one box where
    // nobody can have one.
    const w = await openApp({ secret: false }); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authed: false });
    // `mode` still says `passphrase`, never a seventh value: `AuthStatus`
    // deliberately has no "armed but unconfigured" member, because publishing it
    // on an unauthenticated route would advertise which boxes are
    // unenterable-but-open. `ccrc doctor` reports it; the login route says it to
    // someone who has actually tried.
    expect(res.json()).toMatchObject({ mode: 'passphrase' });
  });

  it('says `authed:false` for an EXPIRED cookie — a dead session is not a session', async () => {
    // Review R6. Correct by construction (`sessionVerdict` returns
    // `reason: 'refused'` for `'expired'` exactly as it does for `'no-session'`),
    // and until now untested — the difference between the two matters everywhere
    // else, so the one place they must agree is worth pinning too.
    const w = await openApp(); app = w.app;
    const cookie = cookieHeader(setCookieOf(await postLogin(app, PASSPHRASE)));
    expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } })).json())
      .toMatchObject({ authed: true });
    // A `ccrc passwd` generation bump, mid-flight: every live session is expired.
    writeFileSync(path.join(w.home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 2)}\n`, { mode: 0o600 });
    const after = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ authed: false, mode: 'passphrase' });
  });

  it('an anonymous body carries ONLY the enumerated fields — a later one cannot widen the leak', async () => {
    // `ANON_VISIBLE` (server.ts) is a `Record<keyof AuthStatus, boolean>`, so a
    // field added to the wire type is a compile error until someone decides
    // whether an anonymous browser may see it. This is the runtime half: the
    // anonymous body is exactly the three fields, and nothing has been spread in.
    const w = await openApp(); app = w.app;
    const anon = (await app.inject({ method: 'GET', url: '/api/auth/status' })).json() as Record<string, unknown>;
    expect(Object.keys(anon).sort()).toEqual(['authed', 'mode', 'passkeysEnrolled']);
    // The authenticated body is the FULL `AuthStatus` — today the same three
    // fields, which is a fact about this build and not the contract.
    const cookie = cookieHeader(setCookieOf(await postLogin(app, PASSPHRASE)));
    const full = (await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } }))
      .json() as Record<string, unknown>;
    expect(Object.keys(full).sort()).toEqual(['authed', 'mode', 'passkeysEnrolled']);
    expect(full).toMatchObject({ authed: true });
  });
});

// ── the four config keys ─────────────────────────────────────────────────

describe('loadConfig — the four auth keys', () => {
  const cfgWith = (env: NodeJS.ProcessEnv) => {
    const home = mkTmp('ccrc-auth-cfg-');
    seedRoster(home);
    return { cfg: loadConfig({ CCRC_HOME: home, ...env }), home };
  };

  it('is DARK by default: authEnabled false, cookie Secure, both paths under CCRC_HOME', () => {
    const { cfg, home } = cfgWith({});
    expect(cfg.authEnabled).toBe(false);
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.authSecretPath).toBe(path.join(home, '.ccrc', 'auth.scrypt'));
    expect(cfg.sessionsPath).toBe(path.join(home, '.ccrc', 'sessions.json'));
  });

  it('arms on exactly `on`, and on nothing else', () => {
    expect(cfgWith({ CCRC_AUTH: 'on' }).cfg.authEnabled).toBe(true);
    // The fail-SAFE direction for this key is OFF (see the field's docstring):
    // a box that stayed open because someone typed `1` says so out loud, where
    // the inverse would take a box off the air on a typo.
    for (const v of ['1', 'true', 'yes', 'ON', '', 'off']) {
      expect(cfgWith({ CCRC_AUTH: v }).cfg.authEnabled, JSON.stringify(v)).toBe(false);
    }
  });

  it('drops Secure on exactly `on`, and on nothing else — the inverse polarity, deliberately', () => {
    expect(cfgWith({ CCRC_COOKIE_INSECURE: 'on' }).cfg.cookieSecure).toBe(false);
    for (const v of ['1', 'true', '', 'off']) {
      expect(cfgWith({ CCRC_COOKIE_INSECURE: v }).cfg.cookieSecure, JSON.stringify(v)).toBe(true);
    }
  });

  it('honours both path overrides, and treats a BARE `KEY=` line as unset', () => {
    const over = cfgWith({ CCRC_AUTH_SECRET_PATH: '/tmp/s.scrypt', CCRC_SESSIONS_PATH: '/tmp/s.json' });
    expect(over.cfg.authSecretPath).toBe('/tmp/s.scrypt');
    expect(over.cfg.sessionsPath).toBe('/tmp/s.json');
    // `||` not `??` — the `accountsPath` lesson: a bare `CCRC_AUTH_SECRET_PATH=`
    // in an EnvironmentFile yields an empty string, and `??` would make the gate
    // look for the secret at `''` and fail SHUT on a correctly configured box.
    const bare = cfgWith({ CCRC_AUTH_SECRET_PATH: '', CCRC_SESSIONS_PATH: '' });
    expect(bare.cfg.authSecretPath).toBe(path.join(bare.home, '.ccrc', 'auth.scrypt'));
    expect(bare.cfg.sessionsPath).toBe(path.join(bare.home, '.ccrc', 'sessions.json'));
  });

  it('derives sessionsPath from CCRC_HOME — never from the real os.homedir()', () => {
    // D-110. `defaultSessionsPath()` took no argument and reached `os.homedir()`
    // unconditionally; wired that way, every server test would have minted
    // sessions into the LIVE `~/.ccrc/sessions.json`. The review fold-in went
    // further and made `home` REQUIRED (and `new SessionStore()`'s path with it),
    // so the dangerous call is a compile error rather than a convention — see
    // `never-defaults-to-the-live-home` below.
    const { cfg, home } = cfgWith({});
    expect(cfg.sessionsPath.startsWith(home)).toBe(true);
  });

  it('never defaults to the live home: both session-path entry points REQUIRE one', () => {
    // Structural, not conventional. `HOME` is the single isolation boundary the
    // whole suite relies on (`CLAUDE.md`), and a default parameter leaves the
    // live-home call one keystroke away. The compiler is what closes it, so this
    // asserts against the SOURCE — a default reintroduced here would compile
    // clean and this is what would notice.
    const src = readFileSync(path.resolve(__dirname, '../src/auth/sessions.ts'), 'utf8');
    expect(src).toContain('export function defaultSessionsPath(home: string): string');
    expect(src).toContain('constructor(private readonly storePath: string) {}');
    // …and the module can no longer reach the real home at all: `node:os` is not
    // imported, so `os.homedir()` is a compile error rather than a temptation.
    // (The name still appears in the docstring that explains why it went.)
    expect(src).not.toMatch(/^import .* from 'node:os';$/m);
  });
});

// ── the boot refusal, and the bytes it must not print (D-131) ────────────

describe('buildServer — an unusable secret refuses the boot without quoting it', () => {
  /**
   * Lines that do BOTH halves of the job, and the second half is the one a
   * fixture loses silently:
   *
   *  (a) they make `readAuthSecret` throw `AuthSecretUnusable`, and
   *  (b) they make its MESSAGE quote bytes taken out of the file.
   *
   * Most garbled lines only do (a) — `expected 5 '$'-separated fields, got 1`
   * names a count and nothing else — and a leak assertion written against one of
   * those passes for the wrong reason, proving only that a message which could
   * never carry the bytes does not carry them. (That is exactly what the Task 9
   * review caught in D-127's first fixture.) So (b) is MEASURED by the first
   * test below rather than assumed, and every entry here is a real leak arm of
   * `parseAuthSecretLine`: the prefix, the whole params field, one params value,
   * and the generation field.
   *
   * The planted strings never appear in a FILENAME — the refusal message names
   * the path, so a planted value in the path would satisfy the leak assertion
   * from the wrong side.
   */
  const VALID_HASH_B64 = Buffer.alloc(32).toString('base64');
  const LEAKY: Array<[string, string, string]> = [
    ['the prefix field', 'PLANTED-PREFIX-9f3a2b$b$c$d$e', 'PLANTED-PREFIX-9f3a2b'],
    ['the whole params field', `scrypt$PLANTED-PARAMS-4d1e7c$c2FsdA==$${VALID_HASH_B64}$gen=1`,
      'PLANTED-PARAMS-4d1e7c'],
    ['one params value', `scrypt$N=PLANTED-N-8b0c15,r=8,p=1$c2FsdA==$${VALID_HASH_B64}$gen=1`,
      'PLANTED-N-8b0c15'],
    ['the generation field', `scrypt$N=1024,r=8,p=1$c2FsdA==$${VALID_HASH_B64}$PLANTED-GEN-7a2f11`,
      'PLANTED-GEN-7a2f11'],
  ];

  it('the fixtures are genuinely leakable: readAuthSecret quotes these bytes', () => {
    const dir = mkTmp('ccrc-auth-leaky-');
    LEAKY.forEach(([name, line, planted], i) => {
      const p = path.join(dir, `case${i}.scrypt`);
      writeFileSync(p, `${line}\n`, { mode: 0o600 });
      let msg = '';
      expect(() => readAuthSecret(p), name).toThrow(AuthSecretUnusable);
      try { readAuthSecret(p); } catch (err) { msg = (err as Error).message; }
      // If this ever goes red because the parser stopped quoting, the fixture —
      // not the guard — is what needs replacing: a non-leaking line cannot
      // measure a leak.
      expect(msg, name).toContain(planted);
    });
  });

  it('REFUSES TO BOOT, and not one of those bytes reaches what node would print', async () => {
    for (const [name, line, planted] of LEAKY) {
      let caught: unknown;
      try { await openApp({ secretText: `${line}\n` }); } catch (err) { caught = err; }
      expect(caught, name).toBeInstanceOf(AuthSecretUnusable);
      // `inspect` WITH the cause chain, not `.message`, because that is what an
      // uncaught rejection actually puts in the journal: node prints the message,
      // the stack, AND `[cause]`. A fix that rewrote the message but attached
      // `{ cause: err }` would pass a `.message` assertion and leak anyway, one
      // line further down the same journal entry.
      expect(inspect(caught, { depth: 5 }), name).not.toContain(planted);
      expect((caught as Error).cause, name).toBeUndefined();
      // …and the refusal is still ACTIONABLE without the bytes: which file, what
      // state, which tool measures it safely, and the D-125 two-step remedy.
      const msg = (caught as Error).message;
      expect(msg, name).toContain('REFUSING TO BOOT');
      expect(msg, name).toContain('auth.scrypt');
      expect(msg, name).toContain('ccrc doctor');
      expect(msg, name)
        .toMatch(/mv .*auth\.scrypt .*auth\.scrypt\.broken && rm -f .*sessions\.json && ccrc passwd/);
    }
  });

  it('does NOT refuse the boot on a DARK box — the same file, flag off', async () => {
    // The refusal belongs to the armed path only: with `CCRC_AUTH` off nothing
    // reads the file at all (`buildServer`'s whole auth block is inside the
    // flag), so a box carrying a broken `auth.scrypt` it has never armed keeps
    // serving. Doctor is what tells that operator it is a boot refusal waiting
    // to happen; the server has no business refusing over a file it never reads.
    const w = await openApp({ enabled: false, secretText: `${LEAKY[0][1]}\n` });
    await w.app.close();
  });
});
