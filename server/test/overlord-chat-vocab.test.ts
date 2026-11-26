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

describe('chatTicksOf: each tick by its own stamp, or by the state being that tick\'s', () => {
  const lit = (r: OperatorMessageRow): string[] => {
    const t = chatTicksOf(r);
    return TICK_STAGES.filter((s) => t.lit[s]);
  };

  it('recorded lights recorded alone', () => {
    expect(lit(row())).toEqual(['recorded']);
    expect(chatTicksOf(row()).delivery).toBeNull();
  });

  it('queued lights recorded and delivery, as queued', () => {
    const r = row({ state: 'queued', queuedAt: 1_100 });
    expect(lit(r)).toEqual(['recorded', 'delivery']);
    expect(chatTicksOf(r).delivery).toBe('queued');
  });

  it('delivered lights recorded and delivery, as delivered', () => {
    const r = row({ state: 'delivered', queuedAt: 1_100, deliveredAt: 1_200 });
    expect(lit(r)).toEqual(['recorded', 'delivery']);
    expect(chatTicksOf(r).delivery).toBe('delivered');
  });

  it('picked up with no deliveredAt (the hook beat the lane) lights recorded and picked-up, delivery null', () => {
    const r = row({ state: 'picked-up', queuedAt: 1_100, pickedUpAt: 1_300 });
    expect(lit(r)).toEqual(['recorded', 'picked-up']);
    expect(chatTicksOf(r).delivery).toBeNull();
  });

  it('a whole walk lights every tick', () => {
    const r = row({ state: 'settled', queuedAt: 1_100, deliveredAt: 1_200, pickedUpAt: 1_300, settledAt: 1_400, settledBy: 'acknowledge' });
    expect(lit(r)).toEqual(['recorded', 'delivery', 'picked-up', 'settled']);
    expect(chatTicksOf(r)).toMatchObject({ delivery: 'delivered', settledBy: 'acknowledge', unknown: false });
  });

  it('a row settled by the mark before any delivery lights recorded and settled only, settledBy mark', () => {
    const r = row({ state: 'settled', settledAt: 1_000, settledBy: 'mark' });
    expect(lit(r)).toEqual(['recorded', 'settled']);
    expect(chatTicksOf(r)).toMatchObject({ delivery: null, settledBy: 'mark' });
  });

  it('spent reaches settled', () => {
    expect(lit(row({ state: 'spent', spentAt: 1_500 }))).toEqual(['recorded', 'settled']);
  });

  it('a state this build cannot read lights recorded only and says unknown, whatever its stamps', () => {
    const r = row({ state: 'unknown', queuedAt: 1_100, deliveredAt: 1_200, pickedUpAt: 1_300, settledAt: 1_400, settledBy: 'cite' });
    expect(lit(r)).toEqual(['recorded']);
    expect(chatTicksOf(r)).toMatchObject({ unknown: true, delivery: null });
  });
});

describe('the nudge line has one grammar: operatorMessageNudgeIdOf reads what the mail lane types', () => {
  it('the renderer is the L0 line', () => {
    for (const n of [1, 12, 2 ** 53 - 1]) expect(renderOperatorMessageNudge(n)).toBe(operatorMessageNudgeLine(n));
  });

  it('reads the id of the line for ids 1, 12 and the largest safe integer, and with one trailing newline', () => {
    expect(operatorMessageNudgeIdOf(renderOperatorMessageNudge(12))).toBe(12);
    expect(operatorMessageNudgeIdOf(renderOperatorMessageNudge(1))).toBe(1);
    expect(operatorMessageNudgeIdOf(renderOperatorMessageNudge(2 ** 53 - 1))).toBe(2 ** 53 - 1);
    expect(operatorMessageNudgeIdOf(`${renderOperatorMessageNudge(5)}\n`)).toBe(5);
  });

  it('round trip over a spread of ids', () => {
    for (const n of [1, 2, 9, 10, 99, 100, 4_096, 65_535, 1_000_000, 2 ** 31, 2 ** 40 + 3, 2 ** 53 - 2]) {
      expect(operatorMessageNudgeIdOf(renderOperatorMessageNudge(n)), String(n)).toBe(n);
    }
  });

  it('null for every near miss', () => {
    const line = renderOperatorMessageNudge(12);
    const nears = [
      renderMailNudge('lane-a-overlord'), renderInboxWakeLine({ ok: false }, 0),
      `${line} now`, ` ${line}`, `${line}\n\n`, `${line} `, line.replace('12', '0'), line.replace('12', '-12'), line.replace('12', '+12'),
      line.replace('12', '12.5'), line.replace('12', '012'), line.replace('12', '9007199254740993'),
      line.replace('Operator message', 'operator message'), 'Operator message 12: read it with your messages door.', '',
    ];
    for (const t of nears) expect(operatorMessageNudgeIdOf(t), JSON.stringify(t)).toBeNull();
  });
});

describe('readChatThread', () => {
  const thread = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    v: 1, designation: 'designated', sessionId: 'lane-a-overlord', term: 1,
    entries: [
      { kind: 'divider', gen: { term: 1, n: 1 }, at: 900, current: true, newTerm: false, earlier: 'not-pageable' },
      { kind: 'message', row: row(), ticks: chatTicksOf(row()) },
      { kind: 'server-line', messageId: 7, text: CHAT_SERVER_LINE_MAP.renewing, word: 'renewing' },
    ],
    messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 1 } },
    readiness: { kind: 'read', value: { oldest: 100 } }, ...over,
  });

  it('reads a thread back, the ticks derived from the row', () => {
    const r = readChatThread(thread());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toBe(0);
    expect(r.thread.entries.map((e) => e.kind)).toEqual(['divider', 'message', 'server-line']);
    expect(r.thread.entries[1]).toEqual({ kind: 'message', row: row(), ticks: chatTicksOf(row()) });
  });

  it('a row from a server below the chat (no offRecord) reads offRecord false; an unknown state reads unknown', () => {
    const { offRecord: _drop, ...old } = row({ state: 'queued' as const });
    const r = readChatThread(thread({ entries: [{ kind: 'message', row: { ...old, state: 'newer-state' } }] }));
    expect(r.ok && r.thread.entries[0]).toMatchObject({ kind: 'message', row: { offRecord: false, state: 'unknown' } });
  });

  it('skips and counts an entry of an unknown kind, and a server line of an unknown word; ignores an unknown key', () => {
    const r = readChatThread(thread({
      extra: 'ignored',
      entries: [{ kind: 'reply', id: 3 }, { kind: 'server-line', messageId: 7, text: 'Recorded.', word: 'newer-word' }, { kind: 'message', row: row() }],
    }));
    expect(r.ok && [r.skipped, r.thread.entries.length]).toEqual([2, 1]);
  });

  it('refuses a missing v, a part of neither kind, a malformed known entry, and a designated thread with no term', () => {
    const { v: _v, ...noV } = thread();
    expect(readChatThread(noV).ok).toBe(false);
    expect(readChatThread(thread({ messages: { kind: 'empty' } })).ok).toBe(false);
    expect(readChatThread(thread({ readiness: { kind: 'read', value: { oldest: 'x' } } })).ok).toBe(false);
    expect(readChatThread(thread({ entries: [{ kind: 'message', row: { id: 1 } }] })).ok).toBe(false);
    expect(readChatThread(thread({ entries: [{ kind: 'divider', gen: { term: 0, n: 1 }, at: 1, current: false, newTerm: false, earlier: 'readable' }] })).ok).toBe(false);
    expect(readChatThread(thread({ term: null })).ok).toBe(false);
    expect(readChatThread('x').ok).toBe(false);
  });

  it('reads an unmeasured part with its why, and a none thread', () => {
    const r = readChatThread(thread({ messages: { kind: 'unmeasured', why: 'closed' }, entries: [] }));
    expect(r.ok && r.thread.messages).toEqual({ kind: 'unmeasured', why: 'closed' });
    const none = readChatThread(thread({ designation: 'none', sessionId: null, term: null, entries: [] }));
    expect(none.ok && none.thread.designation).toBe('none');
  });
});

describe('the two doors\' queries', () => {
  it('readChatThreadQuery: before absent or a positive whole number; any other key refused', () => {
    expect(readChatThreadQuery(undefined)).toEqual({ ok: true, before: null });
    expect(readChatThreadQuery({})).toEqual({ ok: true, before: null });
    expect(readChatThreadQuery({ before: '42' })).toEqual({ ok: true, before: 42 });
    for (const before of ['0', '-1', '1.5', '01', '', 'x', '9007199254740993']) expect(readChatThreadQuery({ before }).ok, before).toBe(false);
    expect(readChatThreadQuery({ before: '1', limit: '5' }).ok).toBe(false);
  });

  it('readChatEarlierQuery: term and n positive safe integers; around absent or a uuid; any other key, a target above all, refused', () => {
    const U = 'a1a1a1a1-0000-4000-8000-000000000006';
    expect(readChatEarlierQuery({ term: '1', n: '2' })).toEqual({ ok: true, req: { gen: { term: 1, n: 2 }, around: null } });
    expect(readChatEarlierQuery({ term: '2', n: '1', around: U })).toEqual({ ok: true, req: { gen: { term: 2, n: 1 }, around: U } });
    for (const q of [{ term: '0', n: '1' }, { term: '1', n: '0' }, { term: '1' }, { n: '1' }, { term: '1.0', n: '1' }, { term: '1', n: '1', around: 'x' },
      { term: '1', n: '1', around: U.toUpperCase() }, { term: '1', n: '1', target: 'lane-b-overlord' }, { term: '1', n: '1', session: 'x' }, 'term=1']) {
      expect(readChatEarlierQuery(q).ok, JSON.stringify(q)).toBe(false);
    }
  });
});

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

describe('readChatSendAnswer: the prompt route\'s answer as the chat reads it', () => {
  it('200 with a messageId is recorded, with replay, cut and the offRecord echo', () => {
    expect(readChatSendAnswer(200, { ok: true, messageId: 9, cut: false, state: 'queued', replay: false, offRecord: true }))
      .toEqual({ kind: 'recorded', messageId: 9, cut: false, replay: false, offRecord: true });
    expect(readChatSendAnswer(200, { ok: true, messageId: 9, cut: true, state: 'queued', replay: true }))
      .toEqual({ kind: 'recorded', messageId: 9, cut: true, replay: true, offRecord: false });
  });

  it('200 with no messageId (an older server, or the typing path) is off-shape', () => {
    expect(readChatSendAnswer(200, { ok: true })).toEqual({ kind: 'off-shape' });
    expect(readChatSendAnswer(200, { ok: true, messageId: 0 })).toEqual({ kind: 'off-shape' });
  });

  it('each refusal status with an error word is refused, retryAfterS on read-ceiling', () => {
    for (const [status, error] of [[409, 'renewing'], [409, 'stale-designation'], [502, 'unmeasured'], [501, 'auth-off'], [401, 'unauthenticated'],
      [400, 'bad-request'], [503, 'write-failed']] as const) {
      expect(readChatSendAnswer(status, { ok: false, error }), error).toEqual({ kind: 'refused', error });
    }
    expect(readChatSendAnswer(429, { ok: false, error: 'read-ceiling', retryAfterS: 30 })).toEqual({ kind: 'refused', error: 'read-ceiling', retryAfterS: 30 });
  });

  it('a body that is not an object, a refusal with no word, or another status is off-shape', () => {
    expect(readChatSendAnswer(200, 'ok')).toEqual({ kind: 'off-shape' });
    expect(readChatSendAnswer(409, { ok: false })).toEqual({ kind: 'off-shape' });
    expect(readChatSendAnswer(302, { ok: false, error: 'x' })).toEqual({ kind: 'off-shape' });
  });
});
