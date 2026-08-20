/**
 * The session cookie — one reader, one writer, hand-rolled.
 *
 * NO `@fastify/cookie`, deliberately (plan constraint: "No new dependency in any
 * package.json"). What that plugin buys is signing, a `reply.setCookie` sugar and
 * a parser with more edge cases than this box will ever meet. Signing is the only
 * one worth wanting and this scheme does not need it: the value is 256 bits of
 * `randomBytes` and the server holds `sha256(token)` (`sessions.ts`) — an
 * unforgeable bearer token needs no second signature, and a signature would only
 * add a key to rotate. What is left is ~30 lines, below.
 *
 * THE ATTRIBUTES, AND WHY EACH ONE:
 *  - `HttpOnly` — script cannot read the token, so an XSS in the PWA cannot
 *    exfiltrate a session. Not optional and not configurable.
 *  - `SameSite=Lax`, not `Strict` — `Strict` withholds the cookie on a top-level
 *    navigation that came from anywhere else, which for a phone PWA means every
 *    tap on a push notification or a shared link lands on the login screen while
 *    a perfectly live session sits in the jar. `Lax` still withholds it from
 *    cross-site POSTs, which is the CSRF shape that matters here (every write on
 *    this server is a POST).
 *  - `Path=/` — the gate covers every route including the socket upgrades, so the
 *    cookie has to be sent for every one of them.
 *  - `Max-Age` — the browser's own copy of the session's absolute TTL, so a jar
 *    that outlives the server's record does not keep presenting a token that can
 *    only ever answer `'expired'`.
 *  - `Secure` — from `cfg.cookieSecure` and NEVER from the request's own scheme:
 *    see that field's docstring. It is the one attribute a caller supplies.
 *
 * NO `__Host-` PREFIX, and that is a decision rather than an omission: the prefix
 * is only honoured when the cookie is `Secure`, so a box running the dev opt-out
 * (`CCRC_COOKIE_INSECURE=on`, plain http on localhost) would have to use a
 * DIFFERENT cookie name from a box that is not — two names for one thing, and a
 * session silently lost the day an operator flips the flag. One stable name, and
 * the properties `__Host-` would have enforced (`Path=/`, no `Domain`) are
 * enforced here by there being no way to ask for anything else.
 */

/** The ONE spelling of the cookie's name — the gate reads it, the login route
 *  writes it, the logout route expires it, and nothing else names it. */
export const SESSION_COOKIE = 'ccrc_session';

/** What a caller must decide before a `Set-Cookie` line can be built. Everything
 *  else about the cookie is fixed by {@link serializeCookie} and is not a knob. */
export interface CookieOptions {
  /** The `Secure` attribute — `cfg.cookieSecure`. */
  secure: boolean;
  /** `Max-Age`, in SECONDS (the header's unit; the TTLs in `sessions.ts` are ms). */
  maxAgeSeconds: number;
}

/**
 * The `Cookie:` request header, split into name→value.
 *
 * FIRST OCCURRENCE WINS. A jar can legitimately carry two cookies of the same
 * name (one set for `Path=/`, one for a sub-path, or one from a parent domain),
 * and the browser sends the most specific first without saying which is which —
 * so "first" is the conventional read and the only one that matches what a
 * browser means by it. It also bounds cookie-shadowing: a second `ccrc_session`
 * injected after ours cannot displace it.
 *
 * NEVER THROWS. This runs inside the `onRequest` hook, where a throw is a 500 —
 * the wrong polarity for a gate whose whole job is to answer 401. A pair with no
 * `=`, an empty name, or a value with a stray `%` is skipped or taken raw rather
 * than raising: the worst case is a value that then fails `SessionStore.verify`,
 * which is the same refusal by a shorter road.
 *
 * Returns a `Map`, not an object literal: a `Cookie` header is attacker-supplied
 * text and `out['__proto__'] = …` on a plain object is a prototype-pollution
 * shape this simply does not have.
 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof header !== 'string' || header === '') return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;                       // a bare attribute, not a name=value pair
    const name = pair.slice(0, eq).trim();
    if (name === '' || out.has(name)) continue; // first occurrence wins — see above
    let value = pair.slice(eq + 1).trim();
    // RFC 6265 permits a DQUOTE-wrapped value; strip the pair, never one half.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    // `decodeURIComponent` is the inverse of what `serializeCookie` writes, and
    // for the ONE value this ships — a base64url token, whose alphabet
    // (`A-Za-z0-9-_`) percent-encoding leaves untouched — both are the identity.
    // The catch is therefore unreachable in production and exists for the one
    // reason worth the two lines: a malformed `%` in an inbound header must not
    // throw inside the gate.
    try { out.set(name, decodeURIComponent(value)); }
    catch { out.set(name, value); }
  }
  return out;
}

/** One `Set-Cookie` line. The five fixed attributes are not parameters — see the
 *  module docstring for why each is what it is. */
export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    // Floored and clamped: a negative or fractional Max-Age is not a header a
    // browser has to guess at.
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * The `Set-Cookie` line that DELETES the cookie — logout's half of the pair.
 *
 * `Max-Age=0` with an empty value, built through {@link serializeCookie} rather
 * than assembled separately: a browser only replaces a cookie when the name,
 * `Path` and `Domain` all match the one it holds, so an expiry line whose
 * attributes had drifted from the login line's would leave the original cookie
 * sitting in the jar with the server's record already revoked — a logout that
 * looks like it worked and leaves a dead token being presented on every request.
 * Sharing the builder makes that drift impossible.
 *
 * `Secure` still rides along (via `opts`) for the same matching reason.
 */
export function expireCookie(name: string, opts: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return serializeCookie(name, '', { secure: opts.secure, maxAgeSeconds: 0 });
}
