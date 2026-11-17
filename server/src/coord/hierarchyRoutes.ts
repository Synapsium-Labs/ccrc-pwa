// The per-project hierarchy settings' routes (Linear hierarchy design 2026-11-10 §7.5 and §15, D-8181): whether a project's
// programmes get Linear initiatives, which coordinator owns its Linear team, and whether it owns a shared team key. L4: they own
// the reply and decide nothing; `planPolicy.ts`'s `linearOwnerOf` judges the owner and `planStore.ts` (through the
// `PlanStorePort`, never `coord.db`) is the table. All three are session-gated (NOT in the gate's EXEMPT table), with no box
// token: the operator acts in the console. Every write runs inside `serial`, the run writers' mutex, as the plan writes do;
// the item acts later waves add to this file take the same door.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LINEAR_ITEM_ACTS, isLinearItemAct, isLinearItemAction, type CoordinatorPresence, type ItemAction } from '../../../shared/ledgers.js';
import type { HierarchyAnswer, HierarchyProjectRow } from '../../../shared/plan.js';
import { refuseRoute } from '../refuse.js';
import type { CoordRoutesHandle } from './routes.js';
import type { HierarchyProjectFacts, HierarchySettingsBody, PlanStorePort } from './planStore.js';
import { linearOwnerOf } from './planPolicy.js';

export interface HierarchyRouteOpts {
  /** The plan tables through their port; undefined (a test, a script): `unavailable`. */
  plan: PlanStorePort | undefined;
  /** The run writers' mutex (`registerCoordRoutes`' handle). */
  serial: CoordRoutesHandle['serial'];
  /** The session standing the console already shows (`coordinatorPresenceIn`): `alive` (asleep included) is live, `dead` and
   *  `absent` gone, `unmeasured` neither. */
  presenceOf: (id: string) => CoordinatorPresence;
  /** Who is writing: the device the request's session names. */
  by: (req: FastifyRequest) => string;
  /** One operator item's action by id (`CoordStore#itemById`); undefined (a test, a script): `unavailable`. */
  itemOf?: (id: number) => { action?: ItemAction | null } | null;
  /** Check again on an initiatives item: queue the probe for the workspace and answer at once (`PlanSync#checkInitiatives`). */
  checkInitiatives?: (workspaceId: string) => Promise<boolean>;
  /** The operator's Hand or Keep on a persistent-drift item (`DriftPass#act`, D-8183); undefined (a test, a script): `unavailable`. */
  driftAct?: (itemId: number, act: 'hand' | 'keep', bindingId: number) => { ok: true } | { ok: false; word: 'not-found' | 'not-open' | 'unavailable' };
  now?: () => number;
}

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The settings body, or null for a malformed one. The owner's membership is checked by the route against the store. */
function parseSettings(body: unknown): HierarchySettingsBody | null {
  if (!isObject(body)) return null;
  const { initiatives, linearOwner, ownsTeam } = body;
  if (initiatives !== 'on' && initiatives !== 'off') return null;
  if (linearOwner !== null && (typeof linearOwner !== 'string' || !ID_RE.test(linearOwner))) return null;
  if (typeof ownsTeam !== 'boolean') return null;
  return { initiatives, linearOwner, ownsTeam };
}

export function registerHierarchyRoutes(app: FastifyInstance, opts: HierarchyRouteOpts): void {
  const now = opts.now ?? Date.now;

  /** The owner now of a project, by the rule `linearOwnerOf` holds (design §7.5). */
  const ownerNow = (plan: PlanStorePort, rows: readonly HierarchyProjectFacts[], row: HierarchyProjectFacts): HierarchyProjectRow['ownerNow'] => {
    // A shared team key answers one project's owner: the project marked `ownsTeam`, else the first that set the key. Its named owner
    // (not this row's) applies, and its latest programme's coordinator is the default.
    let holder: HierarchyProjectFacts | null = null;
    if (!row.ownsTeam && row.teamKey !== null) {
      const sharing = rows.filter((r) => r.teamKey === row.teamKey);
      holder = sharing.find((r) => r.ownsTeam)
        ?? sharing.filter((r) => r.order !== null).sort((x, y) => (x.order as number) - (y.order as number))[0] ?? null;
      if (holder !== null && holder.project === row.project) holder = null;
    }
    const o = linearOwnerOf(row.project, {
      named: (holder ?? row).linearOwner, ownsTeamProject: holder?.project ?? null,
      latestProgrammeCoordinator: (p) => plan.latestProgrammeCoordinator(p), presence: opts.presenceOf,
    });
    return { id: o.id, source: o.source, live: o.live };
  };

  /**
   * `POST /api/projects/:project/hierarchy`: one project's settings. `ownsTeam: true` clears it on every other project with the
   * same team key in the same transaction (the store's). A `linearOwner` naming no coordinator is `bad-request`.
   */
  app.post('/api/projects/:project/hierarchy', async (req, reply) => {
    const { project } = req.params as { project: string };
    if (!PROJECT_RE.test(project)) return refuseRoute(reply, 'bad-request', { detail: 'project' });
    const body = parseSettings(req.body);
    if (body === null) return refuseRoute(reply, 'bad-request', { detail: 'body' });
    const plan = opts.plan;
    if (plan === undefined) return refuseRoute(reply, 'unavailable');
    try {
      return await opts.serial(async () => {
        if (body.linearOwner !== null && !plan.coordinatorIdsOf().includes(body.linearOwner)) {
          return refuseRoute(reply, 'bad-request', { detail: 'linearOwner' });
        }
        plan.setHierarchySettings(project, body, opts.by(req), now());
        return { ok: true, settings: plan.hierarchySettingsOf(project) };
      });
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /** `POST /api/hierarchy/owner`: names one coordinator the owner of every project, leaving each project's other settings. */
  app.post('/api/hierarchy/owner', async (req, reply) => {
    const b = isObject(req.body) ? req.body['linearOwner'] : undefined;
    if (typeof b !== 'string' || !ID_RE.test(b)) return refuseRoute(reply, 'bad-request', { detail: 'linearOwner' });
    const plan = opts.plan;
    if (plan === undefined) return refuseRoute(reply, 'unavailable');
    try {
      return await opts.serial(async () => {
        if (!plan.coordinatorIdsOf().includes(b)) return refuseRoute(reply, 'bad-request', { detail: 'linearOwner' });
        const projects = plan.setLinearOwnerForAll(b);
        return { ok: true, projects };
      });
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * `POST /api/items/:id/linear` `{ act, note?, owner? }`: the operator's act on a hierarchy item (§7). Session-gated, no box
   * token. An act the item's action does not take (`LINEAR_ITEM_ACTS`) is `item-act-mismatch`. `check-again` queues the
   * initiatives probe for the item's workspace and answers at once; `hand` and `keep` on a drift item reach the drift pass inside `serial`
   * (D-8183); the other acts' arms arrive with waves 5 and 7.
   */
  app.post('/api/items/:id/linear', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = isObject(req.body) ? req.body : null;
    if (!Number.isInteger(id) || id < 1 || b === null || !isLinearItemAct(b['act'])) return refuseRoute(reply, 'bad-request', { detail: 'body' });
    if (opts.itemOf === undefined) return refuseRoute(reply, 'unavailable');
    const item = opts.itemOf(id);
    if (item === null) return refuseRoute(reply, 'not-found');
    const action = item.action ?? null;
    if (!isLinearItemAction(action) || !LINEAR_ITEM_ACTS[action.verb].includes(b['act'])) return refuseRoute(reply, 'item-act-mismatch');
    // The verb names the arm (a `switch`: the wave 3 follow-up to testing the action's shape); the acts of waves 5 and 7 add arms.
    switch (action.verb) {
      case 'linear-initiatives': {
        if (opts.checkInitiatives === undefined) break;
        try {
          return { ok: true, queued: await opts.checkInitiatives(action.workspaceId) };
        } catch (err) {
          return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
        }
      }
      case 'linear-drift': {
        const driftAct = opts.driftAct;
        const act = b['act'];
        if (driftAct === undefined || (act !== 'hand' && act !== 'keep')) break;
        try {
          const done = await opts.serial(async () => driftAct(id, act, action.bindingId));
          return done.ok ? { ok: true } : refuseRoute(reply, done.word);
        } catch (err) {
          return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
        }
      }
      default: break;
    }
    return refuseRoute(reply, 'unavailable', { detail: 'act' });
  });

  /** `GET /api/hierarchy`: each project's settings with its owner now and whether that owner is live. In `MASKED_GET_ROUTES`. */
  app.get('/api/hierarchy', async (_req, reply) => {
    const plan = opts.plan;
    if (plan === undefined) return refuseRoute(reply, 'unavailable');
    try {
      const rows = plan.hierarchyProjectsOf();
      const answer: HierarchyAnswer = {
        ok: true,
        // The migration (wave 7) and the inbound path (wave 4) fill state, item and the waiting count; until then no project has either.
        projects: rows.map((r) => ({
          project: r.project, teamKey: r.teamKey, initiatives: r.initiatives, linearOwner: r.linearOwner,
          ownerNow: ownerNow(plan, rows, r), ownsTeam: r.ownsTeam, state: 'not-migrated' as const, stateAt: null, itemId: null, inboundWaiting: 0,
        })),
        coordinators: plan.coordinatorIdsOf().map((id) => ({ id, live: opts.presenceOf(id) === 'alive' })),
      };
      return answer;
    } catch (err) {
      return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
