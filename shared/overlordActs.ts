// The act row's vocabulary (Overlord spec 2026-11-09 §10.1, C25, H24, H27, Tables 10.1a and 10.1b; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-rows.md` Task A1). Ring L0, context K: the act states and
// `ACT_TRANSITIONS`, the target an act is keyed on, the projection a door answers with, and the text caps. It imports nothing
// at run time, because the PWA may bundle it. Every union is the key set of a const map, and each map has a runtime list
// beside it.
//
// Its own file, beside the request record's (`shared/overlordRequests.ts`), not inside the catalogue's `shared/overlord.ts`
// (slug `act-states-in-their-own-l0-file`): the catalogue answers what an act may be, this file what a written act is.

/** Table 10.1b's states. `shadow` is terminal and has no writer (no row of `ACT_TRANSITIONS` enters it). The staged four are
 *  W3's, written by nothing in W2. */
const ACT_STATE_MAP = {
  pending: 'written before an effect outside the database, and settled by measuring',
  done: 'the effect happened',
  refused: 'the effect did not happen; the row frees its natural key',
  unknown: 'the settle could not measure the effect; it leaves only by a measurement',
  staged: 'a grant-backed answer waits out its veto window (W3)',
  effective: 'the veto clock ran out and the staged act took effect (W3)',
  vetoed: "the operator's Veto came before the commit (W3)",
  voided: 'a change of authority or of a cited fact voided the staged act (W3)',
  preempted: 'the operator answered first (W3)',
  shadow: 'recorded in shadow; never performed, and nothing writes it',
} as const;
export type ActState = keyof typeof ACT_STATE_MAP;
export const ACT_STATES = Object.keys(ACT_STATE_MAP) as ActState[];
export function isActState(v: unknown): v is ActState {
  return typeof v === 'string' && Object.hasOwn(ACT_STATE_MAP, v);
}

/** Who may make a move (Table 1's By column): the act door (its first write and its second step), the settling lane, the boot
 *  pass, and W3's staging and veto clock, which no W2 code is. */
const ACT_MOVER_MAP = {
  door: 'the door that performs the act, in its first write or its second step',
  lane: 'the settling lane',
  boot: 'the boot pass',
  staging: "W3's staging and its veto clock (no writer in W2)",
} as const;
export type ActMover = keyof typeof ACT_MOVER_MAP;
export const ACT_MOVERS = Object.keys(ACT_MOVER_MAP) as ActMover[];

/** One move: from a state (`null`: the row's insert) to a state, by the movers listed. */
export interface ActTransition { readonly from: ActState | null; readonly to: ActState; readonly by: readonly ActMover[] }

const SETTLERS: readonly ActMover[] = ['door', 'lane', 'boot'];
const MEASURERS: readonly ActMover[] = ['lane', 'boot'];

/** Table 1 of the plan (Table 10.1b), one row per move. `unknown` leaves only by a measurement, so only the lane and the boot
 *  pass move it; the door's second step settles `pending` alone. */
export const ACT_TRANSITIONS: readonly ActTransition[] = [
  { from: null, to: 'pending', by: ['door'] },
  { from: null, to: 'done', by: ['door'] },
  { from: 'pending', to: 'done', by: SETTLERS },
  { from: 'pending', to: 'refused', by: SETTLERS },
  { from: 'pending', to: 'unknown', by: SETTLERS },
  { from: 'unknown', to: 'done', by: MEASURERS },
  { from: 'unknown', to: 'refused', by: MEASURERS },
  { from: null, to: 'staged', by: ['staging'] },
  { from: 'staged', to: 'effective', by: ['staging'] },
  { from: 'staged', to: 'vetoed', by: ['staging'] },
  { from: 'staged', to: 'voided', by: ['staging'] },
  { from: 'staged', to: 'preempted', by: ['staging'] },
];

/** A state no row leaves, derived from the table. */
export const ACT_TERMINAL_STATES: readonly ActState[] = ACT_STATES.filter((s) => !ACT_TRANSITIONS.some((t) => t.from === s));
/** The states a row can still leave: every state but the terminal ones. */
export const ACT_OPEN_STATES: readonly ActState[] = ACT_STATES.filter((s) => !ACT_TERMINAL_STATES.includes(s));
/** The states the settling lane re-measures (`pending` and `unknown`): those a row leaves by the lane's move. */
export const ACT_LANE_STATES: readonly ActState[] = ACT_STATES.filter((s) => ACT_TRANSITIONS.some((t) => t.from === s && t.by.includes('lane')));

/** Whether `by` may move a row from `from` (`null`: its insert) to `to`. */
export function actMoveAllowed(from: ActState | null, to: ActState, by: ActMover): boolean {
  return ACT_TRANSITIONS.some((t) => t.from === from && t.to === to && t.by.includes(by));
}

/** What an act's natural key names (§10.1, question 2; the W2 index's row, ruled, fold): its target row and the revision acted
 *  on, or, for a start, its request alone. `revision` is the slot a kind that repeats at one revision fills with its own
 *  discriminator (the nudge's ordinal; a band-3 request row's order number). A target with no revision column reads 0. */
const ACT_TARGET_KIND_MAP = {
  message: "an operator message, by its id (revision 0: the inbox's own state check stops a second effect)",
  delivery: 'a held delivery to the role, by its delivery id (revision 0)',
  request: 'a request, by its id, at its revision or the order number of the settled row',
  note: 'a note the write made, by its own row id (revision 0; slug note-write-keys-on-its-row)',
} as const;
export type ActTargetKind = keyof typeof ACT_TARGET_KIND_MAP;
export const ACT_TARGET_KINDS = Object.keys(ACT_TARGET_KIND_MAP) as ActTargetKind[];
export function isActTargetKind(v: unknown): v is ActTargetKind {
  return typeof v === 'string' && Object.hasOwn(ACT_TARGET_KIND_MAP, v);
}
/** The target an act is keyed on: one row at one revision, or a start's request (one start per request, F10). */
export type ActTarget =
  | { readonly kind: ActTargetKind; readonly id: number; readonly revision: number }
  | { readonly kind: 'start'; readonly requestId: number };

/** What the targets list names (Table 10.1a: "The programme, session, item, ask or run ids, each with the revision acted on"),
 *  with the natural key's own row kinds. Ids are text: a programme is its slug. */
const ACT_TARGET_REF_KIND_MAP = {
  programme: 'a programme, by its slug', session: 'a session, by its id', item: 'an operator item', ask: 'an ask',
  run: 'a run', request: 'a request', message: 'an operator message', delivery: 'a mail delivery', note: 'a note',
} as const;
export type ActTargetRefKind = keyof typeof ACT_TARGET_REF_KIND_MAP;
export const ACT_TARGET_REF_KINDS = Object.keys(ACT_TARGET_REF_KIND_MAP) as ActTargetRefKind[];
export function isActTargetRefKind(v: unknown): v is ActTargetRefKind {
  return typeof v === 'string' && Object.hasOwn(ACT_TARGET_REF_KIND_MAP, v);
}
export interface ActTargetRef { readonly kind: ActTargetRefKind; readonly id: string; readonly revision: number }

/** The projection a door answers with (question 3): the row's id, kind, state, outcome, natural key, targets and request.
 *  `kind`, `state` and `outcome` are stored words, carried as they are: a word this build lacks is never dropped. */
export interface ActAnswer {
  readonly id: number; readonly kind: string; readonly state: string; readonly outcome: string | null;
  readonly naturalKey: string; readonly targets: readonly ActTargetRef[]; readonly requestId: number | null;
}

/** Table 11.5b: the Overlord's words on an act row, cut whole after the egress mask. */
export const ACT_SUMMARY_MAX = 200;
export const ACT_WHY_MAX = 600;
