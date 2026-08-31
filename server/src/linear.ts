/**
 * Resolving a Linear ticket to its title.
 *
 * L3 ADAPTER. The decision of what a pasted string MEANS lives in `shared/slug.ts`
 * (L1, pure); this only fetches. It is the second outbound call in the whole
 * server and the first to a third party the operator configures, so the two
 * rules it inherits are stated rather than assumed:
 *
 *   1. IT CARRIES A DEADLINE. Every `gh` call on the fleet box is wrapped in
 *      `PR_GH_TIMEOUT=8` (`ccd/ccd:2594`); the one in-process `fetch` that is
 *      not — the Hetzner reboot — is the exception, not the model. Without an
 *      AbortSignal a Linear outage wedges a Fastify request the phone is
 *      waiting on, with no way for the operator to tell a slow lookup from a
 *      dead one.
 *   2. IT NEVER BLOCKS THE CREATE. Every failure arm resolves to a typed
 *      answer the caller can carry on from; nothing here throws. The offline
 *      name is always available (`deriveWorkspaceSlug` needs no network), so a
 *      Linear problem costs a nicer NAME, never the workspace.
 *
 * WHY THE SERVER BOX. The agent cannot do this: its dependencies are
 * `node-pty` and `ws`, it has no HTTP client at all, and `EXEC_COMMANDS` is
 * closed to `tmux`/`ccd` — a `curl` grant is exactly what
 * `agent/src/whitelist.ts:309-315` refuses to add. So the only place the call
 * can live is here.
 */
import type { LinearRef } from '../../shared/slug.js';

/** Linear's GraphQL endpoint. */
export const LINEAR_API = 'https://api.linear.app/graphql';

/**
 * The deadline, in milliseconds. `PR_GH_TIMEOUT`'s eight seconds is the house
 * number for an outbound call a human is waiting on; this is the same budget
 * for the same reason.
 */
export const LINEAR_TIMEOUT_MS = 8_000;

/**
 * Why a lookup produced no title. FIVE CONDITIONS, EACH ITS OWN, because the
 * caller and the operator do different things about each: `not-configured` is
 * an operator setup step, `unauthorised` is a bad or expired key, `not-found`
 * means the ticket does not exist (or the key cannot see it), `timeout` is
 * worth retrying and `unreachable` covers the rest. Folding them into one
 * "failed" is the overloaded seam CLAUDE.md forbids — and here it would be the
 * difference between "paste your key" and "check the ticket number".
 */
export const LINEAR_FAILURES = [
  'not-configured', 'unauthorised', 'not-found', 'timeout', 'unreachable',
] as const;
export type LinearFailure = (typeof LINEAR_FAILURES)[number];

export type LinearLookup =
  | { ok: true; identifier: string; title: string }
  | { ok: false; reason: LinearFailure };

/** Injectable so tests never reach the network. Matches `fetch`'s shape. */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * `issue(id:)` accepts the human identifier (`ENG-1234`) as well as the UUID,
 * which is what makes the offline parse and the online lookup agree on one key
 * — there is no id translation step to get wrong.
 */
const QUERY = 'query Issue($id: String!) { issue(id: $id) { identifier title } }';

/**
 * Look up a ticket's title.
 *
 * `token === null` answers `not-configured` WITHOUT a call — the ordinary
 * state of a box whose operator has not set `CCRC_LINEAR_TOKEN`, and not an
 * error anybody needs to see. The caller degrades to the offline name.
 */
export async function lookupLinearIssue(
  ref: LinearRef,
  token: string | null,
  deps: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<LinearLookup> {
  if (token === null || token === '') return { ok: false, reason: 'not-configured' };

  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? LINEAR_TIMEOUT_MS);
  const identifier = `${ref.key}-${ref.num}`;

  try {
    const res = await doFetch(LINEAR_API, {
      method: 'POST',
      headers: {
        // NO `Bearer`. A Linear PERSONAL API KEY is sent as the bare
        // Authorization value; only OAuth access tokens take the `Bearer`
        // prefix. Getting this "right" by adding Bearer is the natural slip,
        // so `linear.test.ts` pins the exact header.
        'authorization': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { id: identifier } }),
      signal: ac.signal,
    });

    if (!res.ok) {
      // 401/403 is a key problem the operator can fix; everything else is the
      // service. 429 lands in `unreachable` deliberately — it is not a
      // credential fault and the caller's answer (use the offline name) is the
      // same as for a 500.
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorised' };
      return { ok: false, reason: 'unreachable' };
    }

    const body = await res.json() as {
      data?: { issue?: { identifier?: unknown; title?: unknown } | null };
      errors?: unknown;
    };

    // GraphQL answers 200 with an `errors` array. A missing issue arrives as
    // `data.issue === null`, which is NOT an error condition on the wire —
    // both have to be read, and they mean different things to the operator.
    const issue = body.data?.issue;
    if (issue === null || issue === undefined) {
      return { ok: false, reason: Array.isArray(body.errors) && body.errors.length > 0
        ? 'unreachable' : 'not-found' };
    }
    if (typeof issue.title !== 'string' || issue.title.trim() === '') {
      // A ticket with no title is not a lookup failure to retry — there is
      // simply nothing to name it with.
      return { ok: false, reason: 'not-found' };
    }
    return {
      ok: true,
      // Linear's own casing for the identifier, when it gives one: the
      // operator may have typed `eng-1234` and the board should read
      // `ENG-1234`.
      identifier: typeof issue.identifier === 'string' && issue.identifier !== ''
        ? issue.identifier : identifier,
      title: issue.title.trim(),
    };
  } catch (err) {
    // An abort is the deadline, and it is worth telling apart from a DNS
    // failure: one is worth retrying on the same input, the other means the
    // box cannot reach Linear at all.
    const aborted = (err as { name?: string } | null)?.name === 'AbortError' || ac.signal.aborted;
    return { ok: false, reason: aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `[TICKET] - {title}` — the operator's requested display format, built in one
 * place so the route and any future caller cannot spell it differently.
 * A hyphen with spaces, matching what was asked for; the title is trimmed but
 * otherwise verbatim, because it is the ticket's own words.
 */
export function ticketTitle(identifier: string, title: string): string {
  return `${identifier} - ${title}`;
}
