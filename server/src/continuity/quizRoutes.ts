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
// (slug the-door-checks-the-sha), hands the text to the decider and records what it maps as `pending`. A pending run counts
// once it is confirmed: by the operator on the card, behind a session and a step-up, or by the confirm door below, for a run
// recorded unattended (`unattended: true`), whose single-use confirm key only this door's answer carries (review 3232 F1a).
//
// `POST /api/continuity/quiz-runs/:id/rule` is that confirmation (F3): session-gated (no box token, no EXEMPT entry) and
// behind the account gate's step-up (`AccountGate`, as `PUT /api/items/:id/secret` is), so it refuses while sign-in is dark,
// from a plain-HTTP origin and without a recent step-up.
//
// The weekly unattended run (run 3212, the operator's ruling of 2026-11-22: the quiz runs, records and confirms itself)
// adds three box-token lanes, each an EXEMPT entry. `POST /api/continuity/quiz-runs/:id/confirm` is the operator's matching
// rule, applied by the server: `ccrc quiz-record --confirm`, run by `ccd-quiz-weekly.service`, names the run id the record
// answered, the confirm key it was answered and the sha its report printed, and the one ruler confirms the run when the key
// and the sha match and refuses, writing nothing, when either does not (`quiz.ts#quizRuleVerdict`'s `match`; review 3232
// F1a, F1b). Its `ruledBy` carries a fixed server head (`QUIZ_UNATTENDED_BY_PREFIX`, F1c). Once a confirmed baseline exists
// the programme's coordinator is mailed, keyed on the run, and again on a later tick until the mail is queued
// (`quiz.ts#quizBaselineMailOf`, F4). The verb refuses inside a session and a pane, and the session hook's quiz arm refuses
// the client's record, confirm and status rows on every session; a session that runs the runner's exact flow outside a pane
// still could (an accident guard, not a wall: the note's slug unattended-flow-outside-a-pane).
// `POST /api/continuity/quiz-status` is the runner's report of each tick (its act, outcome, word and trace), stored in one row
// the Shadow lanes card shows; a stop word mails the programme's coordinator once per week and word
// (`quiz.ts#quizStatusMailOf`), and two ISO weeks of waiting mail it once more (`quiz.ts#quizWaitingStreakOf`, F9).
// `POST /api/continuity/quiz-runs/:id/withdraw` is the operator's withdraw of a confirmed baseline (F1e): session-gated (no
// box token, no EXEMPT entry), behind the account gate without a step-up (it only narrows), so it refuses while sign-in is
// dark. Optional, never required, and it raises no item.
// `POST /api/continuity/quiz-baseline/live` is the coordinator's Live on a W1a row once the baseline exists: attributed,
// then owned (an open run of the quiz's programme), then `coord/laneArm.ts#decideLaneArmCoordLive`, then the one writer,
// `CoordStore.setLaneArm`, and a record-only feed row naming the coordinator.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AccountGate } from '../accounts/gate.js';
import { decideLaneArmCoordLive, laneArmChangeLine, laneArmRowViewOf } from '../coord/laneArm.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import type { NoticeSink } from '../notice.js';
import { refuseRoute } from '../refuse.js';
import { LANE_ARM_FEED_TITLE, LANE_ARM_TEXT, isLaneArmLane } from '../../../shared/lane-arm.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import {
  QUIZ_ITEM_PROGRAMME, QUIZ_MATCH_RULING, QUIZ_STATUS_KEYS, QUIZ_UNATTENDED_BY_PREFIX, QUIZ_WITHDRAW_RULING, isQuizRuleAction, isQuizTrace,
  quizBaselineMailOf, quizRecordVerdict, quizStatusMailOf, quizStatusOf, quizWaitingStreakOf,
} from './quiz.js';
import {
  insertQuizRun, markQuizBaselineWoken, quizBaselineRead, quizBaselineWakeRead, quizConfirmKeyHash, quizPendingCount, quizReportRecorded,
  quizStatusRead, ruleQuizRun, writeQuizStatus,
} from './quizStore.js';

/** The record door's body cap (review 2442 F7): the verb refuses a report over 64 KiB, and `jq` writes each byte of it as at
 *  most six characters (`\u00XX`), so six times that plus room for the sha, the trace and the keys always fits. */
export const QUIZ_RECORD_BODY_LIMIT = 6 * 64 * 1024 + 4096;
/** The verb's trace (`quiz-record <user> <role> <ISO time>`): one line of at most this many characters. */
const RECORDED_BY_MAX = 200;
const RUN_ID_RE = /^[1-9][0-9]{0,15}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const IDENTITY_RE = /^[A-Za-z0-9._-]{1,200}$/;

export interface QuizRouteDeps {
  /** The coordination store, or undefined on a server without one: both doors answer `not-configured`. */
  coord: CoordStore | undefined;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken: () => string | BoxTokenHolder | null;
  /** The server's wall clock: the record's `recordedAt`, the freshness bound's `now` and the ruling's `ruledAt`. */
  wall: () => number;
  /** The account gate: the rule door asks it for a step-up (`{ cap: null, stepUp: true }`). */
  gate: AccountGate;
  /** The Live door's sender check (`attributionVerdict` over the registry, on `fromUuid`). */
  attribute: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The baseline's wake and the status door's mail: queue one system mail (`rundefsTx.ts#queueSystemMail`); false when it was
   *  not queued. */
  mail: (m: { toId: string; subject: string; body: string }) => boolean;
  /** The Live door's feed row. */
  notice: NoticeSink;
}

const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

export function registerQuizRoutes(app: FastifyInstance, deps: QuizRouteDeps): void {
  const notConfigured = (reply: FastifyReply) => refuseRoute(reply, 'not-configured', { detail: 'this server has no coordination store' });

  /** The baseline's wake (review 3232 F4), asked by the confirm door and by every status tick: `quizBaselineMailOf` decides,
   *  this queues and marks the run woken only once the mail was queued, so a lost wake (a throw, no one to tell) is retried. */
  const wakeBaseline = (coord: CoordStore): void => {
    const read = quizBaselineWakeRead(coord.db);
    if (!read.ok) { console.warn(`ccrc-server: the quiz baseline's wake could not be read: ${read.detail}`); return; }
    const d = coord.designationRead();
    const wake = quizBaselineMailOf({ baseline: read.row, coordinator: coord.programmeCoordinator(QUIZ_ITEM_PROGRAMME),
      designated: d.kind === 'designated' ? d.sessionId : null });
    if (wake === null || read.row === null) return;
    let queued = false;
    try { queued = deps.mail(wake); } catch (e) { console.warn(`ccrc-server: quiz run ${read.row.id}'s wake threw: ${e instanceof Error ? e.message : String(e)}`); }
    if (!queued) { console.warn(`ccrc-server: quiz run ${read.row.id} is the baseline, but its mail to ${wake.toId} was not queued; retried next tick`); return; }
    if (!markQuizBaselineWoken(coord.db, read.row.id, deps.wall())) console.warn(`ccrc-server: quiz run ${read.row.id}'s wake was queued but not marked`);
  };

  /** `POST /api/continuity/quiz-runs { report, sha256, recordedBy, unattended? }`: the token first, then the body's shape
   *  (`bad-request` naming the field), then the decider over the text and the sha the door measured (`bad-request` naming its
   *  field), then the one inserter (`write-failed`). `200 { ok, id, fresh, state, confirmKey? }`; a resend of a recorded report
   *  is `fresh: false` with the first row's state. `unattended: true` (the weekly run's record, review 3232 F1a) mints a
   *  single-use confirm key, stored as its hash and answered once as `confirmKey`, for a fresh run or a pending one recorded
   *  unattended; the confirm door takes nothing else. */
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
    const { report, sha256, recordedBy, unattended } = b;
    if (typeof report !== 'string') return refuseRoute(reply, 'bad-request', { field: 'report', detail: 'report is the report file\'s text' });
    if (unattended !== undefined && unattended !== true) return refuseRoute(reply, 'bad-request', { field: 'unattended', detail: 'unattended is true or absent' });
    if (typeof recordedBy !== 'string' || recordedBy.length === 0 || recordedBy.length > RECORDED_BY_MAX || /[\r\n]/.test(recordedBy)) {
      return refuseRoute(reply, 'bad-request', { field: 'recordedBy', detail: `recordedBy is one line of at most ${RECORDED_BY_MAX} characters` });
    }
    if (deps.coord === undefined) return notConfigured(reply);
    const now = deps.wall();
    const measuredSha = createHash('sha256').update(report, 'utf8').digest('hex');
    // The reads, the verdict and the insert run with no await between them, so no other record lands in between.
    let pending: number;
    let recorded: boolean;
    try { pending = quizPendingCount(deps.coord.db); recorded = quizReportRecorded(deps.coord.db, measuredSha); } catch {
      return refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be read' });
    }
    const v = quizRecordVerdict({ text: report, claimedSha: sha256, measuredSha, now, pending, recorded });
    if (!v.ok) return refuseRoute(reply, v.word ?? 'bad-request', { field: v.field, detail: v.detail });
    const key = unattended === true ? randomBytes(32).toString('hex') : null;
    const r = insertQuizRun(deps.coord.db, { report: v.report, extra: v.extra, recordedBy, recordedAt: now,
      ...(key === null ? {} : { confirmKeyHash: quizConfirmKeyHash(key) }) });
    if (!r.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be written' });
    return reply.code(200).send({ ok: true, id: r.id, fresh: r.fresh, state: r.state, ...(r.keyed && key !== null ? { confirmKey: key } : {}) });
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

  /** `POST /api/continuity/quiz-runs/:id/confirm { sha256, by, confirmKey? }` (run 3212): the token first, then the id and the
   *  body, then the one ruler with the `match` ruling (`bad-request` for an unknown id, a pending run whose key or sha does not
   *  match, or a run already ruled under another sha; `write-failed`), then the baseline's wake. `ruledBy` is the trace under
   *  `QUIZ_UNATTENDED_BY_PREFIX`. `200 { ok, id, state, baseline, changed }`. */
  app.post('/api/continuity/quiz-runs/:id/confirm', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/continuity/quiz-runs/:id/confirm');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!RUN_ID_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'the run id is a positive whole number' });
    const b = (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? req.body : null) as Record<string, unknown> | null;
    if (b === null || typeof b['sha256'] !== 'string' || !SHA_RE.test(b['sha256'])) {
      return refuseRoute(reply, 'bad-request', { field: 'sha256', detail: 'sha256 is the report\'s sha, 64 lower-case hex' });
    }
    if (!isQuizTrace(b['by'])) return refuseRoute(reply, 'bad-request', { field: 'by', detail: `by is one line of at most ${RECORDED_BY_MAX} characters` });
    const confirmKey = b['confirmKey'];
    if (confirmKey !== undefined && (typeof confirmKey !== 'string' || !SHA_RE.test(confirmKey))) {
      return refuseRoute(reply, 'bad-request', { field: 'confirmKey', detail: 'confirmKey is the record\'s answer, 64 lower-case hex' });
    }
    const coord = deps.coord;
    if (coord === undefined) return notConfigured(reply);
    const r = ruleQuizRun(coord.db, { id: Number(id), action: QUIZ_MATCH_RULING, at: deps.wall(), by: `${QUIZ_UNATTENDED_BY_PREFIX}${b['by']}`,
      sha: b['sha256'], ...(confirmKey === undefined ? {} : { key: confirmKey }) }, (lane) => coord.laneArmSetting(lane));
    if (!r.ok) {
      return r.kind === 'bad-request'
        ? refuseRoute(reply, 'bad-request', { detail: r.detail })
        : refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be written' });
    }
    wakeBaseline(coord);
    return reply.code(200).send({ ok: true, id: r.id, state: r.state, baseline: r.baseline, changed: r.changed });
  });

  /** `POST /api/continuity/quiz-runs/:id/withdraw` (review 3232 F1e): the account gate without a step-up first (a withdraw only
   *  narrows), then the id, then the one ruler with the `withdraw` ruling (`bad-request` for an unknown id or a run that is not
   *  the confirmed baseline; `write-failed`). `200 { ok, id, state, baseline }`. */
  app.post('/api/continuity/quiz-runs/:id/withdraw', async (req, reply) => {
    const g = deps.gate(req, reply, { cap: null });
    if (!g.pass) return reply;
    const { id } = req.params as { id: string };
    if (!RUN_ID_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'the run id is a positive whole number' });
    const coord = deps.coord;
    if (coord === undefined) return notConfigured(reply);
    const r = ruleQuizRun(coord.db, { id: Number(id), action: QUIZ_WITHDRAW_RULING, at: deps.wall(), by: String(g.actor) }, (lane) => coord.laneArmSetting(lane));
    if (!r.ok) {
      return r.kind === 'bad-request'
        ? refuseRoute(reply, 'bad-request', { detail: r.detail })
        : refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_runs could not be written' });
    }
    return reply.code(200).send({ ok: true, id: r.id, state: r.state, baseline: r.baseline });
  });

  /** `POST /api/continuity/quiz-status { week, act, outcome, word, detail, account, at, by }` (run 3212): the token first, then
   *  the body (`bad-request` naming the field; `by` is the runner's trace), then the stored row, the stop mail when
   *  `quizStatusMailOf` answers one, the waiting streak's mail when `quizWaitingStreakOf` answers one, the one writer
   *  (`write-failed`), and the baseline's wake. A mail that was not queued keeps the old key, so the next tick mails again.
   *  `200 { ok, mailed }`, `mailed` true when any mail was queued. */
  app.post('/api/continuity/quiz-status', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/continuity/quiz-status');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const parsed = quizStatusOf(req.body);
    if (!parsed.ok) return refuseRoute(reply, 'bad-request', { field: parsed.field, detail: `the body is {${QUIZ_STATUS_KEYS.join(', ')}}` });
    const coord = deps.coord;
    if (coord === undefined) return notConfigured(reply);
    const before = quizStatusRead(coord.db);
    if (!before.ok) return refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_status could not be read' });
    const coordinator = coord.programmeCoordinator(QUIZ_ITEM_PROGRAMME);
    const decided = quizStatusMailOf({ status: parsed.status, mailedKey: before.row?.mailedKey ?? null, coordinator });
    const mailed = decided.mail !== null && deps.mail(decided.mail);
    const key = decided.mail === null || mailed ? decided.key : (before.row?.mailedKey ?? null);
    const streak = quizWaitingStreakOf({ status: parsed.status, waitingSince: before.row?.waitingSince ?? null,
      goneMailedKey: before.row?.goneMailedKey ?? null, coordinator });
    const goneMailed = streak.mail !== null && deps.mail(streak.mail);
    const goneKey = streak.mail === null || goneMailed ? streak.goneKey : (before.row?.goneMailedKey ?? null);
    if (!writeQuizStatus(coord.db, parsed.status, parsed.by, deps.wall(), { mailedKey: key, waitingSince: streak.waitingSince, goneMailedKey: goneKey })) {
      return refuseRoute(reply, 'write-failed', { detail: 'continuity_quiz_status could not be written' });
    }
    wakeBaseline(coord);
    return reply.code(200).send({ ok: true, mailed: mailed || goneMailed });
  });

  /** `POST /api/continuity/quiz-baseline/live { fromId, fromUuid, lane }` (run 3212): the token first, then the body, then the
   *  sender's attribution, then ownership (an open run of the quiz's programme: a throw is 503 `run-unreadable`, else 403
   *  `not-your-programme`), then `decideLaneArmCoordLive` (400 `bad-request` off the W1a rows, 409 `lane-gated`, 503
   *  `state-unreadable`, 409 `baseline-missing`), then the one write and a record-only feed row on a change.
   *  `200 { ok, lane, stored, live }`. */
  app.post('/api/continuity/quiz-baseline/live', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/continuity/quiz-baseline/live');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const b = (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? req.body : null) as Record<string, unknown> | null;
    const fromId = b?.['fromId'];
    const fromUuid = b?.['fromUuid'];
    const lane = b?.['lane'];
    if (b === null || Object.keys(b).some((k) => k !== 'fromId' && k !== 'fromUuid' && k !== 'lane')
      || typeof fromId !== 'string' || !IDENTITY_RE.test(fromId) || typeof fromUuid !== 'string' || !IDENTITY_RE.test(fromUuid) || !isLaneArmLane(lane)) {
      return refuseRoute(reply, 'bad-request', { detail: 'the body is {fromId, fromUuid, lane} and nothing else' });
    }
    const coord = deps.coord;
    if (coord === undefined) return notConfigured(reply);
    const attributed = await deps.attribute(fromId, fromUuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    try {
      if (!coord.claimsProgramme(fromId, QUIZ_ITEM_PROGRAMME)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${fromId} holds no open run of programme ${QUIZ_ITEM_PROGRAMME}` });
      }
    } catch (e) {
      return refuseRoute(reply, 'run-unreadable', { detail: e instanceof Error ? e.message : String(e) });
    }
    const before = laneArmRowViewOf(lane, coord.laneArmSetting(lane));
    const v = decideLaneArmCoordLive({ lane, row: before, baseline: quizBaselineRead(coord.db) });
    if (v.kind === 'not-w1a') return refuseRoute(reply, 'bad-request', { detail: `${lane} is not a lane the quiz's baseline gates` });
    if (v.kind === 'gated') return refuseRoute(reply, 'lane-gated', { detail: v.reason });
    if (v.kind === 'unreadable') return refuseRoute(reply, 'state-unreadable', { detail: v.detail });
    if (v.kind === 'baseline-missing') return refuseRoute(reply, 'baseline-missing', { detail: LANE_ARM_TEXT.baselineMissing });
    const after = laneArmRowViewOf(lane, coord.setLaneArm(v.lane, 'live', deps.wall()));
    const change = laneArmChangeLine(before, after, `coordinator ${fromId}`);
    if (change !== null) {
      deps.notice({ kind: 'coord', sessionId: '', title: LANE_ARM_FEED_TITLE.changed, body: change, runId: null },
        'record-only', { degraded: 'shadow lane switch written by the coordinator, feed archive degraded' });
    }
    return reply.code(200).send({ ok: true, lane, stored: after.stored, live: after.live });
  });
}
