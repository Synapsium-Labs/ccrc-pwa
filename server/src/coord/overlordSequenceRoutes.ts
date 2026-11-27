// The Overlord's cursor read of the sequence (Overlord W1, sequence C; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-sequence-monitor.md` Task 7, questions 7, 13 and 18; spec §10.4 "One sequence", "No stream of its own", Table 11.1e). Ring
// L4, context C5: `GET /api/overlord/sequence?byId&byUuid&after&limit`, one box-token machine lane behind the Overlord gate. The
// file is its own, beside the inbox's and the history's, because `overlordRoutes.ts` registers only the operator's session-gated
// doors (`box-token-census.test.ts` pins that; slug `sequence-door-in-its-own-routes-file`).
//
// THE FORM (`overlord-gate-census.test.ts`): `onRequest` checks the box token and nothing else; the handler parses the caller's
// pair, asks the ONE gate with its own row's key and returns on `refused`. The cursor is read only after the gate, so a caller that
// is not the Overlord learns nothing about the query's grammar, and a bad cursor or limit answers 400 `bad-request` with no read
// and no ledger line. Then the one read runner counts the ceiling, records the line (door `sequence`, scope `after=<n>`, the lines
// served or the arm's word) and answers; a line that could not be written refuses the read.
//
// The row is not fenced (`write: false`, the plan's table), so it says `unfenced` to the runner and its ceiling counts every
// attributed served line (question 18). It decides nothing: the query is `readSequenceQuery`, the restore generation's word
// `restoreGenerationOf` and every answer, status and line word `sequenceDoorAnswer` (all L1, `overlordSequenceDoor.ts`).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import type { SequenceWireLine } from '../../../shared/overlord-sequence.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import type { overlordGateRun } from './overlordGateRun.js';
import { TOKEN_DETAIL, callerOf, overlordRow } from './overlordInboxRoutes.js';
import type { ReadComposed, runOverlordRead } from './overlordRead.js';
import type { SequenceFacts } from './overlordSequence.js';
import { readSequenceQuery, restoreGenerationOf, sequenceDoorAnswer } from './overlordSequenceDoor.js';
import type { SequenceRead } from './overlordSequenceStore.js';

export interface OverlordSequenceRoutesDeps {
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  readonly mailToken: () => string | BoxTokenHolder | null;
  /** The Overlord gate's runner (`overlordGateRun`, built once in `server.ts`). */
  readonly gate: ReturnType<typeof overlordGateRun>;
  /** The one read runner (`runOverlordRead`, built once in `server.ts`). */
  readonly readRunner: ReturnType<typeof runOverlordRead>;
  /** The sequence store's one cursor read (`sequenceAfter` over `coord.db`): the facts and at most `limit` lines above `after`. */
  readonly sequence: (after: number, limit: number) => SequenceRead<{ readonly facts: SequenceFacts; readonly lines: readonly SequenceWireLine[] }>;
  /** The restore counter's one reader (`OverlordRestoreState.restoreGeneration`); a throw reads `unmeasured`, never zero. */
  readonly restoreGeneration: () => { readonly kind: 'measured'; readonly n: number } | { readonly kind: 'unmeasured' };
}

export function registerOverlordSequenceRoutes(app: FastifyInstance, deps: OverlordSequenceRoutesDeps): void {
  /**
   * `GET /api/overlord/sequence?byId&byUuid[&after][&limit]` (Table 11.1e): the token, the pair's shape, THE GATE, then the
   * cursor through its one reader, then the read runner: one read of the facts and the lines, the restore counter's word, the
   * answer. A page, `gap`, `ahead` or 503 `unavailable`, each with its line; never an empty page for a gap.
   */
  app.get('/api/overlord/sequence', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/overlord/sequence');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = callerOf(req.query);
    if (!c.ok) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const g = await deps.gate(req, reply, 'sequence', { sessionId: c.id, uuid: c.uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    // `others: 'refuse'` on the row: the gate never serves this door in the hook's group (answered as the inbox answers it).
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    const q = readSequenceQuery(req.query);
    if (!q.ok) return refuseRoute(reply, 'bad-request', { detail: q.detail });
    return deps.readRunner(req, reply, {
      door: 'sequence', pass: g, row: overlordRow('sequence'), unfenced: true,
      compose: (): ReadComposed => {
        let restore: ReturnType<OverlordSequenceRoutesDeps['restoreGeneration']>;
        try { restore = deps.restoreGeneration(); } catch { restore = { kind: 'unmeasured' }; }
        const a = sequenceDoorAnswer(deps.sequence(q.after, q.limit), q, restoreGenerationOf(restore));
        if (a.kind === 'rows') return { kind: 'rows', body: a.body, scope: a.scope, count: a.count };
        if (a.kind === 'answer') return { kind: 'answer', body: a.body, scope: a.scope, outcome: a.outcome };
        return { kind: 'refuse', word: a.word, detail: a.detail, scope: a.scope, outcome: a.outcome };
      },
    });
  });
}
