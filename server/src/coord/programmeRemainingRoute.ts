// What a programme says is left: the coordinator's remaining-work door (Overlord W2 remaining work A, plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md` Task 3; spec §5.6 H38). L4 delivery, context
// Coordination: it parses a request, asks the store, and answers; the body's rules are `remainingBodyOf`'s (L1,
// `programmeRemaining.ts`), each target's tie to a row `edgeTargetCheck`'s, the SQL `programmeFactsStore.ts`'s, ownership
// `claimsProgramme`'s. A lane source of its own for `box-token-census.test.ts`, registered from `registerCoordRoutes` beside
// the call record's door, whose order it copies (`coordCallsRoute.ts#registerCoordCallsRoute`).
//
// THE ORDER: the box token, before any await; not configured (501); the slug (`isSlotSlug`); `byId`/`byUuid`; the body
// (`remainingBodyOf`); attribution (`requireAttribution`); ownership (`claimsProgramme(byId, slug)`: a throw is 503
// `run-unreadable`, else 403 `not-your-programme`); a body naming a run must name one of this programme; each edge's target
// tied to a row of this tree; the insert (400 on `too-many-open-edges`, 503 on a throw); the answer. A refusal at any step
// writes nothing. The door emits no feed notice and no bus event: nothing reads these rows yet but the forecast to come.
//
// A statement is made by the coordinator that holds the programme and by nobody else: a worker's own pair, and another
// programme's coordinator, are both `not-your-programme`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import { isSlotSlug } from '../../../shared/ledgers.js';
import type { RemainingAnswer } from '../../../shared/programmeFacts.js';
import { remainingBodyOf } from './programmeRemaining.js';
import type { CoordStore } from './store.js';

/** What the route needs. `requireMailToken` and `requireAttribution` are `registerCoordRoutes`'s own closures, handed in
 *  so the gate and the sender check are one implementation for every lane. */
export interface ProgrammeRemainingRouteDeps {
  coord: CoordStore | undefined;
  requireMailToken: (req: FastifyRequest, reply: FastifyReply, route: string) => boolean;
  requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  now: () => number;
  /** The server's build stamp, the one `/health` answers as `version`; null where the build carries none. */
  build: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function registerProgrammeRemainingRoute(app: FastifyInstance, deps: ProgrammeRemainingRouteDeps): void {
  const bad = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'bad-request', { detail });
  const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  app.post('/api/coord/programmes/:slug/remaining', async (req, reply) => {
    const coord = deps.coord;
    if (!deps.requireMailToken(req, reply, 'POST /api/coord/programmes/:slug/remaining')) return;
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
    const parsed = remainingBodyOf(body, now);
    if (!parsed.ok) return bad(reply, parsed.detail);
    if (!(await deps.requireAttribution(reply, byId, byUuid, 'byUuid'))) return;
    try {
      if (!coord.claimsProgramme(byId, slug, byUuid)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${byId} is not the coordinator of programme ${slug}` });
      }
    } catch (err) {
      return refuseRoute(reply, 'run-unreadable', { detail: errText(err) });
    }
    const { statement, edges } = parsed;
    if (statement.runId !== null) {
      const read = coord.run(statement.runId);
      if (!read.ok) return refuseRoute(reply, 'run-unreadable', { detail: read.detail });
      if (read.run === null || read.run.program !== slug) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `run ${statement.runId} is not a run of programme ${slug}` });
      }
    }
    let stored: ReturnType<CoordStore['insertRemaining']>;
    try {
      for (const [i, e] of edges.entries()) {
        const tied = coord.edgeTargetCheck(slug, e.target);
        if (!tied.ok) return bad(reply, `edge ${i}: ${tied.detail}`);
      }
      stored = coord.insertRemaining(slug, byId, statement, edges, deps.build, now);
    } catch (err) {
      return refuseRoute(reply, 'run-unreadable', { detail: errText(err) });
    }
    if (!stored.ok) return bad(reply, `${stored.why}: ${stored.detail}`);
    const answer: RemainingAnswer = { ok: true, id: stored.id, added: stored.added, kept: stored.kept };
    return reply.code(200).send(answer);
  });
}
