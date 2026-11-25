// L4 delivery, context Coordination: the programme lifecycle's doors (programme lifecycle spec 2026-11-24 §5, §8, §11, §14;
// W2; D-8987, D-8989, D-8992, D-8993). The handlers live here and are REGISTERED from `ledgersRoutes.ts` (the operator's
// doors in `registerLedgerOperatorRoutes`, the coordinator's end proposal in `registerLedgerCoordinatorRoutes`), so the
// census reads their registrations where it reads every ledger door. Each handler measures, asks the L1 decider
// (`programmeEdgePolicy.ts`), and acts through the store's one-transaction acts; it decides nothing itself.
//
// THE CREDENTIAL RULE (spec §14) is `doorCredential`'s table: pause and decline work while sign-in is dark and record actor
// `unmeasured` with `flag-off`; the start takes the account gate; resume, end, reopen, repair, the hand-over and the
// confirm take its step-up, so they refuse while sign-in is dark.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import { END_REQUEST_REFUSALS } from '../../../shared/refusal.js';
import type { AccountGate } from '../accounts/gate.js';
import type { GateDecision } from '../auth/gate.js';
import type { CallerIdentity } from '../auth/callerIdentity.js';
import { deviceActor } from '../ccdargv.js';
import { DARK_MARK_ACTOR } from './answerMarks.js';
import { isRegistryId, programmeNameFromSlug, shapeProgramSlug } from '../../../shared/api.js';
import { ITEM_TEXT_MAX, doneWhenOf } from '../../../shared/ledgers.js';
import {
  NO_PROGRAMME_SENTENCE, PROGRAMME_STORED_STATES, isProgrammeStateEdge, lifecycleOf, type CoordinatorRegistryReading, type PlaceholderState,
  type ProgrammeDoorAct, type ProgrammeEndOutcome, type ProgrammeStoredState, type SessionProgrammeAnswer,
} from '../../../shared/programmeLifecycle.js';
import type { CoordStore, ItemRow } from './store.js';
import type { CoordRoutesHandle } from './routes.js';
import type { CloseOutcome } from './close.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { measureHeir, reclaimProgrammeTo, type ReclaimOutcome, type ReclaimRunDeps } from './reclaim.js';
import type { ProgrammeActor } from './programmeLifecycleStore.js';
import {
  doorCredential, edgeDecision, endProposalDecision, endProposalItem, parseEvidence, startDecision, type EdgeRefusal, type EdgeRequest,
} from './programmeEdgePolicy.js';
import type { AttributionRead } from './openRun.js';
import { LEDGER_ROUTE_REFUSALS } from '../../../shared/refusal.js';
import { withLifecycleFields } from './programmeLifecycleView.js';
import type { ProgrammesAnswer } from '../../../shared/api.js';

/** What the operator's lifecycle doors need beyond the ledger operator deps: the reclaim ladder's ports (the start naming a
 *  session, the hand-over), the coordination serialiser, and one registry reading of a session. Absent (a narrow test, or
 *  no coordination store), the doors that measure a session answer `not-configured`. */
export interface ProgrammeDoorPorts {
  readonly reclaim: ReclaimRunDeps;
  readonly serial: CoordRoutesHandle['serial'];
  readonly readingOf: (session: string) => Promise<CoordinatorRegistryReading>;
  /** The box-token lanes' sender check (`attributionVerdict`), for the two reads' token arm (spec §14). */
  readonly attribute: (id: string, uuid: string) => Promise<AttributionRead>;
}

export interface ProgrammeDoorDeps {
  readonly coord: CoordStore | undefined;
  readonly now: () => number;
  readonly gate: AccountGate;
  readonly identity: Pick<CallerIdentity, 'operator'>;
  readonly authEnabled: boolean;
  readonly sessionAuth: (req: FastifyRequest) => GateDecision;
  readonly withAbandon: CoordRoutesHandle['withAbandon'];
  readonly sendClose: (reply: FastifyReply, outcome: CloseOutcome) => FastifyReply;
  readonly changed: () => void;
  readonly ports?: ProgrammeDoorPorts | undefined;
}

type Body = Record<string, unknown>;
const isObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null =>
  (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null);
const bad = (reply: FastifyReply, detail: string) => refuseRoute(reply, 'bad-request', { detail });
const FLAG_OFF = { signIn: DARK_MARK_ACTOR } as const;

/** The system mail one programme act owes a session. `insertSystemMailTx` opens no transaction: every caller here runs it
 *  inside the act's own (`decideProgramme`'s `onReleased`, the confirm's and decline's callbacks, the move's `onMoved`). */
function mailTo(coord: CoordStore, toId: string, subject: string, body: string): void {
  insertSystemMailTx(coord, null, { fromId: 'operator', toId, runId: null, kind: 'status', subject, body });
}

/** "You own no programme now" (spec §7, §9): one mail to a session an act left owning nothing. */
export function noProgrammeMail(coord: CoordStore, session: string, cause: string): void {
  mailTo(coord, session, 'You own no programme now', `${cause}. ${NO_PROGRAMME_SENTENCE}`);
}

/** The reclaim ladder's refusals as the reclaim door answers them, for the start and the hand-over. */
function sendReclaimRefusal(reply: FastifyReply, r: Extract<ReclaimOutcome, { ok: false }> | { ok: false; kind: 'unknown-programme' }) {
  switch (r.kind) {
    case 'owns-another-programme': return refuseRoute(reply, 'owns-another-programme', { by: r.by, detail: `it owns ${r.by}: one coordinator owns one programme` });
    case 'unknown-programme': return refuseRoute(reply, 'unknown-programme');
    case 'unknown-session': return reply.code(404).send({ ok: false, error: 'unknown-session' });
    case 'registry-unmeasurable': return reply.code(502).send({ ok: false, error: 'registry-unmeasurable', detail: r.detail });
    case 'run-unreadable': return reply.code(503).send({ ok: false, error: 'run-unreadable', detail: r.detail });
    case 'unknown-run': return reply.code(404).send({ ok: false, error: 'unknown-run' });
    default:
      return reply.code(409).send({ ok: false, refused: r.kind, ...('by' in r ? { by: r.by } : {}), ...('detail' in r ? { detail: r.detail } : {}) });
  }
}

export function programmeDoors(deps: ProgrammeDoorDeps) {
  /** The credential of `act` (spec §14), asked FIRST: the actor to record and whether sign-in was dark, or null with the
   *  refusal sent. The operator's console doors only; the Overlord's door (W7) is its rung cell. */
  const credential = (req: FastifyRequest, reply: FastifyReply, act: ProgrammeDoorAct):
    { actor: ProgrammeActor; dark: boolean } | null => {
    const need = doorCredential(act, 'operator');
    if (need === 'dark-ok') {
      if (!deps.authEnabled) return { actor: { kind: 'operator', id: 'unmeasured' }, dark: true };
      return { actor: { kind: 'operator', id: deviceActor(deps.sessionAuth(req).device) }, dark: false };
    }
    const g = deps.gate(req, reply, { cap: null, ...(need === 'step-up' ? { stepUp: true } : {}) });
    if (!g.pass) return null;
    return { actor: { kind: 'operator', id: deps.identity.operator(g.actor).subject }, dark: false };
  };
  const slugOf = (req: FastifyRequest): string => (req.params as { slug: string }).slug;

  /** `POST /api/programmes {slug, title?, why, coordinator}` (spec §5's start row): the account gate; a free, well-formed slug
   *  (`slug-taken`); a why; a named live session that passes the heir's rungs and R11 rule 4 (`owns-another-programme`). An
   *  absent `coordinator` is `coordinator-required` until the join sweep ships the pick (W4). */
  async function start(req: FastifyRequest, reply: FastifyReply) {
    const cred = credential(req, reply, 'start');
    if (cred === null) return reply;
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const b = isObject(req.body) ? req.body : null;
    if (b === null) return bad(reply, 'the body is an object');
    const raw = b['slug'];
    const shaped = typeof raw === 'string' ? shapeProgramSlug(raw) : null;
    if (shaped === null || !shaped.ok || shaped.slug !== raw) return bad(reply, shaped !== null && !shaped.ok ? shaped.detail : 'slug is a programme slug');
    const why = text(b['why'], ITEM_TEXT_MAX);
    if (why === null) return refuseRoute(reply, 'why-required', { detail: `a start needs a why of 1 to ${ITEM_TEXT_MAX} characters` });
    const title = b['title'] === undefined ? programmeNameFromSlug(raw) : text(b['title'], 200);
    if (title === null) return bad(reply, 'title is 1 to 200 characters');
    const named = b['coordinator'];
    const must = startDecision('operator', named !== undefined && named !== null);
    if (!must.ok) return refuseRoute(reply, must.why, { detail: must.detail });
    if (typeof named !== 'string' || !isRegistryId(named)) return bad(reply, 'coordinator is a registry session id');
    const ports = deps.ports;
    if (ports === undefined) return refuseRoute(reply, 'not-configured');
    return ports.serial(async () => {
      const heir = await measureHeir({ ...ports.reclaim, coord }, named);
      if (!heir.ok) return sendReclaimRefusal(reply, heir.refusal);
      const now = deps.now();
      const out = coord.startProgramme({ slug: raw, title, actor: cred.actor, why, coordinator: { session: named, uuid: heir.toUuid } }, now);
      if (!out.ok) {
        return out.why === 'slug-taken' ? refuseRoute(reply, 'slug-taken', { detail: `programme ${raw} already exists` })
          : refuseRoute(reply, 'owns-another-programme', { by: out.by, detail: `${named} owns ${out.by ?? 'another programme'}: one coordinator owns one programme` });
      }
      deps.changed();
      return reply.code(200).send({ ok: true, slug: raw, coordinator: named });
    });
  }

  /** The state door's body (spec §5): `edge`, `why`, and `outcome` with `abandonRuns` for an end, `to` for a repair. */
  const parseEdge = (b: Body): { ok: true; req: EdgeRequest } | { ok: false; detail: string } => {
    const edge = b['edge'];
    if (!isProgrammeStateEdge(edge)) return { ok: false, detail: 'edge is one of pause, resume, end, reopen, repair' };
    if (edge === 'end') {
      const outcome = b['outcome'];
      if (outcome !== 'done' && outcome !== 'abandoned') return { ok: false, detail: 'an end names outcome done or abandoned' };
      const ab = b['abandonRuns'];
      if (ab !== undefined && typeof ab !== 'boolean') return { ok: false, detail: 'abandonRuns is a boolean' };
      return { ok: true, req: { edge, outcome, abandonRuns: ab === true } };
    }
    if (edge === 'repair') {
      const to = b['to'];
      if (typeof to !== 'string' || to === 'unknown' || !(PROGRAMME_STORED_STATES as readonly string[]).includes(to)) {
        return { ok: false, detail: 'a repair names to: active, paused, done or abandoned' };
      }
      return { ok: true, req: { edge, to: to as Exclude<ProgrammeStoredState, 'unknown'> } };
    }
    return { ok: true, req: { edge } };
  };

  /** `POST /api/programmes/:slug/state` (spec §5's pause, resume, end, reopen and repair rows). */
  async function state(req: FastifyRequest, reply: FastifyReply) {
    const b = isObject(req.body) ? req.body : null;
    if (b === null) return bad(reply, 'the body is an object');
    const parsed = parseEdge(b);
    if (!parsed.ok) return bad(reply, parsed.detail);
    const cred = credential(req, reply, parsed.req.edge as ProgrammeDoorAct);
    if (cred === null) return reply;
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const why = text(b['why'], ITEM_TEXT_MAX);
    if (why === null) return refuseRoute(reply, 'why-required', { detail: `an edge needs a why of 1 to ${ITEM_TEXT_MAX} characters` });
    const slug = slugOf(req);
    /** Read, decide and write with no await between them (the abandon arm awaits before, inside the hold). */
    const decideNow = () => {
      const row = coord.programmeLifecycleRow(slug);
      if (row === null) return refuseRoute(reply, 'unknown-programme', { detail: `no programme ${slug}` });
      const d = edgeDecision({ stored: row.state, placeholder: row.placeholder, openRuns: coord.programOpenRunCount(slug) }, parsed.req);
      if (!d.ok) return refuseRoute(reply, d.why, { detail: d.detail });
      if (d.kind !== 'decide') return refuseRoute(reply, 'bad-request');
      const now = deps.now();
      // An end closes the open end proposal in its own transaction (`decideInTx`). A repair records the unreadable value it replaces (spec §5's repair row); a dark act records `flag-off`.
      const detail = { ...(cred.dark ? FLAG_OFF : {}), ...(parsed.req.edge === 'repair' ? { unreadable: row.state } : {}) };
      const res = coord.decideProgramme({ slug, to: d.to, edge: d.event, actor: cred.actor, why,
        ...(Object.keys(detail).length > 0 ? { detail } : {}) },
      now, (released) => noProgrammeMail(coord, released, `${slug} ended (${d.to}): ${why}`));
      if (!res.ok) return refuseRoute(reply, 'programme-ended', { detail: `programme ${slug} has already ended (${res.state})` });
      deps.changed();
      const after = coord.programmeLifecycleRow(slug);
      return reply.code(200).send({ ok: true, slug, state: after?.state ?? d.to, changed: res.changed, released: res.released });
    };
    if (parsed.req.edge !== 'end' || !parsed.req.abandonRuns) return decideNow();
    // An Abandoned end over open runs (spec §5): every open run is ended first through the abandon door's own decision, on
    // the coordination serialiser; the first refusal stops the door before anything is ended.
    return deps.withAbandon(coord, async (abandon, refusalOf) => {
      const row = coord.programmeLifecycleRow(slug);
      if (row === null) return refuseRoute(reply, 'unknown-programme', { detail: `no programme ${slug}` });
      const d = edgeDecision({ stored: row.state, placeholder: row.placeholder, openRuns: coord.programOpenRunCount(slug) }, parsed.req);
      if (!d.ok) return refuseRoute(reply, d.why, { detail: d.detail });
      const ids = coord.programmeOpenRunIds(slug);
      for (const id of ids) { const r = refusalOf(id); if (r !== null) return deps.sendClose(reply, r); }
      for (const id of ids) { const out = await abandon(id, `abandoned with the end of programme ${slug}: ${why}`); if (!out.ok) return deps.sendClose(reply, out); }
      return decideNow();
    });
  }

  /** `POST /api/programmes/:slug/coordinator {session, why}` (spec §5's hand-over row; §3's ladder: rung 1
   *  `unknown-programme`, rung 2 skipped, rung 3 asked, rung 4 skipped as `displacing`, R11 rule 4 asked). Every displaced
   *  session is mailed and the heir is told it owns the programme, in the move's transaction; an open end proposal stays open. */
  async function handOver(req: FastifyRequest, reply: FastifyReply) {
    const cred = credential(req, reply, 'hand-over');
    if (cred === null) return reply;
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const b = isObject(req.body) ? req.body : null;
    if (b === null) return bad(reply, 'the body is an object');
    const heir = b['session'];
    if (typeof heir !== 'string' || !isRegistryId(heir)) return bad(reply, 'session is a registry session id');
    const why = text(b['why'], ITEM_TEXT_MAX);
    if (why === null) return refuseRoute(reply, 'why-required', { detail: `a hand-over needs a why of 1 to ${ITEM_TEXT_MAX} characters` });
    const ports = deps.ports;
    if (ports === undefined) return refuseRoute(reply, 'not-configured');
    const slug = slugOf(req);
    return ports.serial(async () => {
      const row = coord.programmeLifecycleRow(slug);
      if (row === null) return refuseRoute(reply, 'unknown-programme', { detail: `no programme ${slug}` });
      const d = edgeDecision({ stored: row.state, placeholder: row.placeholder, openRuns: 0 }, { edge: 'hand-over' });
      if (!d.ok) return refuseRoute(reply, d.why, { detail: d.detail });
      const from = row.coordinator;
      // The mails ride the move's own transaction (`onMoved`), so a binding never moves untold. Every session whose open run
      // the move took is told, the bound coordinator and a migration conflict's party alike (spec §13: the operator's
      // hand-over is the consent a live claimant's displacement needs, as `displacing` is for the bound one).
      const r = await reclaimProgrammeTo({ ...ports.reclaim, coord }, slug, from, heir,
        { ...(from === null ? {} : { displacing: from }), actor: cred.actor, why, onMoved: ({ holding }) => {
          if (from !== null && from !== heir) {
            mailTo(coord, from, `${slug} was handed to ${heir}`, `${slug} was handed to ${heir}: its runs are no longer yours. Why: ${why}. ${NO_PROGRAMME_SENTENCE}`);
          }
          for (const party of holding) {
            if (party === from || party === heir) continue;
            mailTo(coord, party, `${slug} was handed to ${heir}`,
              `${slug} was handed to ${heir}: the runs of it you held are ${heir}'s now. Why: ${why}. Report on them to ${heir}.`);
          }
          if (from !== heir) mailTo(coord, heir, `You are now the coordinator of ${slug}`, `${slug} was handed to you. Why: ${why}. You own this programme and only this one.`);
        } });
      if (!r.ok) return sendReclaimRefusal(reply, r);
      deps.changed();
      return reply.code(200).send({ ok: true, slug, from, to: heir, runIds: r.runIds });
    });
  }

  /** The operator's confirm of an end proposal (`POST /api/items/:id/act` on an `end-programme` item, spec §5's confirm row):
   *  behind the step-up; refused while a run is open, the item left open; the released coordinator is told it owns nothing. */
  function confirm(req: FastifyRequest, reply: FastifyReply, item: ItemRow) {
    const cred = credential(req, reply, 'confirm-end');
    if (cred === null) return reply;
    const coord = deps.coord!;
    const b = req.body ?? {};
    if (!isObject(b)) return bad(reply, 'the body is an object');
    const asked = b['programme'];
    const action = item.action as { outcome: ProgrammeEndOutcome };
    if (asked !== undefined && asked !== action.outcome) return bad(reply, `the proposal is to end the programme as ${action.outcome}`);
    const res = coord.confirmProgrammeEnd(item.id, cred.actor, deps.now(), (r) => {
      if (r.released !== null) noProgrammeMail(coord, r.released, `${r.slug} ended (${r.outcome}), as you proposed`);
    });
    if (!res.ok) return refuseRoute(reply, res.why, { detail: res.detail });
    deps.changed();
    return reply.code(200).send({ ok: true, slug: res.slug, state: res.outcome, released: res.released });
  }

  /** The decline (`POST /api/items/:id/decline` on an `end-programme` item, spec §5's decline row): works dark (`flag-off`);
   *  mails the coordinator bound at this moment, or nobody; the history keeps it either way. */
  function decline(req: FastifyRequest, reply: FastifyReply, item: ItemRow) {
    const cred = credential(req, reply, 'decline-end');
    if (cred === null) return reply;
    const coord = deps.coord!;
    const b = req.body ?? {};
    const why = isObject(b) && b['why'] !== undefined ? text(b['why'], ITEM_TEXT_MAX) : 'kept open by the operator';
    if (why === null) return bad(reply, `why is 1 to ${ITEM_TEXT_MAX} characters`);
    const actor: ProgrammeActor = cred.actor;
    const res = coord.declineProgrammeEnd(item.id, actor, why, deps.now(), cred.dark ? FLAG_OFF : {}, (r) => {
      if (r.coordinator !== null) mailTo(coord, r.coordinator, `The end of ${r.slug} was declined`, `The proposed end of ${r.slug} was declined: ${why}. Its item is closed; propose again when it is ready.`);
    });
    if (!res.ok) return refuseRoute(reply, 'not-open', { detail: res.detail });
    deps.changed();
    return reply.code(200).send({ ok: true, slug: res.slug, mailed: res.coordinator });
  }

  /** The two reads' box-token arm (spec §14): the query's `byId`/`byUuid`, attributed against the registry; the caller's id,
   *  or null with the refusal sent. The session arm never reaches it. */
  const tokenCaller = async (req: FastifyRequest, reply: FastifyReply): Promise<{ byId: string; byUuid: string } | null> => {
    const q = isObject(req.query) ? req.query : {};
    const byId = q['byId'];
    const byUuid = q['byUuid'];
    if (typeof byId !== 'string' || byId === '' || typeof byUuid !== 'string' || byUuid === '') {
      bad(reply, 'with the box token, byId and byUuid are required query values');
      return null;
    }
    const ports = deps.ports;
    if (ports === undefined) { refuseRoute(reply, 'not-configured'); return null; }
    const v = await ports.attribute(byId, byUuid);
    if (!v.ok) { refuseRoute(reply, v.error, { detail: v.detail }); return null; }
    return { byId, byUuid };
  };

  /** `GET /api/programmes/:slug/history` (spec §11): the programme's story, oldest first. With the box token (`viaToken`),
   *  only the programme's bound coordinator reads it (spec §14), attributed, then owning it (`claimsProgramme`). */
  async function history(req: FastifyRequest, reply: FastifyReply, viaToken: boolean) {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const slug = slugOf(req);
    if (viaToken) {
      const who = await tokenCaller(req, reply);
      if (who === null) return reply;
      if (!coord.claimsProgramme(who.byId, slug, who.byUuid)) {
        return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.notYourProgramme, { detail: `${who.byId} is not the coordinator of programme ${slug}` });
      }
    }
    const h = coord.programmeHistory(slug);
    if (h === null) return refuseRoute(reply, 'unknown-programme', { detail: `no programme ${slug}` });
    return reply.code(200).send({ ok: true, slug, history: h });
  }

  /** `GET /api/sessions/:id/programme` (spec §7, §14): the session's one programme, by its measured incarnation, or `none`
   *  with why. An unreadable registry is `registry-unmeasurable`, never `none`. With the box token (`viaToken`), attributed,
   *  and a session reads only its own (`not-owner`). */
  async function sessionProgramme(req: FastifyRequest, reply: FastifyReply, viaToken: boolean) {
    const coord = deps.coord;
    if (!coord) return refuseRoute(reply, 'not-configured');
    const id = (req.params as { id: string }).id;
    if (!isRegistryId(id)) return refuseRoute(reply, 'bad-session-id');
    if (viaToken) {
      const who = await tokenCaller(req, reply);
      if (who === null) return reply;
      if (who.byId !== id) return refuseRoute(reply, 'not-owner', { detail: `with the box token, ${who.byId} reads its own programme only` });
    }
    const ports = deps.ports;
    if (ports === undefined) return refuseRoute(reply, 'not-configured');
    const reading = await ports.readingOf(id);
    if (reading.kind === 'unreadable' || (reading.kind === 'present' && reading.uuid === null)) {
      return reply.code(502).send({ ok: false, error: 'registry-unmeasurable', detail: `the registry row of ${id} could not be read` });
    }
    const uuid = reading.kind === 'present' ? reading.uuid : null;
    const own = coord.programmeOf(id, uuid);
    let answer: SessionProgrammeAnswer;
    if (own !== null) {
      const facts = coord.programmeLifecycleRows().find((f) => f.slug === own.slug);
      answer = { ok: true, programme: { slug: own.slug, placeholder: own.placeholder as PlaceholderState | null,
        lifecycle: facts === undefined ? null : lifecycleOf(facts.state, facts.placeholder, facts) } };
    } else {
      const lost = coord.coordinatorsWithoutProgramme().find((c) => c.session === id);
      answer = { ok: true, programme: 'none', why: lost?.why ?? 'never-joined' };
    }
    return reply.code(200).send(answer);
  }

  /** The refused close's programme end (D-8558's `{programme}` body on `POST /api/items/:id/act`, plan W2 item 4): an end,
   *  so it takes the end's credential (spec §14's step-up, so it refuses while sign-in is dark), asked before the run is
   *  abandoned. The actor, or null with the refusal sent. */
  const lastRunEndActor = (req: FastifyRequest, reply: FastifyReply): ProgrammeActor | null => credential(req, reply, 'end')?.actor ?? null;

  /** Whether `slug` may end as `outcome` once its last run closes, asked before that run is abandoned: the state door's
   *  `end` with no open run (`edgeDecision`, the one decider). An ended programme is not a refusal here: the run is
   *  closed either way, and the first recorded end stands. */
  const lastRunEndRefusal = (coord: CoordStore, slug: string, outcome: ProgrammeEndOutcome): { why: EdgeRefusal; detail: string } | null => {
    const row = coord.programmeLifecycleRow(slug);
    if (row === null) return { why: 'unknown-programme', detail: `no programme ${slug}` };
    const d = edgeDecision({ stored: row.state, placeholder: row.placeholder, openRuns: 0 }, { edge: 'end', outcome, abandonRuns: false });
    return d.ok || d.why === 'programme-ended' ? null : { why: d.why, detail: d.detail };
  };

  /** The end once the last run closed: `edgeDecision` over the measured open runs, then `decideInTx` (the proposal closed and
   *  the released coordinator told in its transaction). True when ended, or already ended (its first end stands). */
  const endWithLastRun = (coord: CoordStore, slug: string, outcome: ProgrammeEndOutcome, actor: ProgrammeActor, why: string,
    planEndWhy: string | null, now: number): { ok: true } | { ok: false; why: EdgeRefusal; detail: string } => {
    const row = coord.programmeLifecycleRow(slug);
    if (row === null) return { ok: false, why: 'unknown-programme', detail: `no programme ${slug}` };
    const d = edgeDecision({ stored: row.state, placeholder: row.placeholder, openRuns: coord.programOpenRunCount(slug) },
      { edge: 'end', outcome, abandonRuns: false });
    if (!d.ok) return d.why === 'programme-ended' ? { ok: true } : d;
    if (d.kind !== 'decide') return { ok: false, why: 'programme-unknown', detail: 'an end is a decision' };
    coord.decideProgramme({ slug, to: d.to, edge: d.event, actor, why, planEndWhy }, now,
      (released) => noProgrammeMail(coord, released, `${slug} ended (${d.to}) with its last run: ${why}`));
    return { ok: true };
  };

  return { start, state, handOver, confirm, decline, history, sessionProgramme, lastRunEndActor, lastRunEndRefusal, endWithLastRun };
}

/** The proposal door's body (spec §8): `{byId, byUuid, outcome, why, evidence[]}`. */
export function parseEndProposal(b: unknown):
  { ok: true; outcome: ProgrammeEndOutcome; why: string; evidence: string[] } | { ok: false; detail: string } {
  if (!isObject(b)) return { ok: false, detail: 'the body is an object' };
  const outcome = b['outcome'];
  if (outcome !== 'done' && outcome !== 'abandoned') return { ok: false, detail: 'outcome is done or abandoned' };
  const why = text(b['why'], ITEM_TEXT_MAX);
  if (why === null) return { ok: false, detail: `why is 1 to ${ITEM_TEXT_MAX} characters` };
  const evidence = parseEvidence(b['evidence']);
  if (evidence === null) return { ok: false, detail: 'evidence is a list of non-blank lines' };
  return { ok: true, outcome, why, evidence };
}

/** Raise the end proposal (the proposal door and `plan close`, spec §8), after the caller's ownership: the guards
 *  (`endProposalDecision`), the item's text against the pinned definition of done, and the item with its `end-proposed`
 *  event in one transaction. */
export function raiseEndProposal(
  coord: CoordStore, input: { slug: string; by: string; outcome: ProgrammeEndOutcome; why: string; evidence: readonly string[]; via: 'door' | 'plan' },
  now: number,
): { ok: true; id: number } | { ok: false; why: string; detail: string; itemId?: number } {
  const row = coord.programmeLifecycleRow(input.slug);
  if (row === null) return { ok: false, why: 'unknown-programme', detail: `no programme ${input.slug}` };
  const open = coord.openEndProposalOf(input.slug);
  const d = endProposalDecision({ stored: row.state, placeholder: row.placeholder, openRuns: coord.programOpenRunCount(input.slug),
    openProposal: open?.id ?? null, evidence: input.evidence });
  if (!d.ok) return { ok: false, why: d.why, detail: d.detail, ...(open !== null && d.why === END_REQUEST_REFUSALS.alreadyAsked ? { itemId: open.id } : {}) };
  const goals = coord.goalsFor(input.slug);
  const pinned = goals.doneWhen == null ? null : doneWhenOf(goals.doneWhen);
  const title = coord.programs().find((p) => p.slug === input.slug)?.title ?? input.slug;
  const item = endProposalItem({ title, outcome: input.outcome, why: input.why, evidence: input.evidence,
    doneWhen: pinned !== null && pinned.ok ? pinned.doneWhen : null });
  const id = coord.proposeProgrammeEnd({ ...input, item }, now);
  return { ok: true, id };
}

/** The programmes read with its lifecycle (spec §15), for `GET /api/programmes`: one registry reading per bound session
 *  and per coordinator with no programme (W4's registry lane replaces these per-request reads, D-9021), handed to the L1
 *  view, which decides what each row shows and which coordinators are listed. Without the ports (a narrow test), the
 *  sessions read `unreadable`, never absent. */
export async function programmesWithLifecycle(
  coord: CoordStore, answer: ProgrammesAnswer, readingOf: ((session: string) => Promise<CoordinatorRegistryReading>) | undefined,
): Promise<ProgrammesAnswer> {
  const facts = coord.programmeLifecycleRows();
  const without = coord.coordinatorsWithoutProgramme();
  const sessions = [...facts.flatMap((f) => (f.coordinator === null ? [] : [f.coordinator])), ...without.map((w) => w.session)];
  const readings = new Map<string, CoordinatorRegistryReading>();
  if (readingOf !== undefined) {
    const read = await Promise.all([...new Set(sessions)].map(async (s) => [s, await readingOf(s)] as const));
    for (const [s, r] of read) readings.set(s, r);
  }
  const readOf = (s: string): CoordinatorRegistryReading => readings.get(s) ?? { kind: 'unreadable' };
  return withLifecycleFields(answer, facts, readOf, without);
}

