// THE BROWSER HALF OF THE PASSKEY CEREMONY (Stage 3a, Task 8) — the one module
// that touches `navigator.credentials`, and the one that speaks base64url.
//
// ── WHY THE CLIENT DOES THE EXTRACTION ──
//
// `navigator.credentials.create` hands back an attestation object: CBOR, with a
// COSE public key nested inside it. A server that wanted the key out of there
// would need a CBOR decoder, a COSE profile and an ASN.1 encoder — a library,
// and this project takes no new dependency.
//
// It does not have to. `AuthenticatorAttestationResponse` exposes the three
// things the server actually needs, already in the formats `node:crypto` reads
// (WebAuthn L2; in every current browser and declared in TypeScript's own
// `lib.dom.d.ts`, so this is not feature detection dressed as types):
//
//   getPublicKey()          → SPKI DER, exactly what `createPublicKey({format:
//                             'der', type:'spki'})` wants.
//   getPublicKeyAlgorithm() → the COSE alg as a number.
//   getAuthenticatorData()  → the raw bytes the server parses with two slices.
//
// So `attestation: 'none'` is requested and the attestation object is never
// opened by anyone. `server/src/auth/webauthn.ts` carries the trust argument for
// why believing this client's extraction is safe — the short version is that
// enrolment is behind the session gate, so a client that lies is enrolling a key
// it already controls.
//
// ── WHAT THIS MODULE IS NOT ──
//
// It is NOT a security boundary. Every check that matters — origin, rpIdHash,
// the challenge, the signature counter, the signature — is made on the server
// against values it recorded itself. Nothing here is trusted; this is the code
// that RUNS the ceremony, not the code that decides whether it passed.
import type { PasskeyAssertStart, PasskeyRegisterStart } from '../../../shared/api';
import { COSE_ES256 } from '../../../shared/api';
import { api } from './api';

/**
 * base64url ⇄ bytes, both directions, spelled once.
 *
 * `atob`/`btoa` speak STANDARD base64 (`+`/`/`, `=` padding) and the wire is
 * base64url (`-`/`_`, none) — `shared/api.ts` says so on every field name. The
 * two translations below are the whole of the difference, and having them in one
 * place is what stops a caller pasting a `btoa` somewhere and shipping a field
 * the server's strict decoder refuses (`decodeB64url` rejects the standard
 * alphabet and any padding outright, which is the good outcome: it fails at
 * enrolment rather than silently later).
 */
export function toB64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`, and built over an
// explicitly allocated buffer to get there: TypeScript 6's `BufferSource` — what
// every `challenge`/`id` field in `CredentialCreationOptions` wants — excludes a
// view whose buffer might be a `SharedArrayBuffer`, which `new Uint8Array(n)`
// widens to. Annotating rather than casting keeps the guarantee real.
export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * TWO PREDICATES, BECAUSE THE TWO CEREMONIES NEED DIFFERENT THINGS — and the
 * first version of this file had ONE, which probed the wrong level entirely
 * (D-135).
 *
 * It tested `PublicKeyCredential.prototype.getClientExtensionResults`, which is
 * **WebAuthn Level 1** and has been present since 2019 — so it answered "yes" on
 * every browser that has WebAuthn at all, including one lacking the **Level 2**
 * response methods (`getPublicKey`, `getPublicKeyAlgorithm`,
 * `getAuthenticatorData`) that this entire no-CBOR design is built on. The
 * docstring promised the strict check and the code performed a loose one; on
 * such a browser the enrol button would open a dialog, the user would touch
 * their key, and `getPublicKey` would be `undefined`.
 *
 * The split is not pedantry: **ENROLMENT needs Level 2, ASSERTION does not.**
 * `AuthenticatorAssertionResponse`'s `authenticatorData`/`signature` are plain
 * Level 1 properties, so a browser that cannot enrol can still sign in with a
 * key enrolled elsewhere (a phone, a hardware key moved between machines). One
 * predicate for both would hide a working login button for no reason.
 */
function credentialsAvailable(): boolean {
  // Also false on a NON-SECURE CONTEXT (plain http off localhost), where
  // `navigator.credentials` is simply absent — which is exactly the state a box
  // with a misconfigured `CCRC_ORIGIN` puts a browser in.
  if (typeof navigator === 'undefined' || navigator.credentials === undefined) return false;
  return typeof (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function';
}

/** Can this browser SIGN IN with an existing passkey? Level 1 is enough. */
export function passkeyLoginSupported(): boolean {
  return credentialsAvailable() && typeof navigator.credentials.get === 'function';
}

/**
 * Can this browser ENROL one? Needs the Level 2 response methods, probed on
 * `AuthenticatorAttestationResponse.prototype` — the interface that actually
 * declares them — rather than on `PublicKeyCredential`, which does not.
 */
export function passkeyEnrollSupported(): boolean {
  if (!credentialsAvailable() || typeof navigator.credentials.create !== 'function') return false;
  const ctor = (globalThis as { AuthenticatorAttestationResponse?: unknown })
    .AuthenticatorAttestationResponse;
  if (typeof ctor !== 'function') return false;
  const proto = (ctor as { prototype?: unknown }).prototype as Record<string, unknown> | undefined;
  return proto !== undefined && typeof proto['getPublicKey'] === 'function';
}

/** What the ceremony needs from the browser, injectable so the tests can drive a
 *  fake authenticator without a WebAuthn implementation. Defaults to the real
 *  `navigator.credentials` at every call site. */
export interface CredentialsApi {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

const realCredentials = (): CredentialsApi => navigator.credentials as unknown as CredentialsApi;

/** The one error this module throws that is not an `ApiError` — the ceremony
 *  itself failed or was dismissed. Distinct so the caller can say "you cancelled"
 *  rather than "the box refused you", which are different sentences for
 *  different situations. */
export class PasskeyCeremonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyCeremonyError';
  }
}

/**
 * Run the browser's half and turn ANY throw out of it into a
 * {@link PasskeyCeremonyError}.
 *
 * THIS WRAPPER IS THE WHOLE REASON THE ERROR TYPE EXISTS. Dismissing the system
 * prompt — the single most common outcome after "it worked" — rejects with a
 * `DOMException` named `NotAllowedError`, and so do a timeout, a blocked
 * cross-origin frame and an authenticator that cannot satisfy
 * `userVerification: 'required'`. Without this, every one of them reaches the
 * caller as an unrecognised error and the login screen says "couldn't reach the
 * box" — sending the operator to check their network over a prompt they closed
 * themselves.
 *
 * IT WRAPS ONLY THE BROWSER CALL, never the `api.*` call after it: an `ApiError`
 * carrying the server's verdict must reach the caller AS an `ApiError`, because
 * "the box refused this" and "the ceremony did not finish" are the two different
 * situations this whole type exists to keep apart.
 */
async function runCeremony(what: string, fn: () => Promise<Credential | null>): Promise<Credential> {
  let credential: Credential | null;
  try {
    credential = await fn();
  } catch (err) {
    // The message is the browser's, and it is a DOMException name rather than
    // anything user-supplied — safe to carry, and useful in a console.
    throw new PasskeyCeremonyError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
  // `null` rather than a throw is the spec's other refusal shape.
  if (credential === null) throw new PasskeyCeremonyError(`${what}: the authenticator returned nothing`);
  return credential;
}

/**
 * ENROL a passkey on this device. Requires a live session — the server gates
 * `register/*`, and that gating is what makes the whole no-attestation design
 * safe.
 *
 * `userVerification: 'required'` matches the server's policy exactly, and the
 * agreement is the point: the server refuses a registration whose UV flag is
 * clear, so asking for anything weaker here would let a PIN-less authenticator
 * run a full ceremony and then be rejected. Asking for `required` makes the
 * browser tell the user what is needed BEFORE they touch the key.
 *
 * `attestation: 'none'` — the no-CBOR decision, stated at the one place it is
 * requested.
 */
export async function enrollPasskey(
  creds: CredentialsApi = realCredentials(),
  start: () => Promise<PasskeyRegisterStart> = () => api.passkeyRegisterStart(),
): Promise<void> {
  const options = await start();
  const created = await runCeremony('enrolling a passkey', () => creds.create({
    publicKey: {
      challenge: fromB64url(options.challengeB64url),
      rp: { id: options.rpId, name: 'ccrc' },
      user: {
        id: fromB64url(options.userHandleB64url),
        // Not an email and not a username — this box has one operator and no
        // user identity to carry (`PasskeyRegisterStart`). WebAuthn requires
        // both fields, so they say what is true.
        name: 'ccrc operator',
        displayName: 'ccrc operator',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: COSE_ES256 }],
      // NONE. See the module docstring: there is no attestation statement to
      // verify, which is precisely why no CBOR decoder is needed anywhere.
      attestation: 'none',
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
    },
  }));
  const response = (created as PublicKeyCredential).response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey();
  if (spki === null) {
    // The browser ran the ceremony and cannot give us the key in a form the
    // server can read. Refusing here — rather than sending something incomplete
    // — is what keeps the failure at ENROLMENT, where the passphrase still works.
    throw new PasskeyCeremonyError('this browser cannot export the new key in a usable format');
  }
  await api.passkeyRegisterFinish({
    credentialIdB64url: toB64url((created as PublicKeyCredential).rawId),
    publicKeySpkiB64url: toB64url(spki),
    algorithm: response.getPublicKeyAlgorithm(),
    authenticatorDataB64url: toB64url(response.getAuthenticatorData()),
    clientDataJsonB64url: toB64url(response.clientDataJSON),
  });
}

/**
 * SIGN IN with a passkey. Resolves on the server's `204 + Set-Cookie`; the
 * caller's next act is `clearAuthLost()`, exactly as after a passphrase login.
 *
 * `allowCredentials` comes from the server rather than being omitted, because a
 * credential enrolled without `residentKey: 'required'` is not discoverable and
 * a browser cannot find it without being told the id. An EMPTY list means no key
 * is enrolled here, and this refuses rather than prompting for one that cannot
 * exist — a dialog nobody can satisfy is worse than a passphrase field.
 */
export async function assertPasskey(
  creds: CredentialsApi = realCredentials(),
  start: () => Promise<PasskeyAssertStart> = () => api.passkeyAssertStart(),
): Promise<void> {
  const options = await start();
  if (options.allowCredentialIdsB64url.length === 0) {
    throw new PasskeyCeremonyError('no passkey is enrolled on this box');
  }
  const got = await runCeremony('signing in with a passkey', () => creds.get({
    publicKey: {
      challenge: fromB64url(options.challengeB64url),
      rpId: options.rpId,
      allowCredentials: options.allowCredentialIdsB64url.map((id) => ({
        type: 'public-key' as const,
        id: fromB64url(id),
      })),
      // Matches the server, which refuses an assertion with the UV flag clear.
      userVerification: 'required',
      timeout: 60_000,
    },
  }));
  const response = (got as PublicKeyCredential).response as AuthenticatorAssertionResponse;
  await api.passkeyAssertFinish({
    credentialIdB64url: toB64url((got as PublicKeyCredential).rawId),
    authenticatorDataB64url: toB64url(response.authenticatorData),
    clientDataJsonB64url: toB64url(response.clientDataJSON),
    // DER, as the authenticator produced it — `createVerify('SHA256')` reads it
    // natively, so nothing here unpacks it into (r, s).
    signatureB64url: toB64url(response.signature),
  });
}
