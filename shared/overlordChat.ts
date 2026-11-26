// The Overlord chat's vocabulary and wire (Overlord W1, the chat, Task 1; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`; spec §4 Table 4a row 7, §3.8 H7, §9.4 rule 9). Ring L0, context
// C11 (the Operator Model): it imports only its `./` siblings (the private store's message words, the readiness words and the
// history answer's one reader), because the PWA bundles every `shared/*.ts` file.
//
// What it holds: the four ticks of H7 and the furthest tick each message state reaches (`MESSAGE_TICK_MAP`, keyed by the private
// store's own `MessageState`, so the message moves table stays the single source of the states); the server's line for each
// readiness word (`CHAT_SERVER_LINE_MAP`, total over `ReadinessWord`); the thread's wire and its one reader; the two doors' query
// readers; the earlier page's answer and its reader; and the prompt route's answer as the chat reads it. Every union is the key
// set of a const map with a runtime list beside it, so a new member is a compile error, never a silent wire change.
//
// THE RECORD IS THE ONLY SOURCE OF THE OPERATOR'S WORDS (H7). A `message` entry is a row of `operator_messages`; nothing in this
// file turns transcript text into one.
import type { MessageState, OperatorMessageRow, SettledBy } from './operatorMessages.js';
import { isMessageState, isSettledBy } from './operatorMessages.js';
import { isReadinessWord, type ReadinessWord } from './overlord-readiness.js';
import { readOverlordHistoryAnswer, type OverlordHistoryAnswer } from './overlordHistory.js';

// ── the ticks ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The four ticks of H7, in order. `delivery` reads "queued" or "delivered" by the row's stamps. */
const TICK_STAGE_MAP = {
  recorded: 'recorded', delivery: 'delivered or queued', 'picked-up': 'picked up', settled: 'settled',
} as const;
export type TickStage = keyof typeof TICK_STAGE_MAP;
export const TICK_STAGES = Object.keys(TICK_STAGE_MAP) as TickStage[];
/** The words a tick is drawn with. */
export const tickStageWords = (t: TickStage): string => TICK_STAGE_MAP[t];

/** The tick each message state reaches. Keyed by the private store's own type, so a new state is a compile error here until
 *  it is placed (the message moves table is the single source). `spent` reaches `settled`. */
export const MESSAGE_TICK_MAP: Readonly<Record<MessageState, TickStage>> = {
  recorded: 'recorded', queued: 'delivery', delivered: 'delivery', 'picked-up': 'picked-up', settled: 'settled', spent: 'settled',
};

export interface ChatTicks {
  /** Each tick lit by its own stamp, or by the row's state being that tick's. A gap is drawn as a gap: a message settled by
   *  the mark before any delivery lights `recorded` and `settled` only. */
  readonly lit: Readonly<Record<TickStage, boolean>>;
  readonly delivery: 'queued' | 'delivered' | null;
  readonly settledBy: OperatorMessageRow['settledBy'];
  /** A state word this build cannot read: `recorded` alone is lit. */
  readonly unknown: boolean;
}

/** The ticks of one row (total): `recorded` always; every other tick by its own stamp, or when the row's state is exactly
 *  that tick's (`MESSAGE_TICK_MAP`), never because a later tick is lit. An unknown state lights `recorded` alone. */
export function chatTicksOf(row: OperatorMessageRow): ChatTicks {
  if (row.state === 'unknown') {
    return { lit: { recorded: true, delivery: false, 'picked-up': false, settled: false }, delivery: null, settledBy: row.settledBy, unknown: true };
  }
  const at = MESSAGE_TICK_MAP[row.state];
  const delivered = row.deliveredAt !== null || row.state === 'delivered';
  const lit: Record<TickStage, boolean> = {
    recorded: true,
    delivery: delivered || at === 'delivery',
    'picked-up': row.pickedUpAt !== null || at === 'picked-up',
    settled: row.settledAt !== null || row.spentAt !== null || at === 'settled',
  };
  return { lit, delivery: delivered ? 'delivered' : lit.delivery ? 'queued' : null, settledBy: row.settledBy, unknown: false };
}

// ── the server's line ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The server's line under a message recorded while the word was not `ready` (Table 1). `ready` draws none. Total over the
 *  readiness words: a word the readiness piece adds is a compile error here until its line is written. */
export const CHAT_SERVER_LINE_MAP: Readonly<Record<ReadinessWord, string | null>> = {
  absent: 'Recorded. No Overlord is bound.',
  off: 'Recorded. The Overlord is off.',
  unmeasured: "Recorded. The Overlord's state could not be read.",
  dead: 'Recorded. The Overlord is down.',
  restarting: 'Recorded. The Overlord is restarting.',
  renewing: 'Recorded. The Overlord is renewing.',
  degraded: 'Recorded. The Overlord is degraded: chat only.',
  stranded: 'Recorded. No account can serve the Overlord now.',
  'dialog-open': "Recorded. A dialog is open in the Overlord's pane.",
  wedged: "Recorded. The Overlord's turn is stuck.",
  deaf: 'Recorded. The Overlord has not been picking up messages.',
  saturated: "Recorded. The Overlord's inbox is behind.",
  unproved: 'Recorded. The Overlord has not yet shown it is ready.',
  ready: null,
};
/** The line when the word in force at the message's time is not on record: the history is unreadable, or the message is older
 *  than every kept row. Never no line, which would read as `ready` (question 3). */
export const CHAT_SERVER_LINE_UNMEASURED = "Recorded. The Overlord's state at the time could not be read.";
/** A server line's word when no readiness row was in force at the message's time. Its own word, apart from the readiness word
 *  `unmeasured` (a stored row saying the state could not be read), because the two draw different lines (slug
 *  `readiness-at-names-not-on-record`). */
export const NOT_ON_RECORD = 'not-on-record';
export type ServerLineWord = ReadinessWord | typeof NOT_ON_RECORD;

// ── the thread ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A generation by its key (question 12): `n` restarts with each term, so `(term, n)` names one generation of the identity. */
export interface GenerationKey { readonly term: number; readonly n: number }

const ENTRY_KIND_MAP = { message: true, 'server-line': true, divider: true } as const;
export type ChatEntryKind = keyof typeof ENTRY_KIND_MAP;
export const CHAT_ENTRY_KINDS = Object.keys(ENTRY_KIND_MAP) as ChatEntryKind[];

const EARLIER_MAP = { readable: 'its earlier pages can be read', 'not-pageable': 'it is read in ccrc history only' } as const;
export type EarlierWord = keyof typeof EARLIER_MAP;
export const EARLIER_WORDS = Object.keys(EARLIER_MAP) as EarlierWord[];

export type ChatEntry =
  | { readonly kind: 'message'; readonly row: OperatorMessageRow; readonly ticks: ChatTicks }
  | { readonly kind: 'server-line'; readonly messageId: number; readonly text: string; readonly word: ServerLineWord }
  | { readonly kind: 'divider'; readonly gen: GenerationKey; readonly at: number; readonly current: boolean;
      readonly newTerm: boolean; readonly earlier: EarlierWord };

/** One part of the thread: read, or why it could not be. An unreadable part is never an empty one. */
export type ChatPart<T> = { readonly kind: 'read'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

export interface ChatThread {
  readonly v: 1;
  readonly designation: 'designated' | 'none';
  /** Null only with `designation: 'none'`. */
  readonly sessionId: string | null;
  /** The term a send from this thread carries (question 5); null only with `designation: 'none'`. */
  readonly term: number | null;
  /** Oldest first. */
  readonly entries: readonly ChatEntry[];
  readonly messages: ChatPart<{ readonly more: boolean }>;
  readonly generations: ChatPart<{ readonly count: number }>;
  readonly readiness: ChatPart<{ readonly oldest: number | null }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isPositive = (v: unknown): v is number => isCount(v) && v > 0;
const stampOrNull = (v: unknown): v is number | null => v === null || isCount(v);

/** One message row off the wire, or null. An unknown state or settlement word is revived as `unknown`, as the store revives
 *  it; `offRecord` absent (a server below the chat) reads false. */
function messageRowOf(v: unknown): OperatorMessageRow | null {
  if (!isObj(v)) return null;
  const { id, at, term, state, text, cut, sha256, queuedAt, deliveredAt, pickedUpAt, settledAt, settledBy, spentAt, offRecord } = v;
  if (!isPositive(id) || !isCount(at) || !isCount(term) || typeof state !== 'string' || typeof text !== 'string') return null;
  if (typeof cut !== 'boolean' || typeof sha256 !== 'string') return null;
  if (!stampOrNull(queuedAt) || !stampOrNull(deliveredAt) || !stampOrNull(pickedUpAt) || !stampOrNull(settledAt) || !stampOrNull(spentAt)) return null;
  if (settledBy !== null && typeof settledBy !== 'string') return null;
  if (offRecord !== undefined && typeof offRecord !== 'boolean') return null;
  return {
    id, at, term, state: isMessageState(state) ? state : 'unknown', text, cut, sha256, queuedAt, deliveredAt, pickedUpAt, settledAt,
    settledBy: settledBy === null ? null : isSettledBy(settledBy) ? (settledBy as SettledBy) : 'unknown', spentAt,
    offRecord: offRecord === true,
  };
}

function genKeyOf(v: unknown): GenerationKey | null {
  return isObj(v) && isPositive(v.term) && isPositive(v.n) ? { term: v.term, n: v.n } : null;
}

/** One entry: the entry, `skip` for a kind (or a readiness word) this build does not know, or a refusal detail. */
function entryOf(v: unknown): ChatEntry | 'skip' | string {
  if (!isObj(v) || typeof v.kind !== 'string') return 'an entry is not an object with a kind';
  if (!Object.prototype.hasOwnProperty.call(ENTRY_KIND_MAP, v.kind)) return 'skip';
  if (v.kind === 'message') {
    const row = messageRowOf(v.row);
    // The ticks are derived from the row here, never trusted off the wire: one derivation, `chatTicksOf`.
    return row === null ? 'a message entry carries no readable row' : { kind: 'message', row, ticks: chatTicksOf(row) };
  }
  if (v.kind === 'server-line') {
    if (!isPositive(v.messageId) || typeof v.text !== 'string' || typeof v.word !== 'string') return 'a server line is malformed';
    if (v.word !== NOT_ON_RECORD && !isReadinessWord(v.word)) return 'skip';
    return { kind: 'server-line', messageId: v.messageId, text: v.text, word: v.word as ServerLineWord };
  }
  const gen = genKeyOf(v.gen);
  if (gen === null || !isCount(v.at) || typeof v.current !== 'boolean' || typeof v.newTerm !== 'boolean') return 'a divider is malformed';
  if (typeof v.earlier !== 'string' || !Object.prototype.hasOwnProperty.call(EARLIER_MAP, v.earlier)) return 'a divider is malformed';
  return { kind: 'divider', gen, at: v.at, current: v.current, newTerm: v.newTerm, earlier: v.earlier as EarlierWord };
}

function partOf<T>(v: unknown, value: (x: Record<string, unknown>) => T | null): ChatPart<T> | null {
  if (!isObj(v)) return null;
  if (v.kind === 'unmeasured') return typeof v.why === 'string' ? { kind: 'unmeasured', why: v.why } : null;
  if (v.kind !== 'read' || !isObj(v.value)) return null;
  const x = value(v.value);
  return x === null ? null : { kind: 'read', value: x };
}

/** THE ONE READER of a thread (a wire boundary). An entry of a kind this build does not know is skipped and counted, never a
 *  refusal (additive); an unknown key is ignored. A missing `v`, a part whose kind is neither `read` nor `unmeasured`, or a
 *  known entry that is malformed refuses. */
export function readChatThread(raw: unknown): { ok: true; thread: ChatThread; skipped: number } | { ok: false; detail: string } {
  const no = (detail: string) => ({ ok: false as const, detail });
  if (!isObj(raw)) return no('not an object');
  if (raw.v !== 1) return no('v: not 1');
  const designation = raw.designation;
  if (designation !== 'designated' && designation !== 'none') return no('designation: not a word');
  const sessionId = raw.sessionId; const term = raw.term;
  if (designation === 'designated' && (typeof sessionId !== 'string' || sessionId === '' || !isCount(term))) return no('designated: no session or term');
  if (designation === 'none' && (sessionId !== null || term !== null)) return no('none: a session or term');
  const messages = partOf(raw.messages, (x) => (typeof x.more === 'boolean' ? { more: x.more } : null));
  const generations = partOf(raw.generations, (x) => (isCount(x.count) ? { count: x.count } : null));
  const readiness = partOf(raw.readiness, (x) => (x.oldest === null || isCount(x.oldest) ? { oldest: x.oldest as number | null } : null));
  if (messages === null) return no('messages: not a part');
  if (generations === null) return no('generations: not a part');
  if (readiness === null) return no('readiness: not a part');
  if (!Array.isArray(raw.entries)) return no('entries: not a list');
  const entries: ChatEntry[] = [];
  let skipped = 0;
  for (const e of raw.entries) {
    const r = entryOf(e);
    if (r === 'skip') { skipped += 1; continue; }
    if (typeof r === 'string') return no(r);
    entries.push(r);
  }
  return {
    ok: true, skipped,
    thread: { v: 1, designation, sessionId: designation === 'designated' ? (sessionId as string) : null, term: designation === 'designated' ? (term as number) : null, entries, messages, generations, readiness },
  };
}

// ── the two doors' queries ────────────────────────────────────────────────────────────────────────────────────────────

const DIGITS = /^[1-9][0-9]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A positive safe integer in plain digits, or null. */
const positiveOf = (v: unknown): number | null => {
  if (typeof v !== 'string' || !DIGITS.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};
const onlyKeys = (q: Record<string, unknown>, keys: readonly string[]): string | null =>
  Object.keys(q).find((k) => !keys.includes(k)) ?? null;

/** The thread door's query: `before`, a message id, or absent for the newest page. Any other key is refused. */
export function readChatThreadQuery(q: unknown): { ok: true; before: number | null } | { ok: false; detail: string } {
  if (q === undefined || q === null) return { ok: true, before: null };
  if (!isObj(q)) return { ok: false, detail: 'the query is not a set of fields' };
  const extra = onlyKeys(q, ['before']);
  if (extra !== null) return { ok: false, detail: 'the query names a field the door does not read' };
  if (q.before === undefined) return { ok: true, before: null };
  const before = positiveOf(q.before);
  return before === null ? { ok: false, detail: 'before: not a positive whole number in plain digits' } : { ok: true, before };
}

/** One page of an earlier generation: which generation, and the entry an older page is read around (null for the first). It has
 *  no target field: the server chooses the target from the generation row (question 12). */
export interface ChatEarlierRequest { readonly gen: GenerationKey; readonly around: string | null }

/** The earlier door's query: `term` and `n` positive safe integers, `around` absent or a lowercase uuid; any other key, a
 *  `target` above all, is refused. A refusal's detail never echoes the input. */
export function readChatEarlierQuery(q: unknown): { ok: true; req: ChatEarlierRequest } | { ok: false; detail: string } {
  if (!isObj(q)) return { ok: false, detail: 'the query is not a set of fields' };
  const extra = onlyKeys(q, ['term', 'n', 'around']);
  if (extra !== null) return { ok: false, detail: 'the query names a field the door does not read' };
  const term = positiveOf(q.term);
  const n = positiveOf(q.n);
  if (term === null || n === null) return { ok: false, detail: 'term and n: positive whole numbers in plain digits' };
  if (q.around !== undefined && (typeof q.around !== 'string' || !UUID.test(q.around))) return { ok: false, detail: 'around: not a uuid' };
  return { ok: true, req: { gen: { term, n }, around: (q.around as string | undefined) ?? null } };
}

/** The earlier door's answer: a page of the generation, or a refusal word with its cause (`history-unreachable`'s). */
export type ChatEarlierAnswer =
  | { readonly ok: true; readonly gen: GenerationKey; readonly page: OverlordHistoryAnswer }
  | { readonly ok: false; readonly error: string; readonly cause?: string; readonly detail?: string };

/** The earlier door's answer as the console reads it: the page through the history answer's one reader, or the refusal. A
 *  body in no shape it knows is `off-shape`. */
export function readChatEarlierAnswer(body: unknown): ChatEarlierAnswer | 'off-shape' {
  if (!isObj(body)) return 'off-shape';
  if (body.ok === true) {
    const gen = genKeyOf(body.gen);
    const page = readOverlordHistoryAnswer(body.page);
    return gen === null || page === 'off-shape' ? 'off-shape' : { ok: true, gen, page };
  }
  if (body.ok !== false || typeof body.error !== 'string') return 'off-shape';
  return {
    ok: false, error: body.error,
    ...(typeof body.cause === 'string' ? { cause: body.cause } : {}), ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
  };
}

// ── the prompt route's answer, as the chat reads it ───────────────────────────────────────────────────────────────────

/** The prompt route's answer as the chat reads it (private store B's additive shape). `no-answer` is a transport failure: the
 *  request may or may not have landed, so the draft and its send key are kept. */
export type ChatSendAnswer =
  | { readonly kind: 'recorded'; readonly messageId: number; readonly cut: boolean; readonly replay: boolean; readonly offRecord: boolean }
  | { readonly kind: 'refused'; readonly error: string; readonly retryAfterS?: number }
  | { readonly kind: 'off-shape' }
  | { readonly kind: 'no-answer' };

/** One answer of the prompt route, by its status and body. A 200 that names a `messageId` was recorded; a 200 that does not (an
 *  older server, or the route's typing path) is `off-shape`, so the draft is kept. A refusal status with an `error` word is
 *  `refused`, carrying `retryAfterS` when the body has one. Anything else is `off-shape`. */
export function readChatSendAnswer(status: number, body: unknown): ChatSendAnswer {
  if (!isObj(body)) return { kind: 'off-shape' };
  if (status === 200) {
    if (body.ok !== true || !isPositive(body.messageId)) return { kind: 'off-shape' };
    return { kind: 'recorded', messageId: body.messageId, cut: body.cut === true, replay: body.replay === true, offRecord: body.offRecord === true };
  }
  if (status >= 400 && status <= 599 && typeof body.error === 'string' && body.error !== '') {
    return { kind: 'refused', error: body.error, ...(isCount(body.retryAfterS) ? { retryAfterS: body.retryAfterS } : {}) };
  }
  return { kind: 'off-shape' };
}
