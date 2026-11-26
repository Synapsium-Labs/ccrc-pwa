// The Overlord's history door (Overlord W1, PR B1; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`
// Task 5, questions 5, 8, 10, 14 and 15; spec §3.2, C47, H3, H10). Ring L4, context C5: `POST /api/overlord/history`, one
// box-token machine lane behind the Overlord gate. A `POST` only so free text rides the body, never a URL; a read by the
// server's own class, as `POST /api/linear/proxy/search` is (ruled R7). The file is its own, beside the inbox's, because
// `overlordRoutes.ts` registers only the operator's session-gated doors (`box-token-census.test.ts` pins that; slug
// `history-door-in-its-own-routes-file`).
//
// THE FORM (`overlord-gate-census.test.ts`): `onRequest` checks the box token and nothing else; the handler parses `byId` and
// `byUuid`, asks the ONE gate with its own row's key and returns on `refused`; the request is read only after the gate, so a
// caller that is not the Overlord learns nothing about the request's grammar, and a refused request answers `bad-request`
// before any agent is asked and writes no ledger line. Then the one read runner counts the ceiling, records the line (door
// `history`, the canonical target as its scope, the outcome word, the generation and the turn state) and answers.
//
// It decides nothing: which link serves the read is `historyAgentFor` (L1), and every outcome's answer, status and line word
// is `historyDoorAnswer` (L1). The port (`FleetIO.overlordHistory`) re-checks the advertised word at the send. The answer is
// masked by the server's write-answer rule (question 14), and the agent's belt masked it first.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import { OVERLORD_HISTORY_REQUEST_MAX_BYTES, overlordTargetId, readOverlordHistoryRequest } from '../../../shared/overlordHistory.js';
import type { FleetIO } from '../io.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import type { overlordGateRun } from './overlordGateRun.js';
import { historyAgentFor, historyDoorAnswer, type HistoryLink } from './overlordHistory.js';
import { TOKEN_DETAIL, callerOf, overlordRow } from './overlordInboxRoutes.js';
import type { ReadComposed, runOverlordRead } from './overlordRead.js';

export interface OverlordHistoryRoutesDeps {
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  readonly mailToken: () => string | BoxTokenHolder | null;
  /** The Overlord gate's runner (`overlordGateRun`, built once in `server.ts`). */
  readonly gate: ReturnType<typeof overlordGateRun>;
  /** The one read runner (`runOverlordRead`, built once in `server.ts`). */
  readonly readRunner: ReturnType<typeof runOverlordRead>;
  /** Every agent link this server holds, as the choice reads it: the fleet state's one today, none on a server without one. */
  readonly links: () => readonly HistoryLink[];
  /** The port the read goes through. */
  readonly io: Pick<FleetIO, 'overlordHistory'>;
}

/** The route's byte bound: the request's own bound (`OVERLORD_HISTORY_REQUEST_MAX_BYTES`, which the reader measures on the
 *  request less the caller's pair, both as sent and as typed, as the agent measures the typed request it is sent) plus room
 *  for the pair, so one request reads alike at the door and at the agent (slug `history-door-bound-allows-the-pair`). A
 *  larger body is `oversize` 413 before anything is parsed. */
export const OVERLORD_HISTORY_BODY_LIMIT_BYTES = OVERLORD_HISTORY_REQUEST_MAX_BYTES + 512;

/** The request, as the agent will be handed it: the body less the caller's pair. Anything that is not an object is passed on
 *  as it is, for the reader to refuse. */
function requestOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const { byId: _id, byUuid: _uuid, ...request } = body as Record<string, unknown>;
  return request;
}

export function registerOverlordHistoryRoutes(app: FastifyInstance, deps: OverlordHistoryRoutesDeps): void {
  /**
   * `POST /api/overlord/history { byId, byUuid, verb, target, agents?, args? }` (Table 2): the token, the pair's shape, THE
   * GATE, then the request through its one reader, then the read runner: the choice, the port, the mapping. A request the
   * reader refuses is 400 `bad-request` with its closed word, and no agent is asked.
   */
  app.post('/api/overlord/history', {
    bodyLimit: OVERLORD_HISTORY_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    // A body past the bound is 413 `oversize`, the word that status belongs to (the credential routes' shape); any other error
    // keeps its own path.
    errorHandler: (err, _req, reply) => {
      if ((err as { statusCode?: number }).statusCode === 413) return refuseRoute(reply, 'oversize');
      return reply.send(err);
    },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/overlord/history');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    // A caller that goes away aborts the read. The listener is attached before the gate's awaits, and a caller gone by the
    // time the gate and the reader are done starts no read: no agent is asked, no line is written, no ceiling is spent
    // (review 3730 F4). The abort ends the server's wait only: no frame tells the agent, whose one slot frees when its
    // worker exits (at most its own 20 s deadline), so the next read may answer `busy` until then. An abandon frame would be
    // a wire addition, and is not this door's.
    const ac = new AbortController();
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) ac.abort(); });
    const c = callerOf(req.body);
    if (!c.ok) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const g = await deps.gate(req, reply, 'history', { sessionId: c.id, uuid: c.uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    const read = readOverlordHistoryRequest(requestOf(req.body));
    if (!read.ok) return refuseRoute(reply, 'bad-request', { refusal: read.refusal });
    const request = read.request;
    const scope = overlordTargetId(request.target);
    if (ac.signal.aborted) return refuseRoute(reply, 'unavailable', { detail: 'the caller went away before the read' });
    // From here, a caller that goes away aborts the port's wait: before the frame is sent it answers `not-started`, after it
    // `lost` (review 3749 F3), and either way its line is still written. The row is not fenced (call 1590), so the runner is
    // told `unfenced`: a read is attributed to the Overlord, not proven its own, and its ceiling counts attributed served reads.
    return deps.readRunner(req, reply, {
      door: 'history', pass: g, row: overlordRow('history'), unfenced: true,
      compose: async (): Promise<ReadComposed> => {
        const choice = historyAgentFor(deps.links());
        const a = historyDoorAnswer(choice.kind === 'agent' ? await deps.io.overlordHistory(request, ac.signal) : choice);
        if (a.kind === 'rows') return { kind: 'rows', body: a.body, scope, count: a.count };
        if (a.kind === 'answer') return { kind: 'answer', body: a.body, scope, outcome: a.outcome };
        return { kind: 'refuse', word: a.word, extra: a.extra, scope, outcome: a.outcome };
      },
    });
  });
}
