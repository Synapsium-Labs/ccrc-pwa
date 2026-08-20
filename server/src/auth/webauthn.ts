import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'node:crypto';
import { COSE_ES256 } from '../../../shared/api.js';

/**
 * WEBAUTHN, WITH `node:crypto` AND NOTHING ELSE — no library, no CBOR decoder,
 * no new line in any `package.json`.
 *
 * ── WHY NO CBOR ──────────────────────────────────────────────────────────────
 * The usual reason a WebAuthn server needs a dependency is the ATTESTATION
 * OBJECT: a CBOR map whose `authData` embeds the new credential's public key as
 * a COSE_Key — another CBOR map — which then has to be re-encoded as SPKI DER
 * before `crypto.createPublicKey` will look at it. That is a decoder, a COSE
 * profile and an ASN.1 encoder, i.e. a library.
 *
 * This design never opens it. `attestation: 'none'` is requested, and the
 * CLIENT hands the server what it needs already extracted, through three
 * `AuthenticatorAttestationResponse` methods that exist for exactly this
 * purpose (WebAuthn L2, in every current browser, and declared in TypeScript's
 * own `lib.dom.d.ts`):
 *
 *   - `getPublicKey()`          → an **SPKI DER** ArrayBuffer — precisely the
 *                                 format `createPublicKey({format:'der',
 *                                 type:'spki'})` reads.
 *   - `getPublicKeyAlgorithm()` → the COSE alg as a NUMBER (ES256 = -7).
 *   - `getAuthenticatorData()`  → the raw authenticator data, whose fixed-width
 *                                 prefix this file parses with `readUInt32BE`
 *                                 and two slices. No CBOR is reached: the only
 *                                 CBOR in `authData` is the COSE key at the very
 *                                 END, and nothing here reads past its length
 *                                 prefix.
 *
 * TRUSTING THE CLIENT'S EXTRACTION IS SAFE HERE, AND THE ARGUMENT IS THREE
 * FACTS TOGETHER — this is the trust caveat, stated where it is implemented:
 *
 *   1. `attestation: 'none'` means there is NO attestation statement to verify
 *      in the first place. Even a full CBOR implementation would learn nothing
 *      about the authenticator's provenance from a `none` attestation; refusing
 *      to parse it discards a signature that was never going to be checked.
 *   2. ENROLMENT IS BEHIND THE SESSION GATE. `POST /api/auth/passkey/register/*`
 *      is NOT in `gate.ts`'s EXEMPT table, so only a caller who has already
 *      proven the passphrase can register anything at all. A client that lies
 *      about its own public key is enrolling a credential it controls — which is
 *      what enrolling a credential IS. It gains nothing it did not already have.
 *   3. SINGLE OPERATOR. There is no second user whose account a forged
 *      registration could attach itself to; the credential is scoped to the box,
 *      and the only person who can create one is the person already inside.
 *
 * What attestation WOULD buy — "this key lives in a YubiKey 5, not in software"
 * — is a hardware-policy question this box does not ask. If it ever does, the
 * answer is a CBOR decoder and a metadata service, not a tweak here.
 *
 * ── WHY THE SIGNATURE NEEDS NO CONVERSION ────────────────────────────────────
 * A WebAuthn ES256 assertion signature is an ASN.1 DER `ECDSA-Sig-Value`
 * (WebAuthn §6.5.6 → RFC 3279), and `crypto.createVerify().verify()` defaults to
 * `dsaEncoding: 'der'`. So the bytes off the wire go straight in. The (r‖s)
 * P1363 unpacking every WebAuthn tutorial performs is for WebCrypto's
 * `subtle.verify`, which wants the OTHER encoding — measured on node 24.14.1
 * before this file was written: a `createSign('SHA256')` P-256 signature begins
 * `0x30` (SEQUENCE) and round-trips through `createVerify` unchanged.
 *
 * ── RING ─────────────────────────────────────────────────────────────────────
 * PURE DECISION (L1). No `fs`, no fastify, no `reply`, no clock — `now` is a
 * parameter everywhere it appears, exactly as `gate.ts`'s `authVerdict` takes
 * it. `node:crypto` is the same allowance `secret.ts` and `sessions.ts` already
 * take: it is a computation, not an effect. The delivery half — routes, the
 * cookie, the rate limiter — lives in `server.ts`, and the persistence half in
 * `credentials.ts`.
 *
 * ── FAIL SHUT ────────────────────────────────────────────────────────────────
 * Every function here returns a REFUSAL for anything it cannot fully verify, and
 * never throws: a throw inside a route handler is a 500, and a 500 is not a
 * refusal. Every decode is strict (see {@link decodeB64url}), every length is
 * bounded before it is read, and every comparison is positive ("is it exactly
 * this?") rather than negative ("is it not one of these?"), so a case nobody
 * thought of denies instead of falling through.
 */

// ── algorithms ───────────────────────────────────────────────────────────────

/**
 * Every algorithm this server can actually verify, as COSE ids — the list the
 * registration ceremony advertises AND the list a stored credential is checked
 * against before its signature is examined.
 *
 * ONE MEMBER, DELIBERATELY. Breadth here is not generosity, it is attack
 * surface: RS256 (`-257`) would drag in PKCS#1 v1.5 padding, whose verification
 * is the classic source of signature-forgery bugs (Bleichenbacher '06), and
 * EdDSA (`-8`) is not universally available through `createVerify`. ES256 is
 * mandatory-to-implement for WebAuthn authenticators, so one member costs no
 * device compatibility at all. The check is MEMBERSHIP, never "not one of the
 * bad ones" — an algorithm nobody enumerated is refused rather than attempted
 * with whatever `createVerify` happens to do with it.
 */
export const SUPPORTED_ALGS: readonly number[] = [COSE_ES256];

/** The curve an ES256 SPKI must actually carry, as node spells it. Checked
 *  EXPLICITLY: `createPublicKey` will happily import a P-384 or an RSA SPKI, and
 *  `createVerify('SHA256')` would then verify against it — a caller could claim
 *  `alg: -7` and enrol a key of an entirely different type. Node's own name for
 *  P-256 is OpenSSL's, `prime256v1`. */
const ES256_CURVE = 'prime256v1';

// ── bounds ───────────────────────────────────────────────────────────────────
//
// Every one of these is checked BEFORE the value is decoded or parsed. The
// inputs arrive from an UNAUTHENTICATED caller on the assertion path, and an
// unbounded `Buffer.from(…, 'base64url')` or `JSON.parse` on a 40 MiB body is a
// memory amplifier reachable by anyone who can open a socket.

/** WebAuthn's own ceiling on a credential id (§5.8.3: 1023 bytes). */
export const MAX_CREDENTIAL_ID_BYTES = 1023;
/** An SPKI for any curve this box could ever support is ~91 bytes (P-256) to
 *  ~294 (RSA-2048). 1 KiB is generous and finite. */
export const MAX_SPKI_BYTES = 1024;
/** `authData` is 37 bytes plus, at registration, the attested credential data
 *  (16 + 2 + ≤1023 + a COSE key). 2 KiB covers every real authenticator. */
export const MAX_AUTH_DATA_BYTES = 2048;
/** `clientDataJSON` is `{type, challenge, origin, crossOrigin}` plus whatever a
 *  client appends. 4 KiB is far past any real one and bounds `JSON.parse`. */
export const MAX_CLIENT_DATA_BYTES = 4096;
/** A DER ECDSA-P256 signature is ~70-72 bytes. 512 bounds a hostile one. */
export const MAX_SIGNATURE_BYTES = 512;

/** `rpIdHash`(32) + `flags`(1) + `signCount`(4) — the fixed prefix every
 *  `authData` has, and the minimum length one can legally be. */
const AUTH_DATA_MIN = 37;
/** Offsets into `authData`'s fixed prefix. Named rather than inlined: an
 *  off-by-one in a slice here is a check that silently examines the wrong bytes
 *  and still "passes". */
const RPID_HASH_END = 32;
const FLAGS_AT = 32;
const SIGN_COUNT_AT = 33;
/** Attested credential data begins straight after the fixed prefix:
 *  `aaguid`(16) ‖ `credentialIdLength`(2, big-endian) ‖ `credentialId` ‖ COSE key. */
const AAGUID_BYTES = 16;

/** `flags` bit 0 — USER PRESENT. Someone physically touched the authenticator. */
const FLAG_UP = 0x01;
/** `flags` bit 2 — USER VERIFIED. A PIN, a fingerprint or a face was checked by
 *  the authenticator itself. See {@link verifyAssertion} for why this box
 *  REQUIRES it rather than merely recording it. */
const FLAG_UV = 0x04;
/** `flags` bit 6 — ATTESTED CREDENTIAL DATA PRESENT. Set on a registration's
 *  `authData` and clear on an assertion's. */
const FLAG_AT = 0x40;

// ── strict decoding ──────────────────────────────────────────────────────────

/**
 * Decode a base64url field, refusing everything `Buffer.from(s, 'base64url')`
 * would silently accept.
 *
 * NODE'S DECODER IS LENIENT IN WAYS AN AUTH PATH MUST NOT BE: it ignores
 * characters outside the alphabet, tolerates `+`/`/` in a field declared
 * base64url, accepts or ignores padding, and truncates a trailing partial group
 * — so two DIFFERENT strings can decode to the SAME bytes. That matters here
 * because a credential id is a MAP KEY (`credentials.ts` looks one up by its
 * base64url string) while the same value is also compared as BYTES against the
 * one inside `authData`. A lenient decoder is how those two comparisons come to
 * disagree, and a non-canonical spelling of an enrolled id is how a lookup
 * misses a credential that exists — or, in the mirror, how two spellings of one
 * id become two rows.
 *
 * So: a length bound, then a ROUND-TRIP check. `buf.toString('base64url')` emits
 * the one canonical spelling, and requiring the input to equal it rejects every
 * alias in one line — including the trailing-bit case (`'QQ'` and `'QR'` both
 * decode to `0x41`) that an alphabet test alone cannot see.
 *
 * THERE IS NO SEPARATE ALPHABET TEST, AND THAT IS A PROOF RATHER THAN A
 * SHORTCUT (D-134). This function used to run `/^[A-Za-z0-9_-]+$/` before
 * decoding, and the review found that deleting it reded nothing — a guard whose
 * removal is invisible is a defect in this repo, not defence in depth. The
 * reason it was invisible: `toString('base64url')` can only ever EMIT characters
 * from `[A-Za-z0-9_-]`, so any input containing a character outside that set is
 * necessarily different from its own re-encoding and is already refused by the
 * round-trip. The subsumption is total, not probabilistic, and
 * `auth-passkey.test.ts` enumerates the classes (`+`, `/`, `=`, whitespace,
 * control bytes, non-ASCII) to say so out loud. Keeping both would have left one
 * of them permanently unmeasurable.
 *
 * `null` on any failure, never a throw and never a short buffer.
 */
export function decodeB64url(field: unknown, maxBytes: number): Buffer | null {
  if (typeof field !== 'string' || field === '') return null;
  // Bound the STRING before decoding: 4 base64 chars per 3 bytes, so this caps
  // the allocation without doing it first.
  if (field.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  const buf = Buffer.from(field, 'base64url');
  if (buf.length === 0 || buf.length > maxBytes) return null;
  if (buf.toString('base64url') !== field) return null;
  return buf;
}

/** sha256, as a Buffer. The one hash this file uses, spelled once. */
function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

/** Constant-time buffer equality that never throws on a length mismatch —
 *  `timingSafeEqual` raises a `RangeError` when the two differ, and a throw here
 *  would be a 500 on a path whose only correct answer is a refusal. The
 *  length-check-first discipline of `coord/token.ts:220-228` and
 *  `sessions.ts:249`. */
function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── the configured relying party ─────────────────────────────────────────────

/**
 * PUBLIC SUFFIXES THIS PROJECT CAN ACTUALLY REACH — the ones a `CCRC_RP_ID`
 * typo would plausibly land on, refused by NAME.
 *
 * **THE HAZARD.** `rpId` scopes a credential: a browser offers a passkey to any
 * origin whose host is `rpId` or a subdomain of it. Set it to a REGISTRABLE
 * DOMAIN (`tailnet-example.ts.net`, `<name>.duckdns.org`) and the credential is
 * bound to this fleet. Set it to the PUBLIC SUFFIX one label up (`ts.net`,
 * `duckdns.org`) and — if a browser let you — the credential would be scoped to
 * every tailnet, or every duckdns user, on the internet. Browsers do enforce
 * this (a registration with an rpId that is a public suffix is refused), but the
 * refusal arrives as an opaque `SecurityError` in the client with nothing in the
 * server's journal, and the operator is left staring at a button that does
 * nothing. Naming it here turns that into a log line and a `501`.
 *
 * THIS LIST IS NOT A PUBLIC SUFFIX LIST AND MUST NOT GROW INTO ONE. A real PSL
 * is ~10k entries updated weekly — a dependency, a data file and a refresh
 * story, for a value one operator types once. What this catches is the specific
 * mistake this deployment can make, plus the generic single-label case below.
 * The REAL defence is that `rpId` is configured rather than derived: nothing in
 * this codebase strips labels off a hostname, so there is no code path that can
 * arrive at a public suffix by accident — only a human typing one.
 */
export const PUBLIC_SUFFIX_TRAPS: readonly string[] = [
  'ts.net', 'tailscale.net', 'duckdns.org', 'nip.io', 'sslip.io',
  'ngrok.io', 'ngrok.app', 'trycloudflare.com', 'github.io',
];

/**
 * What is wrong with `rpId`, or `null` if nothing is. A string, not a boolean:
 * the caller LOGS it, and "your rpId is bad" is not a thing an operator can act
 * on at 2am.
 *
 * `localhost` is admitted as the one single-label value, because WebAuthn
 * explicitly permits it (it is a secure context by fiat) and it is this box's
 * shipped default.
 */
export function rpIdProblem(rpId: string): string | null {
  if (rpId === '') return 'CCRC_RP_ID is empty';
  if (rpId !== rpId.toLowerCase()) {
    return `CCRC_RP_ID ${JSON.stringify(rpId)} has uppercase letters — an rpId is compared as a ` +
      'lowercased domain, so this can only ever mismatch';
  }
  // AN IP LITERAL IS NOT A DOMAIN, AND CAN NEVER BECOME ONE (D-147). WebAuthn
  // requires `rpId` to be a valid domain string — an address literal is
  // explicitly not one — so a browser refuses the ceremony outright.
  //
  // NOTHING ELSE HERE CATCHES IT, and that gap is the whole reason this exists:
  // `127.0.0.1` has dots, so the single-label check below waves it through; it
  // holds no character outside `[a-z0-9.-]`; it is on no suffix list. And
  // `originProblem` then AGREES with it, because `http://127.0.0.1:7788`'s
  // hostname is exactly `127.0.0.1` — so `relyingPartyProblem` returns `null`,
  // the boot warning stays silent, the ceremony routes go live, and the operator
  // meets an opaque `SecurityError` in the client with nothing in the journal.
  // That is precisely the failure this whole function's docstring says it exists
  // to convert into a log line and a 501. Found by writing the localhost
  // runbook, where reaching the box by IP is the obvious thing to do.
  //
  // The test is deliberately SHAPE-based rather than a strict address parser:
  // `[::1]`-style brackets, a run of hex-and-colons, and all-numeric labels are
  // between them every literal an operator could type here, and a value that is
  // merely LIKE an address is not a registrable domain either. Real domains
  // cannot collide with it — a TLD is never all-digits (RFC 3696) and never
  // contains a colon.
  const bracketed = rpId.startsWith('[') && rpId.endsWith(']');
  const ipv6ish = bracketed || (rpId.includes(':') && /^[0-9a-f:]+$/.test(rpId));
  const ipv4ish = /^[0-9]+(\.[0-9]+)+$/.test(rpId);
  if (ipv4ish || ipv6ish) {
    return `CCRC_RP_ID ${JSON.stringify(rpId)} is an IP address, and WebAuthn requires a DOMAIN — ` +
      'a browser refuses to scope a credential to an address literal, with an opaque SecurityError ' +
      'and nothing on the server to explain it. Use the name this box is actually reached by ' +
      '(e.g. "tailnet-example.ts.net" or "<name>.duckdns.org"), or "localhost" for local development — ' +
      'and set CCRC_ORIGIN to a URL with that same host, not to the IP.';
  }
  if (/[^a-z0-9.-]/.test(rpId)) {
    return `CCRC_RP_ID ${JSON.stringify(rpId)} is not a bare domain — it must be a hostname with ` +
      'no scheme, no port, no path and no slash (that is CCRC_ORIGIN\'s job)';
  }
  if (rpId.startsWith('.') || rpId.endsWith('.') || rpId.includes('..')) {
    return `CCRC_RP_ID ${JSON.stringify(rpId)} is not a well-formed domain`;
  }
  if (PUBLIC_SUFFIX_TRAPS.includes(rpId)) {
    return `CCRC_RP_ID ${JSON.stringify(rpId)} is a PUBLIC SUFFIX, not a registrable domain — a ` +
      'credential scoped to it would be offered to every box under it, and browsers refuse the ' +
      'registration outright. Use the registrable domain (e.g. "tailnet-example.ts.net", not "ts.net")';
  }
  if (!rpId.includes('.') && rpId !== 'localhost') {
    return `CCRC_RP_ID ${JSON.stringify(rpId)} is a single label, which is either a top-level ` +
      'domain (a public suffix — see above) or a bare hostname a browser will not scope a ' +
      'credential to. Use the full registrable domain, or "localhost" for local development';
  }
  return null;
}

/**
 * What is wrong with `origin` — including whether it AGREES with `rpId`, which
 * is the pairing mistake that otherwise surfaces as an unexplained browser
 * refusal.
 *
 * Four properties, each one a real failure this catches at boot instead of at
 * the first tap:
 *  1. it parses, and re-serializes to ITSELF — so a trailing slash or a path
 *     (`https://box/`, `https://box/app`) is refused. `clientDataJSON.origin`
 *     carries the SERIALIZED origin with neither, and a recorded value with a
 *     slash on the end would never equal one.
 *  2. the scheme is `https:`, or `http:` on a loopback host. WebAuthn requires a
 *     secure context; `http://localhost` is one by definition and nothing else
 *     with `http:` is.
 *  3. the host is `rpId` or a subdomain of it — the browser's own rule. Getting
 *     this pair wrong is the single most common WebAuthn misconfiguration.
 *  4. no credentials, no query, no fragment — an origin has none of those.
 */
export function originProblem(origin: string, rpId: string): string | null {
  if (origin === '') return 'CCRC_ORIGIN is empty';
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `CCRC_ORIGIN ${JSON.stringify(origin)} is not a URL — it must be scheme://host[:port], ` +
      'exactly as a browser serializes an origin';
  }
  // `URL.origin` IS the serialization `clientDataJSON.origin` carries. Requiring
  // equality is how a trailing slash, a path, a query, a fragment and userinfo
  // are all refused in one comparison rather than five.
  if (url.origin !== origin) {
    return `CCRC_ORIGIN ${JSON.stringify(origin)} is not a bare serialized origin — a browser ` +
      `sends ${JSON.stringify(url.origin)}, with no trailing slash, path, query or fragment. ` +
      'Recorded as written, it could never match';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `CCRC_ORIGIN ${JSON.stringify(origin)} must be http: or https:`;
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !loopback) {
    return `CCRC_ORIGIN ${JSON.stringify(origin)} is plain http: on a non-loopback host. WebAuthn ` +
      'only runs in a secure context, so a browser will refuse every ceremony against it. Use ' +
      'https: (tailscale serve / Caddy terminates TLS for this box)';
  }
  if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) {
    return `CCRC_ORIGIN ${JSON.stringify(origin)} and CCRC_RP_ID ${JSON.stringify(rpId)} disagree: ` +
      `a browser only accepts an rpId that is the origin's host or a parent of it, and ` +
      `${JSON.stringify(url.hostname)} is neither ${JSON.stringify(rpId)} nor a subdomain of it`;
  }
  return null;
}

/** Both checks, in the order an operator would want to read them. `null` when
 *  the box's WebAuthn config is coherent. Called at boot (a warning) and before
 *  either ceremony starts (a 501) — one function so the two cannot diverge. */
export function relyingPartyProblem(rpId: string, origin: string): string | null {
  return rpIdProblem(rpId) ?? originProblem(origin, rpId);
}

/**
 * The opaque `user.id` the registration ceremony carries — WebAuthn requires
 * one, and this box has no user to name.
 *
 * DERIVED FROM `rpId`, NOT RANDOM, and that is the whole reason it is a function
 * rather than a stored value: an authenticator keys its "user account" by
 * (rpId, user.id), so a random handle per enrolment would make a second passkey
 * a SECOND account in the operator's password manager — two identical-looking
 * entries for one box, and no way to tell them apart. A stable handle makes
 * every key on this box one account.
 *
 * NEVER PII. A single-operator box has no email and no username to put here
 * (`shared/api.ts`'s `PasskeyRegisterStart` holds that seam open for the team
 * edition); this is a hash of a value that is already public, carrying no
 * information about the person at all. 16 bytes is WebAuthn's recommended
 * minimum.
 */
export function userHandleFor(rpId: string): string {
  return sha256(`ccrc-passkey-user:${rpId}`).subarray(0, 16).toString('base64url');
}

// ── the challenge store ──────────────────────────────────────────────────────

/** 256 bits. WebAuthn's floor is 16 bytes; this is the same width as the session
 *  token, for the same reason — there is no dictionary to slow, only entropy. */
export const CHALLENGE_BYTES = 32;

/**
 * How long an issued challenge stays usable — TWO MINUTES.
 *
 * The ceremony in between is a browser prompt plus a fingerprint or a PIN, on a
 * phone that may need waking. Thirty seconds would refuse honest operators;
 * anything measured in hours turns a captured `clientDataJSON` into a long-lived
 * replay window. Two minutes is comfortably above the human ceremony and far
 * below anything an attacker can queue work against.
 */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * A hard cap on live challenges, so an unauthenticated flood of
 * `assert/start` cannot grow this map without bound.
 *
 * EVICTS THE OLDEST rather than refusing the newest, deliberately: refusing
 * would let an attacker who fills the map lock the operator OUT of their own
 * passkey button — a denial of service that outlives the flood. Evicting means
 * the worst an attacker achieves is invalidating a ceremony that is already in
 * flight, which self-heals on the next tap.
 *
 * EVICTION IS ONLY TOLERABLE BECAUSE ISSUANCE IS METERED (D-131). The claim that
 * this is "the backstop, not the brake" was FALSE as first shipped: the brake in
 * front of it — `PASSKEY_MAX_FAILURES` — was spent only by a failed
 * `assert/finish`, never by `assert/start`, so minting challenges was free and
 * an unauthenticated flood could evict a live ceremony in milliseconds. The
 * operator's Face ID prompt then resolved onto a challenge that no longer
 * existed, producing `stale-challenge` → 401 → "That passphrase didn't match",
 * for as long as the flood ran and with no self-healing. `assert/start` now
 * calls `LoginRateLimiter.spend` on every issue, which is what makes this
 * sentence true.
 */
export const MAX_LIVE_CHALLENGES = 64;

/**
 * The issued-challenge set for ONE ceremony — single-use and expiring.
 *
 * TWO INSTANCES EXIST, NOT ONE (`server.ts`): registration and assertion have
 * SEPARATE stores, so a challenge issued for `register/start` can never satisfy
 * `assert/finish`. Purpose confusion is a real WebAuthn attack shape — the
 * `type` field in `clientDataJSON` is the spec's own defence against it, and
 * this is the same defence made structural, so that a bug in the `type` check
 * has a second wall behind it. The `purpose` string exists so a log line can say
 * which store refused.
 *
 * IN MEMORY, DELIBERATELY. A challenge outliving the process would be a replay
 * window across a restart, and losing one costs a tap. This is the one piece of
 * passkey state that SHOULD be lost on restart.
 */
export class ChallengeStore {
  /** challenge (base64url) → the epoch-ms it was issued. Insertion-ordered, which
   *  is what makes "evict the oldest" a `keys().next()` rather than a scan. */
  private readonly live = new Map<string, number>();

  constructor(readonly purpose: 'register' | 'assert') {}

  /** Mint one. Sweeps expired entries first, then evicts the oldest if the cap
   *  is still reached — so the map is bounded by {@link MAX_LIVE_CHALLENGES} at
   *  every moment, not merely on average. */
  issue(now: number): string {
    this.sweep(now);
    while (this.live.size >= MAX_LIVE_CHALLENGES) {
      const oldest = this.live.keys().next();
      if (oldest.done === true) break;
      this.live.delete(oldest.value);
    }
    const challenge = randomBytes(CHALLENGE_BYTES).toString('base64url');
    this.live.set(challenge, now);
    return challenge;
  }

  /**
   * SPEND one. `true` iff it was live and unexpired — and it is gone either way
   * on a match, which is what "single-use" means.
   *
   * THE CALLER CONSUMES BEFORE IT VERIFIES THE SIGNATURE, on purpose (see
   * {@link verifyAssertion}): a challenge burnt by a FAILED attempt cannot be
   * retried, so an attacker holding a captured `clientDataJSON` gets exactly one
   * shot at the rest of the checks rather than an unlimited grind against a
   * challenge that stays valid for two minutes.
   */
  consume(challenge: string, now: number): boolean {
    const issued = this.live.get(challenge);
    if (issued === undefined) return false;
    this.live.delete(challenge);
    return now - issued <= CHALLENGE_TTL_MS;
  }

  /** Drop everything past its TTL. Called on every issue; nothing else needs a
   *  timer, because an expired entry is already refused by {@link consume}. */
  private sweep(now: number): void {
    for (const [challenge, issued] of this.live) {
      if (now - issued > CHALLENGE_TTL_MS) this.live.delete(challenge);
    }
  }

  /** For tests and diagnostics. No decision reads it. */
  get size(): number {
    return this.live.size;
  }
}

// ── the stored credential ────────────────────────────────────────────────────

/**
 * ONE ENROLLED PASSKEY, as it is persisted (`credentials.ts`) and as the
 * verifier reads it.
 *
 * `rpId` AND `origin` ARE RECORDED PER CREDENTIAL rather than read from config
 * at verify time, and that is a DESIGN PROPERTY, not an implementation detail.
 * The alternative — check every assertion against whatever `CCRC_RP_ID` says
 * today — means a box renamed in Stage 3b (localhost → the real tailnet name)
 * silently rejects every enrolled key with the same opaque "signature did not
 * verify" a genuine attack would produce. Recorded, the mismatch is VISIBLE: the
 * server can say "this credential was enrolled for localhost and this box is now
 * tailnet-example.ts.net — re-enrol", which is a sentence an operator can act on.
 *
 * It is also strictly SAFER, not merely friendlier. A credential is bound to the
 * relying party it was created for; re-pointing an old credential at a new rpId
 * by editing config would be exactly the scope-widening the whole public-suffix
 * discussion exists to prevent. Binding is per credential because that is where
 * the binding actually is.
 */
export interface StoredCredential {
  /** base64url, and the map key in `credentials.ts`. */
  credentialId: string;
  /** SubjectPublicKeyInfo DER, base64url. Never a COSE key — see the module
   *  docstring on why no CBOR is ever reached. */
  spkiB64url: string;
  /** The COSE alg id. Checked against {@link SUPPORTED_ALGS} on EVERY assertion,
   *  not just at enrolment: a row edited on disk must not select a code path. */
  algorithm: number;
  /** The relying party this key was enrolled for — see the interface docstring. */
  rpId: string;
  /** The full serialized origin it was enrolled at (`https://host:port`). */
  origin: string;
  /** The authenticator's signature counter as of the last accepted assertion.
   *  `0` means "this authenticator does not keep one" — see {@link verifyAssertion}. */
  signCount: number;
  /** Whether user verification was performed at ENROLMENT. Recorded for the
   *  operator's benefit; the policy check is on every assertion. */
  uvAtEnrollment: boolean;
  enrolledAt: number;
  /** Epoch-ms of the last accepted assertion, or `enrolledAt`. */
  lastUsedAt: number;
  /** A human-facing note (the device that enrolled). Never a decision input. */
  label: string;
}

// ── failure vocabulary ───────────────────────────────────────────────────────

/**
 * WHY a ceremony was refused — for the JOURNAL and for the tests, NEVER for the
 * wire.
 *
 * Every one of these becomes the same `401 { verdict: 'wrong' }` at the route
 * (`server.ts`), and that is deliberate: telling a caller WHICH check failed
 * turns the endpoint into an oracle ("that credential id exists but the counter
 * is stale" is a very different sentence from "no such credential"). The
 * distinction is kept where it is useful — a log line the operator reads, and a
 * test that can pin each guard SEPARATELY, which is what makes the mutation
 * table in `auth-passkey.test.ts` possible at all.
 *
 * A boolean return would have made that impossible: every mutation would red
 * "expected true, got false" and no test could tell which guard it had deleted.
 */
export type WebAuthnRefusal =
  /** A field is missing, the wrong type, or fails strict base64url decoding. */
  | 'malformed'
  /** No credential with that id is enrolled on this box. */
  | 'unknown-credential'
  /** The credential's algorithm is not one this build verifies. */
  | 'unsupported-alg'
  /** The SPKI does not import, or is not the key type its algorithm claims. */
  | 'bad-key'
  /** `clientDataJSON` is not a JSON object with the fields WebAuthn requires. */
  | 'bad-client-data'
  /** `clientDataJSON.type` is not the one this ceremony requires. */
  | 'wrong-type'
  /** The ceremony ran in a cross-origin frame. */
  | 'cross-origin'
  /** `clientDataJSON.origin` is not the origin recorded for this credential. */
  | 'wrong-origin'
  /** The challenge is unknown, already spent, or past its TTL. */
  | 'stale-challenge'
  /** `authData`'s `rpIdHash` is not sha256 of the recorded rpId. */
  | 'wrong-rp'
  /** The user-present flag is clear. */
  | 'user-not-present'
  /** The user-verified flag is clear, and this box requires it. */
  | 'user-not-verified'
  /** `authData` carries no attested credential data, or the id inside it is not
   *  the one the client claimed. Registration only. */
  | 'bad-attested-data'
  /** The signature counter did not advance — a cloned authenticator, or a
   *  replayed assertion. */
  | 'sign-count-replay'
  /** The signature does not verify over `authData ‖ sha256(clientDataJSON)`. */
  | 'bad-signature';

/** A refusal, with a sentence for the journal. `detail` NEVER contains a key, a
 *  token, a cookie or a passphrase — the values it names are public ceremony
 *  fields (an origin, a type string, a counter) and are truncated where they are
 *  caller-controlled. */
export interface Refused {
  ok: false;
  reason: WebAuthnRefusal;
  detail: string;
}

const no = (reason: WebAuthnRefusal, detail: string): Refused => ({ ok: false, reason, detail });

/** Caller-controlled text, made safe to put in a log line: bounded and quoted.
 *  An attacker chooses `clientDataJSON.origin`; an unbounded one in the journal
 *  is a log-flooding primitive, and an unquoted one can forge a line break. */
const safe = (v: unknown, max = 120): string =>
  JSON.stringify(typeof v === 'string' ? v.slice(0, max) : v);

// ── clientDataJSON ───────────────────────────────────────────────────────────

/** The three fields this box reads out of `clientDataJSON`, plus the one it
 *  refuses on. Everything else a client puts there is ignored — the object is
 *  hashed WHOLE into the signed message, so extra fields are already covered by
 *  the signature and need no schema here. */
interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: unknown;
}

/**
 * Parse and shape-check `clientDataJSON`. Refuses rather than throws.
 *
 * `JSON.parse` on attacker bytes is bounded by {@link MAX_CLIENT_DATA_BYTES}
 * before it is called. The result is checked to be a non-null, non-array object
 * with three string fields — `typeof x === 'object'` alone admits `null` and
 * every array, and a caller reading `.origin` off either gets `undefined` and
 * compares it against a string, which is a refusal by luck rather than by check.
 */
function parseClientData(raw: Buffer): ClientData | Refused {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return no('bad-client-data', 'clientDataJSON is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return no('bad-client-data', 'clientDataJSON is not a JSON object');
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o['type'] !== 'string' || typeof o['challenge'] !== 'string' || typeof o['origin'] !== 'string') {
    return no('bad-client-data', 'clientDataJSON is missing type, challenge or origin');
  }
  return { type: o['type'], challenge: o['challenge'], origin: o['origin'], crossOrigin: o['crossOrigin'] };
}

/**
 * The four checks every ceremony makes on `clientDataJSON`, in the order that
 * spends the challenge as early as safely possible.
 *
 * `origin` IS COMPARED WHOLE — scheme, host AND port, as one string. Not
 * `endsWith`, not a hostname parse, not a prefix: `https://box.example` and
 * `https://box.example.evil.test` share a prefix, and `https://box:8443` and
 * `https://box:9999` share a host. The serialized origin is the whole identity
 * of the security context the ceremony ran in, and anything less than equality
 * on it is a hole.
 */
function checkClientData(
  cd: ClientData,
  wantType: 'webauthn.create' | 'webauthn.get',
  wantOrigin: string,
  challenges: ChallengeStore,
  now: number,
): Refused | null {
  if (cd.type !== wantType) {
    return no('wrong-type', `clientDataJSON.type is ${safe(cd.type)}, want ${JSON.stringify(wantType)}`);
  }
  // The spec's own cross-origin guard: an `<iframe allow="publickey-credentials-*">`
  // on someone else's page can run the ceremony against OUR rpId, and the
  // browser records that it did. Only `true` is a refusal — the field is
  // optional and absence is the same as `false` (`CLAUDE.md`'s absence-permits
  // rule, and WebAuthn §7.1 step 9 says the same).
  if (cd.crossOrigin === true) {
    return no('cross-origin', 'the ceremony ran in a cross-origin frame');
  }
  if (cd.origin !== wantOrigin) {
    return no('wrong-origin', `clientDataJSON.origin is ${safe(cd.origin)}, want ${JSON.stringify(wantOrigin)}`);
  }
  // SPENT BEFORE THE SIGNATURE IS EXAMINED. See ChallengeStore.consume.
  if (!challenges.consume(cd.challenge, now)) {
    return no('stale-challenge', `the ${challenges.purpose} challenge is unknown, already spent, or expired`);
  }
  return null;
}

// ── authenticatorData ────────────────────────────────────────────────────────

interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
}

/** Split `authData`'s fixed prefix. `null` iff it is too short to have one — a
 *  length check BEFORE any read, so a truncated buffer can never make a slice
 *  return fewer bytes than the comparison below expects. */
function readAuthData(buf: Buffer): AuthData | null {
  if (buf.length < AUTH_DATA_MIN) return null;
  return {
    rpIdHash: buf.subarray(0, RPID_HASH_END),
    flags: buf[FLAGS_AT]!,
    signCount: buf.readUInt32BE(SIGN_COUNT_AT),
  };
}

/**
 * The three checks on `authData` that are the same in both ceremonies: the
 * relying party it was produced for, and the two user-interaction flags.
 *
 * **UV POLICY — REQUIRED, AND REQUIRED AT ENROLMENT TOO.**
 *
 * `FLAG_UV` means the AUTHENTICATOR checked a PIN, a fingerprint or a face
 * before signing. Requiring it is what makes a passkey a two-factor credential
 * (something you have, something you are) rather than a bearer token that a
 * stolen, unlocked laptop hands over on the first tap. This box drives a fleet
 * of live sessions with shell access; "whoever is holding the phone" is not the
 * authentication story it should have, and `userVerification: 'required'` is
 * what every serious passkey deployment asks for.
 *
 * THE LOCKOUT THIS WOULD OTHERWISE CREATE IS CLOSED BY CHECKING IT AT ENROLMENT.
 * A requirement enforced only at login is a trap: a security key with no PIN
 * enrols happily, and then every login is refused with nothing to fix. Because
 * {@link verifyRegistration} applies the SAME check, an authenticator that
 * cannot do UV is refused while the operator is still logged in with their
 * passphrase — the failure is loud, immediate, and costs nothing. A credential
 * that exists on this box can always assert.
 *
 * UP is required unconditionally and is not a policy: an assertion with no user
 * present is one the authenticator produced without anybody touching it.
 */
function checkAuthData(ad: AuthData, rpId: string): Refused | null {
  if (!sameBytes(ad.rpIdHash, sha256(Buffer.from(rpId, 'utf8')))) {
    return no('wrong-rp',
      `authenticatorData's rpIdHash is not sha256(${JSON.stringify(rpId)}) — this credential was ` +
      'enrolled for a different relying party. If this box was renamed, re-enrol the passkey');
  }
  if ((ad.flags & FLAG_UP) === 0) {
    return no('user-not-present', 'the user-present flag is clear — nobody touched the authenticator');
  }
  if ((ad.flags & FLAG_UV) === 0) {
    return no('user-not-verified',
      'the user-verified flag is clear. This box requires user verification (a PIN, a fingerprint ' +
      'or a face) on every passkey — see webauthn.ts for why, and use the passphrase instead');
  }
  return null;
}

// ── registration ─────────────────────────────────────────────────────────────

/** Exactly what {@link verifyRegistration} reads — `PasskeyRegisterFinish`
 *  (`shared/api.ts`) as `unknown` fields, because it arrives from a browser and
 *  nothing may be asserted about it before it is checked. */
export interface RegistrationInput {
  credentialIdB64url: unknown;
  publicKeySpkiB64url: unknown;
  algorithm: unknown;
  authenticatorDataB64url: unknown;
  clientDataJsonB64url: unknown;
}

export interface RegistrationOk {
  ok: true;
  credentialId: string;
  spkiB64url: string;
  algorithm: number;
  signCount: number;
  uv: boolean;
}

/**
 * VERIFY A REGISTRATION and hand back the row to store. Pure: `now` is a
 * parameter, `challenges` is passed in, nothing is written.
 *
 * NO ATTESTATION IS VERIFIED, because none was requested — see the module
 * docstring's three-fact trust argument. What IS verified, and each of these has
 * its own test:
 *
 *  1. the algorithm is one this build can verify ({@link SUPPORTED_ALGS});
 *  2. the SPKI imports AND is really that algorithm's key type — a caller
 *     claiming `-7` with a P-384 or RSA key is refused rather than enrolled;
 *  3. `clientDataJSON` is `webauthn.create`, same-origin, at the configured
 *     origin, carrying a live REGISTRATION challenge (a separate store from the
 *     assertion one, so the two can never be crossed);
 *  4. `authData`'s rpIdHash is this box's, UP is set, UV is set;
 *  5. `authData` actually carries attested credential data, and THE CREDENTIAL
 *     ID INSIDE IT IS THE ONE THE CLIENT CLAIMED.
 *
 * (5) is the one check that is not obvious and is worth having: the client sends
 * the credential id as its own field (`PasskeyRegisterFinish`), and that field
 * is what everything downstream keys on. `authData` — which the authenticator
 * produced — contains the id too, at a fixed offset, with no CBOR in the way.
 * Cross-checking them means a client cannot enrol a key under an id that the
 * authenticator will never assert with, which would be a credential that exists
 * in the store and can never be used: a self-inflicted denial of service that
 * would be very hard to diagnose.
 */
export function verifyRegistration(
  input: RegistrationInput,
  rp: { rpId: string; origin: string },
  challenges: ChallengeStore,
  now: number,
): RegistrationOk | Refused {
  if (typeof input.algorithm !== 'number' || !Number.isInteger(input.algorithm)) {
    return no('malformed', 'algorithm is not an integer');
  }
  if (!SUPPORTED_ALGS.includes(input.algorithm)) {
    return no('unsupported-alg',
      `algorithm ${input.algorithm} is not one this build verifies (${SUPPORTED_ALGS.join(', ')})`);
  }
  const credentialId = decodeB64url(input.credentialIdB64url, MAX_CREDENTIAL_ID_BYTES);
  const spki = decodeB64url(input.publicKeySpkiB64url, MAX_SPKI_BYTES);
  const authBuf = decodeB64url(input.authenticatorDataB64url, MAX_AUTH_DATA_BYTES);
  const clientBuf = decodeB64url(input.clientDataJsonB64url, MAX_CLIENT_DATA_BYTES);
  if (credentialId === null || spki === null || authBuf === null || clientBuf === null) {
    return no('malformed', 'a field is missing, over its length bound, or not canonical base64url');
  }

  const keyProblem = importProblem(spki, input.algorithm);
  if (keyProblem !== null) return keyProblem;

  const cd = parseClientData(clientBuf);
  if ('ok' in cd) return cd;
  const cdProblem = checkClientData(cd, 'webauthn.create', rp.origin, challenges, now);
  if (cdProblem !== null) return cdProblem;

  const ad = readAuthData(authBuf);
  if (ad === null) return no('malformed', `authenticatorData is ${authBuf.length} bytes, want ≥ ${AUTH_DATA_MIN}`);
  const adProblem = checkAuthData(ad, rp.rpId);
  if (adProblem !== null) return adProblem;

  if ((ad.flags & FLAG_AT) === 0) {
    return no('bad-attested-data', 'authenticatorData carries no attested credential data (AT flag clear)');
  }
  const attested = attestedCredentialId(authBuf);
  if (attested === null) {
    return no('bad-attested-data', 'the attested credential data is truncated');
  }
  if (!sameBytes(attested, credentialId)) {
    return no('bad-attested-data',
      'the credential id the client sent is not the one inside authenticatorData — this key could ' +
      'never assert under the id it would be stored as');
  }

  return {
    ok: true,
    credentialId: credentialId.toString('base64url'),
    spkiB64url: spki.toString('base64url'),
    algorithm: input.algorithm,
    signCount: ad.signCount,
    uv: (ad.flags & FLAG_UV) !== 0,
  };
}

/**
 * The credential id out of attested credential data, WITHOUT touching CBOR.
 *
 * Layout after the 37-byte fixed prefix: `aaguid`(16) ‖ `credentialIdLength`
 * (2, big-endian) ‖ `credentialId`(that many) ‖ the COSE public key. Only the
 * length prefix and the id are read; the COSE map after it is never looked at,
 * which is the whole no-CBOR claim in three lines.
 *
 * Every read is bounds-checked FIRST, and the declared length is checked against
 * WebAuthn's own ceiling before it is used as a slice bound — a hostile
 * `credentialIdLength` of 65535 against a 60-byte buffer must refuse, not return
 * whatever `subarray` clamps to.
 */
function attestedCredentialId(authBuf: Buffer): Buffer | null {
  const lenAt = AUTH_DATA_MIN + AAGUID_BYTES;
  if (authBuf.length < lenAt + 2) return null;
  const len = authBuf.readUInt16BE(lenAt);
  if (len === 0 || len > MAX_CREDENTIAL_ID_BYTES) return null;
  const start = lenAt + 2;
  if (authBuf.length < start + len) return null;
  return authBuf.subarray(start, start + len);
}

/**
 * Import an SPKI and prove it is the key type its declared algorithm requires —
 * `null` when it is, a refusal when it is not.
 *
 * THE SECOND HALF IS THE POINT. `createPublicKey` imports any well-formed SPKI:
 * RSA, P-384, Ed25519. `createVerify('SHA256').verify` would then happily verify
 * against whichever it got, so "alg is -7" and "the key is ECDSA P-256" are two
 * different facts and only one of them was checked. A credential enrolled with
 * `alg: -7` and an RSA key would verify RSA-SHA256 signatures under a label
 * saying ES256 — not an immediate break, but a checked claim that is not the
 * claim anyone read. Refusing the mismatch keeps `SUPPORTED_ALGS` meaning what
 * it says.
 */
function importProblem(spki: Buffer, algorithm: number): Refused | null {
  let key;
  try {
    key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  } catch {
    return no('bad-key', 'the public key is not a well-formed SubjectPublicKeyInfo DER');
  }
  if (algorithm === COSE_ES256) {
    if (key.asymmetricKeyType !== 'ec') {
      return no('bad-key', `algorithm -7 (ES256) needs an EC key, got ${safe(key.asymmetricKeyType)}`);
    }
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve !== ES256_CURVE) {
      return no('bad-key', `algorithm -7 (ES256) needs curve ${ES256_CURVE}, got ${safe(curve)}`);
    }
    return null;
  }
  // Unreachable while SUPPORTED_ALGS has one member — and written as a refusal
  // rather than a fallthrough so that ADDING a member without adding its key
  // check here fails shut instead of skipping the check.
  return no('unsupported-alg', `no key-type check is defined for algorithm ${algorithm}`);
}

// ── assertion ────────────────────────────────────────────────────────────────

/** Exactly what {@link verifyAssertion} reads — `PasskeyAssertFinish` as
 *  `unknown` fields, for {@link RegistrationInput}'s reason. */
export interface AssertionInput {
  credentialIdB64url: unknown;
  authenticatorDataB64url: unknown;
  clientDataJsonB64url: unknown;
  signatureB64url: unknown;
}

export interface AssertionOk {
  ok: true;
  /** The counter to persist. Equal to the stored one when the authenticator
   *  keeps no counter — see the sign-count policy. */
  signCount: number;
  uv: boolean;
}

/**
 * VERIFY AN ASSERTION — the function an authentication bypass would live in.
 *
 * Pure. `now` is a parameter, the challenge store is passed in, the credential
 * is passed in, nothing is read from disk and nothing is written. The caller
 * persists the returned `signCount`.
 *
 * ── THE MESSAGE ──
 * `authenticatorData ‖ sha256(clientDataJSON)` — the RAW authenticator data
 * bytes, then the 32-byte hash, concatenated, and signed as one. Not the hash of
 * the concatenation of two hashes, not the client data itself, not the
 * challenge. Getting this wrong is not a "the signature won't verify" bug — it
 * is a signature over a message an attacker may be able to choose, and a test
 * (`a signature over the wrong message is refused`) exists specifically because
 * a plausible-looking wrong concatenation would still verify against a fixture
 * that made the same mistake. That test builds its message INDEPENDENTLY of this
 * function.
 *
 * ── THE ORDER ──
 * Cheap, non-cryptographic checks first; the signature LAST. Not for
 * performance: the challenge must be consumed before the expensive check so a
 * failing attempt cannot be retried against the same challenge, and every check
 * before the signature is one that says "this assertion is not for us" — which
 * is a truer answer than "the signature is bad" and a cheaper one to log.
 *
 * ── THE SIGN COUNT POLICY ──
 * `signCount` is the authenticator's own monotonic counter, and comparing it
 * against the stored one is the ONLY defence in WebAuthn against a CLONED
 * authenticator (a copied private key would sign perfectly valid assertions
 * forever). The rule, and every arm is deliberate:
 *
 *   - stored 0 AND received 0  → ACCEPT, and store 0. **Many authenticators —
 *     most Apple and Android platform passkeys, and every synced credential —
 *     always send 0**, because a counter is meaningless for a key that lives in
 *     several places by design. Refusing them would refuse the most common
 *     passkey in existence. This is stated rather than silently tolerated, and
 *     it is an accepted LOSS: for such a credential there is no clone detection,
 *     and the defence that remains is the single-use challenge, which already
 *     refuses a replayed assertion outright.
 *   - received > stored        → ACCEPT, and store the new value. The ordinary case.
 *   - anything else            → REFUSE. That covers `received === stored` (a
 *     replay, or a counter that did not move) and `received < stored`
 *     (a clone, a rollback, or an authenticator that was reset). Note this
 *     includes stored > 0 with received 0: an authenticator that HAD a counter
 *     and now sends none is not the same authenticator.
 *
 * Written as one positive admission (`received > stored`) plus the both-zero
 * carve-out, never as `received !== stored` or `!(received < stored)` — a
 * negative test is how "equal" quietly becomes acceptable.
 */
export function verifyAssertion(
  input: AssertionInput,
  cred: StoredCredential,
  challenges: ChallengeStore,
  now: number,
): AssertionOk | Refused {
  // The algorithm is re-checked on every assertion, not trusted from enrolment:
  // `credentials.ts` reads rows off disk, and a hand-edited `algorithm` must not
  // be able to select a code path that was never validated.
  if (!SUPPORTED_ALGS.includes(cred.algorithm)) {
    return no('unsupported-alg',
      `stored credential declares algorithm ${cred.algorithm}, which this build does not verify`);
  }
  const spki = decodeB64url(cred.spkiB64url, MAX_SPKI_BYTES);
  if (spki === null) return no('bad-key', 'the stored public key is not decodable');

  const credentialId = decodeB64url(input.credentialIdB64url, MAX_CREDENTIAL_ID_BYTES);
  const authBuf = decodeB64url(input.authenticatorDataB64url, MAX_AUTH_DATA_BYTES);
  const clientBuf = decodeB64url(input.clientDataJsonB64url, MAX_CLIENT_DATA_BYTES);
  const signature = decodeB64url(input.signatureB64url, MAX_SIGNATURE_BYTES);
  if (credentialId === null || authBuf === null || clientBuf === null || signature === null) {
    return no('malformed', 'a field is missing, over its length bound, or not canonical base64url');
  }
  // The caller looked the credential up by this id; this re-proves the row it
  // handed us is the row the id names. Cheap, and it makes the function safe to
  // call with a credential from anywhere.
  if (credentialId.toString('base64url') !== cred.credentialId) {
    return no('unknown-credential', 'the credential id does not match the credential supplied');
  }

  const cd = parseClientData(clientBuf);
  if ('ok' in cd) return cd;
  // `cred.origin`, NOT the box's current config — the origin RECORDED on this
  // credential. See StoredCredential's docstring.
  const cdProblem = checkClientData(cd, 'webauthn.get', cred.origin, challenges, now);
  if (cdProblem !== null) return cdProblem;

  const ad = readAuthData(authBuf);
  if (ad === null) return no('malformed', `authenticatorData is ${authBuf.length} bytes, want ≥ ${AUTH_DATA_MIN}`);
  const adProblem = checkAuthData(ad, cred.rpId);
  if (adProblem !== null) return adProblem;

  const bothZero = cred.signCount === 0 && ad.signCount === 0;
  if (!bothZero && !(ad.signCount > cred.signCount)) {
    return no('sign-count-replay',
      `signCount did not advance (stored ${cred.signCount}, presented ${ad.signCount}) — a replayed ` +
      'assertion, or a cloned authenticator');
  }

  const keyProblem = importProblem(spki, cred.algorithm);
  if (keyProblem !== null) return keyProblem;
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });

  // THE MESSAGE. Built here, once, and nowhere else in the tree.
  const signed = Buffer.concat([authBuf, sha256(clientBuf)]);
  let good: boolean;
  try {
    // DER-native: a WebAuthn ES256 signature IS an ASN.1 ECDSA-Sig-Value, and
    // `createVerify` defaults to `dsaEncoding: 'der'`. No (r, s) unpacking.
    good = createVerify('SHA256').update(signed).end().verify(key, signature);
  } catch {
    // A malformed DER signature makes OpenSSL error rather than answer "no" on
    // some inputs. A throw here would be a 500 on the login path; it is a
    // refusal.
    good = false;
  }
  if (!good) return no('bad-signature', 'the signature does not verify over authData ‖ sha256(clientDataJSON)');

  return { ok: true, signCount: bothZero ? cred.signCount : ad.signCount, uv: (ad.flags & FLAG_UV) !== 0 };
}
