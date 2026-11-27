// The request record's deciders (context C5 Coordination, L1; Overlord W2 request record plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md`, Task A2). Pure: no node:* import, no fs, no SQL and no clock; the time
// is always an argument. The L3 move writer and the open door's planner ask these before every write and act on what they answer; a
// door never compares request states itself. The table is `shared/overlordRequests.ts#REQUEST_TRANSITIONS`, and every state here is read
// through `requestTransition`, so a new row needs no edit in this file unless it brings a guard of its own.
//
// FIRST MATCH, TOTAL. Each decider answers every input. `nextRequestState` reads Table 5's guards in their order (F5: an Overlord move
// on a row the operator holds is `taken` or `not-answered` before its `from` is read), and `citationVerdict` reads Table 6 rule by
// rule across all the cited ids, so one bad id never hides an earlier rule's refusal of another.
import {
  OPEN_REQUEST_STATES, REQUEST_BOUNDS, REQUEST_MOVES, REQUEST_MOVE_FIELDS, REQUEST_MOVE_REQUIRED_FIELDS, REQUEST_NEXT_MOVE_MS,
  ROOT_FOUND_WINDOW_MS, UNCLOCKED_REQUEST_STATES, isRequestMove, reasonsOfMove, requestMoveEntersNeedsYou, requestTransition,
  type RequestActor, type RequestColumn, type RequestMove, type RequestMoveReason, type RequestState,
} from '../../../shared/overlordRequests.js';

// ------------------------------------------------------------------------------------------------------------------ the move

/** Why `nextRequestState` refused, in the order it reads them (Table 5, with the three field and reason guards after it). The door
 *  maps `taken` and `not-answered` to `operator-has-it` and the rest to `bad-transition` (RQ8). */
const REQUEST_MOVE_REFUSAL_MAP: Record<RequestMoveRefusal, true> = {
  taken: true, 'not-answered': true, 'not-from': true, 'wrong-actor': true, 'not-taken-from': true, 'not-acknowledged': true,
  'has-open-children': true, 'has-children': true, 'field-not-allowed': true, 'field-required': true, 'reason-required': true,
  'reason-not-allowed': true,
};
export type RequestMoveRefusal = 'taken' | 'not-answered' | 'not-from' | 'wrong-actor' | 'not-taken-from'
  | 'not-acknowledged' | 'has-open-children' | 'has-children' | 'field-not-allowed' | 'field-required'
  | 'reason-required' | 'reason-not-allowed';
export const REQUEST_MOVE_REFUSALS = Object.keys(REQUEST_MOVE_REFUSAL_MAP) as RequestMoveRefusal[];

/** The facts a move's guards read, which the move writer's plan measures inside its transaction. */
export interface RequestMoveCtx {
  /** The operator answered since the row last entered `needs-you` (`answeredSinceNeedsYou`). */
  readonly answered: boolean;
  /** The state a take left, while the operator holds the row; null when nobody holds it. */
  readonly takenFrom: RequestState | null;
  /** The row's moves hold an `acknowledge`. */
  readonly ownerAcknowledged: boolean;
  readonly openChildren: number;
  /** Any child at all, open or ended. */
  readonly hasChildren: boolean;
  /** The columns this move sets. */
  readonly fields: readonly RequestColumn[];
  /** The reason word the move row carries. */
  readonly reason: RequestMoveReason | null;
}

type RequestMoveVerdict =
  | { readonly ok: true; readonly to: RequestState }
  | { readonly ok: false; readonly why: RequestMoveRefusal };

const refuse = (why: RequestMoveRefusal): RequestMoveVerdict => ({ ok: false, why });

const HAND_BACK_MOVES: readonly RequestMove[] = REQUEST_MOVES.filter((m) => m.startsWith('hand-back-'));
/** The moves that end or hand off a parent's request while a child is still open. */
const NO_OPEN_CHILD_MOVES: readonly RequestMove[] = ['close-unowned', 'drop', 'escalate'];
/** The relay moves, which change an owner: a request with any child keeps the owner its children were made under. */
const CHILDLESS_ONLY_MOVES: readonly RequestMove[] = ['route', 're-relay', 'route-elsewhere'];

/** First match: Table 5's guards in order, then the move's fields, then its reason. `open` is not a move of an existing row: it
 *  always answers `not-from` here, and the insert asks `openMoveVerdict`. */
export function nextRequestState(
  state: RequestState, move: RequestMove, actor: RequestActor, ctx: RequestMoveCtx,
): { readonly ok: true; readonly to: RequestState } | { readonly ok: false; readonly why: RequestMoveRefusal } {
  const row = requestTransition(move);
  if (actor === 'overlord' && ctx.takenFrom !== null) return refuse('taken');
  if (actor === 'overlord' && state === 'needs-you' && !ctx.answered) return refuse('not-answered');
  if (!row.from.includes(state)) return refuse('not-from');
  if (actor !== row.actor) return refuse('wrong-actor');
  if (HAND_BACK_MOVES.includes(move) && row.to !== ctx.takenFrom) return refuse('not-taken-from');
  if (move === 'answer' && !ctx.ownerAcknowledged) return refuse('not-acknowledged');
  if (NO_OPEN_CHILD_MOVES.includes(move) && ctx.openChildren > 0) return refuse('has-open-children');
  if (CHILDLESS_ONLY_MOVES.includes(move) && ctx.hasChildren) return refuse('has-children');
  const allowed = REQUEST_MOVE_FIELDS[move];
  if (ctx.fields.some((f) => !allowed.includes(f))) return refuse('field-not-allowed');
  const required = REQUEST_MOVE_REQUIRED_FIELDS[move] ?? [];
  if (required.some((f) => !ctx.fields.includes(f))) return refuse('field-required');
  const reasons = reasonsOfMove(move);
  if ((requestMoveEntersNeedsYou(move) || reasons.length > 0) && ctx.reason === null) return refuse('reason-required');
  if (ctx.reason !== null && !reasons.includes(ctx.reason)) return refuse('reason-not-allowed');
  return { ok: true, to: row.to };
}

/** The insert's own verdict: the `open` row's actor opens a request, which is `received`. Nothing else may. */
export function openMoveVerdict(actor: RequestActor):
  { readonly ok: true; readonly to: RequestState } | { readonly ok: false; readonly why: 'wrong-actor' } {
  const row = requestTransition('open');
  return actor === row.actor ? { ok: true, to: row.to } : { ok: false, why: 'wrong-actor' };
}

// ------------------------------------------------------------------------------------------------------- the follow-up clock

/** The open states that carry a follow-up clock: the open ones less the unclocked ones (I12). */
const CLOCKED_REQUEST_STATES: readonly RequestState[] = OPEN_REQUEST_STATES.filter((s) => !UNCLOCKED_REQUEST_STATES.includes(s));

/** The follow-up clock a move leaves on the moved row (RQ6): none for a parent with an open child, a terminal state or an unclocked
 *  one; else the read-back's promise, or an hour on. */
export function followUpAfterMove(m: {
  readonly to: RequestState; readonly openChildren: number; readonly at: number; readonly promiseAt: number | null;
}): number | null {
  if (m.openChildren > 0) return null;
  if (!CLOCKED_REQUEST_STATES.includes(m.to)) return null;
  return m.promiseAt ?? m.at + REQUEST_NEXT_MOVE_MS;
}

/** The parent's clock after one of its children moved (F2): an hour on when its last open child ended and it is in a clocked
 *  state, else none. */
export function parentClockAfterChildMove(p: {
  readonly parentState: RequestState; readonly openChildrenAfter: number; readonly at: number;
}): number | null {
  if (p.openChildrenAfter !== 0) return null;
  if (!CLOCKED_REQUEST_STATES.includes(p.parentState)) return null;
  return p.at + REQUEST_NEXT_MOVE_MS;
}

// ------------------------------------------------------------------------------------------------------------ the operator's answer

/** True only when an `answer-recorded` comes after the last move that ENTERS `needs-you` (`requestMoveEntersNeedsYou`, never the
 *  row's `fromState`). A word this build does not know counts as an entry when it reached `needs-you` (fail closed: it can only
 *  withdraw an answer, never grant one). No entry at all answers false. */
export function answeredSinceNeedsYou(moves: readonly { readonly move: string; readonly toState: string }[]): boolean {
  let entered = false;
  let answered = false;
  for (const m of moves) {
    const enters = isRequestMove(m.move) ? requestMoveEntersNeedsYou(m.move) : m.toState === 'needs-you';
    if (enters) { entered = true; answered = false; } else if (m.move === 'answer-recorded') answered = entered;
  }
  return answered;
}

// ------------------------------------------------------------------------------------------------------------ the close door

/** The act kinds that leave a request closable from `received` (RQ12): its own `open-request`. The operator-answer piece (W3) adds
 *  its answer kinds here. */
export const CLOSE_UNOWNED_ACT_KINDS: readonly string[] = ['open-request'];

/** First match: only a `received` request closes unowned, with no open child and no act on it but those named above. */
export function closeUnownedVerdict(f: {
  readonly state: RequestState; readonly actKindsOnIt: readonly string[]; readonly openChildren: number;
}): 'allow' | 'not-received' | 'has-open-children' | 'has-acts' {
  if (f.state !== 'received') return 'not-received';
  if (f.openChildren > 0) return 'has-open-children';
  if (f.actKindsOnIt.some((k) => !CLOSE_UNOWNED_ACT_KINDS.includes(k))) return 'has-acts';
  return 'allow';
}

// ------------------------------------------------------------------------------------------------------------------ citations

/** What the private store's citing reader answered for one cited id (`citedMessageFacts`); the open door reads it before the
 *  transaction. There is no `gone` state: a row with no text is the `absent` arm. */
export type CitationFact =
  | { readonly read: 'ok'; readonly state: string; readonly at: number; readonly sha256: string; readonly hashMatches: boolean }
  | { readonly read: 'absent' }
  | { readonly read: 'unmeasured'; readonly why: string };

export type CitationAnswer =
  | { readonly kind: 'ok'; readonly cites: readonly { readonly messageId: number; readonly sha256: string; readonly root: boolean }[] }
  | {
    readonly kind: 'refused';
    readonly word: 'too-large' | 'bad-request' | 'unmeasured' | 'said-not-operator';
    readonly detail: 'too-many' | 'repeated' | 'unread' | 'absent' | 'changed' | 'spent' | 'not-in-root';
    readonly id: number | null;
    readonly why: string | null;
  };

const refused = (
  word: 'too-large' | 'bad-request' | 'unmeasured' | 'said-not-operator',
  detail: 'too-many' | 'repeated' | 'unread' | 'absent' | 'changed' | 'spent' | 'not-in-root', id: number | null, why: string | null = null,
): CitationAnswer => ({ kind: 'refused', word, detail, id, why });

/** Table 6, rule by rule across every id: the bounds first, so a bad body never waits on a read; an unreadable fact is never an
 *  absent one. A root request cites a message within `ROOT_FOUND_WINDOW_MS` of its `at` (exactly that old is still fresh) that no
 *  request has spent; a child cites only what its root cites. */
export function citationVerdict(c: {
  readonly root: boolean; readonly rootCites: ReadonlySet<number> | null; readonly now: number;
  readonly ids: readonly number[]; readonly facts: ReadonlyMap<number, CitationFact>;
}): CitationAnswer {
  if (c.ids.length > REQUEST_BOUNDS.cites) return refused('too-large', 'too-many', null);
  const seen = new Set<number>();
  for (const id of c.ids) {
    if (seen.has(id)) return refused('bad-request', 'repeated', id);
    seen.add(id);
  }
  const measured: { readonly id: number; readonly fact: Extract<CitationFact, { read: 'ok' | 'absent' }> }[] = [];
  for (const id of c.ids) {
    const fact = c.facts.get(id);
    if (fact === undefined) return refused('unmeasured', 'unread', id, 'no fact was read for this id');
    if (fact.read === 'unmeasured') return refused('unmeasured', 'unread', id, fact.why);
    measured.push({ id, fact });
  }
  for (const { id, fact } of measured) if (fact.read === 'absent') return refused('said-not-operator', 'absent', id);
  const ok = measured.map((m) => ({ id: m.id, fact: m.fact as Extract<CitationFact, { read: 'ok' }> }));
  for (const { id, fact } of ok) if (!fact.hashMatches) return refused('said-not-operator', 'changed', id);
  if (c.root) {
    for (const { id, fact } of ok) if (fact.state === 'spent') return refused('said-not-operator', 'spent', id);
    for (const { id, fact } of ok) if (c.now - fact.at > ROOT_FOUND_WINDOW_MS) return refused('said-not-operator', 'spent', id);
  } else {
    for (const { id } of ok) if (c.rootCites === null || !c.rootCites.has(id)) return refused('said-not-operator', 'not-in-root', id);
  }
  return { kind: 'ok', cites: ok.map(({ id, fact }) => ({ messageId: id, sha256: fact.sha256, root: c.root })) };
}

// ------------------------------------------------------------------------------------------------------------------------ the id

/** A request id is never issued twice (RQ10): one past the higher of the store's and the act journal's highest, either of which
 *  may be unknown. */
export function nextRequestId(storeHighest: number | null, journalHighest: number | null): number {
  return Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1;
}
