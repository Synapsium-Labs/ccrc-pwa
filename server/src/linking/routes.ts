// The linking standard's routes (D-8147). L4: they own the reply and decide nothing; `policy.ts` parses the body and
// `coord/linkingStore.ts` is the table. Task 2 registers the operator's write; the session's read and the template
// pull request join it in this file.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CoordStore } from '../coord/store.js';
import { refuseRoute } from '../refuse.js';
import { parseLinkingWrite } from './policy.js';

export interface LinkingRouteOpts {
  /** The coordination store, or undefined on a server without one (a test, a script): the write answers `unavailable`. */
  coord: CoordStore | undefined;
  /** Who is writing: the device the request's session names (`server.ts`'s `pwaDec`). */
  by: (req: FastifyRequest) => string;
  now?: () => number;
}

export function registerLinkingRoutes(app: FastifyInstance, opts: LinkingRouteOpts): void {
  const now = opts.now ?? Date.now;

  /**
   * `POST /api/projects/:project/linking`: the operator sets a project's Linear team key and visibility override. NOT in
   * `auth/gate.ts`'s EXEMPT table: session-gated when armed, open dark, no box token (the pool route's stance). The project
   * name goes into a bound SQL parameter only and is not refused for a name the walk has not listed yet: an operator may
   * set a project's key before its first walk. The 200 is MEASURED, not echoed: the row is read back after the write.
   */
  app.post('/api/projects/:project/linking', async (req, reply) => {
    const { project } = req.params as { project: string };
    const parsed = parseLinkingWrite(req.body);
    if (!parsed.ok) return refuseRoute(reply, parsed.error);
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    try {
      coord.setLinking(project, parsed.write, opts.by(req), now());
      return { ok: true, linking: coord.linkingOf(project) };
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
