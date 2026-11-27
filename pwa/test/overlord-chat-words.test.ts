// The Overlord chat's console words (Overlord W1, the chat, Task 1; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`,
// questions 5, 6 and 13): the kept draft, what a transcript user turn is, the record placed in the live transcript, and an earlier
// page's items. The live rows are built by today's `buildChatItems`, so the merge reads what the session view reads.
import { describe, it, expect } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { INJECTED_PROMPTS, INJECTED_PROMPT_KEYS } from '../../shared/injected-prompts.mjs';
import { operatorMessageNudgeLine, type OperatorMessageRow } from '../../shared/operatorMessages';
import { chatTicksOf, type ChatEntry, type ChatSendAnswer } from '../../shared/overlordChat';
import { buildChatItems } from '../src/session/chatItems';
import type { SessionStreamMsg } from '../../shared/api';
import { CHAT_PAGE_ROWS, type ChatThread } from '../../shared/overlordChat';
import {
  CHAT_READ_EVERY_MS, NOBODY_TO_SEND_WORDS, OLDER_MESSAGES_WORDS, PANE_TURN_WORDS, PICK_UP_READ_LATER_MS, PICK_UP_WAIT_MS,
  THREAD_NO_ANSWER_WORDS, THREAD_OFF_SHAPE_WORDS, READ_CEILING_WORDS, ccrcLineWords, chatReadTrigger, dividerWords, draftAfterSend,
  earlierPageOf, earlierWords, historyItemsToChat, mergeLive, nextReadAt, pickUpReadEvery, sendNotice, threadTroubleWords,
  tickWords, turnOrigin, type ChatRow,
} from '../src/overlord/chatWords';

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const iso = (s: number): string => new Date(T0 + s * 1000).toISOString();
const row = (id: number, s: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow => ({
  id, at: T0 + s * 1000, term: 1, state: 'queued', text: `fixture message ${id}`, cut: false, sha256: 'a'.repeat(64),
  queuedAt: T0 + s * 1000, deliveredAt: null, pickedUpAt: null, settledAt: null, settledBy: null, spentAt: null, offRecord: false, ...over,
});
const message = (r: OperatorMessageRow): ChatEntry => ({ kind: 'message', row: r, ticks: chatTicksOf(r) });
const divider = (term: number, n: number, s: number, current = false, newTerm = false): ChatEntry =>
  ({ kind: 'divider', gen: { term, n }, at: T0 + s * 1000, current, newTerm, earlier: 'not-pageable' });
const user = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'user', uuid, ts: iso(s), text });
const assistant = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: iso(s), text });
/** The rows' shape, less the live time labels `buildChatItems` adds after a quiet gap (a live row like any other). */
const shape = (rows: readonly ChatRow[]): string[] => rows.filter((r) => !(r.kind === 'live' && r.item.kind === 'divider')).map((r) => {
  if (r.kind === 'entry') return r.entry.kind === 'message' ? `m${r.entry.row.id}` : r.entry.kind === 'server-line' ? `s${r.entry.messageId}` : `d${r.entry.gen.n}`;
  if (r.kind === 'live') return `live:${r.item.kind}`;
  if (r.kind === 'message-link') return `link${r.id}`;
  return r.kind;
});

describe('draftAfterSend: clear only for recorded', () => {
  it('clear for recorded, with and without replay and cut', () => {
    for (const replay of [false, true]) for (const cut of [false, true]) {
      expect(draftAfterSend({ kind: 'recorded', messageId: 3, cut, replay, offRecord: false })).toBe('clear');
    }
  });
  it('keep for every refusal word, off-shape and no answer', () => {
    for (const error of ['renewing', 'stale-designation', 'unmeasured', 'auth-off', 'unauthenticated', 'insecure-origin', 'bad-request',
      'journal-unreadable', 'journal-unwritable', 'write-failed', 'read-ceiling']) {
      expect(draftAfterSend({ kind: 'refused', error }), error).toBe('keep');
    }
    expect(draftAfterSend({ kind: 'off-shape' })).toBe('keep');
    expect(draftAfterSend({ kind: 'no-answer' })).toBe('keep');
  });
});

describe('turnOrigin: what a transcript user turn is', () => {
  it('a nudge line answers nudge with its id', () => {
    expect(turnOrigin(operatorMessageNudgeLine(12))).toEqual({ kind: 'nudge', id: 12 });
  });
  it('each injected prompt answers ccrc with its name', () => {
    for (const key of INJECTED_PROMPT_KEYS) expect(turnOrigin(INJECTED_PROMPTS[key].text), key).toEqual({ kind: 'ccrc', name: key });
  });
  it('any other text, a near miss of a nudge line included, answers pane', () => {
    for (const t of ['please stop', `${operatorMessageNudgeLine(12)} and also this`, ` ${operatorMessageNudgeLine(12)}`,
      'Operator message 12: read it with your messages door.', '']) {
      expect(turnOrigin(t), JSON.stringify(t)).toEqual({ kind: 'pane' });
    }
  });
  it('a near miss by one character at either end is pane text, never the nudge and never ccrc\'s', () => {
    const line = operatorMessageNudgeLine(12);
    const flip = (c: string): string => (c === 'x' ? 'y' : 'x');
    for (const t of [flip(line[0]!) + line.slice(1), line.slice(0, -1) + flip(line.at(-1)!), line.slice(1), line.slice(0, -1), `x${line}`, `${line}x`]) {
      expect(turnOrigin(t), JSON.stringify(t)).toEqual({ kind: 'pane' });
    }
  });
});

describe('mergeLive: the record placed in the live transcript', () => {
  it('a message whose nudge is live sits at the nudge\'s place, with its server line; the nudge itself is never drawn', () => {
    const thread = [divider(1, 1, 0, true), message(row(5, 10)), { kind: 'server-line', messageId: 5, text: 'Recorded. The Overlord is renewing.', word: 'renewing' } as ChatEntry];
    const live = buildChatItems([assistant('a1', 5, 'earlier answer'), user('u1', 30, operatorMessageNudgeLine(5)), assistant('a2', 31, 'reply')], []);
    expect(shape(mergeLive(thread, live))).toEqual(['d1', 'live:message', 'm5', 's5', 'live:message']);
  });

  it('a queued message with no live nudge sits by time: after the newest live row at or before it, or before every row', () => {
    const thread = [divider(1, 1, 0, true), message(row(5, 3)), message(row(6, 20))];
    const live = buildChatItems([assistant('a1', 5, 'one'), assistant('a2', 10, 'two'), assistant('a3', 40, 'three')], []);
    expect(shape(mergeLive(thread, live))).toEqual(['d1', 'm5', 'live:message', 'live:message', 'm6', 'live:message']);
  });

  it('no id is drawn twice, whatever both sources say', () => {
    const thread = [message(row(5, 3))];
    const live = buildChatItems([user('u1', 10, operatorMessageNudgeLine(5)), user('u2', 20, operatorMessageNudgeLine(5))], []);
    expect(shape(mergeLive(thread, live))).toEqual(['m5']);
  });

  it('a nudge for an id outside the page draws the link row', () => {
    const live = buildChatItems([user('u1', 10, operatorMessageNudgeLine(99))], []);
    expect(shape(mergeLive([message(row(5, 3))], live))).toEqual(['m5', 'link99']);
  });

  it('a ccrc prompt is a quiet line; pane text is a pane turn, never an operator bubble', () => {
    const live = buildChatItems([user('u1', 10, INJECTED_PROMPTS.clear.text), user('u2', 11, 'do the thing now')], []);
    const rows = mergeLive([], live).filter((r) => !(r.kind === 'live' && r.item.kind === 'divider'));
    expect(rows).toEqual([
      { kind: 'ccrc-line', key: expect.any(String), name: 'clear' },
      { kind: 'pane-turn', key: expect.any(String), text: 'do the thing now' },
    ]);
    expect(rows.some((r) => r.kind === 'live' && r.item.kind === 'message' && r.item.event.kind === 'user')).toBe(false);
  });

  it('no live user turn of any kind is passed through as a live row', () => {
    const live = buildChatItems([user('u1', 1, operatorMessageNudgeLine(3)), user('u2', 2, `${INJECTED_PROMPTS['mail-nudge'].text} x`), user('u3', 3, 'typed')], []);
    const rows = mergeLive([], live);
    expect(rows.filter((r) => r.kind === 'live' && r.item.kind !== 'divider')).toEqual([]);
    expect(shape(rows)).toEqual(['link3', 'ccrc-line', 'pane-turn']);
  });
});

describe('historyItemsToChat: an earlier page\'s items', () => {
  it('an assistant item is its text; a user nudge is the link; pane text is a pane turn; an item with no role is one untrusted block', () => {
    const rows = historyItemsToChat([
      { kind: 'entry', uuid: 'e1', role: 'assistant', text: 'Fixture answer.', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e2', role: 'user', text: operatorMessageNudgeLine(4), trust: 'untrusted' },
      { kind: 'entry', uuid: 'e3', role: 'user', text: 'typed in the pane', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e4', trust: 'untrusted', outline: 'x' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['history-text', 'message-link', 'pane-turn', 'untrusted-block']);
    expect(rows[1]).toEqual({ kind: 'message-link', key: 'h-e2', id: 4 });
    expect(rows[3]!.kind === 'untrusted-block' && rows[3]!.text).toContain('outline');
  });
});

describe('the words', () => {
  it('ticks, dividers, the earlier offer and the ccrc line', () => {
    expect(tickWords(chatTicksOf(row(1, 0, { state: 'picked-up', deliveredAt: T0, pickedUpAt: T0 })))).toBe('recorded, delivered, picked up');
    expect(tickWords(chatTicksOf(row(1, 0)))).toBe('recorded, queued');
    const d = divider(2, 1, 0, false, true);
    expect(d.kind === 'divider' && [dividerWords(d), earlierWords(d)]).toEqual(['term 2, generation 1', 'Read generation 1 in ccrc history']);
    const live = divider(1, 3, 0, true);
    expect(live.kind === 'divider' && [dividerWords(live), earlierWords(live)]).toEqual(['generation 3', null]);
    expect(ccrcLineWords('mail-nudge')).toBe('ccrc: mail nudge');
    expect(PANE_TURN_WORDS).toBe("Typed in the Overlord's pane, not from the console");
  });

  it('the send notices: a toggled send with no echo, a moved designation, off-shape and no answer', () => {
    const rec = (offRecord: boolean): ChatSendAnswer => ({ kind: 'recorded', messageId: 1, cut: false, replay: false, offRecord });
    expect(sendNotice(rec(false), true)).toBe('Recorded on the record: this server does not know the toggle');
    expect(sendNotice(rec(true), true)).toBeNull();
    expect(sendNotice(rec(false), false)).toBeNull();
    expect(sendNotice({ kind: 'refused', error: 'stale-designation' }, false)).toBe('The Overlord changed. Your message was not sent; send it again.');
    expect(sendNotice({ kind: 'refused', error: 'renewing' }, false)).toBeNull();
    expect(sendNotice({ kind: 'off-shape' }, false)).toMatch(/did not record/);
    expect(sendNotice({ kind: 'no-answer' }, false)).toMatch(/kept/);
  });
});

describe('the replay notice (review F3): a retry\'s answer is the first record\'s fact', () => {
  it('a replay whose first record went the other way says the first record stands, never that the server does not know the toggle', () => {
    const replay = (offRecord: boolean): ChatSendAnswer => ({ kind: 'recorded', messageId: 1, cut: false, replay: true, offRecord });
    expect(sendNotice(replay(false), true)).toBe('This message was already recorded on the record; the first record stands.');
    expect(sendNotice(replay(true), false)).toBe('This message was already recorded off the record; the first record stands.');
    expect(sendNotice(replay(true), true)).toBeNull();
    expect(sendNotice(replay(false), false)).toBeNull();
  });
});

// ── the refresh's deciders, directly (review F11) ──────────────────────────────────────────────────────────────────────

describe('chatReadTrigger: the allow-list of frames that ask for a read', () => {
  const events = (...kinds: ('user' | 'assistant')[]): SessionStreamMsg =>
    ({ type: 'events', uuid: 'u', offset: 0, events: kinds.map((k, i) => (k === 'user' ? user(`u${i}`, i, 'x') : assistant(`a${i}`, i, 'x'))) });
  const status = (st: 'idle' | 'busy'): SessionStreamMsg => ({ type: 'status', status: st, statusUpdatedAt: null });
  it('an events frame asks only when it holds a user turn', () => {
    expect(chatReadTrigger(events('user'), null)).toBe(true);
    expect(chatReadTrigger(events('assistant', 'user'), 'busy')).toBe(true);
    expect(chatReadTrigger(events('assistant'), 'busy')).toBe(false);
    expect(chatReadTrigger(events(), 'busy')).toBe(false);
  });
  it('a status frame asks only at a turn\'s end: idle after busy, never idle after idle or before any status, never busy', () => {
    expect(chatReadTrigger(status('idle'), 'busy')).toBe(true);
    expect(chatReadTrigger(status('idle'), 'idle')).toBe(false);
    expect(chatReadTrigger(status('idle'), null)).toBe(false);
    expect(chatReadTrigger(status('busy'), 'idle')).toBe(false);
  });
  it('a beat never asks', () => {
    expect(chatReadTrigger({ type: 'beat', at: 1 }, 'busy')).toBe(false);
  });
});

describe('nextReadAt: the coalescer\'s spacing and the ceiling\'s wait', () => {
  it('no read yet reads now; after a read, not before the spacing; a ceiling\'s wait wins when it is later; a wider spacing is honoured', () => {
    expect(nextReadAt(null, T0, 0)).toBe(T0);
    expect(nextReadAt(T0, T0 + 1_000, 0)).toBe(T0 + CHAT_READ_EVERY_MS);
    expect(nextReadAt(T0, T0 + 20_000, 0)).toBe(T0 + 20_000);
    expect(nextReadAt(T0, T0 + 1_000, T0 + 60_000)).toBe(T0 + 60_000);
    expect(nextReadAt(null, T0, T0 + 5_000)).toBe(T0 + 5_000);
    expect(nextReadAt(T0, T0 + 1_000, 0, 30_000)).toBe(T0 + 30_000);
  });
});

describe('pickUpReadEvery: the timer reads only for a young message waiting for its pick-up (review F1)', () => {
  const t = (...rows: OperatorMessageRow[]): ChatThread => ({
    v: 1, designation: 'designated', sessionId: 'lane-a-overlord', term: 1, entries: rows.map(message),
    messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 1 } }, readiness: { kind: 'read', value: { oldest: null } },
  });
  const now = T0 + 1_000_000;
  const aged = (id: number, ageMs: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow =>
    ({ ...row(id, 0, over), at: now - ageMs });
  it('the bound: awaited at its first minute (every 10 s), later (every 30 s) until ten minutes, then never', () => {
    expect(PICK_UP_WAIT_MS).toBe(600_000);
    expect(pickUpReadEvery(t(aged(1, 5_000)), now)).toBe(CHAT_READ_EVERY_MS);
    expect(pickUpReadEvery(t(aged(1, 59_999)), now)).toBe(CHAT_READ_EVERY_MS);
    expect(pickUpReadEvery(t(aged(1, 60_000)), now)).toBe(PICK_UP_READ_LATER_MS);
    expect(pickUpReadEvery(t(aged(1, PICK_UP_WAIT_MS - 1)), now)).toBe(PICK_UP_READ_LATER_MS);
    expect(pickUpReadEvery(t(aged(1, PICK_UP_WAIT_MS)), now)).toBeNull();
    expect(pickUpReadEvery(t(aged(1, 3_600_000)), now)).toBeNull();
  });
  it('a row whose state this build cannot read is never awaited, nor one picked up or settled', () => {
    expect(pickUpReadEvery(t(aged(1, 5_000, { state: 'unknown' as never })), now)).toBeNull();
    expect(pickUpReadEvery(t(aged(1, 5_000, { state: 'picked-up', deliveredAt: T0, pickedUpAt: T0 })), now)).toBeNull();
    expect(pickUpReadEvery(t(aged(1, 5_000, { state: 'settled', deliveredAt: T0, pickedUpAt: T0, settledAt: T0, settledBy: 'acknowledge' })), now)).toBeNull();
    expect(pickUpReadEvery(t(), now)).toBeNull();
  });
  it('two messages of different ages: the younger decides, and an old one alone reads nothing', () => {
    expect(pickUpReadEvery(t(aged(1, 300_000), aged(2, 5_000)), now)).toBe(CHAT_READ_EVERY_MS);
    expect(pickUpReadEvery(t(aged(1, 5_000), aged(2, 300_000)), now)).toBe(CHAT_READ_EVERY_MS);
    expect(pickUpReadEvery(t(aged(1, 900_000), aged(2, 300_000)), now)).toBe(PICK_UP_READ_LATER_MS);
    expect(pickUpReadEvery(t(aged(1, 900_000), aged(2, 700_000)), now)).toBeNull();
  });
  // Review 4084's F3: the age is the console's clock against the server's stamp, so a console behind the server sees a new
  // message stamped in its future. That message is young (it is awaited at the fast spacing), never skipped (mutant P7).
  it('a stamp in the console\'s future counts as young: awaited every 10 s, never skipped', () => {
    expect(pickUpReadEvery(t(aged(1, -1)), now)).toBe(CHAT_READ_EVERY_MS);
    expect(pickUpReadEvery(t(aged(1, -3_600_000)), now)).toBe(CHAT_READ_EVERY_MS);
    expect(pickUpReadEvery(t(aged(1, 300_000), aged(2, -5_000)), now)).toBe(CHAT_READ_EVERY_MS);
  });
});

describe('the thread\'s trouble before any read (review F7) and the older messages line (review F2)', () => {
  it('a first read that fails never says "as last read": nothing was read', () => {
    expect(threadTroubleWords({ kind: 'no-answer' }, false)).toBe('No answer from the server; the conversation could not be read yet.');
    expect(threadTroubleWords({ kind: 'off-shape' }, false)).toBe("This server's answer could not be read; the conversation could not be read yet.");
    expect(threadTroubleWords({ kind: 'no-answer' }, true)).toBe(THREAD_NO_ANSWER_WORDS);
    expect(threadTroubleWords({ kind: 'off-shape' }, true)).toBe(THREAD_OFF_SHAPE_WORDS);
    expect(threadTroubleWords({ kind: 'ceiling' }, false)).toBe(READ_CEILING_WORDS);
    expect(threadTroubleWords({ kind: 'refused', words: 'Sign in again.' }, false)).toBe('Sign in again.');
    for (const read of [true, false]) expect(threadTroubleWords({ kind: 'no-answer' }, read)).not.toBe('');
  });
  it('the older messages line names the page\'s bound, in closed words', () => {
    expect(CHAT_PAGE_ROWS).toBe(100);
    expect(OLDER_MESSAGES_WORDS).toBe('Older messages are in the record; this shows the newest 100.');
  });
});

describe('earlierPageOf: what an earlier page answer becomes, and what comes next (review F10)', () => {
  const scope = { kind: 'overlord', id: 'session:lane-a-overlord', project: null, families: [], families_total: 0, transcripts: 1 } as const;
  const item = (uuid: unknown) => ({ kind: 'entry', role: 'assistant', text: 'x', trust: 'untrusted', uuid }) as never;
  const page = (items: unknown[], shown: number, total: number) =>
    ({ ok: true as const, gen: { term: 1, n: 1 }, page: { outcome: 'rows' as const, exit: 0 as const, items: items as never[], shown, total, scope } });
  it('rows with more answer the first item\'s uuid as next; the last page, or a first item with no uuid, answers none', () => {
    expect(earlierPageOf(page([item('u-1'), item('u-2')], 2, 5))).toMatchObject({ kind: 'rows', next: 'u-1' });
    expect(earlierPageOf(page([item('u-1')], 1, 1))).toMatchObject({ kind: 'rows', next: null });
    expect(earlierPageOf(page([item(7)], 1, 3))).toMatchObject({ kind: 'rows', next: null });
    expect(earlierPageOf(page([], 0, 3))).toMatchObject({ kind: 'rows', next: null });
  });
  it('every other answer is unreachable with its cause', () => {
    expect(earlierPageOf('no-answer')).toEqual({ kind: 'unreachable', cause: 'no-answer' });
    expect(earlierPageOf('off-shape')).toEqual({ kind: 'unreachable', cause: 'off-shape' });
    expect(earlierPageOf({ ok: false, error: 'history-unreachable', cause: 'no-agent' })).toEqual({ kind: 'unreachable', cause: 'no-agent' });
    expect(earlierPageOf({ ok: false, error: 'bad-request', detail: 'not-pageable' })).toEqual({ kind: 'unreachable', cause: 'not-pageable' });
    expect(earlierPageOf({ ok: false, error: 'read-ceiling' })).toEqual({ kind: 'unreachable', cause: 'read-ceiling' });
    expect(earlierPageOf({ ok: true, gen: { term: 1, n: 1 }, page: { outcome: 'busy' } })).toEqual({ kind: 'unreachable', cause: 'busy' });
  });
  it('the send with no Overlord says so in the words module', () => {
    expect(NOBODY_TO_SEND_WORDS).toBe('No Overlord is started, so there is nobody to send to.');
  });
});
