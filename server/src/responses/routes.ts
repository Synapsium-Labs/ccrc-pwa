// The receipts door (Overlord spec §4.3 C67, Table 11.1e; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-responses.md`, Task 4): `POST /api/responses/receipts`. L4, context C6: it gathers the facts, asks `receiptVerdict`
// (L1) and writes what it answers through the store's one transaction (`responsesStore.ts#receiveReceipts`); it decides
// nothing. Session-gated like every route not in the gate's `EXEMPT` table, and open while sign-in is dark, as every door
// is. It reads no box token and writes no coordination state. A receipt is attribution from the operator's device: it can
// only add a receipt to a row that exists, which moves that row among `opened`, `not-opened` and `unmeasured` at its seal,
// never an act, an answer or authority. Its answer is counts only, so it names no row and no id.
import type { FastifyInstance } from 'fastify';
import { parseReceiptBody } from '../../../shared/responses.js';
import { receiptVerdict } from '../responses.js';
import { refuseRoute } from '../refuse.js';
import type { CoordStore } from '../coord/store.js';
import type { TimePorts } from '../time/ports.js';

export interface ResponseRouteOpts {
  /** The coordination store; undefined (a test, a script): `not-configured`. */
  readonly coord: Pick<CoordStore, 'receiveReceipts'> | undefined;
  /** The server's clock: every receipt is stamped with it, never with a time the device sent. */
  readonly time: Pick<TimePorts, 'clock'>;
}

export function registerResponseRoutes(app: FastifyInstance, opts: ResponseRouteOpts): void {
  app.post('/api/responses/receipts', async (req, reply) => {
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    const body = parseReceiptBody(req.body);
    if (!body.ok) return refuseRoute(reply, 'bad-request', { detail: body.detail });
    const out = coord.receiveReceipts(body.receipts, opts.time.clock.wall(), receiptVerdict);
    if (!out.ok) return refuseRoute(reply, 'unavailable', { detail: out.detail });
    let kept = 0;
    const dropped: Record<string, number> = {};
    for (const a of out.answers) {
      if (a.kept) kept += 1;
      else dropped[a.why] = (dropped[a.why] ?? 0) + 1;
    }
    return { ok: true, kept, dropped };
  });
}
