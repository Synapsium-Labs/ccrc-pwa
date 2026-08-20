// Stage 3a Task 8 — the PWA half of the passkey ceremony.
//
// FOUR SEAMS, and the failure each one exists to prevent:
//
//   1. `lib/passkey.ts`'s base64url — `atob`/`btoa` speak STANDARD base64 and
//      every field on this wire is base64url. The server's decoder is strict
//      (it refuses padding and the `+`/`/` alphabet outright), so a slip here is
//      an enrolment the browser completes and the box refuses.
//   2. THE EXTRACTION — `getPublicKey()`/`getPublicKeyAlgorithm()`/
//      `getAuthenticatorData()`, which is the entire reason no CBOR decoder
//      exists anywhere in this repo. A test that sent `attestationObject`
//      instead would still "work" against a mock and fail against the server.
//   3. THE BUTTON'S CONDITION — it must not appear on a dark box, on a box with
//      no key enrolled, or in a browser that cannot finish the ceremony. All
//      three fail CLOSED.
//   4. THE THREE FAILURE KINDS — cancelled / refused / unreachable get three
//      different sentences, because they are three different situations.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COSE_ES256 } from '../../shared/api';
import { LoginScreen, UNREACHABLE_TEXT, VERDICT_TEXT } from '../src/components/LoginScreen';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { ApiError } from '../src/lib/api';
import { authLost, clearAuthLost, isAuthLost, raiseAuthLost } from '../src/lib/auth';
import {
  PasskeyCeremonyError, assertPasskey, enrollPasskey, fromB64url, passkeyEnrollSupported,
  passkeyLoginSupported, toB64url,
} from '../src/lib/passkey';

const json = (status: number, body?: unknown): Response =>
  new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

const b64url = (bytes: number[]): string => toB64url(new Uint8Array(bytes).buffer);

/**
 * A browser that can do BOTH ceremonies — WebAuthn Level 2, i.e. with the
 * response methods the no-CBOR design needs. `AuthenticatorAttestationResponse`
 * is stubbed because that is the interface which actually declares
 * `getPublicKey()`; stubbing `PublicKeyCredential` alone is the L1-vs-L2 mistake
 * this fixture exists to make impossible to repeat.
 */
const supportBrowser = (): void => {
  vi.stubGlobal('PublicKeyCredential', class {
    getClientExtensionResults(): unknown { return {}; }
  });
  vi.stubGlobal('AuthenticatorAttestationResponse', class {
    getPublicKey(): unknown { return null; }
  });
  vi.stubGlobal('navigator', { ...navigator, credentials: { create: vi.fn(), get: vi.fn() } });
};

/** A browser with WebAuthn LEVEL 1 only: it has `PublicKeyCredential` and
 *  `navigator.credentials`, and no `AuthenticatorAttestationResponse.prototype.
 *  getPublicKey`. It can SIGN IN with a key enrolled elsewhere and cannot
 *  CREATE one — the case a single predicate got wrong in both directions. */
const level1Browser = (): void => {
  vi.stubGlobal('PublicKeyCredential', class {
    getClientExtensionResults(): unknown { return {}; }
  });
  vi.stubGlobal('AuthenticatorAttestationResponse', undefined);
  vi.stubGlobal('navigator', { ...navigator, credentials: { create: vi.fn(), get: vi.fn() } });
};

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. base64url, both directions ───────────────────────────────────────────

describe('base64url is base64url — not base64 with a different comment', () => {
  it('emits the URL alphabet and NO padding', () => {
    // 0xff 0xef 0xfe is `/+/+` in standard base64 — the two characters the url
    // alphabet replaces. A `btoa` shipped raw would send exactly this and the
    // server's strict decoder would refuse it.
    expect(b64url([0xff, 0xef, 0xfe])).toBe('_-_-');
    // One byte → two base64 chars plus `==` in the standard alphabet. None here.
    expect(b64url([0x41])).toBe('QQ');
    expect(b64url([0x41])).not.toContain('=');
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect([...fromB64url(toB64url(all.buffer))]).toEqual([...all]);
  });

  it('decodes an unpadded field — which is the only kind the wire carries', () => {
    expect([...fromB64url('QQ')]).toEqual([0x41]);
    expect([...fromB64url('_-_-')]).toEqual([0xff, 0xef, 0xfe]);
  });
});

// ── 2. the no-CBOR extraction ───────────────────────────────────────────────

describe('enrollPasskey sends the EXTRACTED key, never the attestation object', () => {
  const spki = new Uint8Array([0x30, 0x59, 0x01, 0x02]).buffer;
  const authData = new Uint8Array([1, 2, 3, 4]).buffer;
  const clientDataJSON = new Uint8Array([5, 6, 7]).buffer;
  const rawId = new Uint8Array([9, 9, 9]).buffer;

  const fakeCredential = (over: Partial<{ getPublicKey: () => ArrayBuffer | null }> = {}) => ({
    rawId,
    response: {
      clientDataJSON,
      getPublicKey: over.getPublicKey ?? (() => spki),
      getPublicKeyAlgorithm: () => COSE_ES256,
      getAuthenticatorData: () => authData,
      // Present, and DELIBERATELY NEVER READ. Its existence in the fixture is
      // what makes the assertion below meaningful: the client could have sent
      // it, and does not.
      attestationObject: new Uint8Array([0xa3, 0x63, 0x66, 0x6d, 0x74]).buffer,
    },
  });

  it('POSTs the SPKI, the alg NUMBER and the raw authenticator data', async () => {
    const fetchImpl = vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).endsWith('/register/start')
        ? json(200, { challengeB64url: 'QUJD', rpId: 'localhost', userHandleB64url: 'QUJD' })
        : json(204));
    vi.stubGlobal('fetch', fetchImpl);
    const create = vi.fn(async (_o: CredentialCreationOptions) => fakeCredential());

    await enrollPasskey({ create, get: vi.fn() } as never);

    const finish = fetchImpl.mock.calls.find(([u]) => String(u).endsWith('/register/finish'));
    expect(finish).toBeTruthy();
    const sent = JSON.parse((finish![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(sent).toEqual({
      credentialIdB64url: toB64url(rawId),
      publicKeySpkiB64url: toB64url(spki),
      algorithm: COSE_ES256,
      authenticatorDataB64url: toB64url(authData),
      clientDataJsonB64url: toB64url(clientDataJSON),
    });
    // THE NO-CBOR CLAIM, as an assertion: the attestation object never crosses
    // the wire, so nothing on the far side could need a decoder for it.
    expect(JSON.stringify(sent)).not.toContain('attestation');
    expect(Object.keys(sent)).not.toContain('attestationObject');
  });

  it('asks for `attestation: none`, ES256, and REQUIRED user verification', async () => {
    // All three must agree with the server. `userVerification` especially: the
    // server refuses an assertion with the UV flag clear AND refuses to enrol a
    // key that cannot set it, so asking for anything weaker here would run a
    // full ceremony that is then rejected.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).endsWith('/register/start')
        ? json(200, { challengeB64url: 'QUJD', rpId: 'localhost', userHandleB64url: 'QUJD' })
        : json(204)));
    const create = vi.fn(async (_o: CredentialCreationOptions) => fakeCredential());

    await enrollPasskey({ create, get: vi.fn() } as never);

    const opts = create.mock.calls[0]![0] as CredentialCreationOptions;
    const pk = opts.publicKey!;
    expect(pk.attestation).toBe('none');
    expect(pk.pubKeyCredParams).toEqual([{ type: 'public-key', alg: COSE_ES256 }]);
    expect(pk.authenticatorSelection?.userVerification).toBe('required');
    // The rpId is the SERVER's, echoed — never derived from `location.hostname`,
    // which is the public-suffix hazard with a different author.
    expect(pk.rp.id).toBe('localhost');
    expect([...new Uint8Array(pk.challenge as ArrayBuffer)]).toEqual([...fromB64url('QUJD')]);
    // No PII in the user handle.
    expect(pk.user.name).not.toContain('@');
  });

  it('refuses when the browser cannot export the key — the failure stays at ENROLMENT', async () => {
    // `getPublicKey()` returns null for a key type the client cannot render as
    // SPKI. Sending something incomplete would produce a credential that exists
    // and can never assert; refusing keeps the failure where the passphrase
    // still works.
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json(200, { challengeB64url: 'QUJD', rpId: 'localhost', userHandleB64url: 'QUJD' }));
    vi.stubGlobal('fetch', fetchImpl);
    const create = vi.fn(async (_o: CredentialCreationOptions) => fakeCredential({ getPublicKey: () => null }));

    await expect(enrollPasskey({ create, get: vi.fn() } as never)).rejects.toBeInstanceOf(PasskeyCeremonyError);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/register/finish'))).toBe(false);
  });
});

// ── 3. the assertion ────────────────────────────────────────────────────────

describe('assertPasskey', () => {
  const rawId = new Uint8Array([1, 1, 1]).buffer;
  const assertion = {
    rawId,
    response: {
      authenticatorData: new Uint8Array([2, 2]).buffer,
      clientDataJSON: new Uint8Array([3, 3]).buffer,
      // DER, as the authenticator produced it — 0x30 is an ASN.1 SEQUENCE.
      signature: new Uint8Array([0x30, 0x44, 0x02, 0x20]).buffer,
    },
  };

  it('sends the DER signature unchanged — no (r, s) unpacking anywhere', async () => {
    const fetchImpl = vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).endsWith('/assert/start')
        ? json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB'] })
        : json(204));
    vi.stubGlobal('fetch', fetchImpl);
    const get = vi.fn(async (_o: CredentialRequestOptions) => assertion);

    await assertPasskey({ create: vi.fn(), get } as never);

    const finish = fetchImpl.mock.calls.find(([u]) => String(u).endsWith('/assert/finish'));
    const sent = JSON.parse((finish![1] as RequestInit).body as string) as Record<string, string>;
    expect(sent.signatureB64url).toBe(toB64url(assertion.response.signature));
    // Byte-for-byte what the authenticator gave us, DER header and all.
    expect([...fromB64url(sent.signatureB64url!)]).toEqual([0x30, 0x44, 0x02, 0x20]);
    expect(sent.authenticatorDataB64url).toBe(toB64url(assertion.response.authenticatorData));
    expect(sent.clientDataJsonB64url).toBe(toB64url(assertion.response.clientDataJSON));
  });

  it('passes the server\'s allowCredentials through, and asks for UV', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).endsWith('/assert/start')
        ? json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB', 'AgIC'] })
        : json(204)));
    const get = vi.fn(async (_o: CredentialRequestOptions) => assertion);

    await assertPasskey({ create: vi.fn(), get } as never);

    const pk = (get.mock.calls[0]![0] as CredentialRequestOptions).publicKey!;
    expect(pk.userVerification).toBe('required');
    expect(pk.rpId).toBe('localhost');
    expect(pk.allowCredentials?.map((c) => [...new Uint8Array(c.id as ArrayBuffer)]))
      .toEqual([[...fromB64url('AQEB')], [...fromB64url('AgIC')]]);
  });

  it('refuses to prompt when NO key is enrolled — a dialog nobody can satisfy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: [] })));
    const get = vi.fn();
    await expect(assertPasskey({ create: vi.fn(), get } as never))
      .rejects.toBeInstanceOf(PasskeyCeremonyError);
    expect(get).not.toHaveBeenCalled();
  });

  it('a dismissed ceremony is a PasskeyCeremonyError, never a box refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB'] })));
    const get = vi.fn(async (_o: CredentialRequestOptions) => null);
    await expect(assertPasskey({ create: vi.fn(), get } as never))
      .rejects.toBeInstanceOf(PasskeyCeremonyError);
  });

  it('a refused assertion still rejects with the server\'s ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).endsWith('/assert/start')
        ? json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB'] })
        : json(401, { ok: false, error: 'unauthenticated', verdict: 'wrong' })));
    const get = vi.fn(async (_o: CredentialRequestOptions) => assertion);
    const err = await assertPasskey({ create: vi.fn(), get } as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });
});

// ── 4. the two support predicates ───────────────────────────────────────────

describe('the support predicates fail CLOSED, and are not the same question', () => {
  it('both false with no WebAuthn at all', () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    vi.stubGlobal('AuthenticatorAttestationResponse', undefined);
    expect(passkeyLoginSupported()).toBe(false);
    expect(passkeyEnrollSupported()).toBe(false);
  });

  it('both false with no credentials container — a non-secure context', () => {
    vi.stubGlobal('PublicKeyCredential', class {});
    vi.stubGlobal('navigator', { ...navigator, credentials: undefined });
    expect(passkeyLoginSupported()).toBe(false);
    expect(passkeyEnrollSupported()).toBe(false);
  });

  it('both true on a Level 2 browser', () => {
    supportBrowser();
    expect(passkeyLoginSupported()).toBe(true);
    expect(passkeyEnrollSupported()).toBe(true);
  });

  it('ENROL false and LOGIN TRUE on a Level 1 browser — the L1/L2 split', () => {
    // THE BUG THIS PINS: the single predicate probed
    // `PublicKeyCredential.prototype.getClientExtensionResults`, which is
    // WebAuthn L1 and present since 2019 — so it answered "yes" on a browser
    // with no `getPublicKey()`, and the enrol button would open a dialog it
    // could not finish. Probing the L2 method on the interface that declares it
    // fixes that; splitting the predicate keeps the LOGIN button, which needs
    // only L1, from being hidden for no reason.
    level1Browser();
    expect(passkeyEnrollSupported()).toBe(false);
    expect(passkeyLoginSupported()).toBe(true);
  });

  it('the enrol probe looks at AuthenticatorAttestationResponse, not PublicKeyCredential', () => {
    // Directly: an L1 `PublicKeyCredential` that carries `getPublicKey` on ITS
    // prototype must not satisfy the enrol probe — that is not where the method
    // lives, and believing it does is the original defect.
    vi.stubGlobal('PublicKeyCredential', class {
      getPublicKey(): unknown { return null; }
      getClientExtensionResults(): unknown { return {}; }
    });
    vi.stubGlobal('AuthenticatorAttestationResponse', undefined);
    vi.stubGlobal('navigator', { ...navigator, credentials: { create: vi.fn(), get: vi.fn() } });
    expect(passkeyEnrollSupported()).toBe(false);
  });
});

// ── 5. the login screen's button ────────────────────────────────────────────

const statusFetch = (body: unknown, rest: () => Response = () => json(204)) =>
  vi.fn(async (url: unknown, _init?: RequestInit) =>
    String(url).startsWith('/api/auth/status') ? json(200, body) : rest());

const PASSKEY_BUTTON = /sign in with a passkey/i;

describe('the passkey button on the login screen', () => {
  it('appears when a key is enrolled and this browser can use it', async () => {
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 1, mode: 'passphrase' }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    expect(await screen.findByRole('button', { name: PASSKEY_BUTTON })).toBeInTheDocument();
  });

  it('does NOT appear on a box with no key enrolled', async () => {
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 0, mode: 'passphrase' }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    await screen.findByLabelText(/passphrase/i);
    expect(screen.queryByRole('button', { name: PASSKEY_BUTTON })).not.toBeInTheDocument();
  });

  it('does NOT appear when the browser cannot run the ceremony', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 3, mode: 'passphrase' }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    await screen.findByLabelText(/passphrase/i);
    expect(screen.queryByRole('button', { name: PASSKEY_BUTTON })).not.toBeInTheDocument();
  });

  it('does NOT appear on a DARK box — the count is absent and absence draws nothing', async () => {
    // `?? 0`: an older server, or a body that carries no count. Dark by default
    // is a property this file holds, not a promise.
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: true, mode: 'off' }));
    render(<LoginScreen />);
    await screen.findByLabelText(/passphrase/i);
    expect(screen.queryByRole('button', { name: PASSKEY_BUTTON })).not.toBeInTheDocument();
  });

  it('is type="button" — it must not submit an empty passphrase', async () => {
    // A bare <button> inside a <form> defaults to type="submit".
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 1, mode: 'passphrase' }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    const btn = await screen.findByRole('button', { name: PASSKEY_BUTTON });
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('a successful ceremony clears the signal — the same ending as a passphrase login', async () => {
    supportBrowser();
    const fetchImpl = vi.fn(async (url: unknown, _init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/auth/status')) {
        return json(200, { authed: false, passkeysEnrolled: 1, mode: 'passphrase' });
      }
      if (u.endsWith('/assert/start')) {
        return json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB'] });
      }
      return json(204);
    });
    vi.stubGlobal('fetch', fetchImpl);
    (navigator.credentials as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => ({
      rawId: new Uint8Array([1]).buffer,
      response: {
        authenticatorData: new Uint8Array([2]).buffer,
        clientDataJSON: new Uint8Array([3]).buffer,
        signature: new Uint8Array([0x30]).buffer,
      },
    }));
    raiseAuthLost('expired');
    render(<LoginScreen />);
    const btn = await screen.findByRole('button', { name: PASSKEY_BUTTON });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(isAuthLost()).toBe(false));
  });

  it('a CANCELLED ceremony says so — never "that passkey didn\'t match"', async () => {
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 1, mode: 'passphrase' },
      () => json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB'] })));
    (navigator.credentials as unknown as { get: ReturnType<typeof vi.fn> }).get =
      vi.fn(async () => { throw new DOMException('cancelled', 'NotAllowedError'); });
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    const btn = await screen.findByRole('button', { name: PASSKEY_BUTTON });
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
    // The box refused nothing — so it must not say the box refused anything.
    expect(screen.queryByText(VERDICT_TEXT.wrong)).not.toBeInTheDocument();
    expect(isAuthLost()).toBe(true);
  });

  it('a 501 says the BOX cannot run the ceremony — never "couldn\'t reach the box" (D-152)', async () => {
    // THE REACHABLE STATE: keys are enrolled, then `CCRC_RP_ID` is broken (a
    // rename, a copied env file). The button is STILL offered — it keys off
    // `passkeysEnrolled > 0`, and the credential store loads regardless of the
    // RP check — so the operator taps it, `assert/start` answers a BARE 501
    // carrying no `verdict`, `verdictOf` returns null, and the screen used to
    // fall through to the NETWORK sentence. A config refusal rendered as a
    // connection problem points at the one thing that is fine.
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 1, mode: 'passphrase' },
      () => json(501, { ok: false, error: 'not-configured' })));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    const btn = await screen.findByRole('button', { name: PASSKEY_BUTTON });
    await act(async () => { fireEvent.click(btn); });

    expect(await screen.findByText(/cannot run a passkey sign-in/i)).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE_TEXT)).not.toBeInTheDocument();
    // It names what an operator can act on, and sends them to the log that has
    // the specifics rather than guessing which of the two keys is wrong.
    expect(screen.getByText(/CCRC_RP_ID/)).toBeInTheDocument();
    // The passphrase field is still the way in, and the sentence says so.
    expect(screen.getByText(/cannot run a passkey sign-in/i).textContent)
      .toMatch(/sign in with the passphrase/i);
    expect(isAuthLost()).toBe(true);
  });

  it('a genuinely unreachable box still says SO — the 501 arm did not eat it', async () => {
    // The boundary D-152's arm must not cross: no response at all is still a
    // network problem, and it keeps the network sentence.
    supportBrowser();
    vi.stubGlobal('fetch', statusFetch({ authed: false, passkeysEnrolled: 1, mode: 'passphrase' },
      () => { throw new TypeError('Failed to fetch'); }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    const btn = await screen.findByRole('button', { name: PASSKEY_BUTTON });
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText(UNREACHABLE_TEXT)).toBeInTheDocument();
  });

  it('a REFUSED assertion reuses the `wrong` sentence — the server sends one answer for all', async () => {
    supportBrowser();
    const fetchImpl = vi.fn(async (url: unknown, _init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/auth/status')) {
        return json(200, { authed: false, passkeysEnrolled: 1, mode: 'passphrase' });
      }
      if (u.endsWith('/assert/start')) {
        return json(200, { challengeB64url: 'QUJD', rpId: 'localhost', allowCredentialIdsB64url: ['AQEB'] });
      }
      return json(401, { ok: false, error: 'unauthenticated', verdict: 'wrong' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    (navigator.credentials as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => ({
      rawId: new Uint8Array([1]).buffer,
      response: {
        authenticatorData: new Uint8Array([2]).buffer,
        clientDataJSON: new Uint8Array([3]).buffer,
        signature: new Uint8Array([0x30]).buffer,
      },
    }));
    raiseAuthLost('no-session');
    render(<LoginScreen />);
    const btn = await screen.findByRole('button', { name: PASSKEY_BUTTON });
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText(VERDICT_TEXT.wrong)).toBeInTheDocument();
  });
});

// ── 6. the enrolment screen: list, revoke, and the unreadable-file branch ────

describe('PasskeySection', () => {
  const listBody = (over: Partial<{ credentials: unknown[]; storeUnreadable: boolean }> = {}) =>
    JSON.stringify({ credentials: [], storeUnreadable: false, ...over });

  /** A fetch that answers the three routes this screen touches and 404s the
   *  rest (the accounts poll, which the section does not depend on). */
  const screenFetch = (opts: {
    status?: unknown;
    list?: string;
    onDelete?: () => Response;
    onLogout?: () => Response;
  } = {}) => vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/auth/status')) {
      return json(200, opts.status ?? { authed: true, passkeysEnrolled: 1, mode: 'passphrase' });
    }
    if (u === '/api/auth/passkeys') return new Response(opts.list ?? listBody(), { status: 200 });
    // BEFORE the `/api/auth/passkey/` DELETE arm would ever see it, and on its
    // own method: `/api/auth/logout` shares no prefix with either, but ordering
    // a route table by accident is how a fixture comes to answer the wrong call.
    if (u === '/api/auth/logout' && init?.method === 'POST') {
      return (opts.onLogout ?? (() => json(204)))();
    }
    if (u.startsWith('/api/auth/passkey/') && init?.method === 'DELETE') {
      return (opts.onDelete ?? (() => json(204)))();
    }
    return json(404, { error: 'not-found' });
  });

  const CRED = {
    credentialIdB64url: 'AQEB',
    label: 'Pixel 8 / Chrome',
    enrolledAt: Date.now() - 86_400_000,
    lastUsedAt: Date.now() - 3_600_000,
    uvAtEnrollment: true,
  };

  it('lists each key with the label the revoke DECISION needs', async () => {
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch({ list: listBody({ credentials: [CRED] }) }));
    render(<AccountsScreen />);
    expect(await screen.findByText(/Pixel 8 \/ Chrome/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /revoke passkey/i })).toBeInTheDocument();
  });

  it('REVOKES through DELETE and re-reads the list', async () => {
    supportBrowser();
    const fetchImpl = screenFetch({ list: listBody({ credentials: [CRED] }) });
    vi.stubGlobal('fetch', fetchImpl);
    render(<AccountsScreen />);
    const btn = await screen.findByRole('button', { name: /revoke passkey/i });
    await act(async () => { fireEvent.click(btn); });

    const del = fetchImpl.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE');
    expect(del, 'no DELETE was sent').toBeTruthy();
    expect(String(del![0])).toBe('/api/auth/passkey/AQEB');
    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  });

  it('an UNREADABLE store says DO NOT ENROL — never "no passkey is enrolled" (D-132)', async () => {
    // The sentence that caused the data loss. An operator told "no passkey is
    // enrolled" enrols, and the enrolment rewrites a file the server could not
    // read, destroying the keys inside it.
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch({
      status: { authed: true, passkeysEnrolled: 0, mode: 'passphrase' },
      list: listBody({ storeUnreadable: true }),
    }));
    render(<AccountsScreen />);
    const said = await screen.findByText(/cannot be read/i);
    expect(said).toBeInTheDocument();
    expect(screen.queryByText(/No passkey is enrolled/i)).not.toBeInTheDocument();
    // …and there is no way to enrol from here at all.
    expect(screen.queryByRole('button', { name: /add a passkey/i })).not.toBeInTheDocument();
    // D-153: the path is HEDGED, not asserted. `CCRC_PASSKEYS_PATH` can redirect
    // this file and a browser is the one surface here that genuinely cannot
    // resolve it — no route publishes it, and adding one would put a filesystem
    // path on a screen for the sake of a sentence. So it names the default AND
    // the key that overrides it, the same hedge `gen-auth-hash.mjs` uses for the
    // session file it likewise cannot resolve. Dropping the path instead would
    // leave "fix the permissions" with no file to fix.
    expect(said.textContent).toContain('~/.ccrc/passkeys.json');
    expect(said.textContent).toContain('CCRC_PASSKEYS_PATH');
  });

  it('renders NOTHING on a dark box', async () => {
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch({ status: { authed: true, passkeysEnrolled: 0, mode: 'off' } }));
    render(<AccountsScreen />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/^Passkeys$/)).not.toBeInTheDocument();
  });

  it('hides only the ADD button on a Level 1 browser, and keeps the list', async () => {
    // The L1/L2 split at the surface: a browser that can sign in with a key
    // enrolled on a phone still gets to SEE and REVOKE its keys.
    level1Browser();
    vi.stubGlobal('fetch', screenFetch({ list: listBody({ credentials: [CRED] }) }));
    render(<AccountsScreen />);
    expect(await screen.findByText(/Pixel 8 \/ Chrome/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a passkey/i })).not.toBeInTheDocument();
  });
});

// ── 7. the sign-out control (D-145) ─────────────────────────────────────────
//
// `POST /api/auth/logout` shipped with the server in Task 5 — gated, tested,
// and with NO CALLER anywhere in `pwa/src` until now. So a box with the gate
// armed had no way for its operator to end their own session: the only routes
// back to a login screen were an empty cookie jar, a `ccrc passwd` rotation, or
// waiting out the 30-day absolute TTL. Writing the runbook is what found it,
// which is why these tests exist a task later than the route does.
//
// The property under test is NOT "a button exists". It is that the button does
// BOTH halves — the server-side revocation AND the local signal — because
// either one alone is a specific, plausible bug: without the POST the browser
// keeps a live cookie the server would still honour (a "sign out" that signs
// nobody out), and without the raise the operator sits on a console whose every
// call is about to 401.

describe('the sign-out control', () => {
  const listBody = JSON.stringify({ credentials: [], storeUnreadable: false });

  const screenFetch = (opts: { status?: unknown; list?: string; onLogout?: () => Response } = {}) =>
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/auth/status')) {
        return json(200, opts.status ?? { authed: true, passkeysEnrolled: 0, mode: 'passphrase' });
      }
      if (u === '/api/auth/passkeys') return new Response(opts.list ?? listBody, { status: 200 });
      if (u === '/api/auth/logout' && init?.method === 'POST') {
        return (opts.onLogout ?? (() => json(204)))();
      }
      return json(404, { error: 'not-found' });
    });

  const SIGN_OUT = /^sign out$/i;

  const logoutCallsIn = (f: ReturnType<typeof screenFetch>): unknown[][] =>
    f.mock.calls.filter(([u, i]) =>
      String(u) === '/api/auth/logout' && (i as RequestInit | undefined)?.method === 'POST');

  it('POSTs the gated route AND raises the same signal a 401 does', async () => {
    supportBrowser();
    const fetchImpl = screenFetch();
    vi.stubGlobal('fetch', fetchImpl);
    render(<AccountsScreen />);
    const btn = await screen.findByRole('button', { name: SIGN_OUT });
    expect(isAuthLost(), 'the fixture starts signed in').toBe(false);

    await act(async () => { fireEvent.click(btn); });

    // HALF ONE — the server was actually told. Without this assertion the test
    // would pass on a handler that only raised the local signal, i.e. a "sign
    // out" that leaves a live session behind a cookie the browser still holds.
    expect(logoutCallsIn(fetchImpl), 'no POST /api/auth/logout was sent').toHaveLength(1);
    // HALF TWO — and the login screen is now reachable in this same session,
    // through `raiseAuthLost` rather than a second path of its own, so both
    // socket ladders park and the next login's `clearAuthLost` wakes them.
    expect(authLost()).toEqual({ lost: true, verdict: 'no-session' });
  });

  it('raises `no-session`, so the screen reads as a cold sign-in, not "you were signed out"', async () => {
    // `'expired'`'s sentence is a claim about something that HAPPENED to the
    // operator. This is a deliberate act, and the two are different situations
    // — the same distinction `AuthVerdict` carries two members for.
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch());
    render(<AccountsScreen />);
    const btn = await screen.findByRole('button', { name: SIGN_OUT });
    await act(async () => { fireEvent.click(btn); });
    // NOT VACUOUS, and it was on the first draft: `LoginScreen` reads its
    // sentence off `useAuthLost().verdict`, and with NO signal up that verdict
    // is `'no-session'` anyway — the screen's own cold default — so the text
    // assertion below passed identically on a handler that raised nothing at
    // all. Measured (the "drop the raise, keep the POST" mutation left this
    // test GREEN). Asserting the signal is UP first is what makes the sentence
    // that follows a claim about the raise rather than about the default.
    expect(isAuthLost(), 'the sentence below is the default when nothing is raised').toBe(true);
    render(<LoginScreen />);
    expect(await screen.findByText(VERDICT_TEXT['no-session'])).toBeInTheDocument();
    expect(screen.queryByText(VERDICT_TEXT.expired)).not.toBeInTheDocument();
  });

  it('renders NOTHING on a dark box — there is no session to end', async () => {
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch({ status: { authed: true, passkeysEnrolled: 0, mode: 'off' } }));
    render(<AccountsScreen />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: SIGN_OUT })).not.toBeInTheDocument();
    expect(isAuthLost(), 'a dark box must never raise the signal').toBe(false);
  });

  it('is still offered when the PASSKEY store is unreadable (D-132\'s branch)', async () => {
    // The unreadable-file branch returns early with its own sentence, and the
    // sign-out block is rendered in BOTH arms deliberately: an operator whose
    // credential store is broken has every right to end their own session, and
    // trapping them on a console they cannot leave would be a second defect
    // sitting on top of the first.
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch({
      list: JSON.stringify({ credentials: [], storeUnreadable: true }),
    }));
    render(<AccountsScreen />);
    expect(await screen.findByText(/cannot be read/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: SIGN_OUT })).toBeInTheDocument();
  });

  it('a 401 from the logout route still lands on the login screen', async () => {
    // The session was already dead (another tab signed out, `ccrc passwd` ran).
    // The route is GATED, so it answers 401 — and `api.ts`'s funnel raises off
    // the body, which puts the operator exactly where they were trying to go.
    // The handler needs no arm for this; it is what gating buys.
    supportBrowser();
    vi.stubGlobal('fetch', screenFetch({
      onLogout: () => json(401, { ok: false, error: 'unauthenticated', verdict: 'expired' }),
    }));
    render(<AccountsScreen />);
    const btn = await screen.findByRole('button', { name: SIGN_OUT });
    await act(async () => { fireEvent.click(btn); });
    expect(authLost()).toEqual({ lost: true, verdict: 'expired' });
  });
});
