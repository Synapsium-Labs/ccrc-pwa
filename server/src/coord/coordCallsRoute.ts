// The coordinator call record's route (D-8126, coordinator-autonomy-default plan Task A3-3, spec §8.2). L4 delivery,
// context Coordination: it parses a request, asks the store, and answers; the body's rules are `callBodyOf`'s (L1,
// `coordCalls.ts`), the SQL is `coordCallsStore.ts`'s, ownership is `claimsProgramme`'s. A lane source of its own for
// `box-token-census.test.ts`, registered from `registerCoordRoutes` (its handler lives here so `routes.ts` does not grow).
//
// THE ORDER: not configured (501); the box token, before any await; the slug (`isSlotSlug`); `byId`/`byUuid`; the body
// (`callBodyOf`); attribution (`requireAttribution`); ownership (`claimsProgramme(byId, slug)`: a throw is 503
// `run-unreadable`, else 403 `not-your-programme`); a body naming a run must name one of this programme; the insert; for
// a `big` call one `record-only` feed notice; the answer. A refusal at any step writes nothing and notifies nothing.
//
// A call is recorded by the coordinator that holds the programme and by nobody else (F2): a worker's own pair, and
// another programme's coordinator, are both `not-your-programme`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NoticeSink } from '../notice.js';
import { refuseRoute } from '../refuse.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import type { CallRecordAnswer } from '../../../shared/api.js';
import { isSlotSlug } from '../../../shared/ledgers.js';
import { callBodyOf } from './coordCalls.js';
import type { CoordStore } from './store.js';

/** What the route needs. `requireMailToken` and `requireAttribution` are `registerCoordRoutes`'s own closures, handed in
 *  so the gate and the sender check are one implementation for every lane. */
export interface CoordCallsRouteDeps {
  coord: CoordStore | undefined;
  requireMailToken: (req: FastifyRequest, reply: FastifyReply, route: string) => boolean;
  requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  notice: NoticeSink;
  now: () => number;
  /** The server's build stamp, the one `/health` answers as `version`; null where the build carries none. */
  build: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function registerCoordCallsRoute(app: FastifyInstance, deps: CoordCallsRouteDeps): void {
  const bad = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'bad-request', { detail });
  const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  app.post('/api/coord/programmes/:slug/calls', async (req, reply) => {
    const coord = deps.coord;
    if (!deps.requireMailToken(req, reply, 'POST /api/coord/programmes/:slug/calls')) return;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const slug = (req.params as { slug: string }).slug;
    if (!isSlotSlug(slug)) return bad(reply, 'the programme is a lower-case slug of at most 40 characters');
    const body = req.body;
    const byId = isObject(body) ? body['byId'] : undefined;
    const byUuid = isObject(body) ? body['byUuid'] : undefined;
    if (typeof byId !== 'string' || byId === '' || typeof byUuid !== 'string' || byUuid === '') {
      return bad(reply, 'byId and byUuid are required strings');
    }
    const now = deps.now();
    const parsed = callBodyOf(body, now);
    if (!parsed.ok) return bad(reply, parsed.detail);
    if (!(await deps.requireAttribution(reply, byId, byUuid, 'byUuid'))) return;
    try {
      if (!coord.claimsProgramme(byId, slug)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${byId} holds no open run of programme ${slug}` });
      }
    } catch (err) {
      return refuseRoute(reply, 'run-unreadable', { detail: errText(err) });
    }
    const call = parsed.call;
    if (call.runId !== null) {
      const read = coord.run(call.runId);
      if (!read.ok) return refuseRoute(reply, 'run-unreadable', { detail: read.detail });
      if (read.run === null || read.run.program !== slug) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `run ${call.runId} is not a run of programme ${slug}` });
      }
    }
    const id = coord.insertCall(slug, byId, call, deps.build, now);
    if (call.class === 'big') {
      // The feed is the operator's trail of a call made in their name; it is never pushed (the Seen door is the prompt).
      deps.notice({ kind: 'coord', sessionId: '', runId: call.runId, title: `Call made · ${slug}`, body: `${call.question ?? ''} → ${call.chosen}` },
        'record-only', { degraded: `coordinator call ${id}, feed archive degraded` });
    }
    const stored = coord.callById(id);
    const answer: CallRecordAnswer = { ok: true, id, class: call.class, expiresAt: stored?.expiresAt ?? null };
    return reply.code(200).send(answer);
  });
}
