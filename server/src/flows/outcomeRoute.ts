// A coordinator reports a flow outcome (Flows wave 3b, plan `2026-11-20-flows-w3b.md`; spec §5's outcome door). L4
// delivery, context Coordination (C5): it parses, asks, records and answers; the verdict is `outcome.ts`'s (L1), the SQL
// `flowsStore.ts`'s, ownership `claimsProgramme`'s. A lane source of its own for `box-token-census.test.ts`, registered from
// `registerCoordRoutes`, which hands in its `requireMailToken` and `requireAttribution`.
//
// THE ORDER (the call record's, `coord/coordCallsRoute.ts`): not configured; the box token, before any await; the slug;
// `byId`/`byUuid`; attribution; ownership (a throw is 503 `run-unreadable`, else 403 `not-your-programme`); the pin and
// its version; the verdict; the insert; the answer. A refusal at any step writes nothing.
//
// SHADOW ONLY: the answer names the block the flow leads to and what the engine would do there, and nothing is sent.
// Only the coordinator that holds the programme reports (a worker's outcome reaches its coordinator as today, by mail).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import { isSlotSlug } from '../../../shared/ledgers.js';
import type { CoordStore } from '../coord/store.js';
import { decideOutcome } from './outcome.js';

export interface FlowOutcomeRouteDeps {
  coord: CoordStore | undefined;
  requireMailToken: (req: FastifyRequest, reply: FastifyReply, route: string) => boolean;
  requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  now: () => number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function registerFlowOutcomeRoute(app: FastifyInstance, deps: FlowOutcomeRouteDeps): void {
  const bad = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'bad-request', { detail });
  app.post('/api/coord/programmes/:slug/flow-outcome', async (req, reply) => {
    const coord = deps.coord;
    if (!deps.requireMailToken(req, reply, 'POST /api/coord/programmes/:slug/flow-outcome')) return;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const slug = (req.params as { slug: string }).slug;
    if (!isSlotSlug(slug)) return bad(reply, 'the programme is a lower-case slug of at most 40 characters');
    const body = req.body;
    const byId = isObject(body) ? body['byId'] : undefined;
    const byUuid = isObject(body) ? body['byUuid'] : undefined;
    if (typeof byId !== 'string' || byId === '' || typeof byUuid !== 'string' || byUuid === '') {
      return bad(reply, 'byId and byUuid are required strings');
    }
    if (!(await deps.requireAttribution(reply, byId, byUuid, 'byUuid'))) return;
    try {
      if (!coord.claimsProgramme(byId, slug)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${byId} holds no open run of programme ${slug}` });
      }
    } catch (err) {
      return refuseRoute(reply, 'run-unreadable', { detail: err instanceof Error ? err.message : String(err) });
    }
    const pin = coord.readProgrammeFlowPin(slug);
    const read = pin === null ? null : coord.readFlowVersion(pin.flowId, pin.version);
    const doc = read !== null && read.ok && read.value !== null ? read.value.doc : null;
    const v = decideOutcome(doc, pin !== null, body, { 'programme.slug': slug });
    if (!v.ok) return refuseRoute(reply, v.refusal, { detail: v.detail });
    const id = coord.recordFlowOutcome({ program: slug, flowId: pin!.flowId, version: pin!.version, blockId: v.blockId,
      outcome: v.outcome, nextBlock: v.next, wouldSend: v.wouldSend, byId, at: deps.now() });
    return { ok: true, id, next: v.next, wouldSend: v.wouldSend };
  });
}
