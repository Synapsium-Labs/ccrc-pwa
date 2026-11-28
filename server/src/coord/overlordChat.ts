// The Overlord chat's thread and its earlier page, decided (Overlord W1, the chat, Task 1; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, questions 2, 3, 12 and 14). Ring L1, context C5: pure, no store,
// no `fs`, no clock, no fastify; it imports `shared/` only. The thread door (L4) reads the facts once each and hands them here.
//
// - `readinessAt`: the readiness word in force at a time, or `not-on-record` when no kept row was in force then (question 3).
// - `composeChat`: one ordered thread of the record's messages, the server's line under each message recorded while the word was
//   not `ready`, and a divider at each generation's start report. TOTAL, and an unreadable part is reported in its own field,
//   never folded into an empty one: no message page is never "no messages", no generation list is never "one generation", and
//   no readiness history is never `ready`.
// - `earlierPagePlan`: the history request for one page of an earlier generation, or why none can be made. The target is always
//   the generation row's OWN session (question 12), never the designated session, so a generation from before a rebind is read
//   in its own body's family.
import type { OperatorMessageRow, OverlordReplyRow } from '../../../shared/operatorMessages.js';
import type { ReadinessWord } from '../../../shared/overlord-readiness.js';
import type { OverlordHistoryRequest } from '../../../shared/overlordHistory.js';
import {
  CHAT_ENTRY_KINDS, CHAT_SERVER_LINE_MAP, CHAT_SERVER_LINE_UNMEASURED, NOT_ON_RECORD, chatTicksOf,
  type ChatEntry, type ChatThread, type GenerationKey, type ReplyResponse, type ServerLineWord,
} from '../../../shared/overlordChat.js';

/** One generation of the identity, as the chat reads it (text-free). */
export interface GenerationFact extends GenerationKey {
  /** The body that ran it (question 12). */
  readonly sessionId: string;
  /** The start's report time: the hook's clock (question 14). */
  readonly startReportedAt: number;
  readonly live: boolean;
  /** The start's conversation id (`continuity_starts.uuid`). */
  readonly conversation: string;
}
export interface ReadinessChange { readonly at: number; readonly word: ReadinessWord }

export interface ChatFacts {
  readonly designation: { readonly kind: 'designated'; readonly sessionId: string; readonly term: number } | { readonly kind: 'none' };
  readonly messages: { readonly kind: 'rows'; readonly rows: readonly OperatorMessageRow[]; readonly more: boolean } | { readonly kind: 'unmeasured'; readonly why: string };
  /** The replies below this page's reply cursor (PR B), read as the messages are. */
  readonly replies: { readonly kind: 'rows'; readonly rows: readonly OverlordReplyRow[]; readonly more: boolean } | { readonly kind: 'unmeasured'; readonly why: string };
  /** The response rows of those replies, by reply id (text-free), or why they could not be read. */
  readonly responses: { readonly kind: 'rows'; readonly byReply: ReadonlyMap<number, { readonly id: number; readonly handledAt: number | null }> }
    | { readonly kind: 'unmeasured'; readonly why: string };
  readonly generations: { readonly kind: 'rows'; readonly rows: readonly GenerationFact[] } | { readonly kind: 'unmeasured'; readonly why: string };
  readonly readiness: { readonly kind: 'rows'; readonly rows: readonly ReadinessChange[]; readonly oldest: number | null } | { readonly kind: 'unmeasured'; readonly why: string };
  /** Whether an earlier generation's first page can be read: Task 3's measured arm (question 2). */
  readonly pageable: boolean;
}

/** The word in force at `at`: the newest change at or before it (`changes` oldest first, as the readiness store reads them);
 *  `not-on-record` when `at` is before every kept row, or there is none. */
export function readinessAt(changes: readonly ReadinessChange[], at: number): ReadinessWord | typeof NOT_ON_RECORD {
  let word: ReadinessWord | typeof NOT_ON_RECORD = NOT_ON_RECORD;
  for (const c of changes) {
    if (c.at > at) break;
    word = c.word;
  }
  return word;
}

/** The server's line under one message, or null for none (`ready`). */
function serverLineOf(word: ServerLineWord): string | null {
  return word === NOT_ON_RECORD ? CHAT_SERVER_LINE_UNMEASURED : CHAT_SERVER_LINE_MAP[word];
}

const NONE_THREAD: ChatThread = {
  v: 1, designation: 'none', sessionId: null, term: null, entries: [],
  messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 0 } },
  readiness: { kind: 'read', value: { oldest: null } }, replies: { kind: 'read', value: { more: false } }, older: null,
};

/** One page of both lists, cut at one time floor (PR B, the coordinator's ruling on paging: the replies page with the messages, by
 *  time). Each list is the newest rows below its cursor; when a list says `more`, the rows older than its own oldest are not on
 *  this page, so the floor is the LATER of the two lists' oldest times among the lists that say `more`, and every row of either
 *  list below it is left for the next page. The next cursor of a list is its oldest row KEPT (or one past its newest row read,
 *  when the floor kept none of it, so the next page reads them again), or `end` when nothing older of it exists. The list that set
 *  the floor keeps at least its oldest row, so every older page moves on. Either list unreadable: no older page is offered (slug
 *  `chat-older-needs-both-lists`), because the floor cannot be placed. Pure, total. */
export function chatPageCut<M extends { readonly id: number; readonly at: number }, R extends { readonly id: number; readonly at: number }>(
  messages: { readonly rows: readonly M[]; readonly more: boolean } | null, replies: { readonly rows: readonly R[]; readonly more: boolean } | null,
): { readonly messages: readonly M[]; readonly replies: readonly R[]; readonly messagesMore: boolean; readonly repliesMore: boolean;
     readonly older: { readonly before: number | 'end'; readonly replyBefore: number | 'end' } | null; readonly floor: number | null } {
  const ms = messages === null ? [] : [...messages.rows].sort((a, b) => a.id - b.id);
  const rs = replies === null ? [] : [...replies.rows].sort((a, b) => a.id - b.id);
  const lows: number[] = [];
  if (messages !== null && messages.more && ms.length > 0) lows.push(ms[0]!.at);
  if (replies !== null && replies.more && rs.length > 0) lows.push(rs[0]!.at);
  const floor = lows.length === 0 ? null : Math.max(...lows);
  const keptM = floor === null ? ms : ms.filter((m) => m.at >= floor);
  const keptR = floor === null ? rs : rs.filter((r) => r.at >= floor);
  const messagesMore = messages !== null && (messages.more || keptM.length < ms.length);
  const repliesMore = replies !== null && (replies.more || keptR.length < rs.length);
  const next = <T extends { readonly id: number }>(more: boolean, kept: readonly T[], read: readonly T[]): number | 'end' =>
    (!more ? 'end' : kept.length > 0 ? kept[0]!.id : read[read.length - 1]!.id + 1);
  const older = messages === null || replies === null || (!messagesMore && !repliesMore)
    ? null : { before: next(messagesMore, keptM, ms), replyBefore: next(repliesMore, keptR, rs) };
  return { messages: keptM, replies: keptR, messagesMore, repliesMore, older, floor };
}

/** One ordered thread (oldest first): each message with its ticks, its server line right after it when its word was not
 *  `ready`, each recorded reply with its response row (PR B; after a message at the same millisecond), and a divider at each
 *  generation's `startReportedAt`, a divider first on a tie (question 14). The page is cut by `chatPageCut`. A divider is drawn
 *  only where the page reaches: when an older page exists, a divider older than the page's oldest row would sit over nothing, so it
 *  waits for the page that reaches it (the coordinator's ruling); on the oldest page every divider is drawn. The console keys
 *  dividers by `(term, n)`, so a page that repeats one draws it once. No designation is a measured absence: no entries. */
export function composeChat(f: ChatFacts): ChatThread {
  if (f.designation.kind === 'none') return NONE_THREAD;
  type Timed = { readonly at: number; readonly order: 0 | 1 | 2; readonly seq: number; readonly entries: readonly ChatEntry[] };
  const timed: Timed[] = [];
  let seq = 0;
  const cut = chatPageCut(f.messages.kind === 'rows' ? f.messages : null, f.replies.kind === 'rows' ? f.replies : null);
  const oldestShown = Math.min(cut.messages[0]?.at ?? Infinity, cut.replies[0]?.at ?? Infinity);
  const dividerFloor = cut.older === null || oldestShown === Infinity ? -Infinity : oldestShown;
  if (f.generations.kind === 'rows') {
    const gens = [...f.generations.rows].sort((a, b) => a.term - b.term || a.n - b.n);
    gens.forEach((g, i) => {
      const prev = i === 0 ? null : gens[i - 1]!;
      if (g.startReportedAt < dividerFloor) return;
      timed.push({
        at: g.startReportedAt, order: 0, seq: seq++,
        entries: [{
          kind: 'divider', gen: { term: g.term, n: g.n }, at: g.startReportedAt, current: g.live,
          newTerm: prev !== null && prev.term !== g.term, earlier: f.pageable && !g.live ? 'readable' : 'not-pageable',
        }],
      });
    });
  }
  for (const row of cut.messages) {
    const word: ServerLineWord = f.readiness.kind === 'rows' ? readinessAt(f.readiness.rows, row.at) : NOT_ON_RECORD;
    const line = serverLineOf(word);
    const entries: ChatEntry[] = [{ kind: 'message', row, ticks: chatTicksOf(row) }];
    if (line !== null) entries.push({ kind: 'server-line', messageId: row.id, text: line, word });
    timed.push({ at: row.at, order: 1, seq: seq++, entries });
  }
  for (const row of cut.replies) {
    const r = f.responses.kind === 'rows' ? f.responses.byReply.get(row.id) : undefined;
    const response: ReplyResponse = f.responses.kind === 'unmeasured' ? { kind: 'unmeasured' }
      : r === undefined ? { kind: 'no-row' } : { kind: 'row', id: r.id, handledAt: r.handledAt };
    timed.push({ at: row.at, order: 2, seq: seq++, entries: [{ kind: 'reply', row, response }] });
  }
  timed.sort((a, b) => a.at - b.at || a.order - b.order || a.seq - b.seq);
  return {
    v: 1, designation: 'designated', sessionId: f.designation.sessionId, term: f.designation.term,
    entries: timed.flatMap((t) => t.entries),
    messages: f.messages.kind === 'rows' ? { kind: 'read', value: { more: cut.messagesMore } } : { kind: 'unmeasured', why: f.messages.why },
    generations: f.generations.kind === 'rows' ? { kind: 'read', value: { count: f.generations.rows.length } } : { kind: 'unmeasured', why: f.generations.why },
    readiness: f.readiness.kind === 'rows' ? { kind: 'read', value: { oldest: f.readiness.oldest } } : { kind: 'unmeasured', why: f.readiness.why },
    replies: f.replies.kind === 'rows' ? { kind: 'read', value: { more: cut.repliesMore } } : { kind: 'unmeasured', why: f.replies.why },
    older: cut.older,
  };
}

/** How many entries back an older page of an earlier generation reaches (question 2). */
export const EARLIER_PAGE_BEFORE = 40;

/** Why no request can be made for a page. */
const EARLIER_PAGE_REFUSAL_MAP = {
  'no-generation': 'no generation row names it',
  current: 'the live generation streams from its transcript',
  'not-pageable': "the history store's verbs cannot page it",
} as const;
export type EarlierPageRefusal = keyof typeof EARLIER_PAGE_REFUSAL_MAP;
/** The chat's own words, for the coordination kebab census: an earlier page's refusal reasons (which the earlier door answers as
 *  `bad-request`'s detail or a thread's `earlier` mark, never a mail or run code) and a thread entry's kinds. */
export const isChatKebab = (word: string): boolean =>
  Object.hasOwn(EARLIER_PAGE_REFUSAL_MAP, word) || (CHAT_ENTRY_KINDS as readonly string[]).includes(word);

/** The history request for one page of `gen`, or why none can be made. The live generation streams from its transcript
 *  (`current`); no row is `no-generation`; a store whose verbs cannot name a conversation's newest entries is `not-pageable`
 *  (Task 3's measured arm). The first page expands the start's conversation id; an older page is `expand --around <the oldest
 *  entry shown> --before 40 --after 0`. The target is the row's own session, always. */
export function earlierPagePlan(gen: GenerationFact | null, around: string | null, pageable: boolean):
  { readonly kind: 'request'; readonly request: OverlordHistoryRequest } | { readonly kind: 'refuse'; readonly why: EarlierPageRefusal } {
  if (gen === null) return { kind: 'refuse', why: 'no-generation' };
  if (gen.live) return { kind: 'refuse', why: 'current' };
  if (!pageable) return { kind: 'refuse', why: 'not-pageable' };
  const target = { kind: 'session' as const, session: gen.sessionId };
  const args = around === null ? [gen.conversation] : ['--around', around, '--before', String(EARLIER_PAGE_BEFORE), '--after', '0'];
  return { kind: 'request', request: { verb: 'expand', target, agents: false, args } };
}
