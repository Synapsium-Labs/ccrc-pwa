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
 * FIRST OCCURRENCE WINS, and that is the conventional read rather than a
 * defence. A jar can legitimately carry two cookies of the same name (one set
 * for `Path=/`, one for a sub-path, or one from a parent domain), and RFC 6265
 * §5.4 has the browser send them in DESCENDING PATH LENGTH — most specific
 * first, with nothing on the wire to say which is which. Taking the first is
 * therefore the only reading that agrees with what a browser means by the order
 * it chose.
 *
 * WHAT IT DOES NOT DO IS STOP SHADOWING, and an earlier version of this comment
 * claimed it did (review Important 4). Our cookie is pinned at the SHORTEST
 * possible path (`Path=/`), so a shadow set for a longer path sorts AHEAD of it
 * and is exactly what this function returns. Shadowing is bounded by the
 * deployment and by `Secure` — one origin, one operator, and a `Secure` cookie a
 * plaintext origin cannot set — not by this parser. What the parser does
 * guarantee is that a shadow cannot become a BYPASS: whatever value comes back
 * still has to survive `SessionStore.verify`, and a token that is not a live
 * session ends in a 401 like any other. The failure mode is denial of service
 * against one session, never entry.
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
    if (name === '' || out.has(name)) continue; // first occurrence wins — see the docstring
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

/**
 * Do the box's cookie policy and its configured origin CONTRADICT each other?
 * `null` when they agree. A sentence, not a boolean, for
 * `relyingPartyProblem`'s reason: the caller LOGS it, and "your cookie config is
 * wrong" is not a thing an operator can act on at 2am.
 *
 * WHY THIS ONE IS IMPLEMENTABLE WHEN THE ORIGIN SELF-CHECK IS NOT. The check
 * everybody wants — "is `CCRC_ORIGIN` actually the name this box is reached
 * under" — cannot be written: behind `tailscale serve` the server never learns
 * that name, so every arm of such a check would have to fail shut on a correctly
 * configured box. This one asks nothing about the outside world. It compares two
 * values the server already holds, both stated by the same operator in the same
 * file, and it fires only when they disagree with each other.
 *
 * ARM ONE — `http:` origin, `Secure` cookie. This is the failure that has no
 * other signal anywhere. The login route answers `204` with a `Set-Cookie`, the
 * session row is written, the server's job is done and correct — and a browser
 * that declines to store a `Secure` cookie from a plain-http origin drops it on
 * the floor, so the next request arrives with no cookie and the operator watches
 * a login succeed and the login screen come straight back. Nothing is logged,
 * because nothing failed. (Whether a given browser accepts the cookie from
 * `http://localhost` is that browser's own policy — several treat loopback as a
 * secure context and some do not — which is exactly why this warns rather than
 * refuses: the box cannot know, and it must not take a working deployment off
 * the air over a guess.)
 *
 * ARM TWO — `https:` origin, `Secure` dropped. The mirror, and a real downgrade
 * rather than a puzzle: the dev opt-out left switched on for a box that is
 * behind TLS means the session cookie is one plain-http request to the same host
 * away from the wire. There is no legitimate reason for this combination, and
 * the plausible way to arrive at it is copying a localhost env file onto a real
 * box.
 *
 * Both CORRECT combinations are silent (`http:` + opted out, `https:` + `Secure`),
 * which is `_check_auth`'s rule from D-126: a warning every operator sees on
 * every boot is a warning they learn to skim past, and the ones that matter lose
 * by it.
 *
 * An origin this cannot PARSE returns `null` — not because it is fine, but
 * because `originProblem` (`webauthn.ts`) already reports exactly that, and one
 * misconfiguration deserves one line.
 */
export function cookiePolicyProblem(origin: string, cookieSecure: boolean): string | null {
  let scheme: string;
  try {
    scheme = new URL(origin).protocol;
  } catch {
    return null;
  }
  if (scheme === 'http:' && cookieSecure) {
    return `CCRC_ORIGIN is plain http (${JSON.stringify(origin)}) and the session cookie is still ` +
      'marked Secure, so a browser may refuse to store it — a login that answers 204 and then ' +
      'bounces straight back to the login screen, with nothing failing anywhere to say why. ' +
      'On a localhost development box set CCRC_COOKIE_INSECURE=on; on any box reached over TLS, ' +
      'fix CCRC_ORIGIN to the https URL browsers actually use instead.';
  }
  if (scheme === 'https:' && !cookieSecure) {
    return `CCRC_ORIGIN is https (${JSON.stringify(origin)}) and CCRC_COOKIE_INSECURE=on has ` +
      'dropped Secure from the session cookie, so it will also be sent over any plain-http request ' +
      'to this host. That opt-out exists for localhost development only — remove it from this ' +
      "box's ccrc.env and restart.";
  }
  return null;
}
