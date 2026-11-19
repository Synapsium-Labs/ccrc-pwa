// The plan verbs' routes (Linear hierarchy design 2026-11-10 §4.3, D-8181): `plan put`, `plan show`, `plan met`,
// `plan ticket-add`, `plan ticket-move`, `plan epic-drop` and `plan close`, `plan phase-ref` (programme work map WM0,
// D-8715), with the phases `plan put` stores and `plan show` answers, `plan ticket-done` (WM1, D-8727), and the inbound
// path's two (D-8183): `plan triage` (the team's Linear owner decides an issue filed in Linear) and `plan take` (a
// programme's coordinator takes, closes or returns one). Neither calls Linear: the drift lane's inbound lane makes the one
// write (`linear/inboundLane.ts`). L4: they own the reply and decide nothing;
// `planPolicy.ts` parses the bodies and judges the diff, the caller and the programme's end, and `planStore.ts` (through the
// `PlanStorePort`, never `coord.db`) is the table. The box token comes first, then the identity pair from the QUERY, then the
// registry's attribution, then the caller check. Every plan WRITE runs its checks and its store write inside `serial`, the
// coordination mutex that holds `POST /api/runs` from its preconditions to its insert, so a plan write never lands between a
// run's plan check and its attach; attribution and any Linear read run before it, outside. `plan show` takes no lock.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GateDecision } from '../auth/gate.js';
import { linearEgressText } from '../linear/ops.js';
import { handedMail, inboundDoorVerdict, raisedItemInput, returnedMail, type InboundRecheck } from '../linear/inboundPolicy.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { isLinearTeamKey } from '../../../shared/linear.js';
import type { CoordinatorPresence } from '../../../shared/ledgers.js';
import { routableSlots, routeLinear } from '../linear/route.js';
import type { LinearStoreRead } from '../linear/store.js';
import { refuseOtherLane, refuseRoute, refuseRun } from '../refuse.js';
import type { OtherLane, OtherLaneReads } from './otherLanes.js';
import {
  LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX, isPlanKey,
  type CheckpointView, type EpicView, type InboundState, type PhaseView, type PlanPutBody, type PlanRefusal, type PlanView, type TicketView,
} from '../../../shared/plan.js';
import { programmeNameFromSlug } from '../../../shared/api.js';
import { publicTextVerdict } from '../linking/policy.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './token.js';
import type { AttributionRead } from './openRun.js';
import { evidenceLinksOf } from './planRunFacts.js';
import type { CoordStore } from './store.js';
import type { CoordRoutesHandle } from './routes.js';
import type { BindingRow, InboundRow, PhaseRow, PlanStorePort, StoredPlan } from './planStore.js';
import {
  diffPhases, diffPlan, parsePlanClose, parsePlanEpicDrop, parsePlanMet, parsePlanPhaseRef, parsePlanPut, parsePlanTake, parsePlanTicketAdd,
  parsePlanTicketDone, parsePlanTicketMove, parsePlanTriage, dropEpicInto, linearOwnerOfTeam, phaseNumbers, phaseRefVerdict,
  planCallerVerdict, teamOwnerProject, ticketDoneVerdict, ticketIsHeld, landedFactOf, triageVerdict, handedRowOf,
  type TicketDoneFacts,
} from './planPolicy.js';
import { inboundRetirable } from '../linear/inboundRetire.js';
import { NO_PLAN_CHANGES } from './planStore.js';
import type { RunVerdicts } from './runVerdicts.js';
import { withLastMoves } from './runWire.js';
import { doneEvidenceVerdict, verdictsReadOf, workMapOf, type DoneEvidenceFacts, type EvidenceVerdict } from './workMap.js';
import { WORK_READ_FAILED, type WorkAnswer } from '../../../shared/plan.js';

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
  /** Overlord W1 other lanes (H10): the reads `door` asks, after attribution, whether the caller is the Overlord's body. */
  otherLaneReads: OtherLaneReads;
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
  /** The session standing the console shows; the triage route needs only the owner's id, so absent reads `unmeasured`. */
  presenceOf?: (id: string) => CoordinatorPresence;
  /** The run verdicts reader (`RunVerdicts`, the watcher's), for the work map's stuck and blocked rows (programme work map WM2,
   *  D-8779). Absent (a test, a server with no watcher) or empty (before its first pass) reads `not-read`. */
  runVerdicts?: Pick<RunVerdicts, 'all'>;
  /** The by-id re-read of a stored inbound row's issue (review 2457 F4, D-8733): the lane's, through the one rate service. `plan take`
   *  and `plan triage` ask it BEFORE they act (outside the run writers' mutex), so an issue that left the managed teams is never
   *  bound. Absent (a test, a script): every row reads `unmeasured`, and the doors refuse `unreachable`. */
  inboundRecheck?: (row: InboundRow) => Promise<InboundRecheck>;
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
  ...(p.phases === undefined ? {} : {
    phases: p.phases.map((ph) => ({
      ...ph, title: mask(ph.title), summary: mask(ph.summary), ...(ph.droppedWhy === undefined ? {} : { droppedWhy: mask(ph.droppedWhy) }),
    })),
  }),
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

/** The phases as the wire says them, in order: each reference by its object's key, a carry by its target phase's key, and the
 *  number `phaseNumbers` derives. A reference whose object is not in the plan any more is left out. */
function phaseViewsOf(stored: StoredPlan, phases: readonly PhaseRow[]): PhaseView[] {
  const numbers = phaseNumbers(phases.map((p) => ({ key: p.key, dropped: p.droppedWhy !== null })));
  const epicKey = new Map(stored.epics.map((e) => [e.id, e.key]));
  const ticketKey = new Map(stored.epics.flatMap((e) => e.tickets.map((t) => [t.id, t.key] as const)));
  const phaseKey = new Map(phases.map((p) => [p.id, p.key]));
  return phases.map((p) => ({
    key: p.key, number: numbers.get(p.key) ?? null, title: p.title, summary: p.summary, dropped: p.droppedWhy !== null,
    refs: p.refs.flatMap((r) => {
      const key = (r.kind === 'epic' ? epicKey : ticketKey).get(r.refId);
      return key === undefined ? [] : [{
        kind: r.kind, key, carriedTo: r.carriedTo === null ? null : (phaseKey.get(r.carriedTo) ?? null), carriedAt: r.carriedAt,
      }];
    }),
  }));
}

/** One programme's plan as the wire says it (`PlanView`): the stored plan, each object's sync word from its bindings, and its
 *  phases when it declares any (absent otherwise, so a plan with no phases reads exactly as before WM0). */
export function planViewOf(
  stored: StoredPlan, doneWhen: readonly string[], bindings: readonly BindingRow[], teamKeyOf?: (project: string) => string | null,
  phases: readonly PhaseRow[] = [],
): PlanView {
  /** A record whose project has no team key reads `unsynced`: the sync sends nothing for it, its bindings stay untouched. */
  const syncFor = (project: string, rows: readonly BindingRow[] | undefined): Sync =>
    teamKeyOf !== undefined && teamKeyOf(project) === null ? { sync: 'unsynced', syncWord: null } : syncOf(rows);
  const by = new Map<string, BindingRow[]>();
  for (const b of bindings) by.set(`${b.localKind}:${b.localId}`, [...(by.get(`${b.localKind}:${b.localId}`) ?? []), b]);
  const epics: EpicView[] = stored.epics.map((e) => {
    const checkpoints: CheckpointView[] = e.checkpoints.map((c) => ({
      key: c.key, title: c.title, kind: c.kind, state: c.state, proves: c.proves, metAt: c.metAt, evidence: c.evidence, url: null,
      ...syncFor(e.project, by.get(`checkpoint:${c.id}`)),
    }));
    const tickets: TicketView[] = e.tickets.map((t) => ({
      key: t.key, kind: t.kind, title: t.title, project: t.project,
      checkpoint: e.checkpoints.find((c) => c.id === t.checkpointId)?.key ?? null, source: t.source, state: t.state,
      runId: t.runId, identifier: by.get(`ticket:${t.id}`)?.[0]?.identifier ?? null, url: null, ...syncFor(t.project, by.get(`ticket:${t.id}`)),
    }));
    return {
      key: e.key, title: e.title, summary: e.summary, project: e.project, waves: e.waves, state: e.state, url: null,
      ...syncFor(e.project, by.get(`epic:${e.id}`)), checkpoints, tickets,
    };
  });
  const live = stored.epics.filter((e) => e.state !== 'dropped');
  return {
    program: stored.program, planned: stored.epics.length > 0, initiatives: [], epics,
    doneWhen: doneWhen.map((text, i) => {
      const proving = live.flatMap((e) => e.checkpoints).filter((c) => c.state !== 'dropped' && c.proves.includes(i));
      return { text, proved: proving.length > 0 && proving.every((c) => c.state === 'met') };
    }),
    ...(phases.length === 0 ? {} : { phases: phaseViewsOf(stored, phases) }),
  };
}

// ── Registration ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A door's refusal: a plan word, or `unreachable`, the Linear read's existing 503 (a stored inbound row's issue could not be re-read). */
type Refused = { refuse: PlanRefusal | 'unreachable'; detail: string };
type Work = ((c: {
  coord: CoordStore; plan: PlanStorePort; slug: string; caller: string; body: unknown; stored: StoredPlan; owner: string | null;
  ws: ReadonlyMap<string, string | null>; rechecks: ReadonlyMap<string, InboundRecheck>;
}) => Promise<Refused | { ok: true; plan: PlanView }>) & { candidates?: TakeCandidates };

type TeamWork = ((c: {
  coord: CoordStore; plan: PlanStorePort; team: string; caller: string; body: unknown; ws: ReadonlyMap<string, string | null>; rechecks: ReadonlyMap<string, InboundRecheck>;
}) => Promise<Refused | { reserved: true } | { ok: true; state: InboundState }>) & { candidates?: TriageCandidates };

/** The stored rows a door will judge, named before the mutex so their issues can be re-read by id outside it (review 2457 F4). */
type TakeCandidates = (c: { coord: CoordStore; plan: PlanStorePort; slug: string; caller: string; body: unknown; ws: ReadonlyMap<string, string | null> }) => InboundRow[];
type TriageCandidates = (c: { coord: CoordStore; plan: PlanStorePort; team: string; caller: string; body: unknown; ws: ReadonlyMap<string, string | null> }) => InboundRow[];

/** A door's work with the rows it may re-read named (review 2457 F4): the door reads them before the mutex. */
const workWith = (candidates: TakeCandidates, fn: (c: Parameters<Work>[0]) => ReturnType<Work>): Work => Object.assign(fn, { candidates });
const teamWorkWith = (candidates: TriageCandidates, fn: (c: Parameters<TeamWork>[0]) => ReturnType<TeamWork>): TeamWork => Object.assign(fn, { candidates });

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
    planViewOf(plan.planOf(slug), coord.goalsFor(slug).doneWhen ?? [], plan.bindingsOf(slug), (p) => coord.linkingOf(p).teamKey,
      plan.phasesOf(slug));

  /** The plan read's `work` (programme work map WM2, D-8779; spec §7, D2 and D19): every read behind the map, gathered here and
   *  handed to `workMapOf`, which decides. The plan itself is `view`, read already. A read that fails answers its word, and
   *  the plan is still served (F15). */
  const workOf = (plan: PlanStorePort, coord: CoordStore, slug: string, view: PlanView): WorkAnswer => {
    try {
      const stored = plan.planOf(slug);
      const read = coord.programmeWorkRuns(slug);
      if (!read.ok) return { unreadable: read.kind };
      const runs = withLastMoves(coord, read.runs, (d) => console.warn(`ccrc-server: the work map of ${slug} could not read the runs' last moves (${d})`));
      const verdicts = verdictsReadOf(opts.runVerdicts?.all());
      const open = coord.itemsFor(slug, opts.now()).open;
      const openIds = new Set(open.map((i) => i.id));
      const checkpointItems = new Map<string, number>();
      for (const e of stored.epics) {
        for (const c of e.checkpoints) if (c.itemId !== null && openIds.has(c.itemId)) checkpointItems.set(`${e.key}/${c.key}`, c.itemId);
      }
      const facts = plan.doneFactsOf(slug);
      const storedEvidence = facts.flatMap((d) => (d.evidence === null ? [] : [{ project: d.project, evidence: d.evidence }]));
      const evidence = new Map<string, EvidenceVerdict>();
      const prLinks = new Map<string, TicketDoneFacts['links']>();
      for (const d of facts) {
        if (d.evidence === null) continue;
        let run: DoneEvidenceFacts['run'] = null;
        let landed: DoneEvidenceFacts['landed'] = null;
        if (d.evidence !== 'malformed' && 'runId' in d.evidence) {
          const r = coord.run(d.evidence.runId);
          if (!r.ok) return { unreadable: r.kind };
          run = r.run === null ? null
            : { program: r.run.program, kind: r.run.kind, state: r.run.state, ticketKey: plan.ticketOfRun(r.run.id)?.key ?? null };
        } else if (d.evidence !== 'malformed') {
          const l = coord.readLanding(d.project);
          landed = l.ok ? landedFactOf(l.facts.entries, d.evidence.pr) : { kind: 'unreadable', detail: l.error };
          // The runs that carried this pull request, each with the ticket it holds, for the fold (review 2795 F2).
          prLinks.set(d.key, evidenceLinksOf(coord, plan, d.evidence, d.project, storedEvidence));
        }
        evidence.set(d.key, doneEvidenceVerdict({ program: slug, ticketKey: d.key, evidence: d.evidence, run, landed }));
      }
      return workMapOf({
        plan: {
          ...view, declared: stored.planBy !== null, end: plan.planEndOf(slug),
          done: new Map(facts.map((d) => [d.key, { at: d.doneAt, evidence: d.evidence }])),
        },
        runs, verdicts, openItems: open.map((i) => ({ id: i.id, runId: i.runId })), checkpointItems, evidence, prLinks,
        // The hierarchy's close with a reason (its Task 4.3, F10) stores no programme ticket apart from a drop yet
        // (`plan take`'s close drops an Upkeep ticket), so no ticket reads closed until it does (D-8779).
        closed: new Map(),
      });
    } catch (e) {
      console.warn(`ccrc-server: the work map of ${slug} could not be read (${e instanceof Error ? e.message : String(e)})`);
      return { unreadable: WORK_READ_FAILED };
    }
  };

  const refuse = (reply: FastifyReply, word: Refused['refuse'], detail: string): FastifyReply => refuseRoute(reply, word, { detail });

  /** D-8181 (design §4.3): the public-text check on every text a plan verb is about to store, each judged by its own
   *  project's linking mode and team key (a project with no reading is `unknown`, which is public). Runs before the write, so
   *  a refused text stores nothing. The detail names the class (and a tracker id's ids), never the text. */
  const textRefusal = (coord: CoordStore, texts: ReadonlyArray<readonly [project: string | null, text: string | undefined, teamKey?: string]>): Refused | null => {
    for (const [project, text, issueTeam] of texts) {
      if (text === undefined || text === '') continue;
      // no project to read a linking mode from (round 5 A5): the mode is `unknown`, which design §6.1 treats as public; the
      // issue's own team key stands for the project's
      const l = project === null ? { teamKey: issueTeam ?? null, mode: 'unknown' as const } : coord.linkingOf(project);
      const v = publicTextVerdict(text, l.teamKey, l.mode, opts.privateTrackerKeys);
      if (!v.ok) return { refuse: v.word, detail: v.ids === undefined ? v.class : `${v.class}: ${v.ids.join(', ')}` };
    }
    return null;
  };

  const WRITE_LIMIT = { rateLimit: { max: 1200, timeWindow: '1 minute' } } as const;
  /** The box-token lane's verdict, answered `unauthenticated` on any but `ok`, whatever the sign-in flag says: no cookie takes its place. */
  const refuseToken = (reply: FastifyReply, verdict: ReturnType<typeof checkMailToken>): FastifyReply | undefined =>
    verdict === 'ok' ? undefined : refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });

  /** The identity pair from the QUERY, the stores' availability and the registry's attribution: the caller, or the reply that
   *  refused (every box-token door's first three checks, in this order). */
  const callerOf = async (req: FastifyRequest, reply: FastifyReply):
  Promise<{ ok: true; id: string; coord: CoordStore; plan: PlanStorePort } | { ok: false; reply: FastifyReply }> => {
    const q = (typeof req.query === 'object' && req.query !== null ? req.query : {}) as Record<string, unknown>;
    const id = q['byId'];
    if (typeof id !== 'string' || !IDENTITY_RE.test(id)) return { ok: false, reply: refuseRoute(reply, 'bad-request', { detail: 'byId' }) };
    const uuid = q['byUuid'];
    if (typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) return { ok: false, reply: refuseRoute(reply, 'bad-request', { detail: 'byUuid' }) };
    const { coord, plan } = opts;
    if (coord === undefined || plan === undefined) return { ok: false, reply: refuseRoute(reply, 'unavailable') };
    const attributed = await opts.attribute(id, uuid);
    if (!attributed.ok) return { ok: false, reply: refuseRoute(reply, attributed.error, { detail: attributed.detail }) };
    return { ok: true, id, coord, plan };
  };

  /** The by-id re-read of each row a door may act on (`inboundRetirable` rows only), keyed by the row's issue id. A reader that is absent
   *  or throws answers `unmeasured`: the door then refuses (`inboundDoorVerdict`), so no row is acted on unseen. */
  const recheckRows = async (rows: readonly InboundRow[]): Promise<Map<string, InboundRecheck>> => {
    const out = new Map<string, InboundRecheck>();
    for (const row of rows) {
      if (!inboundRetirable(row)) continue;
      let answer: InboundRecheck = { kind: 'unmeasured', word: null };
      try { if (opts.inboundRecheck !== undefined) answer = await opts.inboundRecheck(row); } catch { /* unmeasured */ }
      out.set(row.linearId, answer);
    }
    return out;
  };
  /** What a door does with a row after its issue was re-read (`inboundDoorVerdict`): null to go on; else the refusal, the row retired
   *  first when its issue left the managed teams, was completed or canceled. A retire writes only the state and its cause. */
  const recheckRefusal = (plan: PlanStorePort, row: InboundRow, rechecks: ReadonlyMap<string, InboundRecheck>, binds: boolean): Refused | null => {
    if (!inboundRetirable(row)) return null;
    const v = inboundDoorVerdict(rechecks.get(row.linearId), binds);
    if (v.kind === 'go') return null;
    if (v.kind === 'refuse') return { refuse: v.word, detail: 'Linear could not be read to confirm the issue is still inbound' };
    plan.retireInbound(row.linearId, v.why);
    return { refuse: v.word, detail: `${row.identifier} is no longer inbound` };
  };
  /** `plan take`'s row: the rows handed to THIS programme under the identifier (round 4 A2: the issue's workspace is its own, never
   *  the programme's), told apart by the programme home's workspace (`handedRowOf`, review 2457 F2). One reading for the candidates
   *  and the work. */
  const takeRowOf = (coord: CoordStore, plan: PlanStorePort, slug: string, issue: string, ws: ReadonlyMap<string, string | null>):
  { row: InboundRow | null; undecided: boolean; homeWorkspace: string | null } => {
    const home = coord.programHome(slug);
    const homeWorkspace = home === null ? null : ws.get(home) ?? null;
    const rows = plan.handedInboundByIdentifier(slug, issue);
    const row = handedRowOf(rows, homeWorkspace);
    // rows are handed but the home does not decide: nothing is chosen, and the Upkeep lookup is not reached (review 2524 A1)
    return { row, undecided: rows.length > 0 && row === null, homeWorkspace };
  };
  /** `plan triage`'s row: keyed by the workspace of the team's owning project (round 4 A2), and of that team. */
  const triageRowOf = (plan: PlanStorePort, team: string, issue: string, ws: ReadonlyMap<string, string | null>): InboundRow | null => {
    const holder = teamOwnerProject(team, plan.hierarchyProjectsOf());
    const found = plan.inboundByIdentifier(holder === null ? null : ws.get(holder) ?? null, issue);
    return found !== null && found.teamKey.toUpperCase() === team ? found : null;
  };

  /** A plan write's handler, after the route's own `onRequest` has checked the box token: the slug, the identity pair from the
   *  query, attribution, then the work inside `serial`. Each route is registered with its path spelled out (the gate's and the
   *  census's scans read registrations as literals) and hands its work to this. */
  const door = (lane: OtherLane, work: Work) => async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const slug = slugOf(req);
    if (slug === null) return refuseRoute(reply, 'bad-request', { detail: 'slug' });
    const who = await callerOf(req, reply);
    if (!who.ok) return who.reply;
    const { coord, plan, id } = who;
    // Overlord W1 other lanes (H10): before the reserved programme, the Linear store read and `serial`, so a refused
    // plan write reads no plan, takes no mutex and writes nothing.
    if (!(await refuseOtherLane(reply, lane, id, opts.otherLaneReads))) return reply;
    if (slug === LINEAR_SYNC_PROGRAMME) return refuseRun(reply, 'reserved-programme');
    // The Linear store is read here, outside the mutex; the work below reads each project's workspace from it.
    const ws = await workspaces(projectsIn(req.body, plan.planOf(slug), coord.programHome(slug)));
    // The re-read of a stored inbound row's issue is made here, outside the mutex: it waits on the rate service (review 2457 F4).
    const rechecks = work.candidates === undefined ? new Map<string, InboundRecheck>() : await recheckRows(work.candidates({ coord, plan, slug, caller: id, body: req.body, ws }));
    try {
      return await opts.serial(async () => {
        const stored = plan.planOf(slug);
        const out = await work({ coord, plan, slug, caller: id, body: req.body, stored, owner: plan.planOwnerOf(slug), ws, rechecks });
        return 'refuse' in out ? refuse(reply, out.refuse, out.detail) : out;
      });
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  };

  /** `plan triage`'s handler: the team key from the path, the identity pair, attribution, then the work inside `serial`. The
   *  Linear store is read first for the workspaces of the owner's project and of the programme a hand names. */
  const teamDoor = (lane: OtherLane, work: TeamWork) => async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const raw = (req.params as { team?: unknown }).team;
    if (!isLinearTeamKey(raw)) return refuseRoute(reply, 'bad-request', { detail: 'team' });
    const team = raw.toUpperCase();
    const who = await callerOf(req, reply);
    if (!who.ok) return who.reply;
    const { coord, plan, id } = who;
    // Overlord W1 other lanes (H10), as `door` does: before the Linear store read and `serial`.
    if (!(await refuseOtherLane(reply, lane, id, opts.otherLaneReads))) return reply;
    const named = typeof req.body === 'object' && req.body !== null && isPlanKey((req.body as Record<string, unknown>)['programme']) ? (req.body as Record<string, string>)['programme']! : null;
    const projects = new Set<string>(named === null ? [] : plan.planOf(named).epics.map((e) => e.project));
    const holder = teamOwnerProject(team, plan.hierarchyProjectsOf());
    if (holder !== null) projects.add(holder);
    const ws = await workspaces(projects);
    const rechecks = work.candidates === undefined ? new Map<string, InboundRecheck>() : await recheckRows(work.candidates({ coord, plan, team, caller: id, body: req.body, ws }));
    try {
      return await opts.serial(async () => {
        const out = await work({ coord, plan, team, caller: id, body: req.body, ws, rechecks });
        return 'reserved' in out ? refuseRun(reply, 'reserved-programme') : 'refuse' in out ? refuse(reply, out.refuse, out.detail) : out;
      });
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  };

  /** The verdict of a programme verb (the owner's alone) or a follow-up (a worker's, into its own run's epic). */
  const ownerVerdict = (caller: string, owner: string | null) =>
    planCallerVerdict(caller, owner, 'programme', opts.runOfSession(caller));

  /** The rows `plan triage` may re-read before the mutex: only the team's Linear owner causes a read, any other caller is refused by
   *  the work with no Linear call. */
  const triageCandidates: TriageCandidates = ({ plan, team, caller, body, ws }) => {
    // only the team's Linear owner may cause a read: any other caller is refused by the work with no Linear call
    const parsed = parsePlanTriage(body);
    const owner = linearOwnerOfTeam(team, plan.hierarchyProjectsOf(), ownerFacts(plan));
    if (!parsed.ok || owner === null || owner.id !== caller) return [];
    const row = triageRowOf(plan, team, parsed.triage.issue, ws);
    return row === null ? [] : [row];
  };
  /** The rows `plan take` may re-read before the mutex: only the programme's coordinator causes a read. */
  const takeCandidates: TakeCandidates = ({ coord, plan, slug, caller, body, ws }) => {
    // only the programme's coordinator may cause a read: any other caller is refused by the work with no Linear call
    const parsed = parsePlanTake(body);
    if (!parsed.ok || !ownerVerdict(caller, plan.planOwnerOf(slug)).ok) return [];
    const { row } = takeRowOf(coord, plan, slug, parsed.take.issue, ws);
    return row === null ? [] : [row];
  };

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
  }, door('planDeclare', async ({ coord, plan, slug, caller, body, stored, owner, ws }) => {
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
    for (const ph of parsed.put.phases ?? []) texts.push([home, ph.title], [home, ph.summary], [home, ph.droppedWhy]);
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
    const ph = diffPhases(stored, plan.phasesOf(slug), put);
    if (!ph.ok) return { refuse: ph.word, detail: ph.detail };
    const newRow = exists ? null : { home, title: put.title ?? programmeNameFromSlug(slug) };
    plan.applyPlanChanges(slug, ph.changes === undefined ? d.changes : { ...d.changes, phases: ph.changes }, caller, opts.now(), newRow);
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan met`
  app.post('/api/programmes/:slug/plan/met', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/met')),
  }, door('planMet', async ({ coord, plan, slug, caller, body, stored, owner }) => {
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
  }, door('planTickets', async ({ coord, plan, slug, caller, body, stored, owner, ws }) => {
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
  }, door('planTicketsMove', async ({ coord, plan, slug, caller, body, stored, owner, ws }) => {
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

  // `plan ticket-done` (programme work map WM1, D-8727; spec §4.1 D11): a ticket finished another way is recorded done with
  // evidence that verifies. The route gathers the facts (the run and its own ticket, the landing line of the ticket's own
  // project, the evidence the programme's tickets already hold); `ticketDoneVerdict` decides; `markTicketDone` writes.
  app.post('/api/programmes/:slug/plan/tickets/done', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/tickets/done')),
  }, door('planTicketsDone', async ({ coord, plan, slug, caller, body, stored, owner }) => {
    const parsed = parsePlanTicketDone(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator records a ticket done' };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
    const { ticket: key, evidence } = parsed.done;
    const found = ticketOf(stored, key);
    if (found === undefined) return { refuse: 'unknown-ticket', detail: `no ticket ${key}` };
    const t = found.ticket;
    let run: TicketDoneFacts['run'] = null;
    if ('runId' in evidence) {
      const read = coord.run(evidence.runId);
      if (!read.ok) return { refuse: 'evidence-unverified', detail: `run ${evidence.runId} could not be read (${read.kind})` };
      const own = read.run === null ? null : plan.ticketOfRun(evidence.runId);
      run = read.run === null || own === null ? null
        : { program: read.run.program, kind: read.run.kind, state: read.run.state, ticketId: own.ticketId, ticketKey: own.key };
    }
    let landed: TicketDoneFacts['landed'] = null;
    if ('pr' in evidence) {
      const read = coord.readLanding(t.project);
      landed = read.ok ? landedFactOf(read.facts.entries, evidence.pr) : { kind: 'unreadable', detail: read.error };
    }
    // Every stored evidence goes to the verdict as the reader gave it, `malformed` included: the verdict decides (review 2712 F3).
    const storedEvidence = plan.doneFactsOf(slug).flatMap((d) =>
      d.evidence === null ? [] : [{ ticketId: d.ticketId, key: d.key, project: d.project, evidence: d.evidence }]);
    const v = ticketDoneVerdict({
      program: slug, ticket: { id: t.id, key: t.key, project: t.project, state: t.state, runId: t.runId }, evidence, run, landed,
      stored: storedEvidence, links: evidenceLinksOf(coord, plan, evidence, t.project, storedEvidence),
    });
    if (!v.ok) return { refuse: v.word, detail: v.detail };
    plan.markTicketDone(t.id, evidence, opts.now());
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan epic-drop`
  app.post('/api/programmes/:slug/plan/epics/drop', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/epics/drop')),
  }, door('planEpicsDrop', async ({ coord, plan, slug, caller, body, stored, owner }) => {
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

  // `plan phase-ref` (programme work map WM0, D17): add or remove one reference of a phase, or carry a ticket to a later one.
  app.post('/api/programmes/:slug/plan/phases/refs', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/phases/refs')),
  }, door('planPhaseRefs', async ({ coord, plan, slug, caller, body, stored, owner }) => {
    const parsed = parsePlanPhaseRef(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator changes its phases' };
    if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
    const v = phaseRefVerdict(parsed.move, stored, plan.phasesOf(slug));
    if (!v.ok) return { refuse: v.word, detail: v.detail };
    if (v.write.kind !== 'none') plan.writePhaseRef(v.write, opts.now());
    return { ok: true, plan: viewOf(plan, coord, slug) };
  }));

  // `plan close`
  app.post('/api/programmes/:slug/plan/close', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/close')),
  }, door('planClose', async ({ coord, plan, slug, caller, body, owner }) => {
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

  // ── The inbound path (D-8183, design §7.5) ──

  /** The row's text as it is judged and stored on a ticket: shape-redacted for Linear, as every plan text is. */
  const rowTextUnfit = (coord: CoordStore, project: string, row: InboundRow): Refused | null =>
    textRefusal(coord, [[project, row.title], [project, row.body ?? '']]);
  /** An issue in another workspace than the destination project's cannot be bound there (the sync would fail it). */
  const wsClash = (ws: ReadonlyMap<string, string | null>, project: string, workspaceId: string): boolean => {
    const w = ws.get(project) ?? null;
    return w !== null && w !== workspaceId;
  };
  const ownerFacts = (plan: PlanStorePort) => ({
    latestProgrammeCoordinator: (p: string) => plan.latestProgrammeCoordinator(p), presence: opts.presenceOf ?? ((): CoordinatorPresence => 'unmeasured'),
  });

  /** THE ONE TAKE of an inbound issue into an epic (`plan take` of a handed issue, and a `hand` to the owner's own programme,
   *  D-8706): the epic and checkpoint must be live, the reporter's text is judged by the epic's project, the issue's workspace
   *  must be the epic's, and then the ticket, its adopted binding and the row's `taken` are one transaction. */
  const takeInto = (c: { coord: CoordStore; plan: PlanStorePort; slug: string; row: InboundRow; epic: string; checkpoint?: string; ws: ReadonlyMap<string, string | null> }):
  Refused | { ok: true; state: 'taken' } => {
    const stored = c.plan.planOf(c.slug);
    const epic = epicOf(stored, c.epic);
    if (epic === undefined) return { refuse: 'unknown-epic', detail: `no epic ${c.epic}` };
    const cp = c.checkpoint === undefined ? null : epic.checkpoints.find((x) => x.key === c.checkpoint && x.state !== 'dropped') ?? null;
    if (c.checkpoint !== undefined && cp === null) return { refuse: 'unknown-checkpoint', detail: `no checkpoint ${c.checkpoint} in epic ${c.epic}` };
    const unfit = rowTextUnfit(c.coord, epic.project, c.row);
    if (unfit !== null) return unfit;
    if (wsClash(c.ws, epic.project, c.row.workspaceId)) return { refuse: 'ticket-workspace-mismatch', detail: `issue ${c.row.identifier} is in another workspace than epic ${c.epic}` };
    const done = c.plan.takeInboundIntoEpic({ linearId: c.row.linearId, program: c.slug, epicId: epic.id, checkpointId: cp?.id ?? null, project: epic.project, now: opts.now(), mask });
    return done.ok ? { ok: true, state: 'taken' } : { refuse: done.refused, detail: `issue ${c.row.identifier} is no longer inbound` };
  };

  // `plan triage`: the team's Linear owner decides an inbound issue.
  app.post('/api/teams/:team/plan/triage', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/teams/:team/plan/triage')),
  }, teamDoor('planTriage', teamWorkWith(triageCandidates, async ({ coord, plan, team, caller, body, ws, rechecks }) => {
    const parsed = parsePlanTriage(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const t = parsed.triage;
    const owner = linearOwnerOfTeam(team, plan.hierarchyProjectsOf(), ownerFacts(plan));
    // keyed by the workspace of the team's owning project (round 4 A2): another workspace's alike-keyed team never answers
    const row = triageRowOf(plan, team, t.issue, ws);
    const verdict = triageVerdict(caller, owner ?? { id: null }, row);
    if (!verdict.ok) return { refuse: verdict.word, detail: verdict.word === 'not-linear-owner' ? `only the Linear owner of team ${team} triages its issues` : `${t.issue} is not waiting for triage in team ${team}` };
    if (row === null || owner === null) return { refuse: 'issue-not-inbound', detail: `${t.issue} is not waiting for triage in team ${team}` };
    // the issue was re-read by id before the mutex (review 2457 F4): one that left the managed teams is retired, never decided
    const left = recheckRefusal(plan, row, rechecks, t.decision === 'upkeep' || t.decision === 'hand');
    if (left !== null) return left;
    const now = opts.now();
    switch (t.decision) {
      case 'hand': {
        const slug = t.programme!;
        if (slug === LINEAR_SYNC_PROGRAMME) return { reserved: true };
        if (!coord.programs().some((p) => p.slug === slug)) return { refuse: 'plan-bad-body', detail: `no programme ${slug}` };
        if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
        const coordinator = plan.planOwnerOf(slug);
        if (coordinator === null) return { refuse: 'plan-bad-body', detail: `the programme ${slug} has no coordinator` };
        if (coordinator === caller) {
          // D-8706: a hand to the owner's own programme takes the issue at once, so the epic is required.
          if (t.epic === undefined) return { refuse: 'plan-bad-body', detail: 'a hand to your own programme is taken at once: name the epic' };
          return takeInto({ coord, plan, slug, row, epic: t.epic, ...(t.checkpoint === undefined ? {} : { checkpoint: t.checkpoint }), ws });
        }
        const m = handedMail(row, slug, t.note === undefined ? undefined : mask(t.note));
        plan.inTransaction(() => {
          insertSystemMailTx(coord, { program: slug }, { fromId: 'operator', toId: coordinator, runId: null, kind: 'question', subject: m.subject, body: m.body });
          plan.setInboundState(row.linearId, { state: 'handed', handedTo: slug });
        });
        return { ok: true, state: 'handed' };
      }
      case 'upkeep': {
        const unfit = rowTextUnfit(coord, owner.project, row);
        if (unfit !== null) return unfit;
        if (wsClash(ws, owner.project, row.workspaceId)) return { refuse: 'ticket-workspace-mismatch', detail: `issue ${row.identifier} is in another workspace than project ${owner.project}` };
        const done = plan.placeInboundInUpkeep({ linearId: row.linearId, project: owner.project, now, mask });
        return done.ok ? { ok: true, state: 'placed' } : { refuse: done.refused, detail: `${t.issue} is no longer inbound` };
      }
      case 'close': {
        const reason = t.reason!;
        const unfit = textRefusal(coord, [[owner.project, reason]]);
        if (unfit !== null) return unfit;
        plan.setInboundState(row.linearId, { state: 'closed', reason: mask(reason) });
        return { ok: true, state: 'closed' };
      }
      case 'raise': {
        coord.raiseItemWithMail(raisedItemInput(row, t.note === undefined ? undefined : mask(t.note)), now, 'ccrc',
          (itemId) => plan.setInboundState(row.linearId, { state: 'raised', itemId }));
        return { ok: true, state: 'raised' };
      }
    }
  })));

  // `plan take`: a programme's coordinator takes a handed issue or an Upkeep ticket into an epic of its plan, closes it, or returns it.
  app.post('/api/programmes/:slug/plan/take', {
    config: WRITE_LIMIT,
    onRequest: async (req, reply) => refuseToken(reply, checkMailToken(opts.mailToken(), req.headers[MAIL_TOKEN_HEADER], 'POST /api/programmes/:slug/plan/take')),
  }, door('planTake', workWith(takeCandidates, async ({ coord, plan, slug, caller, body, stored, owner, ws, rechecks }) => {
    const parsed = parsePlanTake(body);
    if (!parsed.ok) return { refuse: parsed.word, detail: parsed.detail };
    const verdict = ownerVerdict(caller, owner);
    if (!verdict.ok) return { refuse: verdict.word, detail: 'only the programme\'s coordinator takes an issue' };
    const t = parsed.take;
    const now = opts.now();
    // the row handed to THIS programme (round 4 A2, review 2457 F2): `takeRowOf`, none chosen when the home does not decide
    const { row: handed, undecided, homeWorkspace } = takeRowOf(coord, plan, slug, t.issue, ws);
    if (undecided) return { refuse: 'issue-not-inbound', detail: `${t.issue} was handed to ${slug} in more than one workspace and the programme's home does not say which` };
    if (handed !== null) {
      // the issue was re-read by id before the mutex (review 2457 F4): one that left the managed teams is retired, never taken
      const left = recheckRefusal(plan, handed, rechecks, 'epic' in t);
      if (left !== null) return left;
    }
    const parked = handed === null ? plan.upkeepTicketByIdentifier(homeWorkspace, t.issue) : null;
    const upkeep = parked !== null && parked.state === 'open' ? parked : null;
    if (handed === null && upkeep === null) return { refuse: 'issue-not-inbound', detail: `${t.issue} was not handed to ${slug} and is not an Upkeep ticket` };
    const ok = (): { ok: true; plan: PlanView } => ({ ok: true, plan: viewOf(plan, coord, slug) });
    if ('epic' in t) {
      if (plan.planEndOf(slug) !== null) return { refuse: 'plan-closed', detail: 'the plan was closed' };
      if (handed !== null) {
        const out = takeInto({ coord, plan, slug, row: handed, epic: t.epic, ...(t.checkpoint === undefined ? {} : { checkpoint: t.checkpoint }), ws });
        return 'refuse' in out ? out : ok();
      }
      const epic = epicOf(stored, t.epic);
      if (epic === undefined) return { refuse: 'unknown-epic', detail: `no epic ${t.epic}` };
      const cp = t.checkpoint === undefined ? null : epic.checkpoints.find((x) => x.key === t.checkpoint && x.state !== 'dropped') ?? null;
      if (t.checkpoint !== undefined && cp === null) return { refuse: 'unknown-checkpoint', detail: `no checkpoint ${t.checkpoint} in epic ${t.epic}` };
      const unfit = textRefusal(coord, [[epic.project, upkeep!.title], [epic.project, upkeep!.body]]);
      if (unfit !== null) return unfit;
      const bound = plan.bindingsOf(`${UPKEEP_DUE_PREFIX}${upkeep!.project}`).find((b) => b.localKind === 'ticket' && b.localId === upkeep!.id);
      if (bound !== undefined && wsClash(ws, epic.project, bound.workspaceId)) return { refuse: 'ticket-workspace-mismatch', detail: `issue ${t.issue} is in another workspace than epic ${t.epic}` };
      plan.takeUpkeepTicket({ ticketId: upkeep!.id, program: slug, epicId: epic.id, checkpointId: cp?.id ?? null, now });
      return ok();
    }
    if ('close' in t) {
      const project = upkeep !== null ? upkeep.project : teamOwnerProject(handed!.teamKey, plan.hierarchyProjectsOf()) ?? coord.programHome(slug);
      // no project at all is judged as a public one (round 5 A5): the check is never skipped
      const unfit = textRefusal(coord, [[project, t.close.why, handed?.teamKey]]);
      if (unfit !== null) return unfit;
      if (handed !== null) plan.setInboundState(handed.linearId, { state: 'closed', reason: mask(t.close.why) });
      else plan.updateTicket(upkeep!.id, { state: 'dropped', droppedWhy: mask(t.close.why) }, now);
      return ok();
    }
    // return: a handed issue goes back to the team's Linear owner; an Upkeep ticket has no one to return to.
    if (handed === null) return { refuse: 'plan-bad-body', detail: 'an Upkeep ticket is not handed to anyone: take it or close it' };
    const owner2 = linearOwnerOfTeam(handed.teamKey, plan.hierarchyProjectsOf(), ownerFacts(plan));
    if (owner2 === null || owner2.id === null || owner2.gone) {
      // the return is kept (review 2443 A3, D-8734): the lane mails it, with its note, to the owner once there is a live one
      const note = mask(t.return.note);
      plan.inTransaction(() => {
        plan.setInboundState(handed.linearId, { state: 'waiting', handedTo: null, mailedTo: null, mailedAt: null });
        plan.setInboundNote(handed.linearId, { kind: 'returned', program: slug, note, at: now });
      });
    } else {
      const toId = owner2.id;
      const m = returnedMail(handed, slug, mask(t.return.note));
      plan.inTransaction(() => {
        insertSystemMailTx(coord, { program: slug }, { fromId: 'operator', toId, runId: null, kind: 'question', subject: m.subject, body: m.body });
        plan.setInboundState(handed.linearId, { state: 'mailed', handedTo: null, mailedTo: toId, mailedAt: now });
      });
    }
    return ok();
  })));

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
    const view = viewOf(plan, coord, slug);
    return reply.code(200).send({ ok: true, plan: view, work: workOf(plan, coord, slug, view) });
  });

}
