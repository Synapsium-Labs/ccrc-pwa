// D-8076 (spec 2026-11-04 §10, A22, A24): `POST /api/runs/:id/end-request`, the way a session asks the operator to end a run it
// cannot close. The decider (`endRequestDecide`) is pure: it takes the facts the route measured and answers either the item to
// raise or the one word that refuses. `endRequestRun` is the route's body: it measures, asks the decider, and writes the item
// (and, for a worker's request under a living coordinator, the coordinator's notice) in ONE transaction. The abandon act is
// not here and never reachable from here: a session asks, the operator's `act` ends the run (Task 23).
//
// WHO WAS ASKED FIRST. The coordinator comes first (the operator's ruling): its own request, and any request under a gone
// coordinator, shows at once; a worker's or reviewer's request under a living coordinator is held `ASK_GRACE_MS` (the
// coordinator-first window, late answer wins), the coordinator is mailed, and the operator sees nothing if it withdraws.
//
// WHICH LINE THE ITEM ENDS IN. The item's `why` is the asker's words and then, as its last line, one of the three origins
// (`EndRequestLine`), so the console reads the origin from the item without a column of its own.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { askGraceSeconds, askNotifyAt } from '../askwindow.js';
import { refuseRoute } from '../refuse.js';
import { END_REQUEST_REFUSALS, LEDGER_ROUTE_REFUSALS, type EndRequestRefusal } from '../../../shared/refusal.js';
import { TERMINAL_RUN_STATES, type RunState, type StuckReason } from '../../../shared/api.js';
import { ITEM_TEXT_MAX, ITEM_TITLE_MAX, endRunAction, itemRunName, outsideDocLink } from '../../../shared/ledgers.js';
import type { CoordStore, RunRow } from './store.js';
import { coordinatorOfRun, workerOfRun } from './bindingReads.js';
import { endRequestAskMail } from './ledgersMail.js';
import { insertSystemMailTx } from './rundefsTx.js';

/** A repeat from the same asker is refused for this long after a decline or a withdraw, unless the stuck reason changed (A24). */
export const END_REQUEST_REPEAT_MS = 24 * 60 * 60_000;

/** The three origins an end-request item's row line ends in (spec §10's table). */
export type EndRequestLine = 'Raised by its coordinator' | 'Its coordinator did not answer' | 'Its coordinator is gone';

/** The step words of an end-request item: what the operator does with it. */
export const END_REQUEST_HOW: readonly string[] = ['Read why it asked.', 'Abandon the run, or keep it.'];

/** Why a request is refused. A closed run is the generic `run-closed`. */
export type EndRequestWhy = EndRequestRefusal | 'run-closed';

/** What the route measured. `reviewWorkers` are the sessions of the review runs of this run. */
export interface EndRequestFacts {
  readonly now: number;
  readonly askerId: string;
  readonly run: { readonly state: RunState };
  /** The run's coordinator and its worker, as the binding readers (`coordinatorOfRun`, `workerOfRun`) answer them. */
  readonly coordinator: string | null;
  readonly worker: string | null;
  readonly reviewWorkers: readonly string[];
  /** True when the run's coordinator reads gone, or the run has none. */
  readonly coordinatorGone: boolean;
  /** The run's open end-request item, if any (held or not). */
  readonly openItem: { readonly id: number } | null;
  /** The newest end-request item of this run that ended in a decline or a withdraw, if any. */
  readonly lastEnded: { readonly askerId: string; readonly at: number; readonly stuckReason: StuckReason | null } | null;
  /** The reason the run is stuck under now, or null. */
  readonly stuckReason: StuckReason | null;
}

export type EndRequestDecision =
  | { kind: 'raise'; heldUntil: number | null; line: EndRequestLine }
  | { kind: 'refuse'; why: EndRequestWhy };

const isTerminal = (s: RunState): boolean => (TERMINAL_RUN_STATES as readonly string[]).includes(s);

/** The decision, in the order the spec lists them: who may ask, a closed run, one open request per run, no quick repeat. */
export function endRequestDecide(f: EndRequestFacts): EndRequestDecision {
  const asCoordinator = f.coordinator !== null && f.askerId === f.coordinator;
  const asWorker = f.askerId === f.worker || f.reviewWorkers.includes(f.askerId);
  if (!asCoordinator && !asWorker) return { kind: 'refuse', why: END_REQUEST_REFUSALS.notYours };
  if (isTerminal(f.run.state)) return { kind: 'refuse', why: 'run-closed' };
  if (f.openItem !== null) return { kind: 'refuse', why: END_REQUEST_REFUSALS.alreadyAsked };
  const e = f.lastEnded;
  if (e !== null && e.askerId === f.askerId && f.now - e.at < END_REQUEST_REPEAT_MS && e.stuckReason === f.stuckReason) {
    return { kind: 'refuse', why: END_REQUEST_REFUSALS.recentlyAsked };
  }
  if (asCoordinator) return { kind: 'raise', heldUntil: null, line: 'Raised by its coordinator' };
  if (f.coordinatorGone) return { kind: 'raise', heldUntil: null, line: 'Its coordinator is gone' };
  return { kind: 'raise', heldUntil: askNotifyAt(f.now), line: 'Its coordinator did not answer' };
}

/** The run's name as the console says it on a row (`itemRunName`, shared with the refused-close items the lane raises). */
export const endRequestRunName = itemRunName;

/** The item's title, cut to `ITEM_TITLE_MAX` characters on a code-point boundary. */
export const endRequestTitle = (run: Parameters<typeof endRequestRunName>[0]): string =>
  [...`End run: ${endRequestRunName(run)}`].slice(0, ITEM_TITLE_MAX).join('');

/** The item's `why`: the asker's words, then the origin as the last line. */
export const endRequestWhy = (why: string, line: EndRequestLine): string => `${why}\n${line}`;

export interface EndRequestDeps {
  readonly coord: CoordStore;
  readonly now: () => number;
  /** The stuck verdict's reading for this run: its reason and whether its coordinator reads gone. Null when the reader holds none. */
  readonly verdictOf: (runId: number) => { readonly reason: StuckReason | null; readonly coordinatorGone: boolean } | null;
}

export type EndRequestOutcome =
  | { ok: true; id: number; line: EndRequestLine; heldUntil: number | null }
  | { ok: false; error: 'unknown-run' | 'run-unreadable'; detail: string }
  | { ok: false; error: EndRequestWhy; detail: string; itemId?: number };

const REFUSAL_DETAIL: Record<EndRequestWhy, (id: number, itemId: number | undefined) => string> = {
  [END_REQUEST_REFUSALS.notYours]: (id) => `run ${id} is not yours: only its coordinator, its worker or the worker of a review run of it may ask`,
  [END_REQUEST_REFUSALS.alreadyAsked]: (id, itemId) => `run ${id} already has an open end request, item ${itemId ?? '?'}`,
  [END_REQUEST_REFUSALS.recentlyAsked]: (id) => `you asked to end run ${id} in the last 24 hours and it was declined or withdrawn, and its stuck reason has not changed`,
  'run-closed': (id) => `run ${id} is closed`,
};

/** The route's body, with the token and the attribution already checked and the asker's words already bounded. SYNCHRONOUS:
 *  the facts it measures are the facts it writes against. */
export function endRequestRun(deps: EndRequestDeps, runId: number, askerId: string, why: string): EndRequestOutcome {
  const read = deps.coord.run(runId);
  if (!read.ok) return { ok: false, error: 'run-unreadable', detail: read.detail };
  const run = read.run;
  if (run === null) return { ok: false, error: 'unknown-run', detail: `no run ${runId}` };
  const now = deps.now();
  const verdict = deps.verdictOf(runId);
  const open = deps.coord.openEndRequestOf(runId);
  const coordinator = coordinatorOfRun(deps.coord, runId);
  const facts: EndRequestFacts = {
    now, askerId, run, coordinator, worker: workerOfRun(deps.coord, runId), reviewWorkers: deps.coord.reviewWorkersOf(runId),
    coordinatorGone: run.claimedBy === null || verdict?.coordinatorGone === true,
    openItem: open === null ? null : { id: open.id },
    lastEnded: deps.coord.lastEndedEndRequest(runId, askerId),
    stuckReason: verdict?.reason ?? null,
  };
  const decision = endRequestDecide(facts);
  if (decision.kind === 'refuse') {
    const itemId = decision.why === END_REQUEST_REFUSALS.alreadyAsked ? open?.id : undefined;
    return { ok: false, error: decision.why, detail: REFUSAL_DETAIL[decision.why](runId, itemId),
      ...(itemId === undefined ? {} : { itemId }) };
  }
  const action = endRunAction(runId, facts.stuckReason);
  const actor = coordinator !== null && askerId === coordinator ? 'coordinator' : 'ccrc';
  const mailTo = decision.heldUntil !== null && run.claimedBy !== null ? run.claimedBy : null;
  const input = {
    program: run.program, runId, raisedBy: askerId, kind: 'do' as const, title: endRequestTitle(run),
    why: endRequestWhy(why, decision.line), how: [...END_REQUEST_HOW], options: null,
    // `soon` with no label: nothing pushes, at raise or later (A20).
    neededBy: 'soon' as const, soonLabel: null, secretSlot: null, action, heldUntil: decision.heldUntil,
  };
  const id = deps.coord.raiseItemWithMail(input, now, actor, (itemId) => {
    if (mailTo === null) return null;
    const mail = endRequestAskMail({ itemId, runId, runName: endRequestRunName(run), askerId, why, graceSeconds: askGraceSeconds() });
    return insertSystemMailTx(deps.coord, null, { fromId: 'operator', toId: mailTo, runId: null, kind: 'status', subject: mail.subject, body: mail.body });
  });
  return { ok: true, id, line: decision.line, heldUntil: decision.heldUntil };
}

/** What the route needs beyond the request: the store, the clock, the stuck verdict, the sender check (`requireAttribution`
 *  is `registerCoordRoutes`'s own closure) and the emit that tells the console the list moved. */
export interface EndRequestRouteDeps extends EndRequestDeps {
  readonly requireAttribution: (reply: FastifyReply, whoId: string, whoUuid: string, uuidField: 'byUuid') => Promise<boolean>;
  readonly changed: () => void;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** `POST /api/runs/:id/end-request`, after the box token has been checked by the route itself (it must come before any
 *  await). Body `{byId, byUuid, why}`; the order every box-token route keeps: shape, attribution, then ONE synchronous
 *  read-decide-write (`endRequestRun`), the emit and the answer. A refusal writes and emits nothing. */
export async function endRequestHandler(runId: number | null, deps: EndRequestRouteDeps, req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const bad = (detail: string): FastifyReply => refuseRoute(reply, 'bad-request', { detail });
  if (runId === null) return bad('the run id is a positive integer');
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) return bad('the body is an object');
  const b = body as Record<string, unknown>;
  const byId = b['byId']; const byUuid = b['byUuid'];
  if (!nonEmpty(byId) || !nonEmpty(byUuid)) return bad('byId and byUuid are required strings');
  const given = b['why'];
  const why = typeof given === 'string' && given.trim() !== '' && given.length <= ITEM_TEXT_MAX ? given.trim() : null;
  if (why === null) return bad(`why is 1 to ${ITEM_TEXT_MAX} characters`);
  const outside = outsideDocLink([why]);
  if (outside !== null) {
    return refuseRoute(reply, LEDGER_ROUTE_REFUSALS.outsideDocLink, { detail: `${outside} links a document outside the console; a document link is its repository path` });
  }
  if (!(await deps.requireAttribution(reply, byId, byUuid, 'byUuid'))) return reply;
  const out = endRequestRun(deps, runId, byId, why);
  if (!out.ok) return refuseRoute(reply, out.error, { detail: out.detail, ...('itemId' in out && out.itemId !== undefined ? { itemId: out.itemId } : {}) });
  deps.changed();
  return reply.code(200).send({ ok: true, id: out.id, line: out.line, heldUntil: out.heldUntil });
}
