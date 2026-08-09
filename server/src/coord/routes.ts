import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Deps } from '../server.js';
import type { Bus } from '../bus.js';
import { readRegistry } from '../registry.js';
import { tx } from './db.js';
import type { CoordStore } from './store.js';
import { renderEnvelope } from './envelope.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from './token.js';
import { isSendableMailKind, MAIL_BODY_MAX_BYTES, type MailRejectCode } from '../../../shared/api.js';

/**
 * The coordination routes. Registered from `buildServer` rather than declared
 * there, because `server.ts` is already the file whose whole discipline is not
 * holding a second copy of a contract, and six more routes inline would be six
 * more places the token gate has to be remembered.
 *
 * EVERY ROUTE HERE ANSWERS 501 `{ok:false,error:'not-configured'}` WITHOUT A
 * STORE, the same shape the push routes and `/api/notifications/catchup`
 * already use (`server.ts:186-215`): a box with no coordination database is
 * not broken, it simply has none.
 *
 * MAIL LIVES HERE; RUN ROUTES ARE TASK 9's, in this same file — both share the
 * token+attribution gate, and splitting it would be two copies of that gate.
 */
export function registerCoordRoutes(
  app: FastifyInstance, deps: Deps,
  // Unused by the mail routes below; kept in the signature because Task 9's
  // run routes land in this same file and share it — a signature that grows
  // per-task would be a second copy of the token+attribution gate wiring.
  _bus: Bus,
): void {
  const notConfigured = (reply: FastifyReply) => reply.code(501).send({ ok: false, error: 'not-configured' });

  /** One refusal, recorded and answered. The record is the point: spec:147-148
   *  makes a rejected message a fact about the fleet, and the operator's first
   *  question when a worker says "I told the coordinator" is whether the
   *  message ever arrived. `ctx` never carries `code`/`detail` itself — both
   *  are this function's own parameters, spread on top so a call site cannot
   *  accidentally supply a stale one. */
  const refuse = (
    reply: FastifyReply, status: number, code: MailRejectCode,
    ctx: Omit<Parameters<CoordStore['recordRejection']>[0], 'code' | 'detail'>,
    detail: string,
  ) => {
    deps.coord!.recordRejection({ ...ctx, code, detail });
    return reply.code(status).send({ ok: false, error: code, detail });
  };

  /**
   * The ingress. `spec:136-148`: box token authenticates the box; `{fromId,
   * fromUuid}` rides as attribution and is checked against the registry with
   * the hookstate gate's exact shape; rejection codes are typed and total;
   * every rejection is itself recorded.
   *
   * THE ATTRIBUTION GATE IS COPIED, NOT RE-DERIVED, from `hookstate.ts:149-150`
   * — the one identity gate already in this tree. And it carries the same
   * honesty the spec insists on: this is freshness, not forgery-proofness.
   * Every session on the box can read every `.uuid` file and could present a
   * neighbour's pair. What it catches is a STALE sender — a session that was
   * `/clear`ed or compacted since it read its own uuid, which `_sync_uuid`
   * rotates every 5s (`ccd/ccd:6425-6437`) — and an honest mistake.
   *
   * The order below IS the design: a cheaper refusal must never be reached
   * after an expensive one.
   */
  app.post('/api/mail', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;

    // 1: box token. Same shared check `/api/notify` uses, but NOT the same
    // gate: `/api/notify`'s one-deploy-generation `legacy` tolerance
    // (spec:150-155) is scoped to that route by name, because it is the one
    // route with a pre-existing deployed caller a rollout could go dark
    // under. `/api/mail` is new in this very build — there is no old caller
    // to protect, and the spec lists `unauthenticated` as a plain, total
    // rejection code for it (spec:136-148) with no tolerance carved out
    // (fix-round finding 3/5: an earlier draft of this gate read `'legacy'`
    // as pass-through here too, treating notify's rollout excuse as if it
    // transferred — it does not; see coord/token.ts's `checkMailToken`
    // docstring). `ok` is the only verdict that proceeds; `'legacy'` and
    // `'bad'` both refuse, and — unlike `/api/notify`, which has no
    // coordination store to record into — both land in `mail_rejections`
    // via `refuse()` below, so "was a tokenless POST ever accepted" is an
    // answerable question, not a silent gap.
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
    if (verdict !== 'ok') {
      const detail = verdict === 'legacy'
        ? 'no box token presented — /api/mail grants no legacy tolerance (that is /api/notify only)'
        : 'wrong box token';
      return refuse(reply, 401, 'unauthenticated', {}, detail);
    }

    // 2: body shape. fromId/fromUuid/toId/subject/body must all be strings;
    // artifacts (when given) must be an array of ABSOLUTE PATHS — spec:52-53,
    // "artifact = paths, never payloads" — and runId (when given) must be an
    // integer. All three failures are the same code: the body did not have
    // the shape this route can act on at all.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fromId = body['fromId'];
    const fromUuid = body['fromUuid'];
    const toId = body['toId'];
    const subject = body['subject'];
    const msgBody = body['body'];
    const kind = body['kind'];
    const runIdRaw = body['runId'];
    const artifactsRaw = body['artifacts'];

    if (typeof fromId !== 'string' || typeof fromUuid !== 'string' || typeof toId !== 'string' ||
        typeof subject !== 'string' || typeof msgBody !== 'string') {
      return refuse(reply, 400, 'bad-kind',
        { fromId: typeof fromId === 'string' ? fromId : undefined,
          toId: typeof toId === 'string' ? toId : undefined },
        'fromId/fromUuid/toId/subject/body must all be strings');
    }

    const artifacts = artifactsRaw === undefined ? [] : artifactsRaw;
    if (!Array.isArray(artifacts) || !artifacts.every((a) => typeof a === 'string' && path.isAbsolute(a))) {
      return refuse(reply, 400, 'bad-kind', { fromId, toId, subject },
        'artifacts must be an array of absolute paths — paths, never payloads (spec:52-53)');
    }

    let runId: number | null;
    if (runIdRaw === undefined || runIdRaw === null) {
      runId = null;
    } else if (typeof runIdRaw === 'number' && Number.isInteger(runIdRaw)) {
      runId = runIdRaw;
    } else {
      return refuse(reply, 400, 'bad-kind', { fromId, toId, subject },
        'runId must be an integer when given');
    }

    // 3: sendable kind. `isSendableMailKind` deliberately excludes `unknown` —
    // a sender cannot ask for the we-do-not-know bucket.
    if (!isSendableMailKind(kind)) {
      return refuse(reply, 400, 'bad-kind', { fromId, toId, subject, runId },
        `unrecognised or missing mail kind: ${JSON.stringify(kind)}`);
    }

    // 4: size cap, measured in UTF-8 BYTES — hookstate.ts:128-135 already had
    // to learn this distinction; a body of astral characters is twice the
    // string length in bytes.
    if (Buffer.byteLength(msgBody, 'utf8') > MAIL_BODY_MAX_BYTES) {
      return refuse(reply, 413, 'oversize', { fromId, toId, kind, subject, runId },
        `body exceeds ${MAIL_BODY_MAX_BYTES} bytes`);
    }

    const registry = await readRegistry(deps.io, deps.cfg);

    // 5: sender — a registry row must exist for fromId.
    const sender = registry.find((r) => r.id === fromId);
    if (!sender) {
      return refuse(reply, 403, 'unknown-sender', { fromId, toId, kind, subject, runId },
        `no registry row for ${fromId}`);
    }

    // 6: attribution — fromUuid === $REG/<id>.uuid, non-empty.
    if (sender.uuid === '' || sender.uuid !== fromUuid) {
      return refuse(reply, 403, 'stale-uuid', { fromId, fromUuid, toId, kind, subject, runId },
        'fromUuid does not match the registry — stale sender');
    }

    // 7: recipient shape — the literal role 'coordinator', or an existing
    // registry row. Resolving the ROLE to a concrete session id happens below,
    // after runId (check 8) is known to be real.
    if (toId !== 'coordinator' && !registry.some((r) => r.id === toId)) {
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId },
        `no registry row for ${toId}`);
    }

    // 8: runId, when given, must name a run that exists. One lookup, reused
    // below for the envelope's program/wave — a second `coord.run(runId)`
    // after this would be the same read twice for no reason.
    const run = runId !== null ? coord.run(runId) : null;
    if (runId !== null && run === null) {
      return refuse(reply, 404, 'unknown-run', { fromId, fromUuid, toId, kind, subject, runId },
        `no run ${runId}`);
    }

    // Resolving 'coordinator'. It is a ROLE, not a session id: the store
    // resolves it to the claimedBy of the run named in runId; with no runId,
    // to the claimedBy of the single active program. Ambiguous or absent →
    // unknown-recipient, recorded — no guessing: an agent-to-agent message
    // delivered to the wrong session is worse than one refused with a reason.
    const resolvedToId = toId === 'coordinator' ? coord.resolveCoordinator(runId) : toId;
    if (resolvedToId === null) {
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId },
        "the 'coordinator' role has no single claimed active program to resolve to");
    }

    // One tx: insert the mail row, render the envelope (needs the mail id),
    // insert the one resolved delivery. `renderEnvelope` runs exactly ONCE,
    // here, at queue time — spec:176-177's "verbatim, never re-rendered".
    const artifactPaths = artifacts as string[];
    const { id } = tx(coord.db, () => {
      const inserted = coord.insertMail({ fromId, fromUuid, toId, runId, kind, subject, body: msgBody,
        artifacts: artifactPaths });
      const envelope = renderEnvelope({
        id: inserted.id, fromId, toId: resolvedToId, runId,
        program: run?.program ?? null, wave: run?.wave ?? null, waveOf: run?.waveOf ?? null,
        kind, subject, body: msgBody, artifacts: artifactPaths,
      });
      coord.queueDelivery(inserted.id, resolvedToId, envelope);
      return inserted;
    });

    // 202, not 200: the server has ACCEPTED the message, not delivered it —
    // the delivery lane is minutes away by design (MAIL_SWEEP_MS, Task 8).
    return reply.code(202).send({ ok: true, id });
  });

  /**
   * `POST /api/mail/:id/ack` — checks 1, 5 and 6 unchanged, then one more:
   * the delivery must be addressed to the ACKING session. A session acking
   * someone else's mail (or a delivery id that names no row at all) is
   * `unknown-recipient` — the same code, because from the server's side that
   * is exactly what it is: this is not a delivery to you.
   *
   * A second ack of an already-acked delivery is not an error — `markAcked`
   * is idempotent — but it is not a second ack either: `already: true`.
   */
  app.post('/api/mail/:id/ack', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;

    // Same gate, same reasoning: see the ingress route above (fix-round
    // finding 3/5) — `/api/mail/:id/ack` has no legacy caller either.
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
    if (verdict !== 'ok') {
      const detail = verdict === 'legacy'
        ? 'no box token presented — /api/mail/:id/ack grants no legacy tolerance (that is /api/notify only)'
        : 'wrong box token';
      return refuse(reply, 401, 'unauthenticated', {}, detail);
    }

    const body = (req.body ?? {}) as { fromId?: unknown; fromUuid?: unknown };
    if (typeof body.fromId !== 'string' || typeof body.fromUuid !== 'string') {
      return refuse(reply, 400, 'bad-kind', {}, 'fromId/fromUuid must both be strings');
    }
    const { fromId, fromUuid } = body;

    const registry = await readRegistry(deps.io, deps.cfg);
    const sender = registry.find((r) => r.id === fromId);
    if (!sender) {
      return refuse(reply, 403, 'unknown-sender', { fromId }, `no registry row for ${fromId}`);
    }
    if (sender.uuid === '' || sender.uuid !== fromUuid) {
      return refuse(reply, 403, 'stale-uuid', { fromId, fromUuid },
        'fromUuid does not match the registry — stale sender');
    }

    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return refuse(reply, 400, 'bad-kind', { fromId, fromUuid }, 'bad delivery id');
    }

    const delivery = coord.delivery(id);
    if (!delivery || delivery.toId !== fromId) {
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid },
        'this delivery is not addressed to you');
    }

    const landed = coord.markAcked(id, Date.now());
    return reply.code(200).send({ ok: true, already: !landed });
  });
}
