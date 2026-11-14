// The plan verbs' routes (Linear hierarchy design 2026-11-10 §4.3, D-8181): `plan put`, `plan show`, `plan met`,
// `plan ticket-add`, `plan ticket-move`, `plan epic-drop` and `plan close`. L4: they own the reply and decide nothing;
// `planPolicy.ts` parses the bodies and judges the diff, the caller and the programme's end, and `planStore.ts` (through the
// `PlanStorePort`, never `coord.db`) is the table. The box token comes first, then the identity pair from the QUERY, then the
// registry's attribution, then the caller check. Every plan WRITE runs its checks and its store write inside `serial`, the
// coordination mutex that holds `POST /api/runs` from its preconditions to its insert, so a plan write never lands between a
// run's plan check and its attach; attribution and any Linear read run before it, outside. `plan show` takes no lock.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GateDecision } from '../auth/gate.js';
import { linearEgressText } from '../linear/ops.js';
import { routableSlots, routeLinear } from '../linear/route.js';
import type { LinearStoreRead } from '../linear/store.js';
import { refuseRoute, refuseRun } from '../refuse.js';
import {
  LINEAR_SYNC_PROGRAMME, isPlanKey,
  type CheckpointView, type EpicView, type PlanPutBody, type PlanRefusal, type PlanView, type TicketView,
} from '../../../shared/plan.js';
import { programmeNameFromSlug } from '../../../shared/api.js';
import { publicTextVerdict } from '../linking/policy.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import type { AttributionRead } from './openRun.js';
import type { CoordStore } from './store.js';
import type { CoordRoutesHandle } from './routes.js';
import type { BindingRow, PlanStorePort, StoredPlan } from './planStore.js';
import {
  diffPlan, parsePlanClose, parsePlanEpicDrop, parsePlanMet, parsePlanPut, parsePlanTicketAdd, parsePlanTicketMove,
  dropEpicInto, planCallerVerdict, ticketIsHeld,
} from './planPolicy.js';
import { NO_PLAN_CHANGES } from './planStore.js';

export interface PlanRouteOpts {
  /** The coordination store, for the programme rows and the project's team key; undefined (a test, a script): `unavailable`. */
  coord: CoordStore | undefined;
  /** The plan tables through their port; undefined: `unavailable`. */
  plan: PlanStorePort | undefined;
  /** The run writers' mutex (`registerCoordRoutes`' handle). */
  serial: CoordRoutesHandle['serial'];
  /** The box token, read at request time as every lane reads it. */
  mailToken: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check (`attributionVerdict` over the registry). */
  attribute: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The gate's session verdict, for `plan show`'s session-or-token read. */
  sessionAuth: (req: FastifyRequest) => GateDecision;
  authEnabled: boolean;
  /** The Linear store read, for a project's workspace (the team key's slot). */
  readLinearStore: () => Promise<LinearStoreRead>;
  /** The run a session holds, with its epic: the follow-up verb's own-epic check. */
  runOfSession: (id: string) => { program: string; epicId: number | null } | null;
  now: () => number;
  /** The installer's private tracker keys (`CcrcConfig.privateTrackerKeys`), refused in every public plan text; absent: none. */
  privateTrackerKeys?: readonly string[];
}

/** The identity pair's grammar: the client's SAFE_RE, bounded as the Linear proxy bounds it. */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

/** Text that leaves for Linear is shape-redacted where it is stored (the `linear-egress` profile). */
const mask = linearEgressText;
const maskPut = (p: PlanPutBody): PlanPutBody => ({
  ...p,
  ...(p.title === undefined ? {} : { title: mask(p.title) }),
  epics: p.epics.map((e) => ({
    ...e, title: mask(e.title), summary: mask(e.summary),
    ...(e.droppedWhy === undefined ? {} : { droppedWhy: mask(e.droppedWhy) }),
    checkpoints: e.checkpoints.map((c) => ({ ...c, title: mask(c.title) })),
    ...(e.tickets === undefined ? {} : {
      tickets: e.tickets.map((t) => ({ ...t, title: mask(t.title), ...(t.body === undefined ? {} : { body: mask(t.body) }) })),
    }),
  })),
});

// ── The view ───────────────────────────────────────────────────────────────────────────────────────────────────────────

type Sync = { sync: EpicView['sync']; syncWord: string | null };
const syncOf = (rows: readonly BindingRow[] | undefined): Sync => {
  if (rows === undefined || rows.length === 0) return { sync: 'none', syncWord: null };
  const failed = rows.find((r) => r.state === 'failed');
  if (failed !== undefined) return { sync: 'failed', syncWord: failed.failedWord };
  if (rows.some((r) => r.state === 'pending')) return { sync: 'pending', syncWord: null };
  return { sync: 'bound', syncWord: null };
};

/** One programme's plan as the wire says it (`PlanView`): the stored plan, each object's sync word from its bindings. */
export function planViewOf(stored: StoredPlan, doneWhen: readonly string[], bindings: readonly BindingRow[]): PlanView {
  const by = new Map<string, BindingRow[]>();
  for (const b of bindings) by.set(`${b.localKind}:${b.localId}`, [...(by.get(`${b.localKind}:${b.localId}`) ?? []), b]);
  const epics: EpicView[] = stored.epics.map((e) => {
    const checkpoints: CheckpointView[] = e.checkpoints.map((c) => ({
      key: c.key, title: c.title, kind: c.kind, state: c.state, proves: c.proves, metAt: c.metAt, evidence: c.evidence, url: null,
      ...syncOf(by.get(`checkpoint:${c.id}`)),
    }));
    const tickets: TicketView[] = e.tickets.map((t) => ({
      key: t.key, kind: t.kind, title: t.title, project: t.project,
      checkpoint: e.checkpoints.find((c) => c.id === t.checkpointId)?.key ?? null, source: t.source, state: t.state,
      runId: t.runId, identifier: by.get(`ticket:${t.id}`)?.[0]?.identifier ?? null, url: null, ...syncOf(by.get(`ticket:${t.id}`)),
    }));
    return {
      key: e.key, title: e.title, summary: e.summary, project: e.project, waves: e.waves, state: e.state, url: null,
      ...syncOf(by.get(`epic:${e.id}`)), checkpoints, tickets,
    };
  });
  const live = stored.epics.filter((e) => e.state !== 'dropped');
  return {
    program: stored.program, planned: stored.epics.length > 0, initiatives: [], epics,
    doneWhen: doneWhen.map((text, i) => {
      const proving = live.flatMap((e) => e.checkpoints).filter((c) => c.state !== 'dropped' && c.proves.includes(i));
      return { text, proved: proving.length > 0 && proving.every((c) => c.state === 'met') };
    }),
  };
}

// ── Registration ───────────────────────────────────────────────────────────────────────────────────────────────────────

type Refused = { refuse: PlanRefusal; detail: string };
type Work = (c: {
  coord: CoordStore; plan: PlanStorePort; slug: string; caller: string; body: unknown; stored: StoredPlan; owner: string | null;
  ws: ReadonlyMap<string, string | null>;
}) => Promise<Refused | { ok: true; plan: PlanView }>;

export function registerPlanRoutes(app: FastifyInstance, opts: PlanRouteOpts): void {
  const slugOf = (req: FastifyRequest): string | null => {
    const s = (req.params as { slug?: unknown }).slug;
    return isPlanKey(s) ? s : null;
  };

  /** Each project's workspace id, from its team key and the Linear store: null where either is unknown. */
  const workspaces = async (projects: ReadonlySet<string>): Promise<Map<string, string | null>> => {
    const out = new Map<string, string | null>();
    if (opts.coord === undefined || projects.size === 0) return out;
    let store: LinearStoreRead | null = null;
    try { store = await opts.readLinearStore(); } catch { store = null; }
    for (const p of projects) {
      const team = opts.coord.linkingOf(p).teamKey;
      if (team === null || store === null || store.kind !== 'listed') { out.set(p, null); continue; }
      const r = routeLinear(routableSlots(store), { kind: 'team', team, workspace: null });
      out.set(p, r.kind === 'slot' ? r.slot.workspaceId : null);
    }
    return out;
  };
  const projectsIn = (body: unknown, stored: StoredPlan, home: string | null): Set<string> => {
    const found = new Set<string>();
    if (home !== null) found.add(home);
    for (const e of stored.epics) { found.add(e.project); for (const t of e.tickets) found.add(t.project); }
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v !== 'object' || v === null) return;
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'project' || k === 'home') && typeof x === 'string') found.add(x);
        else walk(x);
      }
    };
    walk(body);
    return found;
  };

  const viewOf = (plan: PlanStorePort, coord: CoordStore, slug: string): PlanView =>
    planViewOf(plan.planOf(slug), coord.goalsFor(slug).doneWhen ?? [], plan.bindingsOf(slug));

  const refuse = (reply: FastifyReply, word: PlanRefusal, detail: string): FastifyReply => refuseRoute(reply, word, { detail });

  /** D-8181 (design §4.3): the public-text check on every text a plan verb is about to store, each judged by its own
   *  project's linking mode and team key (a project with no reading is `unknown`, which is public). Runs before the write, so
   *  a refused text stores nothing. The detail names the class (and a tracker id's ids), never the text. */
  const textRefusal = (coord: CoordStore, texts: ReadonlyArray<readonly [project: string, text: string | undefined]>): Refused | null => {
    for (const [project, text] of texts) {
      if (text === undefined || text === '') continue;
      const l = coord.linkingOf(project);
      const v = publicTextVerdict(text, l.teamKey, l.mode, opts.privateTrackerKeys);
      if (!v.ok) return { refuse: v.word, detail: v.ids === undefined ? v.class : `${v.class}: ${v.ids.join(', ')}` };
    }
    return null;
  };

  const WRITE_LIMIT = { rateLimit: { max: 1200, timeWindow: '1 minute' } } as const;
  /** The box-token lane's verdict, answered `unauthenticated` on any but `ok`, whatever the sign-in flag says: no cookie takes its place. */
  const refuseToken = (reply: FastifyReply, verdict: ReturnType<typeof checkMailToken>): FastifyReply | undefined =>
    verdict === 'ok' ? undefined : refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });

  /** A plan write's handler, after the route's own `onRequest` has checked the box token: the slug, the identity pair from the
   *  query, attribution, then the work inside `serial`. Each route is registered with its path spelled out (the gate's and the
   *  census's scans read registrations as literals) and hands its work to this. */
  const door = (work: Work) => async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const slug = slugOf(req);
    if (slug === null) return refuseRoute(reply, 'bad-request', { detail: 'slug' });
    const q = (typeof req.query === 'object' && req.query !== null ? req.query : {}) as Record<string, unknown>;
    const id = q['byId'];
    if (typeof id !== 'string' || !IDENTITY_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'byId' });
    const uuid = q['byUuid'];
    if (typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) return refuseRoute(reply, 'bad-request', { detail: 'byUuid' });
    const { coord, plan } = opts;
    if (coord === undefined || plan === undefined) return refuseRoute(reply, 'unavailable');
    const attributed = await opts.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    if (slug === LINEAR_SYNC_PROGRAMME) return refuseRun(reply, 'reserved-programme');
    // The Linear store is read here, outside the mutex; the work below reads each project's workspace from it.
    const ws = await workspaces(projectsIn(req.body, plan.planOf(slug), coord.programHome(slug)));
    try {
      return await opts.serial(async () => {
        const stored = plan.planOf(slug);
        const out = await work({ coord, plan, slug, caller: id, body: req.body, stored, owner: plan.planOwnerOf(slug), ws });
        return 'refuse' in out ? refuse(reply, out.refuse, out.detail) : out;
      });
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  };

  /** The verdict of a programme verb (the owner's alone) or a follow-up (a worker's, into its own run's epic). */
  const ownerVerdict = (caller: string, owner: string | null) =>
    planCallerVerdict(caller, owner, 'programme', opts.runOfSession(caller));

  const epicOf = (stored: StoredPlan, key: string) => stored.epics.find((e) => e.key === key && e.state !== 'dropped');
  const ticketOf = (stored: StoredPlan, key: string) => {
    for (const e of stored.epics) { const t = e.tickets.find((x) => x.key === key); if (t !== undefined) return { epic: e, ticket: t }; }
    return undefined;
  };
  const workspaceClash = (ws: ReadonlyMap<string, string | null>, a: string, b: string): boolean => {
    const x = ws.get(a) ?? null; const y = ws.get(b) ?? null;
    return x !== null && y !== null && x !== y;
  };

  // `plan put`
  app.post('/api/programmes/:slug/plan', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan')),
  }, door(async ({ coord, plan, slug, caller, body, stored, owner, ws }) => {
    const exists = coord.programs().some((p) => p.slug === slug);
    const storedHome = exists ? coord.programHome(slug) : null;
    const parsed = parsePlanPut(body, { doneWhenCount: (coord.goalsFor(slug).doneWhen ?? []).length, home: { stored: exists ? storedHome : null } });
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator writes its plan' };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
    const home = storedHome ?? parsed.put.home;
    if (home === undefined) return { refuse: 'plan-bad-body', detail: 'the programme has no home project' };
    const texts: [string, string | undefined][] = [[home, parsed.put.title]];
    for (const e of parsed.put.epics) {
      const ep = e.project ?? home;
      texts.push([ep, e.title], [ep, e.summary], [ep, e.droppedWhy]);
      for (const c of e.checkpoints) texts.push([ep, c.title]);
      for (const t of e.tickets ?? []) {
        // diffPlan keeps an existing ticket's stored project when the revision leaves `project` out, so that is the project
        // whose mode judges the text; only a ticket not yet in the plan falls back to its epic's project.
        const tp = t.project ?? ticketOf(stored, t.key)?.ticket.project ?? ep;
        texts.push([tp, t.title], [tp, t.body]);
      }
    }
    const unfit = textRefusal(coord, texts);
    if (unfit !== null) return unfit;
    const put = maskPut(parsed.put);
    const d = diffPlan(stored, put, { home, doneWhenCount: (coord.goalsFor(slug).doneWhen ?? []).length, workspaceOfProject: (p) => ws.get(p) ?? null });
    if (!d.ok) return { refuse: d.word, detail: d.detail };
    const newRow = exists ? null : { home, title: put.title ?? programmeNameFromSlug(slug) };
    plan.applyPlanChanges(slug, d.changes, caller, opts.now(), newRow);
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan met`
  app.post('/api/programmes/:slug/plan/met', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/met')),
  }, door(async ({ coord, plan, slug, caller, body, stored, owner }) => {
    const parsed = parsePlanMet(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator marks a checkpoint met' };
    const { checkpoint, epic, evidence } = parsed.met;
    const matches = stored.epics.filter((e) => (epic === undefined || e.key === epic)).flatMap((e) => e.checkpoints.filter((c) => c.key === checkpoint));
    if (matches.length === 0) return { refuse: 'unknown-checkpoint', detail: `no checkpoint ${checkpoint}` };
    if (matches.length > 1) return { refuse: 'plan-bad-body', detail: `checkpoint ${checkpoint} is in more than one epic: name the epic` };
    const cp = matches[0]!;
    if (cp.state === 'dropped') return { refuse: 'plan-bad-body', detail: `checkpoint ${checkpoint} was dropped` };
    const metUnfit = 'path' in evidence
      ? textRefusal(coord, [[stored.epics.find((e) => e.checkpoints.some((c) => c.id === cp.id))!.project, evidence.path]]) : null;
    if (metUnfit !== null) return metUnfit;
    if (cp.state === 'open') plan.markCheckpointMet(cp.id, 'path' in evidence ? { path: mask(evidence.path) } : evidence, opts.now());
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan ticket-add`
  app.post('/api/programmes/:slug/plan/tickets', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/tickets')),
  }, door(async ({ coord, plan, slug, caller, body, stored, owner, ws }) => {
    const parsed = parsePlanTicketAdd(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const { epic: epicKey, ticket } = parsed.add;
    const epic = epicOf(stored, epicKey);
    if (epic === undefined) return { refuse: 'unknown-epic', detail: `no epic ${epicKey}` };
    const follow = ticket.kind === 'follow-up';
    const verdict = planCallerVerdict(caller, owner, follow ? 'follow-up' : 'programme', opts.runOfSession(caller), { program: slug, epicId: epic.id });
    if (!verdict.ok) return { refuse: verdict.word, detail: 'a worker files a follow-up into its own epic only' };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
    if (ticketOf(stored, ticket.key) !== undefined) return { refuse: 'plan-bad-body', detail: `ticket ${ticket.key} is already in the plan` };
    if (ticket.checkpoint !== undefined && !epic.checkpoints.some((c) => c.key === ticket.checkpoint)) {
      return { refuse: 'unknown-checkpoint', detail: `no checkpoint ${ticket.checkpoint} in epic ${epicKey}` };
    }
    const project = ticket.project ?? epic.project;
    const addUnfit = textRefusal(coord, [[project, ticket.title], [project, ticket.body]]);
    if (addUnfit !== null) return addUnfit;
    if (workspaceClash(ws, project, epic.project)) return { refuse: 'ticket-workspace-mismatch', detail: `ticket ${ticket.key} is in another workspace than epic ${epicKey}` };
    plan.insertTicket({
      program: slug, epicKey, checkpointKey: ticket.checkpoint ?? null, key: ticket.key, kind: ticket.kind, title: mask(ticket.title),
      body: mask(ticket.body ?? ''), project, source: caller === owner || owner === null ? 'plan' : 'worker',
    }, opts.now());
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan ticket-move`
  app.post('/api/programmes/:slug/plan/tickets/move', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/tickets/move')),
  }, door(async ({ coord, plan, slug, caller, body, stored, owner, ws }) => {
    const parsed = parsePlanTicketMove(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator moves a ticket' };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
    const m = parsed.move;
    const found = ticketOf(stored, m.ticket);
    if (found === undefined) return { refuse: 'unknown-ticket', detail: `no ticket ${m.ticket}` };
    const { ticket } = found;
    if (ticketIsHeld(ticket)) return { refuse: 'plan-runs-open', detail: `ticket ${m.ticket} is held by run ${ticket.runId ?? '?'}: it moves or drops once that run ends` };
    if (ticket.state !== 'open') return { refuse: 'plan-bad-body', detail: `ticket ${m.ticket} is ${ticket.state}: only an open ticket moves or drops` };
    if (m.drop !== undefined) {
      const dropUnfit = textRefusal(coord, [[ticket.project, m.drop.why]]);
      if (dropUnfit !== null) return dropUnfit;
      plan.updateTicket(ticket.id, { state: 'dropped', droppedWhy: mask(m.drop.why) }, opts.now());
      return { ok: true, plan: viewOf(plan, coord, slug) };
    }
    const target = m.epic === undefined ? found.epic : epicOf(stored, m.epic);
    if (target === undefined) return { refuse: 'unknown-epic', detail: `no epic ${m.epic}` };
    const patch: { epicId?: number; checkpointId?: number | null; project?: string } = {};
    if (target.id !== found.epic.id) { patch.epicId = target.id; patch.checkpointId = null; }
    if (m.checkpoint !== undefined) {
      const cp = target.checkpoints.find((c) => c.key === m.checkpoint);
      if (cp === undefined) return { refuse: 'unknown-checkpoint', detail: `no checkpoint ${m.checkpoint} in epic ${target.key}` };
      patch.checkpointId = cp.id;
    }
    const project = m.project ?? ticket.project;
    if (m.project !== undefined) {
      patch.project = m.project;
      // a move to another project re-judges the stored text by the target project (every plan verb refuses before it stores)
      const moveUnfit = textRefusal(coord, [[m.project, ticket.title], [m.project, ticket.body]]);
      if (moveUnfit !== null) return moveUnfit;
    }
    if (workspaceClash(ws, project, target.project)) return { refuse: 'ticket-workspace-mismatch', detail: `ticket ${m.ticket} would be in another workspace than epic ${target.key}` };
    plan.updateTicket(ticket.id, patch, opts.now());
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan epic-drop`
  app.post('/api/programmes/:slug/plan/epics/drop', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/epics/drop')),
  }, door(async ({ coord, plan, slug, caller, body, stored, owner }) => {
    const parsed = parsePlanEpicDrop(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator drops an epic' };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
    const epic = stored.epics.find((e) => e.key === parsed.drop.epic);
    if (epic === undefined) return { refuse: 'unknown-epic', detail: `no epic ${parsed.drop.epic}` };
    if (epic.state !== 'dropped') {
      const epicUnfit = textRefusal(coord, [[epic.project, parsed.drop.why]]);
      if (epicUnfit !== null) return epicUnfit;
      const changes = NO_PLAN_CHANGES();
      const held = dropEpicInto(changes, epic, mask(parsed.drop.why));
      if (held !== null) return { refuse: held.word, detail: held.detail };
      plan.applyPlanChanges(slug, changes, caller, opts.now(), null);
    }
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan close`
  app.post('/api/programmes/:slug/plan/close', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/close')),
  }, door(async ({ coord, plan, slug, caller, body, owner }) => {
    const parsed = parsePlanClose(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator closes its plan' };
    if (!coord.programs().some((p) => p.slug === slug)) return { refuse: 'plan-bad-body', detail: `no programme ${slug}` };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was already closed' };
    if (coord.programOpenRunCount(slug) > 0) return { refuse: 'plan-runs-open', detail: 'a run of this programme is not finished' };
    const home = coord.programHome(slug);
    // (a plan with no epics and no tickets has no Linear target, so an empty list here checks nothing, by design)
    // a legacy row with no home has no project to judge by; its `why` is judged by the strictest reading of every project the
    // plan touches instead of being skipped
    const closeProjects = home === null ? [...new Set(plan.planOf(slug).epics.flatMap((e) => [e.project, ...e.tickets.map((t) => t.project)]))] : [home];
    const closeUnfit = textRefusal(coord, closeProjects.map((p) => [p, parsed.close.why] as const));
    if (closeUnfit !== null) return closeUnfit;
    plan.closePlan(slug, parsed.close.outcome, parsed.close.why === undefined ? null : mask(parsed.close.why), opts.now());
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan show`: EXEMPT-BUT-AUTHENTICATED (the goals read's stance): a live session OR the box token, before anything is read.
  app.get('/api/programmes/:slug/plan', {
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!opts.authEnabled) return undefined;
      const session = opts.sessionAuth(req);
      if (session.reason === 'session') return undefined;
      if (checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'GET /api/programmes/:slug/plan') === 'ok') return undefined;
      return refuseRoute(reply, 'unauthenticated', {
        verdict: session.verdict, detail: `this read takes a session cookie OR the box token (${MAIL_TOKEN_HEADER})`,
      });
    },
  }, (req, reply) => {
    const slug = slugOf(req);
    if (slug === null) return refuseRoute(reply, 'bad-request', { detail: 'slug' });
    const { coord, plan } = opts;
    if (coord === undefined || plan === undefined) return refuseRoute(reply, 'unavailable');
    return reply.code(200).send({ ok: true, plan: viewOf(plan, coord, slug) });
  });

}
