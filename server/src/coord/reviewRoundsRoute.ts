// The coordinator's review-cap door (D-8125): `POST /api/runs/:id/review-rounds`. L4 delivery, context Coordination: it
// parses a request, checks who is asking, asks the store, and answers; the decisions are elsewhere (`coordLiftReason` and
// `coordLiftVerdict` in `reviewcap.ts`, `claimsProgramme` for ownership).
//
// The box token authenticates the box; `{byId, byUuid}` is attribution re-measured against the registry
// (`requireAttribution`), which is freshness, not forgery-proofness, like every coordinator lane. The ccrc-api client closes
// the cheap forgery: it fills the pair from the calling pane and refuses a body that names either, so another pane cannot
// type its coordinator's pair through the client. D-8125 open item for the operator: a caller that bypasses the client
// (raw HTTP with the box token and a read of the registry) is still attribution, not proof; a credential only the session
// holds would close it. The bound on a misuse is the grant itself (REVIEW_ROUND_CAP rounds per lift, journaled, noticed,
// switchable off). Ownership is decided from
// the server's own rows: the run's `claimedBy`, or an open claim on its programme. A worker is neither.
//
// THE ORDER (a cheaper refusal is never reached after an expensive one): not configured; the box token; the body's shape
// and the reason; attribution; the run's read; ownership; the lift under `coordMutex`; the notice; the answer. A refusal at
// any step writes nothing and emits nothing. The route writes no `operator_items` row: the cap's ask is `review_cap`'s
// `askHandledAt`, closed in the store's transaction.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NoticeSink } from '../notice.js';
import { refuseRoute } from '../refuse.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import { parseCanonicalPositiveSafeInteger, type ReviewRoundsLiftAnswer } from '../../../shared/api.js';
import type { CoordStore } from './store.js';
import { coordLiftNotice, coordLiftReason } from './reviewcap.js';

/** What the door needs: the gates `registerCoordRoutes` already holds, handed in so every lane is one implementation. */
export interface ReviewRoundsRouteDeps {
  coord: CoordStore | undefined;
  requireMailToken: (req: FastifyRequest, reply: FastifyReply, route: string) => boolean;
  requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  coordMutex: { run<T>(fn: () => Promise<T>): Promise<T> };
  notice: NoticeSink;
  /** `CCRC_REVIEW_CAP_COORD_LIFT` as the server read it at start. */
  setting: 'on' | 'off';
  now?: () => number;
}

const ROUTE = 'POST /api/runs/:id/review-rounds';
const SETTING_OFF = 'coordinator lifts are off on this box (CCRC_REVIEW_CAP_COORD_LIFT=off); the operator lifts the cap';

export function registerReviewRoundsRoute(app: FastifyInstance, deps: ReviewRoundsRouteDeps): void {
  const now = deps.now ?? Date.now;
  app.post('/api/runs/:id/review-rounds', async (req, reply) => {
    if (!deps.coord) return refuseRoute(reply, 'not-configured');
    if (!deps.requireMailToken(req, reply, ROUTE)) return;
    const coord = deps.coord;
    const id = parseCanonicalPositiveSafeInteger((req.params as { id: string }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'id must be a positive work run id' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { byId, byUuid } = body;
    if (typeof byId !== 'string' || byId === '' || typeof byUuid !== 'string' || byUuid === '') {
      return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid must be non-empty strings' });
    }
    const why = coordLiftReason(body.reason);
    if (!why.ok) return refuseRoute(reply, 'bad-request', { detail: why.detail });
    if (!(await deps.requireAttribution(reply, byId, byUuid, 'byUuid'))) return;

    const read = coord.run(id);
    if (!read.ok) return refuseRoute(reply, 'run-unreadable', { detail: read.detail });
    if (read.run === null) return refuseRoute(reply, 'not-found', { detail: `run ${id} not found` });
    const { claimedBy, program } = read.run;
    let owns = claimedBy === byId;
    if (!owns) {
      try { owns = coord.claimsProgramme(byId, program); }
      catch (err) { return refuseRoute(reply, 'run-unreadable', { detail: err instanceof Error ? err.message : String(err) }); }
    }
    if (!owns) {
      return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${byId} holds no open run of programme ${program}` });
    }

    const at = now();
    const lifted = await deps.coordMutex.run(async () =>
      coord.liftReviewCapByCoordinator({ workRunId: id, byId, reason: why.reason, setting: deps.setting, now: at }));
    if (!lifted.ok) {
      return refuseRoute(reply, lifted.refused, { detail: lifted.refused === 'coord-lift-off' ? SETTING_OFF : lifted.detail });
    }
    const n = coordLiftNotice(id, byId, why.reason, lifted.capBefore, lifted.capAfter);
    deps.notice({ kind: 'coord', sessionId: '', runId: id, title: n.title, body: n.body }, 'record-only',
      { degraded: 'lift recorded, feed archive degraded' });
    return reply.code(200).send({
      ok: true, run: id, rounds: lifted.rounds, capBefore: lifted.capBefore, capAfter: lifted.capAfter, closedAsk: lifted.closedAskAt !== null,
    } satisfies ReviewRoundsLiftAnswer);
  });
}
