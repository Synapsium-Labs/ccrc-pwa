import type { FastifyReply } from 'fastify';
import type { AdvanceRefusal } from './coord/advance.js';
import { ADVANCE_REJECT_STATUS, REFUSAL_STATUS, RUN_REFUSAL_STATUS, type OpenRunConflict, type RouteRefusal } from '../../shared/refusal.js';

/**
 * The thin route refusal (D-5381, audit ticket #547, ARCH-11a): `{ ok: false, error,
 * ...extra }` at the one status `REFUSAL_STATUS` gives the word, so a route
 * names WHAT it refuses and never the status. For the route files with no
 * typed helper of their own (`server.ts`, `coord/routes.ts` outside the mail
 * ingress and the collect-lane door); the mail ingress keeps its own `refuse`,
 * which records the rejection first, and the collect-lane door its
 * `collectRefuse`. L4: it owns the reply and decides nothing.
 *
 * `extra` is spread AFTER `error`, the key order every inline send wrote, and
 * may not carry `ok` or `error`. A new refusal answers through this (or a
 * file's typed helper); `refusal-status.test.ts` ratchets the inline sends.
 */
export const refuseRoute = (
  reply: FastifyReply, error: RouteRefusal,
  extra: Readonly<Record<string, unknown>> & { ok?: never; error?: never } = {},
): FastifyReply => reply.code(REFUSAL_STATUS[error]).send({ ok: false, error, ...extra });

/**
 * `refuseRoute`'s sibling for the open route's `refused` words (D-5384, audit
 * ticket ARCH-21): `{ ok: false, refused, ...extra }` at the one status
 * `RUN_REFUSAL_STATUS` gives the code — the key order the inline sends wrote.
 * `extra` may not carry `ok` or `refused`. L4: it owns the reply and decides
 * nothing; `coord/openRun.ts` decides.
 */
export const refuseRun = (
  reply: FastifyReply, refused: OpenRunConflict,
  extra: Readonly<Record<string, unknown>> & { ok?: never; refused?: never } = {},
): FastifyReply => reply.code(RUN_REFUSAL_STATUS[refused]).send({ ok: false, refused, ...extra });

/**
 * The advance route's refusals (D-6733, audit ticket ARCH-33): one answer per
 * `coord/advance.ts` `AdvanceRefusal`. An `error` word goes through `refuseRoute`, with `detail` only where the
 * decider carried one (the bare shape refusal has none); a `reject` is `{ ok: false, reject: { code, ... } }` at
 * the one status `ADVANCE_REJECT_STATUS` gives its code — the wire the inline sends wrote. L4: it owns the reply
 * and decides nothing.
 */
export const refuseAdvance = (reply: FastifyReply, r: AdvanceRefusal): FastifyReply =>
  'reject' in r ? reply.code(ADVANCE_REJECT_STATUS[r.reject.code]).send({ ok: false, reject: r.reject })
    : refuseRoute(reply, r.error, 'detail' in r ? { detail: r.detail } : {});
