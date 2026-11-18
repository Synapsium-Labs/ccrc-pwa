// The replay quiz's record path (Overlord W1a; plan `2026-11-17-overlord-quiz-record.md` §5, Tasks 8 and 9; spec §3.3.9 C52,
// §12 M13). L4, context C3: the two doors own the reply and decide nothing; the deciders are `quiz.ts`'s
// (`quizRecordVerdict`, `quizRuleVerdict`), the writers `quizStore.ts`'s (`insertQuizRun`, `ruleQuizRun`). Registered from
// `server.ts` beside `registerContinuityRoutes`; a lane source of its own for `box-token-census.test.ts` and
// `auth-gate.test.ts`'s `ROUTES`.
//
// `POST /api/continuity/quiz-runs` is the operator's record from the fleet box (`ccd/ccrc-quiz-record`, run by hand in their
// own shell, which refuses inside a session and a pane). A box-token lane, an `auth/gate.ts` EXEMPT entry: the token in its
// own `onRequest`, as `continuity/routes.ts`'s lanes take it. Its caller has no session, so it takes no attribution: it stores
// the verb's `recordedBy` trace (slug recorded-by-is-a-verb-trace). It measures the sha over the report's UTF-8 bytes itself
// (slug the-door-checks-the-sha), hands the text to the decider and records what it maps as `pending`. A session holding the
// box token could post a pending run; only the operator's confirmation, behind a session and a step-up, makes it count.
//
// `POST /api/continuity/quiz-runs/:id/rule` is that confirmation (F3): session-gated (no box token, no EXEMPT entry) and
// behind the account gate's step-up (`AccountGate`, as `PUT /api/items/:id/secret` is), so it refuses while sign-in is dark,
// from a plain-HTTP origin and without a recent step-up. No session can confirm a run.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AccountGate } from '../accounts/gate.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { isQuizRuleAction, quizRecordVerdict } from './quiz.js';
import { insertQuizRun, quizPendingCount, ruleQuizRun } from './quizStore.js';

/** The record door's body cap (review 2442 F7): the verb refuses a report over 64 KiB, and `jq` writes each byte of it as at
 *  most six characters (`\u00XX`), so six times that plus room for the sha, the trace and the keys always fits. */
export const QUIZ_RECORD_BODY_LIMIT = 6 * 64 * 1024 + 4096;
/** The verb's trace (`quiz-record <user> <role> <ISO time>`): one line of at most this many characters. */
const RECORDED_BY_MAX = 200;
const RUN_ID_RE = /^[1-9][0-9]{0,15}$/;

export interface QuizRouteDeps {
  /** The coordination store, or undefined on a server without one: both doors answer `not-configured`. */
  coord: CoordStore | undefined;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken: () => string | BoxTokenHolder | null;
  /** The server's wall clock: the record's `recordedAt`, the freshness bound's `now` and the ruling's `ruledAt`. */
  wall: () => number;
  /** The account gate: the rule door asks it for a step-up (`{ cap: null, stepUp: true }`). */
  gate: AccountGate;
}

const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

export function registerQuizRoutes(app: FastifyInstance, deps: QuizRouteDeps): void {
  const notConfigured = (reply: FastifyReply) => refuseRoute(reply, 'not-configured', { detail: 'this server has no coordination store' });

  /** `POST /api/continuity/quiz-runs { report, sha256, recordedBy }`: the token first, then the body's shape (`bad-request`
   *  naming the field), then the decider over the text and the sha the door measured (`bad-request` naming its field), then
   *  the one inserter (`write-failed`). `200 { ok, id, fresh, state }`; a resend of a recorded report is `fresh: false` with
   *  the first row's state. */
  app.post('/api/continuity/quiz-runs', {
    bodyLimit: QUIZ_RECORD_BODY_LIMIT,
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/continuity/quiz-runs');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const b = (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? req.body : null) as Record<string, unknown> | null;
    if (b === null) return refuseRoute(reply, 'bad-request', { field: '(body)', detail: 'the body is { report, sha256, recordedBy }' });
    const { report, sha256, recordedBy } = b;
    if (typeof report !== 'string') return refuseRoute(reply, 'bad-request', { field: 'report', detail: 'report is the report file\'s text' });
    if (typeof recordedBy !== 'string' || recordedBy.length === 0 || recordedBy.length > RECORDED_BY_MAX || /[\r\n]/.test(recordedBy)) {
      return refuseRoute(reply, 'bad-request', { field: 'recordedBy', detail: `recordedBy is one line of at most ${RECORDED_BY_MAX} characters` });
    }
    if (deps.coord === undefined) return notConfigured(reply);
    const now = deps.wall();
    const measuredSha = createHash('sha256').update(report, 'utf8').digest('hex');
    // The count, the verdict and the insert run with no await between them, so no other record lands in between.
    let pending: number;
    try { pending = quizPendingCount(deps.coord.db, measuredSha); } catch {
      return refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be read' });
    }
    const v = quizRecordVerdict({ text: report, claimedSha: sha256, measuredSha, now, pending });
    if (!v.ok) return refuseRoute(reply, v.word ?? 'bad-request', { field: v.field, detail: v.detail });
    const r = insertQuizRun(deps.coord.db, { report: v.report, extra: v.extra, recordedBy, recordedAt: now });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be written' });
    return reply.code(200).send({ ok: true, id: r.id, fresh: r.fresh, state: r.state });
  });

  /** `POST /api/continuity/quiz-runs/:id/rule { action: 'confirm' | 'discard' }`: the account gate with a step-up first,
   *  then the body, then the one ruler (`bad-request` for an unknown id or a run that is not pending, `write-failed`).
   *  `200 { ok, id, state, baseline }`. */
  app.post('/api/continuity/quiz-runs/:id/rule', async (req, reply) => {
    const g = deps.gate(req, reply, { cap: null, stepUp: true });
    if (!g.pass) return reply;
    const { id } = req.params as { id: string };
    if (!RUN_ID_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'the run id is a positive whole number' });
    const action = (req.body as { action?: unknown } | null | undefined)?.action;
    if (!isQuizRuleAction(action)) return refuseRoute(reply, 'bad-request', { detail: 'the body is { action: \'confirm\' | \'discard\' }' });
    const coord = deps.coord;
    if (coord === undefined) return notConfigured(reply);
    const r = ruleQuizRun(coord.db, { id: Number(id), action, at: deps.wall(), by: String(g.actor) }, (lane) => coord.laneArmSetting(lane));
    if (!r.ok) {
      return r.kind === 'bad-request'
        ? refuseRoute(reply, 'bad-request', { detail: r.detail })
        : refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be written' });
    }
    return reply.code(200).send({ ok: true, id: r.id, state: r.state, baseline: r.baseline });
  });
}
