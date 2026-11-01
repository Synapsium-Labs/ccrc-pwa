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
import { ACTIVE_RUN_STATES, type RunKind, type RunState } from './api.js';

/** What the operator is asked to do. `value` and `secret` take something back; `secret` never
 *  through the item's answer (spec §5). */
export type ItemKind = 'decide' | 'do' | 'value' | 'secret';
const ITEM_KIND_MAP: Record<ItemKind, true> = { decide: true, do: true, value: true, secret: true };
export const ITEM_KINDS = Object.keys(ITEM_KIND_MAP) as readonly ItemKind[];

/** `open` and `checking` are the live pair; the other three are closed. */
export type ItemState = 'open' | 'checking' | 'done' | 'withdrawn' | 'dismissed';
const ITEM_STATE_MAP: Record<ItemState, true> = {
  open: true, checking: true, done: true, withdrawn: true, dismissed: true,
};
export const ITEM_STATES = Object.keys(ITEM_STATE_MAP) as readonly ItemState[];
/** The states an item still waits in. Derived from nothing else: it is the pair the transition table
 *  leaves by `confirm`, `return`, `withdraw` and `dismiss`. */
export const OPEN_ITEM_STATES: readonly ItemState[] = ['open', 'checking'];

/** `blocking` = work has stopped on it; `soon` carries a short label; `later` is the rest. */
export type NeededBy = 'blocking' | 'soon' | 'later';
const NEEDED_BY_MAP: Record<NeededBy, true> = { blocking: true, soon: true, later: true };
export const NEEDED_BY_LEVELS = Object.keys(NEEDED_BY_MAP) as readonly NeededBy[];

export type ItemAct = 'tick' | 'confirm' | 'return' | 'withdraw' | 'dismiss';
export type ItemActor = 'operator' | 'coordinator';
const ITEM_ACT_MAP: Record<ItemAct, true> = {
  tick: true, confirm: true, return: true, withdraw: true, dismiss: true,
};
export const ITEM_ACTS = Object.keys(ITEM_ACT_MAP) as readonly ItemAct[];
const ITEM_ACTOR_MAP: Record<ItemActor, true> = { operator: true, coordinator: true };
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
};

export type ItemMove =
  | { ok: true; to: ItemState }
  | { ok: false; why: 'wrong-actor' | 'not-open' | 'programme-live' };

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

/** One item as the console shows it. `stale` is always `false` until the server computes it (PL4). */
export interface ItemView {
  id: number;
  program: string;
  runId: number | null;
  kind: ItemKind;
  title: string;
  why: string;
  how: string[];
  options: string[] | null;
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
  secretSet: { at: number; tail: string; masked: boolean } | null;
  history: { at: number; act: ItemAct | 'raise' | 'block' | 'unblock'; note: string | null }[];
}

/** A programme's pinned spec and what has changed since its approval. */
export interface GoalsView {
  program: string;
  specPath: string | null;
  inShort: string | null;
  inShortAt: number | null;
  modifications: {
    id: number; at: number; text: string; ruling: string | null;
    itemId: number | null; pr: number | null; merged: boolean;
  }[];
}

export interface WaitingView {
  items: ItemView[];
  cleared: ItemView[];
  goals: GoalsView[];
}

/** The live frame: additive on the fleet socket, no `FLEET_PROTO` bump. */
export type WaitingFrame = { type: 'waiting'; waiting: WaitingView };

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
 * `review`; any `merging` run -> `merge-queue`; any `planned` run -> `next-wave`; else `ended`.
 */
export function programmeWaitsOn(runs: readonly { state: RunState; kind: RunKind }[]): WaitsOn {
  const active = (r: { state: RunState }) => (ACTIVE_RUN_STATES as readonly RunState[]).includes(r.state);
  if (runs.some((r) => r.kind === 'work' && active(r))) return 'work';
  if (runs.some((r) => (r.kind === 'work' && r.state === 'awaiting-review')
    || (r.kind === 'review' && active(r)))) return 'review';
  if (runs.some((r) => r.state === 'merging')) return 'merge-queue';
  if (runs.some((r) => r.state === 'planned')) return 'next-wave';
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

/** "Recently cleared" keeps seven days (spec D13). */
export const CLEARED_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const SOON_LABEL_MAX = 40;
export const ITEM_TITLE_MAX = 140;
export const ITEM_TEXT_MAX = 2000;
export const ITEM_STEPS_MAX = 12;
export const ITEM_OPTIONS_MAX = 6;
export const ANSWER_MAX = 2000;
