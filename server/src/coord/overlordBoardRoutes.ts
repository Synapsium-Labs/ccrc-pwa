// The Overlord's board read (Overlord W1, PR B2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md` Task 6;
// spec §5.2 C10, C44, Table 11.1e). Ring L4, context C5: `GET /api/overlord/board?byId&byUuid`, one box-token machine lane behind
// the Overlord gate. The file is its own, beside the inbox's, the history's and the sequence's, because `overlordRoutes.ts`
// registers only the operator's session-gated doors (`box-token-census.test.ts` pins that; slug `board-door-in-its-own-routes-file`).
//
// THE FORM (`overlord-gate-census.test.ts`): `onRequest` checks the box token and nothing else; the handler parses the caller's
// pair, asks the ONE gate with its own row's key and returns on `refused`. Nothing of the board is gathered before every refusal
// has had its turn: the gather runs inside the read runner's compose, after the ceiling. The runner counts the ceiling, records
// one line (door `board`, scope `fleet`, the count of programmes) and answers; a line that could not be written refuses the read.
//
// The row is not fenced (`write: false`, call 1590, slug history-and-board-reads-attributed-not-proven), so a reader reads the board
// through the door process's read tool, the runner is told `unfenced`, and its ceiling counts every attributed served read: a read
// is attributed to the Overlord, not proven its own.
//
// It decides nothing: `gatherBoard` (L3) calls each reader once, `composeBoard` (L1) maps their answers to parts. A reader that
// fails is its part's `unmeasured`, never the board's failure, so the board's one outcome past the gates is `rows`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import type { OverlordBoardAnswer } from '../../../shared/overlordBoard.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import type { overlordGateRun } from './overlordGateRun.js';
import { TOKEN_DETAIL, callerOf, overlordRow } from './overlordInboxRoutes.js';
import type { ReadComposed, runOverlordRead } from './overlordRead.js';
import { boardProgrammeCount, composeBoard } from './overlordBoard.js';
import { gatherBoard, type BoardGatherPorts } from './overlordBoardRead.js';

export interface OverlordBoardRoutesDeps {
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  readonly mailToken: () => string | BoxTokenHolder | null;
  /** The Overlord gate's runner (`overlordGateRun`, built once in `server.ts`). */
  readonly gate: ReturnType<typeof overlordGateRun>;
  /** The one read runner (`runOverlordRead`, built once in `server.ts`). */
  readonly readRunner: ReturnType<typeof runOverlordRead>;
  /** The gatherer's readers, each called once per board read. */
  readonly board: BoardGatherPorts;
}

export function registerOverlordBoardRoutes(app: FastifyInstance, deps: OverlordBoardRoutesDeps): void {
  /**
   * `GET /api/overlord/board?byId&byUuid` (Table 11.1e): the token, the pair's shape, THE GATE, then the read runner: the
   * ceiling, then one gather and one composition, one line, the answer.
   */
  app.get('/api/overlord/board', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/overlord/board');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const c = callerOf(req.query);
    if (!c.ok) return refuseRoute(reply, 'bad-request', { detail: 'byId and byUuid' });
    const g = await deps.gate(req, reply, 'board', { sessionId: c.id, uuid: c.uuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    // `others: 'refuse'` on the row: the gate never serves this door in the hook's group (answered as the inbox answers it).
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    return deps.readRunner(req, reply, {
      door: 'board', pass: g, row: overlordRow('board'), unfenced: true,
      compose: async (): Promise<ReadComposed> => {
        const board = composeBoard(await gatherBoard(deps.board));
        const body: OverlordBoardAnswer = { ok: true, at: deps.board.now(), board };
        return { kind: 'rows', body, scope: 'fleet', count: boardProgrammeCount(board) };
      },
    });
  });
}
