/**
 * Resolving a Linear ticket to its title.
 *
 * L3 ADAPTER. The decision of what a pasted string MEANS lives in
 * `shared/slug.ts` (L0, pure); this only fetches. It is the second outbound
 * call in the whole server and the first to a third party the operator
 * configures, so the rules it inherits are stated rather than assumed:
 *
 *   1. IT CARRIES A DEADLINE. Every `gh` call on the fleet box is wrapped in
 *      `PR_GH_TIMEOUT=8` (`ccd/ccd`); the one in-process `fetch` that is not,
 *      the Hetzner reboot, is the exception and not the model. Without an
 *      AbortSignal a Linear outage wedges a request the phone is waiting on,
 *      with no way for the operator to tell a slow lookup from a dead one.
 *   2. IT NEVER BLOCKS THE CREATE. Every failure arm resolves to a typed
 *      answer the caller can carry on from; nothing here throws. The offline
 *      title is always available (`title.ts`), so a Linear problem costs a
 *      nicer NAME, never the workspace.
 *   3. IT NEVER ECHOES LINEAR. A failure is one fixed word. Linear's response
 *      text is not copied into a result, an error body or a log line, and the
 *      key itself appears nowhere: only its sha256 digest leaves this file.
 *
 * WHY THE SERVER BOX. The agent cannot do this: its dependencies are
 * `node-pty` and `ws`, it has no HTTP client at all, and `EXEC_COMMANDS` is
 * closed to `tmux`/`ccd`; a `curl` grant is exactly what `agent/src/whitelist.ts`
 * refuses to add. So the only place the call can live is here.
 *
 * THE ENDPOINT IS TWO CONSTANTS, deliberately never one string. The public-tree
 * scanner (`topology-clean.test.ts`) refuses a host and a path written joined,
 * in any tracked file or any blob the branch adds.
 */
import { WS_TITLE_MAX_BYTES } from '../../../shared/slug.js';
import { valueDigestHex } from '../token/files.js';
import type { LinearKeyRead } from './connection.js';

/** Linear's API origin. */
export const LINEAR_API_ORIGIN = 'https://api.linear.app';
/** The GraphQL path on that origin. */
export const LINEAR_API_PATH = '/graphql';

/**
 * The deadline, in milliseconds. `PR_GH_TIMEOUT`'s eight seconds is the house
 * number for an outbound call a human is waiting on; this is the same budget
 * for the same reason.
 */
export const LINEAR_TIMEOUT_MS = 8_000;

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * A title ccd will accept: every run of control characters becomes ONE space
 * (ccd refuses a control character in `--title`, so an unsanitised issue title
 * could turn a lookup into a 502), the result is trimmed, and a result over the
 * cap is SHORTENED with `…`, never refused. The cap is `WS_TITLE_MAX_BYTES`, ccd's own
 * `--title` bound, in UTF-8 BYTES (`_lc_dec_ok` runs under `LC_ALL=C`, so an emoji spends four). Shortening walks whole code points,
 * so it cannot split a character, and drops a space the cut would leave in
 * front of the ellipsis.
 */
export function sanitizeTitle(raw: string): string {
  const s = raw.replace(/\p{Cc}+/gu, ' ').trim();
  if (utf8Bytes(s) <= WS_TITLE_MAX_BYTES) return s;
  const budget = WS_TITLE_MAX_BYTES - utf8Bytes('…');
  let kept = '';
  let used = 0;
  for (const ch of s) {
    const n = utf8Bytes(ch);
    if (used + n > budget) break;
    kept += ch;
    used += n;
  }
  return `${kept.trimEnd()}…`;
}

/**
 * Why a lookup produced no title. EACH ITS OWN, because the caller and the
 * operator do different things about each: `not-configured` is an operator
 * setup step, `unauthorised` a bad or expired key, `not-found` a ticket that
 * does not exist (or that the key cannot see), `timeout` is worth retrying,
 * `malformed` is an answer that was not the shape asked for (Linear changed, or
 * something else is answering), and `unreachable` is everything else the
 * service or the network did (a 5xx, a 429, a refused connection, a GraphQL
 * errors array). Folding them into one "failed" is the overloaded seam
 * CLAUDE.md forbids, and here it would be the difference between "paste your
 * key" and "check the ticket number".
 */
export const LINEAR_FAILURES = [
  'not-configured', 'unauthorised', 'not-found', 'timeout', 'malformed', 'unreachable',
] as const;
export type LinearFailure = (typeof LINEAR_FAILURES)[number];

/** The ticket half of a parsed name. Structural, so `shared/slug.ts`'s `LinearRef` satisfies it. */
export interface LinearTicket { key: string; num: string }

/**
 * `keyDigest` is the sha256 of the key the call was made WITH, on every outcome
 * that made a call. A caller that wants to act on a 401 (the Settings stage
 * marks the connection rejected) compares it with the digest of the key now on
 * disk, so a 401 for a key the operator has since replaced cannot condemn the
 * new one. This stage writes nothing.
 *
 * `not-configured` makes no call and so has no digest; it says WHICH way the key
 * file failed to yield one, because `unreadable` and `absent` have different
 * remedies and the key read already told them apart.
 */
export type LinearLookup =
  | { ok: true; identifier: string; title: string; keyDigest: string }
  | { ok: false; reason: 'not-configured'; key: Exclude<LinearKeyRead['kind'], 'key'> }
  | { ok: false; reason: Exclude<LinearFailure, 'not-configured'>; keyDigest: string };

/** Injectable so tests never reach the network. Matches `fetch`'s shape. */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * `issue(id:)` accepts the human identifier (`ENG-1234`) as well as the UUID,
 * which is what makes the offline parse and the online lookup agree on one key:
 * there is no id translation step to get wrong.
 */
const QUERY = 'query Issue($id: String!) { issue(id: $id) { identifier title } }';

/** Linear's identifier shape; anything else it echoes is not trusted over the one we asked for. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Look up a ticket's title with the key `readLinearKey` produced.
 *
 * Anything but a usable key answers `not-configured` WITHOUT a call, the
 * ordinary state of a box whose operator has not connected Linear and not an
 * error anybody needs to see. The caller degrades to the offline title.
 */
export async function lookupLinearIssue(
  ref: LinearTicket,
  key: LinearKeyRead,
  deps: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<LinearLookup> {
  if (key.kind !== 'key') return { ok: false, reason: 'not-configured', key: key.kind };

  const token = key.key;
  const keyDigest = valueDigestHex(token);
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? LINEAR_TIMEOUT_MS);
  const asked = `${ref.key.toUpperCase()}-${ref.num}`;
  const fail = (reason: Exclude<LinearFailure, 'not-configured'>): LinearLookup =>
    ({ ok: false, reason, keyDigest });

  try {
    const res = await doFetch(`${LINEAR_API_ORIGIN}${LINEAR_API_PATH}`, {
      method: 'POST',
      headers: {
        // NO `Bearer`. A Linear PERSONAL API KEY is sent as the bare
        // Authorization value; only OAuth access tokens take the `Bearer`
        // prefix. Adding it "for correctness" is the natural slip, so
        // `linear.test.ts` pins the exact header.
        'authorization': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { id: asked } }),
      signal: ac.signal,
    });

    if (!res.ok) {
      // 401/403 is a key problem the operator can fix; everything else is the
      // service. 429 lands in `unreachable` deliberately: it is not a
      // credential fault and the caller's answer (use the offline title) is
      // the same as for a 500.
      return fail(res.status === 401 || res.status === 403 ? 'unauthorised' : 'unreachable');
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // The deadline can fire while the body is still arriving; that is a
      // timeout, not a shape fault.
      return fail(ac.signal.aborted ? 'timeout' : 'malformed');
    }

    if (!isRecord(body)) return fail('malformed');
    const data = body['data'];
    if (!isRecord(data) || !('issue' in data)) return fail('malformed');
    const issue = data['issue'];

    // GraphQL answers 200 with an `errors` array. A missing issue arrives as
    // `data.issue === null`, which is NOT an error condition on the wire; both
    // have to be read, and they mean different things to the operator.
    if (issue === null) {
      const errors = body['errors'];
      return fail(Array.isArray(errors) && errors.length > 0 ? 'unreachable' : 'not-found');
    }
    if (!isRecord(issue)) return fail('malformed');
    const rawTitle = issue['title'];
    if (typeof rawTitle !== 'string') return fail('malformed');

    // A ticket with no title once sanitised is not a lookup failure to retry:
    // there is simply nothing to name it with.
    const title = sanitizeTitle(rawTitle);
    if (title === '') return fail('not-found');

    const echoed = issue['identifier'];
    return {
      ok: true,
      // Linear's own casing for the identifier, when it gives a well-formed
      // one: the operator may have typed `eng-1234` and the board should read
      // `ENG-1234`.
      identifier: typeof echoed === 'string' && IDENTIFIER.test(echoed) ? echoed : asked,
      title,
      keyDigest,
    };
  } catch {
    // An abort is the deadline, and it is worth telling apart from a DNS
    // failure: one is worth retrying on the same input, the other means the
    // box cannot reach Linear at all. The error itself is never kept; its text
    // can carry a URL or a header.
    return fail(ac.signal.aborted ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timer);
  }
}
