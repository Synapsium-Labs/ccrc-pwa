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
import type { LinearFailure } from '../../../shared/linear.js';
import { sanitizeTitle } from '../../../shared/slug.js';
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
 * What one call to Linear produced, before anything reads its body for a meaning: the parsed JSON, or the
 * fixed word for why there is none. THE ONE FETCH PATH in this file (the lookup and the key check both go
 * through it), so the deadline, the header and the failure arms exist once.
 */
type Call =
  | { ok: true; body: unknown }
  | { ok: false; reason: Exclude<LinearFailure, 'not-configured' | 'not-found'> };

async function callLinear(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  deps: { fetch?: FetchLike; timeoutMs?: number },
): Promise<Call> {
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? LINEAR_TIMEOUT_MS);
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
      body: JSON.stringify({ query, variables }),
      signal: ac.signal,
    });

    if (!res.ok) {
      // ONLY a 401 says the key is bad (spec 5.1). A 403 is Linear refusing this
      // request (a scope, a team the key cannot see): its own arm, which no caller
      // may treat as a verdict on the key. Everything else is the service. 429
      // lands in `unreachable` deliberately: it is not a credential fault and the
      // caller's answer (use the offline title) is the same as for a 500.
      return { ok: false, reason: res.status === 401 ? 'unauthorised' : res.status === 403 ? 'forbidden' : 'unreachable' };
    }

    try {
      return { ok: true, body: await res.json() };
    } catch {
      // The deadline can fire while the body is still arriving; that is a
      // timeout, not a shape fault.
      return { ok: false, reason: ac.signal.aborted ? 'timeout' : 'malformed' };
    }
  } catch {
    // An abort is the deadline, and it is worth telling apart from a DNS
    // failure: one is worth retrying on the same input, the other means the
    // box cannot reach Linear at all. The error itself is never kept; its text
    // can carry a URL or a header.
    return { ok: false, reason: ac.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

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

  const keyDigest = valueDigestHex(key.key);
  const asked = `${ref.key.toUpperCase()}-${ref.num}`;
  const fail = (reason: Exclude<LinearFailure, 'not-configured'>): LinearLookup =>
    ({ ok: false, reason, keyDigest });

  const call = await callLinear(key.key, QUERY, { id: asked }, deps);
  if (!call.ok) return fail(call.reason);
  const body = call.body;

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
}

/** The key check's query: who the key is and which organisation it reads. Two names and nothing else. */
const VIEWER_QUERY = 'query Viewer { viewer { name } organization { name } }';

/** The longest an organisation or user name is kept (code points). A bound on what Linear's text can put
 *  in a file and on the screen. */
export const LINEAR_NAME_MAX_CHARS = 80;

/** A name from Linear, made safe to store and show: control runs collapse to one space, trimmed, bounded. Null
 *  when nothing is left (a name that is all control characters is no name). */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = [...raw.replace(/\p{Cc}+/gu, ' ').trim()].slice(0, LINEAR_NAME_MAX_CHARS).join('').trim();
  return s === '' ? null : s;
}

/** The failures a key check can end in. `not-configured` makes no call and `not-found` has no meaning here. */
export type LinearVerifyFailure = Exclude<LinearFailure, 'not-configured' | 'not-found'>;

/**
 * `keyDigest` on EVERY outcome, as in the lookup: a caller acting on `unauthorised` compares it with the digest
 * of the key now on disk before it condemns anything.
 */
export type LinearVerify =
  | { ok: true; org: string; user: string; keyDigest: string }
  | { ok: false; reason: LinearVerifyFailure; keyDigest: string };

/**
 * Ask Linear who `key` is. The Settings route's Connect and Check again: a key is stored only once this
 * answered `ok`. The same fetch path, header and deadline as the lookup (`callLinear`); the names are Linear's
 * text and are cleaned here, and nothing else of the answer is kept.
 */
export async function verifyLinearKey(
  key: string,
  deps: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<LinearVerify> {
  const keyDigest = valueDigestHex(key);
  const call = await callLinear(key, VIEWER_QUERY, {}, deps);
  if (!call.ok) return { ok: false, reason: call.reason, keyDigest };
  const body = call.body;
  if (!isRecord(body)) return { ok: false, reason: 'malformed', keyDigest };
  const data = body['data'];
  if (!isRecord(data)) {
    // A GraphQL `errors` array with no data is the service refusing the query, not a shape fault.
    const errors = body['errors'];
    return { ok: false, reason: Array.isArray(errors) && errors.length > 0 ? 'unreachable' : 'malformed', keyDigest };
  }
  const viewer = data['viewer'];
  const organization = data['organization'];
  const user = isRecord(viewer) ? cleanName(viewer['name']) : null;
  const org = isRecord(organization) ? cleanName(organization['name']) : null;
  if (user === null || org === null) return { ok: false, reason: 'malformed', keyDigest };
  return { ok: true, org, user, keyDigest };
}
