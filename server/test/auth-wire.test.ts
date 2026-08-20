// Stage 3a Task 1 — the auth wire vocabulary, pinned where it is DERIVED.
//
// Two different guarantees live in this file, and only one of them is a test at
// all. The COMPILE-TIME half — `Record<AuthVerdict, true>` making a seventh
// verdict a TS2739 rather than a silently short list — is a gate, not a case:
// `typecheck-tests.test.ts` compiles this directory, so every typed literal
// below is an assertion the compiler makes and vitest merely reports. The
// RUNTIME half is what tsc cannot do: check that the derived list really did
// come from the map, that the predicate answers for every member, and that the
// vocabulary has not been restated somewhere the compiler is not watching
// (`single-definition.test.ts` owns that last scan, on the same four roots it
// already walks for `PrReason`).
//
// The mutation this file exists to catch, measured before it was written: hand
// -write `AUTH_VERDICTS` back into a literal array missing one member and the
// derive test goes red. That is the difference between "derived" as a comment
// and "derived" as a mechanism — the exact lesson `PR_REASONS` is named after.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_VERDICTS, isAuthVerdict, FLEET_PROTO, FLEET_PROTO_MIN,
  type AuthStatus, type AuthVerdict, type LoginRequest,
  type PasskeyAssertFinish, type PasskeyAssertStart,
  type PasskeyRegisterFinish, type PasskeyRegisterStart,
} from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_TS = path.resolve(here, '..', '..', 'shared', 'api.ts');

describe('the verdict vocabulary derives from the map', () => {
  it('is the six the gate can actually reach, each recognised by the predicate', () => {
    // SIX, and named — because a boolean here is the defect this slice is
    // written against. `coord/token.ts` folded `'unconfigured'` into `'ok'`
    // (D-39) and ran the mail lane unauthenticated; a union whose members a
    // route must switch on cannot make that mistake silently.
    expect([...AUTH_VERDICTS].sort()).toEqual(
      ['expired', 'locked-out', 'no-session', 'ok', 'unconfigured', 'wrong'],
    );
    expect(AUTH_VERDICTS).toHaveLength(6);
    expect(new Set(AUTH_VERDICTS).size).toBe(AUTH_VERDICTS.length);
    for (const v of AUTH_VERDICTS) expect(isAuthVerdict(v), v).toBe(true);
  });

  it('answers rather than narrows for anything that is not a verdict', () => {
    // `unknown` in, so nothing is smuggled past by claiming it is already a
    // verdict, and the CONSTANT is cast rather than the input — `isPrReason`'s
    // rule, for `isPrReason`'s reason.
    expect(isAuthVerdict('not-a-verdict')).toBe(false);
    expect(isAuthVerdict('OK')).toBe(false);
    expect(isAuthVerdict('')).toBe(false);
    expect(isAuthVerdict(null)).toBe(false);
    expect(isAuthVerdict(undefined)).toBe(false);
    expect(isAuthVerdict(7)).toBe(false);
    expect(isAuthVerdict({ ok: true })).toBe(false);
  });

  it('is spelled once, as Object.keys over the map — not a second time as an array', () => {
    // The runtime assertions above still pass if someone hand-writes the six
    // back into a literal that HAPPENS to be complete today. This is the
    // assertion that the list is derived at all, so the next member added to
    // the union cannot leave it one short. Text, deliberately, and with the
    // same disclosed limit as `single-definition.test.ts`: it catches the copy
    // a reasonable person writes, not an unforgeable one.
    const src = readFileSync(API_TS, 'utf8');
    expect(src).toMatch(
      /export const AUTH_VERDICTS: readonly AuthVerdict\[\] =\s*Object\.keys\(AUTH_VERDICT_MAP\)/,
    );
    // …and the map is typed over the union, which is what makes a seventh
    // verdict a compile error here instead of a short list at runtime.
    expect(src).toContain('Record<AuthVerdict, true>');
  });
});

describe('the request/response shapes both sides import', () => {
  it('LoginRequest carries the passphrase and nothing else', () => {
    const body: LoginRequest = { passphrase: 'correct horse battery staple' };
    expect(Object.keys(body)).toEqual(['passphrase']);
  });

  it('has no LoginResponse body type, deliberately', () => {
    // A successful login is `204 + Set-Cookie` — the cookie IS the response.
    // An empty interface would be a shape the server never sends and the PWA
    // would then be tempted to parse, so the absence is stated in the source
    // rather than papered over with `{}`.
    const src = readFileSync(API_TS, 'utf8');
    expect(src).not.toMatch(/\binterface\s+LoginResponse\b/);
    expect(src).toContain('LoginResponse');   // the paragraph explaining why not
  });

  it('AuthStatus reports the gate posture the login screen renders', () => {
    const off: AuthStatus = { authed: true, passkeysEnrolled: 0, mode: 'off' };
    const armed: AuthStatus = { authed: false, passkeysEnrolled: 2, mode: 'passphrase' };
    const braked: AuthStatus = { authed: false, passkeysEnrolled: 2, mode: 'locked-out' };
    // Three modes, and `passkeysEnrolled` is a COUNT, not a boolean: the enroll
    // screen has to say "2 passkeys" and the login screen has to know whether
    // to offer the passkey button at all.
    expect([off.mode, armed.mode, braked.mode]).toEqual(['off', 'passphrase', 'locked-out']);
    expect(armed.passkeysEnrolled).toBe(2);
    // `mode` is NOT `AuthVerdict` narrowed — it is the box's standing posture,
    // not this request's outcome. `'off'` and `'passphrase'` are not verdicts
    // at all, which is the proof they are different axes.
    expect(isAuthVerdict('off')).toBe(false);
    expect(isAuthVerdict('passphrase')).toBe(false);
  });
});

describe('the WebAuthn wire shapes Task 8 implements against', () => {
  it('registration: a challenge out, an SPKI public key back', () => {
    const start: PasskeyRegisterStart = {
      challengeB64url: 'Q2hhbGxlbmdl',
      rpId: 'localhost',
      userHandleB64url: 'dXNlci1oYW5kbGU',
    };
    const finish: PasskeyRegisterFinish = {
      credentialIdB64url: 'Y3JlZC1pZA',
      publicKeySpkiB64url: 'c3BraS1kZXI',
      algorithm: -7,
      authenticatorDataB64url: 'YXV0aC1kYXRh',
      clientDataJsonB64url: 'Y2xpZW50LWRhdGE',
    };
    expect(start.rpId).toBe('localhost');
    // A COSE algorithm identifier — a NUMBER (ES256 is -7), never a name, so
    // the server can refuse an algorithm it cannot verify.
    expect(finish.algorithm).toBe(-7);
    expect(Object.keys(finish)).toEqual([
      'credentialIdB64url', 'publicKeySpkiB64url', 'algorithm',
      'authenticatorDataB64url', 'clientDataJsonB64url',
    ]);
  });

  it('assertion: a challenge plus the credentials this box will accept, a signature back', () => {
    const start: PasskeyAssertStart = {
      challengeB64url: 'Q2hhbGxlbmdl',
      rpId: 'localhost',
      allowCredentialIdsB64url: ['Y3JlZC1pZA'],
    };
    const finish: PasskeyAssertFinish = {
      credentialIdB64url: 'Y3JlZC1pZA',
      authenticatorDataB64url: 'YXV0aC1kYXRh',
      clientDataJsonB64url: 'Y2xpZW50LWRhdGE',
      signatureB64url: 'ZGVyLXNpZw',
    };
    expect(start.allowCredentialIdsB64url).toEqual([finish.credentialIdB64url]);
    expect(Object.keys(finish)).toEqual([
      'credentialIdB64url', 'authenticatorDataB64url',
      'clientDataJsonB64url', 'signatureB64url',
    ]);
  });

  it('names its encoding in the source — every one of these fields is base64url', () => {
    // `-`/`_` and no `=` padding (RFC 4648 §5), which is what the browser's own
    // WebAuthn JSON helpers emit and what `Buffer.from(s, 'base64url')` reads.
    // Standard base64 would round-trip through `+`/`/` and break the moment one
    // of these rides in a URL — worth a sentence in the source, not only here.
    const src = readFileSync(API_TS, 'utf8');
    expect(src).toContain('base64url');
  });
});

describe('a route family is not a protocol change', () => {
  it('does not bump FLEET_PROTO', () => {
    // Auth adds no fleet frame and no field to one. `fleet-protocol.test.ts`
    // owns the standing pin; this one states the intent at the site of the
    // change that could have moved it — the same thing `fleetws.test.ts` does
    // for the `runs` frame.
    expect(FLEET_PROTO).toBe(1);
    expect(FLEET_PROTO_MIN).toBe(1);
  });
});

// Compile-time only: proof that every verdict is reachable by name from a
// consumer, i.e. that the union really is the six and not `string`. Assigning
// a non-member here is TS2322 under `typecheck-tests.test.ts`.
const _verdicts: readonly AuthVerdict[] = [
  'ok', 'wrong', 'unconfigured', 'locked-out', 'expired', 'no-session',
];
describe('the union narrows', () => {
  it('accepts exactly the six by name at compile time', () => {
    expect([..._verdicts].sort()).toEqual([...AUTH_VERDICTS].sort());
  });
});
