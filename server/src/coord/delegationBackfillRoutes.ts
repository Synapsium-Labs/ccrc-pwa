import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import type { FleetIO } from '../io.js';
import { DELEGATION_BACKFILL_REFUSAL } from '../../../shared/delegationBackfill.js';
import { DelegationCheckpointError } from './delegation-checkpoint.js';
import type { DelegationApplyOutcome, DelegationDurability } from './delegation-durability.js';
import { backfillParentOf, backfillParentsToRead, parseBackfillRequest, type DelegationBackfillParent } from './delegation-backfill.js';
import { incarnationOf } from './delegationLeaseDoor.js';

/**
 * THE TRIGGER OF THE ONE-TIME PASS (session helpers S2, D-8874; spec 2026-11-19 §7.2 "Who runs it"; plan 2026-11-20, Task S2):
 *
 *   GET  /api/coord/delegation-backfill   the dry run: the report the pass would act on now; it writes nothing
 *   POST /api/coord/delegation-backfill   `{act: 'pass', closes: <the dry run's count>}` or `{act: 'undo'}`
 *
 *  - THE OPERATOR'S, BY HAND: the dry run, then the pass. SESSION-GATED, NO BOX TOKEN: the global auth gate takes both routes like every
 *    PWA-surface door (they are in no EXEMPT table), and the box-token census lists them as `DELEGATION_BACKFILL_DOORS`. A command was the
 *    other shape the spec allowed; it would still need a door to reach the watcher's one applier, so the route is the smaller.
 *  - THE PASS NEEDS A SIGNED-IN OPERATOR: it refuses `sign-in-unarmed` while sign-in is dark or the caller holds no session (the collect-lane
 *    and adoption-switch argument: a durable write across the broker's records). The dry run and the undo stay open dark: the one writes
 *    nothing, the other only gives back what the pass closed.
 *  - THE DRY RUN FIRST: the pass carries the dry run's count and refuses `count-changed` (with the report it would act on) unless it is the
 *    count it would close now, so the pass never runs on a number nobody read.
 *  - THE REGISTRY IS MEASURED HERE, decided in L1: one listing, then each listed parent's incarnation, read twice, for the parents whose
 *    records a verdict reads (`backfillParentsToRead`). A listing that does not read makes every parent unmeasured, so no agent or workflow
 *    record passes the positive check by its parent; the applier decides under its own lock on its own checkpoint.
 *
 * L4: it measures, calls the ONE `DelegationDurability` the watcher's lane opened (`watcher.delegationApplier()`; a second instance on the
 * directory would race its journal), and answers. Every decision is `delegation-backfill.ts` (L1). Not registered here: `server.ts` calls
 * `registerDelegationBackfillRoutes`, which `auth-gate.test.ts`'s `ROUTES` and the box-token census read by this file's name.
 */
export interface DelegationBackfillRouteDeps {
  /** The watcher's one applier; null while the lane has none open. */
  readonly applier: () => Promise<DelegationDurability | null>;
  readonly io: Pick<FleetIO, 'readdirMeasured' | 'readFileMeasured'>;
  readonly registryDir: string;
  readonly now: () => number;
  /** Sign-in is armed and the caller holds a session (`server.ts` measures it: `authEnabled` and the gate's `session` reason). */
  readonly signedIn: (req: FastifyRequest) => boolean;
}


export function registerDelegationBackfillRoutes(app: FastifyInstance, deps: DelegationBackfillRouteDeps): void {
  /** The applier, ready; or the refusal already sent. */
  const ready = async (reply: FastifyReply): Promise<DelegationDurability | null> => {
    let durable: DelegationDurability | null;
    try { durable = await deps.applier(); } catch { durable = null; }
    if (durable === null) { refuseRoute(reply, 'not-ready', { detail: 'the delegation lane has no durable applier open yet: retry' }); return null; }
    if (durable.state().phase !== 'ready') { refuseRoute(reply, 'not-ready', { detail: 'the delegation lane is recovering its checkpoint: retry' }); return null; }
    return durable;
  };
  /** The registry facts of the parents a verdict reads, measured now. */
  const parentsOf = async (durable: DelegationDurability, nowMs: number): Promise<Map<string, DelegationBackfillParent>> => {
    const ids = backfillParentsToRead(durable.state().checkpoint.activities, nowMs);
    const listing = await deps.io.readdirMeasured(deps.registryDir);
    const listed = listing.ok ? new Set(listing.entries.filter((e) => e.endsWith('.uuid')).map((e) => e.slice(0, -'.uuid'.length))) : null;
    const out = new Map<string, DelegationBackfillParent>();
    await Promise.all(ids.map(async (id) => {
      const inc = listed?.has(id) === true ? await incarnationOf(deps, id) : null;
      out.set(id, backfillParentOf(listed, id, inc));
    }));
    return out;
  };
  /** An applier refusal: not ready (503), the pass's list unusable (503 `unavailable`, with why), or a failed application (503). */
  const failed = (reply: FastifyReply, err: unknown): FastifyReply => {
    const detail = err instanceof Error ? err.message : String(err);
    if (err instanceof DelegationCheckpointError && err.code === 'not-ready') return refuseRoute(reply, 'not-ready', { detail });
    if (err instanceof DelegationCheckpointError && err.code === 'change-refused') return refuseRoute(reply, 'unavailable', { detail });
    console.warn(`ccrc-server: delegation backfill: the application failed (${detail})`);
    return refuseRoute(reply, 'application-failed', { detail: 'nothing is confirmed durable; read the dry run again' });
  };
  const projectionOf = (applied: DelegationApplyOutcome | null): 'projected' | 'stale' | null =>
    applied === null ? null : applied.durable && applied.projection.status === 'projected' ? 'projected' : 'stale';

  app.get('/api/coord/delegation-backfill', async (_req, reply) => {
    const durable = await ready(reply);
    if (durable === null) return reply;
    const nowMs = deps.now();
    try {
      const report = await durable.backfillDryRun(nowMs, await parentsOf(durable, nowMs));
      return reply.code(200).send({ ok: true, ...report });
    } catch (err) { return failed(reply, err); }
  });

  app.post('/api/coord/delegation-backfill', async (req, reply) => {
    const request = parseBackfillRequest(req.body);
    if (request === null) return refuseRoute(reply, 'bad-request', { detail: 'the body is {act: pass, closes: <the dry run\'s count>} or {act: undo}, and nothing else' });
    if (request.act === 'pass' && !deps.signedIn(req)) {
      return refuseRoute(reply, 'sign-in-unarmed', { detail: 'the one-time pass needs a signed-in operator; the dry run and the undo do not' });
    }
    const durable = await ready(reply);
    if (durable === null) return reply;
    try {
      if (request.act === 'undo') {
        const out = await durable.backfillUndo();
        if (out.reopened > 0) console.warn(`ccrc-server: delegation backfill: the undo reopened ${out.reopened} record(s)`);
        return reply.code(200).send({ ok: true, act: 'undo', reopened: out.reopened, projection: projectionOf(out.applied) });
      }
      const nowMs = deps.now();
      const out = await durable.backfillPass(nowMs, await parentsOf(durable, nowMs), request.closes);
      if (!out.ok) {
        return refuseRoute(reply, DELEGATION_BACKFILL_REFUSAL.countChanged,
          { report: out.report, detail: `the pass would close ${out.report.closes}, not ${request.closes}: read the dry run again` });
      }
      if (out.closed > 0) console.warn(`ccrc-server: delegation backfill: the one-time pass closed ${out.closed} record(s)`);
      return reply.code(200).send({ ok: true, act: 'pass', closed: out.closed, projection: projectionOf(out.applied), report: out.report });
    } catch (err) { return failed(reply, err); }
  });
}
