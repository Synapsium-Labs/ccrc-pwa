import {
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, RUN_STATES, TERMINAL_RUN_STATES, isRegistryId,
  parseRouteEventDetail, parseRouteFields, routeNamesFable,
} from '../../../shared/api.js';
import type {
  FailureKind, RouteField, RouteMode, RunRouteRefuseCode, RunState, RunSummary,
} from '../../../shared/api.js';
import {
  EFFORT_LADDER, classRungEffortReset, demote, escalate,
  type Demotion, type RungCurrent, type RungTarget,
} from '../../../shared/routing-ladder.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { CLASSES, type ModelClass } from '../../../shared/models.js';

/**
 * `POST /api/runs/:id/route`, decided (D-6735, audit ticket
 * ARCH-20, GitHub #546). L1: no `fs`, no fastify, no `reply`, no clock; every
 * import is L0, `shared/`. The route (`coord/routes.ts`, L4) parses the
 * request, gathers the facts through the lookups below, calls `decideRoute`
 * inside `coordMutex`, and answers a refusal through `refuseRoute`, or applies
 * a move through ccd; it decides none of this.
 *
 * WHAT MOVED HERE, behaviour-identical: the request shape, the run and session
 * gates, the registry vocabulary checks, the fold of the session's event trail
 * into `lastDemotion` and `priorSameKind` (S5-R2, S5-R5), ruling S5-R17 (a
 * reversal whose `from` is not the MEASURED rung is dropped for a plain
 * escalation) and the degraded-record ceiling. WHAT DID NOT: the registry
 * reads, the run and trail lookups, the argv, the ccd call and the run event;
 * the route keeps those, in that order.
 *
 * THE ORDER IS THE CONTRACT, pinned by `run-route-order.test.ts` over HTTP and
 * by `route-decide.test.ts` over the decider. A request two gates refuse gets
 * the earlier one's answer: run lookup, run state, session, capability, then the
 * `.class` read, `.effort`, `.degraded`, and only then their vocabulary checks.
 *
 * PURE OVER ITS FACTS, and LAZY like `openRunPreconditions`: the trail and each
 * registry field are passed in as lookups and called by the gate that needs
 * them, so a refusal costs only the reads ahead of it, and a manual write
 * reads neither.
 */

/** D-6790: the sentence both `fable-operator-only` refusals on `POST /api/runs/:id/route` carry. */
const FABLE_OPERATOR_ONLY_DETAIL = "class fable is the operator's to select";

/** `POST /api/runs/:id/route`'s routable run states (review finding #6, ruling
 *  S5-R4): every `RunState` not in `TERMINAL_RUN_STATES`, derived rather than
 *  hand-typed, so `run-closed` means "terminal" and nothing else. */
export const ROUTABLE_RUN_STATES: readonly RunState[] = RUN_STATES.filter(
  (s) => !(TERMINAL_RUN_STATES as readonly string[]).includes(s),
);

/** What the caller asked for: whom to route, why, and by which of the three
 *  ways (a failure kind, a demotion, or the coordinator's own field write). */
export interface RouteAsk {
  readonly target: 'worker' | 'coordinator';
  readonly why: string;
  readonly how:
    | { readonly by: 'kind'; readonly kind: FailureKind }
    | { readonly by: 'demote'; readonly field: 'class' | 'effort' }
    | { readonly by: 'manual'; readonly field: RouteField; readonly value: string };
}

export type RouteRequest = { ok: true; id: number; ask: RouteAsk } | { ok: false; detail: string };

/**
 * Shape-check the request: the id (already parsed by the route, which keeps the
 * canonical-id seam `routes.test.ts` censuses; `null` is a bad one), the target, the `why` (1..400 bytes, no
 * control characters) and exactly one of `kind`, `demote` or `field`+`value`.
 * The manual value passes `parseRouteFields`, the guard the sibling session
 * route reuses: ccd's own `_route_valid` carries no control-character or
 * length arm, so this is the only barrier on shape, and a value that skipped it
 * could poison the `route:` event string the fold parses back off its history.
 * Each `detail` is the sentence the route sends on its 400, verbatim.
 */
export function parseRouteRequest(id: number | null, raw: unknown): RouteRequest {
  if (id === null) return { ok: false, detail: 'id must be a positive safe integer' };
  const body = (raw ?? {}) as Record<string, unknown>;
  if (body.target !== 'worker' && body.target !== 'coordinator') {
    return { ok: false, detail: 'target must be "worker" or "coordinator"' };
  }
  if (typeof body.why !== 'string') return { ok: false, detail: 'why must be a string' };
  const whyBytes = new TextEncoder().encode(body.why).length;
  if (whyBytes < 1 || whyBytes > 400 || ROUTE_CONTROL_CHAR_RE.test(body.why)) {
    return { ok: false, detail: 'why must be 1..400 bytes with no control characters' };
  }
  const target: RouteAsk['target'] = body.target;
  const why = body.why;
  const hasKind = body.kind !== undefined;
  const hasDemote = body.demote !== undefined;
  const hasManual = body.field !== undefined || body.value !== undefined;
  if ([hasKind, hasDemote, hasManual].filter(Boolean).length !== 1) {
    return { ok: false, detail: 'exactly one of kind, demote, or field+value is required' };
  }
  if (hasKind) {
    if (typeof body.kind !== 'string' || !(FAILURE_KINDS as readonly string[]).includes(body.kind)) {
      return { ok: false, detail: `kind must be one of ${FAILURE_KINDS.join('/')}` };
    }
    return { ok: true, id, ask: { target, why, how: { by: 'kind', kind: body.kind as FailureKind } } };
  }
  if (hasDemote) {
    if (body.demote !== 'class' && body.demote !== 'effort') return { ok: false, detail: 'demote must be "class" or "effort"' };
    return { ok: true, id, ask: { target, why, how: { by: 'demote', field: body.demote } } };
  }
  const parsed = parseRouteFields(typeof body.field === 'string' ? { [body.field]: body.value } : null);
  if (!parsed.ok || Object.keys(parsed.route).length !== 1) {
    return { ok: false, detail: !parsed.ok ? `field/value invalid: ${parsed.why}` : 'field and value are required' };
  }
  const [field, value] = Object.entries(parsed.route)[0] as [RouteField, string];
  return { ok: true, id, ask: { target, why, how: { by: 'manual', field, value } } };
}

/** The run, as far as the route reads it. */
export type RouteRunFacts = Pick<RunSummary, 'state' | 'sessionId' | 'claimedBy'>;

/** A registry field, measured: its content, or WHY it has none. `absent` is a
 *  fact about the record; `unreadable` is transient and says nothing about it. */
export type RegistryRead = { ok: true; content: string } | { ok: false; reason: ReadFailure };

/** One run event on the target session's trail, with the run it came from. */
export interface RouteTrailEvent {
  readonly at: number;
  readonly runId: number;
  /** The run's own worker, to whom a five-segment event is attributed. */
  readonly runSessionId: string | null;
  readonly detail: string | null;
}

export interface RouteFacts {
  readonly ask: RouteAsk;
  /** `CoordStore.run(id)`: a row, none, or an unreadable store. */
  readonly run: { ok: true; run: RouteRunFacts | null } | { ok: false; detail: string };
  /** Whether ccd carries the `route` verb (D-5866; `routeSet` answers the same cap). */
  readonly ccdCanRoute: boolean;
  /** Every run event of every run the session touches (routing slice 6), in any order. */
  readonly trail: (sid: string) => readonly RouteTrailEvent[];
  /** One of the session's registry fields, measured. */
  readonly measure: (sid: string, field: 'class' | 'effort' | 'degraded') => Promise<RegistryRead>;
}

/** Every word the route can refuse with: the nine of `RunRouteRefuseCode` and
 *  the three that are the run's or the capability's (`run-unreadable`,
 *  `unknown-run`, `unsupported`). */
export type RouteRefusalWord = RunRouteRefuseCode | 'run-unreadable' | 'unknown-run' | 'unsupported';

/** The move to apply: what `ccd route` is asked to write and the run event
 *  records. `kind` is null for a demotion or a manual write. */
export interface RouteMove {
  readonly sid: string;
  readonly mode: RouteMode;
  readonly field: RouteField;
  readonly from: string;
  readonly to: string;
  readonly kind: FailureKind | null;
  /** The companion effort a class rung writes in the same argv (spec §3), or null. */
  readonly effortReset: string | null;
}

export type RouteDecision =
  | { ok: true; move: RouteMove }
  | { ok: false; refused: RouteRefusalWord; extra: { detail?: string; field?: string; file?: string } };

const refused = (word: RouteRefusalWord, extra: { detail?: string; field?: string; file?: string } = {}): RouteDecision =>
  ({ ok: false, refused: word, extra });

/**
 * Fold the session's trail into the two facts the ladder needs (S5-R2): the
 * last `route:demote:` not yet followed by a `route:reverse-demotion:` or, on
 * the demoted field, a manual write (S5-R5); and how many escalations of the
 * asked kind it has had. Replayed by `at` then run id, so two events landed in
 * one millisecond keep the order their rows were written. A six-segment event
 * names its own session; a five-segment one (every write before routing slice
 * 6) is attributed to its run's worker, the only role it could have targeted.
 */
export function foldRouteTrail(
  events: readonly RouteTrailEvent[], sid: string, kind: FailureKind | null,
): { lastDemotion: Demotion | null; priorSameKind: number } {
  let lastDemotion: Demotion | null = null;
  let priorSameKind = 0;
  for (const e of [...events].sort((a, b) => (a.at - b.at) || (a.runId - b.runId))) {
    if (e.detail === null) continue;
    const parsed = parseRouteEventDetail(e.detail);
    if (parsed === null) continue;
    const { mode, field, from, to, kind: evKind, session } = parsed;
    if (!(session !== null ? session === sid : e.runSessionId === sid)) continue;
    if (mode === 'demote') {
      lastDemotion = { field: field as 'class' | 'effort', from, to };
    } else if (mode === 'reverse-demotion') {
      lastDemotion = null;
    } else if (mode === 'manual' && lastDemotion !== null && field === lastDemotion.field) {
      lastDemotion = null;
    }
    if (kind !== null && mode === 'escalate' && evKind === kind) priorSameKind++;
  }
  return { lastDemotion, priorSameKind };
}

const unrouteable = (field: string, value: string): RouteDecision =>
  refused('unrouteable-record', { field, detail: `${JSON.stringify(value)} is not a rung of the ladder (a record, not a rung)` });

const EFFORT_VALUES: readonly string[] = [...EFFORT_LADDER, 'auto', 'ultracode'];

/** The session's rung as measured, or the refusal its record earns. */
async function measureRung(facts: RouteFacts, sid: string):
  Promise<{ current: RungCurrent; rawClass: ModelClass; degraded: ModelClass | null } | RouteDecision> {
  const classRead = await facts.measure(sid, 'class');
  if (!classRead.ok) {
    return classRead.reason === 'absent'
      ? refused('no-record', { field: 'class' })
      : refused('registry-unreadable', { file: 'class' });
  }
  // S5-R18: `.class` present with `.effort` ABSENT is `effort: 'auto'` (no
  // override), never `no-record`, which is reserved for an absent `.class`.
  const effortRead = await facts.measure(sid, 'effort');
  if (!effortRead.ok && effortRead.reason === 'unreadable') return refused('registry-unreadable', { file: 'effort' });
  const effort = effortRead.ok ? effortRead.content : 'auto';
  const degradedRead = await facts.measure(sid, 'degraded');
  if (!degradedRead.ok && degradedRead.reason === 'unreadable') return refused('registry-unreadable', { file: 'degraded' });
  // A PRESENT, READABLE field is not automatically a LEGAL rung: the ladder
  // resolves rungs by `indexOf`, so an out-of-vocabulary value (ccd's legal
  // `default`, or a torn write that trims to '') would read as the FLOOR
  // (ruling S5-R19). A blank `.degraded` is "cleared", the established reading.
  if (!(CLASSES as readonly string[]).includes(classRead.content)) return unrouteable('class', classRead.content);
  if (!EFFORT_VALUES.includes(effort)) return unrouteable('effort', effort);
  const degradedContent = degradedRead.ok ? degradedRead.content : '';
  if (degradedContent !== '' && !(CLASSES as readonly string[]).includes(degradedContent)) {
    return unrouteable('degraded', degradedContent);
  }
  const rawClass = classRead.content as ModelClass;
  const degraded = degradedContent !== '' ? (degradedContent as ModelClass) : null;
  // A degraded lane serves the DEGRADED class, and the ladder computes from
  // what is actually running, not what the record still intends.
  return { current: { class: degraded ?? rawClass, effort: effort as RungCurrent['effort'] }, rawClass, degraded };
}

/**
 * Decide the route: a move, or the one refusal that wins. See the header for
 * the order. `kind` and `demote` walk the ladder from the measured rung;
 * `manual` is the coordinator's own judgement, forwarded as typed with no
 * registry read and no ladder call (`from` is '?').
 */
export async function decideRoute(facts: RouteFacts): Promise<RouteDecision> {
  const { ask } = facts;
  if (!facts.run.ok) return refused('run-unreadable', { detail: facts.run.detail });
  const run = facts.run.run;
  if (run === null) return refused('unknown-run');
  if (!ROUTABLE_RUN_STATES.includes(run.state)) return refused('run-closed', { detail: `run is ${run.state}` });
  const sid = ask.target === 'worker' ? run.sessionId : run.claimedBy;
  if (sid === null || sid === '') return refused('no-session');
  // The stored id is re-checked before any field read, argv or event (spec
  // §2.3): `sid` is a STORED row a build before the open's own check may have
  // written. `no-session` (nothing to route to) and `bad-session` (something to
  // route to, not a name safe to write or compose into the event grammar) stay
  // two refusals.
  if (!isRegistryId(sid)) return refused('bad-session');
  if (!facts.ccdCanRoute) return refused('unsupported');

  const { how } = ask;
  if (how.by === 'manual') {
    // D-6790: Fable runs only when the operator selects it; this door is a coordinator's, on the box token.
    if (routeNamesFable({ [how.field]: how.value })) return refused('fable-operator-only', { detail: FABLE_OPERATOR_ONLY_DETAIL });
    return { ok: true, move: { sid, mode: 'manual', field: how.field, from: '?', to: how.value, kind: null, effortReset: null } };
  }
  const rung = await measureRung(facts, sid);
  if ('ok' in rung) return rung;
  const { current, rawClass, degraded } = rung;

  const kind = how.by === 'kind' ? how.kind : null;
  const { lastDemotion, priorSameKind } = foldRouteTrail(facts.trail(sid), sid, kind);
  let target: RungTarget | { kind: 'floor'; why: string } = how.by === 'kind'
    ? escalate(how.kind, current, 'main', priorSameKind, lastDemotion)
    : demote(current, how.field);

  // Ruling S5-R17: `lastDemotion.to` is BOOKKEEPING, the rung the door last
  // recorded the session landing on; `current` is what was just MEASURED. A
  // reversal's `from` is `lastDemotion.to`, so if they disagree something wrote
  // the field out of band (the picker's route, or ccd itself, neither of which
  // writes a run event) and the demotion is no longer the session's history:
  // treat it as cleared and let the plain ladder apply to what is really on the
  // record. The reversal's `from` is always the measured value.
  if (how.by === 'kind' && target.kind === 'move' && target.mode === 'reverse-demotion') {
    const liveValue = target.field === 'class' ? current.class : current.effort;
    if (target.from !== liveValue) target = escalate(how.kind, current, 'main', priorSameKind, null);
  }

  if (target.kind !== 'move') return refused(target.kind, { detail: target.why });
  // D-6790: the same predicate over a ladder result. The ladders stop at the ceiling, so this is the backstop that
  // keeps a future rung or a stored trail from carrying a coordinator past it.
  if (routeNamesFable({ [target.field]: target.to })) return refused('fable-operator-only', { detail: FABLE_OPERATOR_ONLY_DETAIL });

  // A degraded session's own record may already intend the class the ladder
  // just computed (the served class escalated, not the intended one): writing
  // it is re-intending what the record says, not a move. Only a class
  // escalation can collide: a demotion lands BELOW the served class, which is
  // never above the raw one.
  if (degraded !== null && target.field === 'class' && target.to === rawClass) {
    return refused('ceiling', { detail: `the record already intends ${rawClass}; the lane serves ${current.class} (degraded)` });
  }

  return { ok: true, move: {
    sid, mode: target.mode, field: target.field, from: target.from, to: target.to, kind,
    effortReset: target.field === 'class' ? classRungEffortReset(target.to) : null,
  } };
}
