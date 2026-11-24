// The response record's doors (Overlord spec §4.3 C67, C69, §9.4; Table 11.1e; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-responses.md`, Tasks 4 and 8). L4, context C6: each gathers the facts, asks its L1 decider (`receiptVerdict`,
// `retentionChangeGate`) and writes what it answers through the store; it decides nothing. Every door is session-gated like
// every route not in the gate's `EXEMPT` table, and open while sign-in is dark, as every door is. None reads a box token or
// writes coordination state. A failed read or write answers `UNAVAILABLE_DETAIL`, and its cause (a row id, a stored word)
// goes to the server's log only (review 2214 F4).
//   - `POST /api/responses/receipts`: a receipt is attribution from the operator's device: it can only add a receipt to a
//     row that exists, which moves that row among `opened`, `not-opened` and `unmeasured` at its seal, never an act, an
//     answer or authority. Its answer is counts only, so it names no row and no id.
//   - `POST /api/responses/:id/handled`: "I handled this elsewhere" (C69) writes `handledAt` once and nothing else. No step-up.
//   - `GET /api/responses?ref=item:<id>|digest:<key>`: the rows the console's control marks (question 11).
//   - `GET`/`POST /api/responses/retention`: the operator's retention. Lowering it deletes rows on the next pass, as a wipe
//     does, so it asks the account gate's step-up; raising it, or setting the stored value, needs the session alone (Task 8).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  RESPONSE_RETENTION_DEFAULT_DAYS, RESPONSE_RETENTION_MAX_DAYS, RESPONSE_RETENTION_MIN_DAYS, isDigestLineKey, parseReceiptBody,
  type ReceiptDrop, type ResponseRetentionView,
} from '../../../shared/responses.js';
import { receiptVerdict, retentionChangeGate } from '../responses.js';
import { refuseRoute } from '../refuse.js';
import type { AccountGate } from '../accounts/gate.js';
import type { CoordStore } from '../coord/store.js';
import type { NoticeSink } from '../notice.js';
import type { TimePorts } from '../time/ports.js';

/** The one sentence a failed read or write answers; the store logged the cause. */
export const UNAVAILABLE_DETAIL = 'the response record could not be read or written; nothing was kept';

export interface ResponseRouteOpts {
  /** The coordination store; undefined (a test, a script): `not-configured`. */
  readonly coord: Pick<CoordStore, 'receiveReceipts' | 'markResponseHandled' | 'responsesForRef' | 'responseRetention' | 'setResponseRetention'> | undefined;
  /** The server's clock: every write is stamped with it, never with a time the device sent. */
  readonly time: Pick<TimePorts, 'clock'>;
  /** The account gate `server.ts` builds; the retention door asks it for the step-up when the change lowers retention. */
  readonly gate?: AccountGate | undefined;
  /** The feed's record of a retention change, and the actor it names (`deviceActor` when sign-in is armed, else `flag-off`). */
  readonly notice?: NoticeSink | undefined;
  readonly actorOf?: ((req: FastifyRequest) => string) | undefined;
}

const ID = /^[1-9][0-9]{0,15}$/;

export function registerResponseRoutes(app: FastifyInstance, opts: ResponseRouteOpts): void {
  app.post('/api/responses/receipts', async (req, reply) => {
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    const body = parseReceiptBody(req.body);
    if (!body.ok) return refuseRoute(reply, 'bad-request', { detail: body.detail });
    const out = coord.receiveReceipts(body.receipts, opts.time.clock.wall(), receiptVerdict);
    if (!out.ok) return refuseRoute(reply, 'unavailable', { detail: UNAVAILABLE_DETAIL });
    let kept = 0;
    const dropped: Partial<Record<ReceiptDrop, number>> = {};
    for (const a of out.answers) {
      if (a.kept) kept += 1;
      else dropped[a.why] = (dropped[a.why] ?? 0) + 1;
    }
    return { ok: true, kept, dropped };
  });

  app.post('/api/responses/:id/handled', async (req, reply) => {
    const params = req.params as { id: string };
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    if (!ID.test(params.id) || !Number.isSafeInteger(Number(params.id))) return refuseRoute(reply, 'bad-request', { detail: 'id is not a positive integer' });
    let w: ReturnType<typeof coord.markResponseHandled>;
    try { w = coord.markResponseHandled(Number(params.id), opts.time.clock.wall()); } catch (e) {
      console.warn(`ccrc-server: responses: the handled mark was not written (${e instanceof Error ? e.message : String(e)})`);
      return refuseRoute(reply, 'unavailable', { detail: UNAVAILABLE_DETAIL });
    }
    if (w.row === null) return refuseRoute(reply, 'not-found');
    return { ok: true, id: w.row.id, handledAt: w.row.handledAt, changed: w.changed };
  });

  app.get('/api/responses', async (req, reply) => {
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    const query = req.query as { ref?: unknown };
    const ref = typeof query.ref === 'string' ? query.ref : '';
    const sep = ref.indexOf(':');
    const kind = ref.slice(0, sep);
    const rest = ref.slice(sep + 1);
    let read: ReturnType<typeof coord.responsesForRef>;
    if (sep > 0 && kind === 'item' && ID.test(rest) && Number.isSafeInteger(Number(rest))) read = coord.responsesForRef({ kind: 'item', id: Number(rest) });
    else if (sep > 0 && kind === 'digest' && isDigestLineKey(rest)) read = coord.responsesForRef({ kind: 'digest', key: rest });
    else return refuseRoute(reply, 'bad-request', { detail: 'ref is not item:<id> or digest:<key>' });
    if (!read.ok) return refuseRoute(reply, 'unavailable', { detail: UNAVAILABLE_DETAIL });
    return { ok: true, rows: read.rows };
  });

  const bounds = { default: RESPONSE_RETENTION_DEFAULT_DAYS, min: RESPONSE_RETENTION_MIN_DAYS, max: RESPONSE_RETENTION_MAX_DAYS };
  const retentionView = (coord: NonNullable<ResponseRouteOpts['coord']>): ResponseRetentionView => {
    const r = coord.responseRetention();
    if (!r.ok) console.warn(`ccrc-server: responses: ${r.detail}`);
    return r.ok ? { ok: true, days: r.days, ...bounds } : { ok: true, days: null, unreadable: true, ...bounds };
  };

  app.get('/api/responses/retention', async (_req, reply) => {
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    return retentionView(coord);
  });

  app.post('/api/responses/retention', async (req, reply) => {
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    const body = req.body as { days?: unknown } | null | undefined;
    const days = body !== null && typeof body === 'object' ? body.days : undefined;
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < RESPONSE_RETENTION_MIN_DAYS || days > RESPONSE_RETENTION_MAX_DAYS) {
      return refuseRoute(reply, 'bad-request', { detail: `days must be a whole number from ${RESPONSE_RETENTION_MIN_DAYS} to ${RESPONSE_RETENTION_MAX_DAYS}` });
    }
    const stored = coord.responseRetention();
    if (retentionChangeGate(stored.ok ? stored.days : 'unreadable', days) === 'step-up') {
      if (opts.gate === undefined) return refuseRoute(reply, 'not-configured');
      if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    }
    let w: ReturnType<typeof coord.setResponseRetention>;
    try { w = coord.setResponseRetention(days, opts.time.clock.wall()); } catch (e) {
      console.warn(`ccrc-server: responses: the retention was not written (${e instanceof Error ? e.message : String(e)})`);
      return refuseRoute(reply, 'unavailable', { detail: UNAVAILABLE_DETAIL });
    }
    if (w.changed && opts.notice !== undefined) {
      const actor = opts.actorOf?.(req) ?? 'unmeasured';
      opts.notice({ kind: 'coord', sessionId: '', title: 'response retention changed', runId: null,
        body: `response retention: ${stored.ok ? `${stored.days}` : 'unreadable'} -> ${days} days; by ${actor}` },
      'record-only', { degraded: 'response retention written, feed archive degraded' });
    }
    return retentionView(coord);
  });
}
