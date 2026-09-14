// The endpoint gate (spec §4.1). L0 and import-free, `shared/providers.ts`
// included: the TABLE is data and this is a DECISION, and they are separate
// files so `single-definition.test.ts` can fingerprint them separately and so
// this gate can never start branching on which provider is asking. Whether an
// ABSENT endpoint is legal is the caller's question, answered against the
// provider table's `baseUrlRequired` column in `parseExec`; this file answers
// only what a PRESENT one is.
//
// The table's identifier is deliberately not spelled anywhere in this file, in
// code or in prose, and `base-url.test.ts` asserts that as a substring ban. It
// is not pedantry: naming it in a comment is how a branch on it starts, and the
// ban is the cheapest possible statement of "this decision does not know who is
// asking".
//
// FIVE REFUSALS, NOT A BOOLEAN. Two of the five have their own codes in the
// verb's refusal table (`base-url-insecure`, `base-url-credentials`, spec §5)
// and the add sheet has to say which happened. Collapsing them would be the
// overloaded-null-at-a-seam defect this repo bans by name: a caller that has to
// re-derive "which one" from the input it just handed over is a caller the
// answer was withheld from.
//
// WHY `?` AND `#` ARE TESTED ON THE RAW STRING. Measured 2026-09-07 (node 22):
// `new URL('https://orchard-api/v1?').search` is `''` and its `.href` is
// `'https://orchard-api/v1?'` — the character survives into the stored value
// while the parsed component reads empty. The same holds for a bare `#`. A gate
// written as `u.search !== '' || u.hash !== ''` therefore admits both and
// stores an endpoint ending in a stray delimiter. Percent-encoded `%3F`/`%23`
// are path bytes and are unaffected, which is the behaviour that makes the raw
// test safe rather than merely blunt.
//
// WHY THE VERDICT CARRIES `href` AND NOT THE OPERATOR'S INPUT. `URL`
// lower-cases the scheme and the host and leaves the path alone, so
// `HTTPS://Orchard-API/V1` resolves as `https://orchard-api/V1`. §4.1 says the
// endpoint is SHOWN, never hidden — the card renders it, doctor checks it and
// `settings.json` carries it — so the value stored has to be the value the lane
// will actually resolve. Storing the input verbatim would put two different
// answers to one question on two different screens.

/** The three hosts a plain-`http:` endpoint may name. A CLOSED literal set, not
 *  a `127.0.0.0/8` range test: `URL` has already normalised the spellings that
 *  differ (`http://127.0.0.1./v1` parses with hostname `127.0.0.1`,
 *  `http://LOCALHOST:8642` with `localhost`), and a range test in L0 means
 *  hand-parsing dotted quads for a set of three.
 *
 *  The exception is not a courtesy: `~/.local/bin/cck3` and
 *  `~/.local/bin/claude-glm` on the fleet box already point
 *  `ANTHROPIC_BASE_URL` at `http://127.0.0.1:8642` (spec §4.3, measured
 *  2026-09-07), and the whole argument for a general `baseUrl` is that the
 *  ownership-whitelist proxy IS an Anthropic-compatible endpoint. Refusing
 *  plain http outright would refuse the configuration this fleet runs today. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', 'localhost'];

/** Why an endpoint was refused. Each is a distinct sentence on the add sheet;
 *  `base-url-required` is deliberately NOT here — an absent value never reaches
 *  this gate. */
export type BaseUrlRefusal =
  | 'base-url-unparseable'
  | 'base-url-insecure'
  | 'base-url-credentials'
  | 'base-url-query'
  | 'base-url-fragment';

/** `url` on the `ok` arm is the NORMALISED endpoint — see the header. */
export type BaseUrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: BaseUrlRefusal };

/**
 * The gate. Order of checks is deliberate and is asserted by the case table:
 * userinfo is tested BEFORE the scheme, so `http://user:pass@orchard-api/v1`
 * answers `base-url-credentials` rather than `base-url-insecure`. Both are
 * true of it; only one of them names a secret the operator has just pasted
 * somewhere it will be stored in clear, and that is the one to say out loud.
 */
export const BASE_URL_OK = (raw: unknown): BaseUrlVerdict => {
  if (typeof raw !== 'string') return { ok: false, reason: 'base-url-unparseable' };
  const text = raw.trim();
  let u: URL;
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
