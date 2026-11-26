// The Overlord chat's twelve deciders: their oracle cases and mutant sets (Overlord W1, the chat, Task 1 Step 5; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, Global Constraints, "Mutation floors"). Each decider's cases are
// written ONCE here, over a loaded module: `overlord-chat-vocab.test.ts` and `overlord-chat-compose.test.ts` run the shared and
// server ones against the real modules, and `mutation-floors.test.ts` runs every set against each named mutant. The PWA's four
// (`pwa/src/overlord/chatWords.ts`) are loaded by path at runtime, as `faceSets.ts` loads the face's, so no type edge reaches
// `pwa/`; `pwa/test/overlord-chat-words.test.ts` pins the same behaviour against the real module there.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { OperatorMessageRow } from '../../../shared/operatorMessages.js';
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
export interface ChatWordsModule {
  draftAfterSend(a: ChatSendAnswer): 'clear' | 'keep';
  turnOrigin(text: string): { kind: 'nudge'; id: number } | { kind: 'ccrc'; name: string } | { kind: 'pane' };
  mergeLive(thread: readonly ChatEntry[], live: readonly LiveItem[]): readonly Row[];
  historyItemsToChat(items: readonly Readonly<Record<string, unknown>>[]): readonly Row[];
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const msg = (id: number, at: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow => ({
  id, at, term: 1, state: 'queued', text: `fixture message ${id}`, cut: false, sha256: 'a'.repeat(64),
  queuedAt: at, deliveredAt: null, pickedUpAt: null, settledAt: null, settledBy: null, spentAt: null, offRecord: false, ...over,
});
const gen = (term: number, n: number, startReportedAt: number, over: Partial<GenerationFact> = {}): GenerationFact => ({
  term, n, startReportedAt, sessionId: 'lane-a-overlord', live: false, conversation: 'c1c1c1c1-1111-4111-8111-111111111111', ...over,
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
      const r = m.readChatThread(thread({ extra: 1, entries: [{ kind: 'reply', id: 3 }, { kind: 'server-line', messageId: 7, text: 'x', word: 'newer-word' }, { kind: 'message', row: msg(7, 1) }] }));
      expect(r.ok && [r.skipped, r.thread.entries.length]).toEqual([2, 1]);
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
    generations: { kind: 'rows', rows: [] }, readiness: { kind: 'rows', rows: [{ at: 0, word: 'ready' }], oldest: 0 }, pageable: false, ...over,
  });
  const shape = (f: Facts): string[] => m.composeChat(f).entries.map((e) =>
    e.kind === 'message' ? `m${e.row.id}` : e.kind === 'server-line' ? `s${e.messageId}:${e.word}` : `d${e.gen.term}.${e.gen.n}${e.current ? '*' : ''}${e.newTerm ? '+' : ''}`);
  return {
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
const reply = (uuid: string, s: number): LiveItem => ({ kind: 'message', key: uuid, event: { kind: 'assistant', uuid, ts: iso(s), text: `answer ${uuid}` }, streaming: false });
const entry = (r: OperatorMessageRow): ChatEntry => ({ kind: 'message', row: r, ticks: { lit: { recorded: true, delivery: true, 'picked-up': false, settled: false }, delivery: 'queued', settledBy: null, unknown: false } });
const rowShape = (rows: readonly Row[]): string[] => rows.map((r) =>
  r.kind === 'entry' ? (r.entry!.kind === 'message' ? `m${r.entry!.row.id}` : r.entry!.kind) : r.kind === 'live' ? `live:${r.item!.kind}` : r.kind === 'message-link' ? `link${r.id}` : r.kind);

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
  };
}

export function mergeLiveCases(m: ChatWordsModule): Record<string, SuiteCase> {
  return {
    'a message whose nudge is live sits at the nudge\'s place; the nudge itself is never drawn': () => {
      const thread: ChatEntry[] = [{ kind: 'divider', gen: { term: 1, n: 1 }, at: T0, current: true, newTerm: false, earlier: 'not-pageable' }, entry(msg(5, T0 + 10_000))];
      expect(rowShape(m.mergeLive(thread, [reply('a1', 5), userTurn('u1', 30, nudge(5)), reply('a2', 31)]))).toEqual(['divider', 'live:message', 'm5', 'live:message']);
    },
    'a message with no live nudge sits by time, or before every row': () => {
      const thread = [entry(msg(5, T0 + 3_000)), entry(msg(6, T0 + 20_000))];
      expect(rowShape(m.mergeLive(thread, [reply('a1', 5), reply('a2', 10), reply('a3', 40)]))).toEqual(['m5', 'live:message', 'live:message', 'm6', 'live:message']);
    },
    'no id twice; an id outside the page is a link row': () => {
      expect(rowShape(m.mergeLive([entry(msg(5, T0))], [userTurn('u1', 10, nudge(5)), userTurn('u2', 20, nudge(5)), userTurn('u3', 21, nudge(99))]))).toEqual(['m5', 'link99']);
    },
    'a ccrc prompt is a quiet line; pane text is a pane turn, never a live user row': () => {
      const rows = m.mergeLive([], [userTurn('u1', 10, '/clear'), userTurn('u2', 11, 'do the thing'), { kind: 'mail-prompt', key: 'u3', event: { kind: 'user', uuid: 'u3', ts: iso(12), text: nudge(8) } }]);
      expect(rowShape(rows)).toEqual(['ccrc-line', 'pane-turn', 'link8']);
      expect(rows[1]).toMatchObject({ kind: 'pane-turn', text: 'do the thing' });
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
  ]),
  'shared/overlordChat.ts#readChatSendAnswer': set<ChatVocabModule>(VOCAB, readChatSendAnswerCases, [
    { id: 'S1 a 200 with no messageId is recorded', old: "if (body.ok !== true || !isPositive(body.messageId)) return { kind: 'off-shape' };", new: "if (body.ok !== true) return { kind: 'off-shape' };" },
    { id: 'S2 retryAfterS dropped', old: '...(isCount(body.retryAfterS) ? { retryAfterS: body.retryAfterS } : {})', new: '...{}' },
    { id: 'S3 offRecord echo defaults true', old: 'offRecord: body.offRecord === true }', new: 'offRecord: body.offRecord !== false }' },
    { id: 'S4 a refusal with no word is refused', old: "typeof body.error === 'string' && body.error !== ''", new: 'true' },
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
  ]),
  'pwa/src/overlord/chatWords.ts#historyItemsToChat': set<ChatWordsModule>(WORDS, historyItemsCases, [
    { id: 'H1 a user item drawn as the Overlord\'s text', old: "if (typeof text === 'string' && role === 'assistant') return", new: "if (typeof text === 'string') return" },
    { id: 'H2 an unreadable item drawn as text', old: "return { kind: 'untrusted-block', key, text: block };", new: "return { kind: 'history-text', key, text: block };" },
  ]),
};
