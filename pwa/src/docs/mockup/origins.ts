// The mockup's outbound-origin rules (native Docs reader, completion plan Task 7, C1; base spec 2026-10-01 5.6.3's
// script-text census and 5.6.4's origin validation; rows M5.21 and M5.EX3). Ring L1: two pure functions over strings,
// no DOM, no I/O, no timer. `parseMockupOrigin` is the one gate an origin passes before `mockupCsp` may write it into a
// policy; `scriptTextOrigins` only READS inline script text for origins to offer, and nothing it finds is fetched or
// rewritten.
import { isMockupOrigin } from './policy';
import type { HttpsOrigin } from './ports';

/** Whether `host` (already lower-case, from `URL`) is an IPv4 literal. The WHATWG parser reads any host whose last
 *  label is numeric as IPv4 and rewrites it, so a spelling other than the dotted quad fails the exact-origin check. An
 *  IPv6 literal has brackets and a colon, which the host grammar refuses. */
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The host without one trailing dot, lower-cased: how the current hostname and a candidate are compared. */
const bareHost = (host: string): string => (host.endsWith('.') ? host.slice(0, -1) : host).toLowerCase();

/** An exact `https` origin, or null: the ONE meaning of null is refused (base 5.6.4). It accepts only text that is its own
 *  origin (`new URL(raw).origin === raw`, scheme `https:`), so a path, a trailing slash, userinfo, a default port written
 *  out and an upper-case host all refuse; the host must pass the one host grammar (`isMockupHost`: LDH labels of 1 to 63
 *  characters, no edge hyphen, at least two labels, no trailing dot, so a comma, a parenthesis, a `$`, a brace or an
 *  underscore refuses), must not be an IP literal, `localhost` or
 *  `*.localhost`, and must not be `ownHostname` at ANY port. The comparison is of whole hosts, so a host that merely
 *  starts with the current hostname's text is another host and is accepted. Whitespace, `;`, `'`, `"` and `*` refuse
 *  first, so nothing that could end or widen a CSP directive gets as far as the URL parser. */
export function parseMockupOrigin(raw: string, ownHostname: string): HttpsOrigin | null {
  if (/[\s;'"*]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== raw) return null;
  // The one host grammar (LDH labels, 1-63 characters, no edge hyphen, two labels or more, no trailing dot), the same
  // function `mockupCsp` asks: an origin accepted here can never make the policy builder throw.
  if (!isMockupOrigin(raw)) return null;
  const host = bareHost(url.hostname);
  if (IPV4_HOST.test(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (host === bareHost(ownHostname)) return null;
  return raw as HttpsOrigin;
}

/** The longest origin (scheme, host and optional port) the census lists, in characters: the fixed-length capture. An
 *  origin that has not ended by then is never listed, so a cut host such as `cdn.example.ev` cannot stand in for the one
 *  the script imports. A DNS name is at most 253 characters, so this holds every real origin. */
export const SCRIPT_TEXT_ORIGIN_MAX = 300;

/** The most characters between `import` and the quote of a static import's specifier (the bindings and `from`). */
const IMPORT_BINDINGS_WINDOW = 1024;

const HTTPS_PREFIX = 'https://';

const isIdentChar = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24 || c > 0x7f;
const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;
const isQuote = (c: number): boolean => c === 0x22 || c === 0x27 || c === 0x60;

/** The origin of the specifier whose opening quote is at `q`, or null. It reads at most `SCRIPT_TEXT_ORIGIN_MAX + 1`
 *  characters after the `https://` prefix, and lists an origin only when it ends INSIDE the capture at `/` or at the
 *  closing quote: any other character (a space, `?`, `#`, `@`, `\`, another quote, a control) or the end of the text or
 *  of the capture first means nothing is listed. `http://` never matches the prefix. */
function originAt(text: string, q: number): string | null {
  const start = q + 1;
  if (!text.startsWith(HTTPS_PREFIX, start)) return null;
  const quote = text.charCodeAt(q);
  const limit = Math.min(text.length, start + SCRIPT_TEXT_ORIGIN_MAX + 1);
  for (let i = start + HTTPS_PREFIX.length; i < limit; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x2f || c === quote) return i === start + HTTPS_PREFIX.length ? null : text.slice(start, i);
    if (c <= 0x20 || c === 0x7f || c === 0x3f || c === 0x23 || c === 0x40 || c === 0x5c || isQuote(c)) return null;
  }
  return null;
}

/** Whether the text before `at` ends in the word `from`, ignoring trailing whitespace, with a non-identifier character
 *  (or the start of the segment) before it. */
function endsWithFrom(text: string, from: number, at: number): boolean {
  let e = at;
  while (e > from && isSpace(text.charCodeAt(e - 1))) e -= 1;
  if (e - 4 < from || text.slice(e - 4, e) !== 'from') return false;
  return e - 4 === from || !isIdentChar(text.charCodeAt(e - 5)) || isSpace(text.charCodeAt(e - 5));
}

/** The script-text census (base 5.6.3; row M5.EX3): the origins of absolute `https` specifiers in `import(` and
 *  `import ... from`, each once, in first-seen order. One linear pass: each `import` word is examined only up to the next
 *  one (and a fixed window), and a match reads a fixed-length capture. An `http://` specifier, an origin that does not end
 *  inside the capture at `/` or at its quote, a method called `import` and a name ending in `import` are never listed.
 *  Nothing is fetched or rewritten. A candidate is listed only when `parseMockupOrigin` would accept it for ANY page
 *  other than the one that is running (it is asked with no current hostname), so the census never lists what the
 *  validator refuses on its own account (a comma in the host, `localhost`, an IP literal, a single label); the caller still
 *  passes each through `parseMockupOrigin` with the real current hostname, which is the one refusal left. */
export function scriptTextOrigins(text: string): string[] {
  const found: string[] = [];
  const judged = new Set<string>(); // each distinct candidate is judged once
  const keep = (o: string | null): void => {
    if (o === null || judged.has(o)) return;
    judged.add(o);
    if (parseMockupOrigin(o, '') !== null) found.push(o);
  };
  let p = text.indexOf('import');
  while (p >= 0) {
    const after = p + 6;
    const next = text.indexOf('import', after);
    const before = p === 0 ? 0 : text.charCodeAt(p - 1);
    // `obj.import(...)` is a method, `reimport(...)` another name: only a bare `import` word counts.
    if (p === 0 || (!isIdentChar(before) && before !== 0x2e)) {
      const limit = Math.min(next < 0 ? text.length : next, after + IMPORT_BINDINGS_WINDOW);
      let i = after;
      while (i < limit && isSpace(text.charCodeAt(i))) i += 1;
      if (text.charCodeAt(i) === 0x28) {
        // import( 'specifier'
        i += 1;
        while (i < text.length && isSpace(text.charCodeAt(i))) i += 1;
        if (isQuote(text.charCodeAt(i))) keep(originAt(text, i));
      } else {
        // import <bindings> from 'specifier': the first quote ends the bindings, and the word before it must be `from`.
        let q = after;
        while (q < limit && !isQuote(text.charCodeAt(q)) && text.charCodeAt(q) !== 0x3b) q += 1;
        if (q < limit && isQuote(text.charCodeAt(q)) && endsWithFrom(text, after, q)) keep(originAt(text, q));
      }
    }
    p = next;
  }
  return found;
}
