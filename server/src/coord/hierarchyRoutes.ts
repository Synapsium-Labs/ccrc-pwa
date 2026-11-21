// The per-project hierarchy settings' routes (Linear hierarchy design 2026-11-10 §7.5 and §15, D-8181): whether a project's
// programmes get Linear initiatives, which coordinator owns its Linear team, and whether it owns a shared team key. L4: they own
// the reply and decide nothing; `planPolicy.ts`'s `linearOwnerOf` judges the owner and `planStore.ts` (through the
// `PlanStorePort`, never `coord.db`) is the table. All three are session-gated (NOT in the gate's EXEMPT table), with no box
// token: the operator acts in the console. Every write runs inside `serial`, the run writers' mutex, as the plan writes do;
// the item acts later waves add to this file take the same door.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LINEAR_ITEM_ACTS, isLinearItemAct, isLinearItemAction, type CoordinatorPresence, type ItemAction } from '../../../shared/ledgers.js';
import { UPKEEP_DUE_PREFIX, type HierarchyAnswer, type HierarchyProjectRow } from '../../../shared/plan.js';
import { refuseRoute } from '../refuse.js';
import type { HierarchyItemRefusal, RouteRefusal } from '../../../shared/refusal.js';
import type { CoordRoutesHandle } from './routes.js';
import type { HierarchyProjectFacts, HierarchySettingsBody, PlanStorePort } from './planStore.js';
import { linearOwnerOf, linearOwnerOfProject } from './planPolicy.js';
import { planViewOf } from './planRoutes.js';
import { givenUpWord } from '../linear/inboundPolicy.js';
import type { LinearMigration } from '../linear/migration.js';
import { measuredTeamRoutes, routableSlots, type LinearRouteSlot } from '../linear/route.js';
import type { LinearStoreRead } from '../linear/store.js';

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
  /** The operator's Hand or Keep on a persistent-drift item (`DriftPass#act`, D-8183); undefined (a test, a script): `unavailable`. Hand
   *  with no usable Linear owner to go to is `no-linear-owner` (D-8736, review 2394 A-7): the item stays open, and the answer passes
   *  through `refuseRoute` at its 409 like the others. */
  driftAct?: (itemId: number, act: 'hand' | 'keep', bindingId: number, slots: readonly LinearRouteSlot[] | null) => { ok: true } | { ok: false; word: 'not-found' | 'not-open' | 'unavailable' | HierarchyItemRefusal };
  /** The per-team migration (D-8186, wave 7): its start, the map's and the report's acts, the item body's read and each team's
   *  state; undefined (a test, a script): those doors answer `unavailable` and every row reads "Not migrated". */
  migration?: Pick<LinearMigration, 'start' | 'workspaceOfProject' | 'act' | 'view' | 'stateOfProject'>;
  /** The local routing snapshot, never a Linear call. A failed read makes unpinned membership unmeasured. */
  readLinearStore?: () => Promise<LinearStoreRead>;
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
  const routingSlots = async (requireMeasuredTeams = false): Promise<LinearRouteSlot[] | null> => {
    const store = await opts.readLinearStore?.().catch(() => null);
    if (store?.kind !== 'listed') return null;
    return requireMeasuredTeams ? measuredTeamRoutes(store) : routableSlots(store);
  };

  /** The owner now of a project, by the rule `linearOwnerOf` holds (design §7.5): a shared team key answers one project's owner
   *  (`teamOwnerProject`, the one rule the triage route and the drift pass ask too). `ifUnnamed` is what choosing the empty owner
   *  option gives: the same policy function with no named owner, for the project's own latest programme (D-8738). */
  const ownerNow = (plan: PlanStorePort, rows: readonly HierarchyProjectFacts[], row: HierarchyProjectFacts, slots: readonly LinearRouteSlot[] | null): HierarchyProjectRow['ownerNow'] => {
    const o = linearOwnerOfProject(row.project, rows, { latestProgrammeCoordinator: (p) => plan.latestProgrammeCoordinator(p), presence: opts.presenceOf }, slots);
    const u = linearOwnerOf(row.project, {
      named: null, ownsTeamProject: null, latestProgrammeCoordinator: (p) => plan.latestProgrammeCoordinator(p), presence: opts.presenceOf,
    });
    return { id: o.id, source: o.source, live: o.live, project: o.project, ifUnnamed: { id: u.id, live: u.live } };
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

  /** `POST /api/projects/:project/hierarchy/migrate` (D-8186, Task 7.2): the operator's "Reshape in Linear". The team's workspace is
   *  read before the mutex; the row is written inside it. One team at a time (`migration-in-flight`), never a project with no key
   *  (`no-team-key`). Session-gated, no box token. */
  app.post('/api/projects/:project/hierarchy/migrate', async (req, reply) => {
    const { project } = req.params as { project: string };
    if (!PROJECT_RE.test(project)) return refuseRoute(reply, 'bad-request', { detail: 'project' });
    const migration = opts.migration;
    if (migration === undefined) return refuseRoute(reply, 'unavailable');
    const where = await migration.workspaceOfProject(project).catch((): { ok: false; word: string; detail: string } => ({ ok: false, word: 'unreachable', detail: 'the Linear workspaces could not be read' }));
    try {
      return await opts.serial(async () => {
        const out = migration.start(project, where);
        return out.ok ? out : refuseRoute(reply, out.word as RouteRefusal, { detail: out.detail });
      });
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /** `GET /api/migrations/:id` (D-8186; D-8737's handover): a migration's map or report for its item's body. Session-gated, in
   *  `MASKED_GET_ROUTES`: titles and identifiers are Linear text. */
  app.get('/api/migrations/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) return refuseRoute(reply, 'bad-request', { detail: 'id' });
    const migration = opts.migration;
    if (migration === undefined) return refuseRoute(reply, 'unavailable');
    try {
      const view = migration.view(id);
      return view === null ? refuseRoute(reply, 'not-found') : view;
    } catch (err) {
      return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
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
          const slots = act === 'hand' ? await routingSlots() : null;
          const done = await opts.serial(async () => driftAct(id, act, action.bindingId, slots));
          return done.ok ? { ok: true } : refuseRoute(reply, done.word);
        } catch (err) {
          return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
        }
      }
      case 'linear-owner': {
        // D-8183: the operator names the project's Linear owner (a coordinator), keeping the project's other settings; the item
        // settles itself on the drift lane once that owner reads live (`inboundLane.ts`).
        const owner = b['owner'];
        const plan = opts.plan;
        if (typeof owner !== 'string' || !ID_RE.test(owner)) return refuseRoute(reply, 'bad-request', { detail: 'owner' });
        if (plan === undefined) break;
        try {
          return await opts.serial(async () => {
            if (!plan.coordinatorIdsOf().includes(owner)) return refuseRoute(reply, 'bad-request', { detail: 'owner' });
            plan.setHierarchySettings(action.project, { ...plan.hierarchySettingsOf(action.project), linearOwner: owner }, opts.by(req), now());
            return { ok: true };
          });
        } catch (err) {
          return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
        }
      }
      case 'linear-map':
      case 'linear-report': {
        // D-8186 (Tasks 7.2 and 7.4): Approve and Return on the map, Put back and Done on the report, inside `serial`; Put back is
        // only marked here, and the migration lane runs it (D-8796).
        const migration = opts.migration;
        const act = b['act'];
        const note = typeof b['note'] === 'string' ? b['note'].slice(0, 2000) : null;
        if (migration === undefined || (act !== 'approve' && act !== 'return' && act !== 'put-back' && act !== 'done')) break;
        if (act === 'return' && (note === null || note.trim() === '')) return refuseRoute(reply, 'bad-request', { detail: 'note' });
        try {
          const slots = act === 'return' ? await routingSlots(true) : null;
          const done = await opts.serial(async () => migration.act(id, action.migrationId, act, note, slots));
          return done.ok ? { ok: true } : refuseRoute(reply, done.word, { detail: done.detail });
        } catch (err) {
          return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
        }
      }
      default: break;
    }
    return refuseRoute(reply, 'unavailable', { detail: 'act' });
  });

  /** `GET /api/projects/:project/upkeep`: the project's Upkeep epic with its tickets (D-8183), or null before its first use, and
   *  `notClosed`, the inbound closes of the project's team that ccrc gave up because Linear refused them (`givenUpWord`): the
   *  durable record a team with no owner to mail still shows (review 2386 A7). Session-gated, in `MASKED_GET_ROUTES`: a
   *  ticket's title is the reporter's text. */
  app.get('/api/projects/:project/upkeep', async (req, reply) => {
    const { project } = req.params as { project: string };
    if (!PROJECT_RE.test(project)) return refuseRoute(reply, 'bad-request', { detail: 'project' });
    const plan = opts.plan;
    if (plan === undefined) return refuseRoute(reply, 'unavailable');
    try {
      const rows = plan.hierarchyProjectsOf();
      const teamOf = (p: string): string | null => rows.find((r) => r.project === p)?.teamKey ?? null;
      const view = planViewOf(plan.upkeepPlanOf(project), [], plan.bindingsOf(`${UPKEEP_DUE_PREFIX}${project}`), teamOf);
      const team = teamOf(project)?.toUpperCase() ?? null;
      const notClosed = team === null ? [] : plan.inboundByState(null, ['closed']).flatMap((r) => {
        const word = givenUpWord(r.reason);
        return word === null || r.teamKey.toUpperCase() !== team ? [] : [{ identifier: r.identifier, teamKey: r.teamKey, word, at: r.actedAt }];
      });
      return { ok: true, epic: view.epics[0] ?? null, notClosed };
    } catch (err) {
      return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /** `GET /api/hierarchy`: each project's settings with its owner now and whether that owner is live. In `MASKED_GET_ROUTES`. */
  app.get('/api/hierarchy', async (_req, reply) => {
    const plan = opts.plan;
    if (plan === undefined) return refuseRoute(reply, 'unavailable');
    try {
      const slots = await routingSlots();
      const rows = plan.hierarchyProjectsOf();
      const answer: HierarchyAnswer = {
        ok: true,
        // The team's newest migration names the state and its item (D-8186); the waiting count is the inbound path's (D-8183).
        projects: await Promise.all(rows.map(async (r) => {
          const st = (await opts.migration?.stateOfProject({ teamKey: r.teamKey, workspaceId: r.workspaceId ?? null }, slots)) ?? { state: 'not-migrated' as const, at: null, itemId: null };
          return {
            project: r.project, teamKey: r.teamKey, initiatives: r.initiatives, linearOwner: r.linearOwner,
            ownerNow: ownerNow(plan, rows, r, slots), ownsTeam: r.ownsTeam, state: st.state, stateAt: st.at, itemId: st.itemId, inboundWaiting: plan.inboundWaiting(r.project),
          };
        })),
        coordinators: plan.coordinatorIdsOf().map((id) => ({ id, live: opts.presenceOf(id) === 'alive' })),
      };
      return answer;
    } catch (err) {
      return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
