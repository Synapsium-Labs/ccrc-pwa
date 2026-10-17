import type { FastifyReply } from 'fastify';
import { REFUSAL_STATUS, type RouteRefusal } from '../../shared/refusal.js';

/**
 * The thin route refusal (D-5381, audit ticket ARCH-11a): `{ ok: false, error,
 * ...extra }` at the one status `REFUSAL_STATUS` gives the word, so a route
 * names WHAT it refuses and never the status. For the route files with no
 * typed helper of their own (`server.ts`, `coord/routes.ts` outside the mail
 * ingress); the mail ingress keeps its own `refuse`, which records the
 * rejection first. L4: it owns the reply and decides nothing.
 *
 * `extra` is spread AFTER `error`, the key order every inline send wrote, and
 * may not carry `ok` or `error`. A new refusal answers through this (or a
 * file's typed helper); `refusal-status.test.ts` ratchets the inline sends.
 */
export const refuseRoute = (
  reply: FastifyReply, error: RouteRefusal,
  extra: Readonly<Record<string, unknown>> & { ok?: never; error?: never } = {},
): FastifyReply => reply.code(REFUSAL_STATUS[error]).send({ ok: false, error, ...extra });
