import type { FastifyInstance } from 'fastify';
import { deriveWorkspaceSlug, offlineTitle } from '../../../shared/slug.js';
import { lookupLinearIssue, sanitizeTitle, type FetchLike, type LinearFailure } from './client.js';
import { readLinearKey } from './connection.js';
import { ticketTitle } from './title.js';

export interface LinearRouteOpts {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` lives. */
  ccrcDir: string;
  /** Test seams: the network and the deadline. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * The longest `ref` the route will parse. A pasted issue URL is about a hundred
 * characters and a copied branch name a little more; a kilobyte is generous for
 * both and still a bound on what an authenticated caller can make the slug
 * grammar chew on. Characters, not bytes: the query string is already a string.
 */
export const LINEAR_REF_MAX_CHARS = 1024;

/**
 * What the sheet reads. `reason` is a refusal word (`NameRefusal`) when `kind` is
 * `refused`, and the Linear failure arm when a ticket fell back to
 * `source: 'offline'`; `kind` says which vocabulary it is.
 */
export interface ResolveAnswer {
  kind: 'auto' | 'named' | 'refused';
  slug: string | null;
  title: string | null;
  source: 'linear' | 'offline';
  reason?: string;
}

const NO_STORE = 'no-store';

/**
 * `GET /api/linear/resolve?ref=<text>`: the PREVIEW read. It tells the new-session
 * sheet what a pasted name would become, and the real title when Linear can be
 * asked, before the operator commits to a slug they cannot change.
 *
 * Session-gated like every PWA read (it is NOT in `auth/gate.ts`'s EXEMPT table)
 * and carries no box token. L4: it parses, asks, and replies; the grammar is
 * `shared/slug.ts`, the lookup is `client.ts`, and every failure arm degrades to
 * the offline title with its fixed word as `reason`. The key is read at use time
 * from its file, so a key connected a moment ago is used on the next request.
 *
 * Nothing is written here. A 401 from Linear is reported as `unauthorised`; the
 * Settings stage owns marking the connection rejected, and the digest the client
 * returns is what it compares. Linear's response text, the key and the digest
 * never reach this reply or a log line.
 */
export function registerLinearRoutes(app: FastifyInstance, opts: LinearRouteOpts): void {
  app.get('/api/linear/resolve', {
    onRequest: async (_req, reply) => { reply.header('cache-control', NO_STORE); },
  }, async (req, reply) => {
    const q: unknown = req.query;
    const ref = typeof q === 'object' && q !== null && 'ref' in q ? (q as { ref: unknown }).ref : undefined;
    if (typeof ref !== 'string') return reply.code(400).send({ ok: false, error: 'bad-ref' });
    if (ref.length > LINEAR_REF_MAX_CHARS) return reply.code(400).send({ ok: false, error: 'ref-too-long' });

    const ask = deriveWorkspaceSlug(ref);
    if (ask.kind === 'auto') {
      return { kind: 'auto', slug: null, title: null, source: 'offline' } satisfies ResolveAnswer;
    }
    if (ask.kind === 'refused') {
      return { kind: 'refused', slug: null, title: null, source: 'offline', reason: ask.reason } satisfies ResolveAnswer;
    }

    // `offlineTitle` is null only for an auto or refused name, both answered above.
    const offline = sanitizeTitle(offlineTitle(ref) ?? ref.trim());
    if (ask.ticket === null) {
      return { kind: 'named', slug: ask.slug, title: offline, source: 'offline' } satisfies ResolveAnswer;
    }

    const key = await readLinearKey(opts.ccrcDir);
    const look = await lookupLinearIssue(ask.ticket, key, { fetch: opts.fetch, timeoutMs: opts.timeoutMs });
    if (look.ok) {
      // Composed, then sanitised AGAIN: the lookup's title fits the cap alone, and
      // `ENG-1234 - ` in front of it may push the whole past it.
      return {
        kind: 'named', slug: ask.slug, title: sanitizeTitle(ticketTitle(look.identifier, look.title)), source: 'linear',
      } satisfies ResolveAnswer;
    }
    const reason: LinearFailure = look.reason;
    return { kind: 'named', slug: ask.slug, title: offline, source: 'offline', reason } satisfies ResolveAnswer;
  });
}
