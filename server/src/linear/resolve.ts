/**
 * What a typed or pasted workspace name BECOMES: its kind, its slug and its display title, with Linear asked for
 * the real title when the name is a ticket and a key is connected.
 *
 * ONE OWNER of that answer, shared by the two callers that must never disagree: the PREVIEW read
 * (`GET /api/linear/resolve`, `routes.ts`) and the CREATE (`POST /api/projects/:project/workspaces`, `server.ts`).
 * If each composed it, the title the operator saw in the sheet could differ from the one the board shows after Start.
 *
 * L3: it reads the key file and calls Linear, and decides nothing the grammar (`shared/slug.ts`, L0) or the title
 * format (`title.ts`, L1) has not already decided. It never rejects, every Linear failure arm degrades to the
 * offline title carrying its fixed word as `reason`, and neither the key, its digest nor Linear's text leaves it.
 */
import type { LinearFailure, ResolveAnswer } from '../../../shared/linear.js';
import { deriveWorkspaceSlug, offlineTitle, sanitizeTitle, type LinearRef } from '../../../shared/slug.js';
import { lookupLinearIssue, type FetchLike } from './client.js';
import { markLinearRejected, readLinearKey } from './connection.js';
import { ticketTitle } from './title.js';

export interface ResolveDeps {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` lives. */
  ccrcDir: string;
  /** Test seams: the network, the deadline and the clock. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** The display title of an accepted name and where it came from; `reason` is the Linear failure arm on an offline fallback. */
export interface ResolvedTitle { title: string; source: 'linear' | 'offline'; reason?: LinearFailure }

/**
 * The title for a name, given the Linear `ticket` it names (null for a plain one). Linear's when the name is a ticket, a
 * key is connected and Linear answers; otherwise the offline title. Always sanitised and within `WS_TITLE_MAX_BYTES`, so
 * ccd's `--title` refusals cannot be reached by a lookup.
 *
 * THE TICKET IS A PARAMETER, NOT DERIVED HERE, because the two callers read a name differently: a create's name was
 * accepted by the slug grammar (`deriveWorkspaceSlug`, whose `ticket` is this), and a rename's was not asked to be (a
 * rename never changes the slug, so a title the grammar refuses is still a title, and its ticket is `parseLinearRef`'s).
 */
export async function resolveTitle(ref: string, ticket: LinearRef | null, deps: ResolveDeps): Promise<ResolvedTitle> {
  // `offlineTitle` is null for a name the slug grammar refuses (a rename's title may be one); the trimmed text is the operator's own.
  const offline = sanitizeTitle(offlineTitle(ref) ?? ref.trim());
  if (ticket === null) return { title: offline, source: 'offline' };

  const key = await readLinearKey(deps.ccrcDir);
  const look = await lookupLinearIssue(ticket, key, { fetch: deps.fetch, timeoutMs: deps.timeoutMs });
  if (look.ok) {
    // Composed, then sanitised AGAIN: the lookup's title fits the cap alone, and `ENG-1234 - ` in front of it may
    // push the whole past it.
    return { title: sanitizeTitle(ticketTitle(look.identifier, look.title)), source: 'linear' };
  }
  if (look.reason === 'unauthorised') {
    // The 401 marker (design §5.1), and ONLY a 401's: a 403 (`forbidden`) is Linear refusing this request, not a verdict
    // on the key, and falls through to the offline title unmarked. Settings tells the truth next time it is opened. `markLinearRejected` compares
    // digests, so a key replaced meanwhile is never condemned, and its failing never changes the answer.
    await markLinearRejected(deps.ccrcDir, look.keyDigest, (deps.now ?? Date.now)()).catch(() => {
      // Fixed words only: the error can carry a path, and the digest and key stay out of the line.
      console.warn('ccrc-server: linear: could not record a rejected key');
    });
  }
  return { title: offline, source: 'offline', reason: look.reason };
}

/** The caller has checked `ref` is a string within `LINEAR_REF_MAX_CHARS`. */
export async function resolveName(ref: string, deps: ResolveDeps): Promise<ResolveAnswer> {
  const ask = deriveWorkspaceSlug(ref);
  if (ask.kind === 'auto') return { kind: 'auto', slug: null, title: null, source: 'offline' };
  if (ask.kind === 'refused') {
    return { kind: 'refused', slug: null, title: null, source: 'offline', reason: ask.reason };
  }
  const t = await resolveTitle(ref, ask.ticket, deps);
  return {
    kind: 'named', slug: ask.slug, title: t.title, source: t.source, ...(t.reason === undefined ? {} : { reason: t.reason }),
  };
}
