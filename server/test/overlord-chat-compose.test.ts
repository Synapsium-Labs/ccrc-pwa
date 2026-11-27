// The Overlord chat's deciders (Overlord W1, the chat, Tasks 1 to 3; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`,
// questions 2, 3, 9, 12 and 14): `readinessAt`, `composeChat`, `earlierPagePlan`, and the two doors' shaping in
// `overlordChatDoor.ts`, so the routes file only acts. Pure: no store, no server.
import { describe, it, expect } from 'vitest';
import type { OperatorMessageRow } from '../../shared/operatorMessages.js';
import { readOverlordHistoryRequest } from '../../shared/overlordHistory.js';
import { CHAT_SERVER_LINE_MAP, CHAT_SERVER_LINE_UNMEASURED, NOT_ON_RECORD, chatTicksOf, readChatThread, type ChatEntry } from '../../shared/overlordChat.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import {
  EARLIER_PAGE_BEFORE, composeChat, earlierPagePlan, readinessAt, type ChatFacts, type GenerationFact, type ReadinessChange,
} from '../src/coord/overlordChat.js';
import {
  CHAT_EARLIER_PAGEABLE, chatDesignation, chatThreadComposed, earlierComposed, earlierScope, earlierStep, generationsFact, messagesFact,
  readinessFact,
} from '../src/coord/overlordChatDoor.js';
import { historyDoorAnswer } from '../src/coord/overlordHistory.js';
import * as l1Module from '../src/coord/overlordChat.js';
import { composeChatCases, earlierPagePlanCases, readinessAtCases } from './sim/chatSets.js';

const run = (cases: Record<string, () => void | Promise<void>>): void => { for (const [name, c] of Object.entries(cases)) it(name, c); };

const msg = (id: number, at: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow => ({
  id, at, term: 1, state: 'queued', text: `fixture message ${id}`, cut: false, sha256: 'a'.repeat(64),
  queuedAt: at, deliveredAt: null, pickedUpAt: null, settledAt: null, settledBy: null, spentAt: null, offRecord: false, ...over,
});
const gen = (term: number, n: number, startReportedAt: number, over: Partial<GenerationFact> = {}): GenerationFact => ({
  term, n, startReportedAt, sessionId: 'lane-a-overlord', live: false, conversation: `c${term}${n}c1c1c-1111-4111-8111-111111111111`.slice(0, 36), ...over,
});
const facts = (over: Partial<ChatFacts> = {}): ChatFacts => ({
  designation: { kind: 'designated', sessionId: 'lane-a-overlord', term: 1 },
  messages: { kind: 'rows', rows: [], more: false },
  generations: { kind: 'rows', rows: [] },
  readiness: { kind: 'rows', rows: [{ at: 0, word: 'ready' }], oldest: 0 },
  pageable: false,
  ...over,
});
const shape = (entries: readonly ChatEntry[]): string[] => entries.map((e) =>
  e.kind === 'message' ? `m${e.row.id}` : e.kind === 'server-line' ? `s${e.messageId}:${e.word}` : `d${e.gen.term}.${e.gen.n}${e.current ? '*' : ''}${e.newTerm ? '+' : ''}`);

describe('readinessAt: the word in force at a time (sim/chatSets.ts)', () => run(readinessAtCases(l1Module)));

describe('composeChat (sim/chatSets.ts)', () => run(composeChatCases(l1Module)));

describe('composeChat, beyond the set', () => {
  it('a server line carries its readiness word\'s line; the not-on-record line is its own', () => {
    const t = composeChat(facts({
      messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 50)], more: false },
      readiness: { kind: 'rows', rows: [{ at: 100, word: 'renewing' }], oldest: 100 },
    }));
    expect(t.entries.filter((e) => e.kind === 'server-line')).toEqual([
      { kind: 'server-line', messageId: 2, text: CHAT_SERVER_LINE_UNMEASURED, word: NOT_ON_RECORD },
      { kind: 'server-line', messageId: 1, text: CHAT_SERVER_LINE_MAP.renewing, word: 'renewing' },
    ]);
    expect(t.entries[1]).toMatchObject({ kind: 'server-line', messageId: 2 });
  });

  it('a message entry carries its ticks; a designated thread carries its session and term', () => {
    const t = composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 150)], more: false } }));
    expect(t.entries[0]).toEqual({ kind: 'message', row: msg(1, 150), ticks: chatTicksOf(msg(1, 150)) });
    expect([t.designation, t.sessionId, t.term]).toEqual(['designated', 'lane-a-overlord', 1]);
  });

  it('what it composes, readChatThread reads back unchanged', () => {
    const t = composeChat(facts({
      messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 250, { state: 'settled', settledAt: 250, settledBy: 'mark', queuedAt: null })], more: true },
      generations: { kind: 'rows', rows: [gen(1, 1, 100, { live: true })] },
      readiness: { kind: 'rows', rows: [{ at: 0, word: 'renewing' }], oldest: 0 },
    }));
    expect(readChatThread(JSON.parse(JSON.stringify(t)))).toEqual({ ok: true, thread: t, skipped: 0 });
  });
});

describe('earlierPagePlan (sim/chatSets.ts)', () => run(earlierPagePlanCases(l1Module)));

describe('earlierPagePlan, beyond the set', () => {
  it('every request it makes passes the history request\'s one reader, and the window is 40 entries', () => {
    const g = gen(1, 1, 100);
    for (const around of [null, 'a1a1a1a1-0000-4000-8000-000000000006']) {
      const p = earlierPagePlan(g, around, true);
      expect(p.kind === 'request' && readOverlordHistoryRequest(p.request)).toEqual({ ok: true, request: p.kind === 'request' ? p.request : null });
    }
    expect(EARLIER_PAGE_BEFORE).toBe(40);
  });
});

describe('the doors\' shaping (overlordChatDoor.ts)', () => {
  const view = { term: 2, model: 'opus' } as unknown as Extract<DesignationRead, { kind: 'designated' }>['row'];

  it('the designation: unmeasured refuses unmeasured; none is a none thread with no entries; designated carries the identity overlord', () => {
    expect(chatDesignation({ kind: 'unmeasured', why: 'x' })).toMatchObject({ kind: 'refuse', word: 'unmeasured' });
    const none = chatDesignation({ kind: 'not-designated', row: null });
    expect(none.kind === 'none' && [none.thread.designation, none.thread.entries]).toEqual(['none', []]);
    expect(chatDesignation({ kind: 'designated', sessionId: 'lane-b-overlord', term: 2, row: view }))
      .toEqual({ kind: 'designated', sessionId: 'lane-b-overlord', term: 2, identity: 'overlord' });
  });

  it('each reader\'s answer as a fact keeps unmeasured apart from empty', () => {
    expect(messagesFact({ kind: 'measured', value: { rows: [], more: false } })).toEqual({ kind: 'rows', rows: [], more: false });
    expect(messagesFact({ kind: 'unmeasured', why: 'closed' })).toEqual({ kind: 'unmeasured', why: 'closed' });
    expect(generationsFact({ ok: true, rows: [] })).toEqual({ kind: 'rows', rows: [] });
    expect(generationsFact({ ok: false, detail: 'd' })).toEqual({ kind: 'unmeasured', why: 'd' });
    expect(readinessFact({ ok: true, rows: [{ at: 1, word: 'ready' }], oldest: 1 })).toEqual({ kind: 'rows', rows: [{ at: 1, word: 'ready' }], oldest: 1 });
    expect(readinessFact({ ok: false, detail: 'r' })).toEqual({ kind: 'unmeasured', why: 'r' });
  });

  it('the thread\'s line: a thread with its messages is a served line counting them; one without is messages-unmeasured', () => {
    const t = composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 250)], more: false }, readiness: { kind: 'unmeasured', why: 'y' } }));
    expect(chatThreadComposed(t)).toEqual({ kind: 'rows', body: t, scope: 'session:lane-a-overlord', count: 2 });
    const u = composeChat(facts({ messages: { kind: 'unmeasured', why: 'closed' } }));
    expect(chatThreadComposed(u)).toEqual({ kind: 'answer', body: u, scope: 'session:lane-a-overlord', outcome: 'messages-unmeasured' });
  });

  it('the earlier scope names the row\'s session, the term and n, and the around; past the bound it drops the session', () => {
    expect(earlierScope({ term: 1, n: 2 }, 'lane-a-overlord', null)).toBe('session:lane-a-overlord:term:1:gen:2');
    expect(earlierScope({ term: 1, n: 2 }, 'lane-a-overlord', 'a1a1a1a1-0000-4000-8000-000000000006'))
      .toBe('session:lane-a-overlord:term:1:gen:2:around:a1a1a1a1-0000-4000-8000-000000000006');
    expect(earlierScope({ term: 1, n: 2 }, 'x'.repeat(220), null)).toBe('term:1:gen:2');
    expect(earlierScope({ term: 3, n: 1 }, null, null)).toBe('term:3:gen:1');
  });

  it('the earlier step: generations unmeasured refuses unmeasured; each plan refusal is bad-request with its why as the line outcome', () => {
    const k = { term: 1, n: 1 };
    expect(earlierStep({ kind: 'unmeasured', why: 'x' }, k, null, true)).toMatchObject({ kind: 'composed', composed: { kind: 'refuse', word: 'unmeasured', outcome: 'generations-unmeasured' } });
    expect(earlierStep({ kind: 'rows', rows: [] }, k, null, true)).toMatchObject({ kind: 'composed', composed: { word: 'bad-request', detail: 'no-generation', outcome: 'no-generation', scope: 'term:1:gen:1' } });
    expect(earlierStep({ kind: 'rows', rows: [gen(1, 1, 100, { live: true })] }, k, null, true)).toMatchObject({ kind: 'composed', composed: { word: 'bad-request', outcome: 'current' } });
    expect(earlierStep({ kind: 'rows', rows: [gen(1, 1, 100)] }, k, null, CHAT_EARLIER_PAGEABLE)).toMatchObject({ kind: 'composed', composed: { word: 'bad-request', outcome: 'not-pageable', scope: 'session:lane-a-overlord:term:1:gen:1' } });
  });

  it('the measured arm: not pageable', () => {
    expect(CHAT_EARLIER_PAGEABLE).toBe(false);
  });

  it('a pageable step reads the row\'s own session after a rebind, with the scope naming it', () => {
    const rows = [gen(1, 1, 100, { sessionId: 'lane-a-overlord' }), gen(2, 1, 200, { sessionId: 'lane-b-overlord', live: true })];
    const s = earlierStep({ kind: 'rows', rows }, { term: 1, n: 1 }, null, true);
    expect(s.kind === 'read' && [s.request.target, s.scope]).toEqual([{ kind: 'session', session: 'lane-a-overlord' }, 'session:lane-a-overlord:term:1:gen:1']);
  });

  it('the earlier answer: the history door\'s mapping, unchanged, under the generation\'s key', () => {
    const k = { term: 1, n: 1 };
    const page = { outcome: 'rows' as const, exit: 0 as const, items: [{ trust: 'untrusted' as const, role: 'user' }], shown: 1, total: 1,
      scope: { kind: 'overlord' as const, id: 'session:lane-a-overlord', project: null, families: [], families_total: 0, transcripts: 1 } };
    expect(earlierComposed(k, historyDoorAnswer({ kind: 'answer', answer: page }), 's')).toEqual({ kind: 'rows', body: { ok: true, gen: k, page }, scope: 's', count: 1 });
    expect(earlierComposed(k, historyDoorAnswer({ kind: 'answer', answer: { outcome: 'busy' } }), 's')).toEqual({ kind: 'answer', body: { ok: true, gen: k, page: { outcome: 'busy' } }, scope: 's', outcome: 'busy' });
    expect(earlierComposed(k, historyDoorAnswer({ kind: 'many-agents' }), 's')).toEqual({ kind: 'refuse', word: 'history-unreachable', extra: { cause: 'many-agents' }, scope: 's', outcome: 'many-agents' });
    expect(earlierComposed(k, historyDoorAnswer({ kind: 'answer', answer: { outcome: 'request-refused', word: 'bad-args' } }), 's'))
      .toEqual({ kind: 'refuse', word: 'bad-request', extra: { refusal: 'bad-args' }, scope: 's', outcome: 'request-refused' });
  });
});
