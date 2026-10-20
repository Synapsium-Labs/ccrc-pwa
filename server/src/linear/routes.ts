import type { FastifyInstance } from 'fastify';
import { type FetchLike } from './client.js';
import { LINEAR_REF_MAX_CHARS, resolveName, type ResolveAnswer } from './resolve.js';

// Kept importable from here: the route's own tests and the preview's callers name them beside the route.
export { LINEAR_REF_MAX_CHARS, type ResolveAnswer };

export interface LinearRouteOpts {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` lives. */
  ccrcDir: string;
  /** Test seams: the network and the deadline. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

const NO_STORE = 'no-store';

/**
 * `GET /api/linear/resolve?ref=<text>`: the PREVIEW read. It tells the new-session
 * sheet what a pasted name would become, and the real title when Linear can be
 * asked, before the operator commits to a slug they cannot change.
 *
 * Session-gated like every PWA read (it is NOT in `auth/gate.ts`'s EXEMPT table)
 * and carries no box token. L4: it validates the query and replies; the answer
 * itself is `resolve.ts`'s (shared with the create route), the grammar is
 * `shared/slug.ts`, and every failure arm degrades to the offline title with its
 * fixed word as `reason`. The key is read at use time from its file, so a key
 * connected a moment ago is used on the next request.
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
    return resolveName(ref, { ccrcDir: opts.ccrcDir, fetch: opts.fetch, timeoutMs: opts.timeoutMs });
  });
}
