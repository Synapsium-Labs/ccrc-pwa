// The request record's vocabulary (Overlord spec §5.1, C9, H7, H22, Table 5.1b; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md` Task A1, with the index's folded rulings). Ring L0, context C5
// (Coordination): the ten states, the four actors, `REQUEST_TRANSITIONS` (the one table every door moves a request through), the
// columns each move may set, the closed move reasons and the bounds. It imports only other `shared/` files, never `node:*`,
// because the PWA may bundle it.
//
// ONE TABLE OF MOVES. Keyed by move, as `shared/ledgers.ts#ITEM_TRANSITIONS` is, with one actor and one target per move: close and
// close unverified are two rows, and hand back is three. `open` is the one row whose `from` is empty, honoured by the insert only.
// Every list here is derived from its key map or from the table, never kept by hand: the open states are those some row leaves,
// the terminal states are the rest, and a move ENTERS `needs-you` when its row's `to` is `needs-you` and its `from` holds another
// state. The rules the table cannot hold are `server/src/coord/overlordRequests.ts#nextRequestState`'s guards.
//
// NO OPERATOR WORDS. A request cites operator messages by id and hash only; the summary, the news and the close note are the
// Overlord's or a coordinator's words, masked at the door.
import type { ActorKind } from './overlord-identity.js';

const REQUEST_STATE_MAP = {
  received: 'opened, and not yet routed to an owner',
  routed: 'relayed to an owner, not yet acknowledged',
  'in-progress': 'its owner acknowledged it, or the server started a parent',
  blocked: 'its owner named a dependency it waits on',
  declined: 'its owner declined it',
  'needs-you': 'it waits on the operator',
  'done-unverified': 'closed without a done test that proved it',
  done: 'it ended done',
  failed: 'its owner failed it',
  dropped: 'the Overlord dropped it, or the operator withdrew it',
} as const;
export type RequestState = keyof typeof REQUEST_STATE_MAP;
export const REQUEST_STATES = Object.keys(REQUEST_STATE_MAP) as RequestState[];
export const isRequestState = (v: unknown): v is RequestState => typeof v === 'string' && Object.hasOwn(REQUEST_STATE_MAP, v);

const REQUEST_ACTOR_MAP = {
  overlord: 'the designated session, through its request doors and the relay',
  owner: "the owning programme's coordinator, through its request doors",
  server: 'a server lane: the done-test lane, the close door, the follow-up, Confirm the restore',
  operator: "the operator, through the console's request doors",
} as const;
export type RequestActor = keyof typeof REQUEST_ACTOR_MAP;
export const REQUEST_ACTORS = Object.keys(REQUEST_ACTOR_MAP) as RequestActor[];

/** The sequence's actor kind of each request actor (§10.4: a line carries an actor and its kind). */
export const REQUEST_ACTOR_SEQUENCE_KIND: Readonly<Record<RequestActor, ActorKind>> = {
  overlord: 'session', owner: 'session', server: 'server', operator: 'operator',
};

/** `operator` when the request cites a message, else `overlord`. A child takes its root's. */
const REQUEST_ORIGIN_MAP = { operator: true, overlord: true } as const;
export type RequestOrigin = keyof typeof REQUEST_ORIGIN_MAP;
export const REQUEST_ORIGINS = Object.keys(REQUEST_ORIGIN_MAP) as RequestOrigin[];

/** One row of the table: who makes the move, the states it leaves, and the state it reaches. */
export interface RequestTransition { readonly actor: RequestActor; readonly from: readonly RequestState[]; readonly to: RequestState }

/** Table 5.1b, keyed by move (Table 4 of the plan). `withdraw`'s `from` is spelled out, and a test holds it equal to the derived
 *  open states, so a new open state cannot miss it. */
export const REQUEST_TRANSITIONS = {
  open: { actor: 'overlord', from: [], to: 'received' },
  route: { actor: 'overlord', from: ['received'], to: 'routed' },
  're-relay': { actor: 'overlord', from: ['routed'], to: 'routed' },
  'route-elsewhere': { actor: 'overlord', from: ['declined', 'needs-you'], to: 'routed' },
  drop: { actor: 'overlord', from: ['received', 'declined', 'needs-you'], to: 'dropped' },
  escalate: { actor: 'overlord', from: ['received', 'declined'], to: 'needs-you' },
  acknowledge: { actor: 'owner', from: ['routed'], to: 'in-progress' },
  counter: { actor: 'owner', from: ['routed'], to: 'routed' },
  decline: { actor: 'owner', from: ['routed'], to: 'declined' },
  block: { actor: 'owner', from: ['in-progress'], to: 'blocked' },
  fail: { actor: 'owner', from: ['in-progress'], to: 'failed' },
  close: { actor: 'server', from: ['in-progress', 'done-unverified'], to: 'done' },
  'close-unowned': { actor: 'server', from: ['received'], to: 'done' },
  'close-unverified': { actor: 'server', from: ['in-progress'], to: 'done-unverified' },
  'start-parent': { actor: 'server', from: ['received'], to: 'in-progress' },
  'close-parent': { actor: 'server', from: ['in-progress', 'needs-you'], to: 'done' },
  'resume-parent': { actor: 'server', from: ['needs-you'], to: 'in-progress' },
  unblock: { actor: 'server', from: ['blocked'], to: 'in-progress' },
  'needs-you': { actor: 'server', from: ['received', 'routed', 'in-progress', 'blocked', 'declined'], to: 'needs-you' },
  // Relay A (RL5): the server sends a relay to the operator instead of routing it. Never from `routed` (F5): a re-relay is never
  // held. It enters `needs-you` even from `needs-you`, so an answer given before the hold never counts after it.
  'relay-held': { actor: 'server', from: ['received', 'declined', 'needs-you'], to: 'needs-you' },
  answer: { actor: 'operator', from: ['needs-you'], to: 'in-progress' },
  'answer-recorded': { actor: 'operator', from: ['needs-you'], to: 'needs-you' },
  take: { actor: 'operator', from: ['routed', 'in-progress', 'blocked'], to: 'needs-you' },
  'hand-back-routed': { actor: 'operator', from: ['needs-you'], to: 'routed' },
  'hand-back-in-progress': { actor: 'operator', from: ['needs-you'], to: 'in-progress' },
  'hand-back-blocked': { actor: 'operator', from: ['needs-you'], to: 'blocked' },
  confirm: { actor: 'operator', from: ['done-unverified'], to: 'done' },
  withdraw: {
    actor: 'operator', from: ['received', 'routed', 'in-progress', 'blocked', 'declined', 'needs-you', 'done-unverified'], to: 'dropped',
  },
} as const satisfies Readonly<Record<string, RequestTransition>>;
export type RequestMove = keyof typeof REQUEST_TRANSITIONS;
export const REQUEST_MOVES = Object.keys(REQUEST_TRANSITIONS) as RequestMove[];
export const isRequestMove = (v: unknown): v is RequestMove => typeof v === 'string' && Object.hasOwn(REQUEST_TRANSITIONS, v);
/** The row of a move, typed as the interface (the literal table's tuples widened). */
export const requestTransition = (move: RequestMove): RequestTransition => REQUEST_TRANSITIONS[move];

/** The states a request still waits in: those some row leaves, in `REQUEST_STATES` order (as `OPEN_ITEM_STATES` is derived). */
export const OPEN_REQUEST_STATES: readonly RequestState[] = REQUEST_STATES.filter(
  (s) => REQUEST_MOVES.some((m) => requestTransition(m).from.includes(s)),
);
/** The states no row leaves: `done`, `failed` and `dropped` (§5.1). */
export const TERMINAL_REQUEST_STATES: readonly RequestState[] = REQUEST_STATES.filter((s) => !OPEN_REQUEST_STATES.includes(s));
export const isTerminalRequestState = (s: RequestState): boolean => TERMINAL_REQUEST_STATES.includes(s);

/** I12's open states that carry no follow-up clock (§10.4, Table 11.7a): the operator, the done test or a dependency holds them. */
const UNCLOCKED_REQUEST_STATE_MAP = { 'needs-you': true, 'done-unverified': true, blocked: true } as const satisfies Partial<Record<RequestState, true>>;
export const UNCLOCKED_REQUEST_STATES = Object.keys(UNCLOCKED_REQUEST_STATE_MAP) as RequestState[];

/** A move ENTERS `needs-you` when its row reaches `needs-you` from at least one other state (the index's folded ruling): the
 *  `answer-recorded` self-loop never does, and a move that may also start from `needs-you` (relay A's `relay-held`) does, so an
 *  answer given before it never counts after it. */
export const transitionEntersNeedsYou = (row: RequestTransition): boolean =>
  row.to === 'needs-you' && row.from.some((s) => s !== 'needs-you');
/** The one definition of entering `needs-you` for a move of the table: the answered-since read and the reason check both ask it. */
export const requestMoveEntersNeedsYou = (move: RequestMove): boolean => transitionEntersNeedsYou(requestTransition(move));

/** The columns a move may set (Table 5.1a); the move writer refuses any other. */
const REQUEST_COLUMN_MAP = {
  owner: 'one programme slug', doneTest: 'the typed predicates, opaque here (index question 13)',
  expectedPaths: 'the project-and-path list (RQ3)', dependsOn: 'request:<id> or programme:<slug>',
  takenFrom: 'the state a take left, for its hand back', closeNote: 'why it ended, masked', counters: 'the counter-proposals received',
} as const;
export type RequestColumn = keyof typeof REQUEST_COLUMN_MAP;
export const REQUEST_COLUMNS = Object.keys(REQUEST_COLUMN_MAP) as RequestColumn[];

const RELAY_FIELDS = ['owner', 'doneTest', 'expectedPaths'] as const;
const CLOSE_FIELDS = ['closeNote'] as const;
/** What each move may set. `takenFrom` is set by `take` from the state it leaves, and cleared by the writer on every move out of
 *  `needs-you` (the index's folded ruling), so no move lists it as an input. Every move to a terminal state lists `closeNote`. */
export const REQUEST_MOVE_FIELDS: Readonly<Record<RequestMove, readonly RequestColumn[]>> = {
  open: [], route: RELAY_FIELDS, 're-relay': RELAY_FIELDS, 'route-elsewhere': RELAY_FIELDS, drop: CLOSE_FIELDS, escalate: [],
  acknowledge: [], counter: ['counters'], decline: [], block: ['dependsOn'], fail: CLOSE_FIELDS, close: CLOSE_FIELDS,
  'close-unowned': CLOSE_FIELDS, 'close-unverified': [], 'start-parent': [], 'close-parent': CLOSE_FIELDS, 'resume-parent': [],
  unblock: [], 'needs-you': [], 'relay-held': [], answer: [], 'answer-recorded': [], take: [], 'hand-back-routed': [],
  'hand-back-in-progress': [], 'hand-back-blocked': [], confirm: CLOSE_FIELDS, withdraw: CLOSE_FIELDS,
};
/** The moves whose move requires a field: `drop` carries the dropper's reason (Table 5.1a, RQ17). */
export const REQUEST_MOVE_REQUIRED_FIELDS: Readonly<Partial<Record<RequestMove, readonly RequestColumn[]>>> = { drop: ['closeNote'] };

/** The closed reason words a move row carries, each with the moves that may carry it. A move some row names must carry one of
 *  its words; a move no row names carries none. Every move that enters `needs-you` is named by at least one row (a test holds
 *  it), so each such move carries a reason. A later piece adds its word as a row here. */
export const REQUEST_MOVE_REASON_MAP = {
  'needs-start': { moves: ['escalate'], says: 'it needs a programme started (Q28)' },
  'needs-proposal': { moves: ['escalate'], says: 'it needs a proposal (Q28)' },
  'unnamed-widening': { moves: ['escalate', 'relay-held'], says: 'it widens past what the operator named' },
  dropped: { moves: ['drop'], says: 'the Overlord dropped it, with its reason in the close note (RQ17)' },
  'outside-goals': { moves: ['decline'], says: "outside its owner's goals (coordinator doors RD9)" },
  'goal-conflict': { moves: ['decline'], says: "in conflict with one of its owner's goals (RD9)" },
  impossible: { moves: ['decline'], says: 'its owner cannot do it (RD9)' },
  duplicate: { moves: ['decline'], says: 'it duplicates another request (RD9)' },
  'two-counters': { moves: ['needs-you'], says: "its owner's second counter (coordinator doors RD7)" },
  'two-silent-nudges': { moves: ['needs-you'], says: 'two nudges went unanswered (the follow-up)' },
  'due-unarmed': { moves: ['needs-you'], says: 'its follow-up came due with no lane to act (the follow-up)' },
  'off-before-ack': { moves: ['needs-you'], says: 'the rung went off before an owner acknowledged it (overlord-route-v1)' },
  'off-after-decline': { moves: ['needs-you'], says: 'the rung went off after its owner declined it (overlord-route-v1)' },
  restore: { moves: ['needs-you'], says: 'Confirm the restore moved it to the operator (act journal B)' },
  'child-ended': { moves: ['needs-you'], says: 'a child of this parent ended (done tests)' },
  'dependency-ended': { moves: ['needs-you'], says: 'the dependency it waited on ended (done tests)' },
  'operator-took-it': { moves: ['take'], says: 'the operator took it (the operator request doors)' },
  'widening-unclear': { moves: ['relay-held'], says: 'the scope-widening gate did not clear the widening it carries (relay, RL5)' },
  'quote-private-name': { moves: ['relay-held'], says: 'the quote the server renders names a private name (relay, RL5)' },
  'quote-unchecked': { moves: ['relay-held'], says: 'a cited message the server cannot render, or could not read (relay, F1)' },
} as const satisfies Readonly<Record<string, { readonly moves: readonly RequestMove[]; readonly says: string }>>;
export type RequestMoveReason = keyof typeof REQUEST_MOVE_REASON_MAP;
export const REQUEST_MOVE_REASONS = Object.keys(REQUEST_MOVE_REASON_MAP) as RequestMoveReason[];
export const isRequestMoveReason = (v: unknown): v is RequestMoveReason =>
  typeof v === 'string' && Object.hasOwn(REQUEST_MOVE_REASON_MAP, v);
/** The reason words a move may carry, in `REQUEST_MOVE_REASONS` order; empty for a move that carries none. */
export const reasonsOfMove = (move: RequestMove): readonly RequestMoveReason[] =>
  REQUEST_MOVE_REASONS.filter((r) => (REQUEST_MOVE_REASON_MAP[r].moves as readonly RequestMove[]).includes(move));

/** The escalate door's three reasons (index question 7, ruling F6), derived from the reason rows. */
export type EscalateReason = Extract<RequestMoveReason, 'needs-start' | 'needs-proposal' | 'unnamed-widening'>;
export const ESCALATE_REASONS = reasonsOfMove('escalate') as readonly EscalateReason[];
/** The relay's four hold reasons (RL5), derived from the reason rows: `unnamed-widening` is shared with the escalate door. */
export type RelayHoldReason =
  Extract<RequestMoveReason, 'unnamed-widening' | 'widening-unclear' | 'quote-private-name' | 'quote-unchecked'>;
export const RELAY_HOLD_REASONS = reasonsOfMove('relay-held') as readonly RelayHoldReason[];

/** The relay door's three moves (relay A, Table 4): each body word names the request record's move of the same name, so the
 *  door never spells a move twice. */
export const RELAY_MOVE_MAP = {
  route: 'route', 're-relay': 're-relay', 'route-elsewhere': 'route-elsewhere',
} as const satisfies Readonly<Record<string, RequestMove>>;
export type RelayMove = keyof typeof RELAY_MOVE_MAP;
export const RELAY_MOVES = Object.keys(RELAY_MOVE_MAP) as RelayMove[];
export const isRelayMove = (v: unknown): v is RelayMove => typeof v === 'string' && Object.hasOwn(RELAY_MOVE_MAP, v);
/** The relay's own bounds (Table 11.5b, RL15): the part, the act row's why and the cited entries. Its expected paths are
 *  `REQUEST_BOUNDS`' (RQ16) and its done test `DONE_TEST_BOUNDS`'; neither is restated. */
export const RELAY_BOUNDS = { partChars: 1_500, whyChars: 600, entries: 16 } as const;

/** One expected path (RQ3): the project it is in and a path, normalised by `normalizeClaimPath`, never a glob. */
export interface ExpectedPath { readonly project: string; readonly path: string }

/** Table 11.5b's starting bounds (RQ16). */
export const REQUEST_BOUNDS = {
  cites: 8, summaryChars: 200, expectedPaths: 32, pathBytes: 512, consulted: 6, closeNoteChars: 600,
} as const;
/** The detail beside a refused citation's word, one per row of `citationVerdict`'s table (plan Table 6): `absent`, `changed`,
 *  `spent` and `not-in-root` are the table's own; `too-many`, `repeated` and `unread` name its bound, repeat and read rows,
 *  which the table words by their answer alone (slug `citation-details-for-every-row`). */
export const REQUEST_CITATION_DETAIL_MAP = {
  'too-many': true, repeated: true, unread: true, absent: true, changed: true, spent: true, 'not-in-root': true,
} as const satisfies Readonly<Record<string, true>>;
export type RequestCitationDetail = keyof typeof REQUEST_CITATION_DETAIL_MAP;
export const REQUEST_CITATION_DETAILS = Object.keys(REQUEST_CITATION_DETAIL_MAP) as RequestCitationDetail[];
export const isRequestCitationDetail = (v: unknown): v is RequestCitationDetail =>
  typeof v === 'string' && Object.hasOwn(REQUEST_CITATION_DETAIL_MAP, v);
/** One message founds one root request within this window of its `at` (H22; Table 11.5b). */
export const ROOT_FOUND_WINDOW_MS = 24 * 3_600_000;
/** The follow-up clock a move into a clocked state sets (Table 11.5b's "One hour"). */
export const REQUEST_NEXT_MOVE_MS = 3_600_000;
/** At most this many candidate programmes in the code shortlist (§5.3). */
export const SHORTLIST_MAX = 6;
