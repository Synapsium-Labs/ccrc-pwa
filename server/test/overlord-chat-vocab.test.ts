// The Overlord chat's vocabulary (Overlord W1, the chat, Task 1; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`):
// the ticks from the message moves, the server's lines, the nudge line's one grammar, and the readers of the thread, the two
// doors' queries, the earlier page and the prompt route's answer. Pure: no store, no server.
import { describe, it, expect } from 'vitest';
import { MESSAGE_STATES, operatorMessageNudgeIdOf, operatorMessageNudgeLine, type OperatorMessageRow } from '../../shared/operatorMessages.js';
import { READINESS_WORDS } from '../../shared/overlord-readiness.js';
import { renderInboxWakeLine } from '../../shared/overlordInbox.js';
import {
  CHAT_ENTRY_KINDS, CHAT_SERVER_LINE_MAP, CHAT_SERVER_LINE_UNMEASURED, EARLIER_WORDS, MESSAGE_TICK_MAP, NOT_ON_RECORD, TICK_STAGES,
  chatTicksOf, readChatEarlierAnswer, readChatEarlierQuery, readChatSendAnswer, readChatThread, readChatThreadQuery,
} from '../../shared/overlordChat.js';
import { renderMailNudge, renderOperatorMessageNudge } from '../src/coord/envelope.js';
import * as vocabModule from '../../shared/overlordChat.js';
import * as messagesModule from '../../shared/operatorMessages.js';
import { chatTicksCases, nudgeIdCases, readChatEarlierQueryCases, readChatSendAnswerCases, readChatThreadCases } from './sim/chatSets.js';

const run = (cases: Record<string, () => void | Promise<void>>): void => { for (const [name, c] of Object.entries(cases)) it(name, c); };

const row = (over: Partial<OperatorMessageRow> = {}): OperatorMessageRow => ({
  id: 7, at: 1_000, term: 1, state: 'recorded', text: 'fixture message', cut: false, sha256: 'a'.repeat(64),
  queuedAt: null, deliveredAt: null, pickedUpAt: null, settledAt: null, settledBy: null, spentAt: null, offRecord: false, ...over,
});

describe('the lists are their maps', () => {
  it('each list, written out', () => {
    expect(TICK_STAGES).toEqual(['recorded', 'delivery', 'picked-up', 'settled']);
    expect(CHAT_ENTRY_KINDS).toEqual(['message', 'server-line', 'divider']);
    expect(EARLIER_WORDS).toEqual(['readable', 'not-pageable']);
  });

  it('MESSAGE_TICK_MAP has a row for every message state, written out; spent reaches settled', () => {
    expect(Object.keys(MESSAGE_TICK_MAP)).toEqual([...MESSAGE_STATES]);
    expect(MESSAGE_TICK_MAP).toEqual({
      recorded: 'recorded', queued: 'delivery', delivered: 'delivery', 'picked-up': 'picked-up', settled: 'settled', spent: 'settled',
    });
  });

  it('CHAT_SERVER_LINE_MAP has a row for every readiness word: null for ready alone, a line for every other', () => {
    expect(Object.keys(CHAT_SERVER_LINE_MAP).sort()).toEqual([...READINESS_WORDS].sort());
    for (const w of READINESS_WORDS) {
      const line = CHAT_SERVER_LINE_MAP[w];
      if (w === 'ready') expect(line, w).toBeNull();
      else expect(line, w).toMatch(/^Recorded\. \S/);
    }
    expect(CHAT_SERVER_LINE_MAP.renewing).toBe('Recorded. The Overlord is renewing.');
    expect(CHAT_SERVER_LINE_UNMEASURED).toBe("Recorded. The Overlord's state at the time could not be read.");
    expect(CHAT_SERVER_LINE_UNMEASURED, 'the no-row line is not the stored word unmeasured\'s line').not.toBe(CHAT_SERVER_LINE_MAP.unmeasured);
    expect((READINESS_WORDS as readonly string[]).includes(NOT_ON_RECORD), 'not-on-record is no readiness word').toBe(false);
  });
});

describe('chatTicksOf: each tick by its own stamp, or by the state being that tick\'s (sim/chatSets.ts)', () => run(chatTicksCases(vocabModule)));

describe('the nudge line has one grammar: operatorMessageNudgeIdOf reads what the mail lane types', () => {
  it('the renderer is the L0 line', () => {
    for (const n of [1, 12, 2 ** 53 - 1]) expect(renderOperatorMessageNudge(n)).toBe(operatorMessageNudgeLine(n));
  });

  it('round trip over a spread of ids', () => {
    for (const n of [1, 2, 9, 10, 99, 100, 4_096, 65_535, 1_000_000, 2 ** 31, 2 ** 40 + 3, 2 ** 53 - 2]) {
      expect(operatorMessageNudgeIdOf(renderOperatorMessageNudge(n)), String(n)).toBe(n);
    }
  });

  it('null for the other lines ccrc types', () => {
    expect(operatorMessageNudgeIdOf(renderMailNudge('lane-a-overlord'))).toBeNull();
    expect(operatorMessageNudgeIdOf(renderInboxWakeLine({ ok: false }, 0))).toBeNull();
  });
});
describe('operatorMessageNudgeIdOf (sim/chatSets.ts)', () => run(nudgeIdCases(messagesModule)));

describe('readChatThread (sim/chatSets.ts)', () => run(readChatThreadCases(vocabModule)));

describe('the two doors\' queries', () => {
  it('readChatThreadQuery: before absent or a positive whole number; any other key refused', () => {
    expect(readChatThreadQuery(undefined)).toEqual({ ok: true, before: null });
    expect(readChatThreadQuery({})).toEqual({ ok: true, before: null });
    expect(readChatThreadQuery({ before: '42' })).toEqual({ ok: true, before: 42 });
    for (const before of ['0', '-1', '1.5', '01', '', 'x', '9007199254740993']) expect(readChatThreadQuery({ before }).ok, before).toBe(false);
    expect(readChatThreadQuery({ before: '1', limit: '5' }).ok).toBe(false);
  });

});
describe('readChatEarlierQuery (sim/chatSets.ts)', () => run(readChatEarlierQueryCases(vocabModule)));

describe('readChatEarlierAnswer', () => {
  const page = { outcome: 'rows', exit: 0, items: [{ kind: 'entry', role: 'user', text: 'x', trust: 'untrusted' }], shown: 1, total: 1,
    scope: { kind: 'overlord', id: 'session:lane-a-overlord', project: null, families: [], families_total: 0, transcripts: 1 } };
  it('reads a page through the history answer\'s one reader, and a refusal with its cause', () => {
    expect(readChatEarlierAnswer({ ok: true, gen: { term: 1, n: 1 }, page })).toMatchObject({ ok: true, gen: { term: 1, n: 1 }, page: { outcome: 'rows' } });
    expect(readChatEarlierAnswer({ ok: false, error: 'history-unreachable', cause: 'no-agent' })).toEqual({ ok: false, error: 'history-unreachable', cause: 'no-agent' });
    expect(readChatEarlierAnswer({ ok: false, error: 'bad-request', detail: 'not-pageable' })).toEqual({ ok: false, error: 'bad-request', detail: 'not-pageable' });
  });
  it('off-shape for an item that is not untrusted, a missing gen, or no error word', () => {
    expect(readChatEarlierAnswer({ ok: true, gen: { term: 1, n: 1 }, page: { ...page, items: [{ role: 'user' }] } })).toBe('off-shape');
    expect(readChatEarlierAnswer({ ok: true, page })).toBe('off-shape');
    expect(readChatEarlierAnswer({ ok: false })).toBe('off-shape');
    expect(readChatEarlierAnswer(null)).toBe('off-shape');
  });
});

describe('readChatSendAnswer: the prompt route\'s answer as the chat reads it (sim/chatSets.ts)', () => run(readChatSendAnswerCases(vocabModule)));
