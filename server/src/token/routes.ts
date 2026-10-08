import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Deps } from '../server.js';
import type { ClaimDoor } from './door.js';
import { CLAIM_BODY_LIMIT_BYTES, type BoxTokenView, type ClaimRefusal, type RotateAnswer } from '../../../shared/box-token.js';

/**
 * What the token routes need from the driver, declared here by its consumer
 * (the L2 rule, kept in the delivery file because nothing else consumes it).
 * `commitHandOut` persists `handedOutAt`/`confirmBy` (fsynced) for a generation
 * the door just handed out; when it rejects, the route answers 503 and the
 * driver discards that generation, so a value is never handed out without a
 * record of it (D-4394).
 */
export interface TokenRouteDriver {
  readonly door: ClaimDoor;
  commitHandOut(generation: string, at: number): Promise<void>;
  rotateNow(now: number): Promise<RotateAnswer>;
  view(): BoxTokenView;
}

const NO_STORE = 'no-store';

const refuse = (reply: FastifyReply, status: number, error: ClaimRefusal): FastifyReply =>
  reply.code(status).header('cache-control', NO_STORE).send({ ok: false, error });

/**
 * The box-token lifecycle's two routes (spec 4.6), registered from their own
 * file: the FOURTH route-registering file, which `auth-gate.test.ts`'s `ROUTES`
 * and `box-token-census.test.ts`'s lane sources read by name. Neither route
 * consults the box token, and the census holds that (`CODE_DOORS`,
 * `TOKEN_DOORS`, both directions). L4: each handler parses, asks the door or
 * the driver, and replies; neither decides.
 *
 * `POST /api/token/claim` is EXEMPT from the session gate (reason 7, `gate.ts`):
 * it authenticates by a single-use code the server issued itself over the agent
 * link. Its route `bodyLimit` is 1 KiB, because the server's default 1 MiB would
 * let a handler-side check come too late. `Cache-Control: no-store` is set in
 * `onRequest`, so it rides every answer, Fastify's own 413, 415 and JSON-parse 400
 * included. The route `errorHandler` reshapes them into the same small body and
 * charges each to the door's miss budget (spec 4.6), so none escapes the count,
 * the 429 or the log.
 * Every refusal has that one body shape and none says whether a rotation is
 * under way; with no driver the door answers `no-claim` for the same reason.
 *
 * `POST /api/token/rotate` is session-only (NOT EXEMPT): the console's "Rotate
 * now". It answers the driver's `RotateAnswer` verbatim: 200 started or joined,
 * 409 held, 429 rate-limited (with `Retry-After`), 501 when no driver runs.
 */
export function registerTokenRoutes(app: FastifyInstance, deps: Pick<Deps, 'tokenDriver'>): void {
  app.post('/api/token/claim', {
    bodyLimit: CLAIM_BODY_LIMIT_BYTES,
    onRequest: async (_req, reply) => { reply.header('cache-control', NO_STORE); },
    errorHandler: (err, _req, reply) => {
      const status = (err as { statusCode?: number }).statusCode;
      if (status !== undefined && status >= 400 && status < 500) {
        // A body Fastify refused before the handler (a parse 400, a 415, a 413) is a malformed claim: it is charged to
        // the miss budget and logged like the door's other misses, exactly as a malformed body the handler sees (spec 4.6).
        // Past the budget it is a 429, as every other miss is. With no driver there is no door to charge.
        const step = deps.tokenDriver?.door.claimNow(null, Date.now());
        if (step !== undefined && step.status === 429) return refuse(reply, 429, 'rate-limited');
        return refuse(reply, status === 413 ? 413 : 400, 'bad-request');
      }
      console.warn('ccrc-server: box token: the claim door failed unexpectedly; answered 503');
      return refuse(reply, 503, 'unavailable');
    },
  }, async (req, reply) => {
    const driver = deps.tokenDriver;
    if (!driver) return refuse(reply, 404, 'no-claim');
    const now = Date.now();
    const step = driver.door.claimNow(req.body, now);
    if (step.status !== 200) return refuse(reply, step.status, step.error);
    try {
      await driver.commitHandOut(step.generation, now);
    } catch {
      console.warn(`ccrc-server: box token: the hand-out of generation ${step.generation} could not be ` +
        'recorded; answered 503 and the generation is discarded');
      return refuse(reply, 503, 'unavailable');
    }
    return reply.code(200).send({ ok: true, value: step.value, generation: step.generation });
  });

  app.post('/api/token/rotate', async (_req, reply) => {
    const driver = deps.tokenDriver;
    if (!driver) return reply.code(501).send({ ok: false, error: 'not-configured' } satisfies RotateAnswer);
    const answer = await driver.rotateNow(Date.now());
    if (answer.ok) return reply.code(200).send(answer);
    if (answer.error === 'held') return reply.code(409).send(answer);
    if (answer.error === 'rate-limited') {
      return reply.code(429).header('retry-after', String(answer.retryAfterS)).send(answer);
    }
    return reply.code(501).send(answer);
  });
}
