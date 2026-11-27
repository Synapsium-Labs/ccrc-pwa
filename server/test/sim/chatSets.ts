// The Overlord chat's twelve deciders: their oracle cases and mutant sets (Overlord W1, the chat, Task 1 Step 5; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, Global Constraints, "Mutation floors"). Each decider's cases are
// written ONCE here, over a loaded module: `overlord-chat-vocab.test.ts` and `overlord-chat-compose.test.ts` run the shared and
// server ones against the real modules, and `mutation-floors.test.ts` runs every set against each named mutant. The PWA's four
// (`pwa/src/overlord/chatWords.ts`) are loaded by path at runtime, as `faceSets.ts` loads the face's, so no type edge reaches
// `pwa/`; `pwa/test/overlord-chat-words.test.ts` pins the same behaviour against the real module there.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { OperatorMessageRow, OverlordReplyRow } from '../../../shared/operatorMessages.js';
import type { ChatEntry, ChatSendAnswer } from '../../../shared/overlordChat.js';
import type { GenerationFact } from '../../src/coord/overlordChat.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VOCAB = path.join(ROOT, 'shared/overlordChat.ts');
const MESSAGES = path.join(ROOT, 'shared/operatorMessages.ts');
const L1 = path.join(ROOT, 'server/src/coord/overlordChat.ts');
const WORDS = path.join(ROOT, 'pwa/src/overlord/chatWords.ts');

export type ChatVocabModule = typeof import('../../../shared/overlordChat.js');
export type NudgeModule = typeof import('../../../shared/operatorMessages.js');
export type ChatL1Module = typeof import('../../src/coord/overlordChat.js');

/** The PWA module's shape, written here and only as far as the cases use it (a type edge into `pwa/` would pull pwa sources
 *  into the server's node16 resolution). A live item is `buildChatItems`' row, as far as the merge reads it. */
type LiveItem =
  | { kind: 'message'; key: string; event: { kind: 'user' | 'assistant'; uuid: string; ts: string; text: string }; streaming: boolean }
  | { kind: 'mail-prompt'; key: string; event: { kind: 'user'; uuid: string; ts: string; text: string } }
  | { kind: 'divider'; key: string; label: string };
type Row = { kind: string; key: string; entry?: ChatEntry; id?: number; name?: string; text?: string; item?: LiveItem };
type ReplyEntry = Extract<ChatEntry, { kind: 'reply' }>;
export interface ChatWordsModule {
  draftAfterSend(a: ChatSendAnswer): 'clear' | 'keep';
  turnOrigin(text: string): { kind: 'nudge'; id: number } | { kind: 'ccrc'; name: string } | { kind: 'pane' };
  mergeLive(thread: readonly ChatEntry[], live: readonly LiveItem[], drawnReplies?: ReadonlySet<number>): readonly Row[];
  historyItemsToChat(items: readonly Readonly<Record<string, unknown>>[], replies?: readonly ReplyEntry[]): readonly Row[];
  chatReadTrigger(msg: StreamFrame, was: 'idle' | 'busy' | null): boolean;
  nextReadAt(lastReadAt: number | null, now: number, notBefore: number, every?: number): number;
  pickUpReadEvery(thread: { readonly entries: readonly ChatEntry[] }, now: number): number | null;
  ceilingNotBefore(now: number, retryAfterS: number | undefined): number;
}
/** The stream frames the refresh's allow-list reads (`shared/api.ts#SessionStreamMsg`'s, structurally). */
type StreamFrame =
  | { type: 'events'; uuid: string; offset: number; events: { kind: 'user' | 'assistant'; uuid: string; ts: string; text: string }[] }
  | { type: 'status'; status: 'idle' | 'busy'; statusUpdatedAt: null }
  | { type: 'beat'; at: number };

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const msg = (id: number, at: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow => ({
  id, at, term: 1, state: 'queued', text: `fixture message ${id}`, cut: false, sha256: 'a'.repeat(64),
  queuedAt: at, deliveredAt: null, pickedUpAt: null, settledAt: null, settledBy: null, spentAt: null, offRecord: false, ...over,
});
const gen = (term: number, n: number, startReportedAt: number, over: Partial<GenerationFact> = {}): GenerationFact => ({
  term, n, startReportedAt, sessionId: 'lane-a-overlord', live: false, conversation: 'c1c1c1c1-1111-4111-8111-111111111111', ...over,
});
/** A recorded reply (PR B): a fixture text, keyed by a fixture entry uuid built from its id. */
const reply = (id: number, at: number, over: Partial<OverlordReplyRow> = {}): OverlordReplyRow => ({
  id, at, turnAt: at, term: 1, entryUuid: `e0e0e0e0-0000-4000-8000-${String(id).padStart(12, '0')}`, text: `fixture reply ${id}`, cut: false,
  sha256: 'b'.repeat(64), inReplyTo: null, offRecord: false, ...over,
});
/** The nudge line, spelled out: the mail nudge's head, then the body (the renderer's own round trip is in the vocab test). */
const nudge = (id: number): string => `ccrc-mail: you have new mail. Operator message ${id}: read it with your messages door.`;

// ── shared/overlordChat.ts ────────────────────────────────────────────────────────────────────────────────────────────

export function chatTicksCases(m: ChatVocabModule): Record<string, SuiteCase> {
  const lit = (r: OperatorMessageRow): string[] => { const t = m.chatTicksOf(r); return m.TICK_STAGES.filter((s) => t.lit[s]); };
  return {
    'recorded lights recorded alone': () => { expect(lit(msg(1, 1, { state: 'recorded', queuedAt: null }))).toEqual(['recorded']); },
    'queued lights recorded and delivery, as queued': () => {
      const r = msg(1, 1);
      expect(lit(r)).toEqual(['recorded', 'delivery']);
      expect(m.chatTicksOf(r).delivery).toBe('queued');
    },
    'delivered lights recorded and delivery, as delivered': () => {
      const r = msg(1, 1, { state: 'delivered', deliveredAt: 2 });
      expect([lit(r), m.chatTicksOf(r).delivery]).toEqual([['recorded', 'delivery'], 'delivered']);
    },
    'picked up with no deliveredAt lights recorded and picked-up, delivery null': () => {
      const r = msg(1, 1, { state: 'picked-up', pickedUpAt: 3 });
      expect([lit(r), m.chatTicksOf(r).delivery]).toEqual([['recorded', 'picked-up'], null]);
    },
    'a whole walk lights every tick, delivered': () => {
      const r = msg(1, 1, { state: 'settled', deliveredAt: 2, pickedUpAt: 3, settledAt: 4, settledBy: 'acknowledge' });
      expect([lit(r), m.chatTicksOf(r).delivery, m.chatTicksOf(r).settledBy]).toEqual([['recorded', 'delivery', 'picked-up', 'settled'], 'delivered', 'acknowledge']);
    },
    'a row settled by the mark before any delivery lights recorded and settled only': () => {
      const r = msg(1, 1, { state: 'settled', queuedAt: null, settledAt: 1, settledBy: 'mark' });
      expect([lit(r), m.chatTicksOf(r).delivery, m.chatTicksOf(r).settledBy]).toEqual([['recorded', 'settled'], null, 'mark']);
    },
    'spent reaches settled': () => { expect(lit(msg(1, 1, { state: 'spent', queuedAt: null, spentAt: 5 }))).toEqual(['recorded', 'settled']); },
    'an unknown state lights recorded only and says unknown, whatever its stamps': () => {
      const r = msg(1, 1, { state: 'unknown', deliveredAt: 2, pickedUpAt: 3, settledAt: 4, settledBy: 'cite' });
      expect([lit(r), m.chatTicksOf(r).unknown, m.chatTicksOf(r).delivery]).toEqual([['recorded'], true, null]);
    },
  };
}

export function readChatThreadCases(m: ChatVocabModule): Record<string, SuiteCase> {
  const thread = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    v: 1, designation: 'designated', sessionId: 'lane-a-overlord', term: 1,
    entries: [
      { kind: 'divider', gen: { term: 1, n: 1 }, at: 900, current: true, newTerm: false, earlier: 'not-pageable' },
      { kind: 'message', row: msg(7, 1_000) },
      { kind: 'server-line', messageId: 7, text: 'Recorded. The Overlord is renewing.', word: 'renewing' },
    ],
    messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 1 } },
    readiness: { kind: 'read', value: { oldest: 100 } }, ...over,
  });
  return {
    'reads a thread back, the ticks derived from the row': () => {
      const r = m.readChatThread(thread());
      expect(r.ok && [r.skipped, r.thread.entries.map((e) => e.kind)]).toEqual([0, ['divider', 'message', 'server-line']]);
      expect(r.ok && r.thread.entries[1]).toEqual({ kind: 'message', row: msg(7, 1_000), ticks: m.chatTicksOf(msg(7, 1_000)) });
    },
    'a row with no offRecord reads false; an unknown state reads unknown': () => {
      const { offRecord: _o, ...old } = msg(7, 1);
      const r = m.readChatThread(thread({ entries: [{ kind: 'message', row: { ...old, state: 'newer-state' } }] }));
      expect(r.ok && r.thread.entries[0]).toMatchObject({ kind: 'message', row: { offRecord: false, state: 'unknown' } });
    },
    'skips and counts an unknown kind and an unknown server-line word; ignores an unknown key': () => {
      // `reply` was this case's unknown kind until the chat's PR B made it known; a later wave's kind stands in for it now.
      const r = m.readChatThread(thread({ extra: 1, entries: [{ kind: 'request', id: 3 }, { kind: 'server-line', messageId: 7, text: 'x', word: 'newer-word' }, { kind: 'message', row: msg(7, 1) }] }));
      expect(r.ok && [r.skipped, r.thread.entries.length]).toEqual([2, 1]);
    },
    // PR B: the reply entry, the replies part and the older cursor.
    'reads a reply entry with its response; a response kind this build does not know reads unmeasured, never no-row': () => {
      const r = m.readChatThread(thread({ entries: [{ kind: 'reply', row: reply(8, 1_100), response: { kind: 'row', id: 80, handledAt: null } },
        { kind: 'reply', row: reply(9, 1_200), response: { kind: 'later-word' } }], replies: { kind: 'read', value: { more: false } }, older: null }));
      expect(r.ok && r.thread.entries).toEqual([{ kind: 'reply', row: reply(8, 1_100), response: { kind: 'row', id: 80, handledAt: null } },
        { kind: 'reply', row: reply(9, 1_200), response: { kind: 'unmeasured' } }]);
      expect(m.readChatThread(thread({ entries: [{ kind: 'reply', row: { id: 8 }, response: { kind: 'no-row' } }] })).ok).toBe(false);
    },
    'a server below PR B: no replies part reads null, its own value, and its older page is the messages\' alone': () => {
      const r = m.readChatThread(thread({ messages: { kind: 'read', value: { more: true } } }));
      expect(r.ok && [r.thread.replies, r.thread.older]).toEqual([null, { before: 7, replyBefore: 'end' }]);
      const none = m.readChatThread(thread());
      expect(none.ok && [none.thread.replies, none.thread.older]).toEqual([null, null]);
    },
    'reads an older cursor of ids or end; refuses any other cursor': () => {
      const r = m.readChatThread(thread({ replies: { kind: 'read', value: { more: true } }, older: { before: 'end', replyBefore: 12 } }));
      expect(r.ok && r.thread.older).toEqual({ before: 'end', replyBefore: 12 });
      for (const older of [{ before: 0, replyBefore: 'end' }, { before: 'end' }, { before: '3', replyBefore: 'end' }, 'end']) {
        expect(m.readChatThread(thread({ replies: { kind: 'read', value: { more: false } }, older })).ok, JSON.stringify(older)).toBe(false);
      }
    },
    'refuses a missing v, a part of neither kind, a malformed known entry, and a designated thread with no term': () => {
      const { v: _v, ...noV } = thread();
      for (const raw of [noV, thread({ v: 2 }), thread({ messages: { kind: 'empty', value: { more: false } } }), thread({ readiness: { kind: 'read', value: { oldest: 'x' } } }),
        thread({ entries: [{ kind: 'message', row: { id: 1 } }] }), thread({ term: null }), 'x']) {
        expect(m.readChatThread(raw).ok, JSON.stringify(raw).slice(0, 60)).toBe(false);
      }
    },
    'an unmeasured part reads with its why': () => {
      const r = m.readChatThread(thread({ messages: { kind: 'unmeasured', why: 'closed' }, entries: [] }));
      expect(r.ok && r.thread.messages).toEqual({ kind: 'unmeasured', why: 'closed' });
    },
  };
}

export function readChatSendAnswerCases(m: ChatVocabModule): Record<string, SuiteCase> {
  return {
    '200 with a messageId is recorded, with replay, cut and the offRecord echo': () => {
      expect(m.readChatSendAnswer(200, { ok: true, messageId: 9, cut: false, replay: false, offRecord: true })).toEqual({ kind: 'recorded', messageId: 9, cut: false, replay: false, offRecord: true });
      expect(m.readChatSendAnswer(200, { ok: true, messageId: 9, cut: true, replay: true })).toEqual({ kind: 'recorded', messageId: 9, cut: true, replay: true, offRecord: false });
    },
    '200 with no messageId is off-shape': () => {
      expect(m.readChatSendAnswer(200, { ok: true })).toEqual({ kind: 'off-shape' });
      expect(m.readChatSendAnswer(200, { ok: true, messageId: 0 })).toEqual({ kind: 'off-shape' });
    },
    'a refusal status with an error word is refused, retryAfterS on read-ceiling': () => {
      expect(m.readChatSendAnswer(409, { ok: false, error: 'stale-designation' })).toEqual({ kind: 'refused', error: 'stale-designation' });
      expect(m.readChatSendAnswer(429, { ok: false, error: 'read-ceiling', retryAfterS: 30 })).toEqual({ kind: 'refused', error: 'read-ceiling', retryAfterS: 30 });
    },
    'not an object, a refusal with no word, or another status is off-shape': () => {
      expect(m.readChatSendAnswer(200, 'ok')).toEqual({ kind: 'off-shape' });
      expect(m.readChatSendAnswer(409, { ok: false })).toEqual({ kind: 'off-shape' });
      expect(m.readChatSendAnswer(302, { ok: false, error: 'x' })).toEqual({ kind: 'off-shape' });
    },
  };
}

export function readChatEarlierQueryCases(m: ChatVocabModule): Record<string, SuiteCase> {
  const U = 'a1a1a1a1-0000-4000-8000-000000000006';
  return {
    'term and n positive whole numbers; around absent or a uuid': () => {
      expect(m.readChatEarlierQuery({ term: '1', n: '2' })).toEqual({ ok: true, req: { gen: { term: 1, n: 2 }, around: null } });
      expect(m.readChatEarlierQuery({ term: '2', n: '1', around: U })).toEqual({ ok: true, req: { gen: { term: 2, n: 1 }, around: U } });
    },
    'anything else refused, a target above all': () => {
      for (const q of [{ term: '0', n: '1' }, { term: '1', n: '0' }, { term: '1' }, { term: '1.0', n: '1' }, { term: '1', n: '1', around: 'x' },
        { term: '1', n: '1', around: U.toUpperCase() }, { term: '1', n: '1', target: 'lane-b-overlord' }, 'term=1']) {
        expect(m.readChatEarlierQuery(q).ok, JSON.stringify(q)).toBe(false);
      }
    },
  };
}

// ── shared/operatorMessages.ts ────────────────────────────────────────────────────────────────────────────────────────

export function nudgeIdCases(m: NudgeModule): Record<string, SuiteCase> {
  return {
    'reads the id of the line for 1, 12 and the largest safe integer, and with one trailing newline': () => {
      expect([1, 12, 2 ** 53 - 1].map((n) => m.operatorMessageNudgeIdOf(nudge(n)))).toEqual([1, 12, 2 ** 53 - 1]);
      expect(m.operatorMessageNudgeIdOf(`${nudge(5)}\n`)).toBe(5);
      expect(m.operatorMessageNudgeIdOf(m.operatorMessageNudgeLine(77))).toBe(77);
    },
    'null for every near miss': () => {
      for (const t of [`${nudge(12)} now`, ` ${nudge(12)}`, `${nudge(12)} `, `${nudge(12)}\n\n`, nudge(12).replace('12', '0'), nudge(12).replace('12', '-12'),
        nudge(12).replace('12', '12.5'), nudge(12).replace('12', '012'), nudge(12).replace('12', '9007199254740993'),
        'Operator message 12: read it with your messages door.', 'ccrc-mail: you have new mail. Use the client', '']) {
        expect(m.operatorMessageNudgeIdOf(t), JSON.stringify(t)).toBeNull();
      }
    },
  };
}

// ── server/src/coord/overlordChat.ts ──────────────────────────────────────────────────────────────────────────────────

export function readinessAtCases(m: ChatL1Module): Record<string, SuiteCase> {
  const changes = [{ at: 100, word: 'unproved' as const }, { at: 200, word: 'ready' as const }, { at: 300, word: 'renewing' as const }];
  return {
    'before the oldest kept row is not on record; at a change, that change; between two, the earlier; no rows, not on record': () => {
      expect([99, 100, 200, 250, 10_000].map((t) => m.readinessAt(changes, t))).toEqual(['not-on-record', 'unproved', 'ready', 'ready', 'renewing']);
      expect(m.readinessAt([], 500)).toBe('not-on-record');
    },
    'a stored unmeasured word is that word': () => { expect(m.readinessAt([{ at: 0, word: 'unmeasured' }], 5)).toBe('unmeasured'); },
  };
}

export function composeChatCases(m: ChatL1Module): Record<string, SuiteCase> {
  type Facts = Parameters<ChatL1Module['composeChat']>[0];
  const facts = (over: Partial<Facts> = {}): Facts => ({
    designation: { kind: 'designated', sessionId: 'lane-a-overlord', term: 1 }, messages: { kind: 'rows', rows: [], more: false },
    replies: { kind: 'rows', rows: [], more: false }, responses: { kind: 'rows', byReply: new Map() },
    generations: { kind: 'rows', rows: [] }, readiness: { kind: 'rows', rows: [{ at: 0, word: 'ready' }], oldest: 0 }, pageable: false, ...over,
  });
  const shape = (f: Facts): string[] => m.composeChat(f).entries.map((e) =>
    e.kind === 'message' ? `m${e.row.id}` : e.kind === 'server-line' ? `s${e.messageId}:${e.word}` : e.kind === 'reply' ? `r${e.row.id}:${e.response.kind}`
      : `d${e.gen.term}.${e.gen.n}${e.current ? '*' : ''}${e.newTerm ? '+' : ''}`);
  return {
    // PR B: the replies, placed by time among the messages and read with their response rows.
    'a reply sits by its time among the messages, after a message at the same millisecond, with its response row or none': () => {
      expect(shape(facts({ messages: { kind: 'rows', rows: [msg(2, 200), msg(5, 400)], more: false },
        replies: { kind: 'rows', rows: [reply(3, 200), reply(4, 300), reply(1, 100)], more: false },
        responses: { kind: 'rows', byReply: new Map([[3, { id: 30, handledAt: null }], [1, { id: 10, handledAt: 5 }]]) } })))
        .toEqual(['r1:row', 'm2', 'r3:row', 'r4:no-row', 'm5']);
      const t = m.composeChat(facts({ replies: { kind: 'rows', rows: [reply(1, 100)], more: false },
        responses: { kind: 'rows', byReply: new Map([[1, { id: 10, handledAt: 5 }]]) } }));
      expect(t.entries).toEqual([{ kind: 'reply', row: reply(1, 100), response: { kind: 'row', id: 10, handledAt: 5 } }]);
    },
    'unreadable replies are their own unmeasured part, never an empty one; unreadable response rows read unmeasured on each reply': () => {
      const t = m.composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 100)], more: false }, replies: { kind: 'unmeasured', why: 'closed' } }));
      expect([shape(facts({ messages: { kind: 'rows', rows: [msg(1, 100)], more: false }, replies: { kind: 'unmeasured', why: 'closed' } })), t.replies])
        .toEqual([['m1'], { kind: 'unmeasured', why: 'closed' }]);
      expect(shape(facts({ replies: { kind: 'rows', rows: [reply(1, 100)], more: false }, responses: { kind: 'unmeasured', why: 'x' } }))).toEqual(['r1:unmeasured']);
    },
    'ids are not dense: a reply id between two message ids, and each table keeps its own cursor': () => {
      // One issued-id sequence over both tables (call 1888): messages 1 and 3, reply 2.
      const t = m.composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 100), msg(3, 300)], more: true },
        replies: { kind: 'rows', rows: [reply(2, 200)], more: false } }));
      expect(shape(facts({ messages: { kind: 'rows', rows: [msg(1, 100), msg(3, 300)], more: true },
        replies: { kind: 'rows', rows: [reply(2, 200)], more: false } }))).toEqual(['m1', 'r2:no-row', 'm3']);
      expect(t.older).toEqual({ before: 1, replyBefore: 'end' });
    },
    'an older divider never sits over nothing: with an older page, a divider below the oldest row shown waits for that page': () => {
      const gens: Facts['generations'] = { kind: 'rows', rows: [gen(1, 1, 50), gen(1, 2, 150, { live: true })] };
      expect(shape(facts({ generations: gens, messages: { kind: 'rows', rows: [msg(7, 100), msg(9, 200)], more: true } }))).toEqual(['m7', 'd1.2*', 'm9']);
      expect(shape(facts({ generations: gens, messages: { kind: 'rows', rows: [msg(7, 100), msg(9, 200)], more: false } }))).toEqual(['d1.1', 'm7', 'd1.2*', 'm9']);
      expect(shape(facts({ generations: gens }))).toEqual(['d1.1', 'd1.2*']);
    },
    'messages oldest first, a server line after each one whose word was not ready, none after a ready one': () => {
      expect(shape(facts({ messages: { kind: 'rows', rows: [msg(3, 350), msg(1, 150), msg(2, 250)], more: false },
        readiness: { kind: 'rows', rows: [{ at: 100, word: 'renewing' }, { at: 200, word: 'ready' }, { at: 300, word: 'dead' }], oldest: 100 } })))
        .toEqual(['m1', 's1:renewing', 'm2', 'm3', 's3:dead']);
    },
    'a message older than every kept row draws the not-on-record line': () => {
      expect(shape(facts({ messages: { kind: 'rows', rows: [msg(1, 50)], more: false }, readiness: { kind: 'rows', rows: [{ at: 100, word: 'ready' }], oldest: 100 } }))).toEqual(['m1', 's1:not-on-record']);
    },
    'a divider by startReportedAt, first on a tie, the live one current': () => {
      expect(shape(facts({ messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 200)], more: false },
        generations: { kind: 'rows', rows: [gen(1, 2, 200, { live: true }), gen(1, 1, 100)] } }))).toEqual(['d1.1', 'm1', 'd1.2*', 'm2']);
    },
    'the first divider of a new term sets newTerm; a generation with no message still draws its divider': () => {
      expect(shape(facts({ messages: { kind: 'rows', rows: [msg(1, 150)], more: false },
        generations: { kind: 'rows', rows: [gen(1, 1, 100), gen(1, 2, 300), gen(2, 1, 400, { live: true })] } }))).toEqual(['d1.1', 'm1', 'd1.2', 'd2.1*+']);
    },
    'every divider not-pageable when pageable is false; a non-live one readable when it is true': () => {
      const rows = [gen(1, 1, 100), gen(1, 2, 200, { live: true })];
      const earlier = (pageable: boolean) => m.composeChat(facts({ generations: { kind: 'rows', rows }, pageable })).entries.map((e) => e.kind === 'divider' && e.earlier);
      expect([earlier(false), earlier(true)]).toEqual([['not-pageable', 'not-pageable'], ['readable', 'not-pageable']]);
    },
    'unreadable messages: no message entries and messages unmeasured, never an empty read': () => {
      const t = m.composeChat(facts({ messages: { kind: 'unmeasured', why: 'closed' } }));
      expect([t.entries, t.messages]).toEqual([[], { kind: 'unmeasured', why: 'closed' }]);
    },
    'unreadable generations: no dividers and generations unmeasured': () => {
      const t = m.composeChat(facts({ generations: { kind: 'unmeasured', why: 'x' }, messages: { kind: 'rows', rows: [msg(1, 1)], more: true } }));
      expect([t.entries.map((e) => e.kind), t.generations]).toEqual([['message'], { kind: 'unmeasured', why: 'x' }]);
    },
    'an unreadable readiness history draws the not-on-record line under every message, never ready': () => {
      const f = facts({ messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 250)], more: false }, readiness: { kind: 'unmeasured', why: 'y' } });
      expect([shape(f), m.composeChat(f).readiness]).toEqual([['m1', 's1:not-on-record', 'm2', 's2:not-on-record'], { kind: 'unmeasured', why: 'y' }]);
    },
    'no designation: designation none and no entries': () => {
      const t = m.composeChat(facts({ designation: { kind: 'none' }, messages: { kind: 'rows', rows: [msg(1, 1)], more: false } }));
      expect([t.designation, t.sessionId, t.term, t.entries]).toEqual(['none', null, null, []]);
    },
  };
}

/** `chatPageCut` (PR B, the coordinator's ruling on paging): the two lists cut at one time floor, and the next page's cursors. */
export function chatPageCutCases(m: ChatL1Module): Record<string, SuiteCase> {
  const ids = (r: { readonly messages: readonly { id: number }[]; readonly replies: readonly { id: number }[] }) =>
    [r.messages.map((x) => x.id), r.replies.map((x) => x.id)];
  return {
    'neither list says more: every row kept, no floor, no older page': () => {
      const r = m.chatPageCut({ rows: [msg(1, 100), msg(3, 300)], more: false }, { rows: [reply(2, 200)], more: false });
      expect([ids(r), r.floor, r.older, r.messagesMore, r.repliesMore]).toEqual([[[1, 3], [2]], null, null, false, false]);
    },
    'the messages say more: replies older than the oldest message wait for the next page, which reads them again': () => {
      const r = m.chatPageCut({ rows: [msg(5, 500), msg(7, 700)], more: true }, { rows: [reply(2, 200), reply(6, 600)], more: false });
      expect([ids(r), r.floor, r.messagesMore, r.repliesMore]).toEqual([[[5, 7], [6]], 500, true, true]);
      expect(r.older).toEqual({ before: 5, replyBefore: 6 });
    },
    'both say more: the floor is the later of their oldest times; the list that set it keeps all of its rows': () => {
      const r = m.chatPageCut({ rows: [msg(4, 400), msg(9, 900)], more: true }, { rows: [reply(6, 600), reply(8, 800)], more: true });
      expect([ids(r), r.floor, r.older]).toEqual([[[9], [6, 8]], 600, { before: 9, replyBefore: 6 }]);
    },
    'a list the floor kept none of resumes one past its newest row read, so its rows are read again': () => {
      const r = m.chatPageCut({ rows: [msg(1, 100), msg(2, 200)], more: false }, { rows: [reply(10, 500), reply(11, 600)], more: true });
      expect([ids(r), r.older]).toEqual([[[], [10, 11]], { before: 3, replyBefore: 10 }]);
    },
    'a row at the floor is kept, on either list': () => {
      const r = m.chatPageCut({ rows: [msg(5, 500)], more: true }, { rows: [reply(4, 500), reply(3, 499)], more: false });
      expect(ids(r)).toEqual([[5], [4]]);
    },
    'a list that could not be read offers no older page, whatever the other says': () => {
      expect(m.chatPageCut(null, { rows: [reply(2, 200)], more: true }).older).toBeNull();
      expect(m.chatPageCut({ rows: [msg(2, 200)], more: true }, null).older).toBeNull();
    },
  };
}

export function earlierPagePlanCases(m: ChatL1Module): Record<string, SuiteCase> {
  const U = 'a1a1a1a1-0000-4000-8000-000000000006';
  return {
    'the live generation refuses current; no row no-generation; pageable false not-pageable': () => {
      expect(m.earlierPagePlan(gen(1, 2, 200, { live: true }), null, true)).toEqual({ kind: 'refuse', why: 'current' });
      expect(m.earlierPagePlan(null, null, true)).toEqual({ kind: 'refuse', why: 'no-generation' });
      expect(m.earlierPagePlan(gen(1, 1, 100), null, false)).toEqual({ kind: 'refuse', why: 'not-pageable' });
    },
    'a first page expands the conversation; an older page is expand --around <uuid> --before 40 --after 0, in the row\'s own session': () => {
      const target = { kind: 'session', session: 'lane-a-overlord' };
      expect(m.earlierPagePlan(gen(1, 1, 100), null, true)).toEqual({ kind: 'request', request: { verb: 'expand', target, agents: false, args: ['c1c1c1c1-1111-4111-8111-111111111111'] } });
      expect(m.earlierPagePlan(gen(1, 1, 100), U, true)).toEqual({ kind: 'request', request: { verb: 'expand', target, agents: false, args: ['--around', U, '--before', '40', '--after', '0'] } });
    },
    'a rebound body\'s old generation names its own old session': () => {
      const p = m.earlierPagePlan(gen(1, 1, 100, { sessionId: 'lane-b-overlord' }), U, true);
      expect(p.kind === 'request' && p.request.target).toEqual({ kind: 'session', session: 'lane-b-overlord' });
    },
  };
}

// ── pwa/src/overlord/chatWords.ts ─────────────────────────────────────────────────────────────────────────────────────

const iso = (s: number): string => new Date(T0 + s * 1000).toISOString();
const userTurn = (uuid: string, s: number, text: string): LiveItem => ({ kind: 'message', key: uuid, event: { kind: 'user', uuid, ts: iso(s), text }, streaming: false });
const liveReply = (uuid: string, s: number): LiveItem => ({ kind: 'message', key: uuid, event: { kind: 'assistant', uuid, ts: iso(s), text: `answer ${uuid}` }, streaming: false });
const entry = (r: OperatorMessageRow): ChatEntry => ({ kind: 'message', row: r, ticks: { lit: { recorded: true, delivery: true, 'picked-up': false, settled: false }, delivery: 'queued', settledBy: null, unknown: false } });
/** A recorded reply as the thread carries it (PR B): the live assistant row it is drawn in the place of is the one whose event uuid is
 *  its `entryUuid`, so a case names that uuid in `over`. `reply` above is the server's row helper; `liveReply` is the live row. */
const replyEntry = (id: number, at: number, over: Partial<OverlordReplyRow> = {}): ReplyEntry => ({ kind: 'reply', row: reply(id, at, over), response: { kind: 'no-row' } });
const rowShape = (rows: readonly Row[]): string[] => rows.map((r) =>
  r.kind === 'entry' ? (r.entry!.kind === 'message' ? `m${r.entry!.row.id}` : r.entry!.kind === 'reply' ? `r${r.entry!.row.id}` : r.entry!.kind)
    : r.kind === 'live' ? `live:${r.item!.kind}` : r.kind === 'message-link' ? `link${r.id}` : r.kind);

export function draftAfterSendCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'clear for recorded, with and without replay': () => {
      for (const replay of [false, true]) expect(m.draftAfterSend({ kind: 'recorded', messageId: 1, cut: false, replay, offRecord: false })).toBe('clear');
    },
    'keep for every refusal word, off-shape and no answer': () => {
      for (const error of ['renewing', 'stale-designation', 'unmeasured', 'read-ceiling']) expect(m.draftAfterSend({ kind: 'refused', error }), error).toBe('keep');
      expect([m.draftAfterSend({ kind: 'off-shape' }), m.draftAfterSend({ kind: 'no-answer' })]).toEqual(['keep', 'keep']);
    },
  };
}

export function turnOriginCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'a nudge line is the nudge, with its id': () => { expect(m.turnOrigin(nudge(12))).toEqual({ kind: 'nudge', id: 12 }); },
    'an injected prompt is ccrc\'s, by its name': () => {
      expect(m.turnOrigin('/clear')).toEqual({ kind: 'ccrc', name: 'clear' });
      expect(m.turnOrigin('ccrc-mail: you have new mail. Use the client')).toEqual({ kind: 'ccrc', name: 'mail-nudge' });
    },
    'any other text, a near miss of a nudge line included, is pane text': () => {
      for (const t of ['please stop', `${nudge(12)} and also this`, ` ${nudge(12)}`, 'Operator message 12: read it with your messages door.']) {
        expect(m.turnOrigin(t), t).toEqual({ kind: 'pane' });
      }
    },
    'a near miss by one character at either end is pane text, never the nudge and never ccrc\'s': () => {
      const line = nudge(12);
      const flip = (c: string): string => (c === 'x' ? 'y' : 'x');
      for (const t of [flip(line[0]!) + line.slice(1), line.slice(0, -1) + flip(line.at(-1)!), line.slice(1), line.slice(0, -1), `x${line}`, `${line}x`]) {
        expect(m.turnOrigin(t), JSON.stringify(t)).toEqual({ kind: 'pane' });
      }
    },
  };
}

export function mergeLiveCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'a message whose nudge is live sits at the nudge\'s place; the nudge itself is never drawn': () => {
      const thread: ChatEntry[] = [{ kind: 'divider', gen: { term: 1, n: 1 }, at: T0, current: true, newTerm: false, earlier: 'not-pageable' }, entry(msg(5, T0 + 10_000))];
      expect(rowShape(m.mergeLive(thread, [liveReply('a1', 5), userTurn('u1', 30, nudge(5)), liveReply('a2', 31)]))).toEqual(['divider', 'live:message', 'm5', 'live:message']);
    },
    'a message with no live nudge sits by time, or before every row': () => {
      const thread = [entry(msg(5, T0 + 3_000)), entry(msg(6, T0 + 20_000))];
      expect(rowShape(m.mergeLive(thread, [liveReply('a1', 5), liveReply('a2', 10), liveReply('a3', 40)]))).toEqual(['m5', 'live:message', 'live:message', 'm6', 'live:message']);
    },
    'no id twice; an id outside the page is a link row': () => {
      expect(rowShape(m.mergeLive([entry(msg(5, T0))], [userTurn('u1', 10, nudge(5)), userTurn('u2', 20, nudge(5)), userTurn('u3', 21, nudge(99))]))).toEqual(['m5', 'link99']);
    },
    'a ccrc prompt is a quiet line; pane text is a pane turn, never a live user row': () => {
      const rows = m.mergeLive([], [userTurn('u1', 10, '/clear'), userTurn('u2', 11, 'do the thing'), { kind: 'mail-prompt', key: 'u3', event: { kind: 'user', uuid: 'u3', ts: iso(12), text: nudge(8) } }]);
      expect(rowShape(rows)).toEqual(['ccrc-line', 'pane-turn', 'link8']);
      expect(rows[1]).toMatchObject({ kind: 'pane-turn', text: 'do the thing' });
    },
    // PR B: a recorded reply is drawn once, in its live row's place (the coordinator's ruling).
    'a reply whose entry is live takes that row\'s place; its live copy and the record\'s other live blocks are not drawn': () => {
      const thread: ChatEntry[] = [{ kind: 'divider', gen: { term: 1, n: 1 }, at: T0, current: true, newTerm: false, earlier: 'not-pageable' }, replyEntry(8, T0 + 31_000, { entryUuid: 'a2' })];
      const rows = m.mergeLive(thread, [liveReply('a1', 5), liveReply('a2', 31), liveReply('a2', 31), liveReply('a3', 40)]);
      // a1 is the same turn's earlier text (no user turn before it): dropped with the other blocks, the reply being the whole turn's text.
      expect(rowShape(rows)).toEqual(['divider', 'r8', 'live:message']);
    },
    'the reply is the whole turn\'s text: the turn\'s earlier live assistant text rows are dropped, its tool row and the earlier turn stay': () => {
      const tool: LiveItem = { kind: 'tool', key: 'k1', use: { uuid: 'k1', ts: iso(12), toolId: 't1', name: 'Bash', input: '{}' } } as never;
      const live = [liveReply('old', 1), userTurn('u1', 10, 'typed'), liveReply('a1', 11), tool, liveReply('a2', 13), liveReply('a3', 15)];
      expect(rowShape(m.mergeLive([replyEntry(8, T0 + 15_000, { entryUuid: 'a3' })], live))).toEqual(['live:message', 'pane-turn', 'live:tool', 'r8']);
      expect(rowShape(m.mergeLive([replyEntry(8, T0 + 15_000, { entryUuid: 'a3' })], [liveReply('a1', 1), liveReply('a3', 15)]))).toEqual(['r8']);
    },
    'a reply with no live row sits by time; a reply id is drawn once; one an earlier page drew is not drawn': () => {
      const thread: ChatEntry[] = [replyEntry(9, T0 + 2_000, { entryUuid: 'gone' }), replyEntry(8, T0 + 20_000, { entryUuid: 'gone-too' }), replyEntry(8, T0 + 20_000, { entryUuid: 'gone-too' })];
      const live = [liveReply('a1', 5), liveReply('a2', 10), liveReply('a3', 40)];
      expect(rowShape(m.mergeLive(thread, live))).toEqual(['r9', 'live:message', 'live:message', 'r8', 'live:message']);
      expect(rowShape(m.mergeLive(thread, live, new Set([9])))).toEqual(['live:message', 'live:message', 'r8', 'live:message']);
    },
  };
}

// The refresh's three deciders (review F11).
export function chatReadTriggerCases(m: ChatWordsModule): Record<string, SuiteCase> {
  const ev = (kind: 'user' | 'assistant'): StreamFrame =>
    ({ type: 'events', uuid: 'u', offset: 0, events: [{ kind, uuid: 'e', ts: new Date(T0).toISOString(), text: 'x' }] });
  const st = (status: 'idle' | 'busy'): StreamFrame => ({ type: 'status', status, statusUpdatedAt: null });
  return {
    'a user turn asks, an assistant frame does not': () => {
      expect([m.chatReadTrigger(ev('user'), null), m.chatReadTrigger(ev('assistant'), 'busy')]).toEqual([true, false]);
    },
    'idle after busy asks; idle after idle, idle first and busy do not': () => {
      expect([m.chatReadTrigger(st('idle'), 'busy'), m.chatReadTrigger(st('idle'), 'idle'), m.chatReadTrigger(st('idle'), null), m.chatReadTrigger(st('busy'), 'idle')])
        .toEqual([true, false, false, false]);
    },
    'a beat never asks': () => { expect(m.chatReadTrigger({ type: 'beat', at: 1 }, 'busy')).toBe(false); },
  };
}

export function nextReadAtCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'no read yet reads now; the default spacing is 10 s; a wider one is honoured': () => {
      expect([m.nextReadAt(null, T0, 0), m.nextReadAt(T0, T0 + 1_000, 0), m.nextReadAt(T0, T0 + 1_000, 0, 30_000)]).toEqual([T0, T0 + 10_000, T0 + 30_000]);
    },
    'a ceiling\'s wait wins when it is later': () => {
      expect([m.nextReadAt(T0, T0 + 1_000, T0 + 60_000), m.nextReadAt(null, T0, T0 + 5_000)]).toEqual([T0 + 60_000, T0 + 5_000]);
    },
  };
}

export function pickUpReadEveryCases(m: ChatWordsModule): Record<string, SuiteCase> {
  const NOW = T0 + 1_000_000;
  const lit = (pickedUp: boolean, settled: boolean) => ({ recorded: true, delivery: true, 'picked-up': pickedUp, settled });
  const waiting = (id: number, age: number, o: { unknown?: boolean; pickedUp?: boolean; settled?: boolean } = {}): ChatEntry =>
    ({ kind: 'message', row: msg(id, NOW - age), ticks: { lit: lit(o.pickedUp ?? false, o.settled ?? false), delivery: 'queued', settledBy: null, unknown: o.unknown ?? false } }) as ChatEntry;
  const t = (...entries: ChatEntry[]) => ({ entries });
  return {
    'young: every 10 s; past a minute: every 30 s; past ten minutes: never': () => {
      expect([m.pickUpReadEvery(t(waiting(1, 5_000)), NOW), m.pickUpReadEvery(t(waiting(1, 120_000)), NOW), m.pickUpReadEvery(t(waiting(1, 600_000)), NOW)])
        .toEqual([10_000, 30_000, null]);
    },
    'an unknown state, a pick-up and a settlement are not awaited': () => {
      expect([m.pickUpReadEvery(t(waiting(1, 5_000, { unknown: true })), NOW), m.pickUpReadEvery(t(waiting(1, 5_000, { pickedUp: true })), NOW),
        m.pickUpReadEvery(t(waiting(1, 5_000, { settled: true })), NOW)]).toEqual([null, null, null]);
    },
    'the youngest awaited message decides': () => {
      expect([m.pickUpReadEvery(t(waiting(1, 300_000), waiting(2, 5_000)), NOW), m.pickUpReadEvery(t(waiting(1, 5_000), waiting(2, 300_000)), NOW)]).toEqual([10_000, 10_000]);
    },
    'a stamp in the console\'s future counts as young': () => {
      expect([m.pickUpReadEvery(t(waiting(1, -1)), NOW), m.pickUpReadEvery(t(waiting(1, 300_000), waiting(2, -5_000)), NOW)]).toEqual([10_000, 10_000]);
    },
  };
}

export function historyItemsCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'an assistant item is its text; a user nudge is its link; pane text is a pane turn; no role is one untrusted block': () => {
      const rows = m.historyItemsToChat([
        { uuid: 'e1', role: 'assistant', text: 'Fixture answer.', trust: 'untrusted' },
        { uuid: 'e2', role: 'user', text: nudge(4), trust: 'untrusted' },
        { uuid: 'e3', role: 'user', text: 'typed in the pane', trust: 'untrusted' },
        { uuid: 'e4', trust: 'untrusted', outline: 'x' },
      ]);
      expect(rows.map((r) => r.kind)).toEqual(['history-text', 'message-link', 'pane-turn', 'untrusted-block']);
      expect([rows[1]!.id, rows[2]!.text]).toEqual([4, 'typed in the pane']);
    },
    // PR B: the same rule on an earlier page.
    'an assistant item that is a recorded reply\'s entry is that reply, once; a user item never is': () => {
      const e = replyEntry(8, T0, { entryUuid: 'e2' });
      const rows = m.historyItemsToChat([
        { uuid: 'e0', role: 'assistant', text: 'plain answer', trust: 'untrusted' },
        { uuid: 'e1', role: 'user', text: 'typed in the pane', trust: 'untrusted' },
        { uuid: 'e1b', role: 'assistant', text: 'an earlier block of the turn', trust: 'untrusted' },
        { uuid: 'e2', role: 'assistant', text: 'the recorded one', trust: 'untrusted' },
        { uuid: 'e2', role: 'assistant', text: 'its second block', trust: 'untrusted' },
      ], [e]);
      expect(rowShape(rows)).toEqual(['history-text', 'pane-turn', 'r8']);
      expect(m.historyItemsToChat([{ uuid: 'e2', role: 'user', text: 'typed in the pane', trust: 'untrusted' }], [e]).map((r) => r.kind)).toEqual(['pane-turn']);
    },
  };
}

/** The read ceiling's wait (review ruling 8): bounded at the ceiling's window, a stated default when the refusal names no time. */
export function ceilingNotBeforeCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'a stated wait is honoured: now plus retryAfterS': () => {
      expect([m.ceilingNotBefore(T0, 60), m.ceilingNotBefore(T0, 0)]).toEqual([T0 + 60_000, T0]);
    },
    'the wait is capped at one hour, the ceiling\'s own window, however large the server\'s time is': () => {
      expect([m.ceilingNotBefore(T0, 3_600), m.ceilingNotBefore(T0, 3_601), m.ceilingNotBefore(T0, 2 ** 31), m.ceilingNotBefore(T0, Number.MAX_SAFE_INTEGER)])
        .toEqual([T0 + 3_600_000, T0 + 3_600_000, T0 + 3_600_000, T0 + 3_600_000]);
    },
    'a refusal with no retry time, or one that is no wait, waits the default minute, never none': () => {
      for (const s of [undefined, Number.NaN, -5, Infinity]) expect(m.ceilingNotBefore(T0, s), String(s)).toBe(T0 + 60_000);
    },
  };
}

// ── the sets ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const set = <M>(modulePath: string, suite: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<never> =>
  ({ modulePath, suite, mutants } as MutantSet<M> as MutantSet<never>);

export const CHAT_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'shared/overlordChat.ts#chatTicksOf': set<ChatVocabModule>(VOCAB, chatTicksCases, [
    { id: 'T1 delivery lit by any later state', old: "delivery: delivered || at === 'delivery',", new: "delivery: delivered || at !== 'recorded'," },
    { id: 'T2 an unknown state lights its stamps', old: "  if (row.state === 'unknown') {", new: '  if (false) {' },
    { id: 'T3 delivery always reads queued', old: "delivery: delivered ? 'delivered' : lit.delivery ? 'queued' : null", new: "delivery: lit.delivery ? 'queued' : null" },
    { id: 'T4 a mark-settled row lights delivery', old: "delivery: delivered || at === 'delivery',", new: "delivery: delivered || at === 'delivery' || row.settledAt !== null," },
    { id: 'T5 picked-up lit by delivery', old: "'picked-up': row.pickedUpAt !== null || at === 'picked-up',", new: "'picked-up': row.pickedUpAt !== null || at === 'picked-up' || delivered," },
  ]),
  'shared/overlordChat.ts#readChatThread': set<ChatVocabModule>(VOCAB, readChatThreadCases, [
    { id: 'R1 an unknown entry kind refuses', old: "if (r === 'skip') { skipped += 1; continue; }", new: "if (r === 'skip') return no('unknown kind');" },
    { id: 'R2 no v check', old: "  if (raw.v !== 1) return no('v: not 1');\n", new: '' },
    { id: 'R3 a part of any kind reads', old: "  if (v.kind !== 'read' || !isObj(v.value)) return null;", new: '  if (!isObj(v.value)) return null;' },
    { id: 'R4 a missing offRecord reads true', old: 'offRecord: offRecord === true,', new: 'offRecord: offRecord !== false,' },
    { id: 'R5 a designated thread needs no term', old: " || !isCount(term))) return no('designated: no session or term');", new: ")) return no('designated: no session or term');" },
    // PR B.
    { id: 'R6 absent replies read as an empty part', old: 'const replies = raw.replies === undefined ? null :', new: "const replies = raw.replies === undefined ? { kind: 'read' as const, value: { more: false } } :" },
    { id: 'R7 an unknown response kind reads no-row', old: "  if (v.kind === 'no-row') return { kind: 'no-row' };\n  return { kind: 'unmeasured' };", new: "  return { kind: 'no-row' };" },
    { id: 'R8 an older server\'s older page dropped', old: "older = messages.kind === 'read' && messages.value.more && oldest !== undefined ? { before: oldest.row.id, replyBefore: 'end' } : null;", new: 'older = null;' },
  ]),
  'shared/overlordChat.ts#readChatSendAnswer': set<ChatVocabModule>(VOCAB, readChatSendAnswerCases, [
    { id: 'S1 a 200 with no messageId is recorded', old: "if (body.ok !== true || !isPositive(body.messageId)) return { kind: 'off-shape' };", new: "if (body.ok !== true) return { kind: 'off-shape' };" },
    { id: 'S2 retryAfterS dropped', old: '...(isCount(body.retryAfterS) ? { retryAfterS: body.retryAfterS } : {})', new: '...{}' },
    { id: 'S3 offRecord echo defaults true', old: 'offRecord: body.offRecord === true }', new: 'offRecord: body.offRecord !== false }' },
    { id: 'S4 a refusal with no word is refused', old: " || typeof body.error !== 'string' || body.error === '') return 'not-refused';", new: ") return 'not-refused';" },
  ]),
  'shared/overlordChat.ts#readChatEarlierQuery': set<ChatVocabModule>(VOCAB, readChatEarlierQueryCases, [
    { id: 'Q1 extra keys admitted', old: "const extra = onlyKeys(q, ['term', 'n', 'around']);", new: 'const extra = null;' },
    { id: 'Q2 around unchecked', old: "(typeof q.around !== 'string' || !UUID.test(q.around))", new: "typeof q.around !== 'string'" },
    { id: 'Q3 zero admitted', old: 'const DIGITS = /^[1-9][0-9]*$/;', new: 'const DIGITS = /^[0-9]+$/;' },
  ]),
  'shared/operatorMessages.ts#operatorMessageNudgeIdOf': set<NudgeModule>(MESSAGES, nudgeIdCases, [
    { id: 'N1 a trailing word admitted', old: "messages door.')}$`,", new: "messages door.')}`," },
    { id: 'N2 every space trimmed', old: "const whole = line.endsWith('\\n') ? line.slice(0, -1) : line;", new: 'const whole = line.trim();' },
    { id: 'N3 an unsafe id admitted', old: '  const n = Number(m[1]);\n  return Number.isSafeInteger(n) ? n : null;', new: '  const n = Number(m[1]);\n  return n;' },
  ]),
  'server/src/coord/overlordChat.ts#readinessAt': set<ChatL1Module>(L1, readinessAtCases, [
    { id: 'A1 a change at the time is not yet in force', old: '    if (c.at > at) break;', new: '    if (c.at >= at) break;' },
    { id: 'A2 before every row reads ready', old: 'let word: ReadinessWord | typeof NOT_ON_RECORD = NOT_ON_RECORD;', new: "let word: ReadinessWord | typeof NOT_ON_RECORD = 'ready';" },
  ]),
  'server/src/coord/overlordChat.ts#composeChat': set<ChatL1Module>(L1, composeChatCases, [
    { id: 'C1 ready draws a line', old: ': CHAT_SERVER_LINE_MAP[word];', new: ": CHAT_SERVER_LINE_MAP[word] ?? 'Recorded.';" },
    { id: 'C2 unreadable readiness folded into ready', old: 'readinessAt(f.readiness.rows, row.at) : NOT_ON_RECORD;', new: "readinessAt(f.readiness.rows, row.at) : 'ready';" },
    { id: 'C3 a message first on a tie', old: 'a.at - b.at || a.order - b.order || a.seq - b.seq', new: 'a.at - b.at || b.order - a.order || a.seq - b.seq' },
    { id: 'C4 every first divider is a new term', old: 'newTerm: prev !== null && prev.term !== g.term,', new: 'newTerm: prev === null || prev.term !== g.term,' },
    { id: 'C5 unreadable messages read as an empty page', old: ": { kind: 'unmeasured', why: f.messages.why },", new: ": { kind: 'read', value: { more: false } }," },
    { id: 'C6 pageable ignored', old: "earlier: f.pageable && !g.live ? 'readable' : 'not-pageable',", new: "earlier: !g.live ? 'readable' : 'not-pageable'," },
    { id: 'C7 the live generation not current', old: 'current: g.live,', new: 'current: false,' },
    // PR B: the replies and the page.
    { id: 'C8 unreadable replies read as an empty page', old: ": { kind: 'unmeasured', why: f.replies.why },", new: ": { kind: 'read', value: { more: false } }," },
    { id: 'C9 unreadable response rows read as no row', old: "f.responses.kind === 'unmeasured' ? { kind: 'unmeasured' }", new: "false ? { kind: 'unmeasured' }" },
    { id: 'C10 the divider floor ignored', old: '      if (g.startReportedAt < dividerFloor) return;\n', new: '' },
    { id: 'C11 a reply before a message at the same millisecond', old: 'timed.push({ at: row.at, order: 2,', new: 'timed.push({ at: row.at, order: 0,' },
  ]),
  'server/src/coord/overlordChat.ts#chatPageCut': set<ChatL1Module>(L1, chatPageCutCases, [
    { id: 'P1 the floor ignored', old: 'const floor = lows.length === 0 ? null : Math.max(...lows);', new: 'const floor = null as number | null;' },
    { id: 'P2 the floor the earlier time', old: 'const floor = lows.length === 0 ? null : Math.max(...lows);', new: 'const floor = lows.length === 0 ? null : Math.min(...lows);' },
    { id: 'P3 rows the floor left out not counted as more', old: '(messages.more || keptM.length < ms.length)', new: '(messages.more)' },
    { id: 'P4 the next cursor from the newest kept row', old: 'kept.length > 0 ? kept[0]!.id :', new: 'kept.length > 0 ? kept[kept.length - 1]!.id :' },
    { id: 'P5 a list with none kept skips its rows', old: 'read[read.length - 1]!.id + 1', new: 'read[0]!.id' },
    { id: 'P6 an older page with a list unreadable', old: 'messages === null || replies === null || (!messagesMore', new: '(!messagesMore' },
    { id: 'P7 a row at the floor dropped', old: 'ms.filter((m) => m.at >= floor)', new: 'ms.filter((m) => m.at > floor)' },
  ]),
  'server/src/coord/overlordChat.ts#earlierPagePlan': set<ChatL1Module>(L1, earlierPagePlanCases, [
    { id: 'E1 the live generation read', old: "  if (gen.live) return { kind: 'refuse', why: 'current' };\n", new: '' },
    { id: 'E2 pageable ignored', old: "  if (!pageable) return { kind: 'refuse', why: 'not-pageable' };\n", new: '' },
    { id: 'E3 the target is the identity, not the row\'s session', old: 'session: gen.sessionId };', new: "session: 'overlord' };" },
    { id: 'E4 a one-entry window', old: "'--before', String(EARLIER_PAGE_BEFORE)", new: "'--before', '1'" },
  ]),
  'pwa/src/overlord/chatWords.ts#draftAfterSend': set<ChatWordsModule>(WORDS, draftAfterSendCases, [
    { id: 'W1 no answer clears', old: "return a.kind === 'recorded' ? 'clear' : 'keep';", new: "return a.kind === 'recorded' || a.kind === 'no-answer' ? 'clear' : 'keep';" },
    { id: 'W2 off-shape clears', old: "return a.kind === 'recorded' ? 'clear' : 'keep';", new: "return a.kind !== 'refused' ? 'clear' : 'keep';" },
  ]),
  'pwa/src/overlord/chatWords.ts#turnOrigin': set<ChatWordsModule>(WORDS, turnOriginCases, [
    { id: 'O1 pane text read as a nudge', old: "return name === null ? { kind: 'pane' } : { kind: 'ccrc', name };", new: "return name === null ? { kind: 'nudge', id: 0 } : { kind: 'ccrc', name };" },
    { id: 'O2 a near miss is ccrc\'s', old: "  if (carriesOperatorMessageMarker(text)) return { kind: 'pane' };\n", new: '' },
  ]),
  'pwa/src/overlord/chatWords.ts#mergeLive': set<ChatWordsModule>(WORDS, mergeLiveCases, [
    { id: 'M1 an id drawn twice', old: '      if (seen.has(o.id)) continue;\n', new: '' },
    { id: 'M2 pane text passed through as a live user row', old: "rows.push({ kind: 'pane-turn', key: `pane-${t.key}`, text: t.text });", new: "rows.push({ kind: 'live', key: t.key, item });" },
    { id: 'M3 an early message drawn at the end', old: '    if (slot === -1) before.push(...u.rows);', new: '    if (slot === -1) slot = out.length - 1;\n    if (slot === -1) before.push(...u.rows);' },
    { id: 'M4 a nudge outside the page dropped', old: "rows.push({ kind: 'message-link', key: `link-${o.id}`, id: o.id }); continue;", new: 'continue;' },
    // PR B: the recorded replies.
    { id: 'M5 a recorded reply drawn beside its live row', old: 'const recorded = uuid === null ? undefined : byEntry.get(uuid);', new: 'const recorded = undefined as Unit | undefined;' },
    { id: 'M6 the record\'s other live blocks drawn too', old: '        if (!placed.has(recorded)) { placed.add(recorded); out.push({ at: liveAt(item), rows: recorded.rows }); }', new: '        placed.add(recorded); out.push({ at: liveAt(item), rows: recorded.rows });' },
    { id: 'M7 a repeated reply id drawn twice', old: '      if (skip.has(e.row.id) || replies.has(e.row.id)) continue;', new: '      if (skip.has(e.row.id)) continue;' },
    { id: 'M8 a reply an earlier page drew drawn again', old: '      if (skip.has(e.row.id) || replies.has(e.row.id)) continue;', new: '      if (replies.has(e.row.id)) continue;' },
    { id: 'M10 the turn\'s earlier text rows drawn beside the reply', old: 'if (assistantUuidOf(live[i]!) !== null) dropped.add(i);', new: 'if (false) dropped.add(i);' },
    { id: 'M11 the turn\'s start ignored: an earlier turn\'s text dropped too', old: 'i >= 0 && userTurnsOf(live[i]!) === null; i -= 1', new: 'i >= 0; i -= 1' },
    { id: 'M12 the turn\'s tool row dropped too', old: 'if (assistantUuidOf(live[i]!) !== null) dropped.add(i);', new: 'if (userTurnsOf(live[i]!) === null) dropped.add(i);' },
    { id: 'M9 a reply with no live row placed at the end', old: 'units.push({ at: e.row.at, id: null, rows: [row], reply: e });', new: 'units.push({ at: Number.NaN, id: null, rows: [row], reply: e });' },
  ]),
  'pwa/src/overlord/chatWords.ts#chatReadTrigger': set<ChatWordsModule>(WORDS, chatReadTriggerCases, [
    { id: 'RT1 any events frame asks', old: "if (msg.type === 'events') return msg.events.some((e) => e.kind === 'user');", new: "if (msg.type === 'events') return true;" },
    { id: 'RT2 idle after anything asks', old: "return msg.status === 'idle' && was === 'busy';", new: "return msg.status === 'idle';" },
    { id: 'RT3 busy asks', old: "return msg.status === 'idle' && was === 'busy';", new: "return was === 'busy' || msg.status === 'busy';" },
  ]),
  'pwa/src/overlord/chatWords.ts#nextReadAt': set<ChatWordsModule>(WORDS, nextReadAtCases, [
    { id: 'N1 the ceiling\'s wait ignored', old: 'lastReadAt + every, notBefore);', new: 'lastReadAt + every);' },
    { id: 'N2 no spacing after a read', old: 'lastReadAt + every, notBefore);', new: 'lastReadAt, notBefore);' },
    { id: 'N3 no default spacing', old: 'every: number = CHAT_READ_EVERY_MS', new: 'every: number = 0' },
  ]),
  'pwa/src/overlord/chatWords.ts#pickUpReadEvery': set<ChatWordsModule>(WORDS, pickUpReadEveryCases, [
    { id: 'P1 no bound', old: '    if (age >= PICK_UP_WAIT_MS) continue;\n', new: '' },
    { id: 'P2 an unknown state awaited', old: 'e.ticks.unknown || ', new: '' },
    { id: 'P3 the oldest decides', old: 'if (youngest === null || age < youngest) youngest = age;', new: 'if (youngest === null || age > youngest) youngest = age;' },
    { id: 'P4 no slowdown', old: 'return youngest < 60_000 ? CHAT_READ_EVERY_MS : PICK_UP_READ_LATER_MS;', new: 'return CHAT_READ_EVERY_MS;' },
    { id: 'P5 a pick-up awaited', old: " || e.ticks.lit['picked-up']", new: '' },
    { id: 'P6 a settlement awaited', old: ' || e.ticks.lit.settled) continue;', new: ') continue;' },
    { id: 'P7 a stamp in the future skipped', old: '    if (age >= PICK_UP_WAIT_MS) continue;\n', new: '    if (age >= PICK_UP_WAIT_MS || age < 0) continue;\n' },
  ]),
  'pwa/src/overlord/chatWords.ts#historyItemsToChat': set<ChatWordsModule>(WORDS, historyItemsCases, [
    { id: 'H1 a user item drawn as the Overlord\'s text', old: "if (typeof text === 'string' && role === 'assistant') {", new: "if (typeof text === 'string') {" },
    { id: 'H2 an unreadable item drawn as text', old: "return [{ kind: 'untrusted-block', key, text: block }];", new: "return [{ kind: 'history-text', key, text: block }];" },
    // PR B.
    { id: 'H3 a recorded reply drawn as its history text', old: "const recorded = typeof it['uuid'] === 'string' ? byEntry.get(it['uuid']) : undefined;", new: 'const recorded = undefined as ReplyEntry | undefined;' },
    { id: 'H4 a recorded reply drawn once per block', old: '      if (drawn.has(recorded.row.id)) return [];\n', new: '' },
  ]),
  'pwa/src/overlord/chatWords.ts#ceilingNotBefore': set<ChatWordsModule>(WORDS, ceilingNotBeforeCases, [
    { id: 'CB1 the wait not capped', old: 'Math.min(retryAfterS * 1000, CEILING_WAIT_MAX_MS)', new: 'retryAfterS * 1000' },
    { id: 'CB2 no default wait', old: ': CEILING_WAIT_DEFAULT_MS);', new: ': 0);' },
    { id: 'CB3 a negative time is a wait', old: ' && retryAfterS >= 0;', new: ';' },
    { id: 'CB4 an infinite time is a wait', old: 'Number.isFinite(retryAfterS) && ', new: '' },
  ]),
};
