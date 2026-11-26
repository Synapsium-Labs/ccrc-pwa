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

describe('readinessAt: the word in force at a time', () => {
  const changes: ReadinessChange[] = [{ at: 100, word: 'unproved' }, { at: 200, word: 'ready' }, { at: 300, word: 'renewing' }];
  it('before the oldest kept row is not on record; at a change, that change; between two, the earlier; no rows, not on record', () => {
    expect(readinessAt(changes, 99)).toBe(NOT_ON_RECORD);
    expect(readinessAt(changes, 100)).toBe('unproved');
    expect(readinessAt(changes, 200)).toBe('ready');
    expect(readinessAt(changes, 250)).toBe('ready');
    expect(readinessAt(changes, 10_000)).toBe('renewing');
    expect(readinessAt([], 500)).toBe(NOT_ON_RECORD);
  });
  it('a stored unmeasured word is that word, never folded into not on record', () => {
    expect(readinessAt([{ at: 0, word: 'unmeasured' }], 5)).toBe('unmeasured');
  });
});

describe('composeChat', () => {
  it('messages oldest first, a server line right after each message whose word was not ready, none after a ready one', () => {
    const t = composeChat(facts({
      messages: { kind: 'rows', rows: [msg(3, 350), msg(1, 150), msg(2, 250)], more: false },
      readiness: { kind: 'rows', rows: [{ at: 100, word: 'renewing' }, { at: 200, word: 'ready' }, { at: 300, word: 'dead' }], oldest: 100 },
    }));
    expect(shape(t.entries)).toEqual(['m1', 's1:renewing', 'm2', 'm3', 's3:dead']);
    const line = t.entries[1];
    expect(line).toEqual({ kind: 'server-line', messageId: 1, text: CHAT_SERVER_LINE_MAP.renewing, word: 'renewing' });
    expect(t.entries[0]).toMatchObject({ kind: 'message', ticks: chatTicksOf(msg(1, 150)) });
    expect([t.designation, t.sessionId, t.term]).toEqual(['designated', 'lane-a-overlord', 1]);
  });

  it('a message older than every kept readiness row draws the not-on-record line', () => {
    const t = composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 50)], more: false }, readiness: { kind: 'rows', rows: [{ at: 100, word: 'ready' }], oldest: 100 } }));
    expect(t.entries[1]).toEqual({ kind: 'server-line', messageId: 1, text: CHAT_SERVER_LINE_UNMEASURED, word: NOT_ON_RECORD });
  });

  it('a divider before the first message of each generation, by startReportedAt; a divider first on a tie; the live one current', () => {
    const t = composeChat(facts({
      messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 200), msg(3, 450)], more: false },
      generations: { kind: 'rows', rows: [gen(1, 2, 200, { live: true }), gen(1, 1, 100)] },
    }));
    expect(shape(t.entries)).toEqual(['d1.1', 'm1', 'd1.2*', 'm2', 'm3']);
  });

  it('the first divider of a new term sets newTerm (a rebind); a generation with no message still draws its divider', () => {
    const t = composeChat(facts({
      messages: { kind: 'rows', rows: [msg(1, 150)], more: false },
      generations: { kind: 'rows', rows: [gen(1, 1, 100), gen(1, 2, 300), gen(2, 1, 400, { live: true, sessionId: 'lane-b-overlord' }), gen(2, 2, 500)] },
    }));
    expect(shape(t.entries)).toEqual(['d1.1', 'm1', 'd1.2', 'd2.1*+', 'd2.2']);
  });

  it('every divider is not-pageable when pageable is false; a non-live one is readable when it is true, the live one never', () => {
    const rows = [gen(1, 1, 100), gen(1, 2, 200, { live: true })];
    const off = composeChat(facts({ generations: { kind: 'rows', rows } }));
    expect(off.entries.map((e) => e.kind === 'divider' && e.earlier)).toEqual(['not-pageable', 'not-pageable']);
    const on = composeChat(facts({ generations: { kind: 'rows', rows }, pageable: true }));
    expect(on.entries.map((e) => e.kind === 'divider' && e.earlier)).toEqual(['readable', 'not-pageable']);
  });

  it('unreadable messages give no message entries and messages unmeasured, never an empty read', () => {
    const t = composeChat(facts({ messages: { kind: 'unmeasured', why: 'closed' }, generations: { kind: 'rows', rows: [gen(1, 1, 100)] } }));
    expect(shape(t.entries)).toEqual(['d1.1']);
    expect(t.messages).toEqual({ kind: 'unmeasured', why: 'closed' });
  });

  it('unreadable generations give no dividers and generations unmeasured, never a count', () => {
    const t = composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 150)], more: true }, generations: { kind: 'unmeasured', why: 'x' } }));
    expect(shape(t.entries)).toEqual(['m1']);
    expect([t.generations, t.messages]).toEqual([{ kind: 'unmeasured', why: 'x' }, { kind: 'read', value: { more: true } }]);
  });

  it('an unreadable readiness history draws the not-on-record line under every message, never ready', () => {
    const t = composeChat(facts({ messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 250)], more: false }, readiness: { kind: 'unmeasured', why: 'y' } }));
    expect(shape(t.entries)).toEqual([`m1`, `s1:${NOT_ON_RECORD}`, 'm2', `s2:${NOT_ON_RECORD}`]);
    expect(t.readiness).toEqual({ kind: 'unmeasured', why: 'y' });
  });

  it('no designation is designation none and no entries, whatever the other facts', () => {
    const t = composeChat(facts({ designation: { kind: 'none' }, messages: { kind: 'rows', rows: [msg(1, 1)], more: false } }));
    expect([t.designation, t.sessionId, t.term, t.entries]).toEqual(['none', null, null, []]);
  });

  it('what it composes, readChatThread reads back unchanged', () => {
    const t = composeChat(facts({
      messages: { kind: 'rows', rows: [msg(1, 150), msg(2, 250, { state: 'settled', settledAt: 250, settledBy: 'mark', queuedAt: null })], more: true },
      generations: { kind: 'rows', rows: [gen(1, 1, 100, { live: true })] },
      readiness: { kind: 'rows', rows: [{ at: 0, word: 'renewing' }], oldest: 0 },
    }));
    const back = readChatThread(JSON.parse(JSON.stringify(t)));
    expect(back).toEqual({ ok: true, thread: t, skipped: 0 });
  });
});

describe('earlierPagePlan', () => {
  it('the live generation refuses current; no row refuses no-generation; pageable false refuses not-pageable', () => {
    expect(earlierPagePlan(gen(1, 2, 200, { live: true }), null, true)).toEqual({ kind: 'refuse', why: 'current' });
    expect(earlierPagePlan(null, null, true)).toEqual({ kind: 'refuse', why: 'no-generation' });
    expect(earlierPagePlan(gen(1, 1, 100), null, false)).toEqual({ kind: 'refuse', why: 'not-pageable' });
  });

  it('a first page expands the conversation; an older page is expand --around <uuid> --before 40 --after 0; each passes the request reader', () => {
    const g = gen(1, 1, 100);
    const first = earlierPagePlan(g, null, true);
    const around = 'a1a1a1a1-0000-4000-8000-000000000006';
    const older = earlierPagePlan(g, around, true);
    expect(first).toEqual({ kind: 'request', request: { verb: 'expand', target: { kind: 'session', session: 'lane-a-overlord' }, agents: false, args: [g.conversation] } });
    expect(older).toEqual({ kind: 'request', request: { verb: 'expand', target: { kind: 'session', session: 'lane-a-overlord' }, agents: false, args: ['--around', around, '--before', String(EARLIER_PAGE_BEFORE), '--after', '0'] } });
    expect(EARLIER_PAGE_BEFORE).toBe(40);
    for (const p of [first, older]) if (p.kind === 'request') expect(readOverlordHistoryRequest(p.request)).toEqual({ ok: true, request: p.request });
  });

  it('the target is the row\'s own session: a generation run by a rebound body\'s old session names that old session', () => {
    const old = gen(1, 1, 100, { sessionId: 'lane-a-overlord' });
    const p = earlierPagePlan(old, 'a1a1a1a1-0000-4000-8000-000000000006', true);
    expect(p.kind === 'request' && p.request.target).toEqual({ kind: 'session', session: 'lane-a-overlord' });
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
