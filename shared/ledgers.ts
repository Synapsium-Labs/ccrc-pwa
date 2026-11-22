// Programme ledgers (plan PL1): the vocabulary of the operator's items, the transition table
// that decides every move of one, and the small pure deciders around them.
//
// Ring: L0/L1, context Coordination. The server (store, routes) and the PWA (list, item view, programme
// view) both read this file, so it is pure: it imports only from other `shared/` modules (the run
// vocabulary from `./api.js`), never `node:*` and nothing outside `shared/`.
//
// ONE WRITER PER MOVE. `ITEM_TRANSITIONS` is the only place an item's move is decided, and
// `nextItemState` reads it; a route or a store method that wants to move an item asks the decider and
// never compares states itself. The one rule the table cannot carry is the programme context: the
// operator may dismiss only while the programme has no open run (spec D15), and `nextItemState` is
// where that is decided.
import { ACTIVE_RUN_STATES, OUTSTANDING_DELIVERY_STATES, TERMINAL_RUN_STATES, isStuckReason, type CallView, type MailDeliveryState, type Presence, type RunKind, type RunState, type StuckReason } from './api.js';
import { type ParkedApprovalView } from './approval-park.js';
import { DOC_SECTIONS, DOC_SECTION_SLUGS } from './docs.js';
import { utf8Bytes } from './utf8.js';
import { PLAN_END_OUTCOMES, type PlanEndOutcome } from './plan.js';
import type { AnswerMarksView, AskMarkRow } from './answerMarks.js';

/** What the operator is asked to do. `decide` and `value` carry an answer; `do` needs none, and its tick may carry the
 *  operator's optional note as its answer (D-8931); a `secret`'s value goes to its slot, never through the
 *  answer (spec §5). */
export type ItemKind = 'decide' | 'do' | 'value' | 'secret';
const ITEM_KIND_MAP: Record<ItemKind, true> = { decide: true, do: true, value: true, secret: true };
export const ITEM_KINDS = Object.keys(ITEM_KIND_MAP) as readonly ItemKind[];

/** `open` and `checking` are the live pair; the other three are closed. */
export type ItemState = 'open' | 'checking' | 'done' | 'withdrawn' | 'dismissed';
const ITEM_STATE_MAP: Record<ItemState, true> = {
  open: true, checking: true, done: true, withdrawn: true, dismissed: true,
};
export const ITEM_STATES = Object.keys(ITEM_STATE_MAP) as readonly ItemState[];

/** `blocking` = work has stopped on it; `soon` carries a short label; `later` is the rest. */
export type NeededBy = 'blocking' | 'soon' | 'later';
const NEEDED_BY_MAP: Record<NeededBy, true> = { blocking: true, soon: true, later: true };
export const NEEDED_BY_LEVELS = Object.keys(NEEDED_BY_MAP) as readonly NeededBy[];

/** `act`, `decline` and `settle` are the moves of an item that carries an `ItemAction` (spec 2026-11-04 §10, A18). */
export type ItemAct = 'tick' | 'confirm' | 'return' | 'withdraw' | 'dismiss' | 'act' | 'decline' | 'settle';
/** `ccrc` is the server itself: it raises an end request on a worker's behalf and settles an item when the run is handled. */
export type ItemActor = 'operator' | 'coordinator' | 'ccrc';
const ITEM_ACT_MAP: Record<ItemAct, true> = {
  tick: true, confirm: true, return: true, withdraw: true, dismiss: true, act: true, decline: true, settle: true,
};
export const ITEM_ACTS = Object.keys(ITEM_ACT_MAP) as readonly ItemAct[];
/** The acts an item event records besides an `ItemAct`: a raise and a blocking change, which do not move the item. An
 *  event's act is an `ItemEventAct`; `isItemNonMove` reads this one map (Overlord W1, portfolio). */
export type ItemNonMove = 'raise' | 'block' | 'unblock';
export type ItemEventAct = ItemAct | ItemNonMove;
const ITEM_NON_MOVE_MAP: Record<ItemNonMove, true> = { raise: true, block: true, unblock: true };
export const isItemNonMove = (act: string): act is ItemNonMove => Object.prototype.hasOwnProperty.call(ITEM_NON_MOVE_MAP, act);
const ITEM_ACTOR_MAP: Record<ItemActor, true> = { operator: true, coordinator: true, ccrc: true };
export const ITEM_ACTORS = Object.keys(ITEM_ACTOR_MAP) as readonly ItemActor[];

/** Spec Figure 2. The operator moves an item only by ticking it, or by dismissing it while its
 *  programme has no open run; every other move is the coordinator's. */
export const ITEM_TRANSITIONS: Readonly<Record<ItemAct, {
  actor: ItemActor; from: readonly ItemState[]; to: ItemState;
}>> = {
  tick: { actor: 'operator', from: ['open'], to: 'checking' },
  confirm: { actor: 'coordinator', from: ['checking'], to: 'done' },
  return: { actor: 'coordinator', from: ['checking'], to: 'open' },
  withdraw: { actor: 'coordinator', from: ['open', 'checking'], to: 'withdrawn' },
  dismiss: { actor: 'operator', from: ['open', 'checking'], to: 'dismissed' },
  // Spec §10: none of the three takes `programme-live`, because `nextItemState` asks that of `dismiss` alone.
  act: { actor: 'operator', from: ['open'], to: 'done' },
  decline: { actor: 'operator', from: ['open'], to: 'dismissed' },
  settle: { actor: 'ccrc', from: ['open', 'checking'], to: 'done' },
};

/** The ways an operator can answer a refused close (spec 2026-11-04 §12.2, A19): every door but one opens a page or a sheet that
 *  already exists, and `abandon-anyway` opens §9.1's sheet and reuses `act`. D-8558: a claimant the registry no longer holds
 *  gets no `open-coordinator` (a door to a session that does not exist); `close-run` takes its place, the same `act` with the
 *  operator's reason, and `end-programme` is that act ending the programme too, offered on the programme's last live run. */
export type ItemDoor =
  | 'open-pr' | 'hand-to-coordinator' | 'abandon' | 'abandon-anyway' | 'open-worker' | 'open-coordinator' | 'close-run' | 'end-programme';
const ITEM_DOOR_MAP: Record<ItemDoor, true> = {
  'open-pr': true, 'hand-to-coordinator': true, abandon: true, 'abandon-anyway': true, 'open-worker': true, 'open-coordinator': true,
  'close-run': true, 'end-programme': true,
};
export const ITEM_DOORS = Object.keys(ITEM_DOOR_MAP) as readonly ItemDoor[];
export const isItemDoor = (v: unknown): v is ItemDoor => typeof v === 'string' && (ITEM_DOORS as readonly string[]).includes(v);
/** At least one door: an item with none does not compile (the ruling: a Waiting on you item carries a control that works). */
export type ItemDoors = readonly [ItemDoor, ...ItemDoor[]];
/** The doors that end the run through the operator's `act`. */
export const ABANDONING_DOORS: readonly ItemDoor[] = ['abandon', 'abandon-anyway', 'close-run', 'end-programme'];

/** The typed action an item carries, written by the server alone (`raiseItem`; `parseRaise` never reads one). `end-run`: the
 *  operator's `act` abandons the run and `decline` keeps it; `stuckReason` is the reason the run was stuck under when the
 *  request was raised, so a later request can tell a changed reason from a repeat. `close-refused`: a close an armed lane
 *  refused, with the doors the operator may take; only an abandoning door reaches `act`, and `decline` applies to `end-run` alone. */
export type ItemAction =
  | { verb: 'end-run'; runId: number; stuckReason: StuckReason | null }
  | { verb: 'close-refused'; runId: number; doors: ItemDoors }
  // The hierarchy items (Linear hierarchy design, D-8181): none names a run, so none can abandon one.
  | { verb: 'linear-map'; migrationId: number }
  | { verb: 'linear-report'; migrationId: number }
  | { verb: 'linear-drift'; bindingId: number }
  | { verb: 'linear-initiatives'; workspaceId: string }
  | { verb: 'linear-owner'; project: string }
  // D-8808 (review 3048 F5): inbound issues of a team key two connected workspaces hold wait because the projects that hold the
  // key name no workspace. One open item per team key (upper-case); the remedy is the project row's Workspace on
  // `LINEAR_PROJECTS_SETTINGS_PATH`, so the item takes no act of its own and settles itself once no waiting issue of the key
  // depends on the workspace choice (an issue may still wait then, on its owner).
  | { verb: 'linear-team-workspace'; teamKey: string }
  | ReleaseReviewAction
  // Approvals PR 2 (plan 2026-11-18 §3.2.2, Task 2.2), narrowed by the Overlord's slug item-only-when-given-up: ccrc gave up
  // capturing this Claude Code build. The build is the item's key: one open item per build. It names no run, so it abandons nothing.
  | { verb: 'untrusted-build'; build: string };
/** The untrusted-build action's verb, the one spelling its readers bind (approvals PR 2, Task 2.2). */
export const UNTRUSTED_BUILD_VERB = 'untrusted-build' as const;
export type UntrustedBuildAction = Extract<ItemAction, { verb: 'untrusted-build' }>;
export const isUntrustedBuildAction = (a: ItemAction | null): a is UntrustedBuildAction => a !== null && a.verb === UNTRUSTED_BUILD_VERB;
/** The console page the untrusted-build item's step links to (review 2752 F4): Settings' Automation section, whose Test box
 *  build list holds the build's row and its Capture again. The item's text names it, and the console links a routed path. */
export const UNTRUSTED_BUILD_SETTINGS_PATH = '/settings/automation';
/** The console page that holds every project's Linear row, its team key and its Workspace (D-8808): Settings' Integrations
 *  section (D-8932; Security held it before, and an item written then still names `/settings/security`,
 *  where a line points here). The `linear-team-workspace` item's text names it and the console links it. */
export const LINEAR_PROJECTS_SETTINGS_PATH = '/settings/integrations';
/** The six hierarchy verbs, and the acts the operator takes on each (the item's own controls, wave 5). `linear-team-workspace`
 *  takes none: its remedy is a setting on the project's row (D-8808). */
export type LinearActionVerb = 'linear-map' | 'linear-report' | 'linear-drift' | 'linear-initiatives' | 'linear-owner' | 'linear-team-workspace';
export type LinearItemAct = 'approve' | 'return' | 'put-back' | 'done' | 'hand' | 'keep' | 'check-again' | 'name';
const LINEAR_ACTION_VERB_MAP: Record<LinearActionVerb, true> = {
  'linear-map': true, 'linear-report': true, 'linear-drift': true, 'linear-initiatives': true, 'linear-owner': true, 'linear-team-workspace': true,
};
export const isLinearActionVerb = (v: unknown): v is LinearActionVerb =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(LINEAR_ACTION_VERB_MAP, v);
const LINEAR_ITEM_ACT_MAP: Record<LinearItemAct, true> = {
  approve: true, return: true, 'put-back': true, done: true, hand: true, keep: true, 'check-again': true, name: true,
};
export const isLinearItemAct = (v: unknown): v is LinearItemAct =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(LINEAR_ITEM_ACT_MAP, v);
export const LINEAR_ITEM_ACTS: Readonly<Record<LinearActionVerb, readonly LinearItemAct[]>> = {
  'linear-map': ['approve', 'return'], 'linear-report': ['put-back', 'done'], 'linear-drift': ['hand', 'keep'],
  'linear-initiatives': ['check-again'], 'linear-owner': ['name'], 'linear-team-workspace': [],
};
export type LinearItemAction = Extract<ItemAction, { verb: LinearActionVerb }>;
export const isLinearItemAction = (a: ItemAction | null): a is LinearItemAction =>
  a !== null && Object.prototype.hasOwnProperty.call(LINEAR_ITEM_ACTS, a.verb);
/** D-8293: a REVIEW child kept past its ceiling (`review-report-stale`, D-5942). `runId` is the run it reviewed, still open,
 *  so that run's close settles the item as it settles every action item of the run; `reviewRunId` is the review run that
 *  minted the child, and `sessionId` the child. The operator's `act` releases the review's report: the child reclaim sweep
 *  stops keeping the workspace for that run, and the ordinary reclaim takes it, pinning its work first. There is no `decline`:
 *  the coordinator keeps a report it still cites by withdrawing the item inside its hold. */
/** The release-review action's verb, the one spelling a store query binds (D-8293). */
export const RELEASE_REVIEW_VERB = 'release-review' as const;
export interface ReleaseReviewAction { verb: 'release-review'; runId: number; reviewRunId: number; sessionId: string }
/** The `end-run` action, and the one place its verb is spelled for the readers that ask which action an item carries. */
export type EndRunAction = Extract<ItemAction, { verb: 'end-run' }>;
export const isEndRunAction = (a: ItemAction | null): a is EndRunAction => a !== null && a.verb === 'end-run';
export const endRunAction = (runId: number, stuckReason: StuckReason | null): EndRunAction => ({ verb: 'end-run', runId, stuckReason });
/** The `close-refused` action. */
export type CloseRefusedAction = Extract<ItemAction, { verb: 'close-refused' }>;
export const isCloseRefusedAction = (a: ItemAction | null): a is CloseRefusedAction => a !== null && a.verb === 'close-refused';
export const closeRefusedAction = (runId: number, doors: ItemDoors): CloseRefusedAction => ({ verb: 'close-refused', runId, doors });
/** The `release-review` action (D-8293). */
export const isReleaseReviewAction = (a: ItemAction | null): a is ReleaseReviewAction => a !== null && a.verb === 'release-review';
export const releaseReviewAction = (runId: number, reviewRunId: number, sessionId: string): ReleaseReviewAction =>
  ({ verb: 'release-review', runId, reviewRunId, sessionId });
/** Can the operator's `act` abandon the run for this action: an `end-run`, or a `close-refused` with an abandoning door. A
 *  `release-review` act abandons nothing. */
export const actAbandons = (a: ItemAction | null): boolean =>
  a !== null && (a.verb === 'end-run' || (a.verb === 'close-refused' && a.doors.some((d) => ABANDONING_DOORS.includes(d))));
/** Whether an item's action admits a move (A-1, review 2394, against D-8720). An item that carries an action ends by `act`,
 *  `decline`, `withdraw` or `settle`: a tick, confirm or return would strand it. A persistent-drift item is closed by the operator's
 *  Hand or Keep alone (`linear-drift`), so the generic dismiss door must not quiet it. `moveItemInTx` is the one asker; it answers
 *  `not-open` for a refusal, as for any move the item's state does not take. */
export function actionAdmits(action: ItemAction | null, act: ItemAct): boolean {
  if (action === null) return true;
  if (act === 'tick' || act === 'confirm' || act === 'return') return false;
  return !(act === 'dismiss' && action.verb === 'linear-drift');
}
/** Reads a stored action column; null when it is not an `ItemAction`. The one reader of the column's JSON. */
export function parseItemAction(text: string): ItemAction | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const int = (k: string): number | null => (typeof o[k] === 'number' && Number.isInteger(o[k]) ? (o[k] as number) : null);
  const word = (k: string): string | null => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : null);
  // The hierarchy verbs name no run.
  if (o['verb'] === 'linear-map' || o['verb'] === 'linear-report') {
    const migrationId = int('migrationId');
    return migrationId === null ? null : { verb: o['verb'], migrationId };
  }
  if (o['verb'] === 'linear-drift') {
    const bindingId = int('bindingId');
    return bindingId === null ? null : { verb: 'linear-drift', bindingId };
  }
  if (o['verb'] === 'linear-initiatives') {
    const workspaceId = word('workspaceId');
    return workspaceId === null ? null : { verb: 'linear-initiatives', workspaceId };
  }
  if (o['verb'] === 'linear-owner') {
    const project = word('project');
    return project === null ? null : { verb: 'linear-owner', project };
  }
  if (o['verb'] === 'linear-team-workspace') {
    const teamKey = word('teamKey');
    return teamKey === null ? null : { verb: 'linear-team-workspace', teamKey };
  }
  if (o['verb'] === UNTRUSTED_BUILD_VERB) {
    const build = word('build');
    return build === null ? null : { verb: UNTRUSTED_BUILD_VERB, build };
  }
  if (typeof o['runId'] !== 'number' || !Number.isInteger(o['runId'])) return null;
  if (o['verb'] === 'release-review') {
    const review = o['reviewRunId'];
    const session = o['sessionId'];
    if (typeof review !== 'number' || !Number.isInteger(review) || typeof session !== 'string' || session === '') return null;
    return releaseReviewAction(o['runId'], review, session);
  }
  if (o['verb'] === 'close-refused') {
    const doors = o['doors'];
    if (!Array.isArray(doors) || doors.length === 0 || !doors.every(isItemDoor)) return null;
    return closeRefusedAction(o['runId'], doors as unknown as ItemDoors);
  }
  if (o['verb'] !== 'end-run') return null;
  const reason = o['stuckReason'];
  if (reason !== null && !isStuckReason(reason)) return null;
  return { verb: 'end-run', runId: o['runId'], stuckReason: reason };
}

/** The run's name as the console says it on a row: its own title, else the programme's, and the wave in words. The server writes the
 *  title of an item about a run (an end request, a refused close), so it spells the console's words here once. */
export function itemRunName(run: { program: string; programTitle: string; runTitle?: string | null; wave: number; waveOf: number | null; kind: RunKind }): string {
  const own = typeof run.runTitle === 'string' && run.runTitle.trim() !== '' ? run.runTitle : null;
  const programme = own ?? (run.programTitle.trim() !== '' ? run.programTitle : run.program);
  const wave = run.waveOf === null ? `wave ${run.wave}` : `wave ${run.wave} of ${run.waveOf}`;
  return `${programme} · ${run.kind === 'review' ? `review of wave ${run.wave}` : wave}`;
}

/** The states an item still waits in: the states some row of `ITEM_TRANSITIONS` leaves, in `ITEM_STATES` order
 *  (today `open` and `checking`). Derived from the table, so a state the table can still move an item out of
 *  is never missing from it. */
export const OPEN_ITEM_STATES: readonly ItemState[] = ITEM_STATES.filter(
  (s) => Object.values(ITEM_TRANSITIONS).some((row) => row.from.includes(s)),
);

/** Why a move of one item is refused (the decider's three, and `unknown-item` for an id the store holds no row for).
 *  Declared once here so the store's answers and, in PL3 and PL4, the routes' typed refusals read the same words. */
export type ItemMoveRefusal = 'unknown-item' | 'wrong-actor' | 'not-open' | 'programme-live';
const ITEM_MOVE_REFUSAL_MAP: Record<ItemMoveRefusal, true> = {
  'unknown-item': true, 'wrong-actor': true, 'not-open': true, 'programme-live': true,
};
export const ITEM_MOVE_REFUSALS = Object.keys(ITEM_MOVE_REFUSAL_MAP) as readonly ItemMoveRefusal[];
export function isItemMoveRefusal(v: unknown): v is ItemMoveRefusal {
  return typeof v === 'string' && (ITEM_MOVE_REFUSALS as readonly string[]).includes(v);
}

export type ItemMove =
  | { ok: true; to: ItemState }
  | { ok: false; why: Exclude<ItemMoveRefusal, 'unknown-item'> };

/**
 * The decider. Order of refusals: a state the act does not leave is `not-open` whoever asks, then a
 * wrong actor is `wrong-actor`, then a dismiss while the programme is live is `programme-live` (D15).
 * Every other act ignores `ctx`.
 */
export function nextItemState(
  state: ItemState, act: ItemAct, actor: ItemActor, ctx: { programmeHasOpenRun: boolean },
): ItemMove {
  const row = ITEM_TRANSITIONS[act];
  if (!row.from.includes(state)) return { ok: false, why: 'not-open' };
  if (row.actor !== actor) return { ok: false, why: 'wrong-actor' };
  if (act === 'dismiss' && ctx.programmeHasOpenRun) return { ok: false, why: 'programme-live' };
  return { ok: true, to: row.to };
}

/** One item as the console shows it. `stale` is the server's verdict (`itemIsStale`, below): a label only. */
export interface ItemView {
  id: number;
  program: string;
  runId: number | null;
  kind: ItemKind;
  title: string;
  why: string;
  how: string[];
  options: string[] | null;
  /** A decide item's recommended option (plan PL9, spec §3.2, D24): the 0-based index into `options` of the option its raiser
   *  recommends, with `recommendedWhy`, why it beats each alternative. Both or neither: `null` on every other kind and on a
   *  decide item raised before the rule, which the console draws as before. A server from before PL9 omits both, so a reader
   *  goes through `recommendationOf`, never the fields. */
  recommended: number | null;
  recommendedWhy: string | null;
  neededBy: NeededBy;
  soonLabel: string | null;
  state: ItemState;
  stale: boolean;
  raisedAt: number;
  tickedAt: number | null;
  closedAt: number | null;
  answer: string | null;
  note: string | null;
  secretSlot: string | null;
  /** The slot's state (plan PL6), read from its metadata file: when it was set, its tail (`secretTailOf`) and whether the
   *  egress masker knows it. `why` says why it does not, and is absent when it does (or from a server before PL6).
   *  `{at: null}`: the slot HOLDS a value but its record is missing, unreadable or unparseable (review 1416 F4), so nothing
   *  is known of when or how; it is stored all the same, never folded into `null`, which is a slot that holds no value. Its
   *  `tail` is always empty, for a console from before it that reads one (review 1418 F3).
   *  `{unreadable: true}`: the box cannot read the slot (a directory it cannot search, an I/O error; review 1418 F2), so
   *  whether a value is stored is not known: neither stored nor nothing stored. */
  secretSet: { at: number; tail: string; masked: boolean; why?: SecretUnmasked } | { at: null; tail: '' } | { unreadable: true } | null;
  /** The typed action the server wrote for the item (spec 2026-11-04 §10): `end-run`, `close-refused` or `release-review` (D-8293). `null` on an ordinary item, and
   *  absent from a server from before it, so a reader goes through `isEndRunAction(item.action ?? null)`, never the field. */
  action?: ItemAction | null;
  /** The row's revision (Overlord W2, spec §6.7): raised by each move of the item, 0 at its raise. A server from before W2
   *  omits it. Nothing in the console reads it yet: the first piece that does (W3's answer doors) adds the one reader,
   *  `rowRevisionOf`, answering a number or `'absent'`. */
  revision?: number;
  /** The operator's two answer marks (Overlord W1, spec §9.2.1, C70), on a `decide` or `value` item they were shown while it is
   *  listed. ABSENT means this server cannot mark this row (an older server, or a row with no box), never "never marked"
   *  (plan question 14): a reader goes through the console's one reader, `answerMarkWords.ts#answerMarksOf`. */
  answerMarks?: AnswerMarksView;
  history: { at: number; act: ItemAct | 'raise' | 'block' | 'unblock'; note: string | null; actor?: ItemActor }[];
}

/** What a goals version rests on (Overlord W1, portfolio B; spec §3.8), stored as `ratifiedBy` on the pin and on each
 *  modification. It records the SOURCE only; whether that source ratifies is `goalRatification`'s, decided at every read.
 *  W2 adds `{ kind: 'request' }`, with the row's requestId; the parser refuses it until then. */
export type RatifiedBy =
  | { kind: 'coordinator' }                  // the programme's own coordinator wrote it
  | { kind: 'item' }                         // a modification that cites an item; the id is the row's itemId
  | { kind: 'operator' };                    // the operator's ratify door
export type RatifiedByKind = RatifiedBy['kind'];
const RATIFIED_BY_KIND_MAP: Record<RatifiedByKind, true> = { coordinator: true, item: true, operator: true };
/** Whether a word off the wire is a source this build can name (a newer server may send one it cannot). */
export const isRatifiedByKind = (raw: unknown): raw is RatifiedByKind =>
  typeof raw === 'string' && Object.prototype.hasOwnProperty.call(RATIFIED_BY_KIND_MAP, raw);
/** NULL is a version written before the column (`unrecorded`); any other text this build cannot read is `unreadable`. */
export const parseRatifiedBy = (raw: string | null): RatifiedBy | 'unrecorded' | 'unreadable' =>
  raw === null ? 'unrecorded' : isRatifiedByKind(raw) ? { kind: raw } : 'unreadable';
export const ratifiedByText = (r: RatifiedBy): string => r.kind;
/** What a coordinator door may record: every source but the operator's, which only the ratify door writes (review 2240 F6). */
export type WrittenSource = Exclude<RatifiedBy, { kind: 'operator' }>;
/** A modification's source, from the row's own `itemId` (review 2240 F6: the store derives it, never the route). */
export const modificationSource = (itemId: number | null): WrittenSource => (itemId === null ? { kind: 'coordinator' } : { kind: 'item' });
/** The pin's stored source, counted only when it was recorded at or after the pin's text (review 2240 F2): a build older than
 *  the ratification columns re-pins the text and leaves the source, so a source older than `inShortAt` describes text that is
 *  gone, and reads `unrecorded`. Every writer of this build stamps `ratifiedAt` with or after `inShortAt`. */
export const pinSource = (ratifiedBy: string | null, ratifiedAt: number | null, inShortAt: number | null): RatifiedBy | 'unrecorded' | 'unreadable' =>
  ratifiedBy === null || ratifiedAt === null || inShortAt === null || ratifiedAt < inShortAt ? 'unrecorded' : parseRatifiedBy(ratifiedBy);
/** (Question 1.) Whether a coordinator's own PIN ratifies. Operator item 328 (2026-11-16) answered yes: "a coordinator's
 *  pin counts, shown as ratified by the coordinator" (slug coordinator-pin-ratifies). The pin only: a coordinator's
 *  modification never ratifies (review 2240 F3; a change to the definition of done is operator-only, O3). */
export const COORDINATOR_SOURCE_RATIFIES: boolean = true;
/** Question 3's predicate: the operator ticked the item and it was not returned since (`checking` or `done`, with a tick).
 *  A return moves it back to `open` keeping its old `tickedAt`; `act` and a settle from `open` reach `done` with none. */
export const itemAnswered = (item: { state: string; tickedAt: number | null }): boolean =>
  (item.state === 'checking' || item.state === 'done') && item.tickedAt !== null;
export type RatificationWhy = 'unrecorded' | 'unreadable' | 'source-does-not-ratify' | 'effect-unmeasured'
  | 'item-not-answered' | 'absent';
const RATIFICATION_WHY_MAP: Record<RatificationWhy, true> = {
  unrecorded: true, unreadable: true, 'source-does-not-ratify': true, 'effect-unmeasured': true, 'item-not-answered': true, absent: true,
};
/** Whether a word off the wire is a reason this build can name (a newer server may send one it cannot). */
export const isRatificationWhy = (raw: unknown): raw is RatificationWhy =>
  typeof raw === 'string' && Object.prototype.hasOwnProperty.call(RATIFICATION_WHY_MAP, raw);
export type Ratification =
  | { ratified: true; source: RatifiedBy }
  | { ratified: false; why: RatificationWhy; source: RatifiedBy | null };
/** Whether a goals version's source ratifies it. Pure. `item` is the cited item as the store read it, or null when the row
 *  cites no item of this programme. `of` says whether the version is the pin or a modification: a coordinator's source
 *  ratifies the pin only (question 1, review 2240 F3). The `item` arm answers `effect-unmeasured` in W1, because §6.3's
 *  effect check arrives in W3 (slug item-ratifies-with-its-effect), which replaces that one arm. */
export function goalRatification(source: RatifiedBy | 'unrecorded' | 'unreadable',
  item: { program: string; state: string; tickedAt: number | null } | null, program: string, of: 'pin' | 'modification'): Ratification {
  if (source === 'unrecorded' || source === 'unreadable') return { ratified: false, why: source, source: null };
  switch (source.kind) {
    case 'coordinator':
      return of === 'pin' && COORDINATOR_SOURCE_RATIFIES ? { ratified: true, source } : { ratified: false, why: 'source-does-not-ratify', source };
    case 'item':
      if (item === null || item.program !== program) return { ratified: false, why: 'unreadable', source };
      return { ratified: false, why: itemAnswered(item) ? 'effect-unmeasured' : 'item-not-answered', source };
    case 'operator':
      return { ratified: true, source };
    default: {
      const never: never = source;
      return { ratified: false, why: 'unreadable', source: never };
    }
  }
}
/** The version the operator ratifies (the ratify door's body): the pin, named by the `inShortAt` stamp they were shown, or a
 *  modification by id. */
export type GoalsVersion = { pin: { inShortAt: number } } | { modification: number };
/** The ratify door's body read, exactly one of the two shapes with nothing else in it, or null. Shared so the console builds
 *  only what the door takes. */
export function parseGoalsVersion(raw: unknown): GoalsVersion | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1) return null;
  const b = raw as Record<string, unknown>;
  if (keys[0] === 'modification') return Number.isSafeInteger(b['modification']) && (b['modification'] as number) > 0 ? { modification: b['modification'] as number } : null;
  if (keys[0] !== 'pin') return null;
  const pin = b['pin'];
  if (typeof pin !== 'object' || pin === null || Array.isArray(pin) || Object.keys(pin).length !== 1) return null;
  const at = (pin as Record<string, unknown>)['inShortAt'];
  return Number.isSafeInteger(at) && (at as number) >= 0 ? { pin: { inShortAt: at as number } } : null;
}
/** The one reader of `GoalsView`'s optional verdicts: one absent from an older server is its own word, `absent`. */
export const ratificationOf = (r: Ratification | undefined): Ratification => r ?? { ratified: false, why: 'absent', source: null };

/** A programme's pinned spec and what has changed since its approval. */
export interface GoalsView {
  program: string;
  specPath: string | null;
  inShort: string | null;
  inShortAt: number | null;
  modifications: {
    id: number; at: number; text: string; ruling: string | null;
    itemId: number | null; pr: number | null; merged: boolean;
    /** Overlord W1, portfolio B: this row's verdict. Absent from an older server: read it through `ratificationOf`. */
    ratification?: Ratification;
  }[];
  /** The stored definition of done (D-8126): optional on the type, always sent by the server;
   *  null when none is stored. */
  doneWhen?: readonly string[] | null;
  /** Overlord W1, portfolio B: the pin's verdict, and the verdict of the version that wrote the current definition of done
   *  (`doneWhenBy`). Absent from an older server: read each through `ratificationOf`. */
  pinRatification?: Ratification;
  doneWhenRatification?: Ratification;
  /** Overlord W1, portfolio B (review 2240 F4): the version that wrote the stored definition of done, so the console shows
   *  the list beside that version's verdict and Ratify control: the pin by its stamp, or a modification by id. Null when the
   *  writer is not recorded or not readable; absent from an older server. */
  doneWhenVersion?: GoalsVersion | null;
}

/** What a coordinator or the console reads of one programme (`GET /api/programmes/:slug/goals`, D-8126): the pin with its
 *  modifications and stored definition of done, and the programme's items still waiting on the operator, each by `id`, `kind`,
 *  `title` and `neededBy` only. Never an item's `why`, `how`, `answer` or `note`, nor a secret's slot or state. */
export interface GoalsRead {
  goals: GoalsView;
  openItems: { id: number; kind: ItemKind; title: string; neededBy: NeededBy }[];
  /** D-8126: the programme's last 20 big calls, newest first, however long ago and whether or not seen. */
  bigCalls: CallView[];
}

export interface WaitingView {
  items: ItemView[];
  cleared: ItemView[];
  goals: GoalsView[];
  /** D-8126: the big calls the operator has yet to see (newest first), and those that left the group inside the
   *  Recently cleared window. OPTIONAL on the wire: an older server omits both. ADDITIVE. */
  calls?: CallView[];
  callsCleared?: CallView[];
  /** Overlord W1, answer marks B: the asks the operator has, each with its two marks. `asks` are the live ones, whose boxes sit
   *  on their child's question row; `asksCleared` the rest, rows of Recently cleared. OPTIONAL and ADDITIVE: absent means this
   *  server cannot mark an ask (an older one, or its read of the asks failed), so the console draws no ask box. */
  asks?: AskMarkRow[];
  asksCleared?: AskMarkRow[];
  /** Approvals PR 3 (§3.3.2): the parked permission prompts, oldest first, each "with your coordinator", which the operator
   *  may rule. OPTIONAL and ADDITIVE: absent means an older server, or a read that failed (never an empty list then). */
  approvals?: ParkedApprovalView[];
}

const NEEDED_BY_RANK: Readonly<Record<NeededBy, number>> = { blocking: 0, soon: 1, later: 2 };
const STATE_RANK: Readonly<Record<ItemState, number>> = {
  open: 0, checking: 1, done: 2, withdrawn: 3, dismissed: 4,
};

/** Blocking first, then soon, then later; within each, `open` before `checking`, then the oldest
 *  `raisedAt` first (the id breaks a tie so the order is total). A copy: the input is not touched. */
export function orderItems(items: readonly ItemView[]): ItemView[] {
  return [...items].sort((a, b) =>
    NEEDED_BY_RANK[a.neededBy] - NEEDED_BY_RANK[b.neededBy]
    || STATE_RANK[a.state] - STATE_RANK[b.state]
    || a.raisedAt - b.raisedAt
    || a.id - b.id);
}

/** What waits on the operator: `open` items only. A `checking` item is the coordinator's (spec §2). */
export function waitingCount(items: readonly ItemView[]): number {
  return items.filter((i) => i.state === 'open').length;
}

/** What a programme with no open item is waiting on. */
export type WaitsOn = 'work' | 'review' | 'merge-queue' | 'next-wave' | 'ended';
const WAITS_ON_MAP: Record<WaitsOn, true> = {
  work: true, review: true, 'merge-queue': true, 'next-wave': true, ended: true,
};
export const WAITS_ON_KINDS = Object.keys(WAITS_ON_MAP) as readonly WaitsOn[];

/**
 * Priority: any active work run -> `work`; any work run awaiting review or any active review run ->
 * `review`; any `merging` run -> `merge-queue`; any `planned` run -> `next-wave`; any other run that is
 * still open (a `closing` run, a run of kind `unknown`, a review run awaiting its own review) -> `work`;
 * else `ended`. `ended` means exactly what the store's `programmeHasOpenRun` means: no run outside
 * `TERMINAL_RUN_STATES`, so the panel never says "the programme has no open run" while a dismiss is
 * refused `programme-live` (review 1323 R1).
 */
export function programmeWaitsOn(runs: readonly { state: RunState; kind: RunKind }[]): WaitsOn {
  const active = (r: { state: RunState }) => (ACTIVE_RUN_STATES as readonly RunState[]).includes(r.state);
  if (runs.some((r) => r.kind === 'work' && active(r))) return 'work';
  if (runs.some((r) => (r.kind === 'work' && r.state === 'awaiting-review')
    || (r.kind === 'review' && active(r)))) return 'review';
  if (runs.some((r) => r.state === 'merging')) return 'merge-queue';
  if (runs.some((r) => r.state === 'planned')) return 'next-wave';
  if (runs.some((r) => !(TERMINAL_RUN_STATES as readonly RunState[]).includes(r.state))) return 'work';
  return 'ended';
}

export const WAITS_ON_WORDS: Record<WaitsOn, string> = {
  work: 'work in progress',
  review: 'a review',
  'merge-queue': 'the merge queue',
  'next-wave': 'the next wave to start',
  ended: 'nothing: the programme has no open run',
};

const SLOT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A secret slot's name, safe to build a path from. */
export function isSlotSlug(s: string): boolean {
  return typeof s === 'string' && SLOT_SLUG_RE.test(s);
}

// ── secrets pasted into the console (plan PL6, spec §5) ────────────────────────────────────────────────────────────

/** The directory under `~/.ccrc` that holds the operator-secret slots (`server/src/coord/ledgersSecrets.ts`); the account deny
 *  rules name the same directory (`ACCOUNT_SECRET_PATHS`, `shared/api.ts`), and `account-deny.test.ts` holds the two equal. */
export const OPERATOR_SECRETS_DIR = 'operator-secrets';
/** The egress masker's lane prefix of an operator-secret slot (`operator-secret:<programme>:<slot>`). The slot store names
 *  its lanes with it, and the masker's roster prune (`SecretMasker.retain`) never deletes a lane that carries it: those lanes
 *  are this server's own, not the roster's (review 1389 F1). */
export const OPERATOR_SECRET_LANE_PREFIX = 'operator-secret:';
/** Whether a masker lane is an operator-secret slot's: the one predicate the masker's prune, its roster filter and its re-key
 *  guard read, and the re-key's composer (`withOperatorSecretRows`) filters a box's answer with. */
export function isOperatorSecretLane(laneId: string): boolean {
  return typeof laneId === 'string' && laneId.startsWith(OPERATOR_SECRET_LANE_PREFIX);
}

/** The longest secret the console takes, in characters and in UTF-8 bytes alike (the masker's longest run is 8192 bytes,
 *  so a value inside this bound is never too long for it). */
export const SECRET_VALUE_MAX = 8192;
/** The shortest value whose tail can be shown, in UTF-8 BYTES after any trailing `=`, counted as the egress masker counts a
 *  secret: its floor, `RUN_MIN_BYTES` (`server/src/accounts/shapes.ts`), which `ledgers-secrets.test.ts` holds equal to this
 *  (review 1389 A1). Below it no character of the value leaves the server: the masker cannot catch such a value in outgoing
 *  text, and four characters are a large share of so short a value. At the floor or above, the tail is shown only when the
 *  masker answers that it will catch the value (`masked`, review 1391 F2): a value it cannot catch shows none either. */
export const SECRET_TAIL_MIN = 20;
/** How many characters the tail shows. */
export const SECRET_TAIL_CHARS = 4;

/** Why the egress masker does not know a saved secret (Review Focus 2: never a silent skip). `too-short`: under the
 *  masker's 20-byte floor (after any trailing `=`); `too-long`: past its 8192-byte run; `not-one-run`: the masker took it,
 *  but its search of outgoing text can never produce it as one candidate (it holds a space, `:`, `=`, `,` or another
 *  delimiter the search splits on, or begins with one), so it would not be caught (review 1391 F2); `unregistered`: the
 *  masker could not take it (no box token yet, or coord.db stayed busy). */
export type SecretUnmasked = 'too-short' | 'too-long' | 'not-one-run' | 'unregistered';
const SECRET_UNMASKED_MAP: Record<SecretUnmasked, true> = { 'too-short': true, 'too-long': true, 'not-one-run': true, unregistered: true };
export const SECRET_UNMASKED_WHYS = Object.keys(SECRET_UNMASKED_MAP) as readonly SecretUnmasked[];
export function isSecretUnmasked(v: unknown): v is SecretUnmasked {
  return typeof v === 'string' && (SECRET_UNMASKED_WHYS as readonly string[]).includes(v);
}

/** Whether a pasted value is one the console takes: 1 to `SECRET_VALUE_MAX` characters and UTF-8 bytes. */
export function isSecretValue(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= SECRET_VALUE_MAX && utf8Bytes(v) <= SECRET_VALUE_MAX;
}

/** Whether a value is ONE line in every reading: no carriage return, line feed, vertical tab, form feed, next line (U+0085),
 *  line separator (U+2028) or paragraph separator (U+2029) in it (the operator's ruling on programme item 8, "one line is
 *  enough", and its ruling on review 1416 A-R5: one line means one line however a reader breaks lines). The secret's route
 *  refuses any other with its own word before anything is written, and the panel keeps its single-line field. */
export function isOneLine(v: string): boolean {
  return !/[\r\n\v\f\u0085\u2028\u2029]/.test(v);
}

/** The last `SECRET_TAIL_CHARS` characters (code points, so a surrogate pair is never split) of a value of at least
 *  `SECRET_TAIL_MIN` bytes, its trailing `=` set aside as the masker sets it aside; `''` for a shorter one, whose tail is
 *  never shown. */
export function secretTailOf(value: string): string {
  // A loop, not `/=+$/`: that pattern backtracks quadratically over a long run of `=` (CodeQL js/polynomial-redos).
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x3d) end--;
  if (utf8Bytes(value.slice(0, end)) < SECRET_TAIL_MIN) return '';
  return Array.from(value).slice(-SECRET_TAIL_CHARS).join('');
}

/** THE ANSWER A SECRET ITEM'S TICK CARRIES to the coordinator (spec §5: set, the time and the last four, never the value):
 *  `set <ISO time> ending <tail>`, or `set <ISO time>` when no tail is shown. */
export function secretAnswer(s: { setAt: number; tail: string }): string {
  const at = new Date(s.setAt).toISOString();
  return s.tail === '' ? `set ${at}` : `set ${at} ending ${s.tail}`;
}

/** What `PUT /api/items/:id/secret` answers on success: the slot's state and the ticked item, never the value. */
export interface SecretSaveAnswer {
  readonly ok: true;
  readonly secret: { readonly setAt: number; readonly tail: string; readonly masked: boolean; readonly why?: SecretUnmasked };
  readonly item: ItemView;
}

/**
 * ONE STORED SLOT as the programme's stored-secrets read answers it (`GET /api/programmes/:slug/secrets`, the operator's ruling
 * on programme item 9): its name, when it was saved, and the item that asked for it. NEVER any part of the value: no tail, no
 * length, no digest. `setAt` is `null` when the slot's record could not be read (the value file is there, its metadata is
 * not); `item` is `null` when the record names no item (a slot saved before the record carried one) or that item is gone.
 */
export interface StoredSecret {
  readonly slot: string;
  readonly setAt: number | null;
  readonly item: { readonly id: number; readonly title: string } | null;
}
/** What the stored-secrets read answers: the programme's slots, sorted by name. A store that could not be read is never
 *  this answer with no slots: it is the `secrets-unreadable` refusal. */
export interface StoredSecretsAnswer {
  readonly ok: true;
  readonly program: string;
  readonly slots: readonly StoredSecret[];
}
/** What the Remove door (`DELETE /api/programmes/:slug/secrets/:slot`) answers on success: the slot it removed, and nothing of
 *  its value. */
export interface SecretRemoveAnswer {
  readonly ok: true;
  readonly slot: string;
}

const SPEC_PREFIX = 'docs/superpowers/specs/';
/** A spec path the PWA may turn into a Docs link: under the specs directory, Markdown, no parent
 *  hop, no empty segment, not absolute, at most 200 characters. */
export function isSpecPath(p: string): boolean {
  return typeof p === 'string'
    && p.length <= 200
    && p.startsWith(SPEC_PREFIX)
    && p.endsWith('.md')
    && !p.includes('..')
    && !p.includes('//');
}

/** The definition of done's bounds (D-8126). */
export const DONE_WHEN_MAX_ITEMS = 12;
export const DONE_WHEN_ITEM_MAX = 2000;

/** A programme's definition of done: 1 to 12 strings, each trimmed to 1 to 2,000 characters.
 *  Anything else is refused with a detail naming both limits. */
export function doneWhenOf(raw: unknown): { ok: true; doneWhen: string[] } | { ok: false; detail: string } {
  const detail = `doneWhen must be an array of 1 to ${DONE_WHEN_MAX_ITEMS} strings, each 1 to ${DONE_WHEN_ITEM_MAX} characters`;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DONE_WHEN_MAX_ITEMS) return { ok: false, detail };
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') return { ok: false, detail };
    const t = v.trim();
    if (t.length < 1 || t.length > DONE_WHEN_ITEM_MAX) return { ok: false, detail };
    out.push(t);
  }
  return { ok: true, doneWhen: out };
}

/** "Recently cleared" keeps the last 48 hours (D-8194; was seven days, spec D13): the server's list and the console's trail both
 *  read this one window, so neither shows what the other has dropped. */
export const CLEARED_WINDOW_MS = 48 * 3600 * 1000;

/** The hold rule (A21, D-8194), once: when the operator was first shown an item. Its `heldUntil`, or its `raisedAt` when it
 *  was never held; null when its coordinator settled it inside the hold (closed before `heldUntil`), so it was never shown.
 *  `ledgersStore.ts#operatorWasShown(row, now)` is `shownAt !== null && shownAt <= now`, and the portfolio's operator wait
 *  starts here (Overlord W1, portfolio: moved from `ledgersStore.ts`). */
export function operatorShownAt(row: { raisedAt: number; heldUntil: number | null; closedAt: number | null }): number | null {
  if (row.heldUntil === null) return row.raisedAt;
  return row.closedAt !== null && row.closedAt < row.heldUntil ? null : row.heldUntil;
}
/** How long a tick's mail may stay not acknowledged before the item says "ticked; coordinator not responding" (plan PL4). A
 *  label only: no push and no stall arm hang off it (spec §3.3, D19). */
export const TICK_UNANSWERED_MS = 30 * 60 * 1000;
export const SOON_LABEL_MAX = 40;
export const ITEM_TITLE_MAX = 140;
export const ITEM_TEXT_MAX = 2000;
export const ITEM_STEPS_MAX = 12;
export const ITEM_OPTIONS_MAX = 6;
export const ANSWER_MAX = 2000;
/** The longest `recommendedWhy` a raise takes (plan PL9): a few plain sentences on why the recommended option beats each
 *  alternative, with what each alternative would cost or risk. */
export const RECOMMEND_WHY_MAX = 2000;

/** THE ONE READER of an item's recommendation (plan PL9): the option it names and why, or `null` when the item has none to
 *  show. `null` for a field a server from before PL9 omits (absence permits: the item draws as before), for a kind that is
 *  not `decide`, and for an index that names no listed option or reasons that are not text: the raise route refuses both,
 *  so either is a corrupt row, and the console then shows the options with no mark rather than a mark on the wrong one. */
export function recommendationOf(item: {
  readonly kind: ItemKind; readonly options: readonly string[] | null;
  readonly recommended?: number | null; readonly recommendedWhy?: string | null;
}): { readonly index: number; readonly why: string } | null {
  const { kind, options, recommended, recommendedWhy } = item;
  if (kind !== 'decide' || options === null) return null;
  if (typeof recommended !== 'number' || !Number.isInteger(recommended) || recommended < 0 || recommended >= options.length) return null;
  if (typeof recommendedWhy !== 'string' || recommendedWhy.trim() === '') return null;
  return { index: recommended, why: recommendedWhy };
}

/** The coordinator's presence as an item's label reads it. `unmeasured` says the server has no reading to give (no fleet
 *  frame or registry listing yet, an id the registry lists but the frame lacks, or the session's own presence is a doubt): it
 *  is never `dead`, so a doubt cannot label an item. */
export type CoordinatorPresence = 'alive' | 'dead' | 'absent' | 'unmeasured';
const COORDINATOR_PRESENCE_MAP: Record<CoordinatorPresence, true> = { alive: true, dead: true, absent: true, unmeasured: true };
export const COORDINATOR_PRESENCES = Object.keys(COORDINATOR_PRESENCE_MAP) as readonly CoordinatorPresence[];

/**
 * The coordinator's presence from what the server last measured: the fleet frame it broadcast and the ids of its last good
 * registry listing, read from the listing's raw `*.uuid` names (refused ids included). A `dead` row is `dead`; `alive` and
 * `asleep` (hibernated, woken by mail) are `alive`; a doubt, or a row from a server that predates `presence`, is `unmeasured`;
 * an id the frame lacks is `absent` only when the listing is known and does not hold it either, and `unmeasured` when the
 * listing holds it (a refused id, or a row the registry could not assemble, is in no fleet row; or a row the registry retired
 * after its second listing, which the FIRST listing still names for that one tick) or when no listing has landed yet.
 *
 * WHY THIS IS NOT `measureClaimant` (the one dead predicate, D-5290; "legitimately different", review 1335 F4): that function
 * is async, a fresh registry read and a tmux verdict, and an item's view must be built SYNCHRONOUSLY (`viewOfItem`: the
 * routes' call-order pin forbids an await between an item read and its write, and the frame builds the same view). Every arm
 * here agrees with that predicate's ladder (`readSession`, which the frame's `presence` is) except that a frame cannot see a
 * fresh tmux verdict; and the one arm the two would otherwise disagree on, an id the frame lacks, is closed above: the
 * listing's names hold a row the registry could not assemble as well as a refused one, where `measureClaimant` answers
 * `unmeasurable`.
 */
export function coordinatorPresenceIn(
  fleet: readonly { id: string; presence?: Presence }[] | null, registryIds: ReadonlySet<string> | null, id: string,
): CoordinatorPresence {
  if (fleet === null) return 'unmeasured';
  const row = fleet.find((s) => s.id === id);
  if (row === undefined) return registryIds === null || registryIds.has(id) ? 'unmeasured' : 'absent';
  switch (row.presence) {
    case 'dead': return 'dead';
    case 'alive': case 'asleep': return 'alive';
    default: return 'unmeasured';
  }
}

/** The newest tick mail's delivery state, or `none` when no tick mail was ever queued for the item. */
export type TickMailState = MailDeliveryState | 'none';

/** What `itemIsStale` is decided from, all of it measured by the caller: the item's state and tick time, the clock, the
 *  newest tick mail's delivery state (whoever it was addressed to), and the coordinator's presence. */
export interface StaleInputs {
  state: ItemState;
  tickedAt: number | null;
  now: number;
  mail: TickMailState;
  coordinator: CoordinatorPresence;
}

/** ItemView.stale (spec §3.3, plan PL4): a CHECKING item whose coordinator reads dead or absent, or whose newest tick mail is
 *  not acknowledged `TICK_UNANSWERED_MS` after the tick. Only `acked` counts as heard (review 1335 F2): a mail still `queued`,
 *  `rejected`, `unknown`, delivered but not acknowledged, or missing altogether (`none`) is not, whoever it went to, so a
 *  takeover that left the old coordinator's mail unread is labelled too. `unmeasured` is a doubt, not a finding, so it never
 *  labels. Every other state is never stale. */
export function itemIsStale(i: StaleInputs): boolean {
  if (i.state !== 'checking') return false;
  if (i.coordinator === 'dead' || i.coordinator === 'absent') return true;
  return i.mail !== 'acked' && i.tickedAt !== null && i.now - i.tickedAt >= TICK_UNANSWERED_MS;
}

/** Whether the newest earlier tick mail of an item holds the operator's next tick, decided here alone (review 1335 F2, review
 *  1336 F1; one decider, review 1338): a mail whose delivery is no longer outstanding never holds it, and an outstanding one
 *  holds it unless it was LEFT BEHIND: it went to a session that is no longer the programme's coordinator AND that session
 *  reads `dead` or `absent`. Its recipient is gone and no longer the coordinator, so the guard must not wait on it; nothing
 *  re-addresses the mail (it keeps its delivery to the literal session id, so a revived session can still be delivered it
 *  and ack it). A recipient that is still the coordinator, or that reads `alive` or `unmeasured`, keeps holding the tick: a
 *  live displaced coordinator must not get a second mail beside the new one. */
export function earlierTickBlocks(i: {
  state: MailDeliveryState; recipient: string; coordinator: string; recipientPresence: CoordinatorPresence;
}): boolean {
  if (!OUTSTANDING_DELIVERY_STATES.includes(i.state)) return false;
  return !(i.recipient !== i.coordinator && (i.recipientPresence === 'dead' || i.recipientPresence === 'absent'));
}

// ---- Document links (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D27 and D28) -------------------------------------
//
// ONE BOUNDARY, ASKED ON BOTH SIDES (review 1466 F5 and F6). The console's link splitter (`linkRuns`, `ledgerLinks.ts`) finds
// its candidates with `linkCandidates`, trims them with `trimLinkTail` and draws an `https` one as text when
// `linksDocumentOutside` says it links a document; the routes whose text the console draws through it (the raise route's every
// field, the return route's note) refuse what `outsideDocLink` finds, which reads every `http`/`https` address with the same
// trim and the same decider. So nothing the console draws as a document link outside the Docs reader gets past the server, and
// nothing the server lets through is drawn as one.

/** A link candidate's start: a word's start (the text's start or after white space), past any opening brackets or quotes, then
 *  an `https://` or `http://` address (any case), a single `/` or `docs/`; it runs to the next space, quote, backtick or angle
 *  bracket. A path inside another word, an address of any scheme included, is never a candidate (review 1466 F7). */
const LINK_CANDIDATE = /(^|\s)([([{"']*)((?:https?:\/\/|\/(?!\/)|docs\/)[^\s<>"'`]*)/gi;
/** An address anywhere in text, for the server's refusal: `http` or `https` (either case), to the next space, quote, backtick
 *  or angle bracket. Every address `LINK_CANDIDATE` finds starts where one of these does and runs as far. */
const ADDRESS_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** What may end a sentence after a link, and is not part of it. */
const LINK_TRAILING = '.,;:!?';
const LINK_CLOSER_OF: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

/** A candidate without what follows it in the sentence: trailing punctuation, and each closing bracket it never opened, from
 *  the end. One count of the brackets and one pass back, so a long run of closers costs its length (review 1466 F9). */
export function trimLinkTail(raw: string): string {
  const count: Record<string, number> = { '(': 0, '[': 0, '{': 0, ')': 0, ']': 0, '}': 0 };
  for (let i = 0; i < raw.length; i++) { const c = raw.charAt(i); if (c in count) count[c] = (count[c] ?? 0) + 1; }
  let end = raw.length;
  while (end > 0) {
    const last = raw.charAt(end - 1);
    if (LINK_TRAILING.includes(last)) { end--; continue; }
    const opener = LINK_CLOSER_OF[last];
    if (opener !== undefined && (count[opener] ?? 0) < (count[last] ?? 0)) { count[last] = (count[last] ?? 0) - 1; end--; continue; }
    break;
  }
  return raw.slice(0, end);
}

/** One link candidate of a text: where it starts and its text, trimmed (`trimLinkTail`). */
export interface LinkCandidate { readonly start: number; readonly text: string }

/** The link candidates of `text`, in order, trimmed; an empty one is dropped. The console decides which are links. */
export function linkCandidates(text: string): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  for (const m of text.matchAll(LINK_CANDIDATE)) {
    const candidate = trimLinkTail(m[3] ?? '');
    if (candidate !== '') out.push({ start: (m.index ?? 0) + (m[1] ?? '').length + (m[2] ?? '').length, text: candidate });
  }
  return out;
}

/** The sections a document server serves under `/docs/<project>/<section>/`: the Docs reader's four, and two more a document
 *  server outside the console lists. A path of that shape names a document, whatever the host. */
const DOC_SERVER_SECTION = new RegExp(`^/docs/[^/]+/(?:${[...DOC_SECTION_SLUGS, 'vision', 'promise'].join('|')})(?:/|$)`);

/** How many times `linksDocumentOutside` decodes one path segment before it stops trusting it. */
const DECODE_ROUNDS = 4;

/** One valid percent escape. A `%` not followed by two hex digits is a literal percent sign and is left alone. */
const PERCENT_ESCAPE = /%([0-9a-f]{2})/gi;

/** One round of a lenient decode: each valid `%XX` becomes its byte, read as one character, and a stray `%` stays. The words
 *  the decider looks for are ASCII, which every server decodes alike, so a byte of a longer UTF-8 character never forms one. */
function decodeEscapes(seg: string): string {
  return seg.replace(PERCENT_ESCAPE, (_escape, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** A path's segments with empty segments and `.` dropped and `..` popped, as a server that merges slashes resolves them. */
function normalisedSegments(segs: readonly string[]): string[] {
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out;
}

/** Whether one reading of a path (its segments, from the root) names an artifact page or a document. */
function segmentsNameADocument(segs: readonly string[]): boolean {
  if (segs.includes('artifact') || segs.some((seg, i) => seg === 'public' && segs[i + 1] === 'artifacts')) return true;
  const path = `/${segs.join('/')}`;
  if (Object.values(DOC_SECTIONS).some((dir) => path.includes(`/${dir}/`) || path.endsWith(`/${dir}`))) return true;
  return DOC_SERVER_SECTION.test(path);
}

/** Whether `address` links a document other than through the console's Docs reader: an artifact page (a path segment
 *  `artifact`, or the artifact host's `public/artifacts`), a repository document on any host (a path through one of the Docs
 *  reader's section directories, as a code host's file or directory view has), or a document server's page
 *  (`/docs/<project>/<section>/…`). The path is read as a server reads it: each segment decoded leniently until it is stable
 *  (each valid `%XX`, a stray `%` left alone, so `%61rtifact`, `%2561rtifact`, `%73pecs`, `superpowers%2Fspecs` and `%5C` are
 *  what they spell and `100%25` is a literal percent sign), split on `/` and `\`, and folded to lower case; a segment still
 *  changing after `DECODE_ROUNDS` counts as one (reviews 1466 F6 and 1481 F1, F3). The segments are judged as written and again
 *  with empty segments and `.` dropped and `..` popped, and either reading naming one is enough (review 1481 F2). An address
 *  that is none of these, an outside service's own page (a sign-in or settings page, a run's artifacts on a code host), is an
 *  ordinary link. */
export function linksDocumentOutside(address: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(address).pathname;
  } catch {
    return false;
  }
  const segs: string[] = [];
  for (const raw of pathname.replace(/^\//, '').split('/')) {
    // Decoded until it is stable (a double-encoded `%2561rtifact` too, at most `DECODE_ROUNDS` times; one still changing
    // after that counts as outside), then split on `/` and `\`, which some servers read as one.
    let seg = raw;
    for (let round = 0; ; round++) {
      const next = decodeEscapes(seg);
      if (next === seg) break;
      if (round === DECODE_ROUNDS) return true;
      seg = next;
    }
    segs.push(...seg.toLowerCase().split(/[\\/]/));
  }
  return segmentsNameADocument(segs) || segmentsNameADocument(normalisedSegments(segs));
}

/** The first address in `texts` that links a document outside the console (`linksDocumentOutside`, trimmed as the console
 *  trims, `trimLinkTail`), or null. The raise route asks it of every field the operator reads (title, why, steps, options, the
 *  recommendation, the soon label), and the return route of its note, and each refuses `outside-doc-link`: a link to a
 *  document is its repository path, which the console opens in the Docs reader. */
export function outsideDocLink(texts: readonly string[]): string | null {
  for (const text of texts) {
    for (const m of text.matchAll(ADDRESS_IN_TEXT)) {
      const address = trimLinkTail(m[0]);
      if (linksDocumentOutside(address)) return address;
    }
  }
  return null;
}

/** The detail the operator's act writes on the run it abandons (D-8076, D-8077): the item's id follows. An end request's act says
 *  a session asked; a refused-close item's act says ccrc held the close, and no session asked for anything. The run's own
 *  transition leaves both to the act, which closes its item itself. */
export const ABANDON_REQUESTED_PREFIX = 'abandon:requested:';
export const ABANDON_REFUSED_PREFIX = 'abandon:refused:';

/** D-8558: the longest reason the operator gives when closing a refused run (`close-run`): a few words, one line. */
export const CLOSE_REASON_MAX = 120;

/** THE ONE WRITER of a refused-close act's detail: the prefix, the item, and the operator's reason after one space. */
export const refusedCloseDetail = (itemId: number, reason: string | null): string =>
  `${ABANDON_REFUSED_PREFIX}${itemId}${reason === null ? '' : ` ${reason}`}`;

/** THE ONE READER of that reason: the text after the item's id, or null for a detail with none (an older act, another close). */
export function refusedCloseReason(detail: string | null | undefined): string | null {
  if (typeof detail !== 'string' || !detail.startsWith(ABANDON_REFUSED_PREFIX)) return null;
  const at = detail.indexOf(' ', ABANDON_REFUSED_PREFIX.length);
  if (at < 0) return null;
  const reason = detail.slice(at + 1).trim();
  return reason === '' ? null : reason;
}

/** What the operator's `act` on a refused-close item may carry (D-8558): the reason, and the programme's end when the item
 *  offers `end-programme`. An absent body is the act as it always was. */
export interface ItemActBody { reason?: string; programme?: PlanEndOutcome }

/** THE ONE READER of `act`'s body (D-8558), pure: `reason` is one line of 1 to `CLOSE_REASON_MAX` characters and rides only a
 *  refused-close item; `programme` (`done` or `abandoned`) rides only an item that offers `end-programme`, and `abandoned` takes
 *  a reason, as a plan's close does. Any other field, or a body that is not an object, is refused. */
export function parseItemActBody(raw: unknown, action: ItemAction | null):
  { ok: true; reason: string | null; programme: PlanEndOutcome | null } | { ok: false; detail: string } {
  if (raw === undefined || raw === null) return { ok: true, reason: null, programme: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'the body is an object' };
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== 'reason' && k !== 'programme');
  if (extra.length > 0) return { ok: false, detail: `the body takes reason and programme only, not ${extra.join(', ')}` };
  const refused = action !== null && action.verb === 'close-refused' ? action : null;
  let reason: string | null = null;
  if (o['reason'] !== undefined) {
    if (refused === null) return { ok: false, detail: 'only a refused close takes a reason' };
    const r = o['reason'];
    if (typeof r !== 'string' || !isOneLine(r) || r.trim() === '' || [...r.trim()].length > CLOSE_REASON_MAX) {
      return { ok: false, detail: `the reason is one line of 1 to ${CLOSE_REASON_MAX} characters` };
    }
    reason = r.trim();
  }
  let programme: PlanEndOutcome | null = null;
  if (o['programme'] !== undefined) {
    const p = o['programme'];
    if (typeof p !== 'string' || !(PLAN_END_OUTCOMES as readonly string[]).includes(p)) return { ok: false, detail: 'programme is done or abandoned' };
    if (refused === null || !refused.doors.includes('end-programme')) return { ok: false, detail: 'this item does not offer to end the programme' };
    if (p === 'abandoned' && reason === null) return { ok: false, detail: 'abandoning a programme needs a reason' };
    programme = p as PlanEndOutcome;
  }
  return { ok: true, reason, programme };
}
