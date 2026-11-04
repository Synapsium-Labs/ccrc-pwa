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
import { ACTIVE_RUN_STATES, TERMINAL_RUN_STATES, type MailDeliveryState, type Presence, type RunKind, type RunState } from './api.js';

/** What the operator is asked to do. `decide` and `value` carry an answer; `do` carries none; a
 *  `secret`'s value goes to its slot, never through the answer (spec §5). */
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

/** UTF-8 bytes of a string, counted without an encoder (this file imports nothing). A lone surrogate counts 3, as an
 *  encoder writes U+FFFD for it. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
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
  if (utf8Bytes(value.replace(/=+$/, '')) < SECRET_TAIL_MIN) return '';
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

/** "Recently cleared" keeps seven days (spec D13). */
export const CLEARED_WINDOW_MS = 7 * 24 * 3600 * 1000;
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
 * listing holds it (a refused id, or a row the registry could not assemble, is in no fleet row) or when no listing has landed
 * yet.
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

/** Whether an outstanding tick mail has been left behind (review 1336 F1): it went to a session that is no longer the
 *  programme's coordinator AND that session reads `dead` or `absent`. Such a mail can never be acknowledged by its recipient
 *  (the ack route takes only the recipient's own), and nothing re-addresses a mail to a literal session id, so it must not
 *  hold the operator's next tick of a sent-back item. A recipient that is still the coordinator, or that reads `alive` or
 *  `unmeasured`, keeps blocking: a live displaced coordinator must not get a second mail beside the new one. */
export function tickMailLeftBehind(i: { recipient: string; coordinator: string; recipientPresence: CoordinatorPresence }): boolean {
  return i.recipient !== i.coordinator && (i.recipientPresence === 'dead' || i.recipientPresence === 'absent');
}
