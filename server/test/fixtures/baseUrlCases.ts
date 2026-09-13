// The endpoint gate's case table, in a fixture module rather than inside the
// suite, for the reason `server/test/fixtures/leastLoaded.ts` is: more than one
// caller is driven over it. `base-url.test.ts` runs BOTH implementations of the
// gate — the TypeScript `shared/base-url.ts` and its bare-`node` twin
// `shared/base-url.mjs`, row for row and against each other — and the mirror
// task then drives the two ROSTER PARSERS over the same rows
// (`parseRoster` calls the `.ts`, `rosterFromJson` imports the `.mjs`), so
// "the mirror may be stricter than the parser, never laxer" stops being a
// promise in a header and becomes an equality over one table.
//
// VOCABULARY. `orchard-api` is the blessed fixture hostname
// (`topology-clean.test.ts`); `openrouter.ai` appears because it is the table's
// real default endpoint and is nobody's box; the loopback literals are the
// three the gate admits, and 203.0.113.7 is RFC 5737 documentation space, which
// that suite's IPv4 class admits by name.
import type { BaseUrlVerdict } from '../../../shared/base-url.js';

export interface BaseUrlCase {
  readonly why: string;
  readonly raw: unknown;
  readonly expect: BaseUrlVerdict;
}

export const baseUrlCases: readonly BaseUrlCase[] = [
  // ── admitted ──────────────────────────────────────────────────────────
  { why: 'https with a path — the path is the endpoint, and it is kept',
    raw: 'https://openrouter.ai/api/v1', expect: { ok: true, url: 'https://openrouter.ai/api/v1' } },
  { why: 'https with no path — URL supplies the root, and the stored value says so',
    raw: 'https://orchard-api', expect: { ok: true, url: 'https://orchard-api/' } },
  { why: 'https on a port',
    raw: 'https://orchard-api:8443/v1', expect: { ok: true, url: 'https://orchard-api:8443/v1' } },
  { why: 'http on the IPv4 loopback — this fleet\'s existing api-key lanes run here (§4.3)',
    raw: 'http://127.0.0.1:8642', expect: { ok: true, url: 'http://127.0.0.1:8642/' } },
  { why: 'http on the IPv6 loopback, brackets and all',
    raw: 'http://[::1]:8642/v1', expect: { ok: true, url: 'http://[::1]:8642/v1' } },
  { why: 'http on localhost',
    raw: 'http://localhost:8642/v1', expect: { ok: true, url: 'http://localhost:8642/v1' } },
  { why: 'a trailing-dot loopback normalises to the loopback and is admitted',
    raw: 'http://127.0.0.1./v1', expect: { ok: true, url: 'http://127.0.0.1/v1' } },
  { why: 'scheme and host are lower-cased and the path is not — the stored value is what resolves',
    raw: 'HTTPS://Orchard-API/V1', expect: { ok: true, url: 'https://orchard-api/V1' } },
  { why: 'surrounding whitespace is a paste artefact, not an endpoint',
    raw: '  https://orchard-api/v1  ', expect: { ok: true, url: 'https://orchard-api/v1' } },

  // ── refused ───────────────────────────────────────────────────────────
  { why: 'plain http to a host that is not this box carries the key in clear',
    raw: 'http://orchard-api/v1', expect: { ok: false, reason: 'base-url-insecure' } },
  { why: 'plain http to a routable literal is the same hazard with a number',
    raw: 'http://203.0.113.7/v1', expect: { ok: false, reason: 'base-url-insecure' } },
  { why: 'https on a NEAR-loopback is fine; http on one is not — 127.0.0.2 is not in the set',
    raw: 'http://127.0.0.2/v1', expect: { ok: false, reason: 'base-url-insecure' } },
  { why: 'a scheme that is neither http nor https',
    raw: 'ftp://orchard-api/v1', expect: { ok: false, reason: 'base-url-insecure' } },
  { why: 'a URL is not a place to keep a key',
    raw: 'https://user:pass@orchard-api/v1', expect: { ok: false, reason: 'base-url-credentials' } },
  { why: 'a username with no password is still userinfo',
    raw: 'https://user@orchard-api/v1', expect: { ok: false, reason: 'base-url-credentials' } },
  { why: 'userinfo is checked BEFORE the scheme, so a plain-http URL with a key in it names the key',
    raw: 'http://user:pass@orchard-api/v1', expect: { ok: false, reason: 'base-url-credentials' } },
  { why: 'a query string is not part of an endpoint',
    raw: 'https://orchard-api/v1?beta=true', expect: { ok: false, reason: 'base-url-query' } },
  { why: 'a BARE question mark leaves search empty and href unchanged — the trap',
    raw: 'https://orchard-api/v1?', expect: { ok: false, reason: 'base-url-query' } },
  { why: 'a fragment is not part of an endpoint',
    raw: 'https://orchard-api/v1#frag', expect: { ok: false, reason: 'base-url-fragment' } },
  { why: 'a BARE hash leaves hash empty and href unchanged — the same trap',
    raw: 'https://orchard-api/v1#', expect: { ok: false, reason: 'base-url-fragment' } },
  { why: 'not a URL at all',
    raw: 'orchard-api', expect: { ok: false, reason: 'base-url-unparseable' } },
  { why: 'a scheme with nothing after it',
    raw: 'https://', expect: { ok: false, reason: 'base-url-unparseable' } },
  { why: 'the empty string is an absent value, and absence is the CALLER\'s question',
    raw: '', expect: { ok: false, reason: 'base-url-unparseable' } },
  { why: 'a non-string never reaches URL',
    raw: 7, expect: { ok: false, reason: 'base-url-unparseable' } },
  { why: 'undefined is refused here too — the caller decides whether absence is legal',
    raw: undefined, expect: { ok: false, reason: 'base-url-unparseable' } },
];
