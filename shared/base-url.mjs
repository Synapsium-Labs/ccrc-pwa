// shared/base-url.mjs — the endpoint gate (spec §4.1), for the callers that run
// under a BARE `node`: `deploy/account-op.mjs` and `shared/roster-json.mjs`,
// neither of which can import `shared/base-url.ts` (no build step, no `tsx`, no
// compiled `dist/` — `deploy/gen-accounts.mjs`'s header, :4-11).
//
// WHY A TWIN AND NOT A COPY WITH A COMMENT. `shared/roster-json.mjs` already
// carries five hand-kept copies of `shared/roster.ts` rules and its header
// (:49-52) states the asymmetry that makes them survivable: it may be STRICTER
// than the parser, never laxer. That argument does not extend to a URL gate.
// A stricter endpoint gate in one of the two files refuses a roster the server
// boots on — the split verdict D-1854 is about, pointing the other way. So the
// two are compared to the SAME case table row for row and to EACH OTHER
// (`server/test/base-url.test.ts`), and the file with the second copy of the
// LOOPBACK SET is this one and no other.
//
// It imports nothing — not even `node:*`. It does not need to, and a
// dependency here would be inherited by every bare-`node` caller and by the
// fixture trees that copy them (`ccrc-install.test.ts`'s TREE_FILES).
//
// The three behaviours the implementation turns on are argued in
// `shared/base-url.ts`'s header and measured in the suite: `?` and `#` are
// tested on the RAW string (a bare one of either leaves `search`/`hash` empty
// while surviving into `href`), userinfo is tested BEFORE the scheme, and the
// admitted verdict carries `u.href` — the NORMALISED endpoint — because the
// value stored has to be the value the lane resolves.

/** Mirrors `shared/base-url.ts`'s `LOOPBACK_HOSTS`, and is the only other copy
 *  of that set in the tree. */
export const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]', 'localhost'];

/** `(raw: unknown) => { ok: true, url } | { ok: false, reason }` — the same
 *  verdicts, the same order of checks, the same normalised value. */
export const BASE_URL_OK = (raw) => {
  if (typeof raw !== 'string') return { ok: false, reason: 'base-url-unparseable' };
  const text = raw.trim();
  let u;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: 'base-url-unparseable' };
  }
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'base-url-credentials' };
  if (text.includes('?')) return { ok: false, reason: 'base-url-query' };
  if (text.includes('#')) return { ok: false, reason: 'base-url-fragment' };
  if (u.protocol === 'https:') return { ok: true, url: u.href };
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname)) return { ok: true, url: u.href };
  return { ok: false, reason: 'base-url-insecure' };
};
