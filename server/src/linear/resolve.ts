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
import { deriveWorkspaceSlug, offlineTitle } from '../../../shared/slug.js';
import { lookupLinearIssue, sanitizeTitle, type FetchLike, type LinearFailure } from './client.js';
import { readLinearKey } from './connection.js';
import { ticketTitle } from './title.js';

/**
 * The longest name the server will parse. A pasted issue URL is about a hundred characters and a copied branch name a
 * little more; a kilobyte is generous for both and still a bound on what an authenticated caller can make the slug
 * grammar chew on. Characters, not bytes.
 */
export const LINEAR_REF_MAX_CHARS = 1024;

/**
 * What the sheet reads. `reason` is a refusal word (`NameRefusal`) when `kind` is `refused`, and the Linear failure
 * arm when a ticket fell back to `source: 'offline'`; `kind` says which vocabulary it is.
 */
export interface ResolveAnswer {
  kind: 'auto' | 'named' | 'refused';
  slug: string | null;
  title: string | null;
  source: 'linear' | 'offline';
  reason?: string;
}

export interface ResolveDeps {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` lives. */
  ccrcDir: string;
  /** Test seams: the network and the deadline. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** The caller has checked `ref` is a string within `LINEAR_REF_MAX_CHARS`. */
export async function resolveName(ref: string, deps: ResolveDeps): Promise<ResolveAnswer> {
  const ask = deriveWorkspaceSlug(ref);
  if (ask.kind === 'auto') return { kind: 'auto', slug: null, title: null, source: 'offline' };
  if (ask.kind === 'refused') {
    return { kind: 'refused', slug: null, title: null, source: 'offline', reason: ask.reason };
  }

  // `offlineTitle` is null only for an auto or refused name, both answered above.
  const offline = sanitizeTitle(offlineTitle(ref) ?? ref.trim());
  if (ask.ticket === null) return { kind: 'named', slug: ask.slug, title: offline, source: 'offline' };

  const key = await readLinearKey(deps.ccrcDir);
  const look = await lookupLinearIssue(ask.ticket, key, { fetch: deps.fetch, timeoutMs: deps.timeoutMs });
  if (look.ok) {
    // Composed, then sanitised AGAIN: the lookup's title fits the cap alone, and `ENG-1234 - ` in front of it may
    // push the whole past it.
    return {
      kind: 'named', slug: ask.slug, title: sanitizeTitle(ticketTitle(look.identifier, look.title)), source: 'linear',
    };
  }
  const reason: LinearFailure = look.reason;
  return { kind: 'named', slug: ask.slug, title: offline, source: 'offline', reason };
}
