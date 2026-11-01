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
import {
  LINEAR_TEAMS_MAX, isLinearTeamKey, isLinearUrlKey, isLinearUuid, parseLinearTeams, type LinearFailure, type LinearTeam,
} from '../../../shared/linear.js';
import { sanitizeTitle } from '../../../shared/slug.js';
// The name cleaner lives in L0 beside the unprintable set (#1444), so a pure caller imports it without this L3 file.
import { cleanName } from '../../../shared/unprintable.js';
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
  | { ok: false; reason: Exclude<LinearFailure, 'not-configured' | 'rate-limited'>; keyDigest: string }
  | { ok: false; reason: 'rate-limited'; keyDigest: string; retryAfterS: number };

/**
 * Injectable so tests never reach the network. Matches `fetch`'s shape. The answer's `headers` is the one method of
 * `fetch`'s own `Headers` this file reads (spec §6.7: the wait of a rate-limited answer); every test fake gains it
 * through `server/test/linearFetchFake.ts`.
 */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  redirect?: 'error';
}) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json: () => Promise<unknown> }>;

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

/** The bounds `Retry-After` is held to, and the wait when Linear sent none (spec §6.7), in seconds. */
export const LINEAR_RETRY_AFTER_MIN_S = 1;
export const LINEAR_RETRY_AFTER_MAX_S = 3_600;
export const LINEAR_RATE_LIMITED_FALLBACK_S = 60;

/** A header read as a non-negative integer, or not at all: a date, a fraction, a sign or an exponent is not one. */
const headerCount = (headers: { get(name: string): string | null }, name: string): number | null => {
  const raw = headers.get(name)?.trim() ?? '';
  return /^[0-9]+$/.test(raw) ? Number(raw) : null;
};

/**
 * How long a rate-limited answer says to wait: `Retry-After`, held to 1 to 3,600 seconds, else sixty seconds.
 * `X-RateLimit-Requests-Reset` is NOT read yet: whether it is a wait or a reset time, and in which unit, is recorded
 * from a fixture first (spec §6.7; the plan's build note for this task), so until then a missing `Retry-After` is the
 * fallback, never a guess at that header's unit.
 */
const waitOf = (headers: { get(name: string): string | null }): number => {
  const after = headerCount(headers, 'retry-after');
  return after === null ? LINEAR_RATE_LIMITED_FALLBACK_S
    : Math.min(LINEAR_RETRY_AFTER_MAX_S, Math.max(LINEAR_RETRY_AFTER_MIN_S, after));
};

/** Linear's refusal of a request over its limit: an `errors` entry whose `extensions.code` is `RATELIMITED`. */
const isRateLimitedBody = (body: unknown): boolean =>
  isRecord(body) && Array.isArray(body['errors'])
  && body['errors'].some((e) => isRecord(e) && isRecord(e['extensions']) && e['extensions']['code'] === 'RATELIMITED');

/**
 * What one call to Linear produced, before anything reads its body for a meaning: the parsed JSON, or the
 * fixed word for why there is none. THE ONE FETCH PATH in this file (the lookup and the key check both go
 * through it), so the deadline, the header and the failure arms exist once. Exported with this type for the
 * callers that ask the one rate service before each call and settle with its outcome (spec §6.7).
 */
export type LinearCall =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'rate-limited'; retryAfterS: number }
  | { ok: false; reason: Exclude<LinearFailure, 'not-configured' | 'not-found' | 'rate-limited'> };

export async function callLinear(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  deps: { fetch?: FetchLike; timeoutMs?: number },
): Promise<LinearCall> {
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
      // A redirect would carry the key to wherever Linear is told to send us; an error here reads as `unreachable`.
      redirect: 'error',
    });

    // RATE-LIMITED (spec §6.7): a 429, or an `errors` entry with the `RATELIMITED` code whatever the status (Linear
    // refuses over its limit on a 200 and a 400 too). Its own arm, carrying the wait, so the caller can close the
    // slot until then; it is not a credential fault, and a title still degrades to the offline one.
    const limited = (): LinearCall => ({ ok: false, reason: 'rate-limited', retryAfterS: waitOf(res.headers) });
    if (res.status === 429) return limited();

    let body: unknown;
    let read = true;
    try {
      body = await res.json();
    } catch {
      read = false;
    }
    if (read && isRateLimitedBody(body)) return limited();

    if (!res.ok) {
      // ONLY a 401 says the key is bad (spec 5.1). A 403 is Linear refusing this
      // request (a scope, a team the key cannot see): its own arm, which no caller
      // may treat as a verdict on the key. Everything else is the service. The
      // body of a refusal is read only for the rate-limit code above, never kept.
      return { ok: false, reason: res.status === 401 ? 'unauthorised' : res.status === 403 ? 'forbidden' : 'unreachable' };
    }
    // The deadline can fire while the body is still arriving; that is a
    // timeout, not a shape fault.
    if (!read) return { ok: false, reason: ac.signal.aborted ? 'timeout' : 'malformed' };
    return { ok: true, body };
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
  const fail = (reason: Exclude<LinearFailure, 'not-configured' | 'rate-limited'>): LinearLookup =>
    ({ ok: false, reason, keyDigest });

  const call = await callLinear(key.key, QUERY, { id: asked }, deps);
  // `rate-limited` is read as `unreachable` is: a failure the caller degrades to the offline title, with its wait.
  if (!call.ok) {
    return call.reason === 'rate-limited'
      ? { ok: false, reason: 'rate-limited', keyDigest, retryAfterS: call.retryAfterS } : fail(call.reason);
  }
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

/** The most teams one page of the key check asks for (spec §4.1). The FX capture records this page's `X-Complexity`, and
 *  the spec's rule is that it stays under `LINEAR_QUOTA.maxQueryComplexity`: a page that would not is lowered HERE, in
 *  this constant, never at run time. */
export const LINEAR_TEAM_PAGE_SIZE = 250;

/**
 * The key check (spec §4.1): ONE document, who the key is, which workspace it reaches, and one page of the teams its
 * user can reach. The same document asks the second page, with the first page's cursor; the viewer and the
 * organization come back on both, which is how a second page that names another workspace is told from this one's.
 */
const KEY_CHECK_QUERY = 'query KeyCheck($after: String) { viewer { name } organization { id name urlKey } '
  + `teams(first: ${LINEAR_TEAM_PAGE_SIZE}, after: $after) { nodes { id key name } pageInfo { hasNextPage endCursor } } }`;

/** The failures a key check can end in. `not-configured` makes no call and `not-found` has no meaning here. */
export type LinearVerifyFailure = Exclude<LinearFailure, 'not-configured' | 'not-found'>;

/**
 * `keyDigest` on EVERY outcome, as in the lookup: a caller acting on `unauthorised` compares it with the digest
 * of the key now on disk before it condemns anything.
 */
export type LinearVerify =
  | { ok: true; org: string; user: string; keyDigest: string }
  | { ok: false; reason: Exclude<LinearVerifyFailure, 'rate-limited'>; keyDigest: string }
  | { ok: false; reason: 'rate-limited'; keyDigest: string; retryAfterS: number };

/** What a key check learned of the workspace, whole: its id, its name and URL key, and every team the key's user
 *  reaches up to the record's cap (`more` says Linear holds teams past it, a known limit). Names are cleaned. */
export interface LinearLearnedWorkspace {
  id: string;
  name: string;
  urlKey: string;
  teams: LinearTeam[];
  more: boolean;
}

/**
 * A key check's answer. `pagesSent` is how many pages went to Linear (0, 1 or 2), so the caller can settle the rate
 * service with what was spent. `workspace` is null whenever the check could not learn it WHOLE (an answer out of its
 * grammar, a second page not granted or not asked): a partial team list could route a team to the wrong workspace,
 * so it is never kept. `key-changed`: the key was gone, or had changed, when a page was due, so nothing it learned
 * describes the key now in the file and the caller records nothing.
 */
export type LinearKeyCheck =
  | { ok: true; org: string; user: string; keyDigest: string; workspace: LinearLearnedWorkspace | null; pagesSent: number }
  | { ok: false; reason: Exclude<LinearVerifyFailure, 'rate-limited'>; keyDigest: string; pagesSent: number }
  | { ok: false; reason: 'rate-limited'; keyDigest: string; retryAfterS: number; pagesSent: number }
  | { ok: false; reason: 'key-changed'; keyDigest: string | null; pagesSent: number };

/** One page of the key check, read. */
type KeyPage =
  | { ok: false; reason: Exclude<LinearVerifyFailure, 'rate-limited'> }
  | { ok: false; reason: 'rate-limited'; retryAfterS: number }
  | {
      ok: true; org: string; user: string;
      /** The workspace's id, name and URL key, or null when any is out of its grammar. */
      ws: { id: string; name: string; urlKey: string } | null;
      /** This page's teams, or null when the page, or any team on it, is out of its grammar. */
      teams: LinearTeam[] | null;
      /** The cursor of the next page, or null when Linear says there is none. */
      next: string | null;
    };

/** The longest cursor taken back to Linear; anything longer, or not a string, is no cursor. */
const CURSOR_MAX_CHARS = 512;

const readTeams = (v: unknown): { teams: LinearTeam[]; next: string | null } | null => {
  if (!isRecord(v) || !Array.isArray(v['nodes']) || !isRecord(v['pageInfo'])) return null;
  const nodes = v['nodes'];
  if (nodes.length > LINEAR_TEAM_PAGE_SIZE) return null;
  const teams: LinearTeam[] = [];
  for (const n of nodes) {
    if (!isRecord(n)) return null;
    const name = cleanName(n['name']);
    if (!isLinearUuid(n['id']) || !isLinearTeamKey(n['key']) || name === null) return null;
    teams.push({ id: n['id'], key: n['key'], name });
  }
  const more = v['pageInfo']['hasNextPage'];
  const cursor = v['pageInfo']['endCursor'];
  if (more === false) return { teams, next: null };
  if (more !== true || typeof cursor !== 'string' || cursor.length === 0 || cursor.length > CURSOR_MAX_CHARS) return null;
  return { teams, next: cursor };
};

async function askKeyPage(key: string, after: string | null, deps: { fetch?: FetchLike; timeoutMs?: number }): Promise<KeyPage> {
  const call = await callLinear(key, KEY_CHECK_QUERY, { after }, deps);
  if (!call.ok) return call;
  const body = call.body;
  if (!isRecord(body)) return { ok: false, reason: 'malformed' };
  const data = body['data'];
  if (!isRecord(data)) {
    // A GraphQL `errors` array with no data is the service refusing the query, not a shape fault.
    const errors = body['errors'];
    return { ok: false, reason: Array.isArray(errors) && errors.length > 0 ? 'unreachable' : 'malformed' };
  }
  const viewer = data['viewer'];
  const organization = data['organization'];
  const user = isRecord(viewer) ? cleanName(viewer['name']) : null;
  const org = isRecord(organization) ? cleanName(organization['name']) : null;
  if (user === null || org === null) return { ok: false, reason: 'malformed' };
  // The names are what the v1 record has always shown; what the workspace adds is read on its own grammar, so an
  // answer that names the user and the organisation keeps the check's answer even when the rest cannot be learned.
  const ws = isRecord(organization) && isLinearUuid(organization['id']) && isLinearUrlKey(organization['urlKey'])
    ? { id: organization['id'], name: org, urlKey: organization['urlKey'] } : null;
  const page = readTeams(data['teams']);
  return { ok: true, org, user, ws, teams: page?.teams ?? null, next: page?.next ?? null };
}

/**
 * The key check (spec §4.1), for a STORED key: `readKey` reads it from its file, and is called again before each page,
 * so a key removed or replaced between two pages stops the check at its next page. At most two pages, so at most
 * `LINEAR_TEAMS_MAX` (500) teams, the record's cap; the second only when Linear says there is one and `mayAskMore`
 * grants it (the caller's rate service, asked for that one call).
 * Nothing here keeps the key past the call it is read for. The same fetch path, header and deadline as the lookup.
 */
export async function checkLinearKey(
  readKey: () => Promise<LinearKeyRead>,
  deps: { fetch?: FetchLike; timeoutMs?: number; mayAskMore?: () => boolean } = {},
): Promise<LinearKeyCheck> {
  const net = { fetch: deps.fetch, timeoutMs: deps.timeoutMs };
  const k1 = await readKey();
  if (k1.kind !== 'key') return { ok: false, reason: 'key-changed', keyDigest: null, pagesSent: 0 };
  const keyDigest = valueDigestHex(k1.key);
  const p1 = await askKeyPage(k1.key, null, net);
  if (!p1.ok) return { ...p1, keyDigest, pagesSent: 1 };
  const answer = (workspace: LinearLearnedWorkspace | null, pagesSent: number): LinearKeyCheck =>
    ({ ok: true, org: p1.org, user: p1.user, keyDigest, workspace, pagesSent });
  if (p1.ws === null || p1.teams === null) return answer(null, 1);
  if (p1.next === null) {
    // The record's own grammar, duplicates included: a workspace whose two teams share a key is not routed at all.
    const teams = parseLinearTeams(p1.teams);
    return answer(teams === null ? null : { ...p1.ws, teams, more: false }, 1);
  }
  if (deps.mayAskMore === undefined) return answer(null, 1);

  // The key again, from its file, before the second page: gone or changed means this check describes nothing stored.
  const k2 = await readKey();
  if (k2.kind !== 'key' || valueDigestHex(k2.key) !== keyDigest) return { ok: false, reason: 'key-changed', keyDigest, pagesSent: 1 };
  if (!deps.mayAskMore()) return answer(null, 1);
  const p2 = await askKeyPage(k2.key, p1.next, net);
  if (!p2.ok) return { ...p2, keyDigest, pagesSent: 2 };
  if (p2.ws === null || p2.ws.id !== p1.ws.id || p2.teams === null) return answer(null, 2);
  const all = [...p1.teams, ...p2.teams];
  const teams = parseLinearTeams(all.slice(0, LINEAR_TEAMS_MAX));
  if (teams === null) return answer(null, 2);
  return answer({ ...p1.ws, teams, more: p2.next !== null || all.length > LINEAR_TEAMS_MAX }, 2);
}

/**
 * Ask Linear who a PASTED key is (the legacy Connect: a key is stored only once this answered `ok`). The first page of
 * the key check (§4.1); its answer is the two names and the digest, as it always was, and nothing else is kept. The
 * names are Linear's text and are cleaned.
 */
export async function verifyLinearKey(
  key: string,
  deps: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<LinearVerify> {
  const keyDigest = valueDigestHex(key);
  const p = await askKeyPage(key, null, deps);
  if (!p.ok) return { ...p, keyDigest };
  return { ok: true, org: p.org, user: p.user, keyDigest };
}
