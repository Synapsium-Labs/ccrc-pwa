// The continuity routes (Overlord spec §3.3.11, §11.2, W1a). L4: they own the reply and decide nothing; the record is
// `continuityStore.ts`'s, the sender check is `coord/attribution.ts`'s `attributionVerdict`, the gate every box-token
// lane shares. This file is a lane source of its own for `box-token-census.test.ts`, as `linking/routes.ts` is.
//
// W1a registers the start report alone. W1's loaded-file report and witness extend this file (Table 11.1e, "The
// hook's reports").
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';

export interface ContinuityRouteDeps {
  /** The coordination store, or undefined on a server without one (a test, a script): the report answers `unavailable`. */
  coord: CoordStore | undefined;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check (`attributionVerdict` over the registry). */
  attribute: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The server's wall clock (`deps.time.clock.wall`): `receivedAt`, what every reader ages a start from (§11.5). */
  wall: () => number;
}

/** The identity pair's grammar, the linking read's and the Linear proxy's. */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** The hook's own id for one report: a resend carries the same one, so it is recorded once. */
const REPORT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SOURCE_MAX = 32;
const MODEL_MAX = 128;

const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

const isSafeNat = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function registerContinuityRoutes(app: FastifyInstance, deps: ContinuityRouteDeps): void {
  /**
   * `POST /api/sessions/:id/start`: the hook reports one SessionStart of a session that is not a child (its source, the
   * conversation's uuid, the model, the registry generation). A box-token machine lane, an `auth/gate.ts` EXEMPT entry:
   * the token first (never the cookie), then the path's session is the sender (`not-owner`), then the registry's
   * attribution (`stale-uuid` for a uuid the registry has not followed yet, which the hook spools and resends), then the
   * body's shape, then the one writer. `202 { ok, id, fresh }`; a resend of a recorded report is `fresh: false`.
   */
  app.post('/api/sessions/:id/start', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/sessions/:id/start');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    if (b['fromId'] !== id) return refuseRoute(reply, 'not-owner', { detail: 'fromId must be the session the path names' });
    const uuid = b['fromUuid'];
    if (!IDENTITY_RE.test(id) || typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) {
      return refuseRoute(reply, 'bad-request', { detail: 'fromId and fromUuid' });
    }
    const attributed = await deps.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });

    const { reportId, source, reportedAt } = b;
    const model = b['model'] ?? null;
    const regGen = b['regGen'] ?? null;
    if (typeof reportId !== 'string' || !REPORT_ID_RE.test(reportId)) return refuseRoute(reply, 'bad-request', { detail: 'reportId' });
    if (typeof source !== 'string' || source.length === 0 || source.length > SOURCE_MAX) return refuseRoute(reply, 'bad-request', { detail: 'source' });
    if (!isSafeNat(reportedAt)) return refuseRoute(reply, 'bad-request', { detail: 'reportedAt' });
    if (model !== null && (typeof model !== 'string' || model.length > MODEL_MAX)) return refuseRoute(reply, 'bad-request', { detail: 'model' });
    if (regGen !== null && !isSafeNat(regGen)) return refuseRoute(reply, 'bad-request', { detail: 'regGen' });

    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    const r = coord.insertStart({ sessionId: id, reportId, uuid, source, model, regGen, reportedAt, receivedAt: deps.wall() });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_starts could not be written' });
    return reply.code(202).send({ ok: true, id: r.id, fresh: r.fresh });
  });
}
