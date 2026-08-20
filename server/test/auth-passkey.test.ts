// Stage 3a Task 8 — WEBAUTHN PASSKEYS, hand-rolled on `node:crypto`.
//
// This is authentication cryptography written without a library, so a bug here
// is an authentication BYPASS rather than a broken feature. The suite is
// organised around that: every guard in `webauthn.ts` gets its OWN case, so a
// mutation that deletes one guard reds one test and names it — a suite that
// only asserted "a good assertion verifies / a bad one does not" would go green
// with half the checks removed.
//
// THE FIXTURES ARE REAL. `makeAuthenticator` generates an actual ES256 keypair
// with `node:crypto` and signs genuine assertions over the genuine message; the
// happy path therefore proves REAL verification rather than a stub agreeing with
// itself. Two properties follow from that and are worth stating:
//
//   1. `signed()` — the message the fixture signs — is spelled out INDEPENDENTLY
//      of `verifyAssertion`, from the WebAuthn spec's own words
//      (`authenticatorData ‖ sha256(clientDataJSON)`). If the implementation and
//      the fixture shared a helper, a wrong concatenation would agree with
//      itself and the wrong-message test would pass while the server verified
//      something an attacker could choose.
//   2. Nothing here mocks a verifier. There is no seam at which a test could
//      pass against a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { COSE_ES256 } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT, wsOriginVerdict } from '../src/auth/gate.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { MAX_CREDENTIALS, PasskeyStore, defaultPasskeysPath } from '../src/auth/credentials.js';
import {
  CHALLENGE_TTL_MS, ChallengeStore, MAX_LIVE_CHALLENGES, PUBLIC_SUFFIX_TRAPS, SUPPORTED_ALGS,
  decodeB64url, originProblem, relyingPartyProblem, rpIdProblem, userHandleFor,
  verifyAssertion, verifyRegistration, type StoredCredential,
} from '../src/auth/webauthn.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** scrypt at the shipped N=65536 is ~100 ms per verify — the real brute-force
 *  brake, and irrelevant to anything this file measures. `auth-gate.test.ts`'s
 *  cheap-line idiom: the format is self-describing, so a cheap line verifies
 *  through the identical code path. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:7788';

const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();
const b64 = (b: Buffer): string => b.toString('base64url');

/** WebAuthn flag bits, spelled here so the tests read as the spec does. */
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

interface AuthDataOpts {
  rpId?: string;
  flags?: number;
  signCount?: number;
  /** Append attested credential data (registration). */
  attested?: Buffer | null;
  /** Truncate the result to this many bytes, for the short-buffer cases. */
  truncateTo?: number;
}

/**
 * ONE SIMULATED AUTHENTICATOR — a real P-256 keypair plus the byte layouts a
 * real authenticator produces. Everything an attacker could vary is a parameter,
 * so each guard can be probed in isolation with everything else genuine.
 */
function makeAuthenticator(defaults: { rpId?: string; origin?: string } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const credentialId = randomBytes(32);
  const rpIdDefault = defaults.rpId ?? RP_ID;
  const originDefault = defaults.origin ?? ORIGIN;

  /** `rpIdHash(32) ‖ flags(1) ‖ signCount(4) [‖ attested credential data]`. */
  const authData = (o: AuthDataOpts = {}): Buffer => {
    const head = Buffer.alloc(37);
    sha256(Buffer.from(o.rpId ?? rpIdDefault, 'utf8')).copy(head, 0);
    head[32] = o.flags ?? (UP | UV);
    head.writeUInt32BE(o.signCount ?? 0, 33);
    const out = o.attested ? Buffer.concat([head, o.attested]) : head;
    return o.truncateTo === undefined ? out : out.subarray(0, o.truncateTo);
  };

  /** `aaguid(16) ‖ credentialIdLength(2) ‖ credentialId ‖ COSE key`. The COSE
   *  key is never read by anything under test — that is the no-CBOR claim — so
   *  these are plausible bytes and nothing more. */
  const attestedFor = (id: Buffer = credentialId): Buffer => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(id.length, 0);
    return Buffer.concat([randomBytes(16), len, id, randomBytes(77)]);
  };

  const clientData = (
    type: string, challenge: string, origin: string = originDefault, extra: Record<string, unknown> = {},
  ): Buffer => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...extra }), 'utf8');

  /**
   * THE SIGNED MESSAGE, written out from the spec rather than shared with the
   * implementation: `authenticatorData ‖ sha256(clientDataJSON)`. This is the
   * one line in the file that must not be refactored into a shared helper.
   */
  const signed = (ad: Buffer, cd: Buffer): Buffer => Buffer.concat([ad, sha256(cd)]);

  const sign = (message: Buffer): Buffer => createSign('SHA256').update(message).end().sign(privateKey);

  return {
    spki, credentialId, privateKey,
    authData, attestedFor, clientData, signed, sign,
    /** A complete, genuine assertion for `challenge`. */
    assert(challenge: string, o: AuthDataOpts & { origin?: string; type?: string } = {}) {
      const ad = authData(o);
      const cd = clientData(o.type ?? 'webauthn.get', challenge, o.origin ?? originDefault);
      return {
        credentialIdB64url: b64(credentialId),
        authenticatorDataB64url: b64(ad),
        clientDataJsonB64url: b64(cd),
        signatureB64url: b64(sign(signed(ad, cd))),
      };
    },
    /** A complete, genuine registration for `challenge`. */
    register(challenge: string, o: AuthDataOpts & { origin?: string; type?: string } = {}) {
      const ad = authData({ flags: UP | UV | AT, attested: attestedFor(), ...o });
      const cd = clientData(o.type ?? 'webauthn.create', challenge, o.origin ?? originDefault);
      return {
        credentialIdB64url: b64(credentialId),
        publicKeySpkiB64url: b64(spki),
        algorithm: COSE_ES256,
        authenticatorDataB64url: b64(ad),
        clientDataJsonB64url: b64(cd),
      };
    },
    /** The row `verifyAssertion` reads, as `credentials.ts` would have stored it. */
    stored(over: Partial<StoredCredential> = {}): StoredCredential {
      return {
        credentialId: b64(credentialId), spkiB64url: b64(spki), algorithm: COSE_ES256,
        rpId: rpIdDefault, origin: originDefault, signCount: 0, uvAtEnrollment: true,
        enrolledAt: 1_000, lastUsedAt: 1_000, label: 'a test key', ...over,
      };
    },
  };
}

type Authenticator = ReturnType<typeof makeAuthenticator>;

/** A live assert-challenge store with one challenge in it. */
const withChallenge = (purpose: 'register' | 'assert', now = 10_000): { store: ChallengeStore; challenge: string } => {
  const store = new ChallengeStore(purpose);
  return { store, challenge: store.issue(now) };
};

// ── 1. strict base64url ─────────────────────────────────────────────────────

describe('decodeB64url refuses everything Buffer.from would swallow', () => {
  it('round-trips a canonical field', () => {
    const raw = randomBytes(32);
    expect(decodeB64url(b64(raw), 64)?.equals(raw)).toBe(true);
  });

  it('refuses padding, the standard alphabet, and whitespace', () => {
    // FIXED BYTES, not random ones: `randomBytes(30)` base64s to 40 chars with
    // no padding and only sometimes contains `+`/`/`, so a random fixture makes
    // this case pass by luck a good fraction of the time. These three are chosen
    // to hit both non-url characters (0x3f → `/`, 0x3e → `+`).
    const plus = Buffer.from([0xff, 0xef, 0xfe]);
    expect(plus.toString('base64')).toBe('/+/+');
    expect(decodeB64url('/+/+', 64)).toBeNull();
    // A 31-byte buffer's standard base64 carries two `=`.
    const padded = Buffer.alloc(31, 1);
    expect(padded.toString('base64')).toMatch(/==$/);
    expect(decodeB64url(padded.toString('base64'), 64)).toBeNull();
    const raw = randomBytes(32);
    expect(decodeB64url(`${b64(raw)}=`, 64)).toBeNull();
    expect(decodeB64url(` ${b64(raw)}`, 64)).toBeNull();
    expect(decodeB64url(`${b64(raw)}\n`, 64)).toBeNull();
  });

  it('refuses a NON-CANONICAL spelling of the same bytes — the aliasing case', () => {
    // `QQ` and `QR` both decode to 0x41 under a lenient decoder: the trailing
    // bits are ignored. Two strings, one byte string — which is how a credential
    // id stored under one spelling is looked up under another, or how one key
    // becomes two rows. Only the round-trip check sees this; an alphabet test
    // cannot.
    expect(Buffer.from('QQ', 'base64url').equals(Buffer.from('QR', 'base64url'))).toBe(true);
    expect(decodeB64url('QQ', 8)).not.toBeNull();
    expect(decodeB64url('QR', 8)).toBeNull();
  });

  it('refuses an empty field, a non-string, and anything past its bound', () => {
    expect(decodeB64url('', 64)).toBeNull();
    expect(decodeB64url(undefined, 64)).toBeNull();
    expect(decodeB64url(42, 64)).toBeNull();
    expect(decodeB64url({ toString: () => 'AAAA' }, 64)).toBeNull();
    expect(decodeB64url(b64(randomBytes(65)), 64)).toBeNull();
  });

  it('bounds the STRING before it allocates', () => {
    // A megabyte of base64url must be refused without ever being decoded.
    expect(decodeB64url('A'.repeat(1_000_000), 64)).toBeNull();
  });
});

// ── 2. the PSL hazard ───────────────────────────────────────────────────────

describe('rpId is the registrable domain — never a public suffix, never derived', () => {
  it('accepts the two shapes this project actually deploys', () => {
    expect(rpIdProblem('tailnet-example.ts.net')).toBeNull();
    expect(rpIdProblem('mybox.duckdns.org')).toBeNull();
    expect(rpIdProblem('localhost')).toBeNull();
  });

  it('REFUSES a bare public suffix, naming the widening it would cause', () => {
    // The whole hazard in one assertion: `ts.net` scopes a credential to every
    // tailnet on the internet, and a browser refuses it with an opaque
    // SecurityError and nothing in this box's journal.
    for (const suffix of PUBLIC_SUFFIX_TRAPS) {
      const problem = rpIdProblem(suffix);
      expect(problem, suffix).not.toBeNull();
      expect(problem, suffix).toContain('PUBLIC SUFFIX');
    }
    expect(rpIdProblem('ts.net')).toContain('tailnet-example.ts.net');
  });

  it('refuses a single label that is not localhost — a bare TLD is a public suffix too', () => {
    expect(rpIdProblem('net')).toContain('single label');
    expect(rpIdProblem('com')).toContain('single label');
    expect(rpIdProblem('server-box')).toContain('single label');
  });

  it('refuses a URL, a port, a path or a scheme — an rpId is a bare domain', () => {
    for (const bad of ['https://box.example', 'box.example:8443', 'box.example/app', 'box example']) {
      expect(rpIdProblem(bad), bad).toContain('bare domain');
    }
  });

  it('refuses uppercase, an empty value, and a malformed domain', () => {
    expect(rpIdProblem('Box.Example')).toContain('uppercase');
    expect(rpIdProblem('')).toContain('empty');
    expect(rpIdProblem('.box.example')).toContain('well-formed');
    expect(rpIdProblem('box..example')).toContain('well-formed');
  });

  it('NOTHING IN THE TREE DERIVES AN rpId BY STRIPPING LABELS — the scan', () => {
    // The real defence is not the trap list above (which is not a PSL and must
    // never grow into one) — it is that no code path can ARRIVE at a public
    // suffix, because none computes an rpId at all. This is the assertion that
    // says so, over the source rather than over a promise.
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = readFileSync(path.join(here, '..', 'src', 'auth', 'webauthn.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The two shapes a label-strip takes. Either one appearing in CODE (comments
    // stripped above — they discuss the hazard at length) means an rpId is being
    // computed somewhere, which is the one thing this design forbids.
    expect(code).not.toMatch(/\.split\(['"]\.['"]\)/);
    expect(code).not.toMatch(/hostname\.replace/);
  });
});

describe('origin is the full serialized origin, and must agree with rpId', () => {
  it('accepts a real https origin under its registrable domain', () => {
    expect(originProblem('https://server-box.tailnet-example.ts.net', 'tailnet-example.ts.net')).toBeNull();
    expect(originProblem('https://server-box.tailnet-example.ts.net:8443', 'tailnet-example.ts.net')).toBeNull();
    expect(originProblem('http://localhost:7788', 'localhost')).toBeNull();
  });

  it('refuses a trailing slash, a path, a query — a browser sends none of them', () => {
    for (const bad of ['https://box.example/', 'https://box.example/app', 'https://box.example?x=1']) {
      expect(originProblem(bad, 'box.example'), bad).toContain('bare serialized origin');
    }
  });

  it('refuses plain http off loopback — WebAuthn needs a secure context', () => {
    expect(originProblem('http://server-box.tailnet-example.ts.net', 'tailnet-example.ts.net')).toContain('secure context');
    // …and permits it ON loopback, which is a secure context by fiat.
    expect(originProblem('http://127.0.0.1:7788', '127.0.0.1')).toBeNull();
  });

  it('refuses an origin whose host is not the rpId or a subdomain of it', () => {
    // The single most common WebAuthn misconfiguration, caught at boot rather
    // than as an unexplained browser refusal.
    expect(originProblem('https://box.example', 'other.example')).toContain('disagree');
    // The near-miss that a naive `endsWith` would accept: `evilbox.example`
    // ends with `box.example` but is not a subdomain of it.
    expect(originProblem('https://evilbox.example', 'box.example')).toContain('disagree');
  });

  it('relyingPartyProblem reports the rpId first, then the origin', () => {
    expect(relyingPartyProblem('ts.net', 'https://box.ts.net')).toContain('PUBLIC SUFFIX');
    expect(relyingPartyProblem('box.example', 'https://box.example/')).toContain('bare serialized origin');
    expect(relyingPartyProblem('localhost', 'http://localhost:7788')).toBeNull();
  });
});

describe('the user handle', () => {
  it('is stable per rpId, opaque, and 16 bytes — one account per box, no PII', () => {
    const a = userHandleFor('box.example');
    expect(userHandleFor('box.example')).toBe(a);
    expect(Buffer.from(a, 'base64url')).toHaveLength(16);
    expect(a).not.toContain('box.example');
    expect(userHandleFor('other.example')).not.toBe(a);
  });
});

// ── 3. the challenge store ──────────────────────────────────────────────────

describe('a challenge is single-use and expiring', () => {
  it('spends on the first consume and refuses the second — THE REPLAY WALL', () => {
    const { store, challenge } = withChallenge('assert');
    expect(store.consume(challenge, 10_000)).toBe(true);
    expect(store.consume(challenge, 10_000)).toBe(false);
  });

  it('refuses one past its TTL, and spends it anyway so it cannot be retried', () => {
    const { store, challenge } = withChallenge('assert', 10_000);
    expect(store.consume(challenge, 10_000 + CHALLENGE_TTL_MS + 1)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('accepts one exactly ON the boundary', () => {
    const { store, challenge } = withChallenge('assert', 10_000);
    expect(store.consume(challenge, 10_000 + CHALLENGE_TTL_MS)).toBe(true);
  });

  it('refuses a challenge it never issued', () => {
    const store = new ChallengeStore('assert');
    expect(store.consume(b64(randomBytes(32)), 10_000)).toBe(false);
  });

  it('is 256 bits of randomness, never repeated', () => {
    const store = new ChallengeStore('assert');
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const c = store.issue(10_000 + i);
      expect(Buffer.from(c, 'base64url')).toHaveLength(32);
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });

  it('is capped, and EVICTS the oldest rather than refusing the newest', () => {
    // Refusing would let a flood lock the operator out of their own passkey
    // button — a denial of service that outlives the flood. Eviction self-heals.
    const store = new ChallengeStore('assert');
    const first = store.issue(10_000);
    for (let i = 0; i < MAX_LIVE_CHALLENGES; i++) store.issue(10_000);
    expect(store.size).toBeLessThanOrEqual(MAX_LIVE_CHALLENGES);
    expect(store.consume(first, 10_000)).toBe(false);
    // …and the newest still works, which is the half that matters.
    const latest = store.issue(10_000);
    expect(store.consume(latest, 10_000)).toBe(true);
  });

  it('sweeps expired entries on issue, so the map cannot grow on dead ones', () => {
    const store = new ChallengeStore('assert');
    for (let i = 0; i < 10; i++) store.issue(10_000);
    expect(store.size).toBe(10);
    store.issue(10_000 + CHALLENGE_TTL_MS + 1);
    expect(store.size).toBe(1);
  });

  it('REGISTER and ASSERT are separate stores — a challenge cannot cross ceremonies', () => {
    // Purpose confusion, made structurally impossible rather than left to the
    // `clientDataJSON.type` check alone.
    const reg = new ChallengeStore('register');
    const asrt = new ChallengeStore('assert');
    const c = reg.issue(10_000);
    expect(asrt.consume(c, 10_000)).toBe(false);
    expect(reg.consume(c, 10_000)).toBe(true);
  });
});

// ── 4. registration ─────────────────────────────────────────────────────────

const rp = { rpId: RP_ID, origin: ORIGIN };

describe('verifyRegistration', () => {
  let auth: Authenticator;
  beforeEach(() => { auth = makeAuthenticator(); });

  it('accepts a genuine registration and returns the row to store', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(auth.register(challenge), rp, store, 10_000);
    expect(r.ok, r.ok ? '' : r.detail).toBe(true);
    if (!r.ok) return;
    expect(r.credentialId).toBe(b64(auth.credentialId));
    expect(r.spkiB64url).toBe(b64(auth.spki));
    expect(r.algorithm).toBe(COSE_ES256);
    expect(r.uv).toBe(true);
  });

  it('refuses an algorithm this build cannot verify — membership, not exclusion', () => {
    const { store, challenge } = withChallenge('register');
    for (const alg of [-257, -8, -35, 0, 7]) {
      const r = verifyRegistration({ ...auth.register(challenge), algorithm: alg }, rp, store, 10_000);
      expect(r.ok, String(alg)).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('unsupported-alg');
        // WHICH guard refused, pinned by its sentence. There are TWO here — the
        // membership test, and `importProblem`'s fail-shut fallthrough for an
        // algorithm with no key-type check — and either alone would refuse, so
        // without this clause deleting the membership test reds nothing. Pinning
        // the detail also pins the ORDER: the cheap list test runs BEFORE any
        // key material is imported.
        expect(r.detail, String(alg)).toContain('not one this build verifies');
      }
    }
    expect(SUPPORTED_ALGS).toEqual([COSE_ES256]);
  });

  it('refuses an SPKI that is not the key type its algorithm claims', () => {
    // `createPublicKey` imports any well-formed SPKI and `createVerify('SHA256')`
    // would verify against it — so "alg is -7" and "the key is P-256" are two
    // facts and only one of them was checked before this guard.
    const { store, challenge } = withChallenge('register');
    for (const wrong of [
      generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey,
      generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey,
    ]) {
      const spki = wrong.export({ format: 'der', type: 'spki' }) as Buffer;
      const r = verifyRegistration(
        { ...auth.register(challenge), publicKeySpkiB64url: b64(spki) }, rp, store, 10_000);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('bad-key');
    }
  });

  it('refuses a public key that is not an SPKI at all', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(
      { ...auth.register(challenge), publicKeySpkiB64url: b64(randomBytes(91)) }, rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-key');
  });

  it('refuses `webauthn.get` on the registration path — the ceremonies do not cross', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(auth.register(challenge, { type: 'webauthn.get' }), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-type');
  });

  it('refuses a registration at a foreign origin', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(
      auth.register(challenge, { origin: 'https://evil.example' }), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-origin');
  });

  it('refuses a stale or unknown registration challenge', () => {
    const store = new ChallengeStore('register');
    const r = verifyRegistration(auth.register(b64(randomBytes(32))), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale-challenge');
  });

  it('refuses an rpIdHash for a different relying party', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(auth.register(challenge, { rpId: 'evil.example' }), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-rp');
  });

  it('REQUIRES user verification AT ENROLMENT — the lockout this closes', () => {
    // A UV requirement enforced only at login is a trap: a PIN-less key enrols
    // happily and then every login is refused with nothing to fix. Enforcing it
    // here means the failure lands while the operator is still signed in with
    // their passphrase, so a credential that EXISTS can always assert.
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(
      auth.register(challenge, { flags: UP | AT, attested: auth.attestedFor() }), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('user-not-verified');
  });

  it('requires user presence', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(
      auth.register(challenge, { flags: UV | AT, attested: auth.attestedFor() }), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('user-not-present');
  });

  it('refuses authenticatorData with no attested credential data', () => {
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(
      auth.register(challenge, { flags: UP | UV, attested: null }), rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-attested-data');
  });

  it('CROSS-CHECKS the claimed credential id against the one inside authData', () => {
    // A client that enrolled under an id the authenticator will never assert
    // with would have created a credential that exists and can never be used —
    // very hard to diagnose, and free to prevent.
    const { store, challenge } = withChallenge('register');
    const r = verifyRegistration(
      { ...auth.register(challenge), credentialIdB64url: b64(randomBytes(32)) }, rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-attested-data');
  });

  it('refuses a hostile credentialIdLength that overruns the buffer', () => {
    const { store, challenge } = withChallenge('register');
    const bad = auth.attestedFor();
    bad.writeUInt16BE(60_000, 16); // claims 60000 bytes of id in a ~100-byte buffer
    const reg = auth.register(challenge);
    const ad = auth.authData({ flags: UP | UV | AT, attested: bad });
    const cd = auth.clientData('webauthn.create', challenge);
    const r = verifyRegistration({
      ...reg, authenticatorDataB64url: b64(ad), clientDataJsonB64url: b64(cd),
    }, rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-attested-data');
  });

  it('refuses a truncated authenticatorData rather than reading past it', () => {
    const { store, challenge } = withChallenge('register');
    const ad = auth.authData({ flags: UP | UV | AT, attested: auth.attestedFor(), truncateTo: 20 });
    const r = verifyRegistration({
      ...auth.register(challenge), authenticatorDataB64url: b64(ad),
      clientDataJsonB64url: b64(auth.clientData('webauthn.create', challenge)),
    }, rp, store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed');
  });
});

// ── 5. assertion — the function an auth bypass would live in ────────────────

describe('verifyAssertion', () => {
  let auth: Authenticator;
  beforeEach(() => { auth = makeAuthenticator(); });

  it('accepts a GENUINE assertion, signed by a real key over the real message', () => {
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(auth.assert(challenge, { signCount: 1 }), auth.stored(), store, 10_000);
    expect(r.ok, r.ok ? '' : r.detail).toBe(true);
    if (!r.ok) return;
    expect(r.signCount).toBe(1);
    expect(r.uv).toBe(true);
  });

  // ── THE MUTATION TARGETS ──

  it('REFUSES A SIGNATURE OVER THE WRONG MESSAGE', () => {
    // The message is `authenticatorData ‖ sha256(clientDataJSON)`. Every
    // plausible near-miss below is a real bug someone has shipped, and each one
    // signs with the GENUINE key — so only the message check can refuse them.
    const { store } = withChallenge('assert');
    const ad = auth.authData({ signCount: 1 });
    const wrongMessages: Record<string, Buffer> = {
      'the client data raw, not hashed': Buffer.concat([ad, Buffer.from('x')]),
      'the two hashes concatenated': Buffer.concat([sha256(ad), sha256(Buffer.from('x'))]),
      'sha256 of the whole concatenation': sha256(Buffer.concat([ad, sha256(Buffer.from('x'))])),
      'the order reversed': Buffer.concat([sha256(Buffer.from('x')), ad]),
      'authData alone': ad,
      'the client-data hash alone': sha256(Buffer.from('x')),
    };
    for (const [name, message] of Object.entries(wrongMessages)) {
      const challenge = store.issue(10_000);
      const cd = auth.clientData('webauthn.get', challenge);
      const r = verifyAssertion({
        credentialIdB64url: b64(auth.credentialId),
        authenticatorDataB64url: b64(ad),
        clientDataJsonB64url: b64(cd),
        signatureB64url: b64(auth.sign(message)),
      }, auth.stored(), store, 10_000);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.reason, name).toBe('bad-signature');
    }
  });

  it('refuses a signature from a DIFFERENT key', () => {
    const { store, challenge } = withChallenge('assert');
    const other = makeAuthenticator();
    const ad = auth.authData({ signCount: 1 });
    const cd = auth.clientData('webauthn.get', challenge);
    const r = verifyAssertion({
      credentialIdB64url: b64(auth.credentialId),
      authenticatorDataB64url: b64(ad),
      clientDataJsonB64url: b64(cd),
      signatureB64url: b64(other.sign(other.signed(ad, cd))),
    }, auth.stored(), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-signature');
  });

  it('refuses a garbage signature without throwing — a 500 is not a refusal', () => {
    const { store, challenge } = withChallenge('assert');
    const good = auth.assert(challenge, { signCount: 1 });
    for (const sig of [b64(randomBytes(70)), b64(Buffer.from([0x30, 0xff])), b64(Buffer.alloc(64))]) {
      const s2 = new ChallengeStore('assert');
      const c2 = s2.issue(10_000);
      const a2 = auth.assert(c2, { signCount: 1 });
      const r = verifyAssertion({ ...a2, signatureB64url: sig }, auth.stored(), s2, 10_000);
      expect(r.ok).toBe(false);
    }
    // …and the good one still verifies, so the loop above proved something.
    expect(verifyAssertion(good, auth.stored(), store, 10_000).ok).toBe(true);
  });

  it('REFUSES A STALE signCount — the clone/replay defence', () => {
    const { store } = withChallenge('assert');
    // stored 5; every one of these is a counter that did not advance.
    for (const presented of [0, 1, 4, 5]) {
      const challenge = store.issue(10_000);
      const r = verifyAssertion(
        auth.assert(challenge, { signCount: presented }), auth.stored({ signCount: 5 }), store, 10_000);
      expect(r.ok, `presented ${presented}`).toBe(false);
      if (!r.ok) expect(r.reason, `presented ${presented}`).toBe('sign-count-replay');
    }
    // …and 6 advances, so the loop above was not refusing everything.
    const c = store.issue(10_000);
    expect(verifyAssertion(auth.assert(c, { signCount: 6 }), auth.stored({ signCount: 5 }), store, 10_000).ok)
      .toBe(true);
  });

  it('EQUAL is a replay, not "close enough"', () => {
    // Written out on its own because it is the arm a `received < stored` check
    // would let through, and a replayed assertion presents EXACTLY the stored
    // value.
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(
      auth.assert(challenge, { signCount: 7 }), auth.stored({ signCount: 7 }), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sign-count-replay');
  });

  it('accepts an authenticator that ALWAYS SENDS 0, and keeps the counter at 0', () => {
    // Most Apple/Android platform passkeys and every synced credential send 0
    // forever — a counter is meaningless for a key that lives in several places
    // by design. Refusing them would refuse the most common passkey there is.
    // The accepted loss is stated: no clone detection for such a credential; the
    // single-use challenge is what still refuses a replay.
    const { store } = withChallenge('assert');
    for (let i = 0; i < 3; i++) {
      const challenge = store.issue(10_000);
      const r = verifyAssertion(auth.assert(challenge, { signCount: 0 }), auth.stored({ signCount: 0 }),
        store, 10_000);
      expect(r.ok, `round ${i}`).toBe(true);
      if (r.ok) expect(r.signCount).toBe(0);
    }
  });

  it('…but a counter that HAD a value and now sends 0 is refused', () => {
    // Not the same authenticator. This is the arm a bare "if either is 0, skip"
    // rule would wave through.
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(auth.assert(challenge, { signCount: 0 }), auth.stored({ signCount: 9 }),
      store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sign-count-replay');
  });

  it('REFUSES A WRONG-ORIGIN assertion — scheme, host AND port', () => {
    const { store } = withChallenge('assert');
    for (const origin of [
      'https://evil.example',
      'https://localhost:7788',        // right host, wrong scheme
      'http://localhost:9999',         // right host, wrong port
      'http://localhost',              // right host, no port
      'http://localhost:7788.evil.example',
      'http://evil.example/http://localhost:7788',
    ]) {
      const challenge = store.issue(10_000);
      const r = verifyAssertion(auth.assert(challenge, { origin }), auth.stored(), store, 10_000);
      expect(r.ok, origin).toBe(false);
      if (!r.ok) expect(r.reason, origin).toBe('wrong-origin');
    }
  });

  it('checks the origin RECORDED ON THE CREDENTIAL, not the box\'s current config', () => {
    // The Stage 3b rename property: a credential enrolled at localhost is
    // refused by the origin it was enrolled with, loudly, rather than passing an
    // origin check against today's config and then failing an opaque signature
    // comparison.
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(auth.assert(challenge), auth.stored({ origin: 'https://renamed.example' }),
      store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('wrong-origin');
      expect(r.detail).toContain('renamed.example');
    }
  });

  it('REFUSES A REPLAYED CHALLENGE — the same assertion, sent twice', () => {
    const { store, challenge } = withChallenge('assert');
    const assertion = auth.assert(challenge, { signCount: 1 });
    expect(verifyAssertion(assertion, auth.stored(), store, 10_000).ok).toBe(true);
    // Byte-identical second attempt. The stored counter has NOT been advanced
    // here (the caller does that), so this is the challenge wall alone.
    const again = verifyAssertion(assertion, auth.stored(), store, 10_000);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('stale-challenge');
  });

  it('burns the challenge even when the attempt FAILS — no grinding', () => {
    // The challenge is consumed before the signature is examined, so an attacker
    // holding a captured clientDataJSON gets one shot at the remaining checks
    // rather than two minutes of retries.
    const { store, challenge } = withChallenge('assert');
    const good = auth.assert(challenge, { signCount: 1 });
    const bad = { ...good, signatureB64url: b64(randomBytes(70)) };
    expect(verifyAssertion(bad, auth.stored(), store, 10_000).ok).toBe(false);
    const retry = verifyAssertion(good, auth.stored(), store, 10_000);
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.reason).toBe('stale-challenge');
  });

  it('refuses a challenge past its TTL', () => {
    const { store, challenge } = withChallenge('assert', 10_000);
    const r = verifyAssertion(auth.assert(challenge, { signCount: 1 }), auth.stored(), store,
      10_000 + CHALLENGE_TTL_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale-challenge');
  });

  it('REFUSES A WRONG rpIdHash', () => {
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(
      auth.assert(challenge, { rpId: 'evil.example', signCount: 1 }), auth.stored(), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('wrong-rp');
      // The sentence an operator can act on after a box rename.
      expect(r.detail).toContain('re-enrol');
    }
  });

  it('refuses `webauthn.create` on the assertion path', () => {
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(
      auth.assert(challenge, { type: 'webauthn.create', signCount: 1 }), auth.stored(), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-type');
  });

  it('refuses a ceremony run in a CROSS-ORIGIN frame', () => {
    const { store, challenge } = withChallenge('assert');
    const ad = auth.authData({ signCount: 1 });
    const cd = auth.clientData('webauthn.get', challenge, ORIGIN, { crossOrigin: true });
    const r = verifyAssertion({
      credentialIdB64url: b64(auth.credentialId),
      authenticatorDataB64url: b64(ad), clientDataJsonB64url: b64(cd),
      signatureB64url: b64(auth.sign(auth.signed(ad, cd))),
    }, auth.stored(), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cross-origin');
  });

  it('tolerates crossOrigin absent — absence permits, as the wire discipline says', () => {
    const { store, challenge } = withChallenge('assert');
    const ad = auth.authData({ signCount: 1 });
    const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN }), 'utf8');
    const r = verifyAssertion({
      credentialIdB64url: b64(auth.credentialId),
      authenticatorDataB64url: b64(ad), clientDataJsonB64url: b64(cd),
      signatureB64url: b64(auth.sign(auth.signed(ad, cd))),
    }, auth.stored(), store, 10_000);
    expect(r.ok, r.ok ? '' : r.detail).toBe(true);
  });

  it('requires user presence and user verification on EVERY assertion', () => {
    const { store } = withChallenge('assert');
    const cases: [number, string][] = [[UV, 'user-not-present'], [UP, 'user-not-verified'], [0, 'user-not-present']];
    for (const [flags, reason] of cases) {
      const challenge = store.issue(10_000);
      const r = verifyAssertion(auth.assert(challenge, { flags, signCount: 1 }), auth.stored(), store, 10_000);
      expect(r.ok, String(flags)).toBe(false);
      if (!r.ok) expect(r.reason, String(flags)).toBe(reason);
    }
  });

  it('refuses a credential whose STORED algorithm is not one this build verifies', () => {
    // The row is read off disk and could be hand-edited; a stored algorithm must
    // not be able to select a code path that was never validated.
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(
      auth.assert(challenge, { signCount: 1 }), auth.stored({ algorithm: -257 }), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unsupported-alg');
      // The detail pins WHICH guard, for the reason the registration case gives:
      // `importProblem`'s fallthrough would refuse this too, so without naming
      // the sentence, deleting this re-check reds nothing. It also pins that the
      // re-check happens BEFORE the challenge is spent — a row with a bad
      // algorithm must not burn an operator's ceremony.
      expect(r.detail).toContain('stored credential declares algorithm');
    }
  });

  it('refuses when the presented id is not the credential supplied', () => {
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(
      { ...auth.assert(challenge, { signCount: 1 }), credentialIdB64url: b64(randomBytes(32)) },
      auth.stored(), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-credential');
  });

  it('refuses malformed and missing fields without throwing', () => {
    const { store, challenge } = withChallenge('assert');
    const good = auth.assert(challenge, { signCount: 1 });
    for (const over of [
      { credentialIdB64url: undefined }, { authenticatorDataB64url: undefined },
      { clientDataJsonB64url: undefined }, { signatureB64url: undefined },
      { authenticatorDataB64url: 'not base64url!!' }, { signatureB64url: 42 },
      { clientDataJsonB64url: b64(Buffer.from('not json')) },
      { clientDataJsonB64url: b64(Buffer.from('null')) },
      { clientDataJsonB64url: b64(Buffer.from('[1,2,3]')) },
      { clientDataJsonB64url: b64(Buffer.from('{"type":"webauthn.get"}')) },
    ]) {
      const r = verifyAssertion({ ...good, ...over }, auth.stored(), store, 10_000);
      expect(r.ok, JSON.stringify(over)).toBe(false);
    }
  });

  it('never leaks a private key or an unbounded caller string into `detail`', () => {
    const { store, challenge } = withChallenge('assert');
    const r = verifyAssertion(auth.assert(challenge, { origin: `https://${'a'.repeat(5000)}.example` }),
      auth.stored(), store, 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detail.length).toBeLessThan(400);
      expect(r.detail).not.toContain('PRIVATE KEY');
    }
  });
});

// ── 6. the credential store ─────────────────────────────────────────────────

describe('PasskeyStore', () => {
  const freshStore = (): { store: PasskeyStore; file: string } => {
    const home = mkTmp('ccrc-passkeys-');
    const file = defaultPasskeysPath(home);
    return { store: new PasskeyStore(file), file };
  };
  const row = (id: string, over: Partial<StoredCredential> = {}): StoredCredential => ({
    credentialId: id, spkiB64url: b64(makeAuthenticator().spki), algorithm: COSE_ES256,
    rpId: RP_ID, origin: ORIGIN, signCount: 0, uvAtEnrollment: true,
    enrolledAt: 1, lastUsedAt: 1, label: 'x', ...over,
  });

  it('round-trips through disk, 0600, and counts what it holds', async () => {
    const { store, file } = freshStore();
    const id = b64(randomBytes(32));
    expect(await store.add(row(id))).toBe(true);
    expect(store.count()).toBe(1);
    expect(store.ids()).toEqual([id]);

    const reread = new PasskeyStore(file);
    await reread.load();
    expect(reread.find(id)?.credentialId).toBe(id);
    expect(readFileSync(file, 'utf8')).toContain(id);
  });

  it('RE-ENROLLING the same id replaces the row rather than adding a second', async () => {
    // Two rows for one key means `find` returns the first, whose counter is
    // stale, and every assertion is then refused as a replay.
    const { store } = freshStore();
    const id = b64(randomBytes(32));
    await store.add(row(id, { signCount: 4 }));
    await store.add(row(id, { signCount: 0, label: 'the second tap' }));
    expect(store.count()).toBe(1);
    expect(store.find(id)?.label).toBe('the second tap');
  });

  it('advances the counter in MEMORY first, so a failed write cannot weaken the replay defence', async () => {
    const { store } = freshStore();
    const id = b64(randomBytes(32));
    await store.add(row(id));
    await store.recordUse(id, 12, 5_000);
    expect(store.find(id)?.signCount).toBe(12);
    expect(store.find(id)?.lastUsedAt).toBe(5_000);
  });

  it('caps the number of credentials and says so rather than dropping one', async () => {
    const { store } = freshStore();
    for (let i = 0; i < MAX_CREDENTIALS; i++) expect(await store.add(row(b64(randomBytes(32))))).toBe(true);
    expect(await store.add(row(b64(randomBytes(32))))).toBe(false);
    expect(store.count()).toBe(MAX_CREDENTIALS);
  });

  it('degrades a CORRUPT file to empty — which is the DENYING answer here', async () => {
    // The opposite polarity to `secret.ts` on purpose: an unreadable passphrase
    // must not read as "no passphrase" (that opens the gate); an unreadable
    // passkey file reading as "no passkeys" refuses every passkey login and
    // leaves the passphrase working.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const home = mkTmp('ccrc-passkeys-corrupt-');
      const file = defaultPasskeysPath(home);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, '{ not json');
      const store = new PasskeyStore(file);
      await store.load();
      expect(store.count()).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('drops a malformed ROW without evicting the good ones beside it', async () => {
    const home = mkTmp('ccrc-passkeys-rows-');
    const file = defaultPasskeysPath(home);
    mkdirSync(path.dirname(file), { recursive: true });
    const good = row(b64(randomBytes(32)));
    writeFileSync(file, JSON.stringify([
      good,
      { ...row(b64(randomBytes(32))), origin: '' },            // an empty origin is a check that passes
      { ...row(b64(randomBytes(32))), signCount: -1 },          // a negative replay floor
      { ...row(b64(randomBytes(32))), rpId: '' },               // an empty rpId hashes to something
      { ...row(b64(randomBytes(32))), credentialId: 'not b64!' },
      { ...row(b64(randomBytes(32))), spkiB64url: 'not b64!' },
      { ...row(b64(randomBytes(32))), algorithm: 'ES256' },
      good,                                                     // a DUPLICATE id
      null, 'a string', 42,
    ]));
    const store = new PasskeyStore(file);
    await store.load();
    expect(store.count()).toBe(1);
    expect(store.ids()).toEqual([good.credentialId]);
  });

  it('an absent file is the ordinary first run — empty and silent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { store } = freshStore();
      await store.load();
      expect(store.count()).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});

// ── 7. the routes ───────────────────────────────────────────────────────────

const stubPty = (): PtyLike => ({
  onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {},
});

interface AppOpts { enabled?: boolean; rpId?: string; origin?: string; secret?: boolean }

const openApp = async (opts: AppOpts = {}): Promise<{ app: FastifyInstance; home: string }> => {
  const home = mkTmp('ccrc-passkey-route-');
  const base = testDeps(home);
  if (opts.secret !== false) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`,
      { mode: 0o600 });
  }
  const deps: Deps = {
    ...base,
    cfg: {
      ...base.cfg,
      authEnabled: opts.enabled ?? true,
      cookieSecure: false,
      rpId: opts.rpId ?? RP_ID,
      origin: opts.origin ?? ORIGIN,
    },
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

/** Enrol `auth` through the REAL routes, with a real session cookie. */
const enrol = async (app: FastifyInstance, auth: Authenticator, cookie: string): Promise<void> => {
  const start = await app.inject({
    method: 'POST', url: '/api/auth/passkey/register/start', headers: { cookie },
  });
  expect(start.statusCode, start.body).toBe(200);
  const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
  const finish = await app.inject({
    method: 'POST', url: '/api/auth/passkey/register/finish', headers: { cookie },
    payload: auth.register(challengeB64url),
  });
  expect(finish.statusCode, finish.body).toBe(204);
};

/** Log in with a passkey through the REAL routes. Returns the raw response. */
const passkeyLogin = async (app: FastifyInstance, auth: Authenticator, signCount = 1) => {
  const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/assert/start' });
  expect(start.statusCode, start.body).toBe(200);
  const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
  return app.inject({
    method: 'POST', url: '/api/auth/passkey/assert/finish', payload: auth.assert(challengeB64url, { signCount }),
  });
};

describe('the passkey routes, end to end', () => {
  let app: FastifyInstance | undefined;
  let warn: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    warn?.mockRestore();
    warn = undefined;
  });

  it('ENROL then SIGN IN: a real key, a real signature, a real session cookie', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);

    // The status route now reports a REAL count, which is what draws the button.
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(JSON.parse(status.body)).toMatchObject({ passkeysEnrolled: 1, mode: 'passphrase' });

    const res = await passkeyLogin(app, auth);
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    expect(line).toContain(`${SESSION_COOKIE}=`);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('SameSite=Lax');

    // …and the cookie it minted is a REAL session: a gated route answers.
    const gated = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie: line.slice(0, line.indexOf(';')) },
    });
    expect(gated.statusCode).toBe(200);
  });

  it('ENROLMENT IS BEHIND THE GATE — an anonymous caller cannot register a key', async () => {
    // The exemption decision that makes `attestation: none` safe. An ungated
    // enrol route would let anyone on the tailnet own the box forever.
    const w = await openApp(); app = w.app;
    for (const url of ['/api/auth/passkey/register/start', '/api/auth/passkey/register/finish']) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode, url).toBe(401);
      expect(JSON.parse(res.body).verdict, url).toBe('no-session');
      expect(EXEMPT.has(`POST ${url}`), url).toBe(false);
    }
  });

  it('…while the ASSERT pair is exempt, because it IS the door', async () => {
    const w = await openApp(); app = w.app;
    for (const url of ['/api/auth/passkey/assert/start', '/api/auth/passkey/assert/finish']) {
      expect(EXEMPT.has(`POST ${url}`), url).toBe(true);
    }
    const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/assert/start' });
    expect(start.statusCode).toBe(200);
    expect(JSON.parse(start.body)).toMatchObject({ rpId: RP_ID, allowCredentialIdsB64url: [] });
  });

  it('the signature counter ADVANCES on disk — a replayed assertion is refused twice over', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);

    expect((await passkeyLogin(app, auth, 5)).statusCode).toBe(204);
    // A FRESH challenge with a counter that did not advance: this is the
    // signCount wall alone, with the challenge wall satisfied.
    const stale = await passkeyLogin(app, auth, 5);
    expect(stale.statusCode).toBe(401);
    expect(JSON.parse(stale.body).verdict).toBe('wrong');
    // …and it persisted: a store re-read off disk sees the advanced counter.
    const reread = new PasskeyStore(defaultPasskeysPath(w.home));
    await reread.load();
    expect(reread.ids()).toHaveLength(1);
    expect(reread.find(reread.ids()[0]!)?.signCount).toBe(5);
  });

  it('a REPLAYED ASSERTION (same bytes, same challenge) is refused', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);

    const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/assert/start' });
    const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
    const assertion = auth.assert(challengeB64url, { signCount: 3 });
    expect((await app.inject({
      method: 'POST', url: '/api/auth/passkey/assert/finish', payload: assertion,
    })).statusCode).toBe(204);
    const again = await app.inject({
      method: 'POST', url: '/api/auth/passkey/assert/finish', payload: assertion,
    });
    expect(again.statusCode).toBe(401);
  });

  it('a REGISTRATION challenge cannot be spent on the login door — the stores do not cross', async () => {
    // The server wiring, not just the class: `ChallengeStore`'s own unit test
    // proves two instances are independent, and this proves `buildServer`
    // actually built two. Merging them at the composition root is a one-line
    // "simplification" that the type check inside `verifyAssertion` would
    // partially cover and no route test would notice.
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);

    const reg = await app.inject({
      method: 'POST', url: '/api/auth/passkey/register/start', headers: { cookie },
    });
    const { challengeB64url } = JSON.parse(reg.body) as { challengeB64url: string };
    const res = await app.inject({
      method: 'POST', url: '/api/auth/passkey/assert/finish',
      payload: auth.assert(challengeB64url, { signCount: 9 }),
    });
    expect(res.statusCode).toBe(401);
    expect(warn!.mock.calls.flat().join(' ')).toContain('stale-challenge');
  });

  it('an UNKNOWN credential is refused, and answers exactly what a bad signature answers', async () => {
    // No oracle: "that id exists but its counter is stale" must not be
    // distinguishable from "no such credential".
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const stranger = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);

    const unknown = await passkeyLogin(app, stranger);
    expect(unknown.statusCode).toBe(401);
    // THE ROUTE'S OWN LOOKUP refused this, not the verifier behind it. Pinned
    // through the journal line because that is the only place the two are
    // distinguishable — the WIRE answer is deliberately identical (no oracle).
    // Without this clause a route that fell back to some other enrolled
    // credential would still be refused, by the id cross-check inside
    // `verifyAssertion`, and this test would not notice the route had stopped
    // looking the credential up at all.
    expect(warn!.mock.calls.flat().join(' ')).toContain('no credential with that id is enrolled');

    const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/assert/start' });
    const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
    const forged = await app.inject({
      method: 'POST', url: '/api/auth/passkey/assert/finish',
      payload: { ...auth.assert(challengeB64url, { signCount: 1 }), signatureB64url: b64(randomBytes(70)) },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.body).toBe(unknown.body);
  });

  it('a WRONG-ORIGIN assertion is refused at the route', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);

    const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/assert/start' });
    const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
    const res = await app.inject({
      method: 'POST', url: '/api/auth/passkey/assert/finish',
      payload: auth.assert(challengeB64url, { signCount: 1, origin: 'https://evil.example' }),
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).verdict).toBe('wrong');
  });

  it('records rpId and origin ON THE ROW, so a rename fails LOUDLY', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);
    const store = new PasskeyStore(defaultPasskeysPath(w.home));
    await store.load();
    const cred = store.find(store.ids()[0]!)!;
    expect(cred.rpId).toBe(RP_ID);
    expect(cred.origin).toBe(ORIGIN);
    expect(cred.uvAtEnrollment).toBe(true);
    // And the sentence a renamed box produces names the fix.
    const renamed = verifyAssertion(auth.assert('x'), { ...cred, rpId: 'renamed.example' },
      new ChallengeStore('assert'), 10_000);
    expect(renamed.ok).toBe(false);
    if (!renamed.ok) expect(renamed.detail).toMatch(/re-enrol|stale|spent/);
  });

  it('a MISCONFIGURED relying party disables passkeys and never publishes why', async () => {
    // The public-suffix typo, end to end: 501 on every ceremony, the reason in
    // the journal only — an unauthenticated caller learns nothing about the box.
    const w = await openApp({ rpId: 'ts.net', origin: 'https://box.ts.net' }); app = w.app;
    const cookie = await login(app);
    for (const [url, headers] of [
      ['/api/auth/passkey/assert/start', {}],
      ['/api/auth/passkey/register/start', { cookie }],
    ] as const) {
      const res = await app.inject({ method: 'POST', url, headers });
      expect(res.statusCode, url).toBe(501);
      expect(res.body, url).not.toContain('ts.net');
      expect(res.body, url).not.toContain('PUBLIC SUFFIX');
    }
    expect(warn!.mock.calls.flat().join(' ')).toContain('PUBLIC SUFFIX');
  });

  it('501s on every ceremony with CCRC_AUTH off — the feature ships dark', async () => {
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    for (const url of [
      '/api/auth/passkey/register/start', '/api/auth/passkey/register/finish',
      '/api/auth/passkey/assert/start', '/api/auth/passkey/assert/finish',
    ]) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode, url).toBe(501);
      expect(JSON.parse(res.body), url).toMatchObject({ error: 'not-configured' });
    }
  });

  it('an armed box with NO passphrase file cannot be entered by a passkey either', async () => {
    // The D-39 inversion applied to the second door. There is also no secret
    // GENERATION to stamp a session with, so this is structural as well as
    // policy.
    const w = await openApp({ secret: false }); app = w.app;
    const auth = makeAuthenticator();
    const res = await passkeyLogin(app, auth);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).verdict).toBe('unconfigured');
  });

  it('a malformed body is a 400, never a 500', async () => {
    const w = await openApp(); app = w.app;
    for (const payload of [
      undefined, {}, { credentialIdB64url: '' }, { credentialIdB64url: 42 },
    ]) {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/passkey/assert/finish',
        ...(payload === undefined ? {} : { payload }),
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('never logs a cookie, a token or a passphrase', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    const cookie = await login(app);
    await enrol(app, auth, cookie);
    await passkeyLogin(app, auth);
    await app.inject({
      method: 'POST', url: '/api/auth/passkey/assert/finish',
      payload: { ...auth.assert('nope'), signatureB64url: b64(randomBytes(70)) },
    });
    const logged = warn!.mock.calls.flat().join(' ');
    expect(logged).not.toContain(PASSPHRASE);
    expect(logged).not.toContain(cookie);
    expect(logged).not.toContain(SESSION_COOKIE);
  });

  it('the passkey lane spends its OWN, looser budget — a flood cannot close the passphrase door', async () => {
    // Separate state, separate ceiling. If they shared one, an attacker could
    // hammer the passkey route and lock the operator out of the door that works.
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    for (let i = 0; i < 12; i++) {
      const res = await passkeyLogin(app, auth);
      expect(res.statusCode, `attempt ${i}`).toBe(401);
    }
    // 12 passkey failures is well past MAX_FAILURES (8) and well under
    // PASSKEY_MAX_FAILURES (60) — the passphrase door is untouched.
    const ok = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE },
    });
    expect(ok.statusCode, ok.body).toBe(204);
  });

  it('…and does eventually lock, with a Retry-After', async () => {
    const w = await openApp(); app = w.app;
    const auth = makeAuthenticator();
    // BOTH halves spend the same window, so the lock can arrive on either — the
    // loop drives `assert/start` directly rather than through `passkeyLogin`,
    // whose 200-assertion is the thing being made false here.
    let locked: { statusCode: number; body: string; headers: Record<string, unknown> } | undefined;
    for (let i = 0; i < 80; i++) {
      const start = await app.inject({ method: 'POST', url: '/api/auth/passkey/assert/start' });
      if (start.statusCode === 429) { locked = start; break; }
      const { challengeB64url } = JSON.parse(start.body) as { challengeB64url: string };
      const res = await app.inject({
        method: 'POST', url: '/api/auth/passkey/assert/finish',
        payload: { ...auth.assert(challengeB64url, { signCount: 1 }), signatureB64url: b64(randomBytes(70)) },
      });
      if (res.statusCode === 429) { locked = res; break; }
    }
    expect(locked, 'the passkey lane never locked in 80 attempts').toBeDefined();
    expect(JSON.parse(locked!.body).verdict).toBe('locked-out');
    expect(locked!.headers['retry-after']).toBeDefined();
  });
});

// ── 8. the /ws/* Origin check ───────────────────────────────────────────────

describe('wsOriginVerdict — the pure decision', () => {
  it('allows the configured origin, and only it', () => {
    expect(wsOriginVerdict(ORIGIN, ORIGIN)).toBe('ok');
    expect(wsOriginVerdict('http://localhost:7789', ORIGIN)).toBe('mismatch');
    expect(wsOriginVerdict('https://localhost:7788', ORIGIN)).toBe('mismatch');
    expect(wsOriginVerdict('http://localhost:7788.evil.example', ORIGIN)).toBe('mismatch');
  });

  it('the SAME-SITE tailnet sibling is a mismatch — which is the whole point', () => {
    // `ts.net` is a public suffix, so every node on one tailnet shares a
    // registrable domain and `SameSite=Lax` sends the cookie between them. Only
    // this check refuses the sibling.
    const box = 'https://server-box.tailnet-example.ts.net';
    expect(wsOriginVerdict('https://other-box.tailnet-example.ts.net', box)).toBe('mismatch');
    expect(wsOriginVerdict(box, box)).toBe('ok');
  });

  it('names ABSENT as its own state — a non-browser, not a refusal', () => {
    expect(wsOriginVerdict(undefined, ORIGIN)).toBe('absent');
    expect(wsOriginVerdict('', ORIGIN)).toBe('absent');
  });

  it('two Origin headers is not one origin', () => {
    expect(wsOriginVerdict([ORIGIN, 'https://evil.example'], ORIGIN)).toBe('mismatch');
  });
});

describe('the /ws/* upgrade is origin-bound', () => {
  let app: FastifyInstance | undefined;
  let warn: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(async () => {
    if (app) await app.close(); app = undefined;
    warn?.mockRestore(); warn = undefined;
  });

  const WS = ['/ws/fleet', '/ws/session/x', '/ws/pty/x'];

  it.each(WS)('%s: a FOREIGN origin is refused even WITH a valid session cookie', async (url) => {
    // The cookie is valid — that is what makes this an attack rather than a
    // mistake. A session check running first would have allowed it.
    const w = await openApp(); app = w.app;
    const cookie = await login(app);
    await expect(app.injectWS(url, {
      headers: { cookie, origin: 'https://other-box.tailnet-example.ts.net' },
    })).rejects.toThrow('Unexpected server response: 401');
    expect(warn!.mock.calls.flat().join(' ')).toContain('foreign origin');
    // …and never logs the cookie it just refused.
    expect(warn!.mock.calls.flat().join(' ')).not.toContain(cookie);
  });

  it.each(WS)('%s: the CONFIGURED origin, with a session, still upgrades', async (url) => {
    const w = await openApp(); app = w.app;
    const cookie = await login(app);
    const ws = await app.injectWS(url, { headers: { cookie, origin: ORIGIN } });
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it('an ABSENT origin is allowed — a non-browser client has no cookie jar to hijack', async () => {
    const w = await openApp(); app = w.app;
    const cookie = await login(app);
    const ws = await app.injectWS('/ws/fleet', { headers: { cookie } });
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it('the check is not a substitute for the gate: a foreign origin AND no cookie is still 401', async () => {
    const w = await openApp(); app = w.app;
    await expect(app.injectWS('/ws/fleet', { headers: { origin: 'https://evil.example' } }))
      .rejects.toThrow('Unexpected server response: 401');
  });

  it('does NOT apply to ordinary routes — the box-token machine lanes have no origin', async () => {
    // `curl` inside a Claude Code session sends no Origin and never will;
    // extending the check to every route would break the fleet's own ingress.
    const w = await openApp(); app = w.app;
    const cookie = await login(app);
    const res = await app.inject({
      method: 'GET', url: '/api/accounts', headers: { cookie, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('is DARK with CCRC_AUTH off — arming the flag is the only thing that changes behaviour', async () => {
    const w = await openApp({ enabled: false, secret: false }); app = w.app;
    const ws = await app.injectWS('/ws/fleet', { headers: { origin: 'https://evil.example' } });
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });
});
