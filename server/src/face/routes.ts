// The operator's character choice (the Overlord face plan, Task 6): `GET /api/face` and `POST /api/face`. L4, context C6: they
// own the reply and decide nothing; `isCharacter` (L0) narrows the word and `CoordStore` is the one row. Both are
// session-gated like every route not in the gate's `EXEMPT` table, and neither reads the box token: the operator chooses in
// the console.
import type { FastifyInstance } from 'fastify';
import { isCharacter } from '../../../shared/face.js';
import { refuseRoute } from '../refuse.js';
import type { CoordStore } from '../coord/store.js';

export interface FaceRouteOpts {
  /** The coordination store; undefined (a test, a script): `unavailable`. */
  coord: CoordStore | undefined;
  now?: () => number;
}

export function registerFaceRoutes(app: FastifyInstance, opts: FaceRouteOpts): void {
  const now = opts.now ?? Date.now;

  app.get('/api/face', async (_req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    return opts.coord.faceSettings();
  });

  app.post('/api/face', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const body = req.body as { character?: unknown } | null | undefined;
    const character = typeof body === 'object' && body !== null ? body.character : undefined;
    if (!isCharacter(character)) return refuseRoute(reply, 'bad-request', { detail: 'character' });
    opts.coord.setFaceCharacter(character, now());
    return opts.coord.faceSettings();
  });
}
