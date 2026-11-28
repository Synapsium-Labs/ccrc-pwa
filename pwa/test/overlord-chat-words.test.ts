// The Overlord chat's console words (Overlord W1, the chat, Task 1; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`,
// questions 5, 6 and 13): the kept draft, what a transcript user turn is, the record placed in the live transcript, and an earlier
// page's items. The live rows are built by today's `buildChatItems`, so the merge reads what the session view reads.
import { describe, it, expect } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { INJECTED_PROMPTS, INJECTED_PROMPT_KEYS } from '../../shared/injected-prompts.mjs';
import { operatorMessageNudgeLine, type OperatorMessageRow, type OverlordReplyRow } from '../../shared/operatorMessages';
import { chatTicksOf, type ChatEntry, type ChatSendAnswer } from '../../shared/overlordChat';
import { buildChatItems } from '../src/session/chatItems';
import type { SessionStreamMsg } from '../../shared/api';
import { CHAT_PAGE_ROWS, type ChatOlder, type ChatThread, type ReplyResponse } from '../../shared/overlordChat';
import { READ_CEILING_WINDOW_MS } from '../../shared/overlordInbox';
import { RECEIPTS_MAX_PER_BODY } from '../../shared/responses';
import {
  CEILING_WAIT_DEFAULT_MS, CEILING_WAIT_MAX_MS, RECEIPT_SPACING_MS, REPLY_DWELL_MS,
  ceilingNotBefore, foldNewestPage, foldOlderPage, nextReceiptAt, nextReceiptBatch, replyEntriesOf, replyHandledOffer, replyIdsOf,
  replySeenEnough, visibleEntries, type ChatPaged,
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
const reply = (id: number, s: number, over: Partial<OverlordReplyRow> = {}): OverlordReplyRow => ({
  id, at: T0 + s * 1000, turnAt: T0 + s * 1000, term: 1, entryUuid: `e0e0e0e0-0000-4000-8000-${String(id).padStart(12, '0')}`,
  text: `fixture reply ${id}`, cut: false, sha256: 'b'.repeat(64), inReplyTo: null, offRecord: false, ...over,
});
const replyEntry = (r: OverlordReplyRow, response: ReplyResponse = { kind: 'no-row' }): Extract<ChatEntry, { kind: 'reply' }> =>
  ({ kind: 'reply', row: r, response });
const user = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'user', uuid, ts: iso(s), text });
const assistant = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: iso(s), text });
/** The rows' shape, less the live time labels `buildChatItems` adds after a quiet gap (a live row like any other). */
const shape = (rows: readonly ChatRow[]): string[] => rows.filter((r) => !(r.kind === 'live' && r.item.kind === 'divider')).map((r) => {
  if (r.kind === 'entry') {
    return r.entry.kind === 'message' ? `m${r.entry.row.id}` : r.entry.kind === 'server-line' ? `s${r.entry.messageId}`
      : r.entry.kind === 'reply' ? `r${r.entry.row.id}` : `d${r.entry.gen.n}`;
  }
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
    replies: { kind: 'read', value: { more: false } }, older: null,
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

// ── PR B: the recorded replies drawn once ──────────────────────────────────────────────────────────────────────────────────

describe('mergeLive: a recorded reply is drawn once, in its live row\'s place (the coordinator\'s ruling)', () => {
  it('a reply whose entry is a live assistant row takes that row\'s place: one row, none beside it', () => {
    const thread = [divider(1, 1, 0, true), replyEntry(reply(8, 31, { entryUuid: 'a2' }))];
    const live = buildChatItems([assistant('a1', 5, 'one'), assistant('a2', 31, 'two'), assistant('a3', 40, 'three')], []);
    const rows = mergeLive(thread, live);
    // a1 is the same turn's earlier text (no user turn between): the reply is the turn's whole text, so it is not drawn beside it.
    expect(shape(rows)).toEqual(['d1', 'r8', 'live:message']);
    expect(rows.some((r) => r.kind === 'live' && r.item.kind === 'message' && r.item.event.uuid === 'a2'), 'the live copy is not drawn').toBe(false);
  });
  it('the reply is the whole turn\'s text: the turn\'s earlier live assistant text rows are dropped, its tool row and other turns stay', () => {
    const tool = (uuid: string, s: number): ChatEvent => ({ kind: 'tool_use', uuid, ts: iso(s), toolId: `t-${uuid}`, name: 'Bash', input: '{"command":"ls"}' });
    const live = buildChatItems([
      assistant('old', 1, 'text of an earlier turn'), user('u1', 10, 'typed'), assistant('a1', 11, 'first block'), tool('k1', 12),
      assistant('a2', 13, 'second block'), tool('k2', 14), assistant('a3', 15, 'last block'),
    ], []);
    const rows = mergeLive([replyEntry(reply(8, 15, { entryUuid: 'a3' }))], live);
    expect(shape(rows)).toEqual(['live:message', 'pane-turn', 'live:tool', 'live:tool', 'r8']);
    const texts = rows.flatMap((r) => (r.kind === 'live' && r.item.kind === 'message' ? [r.item.event.text] : []));
    expect(texts, 'only the earlier turn text stays').toEqual(['text of an earlier turn']);
  });
  it('the turn starts at the newest user turn before the entry, or at the start of the live list; a turn still streaming is unchanged', () => {
    const a = buildChatItems([assistant('a1', 1, 'one'), assistant('a2', 2, 'two')], []);
    expect(shape(mergeLive([replyEntry(reply(8, 2, { entryUuid: 'a2' }))], a))).toEqual(['r8']);
    const streaming = buildChatItems([user('u1', 1, 'typed'), assistant('a1', 2, 'one'), assistant('a2', 3, 'two')], []);
    expect(shape(mergeLive([], streaming))).toEqual(['pane-turn', 'live:message', 'live:message']);
    const two = buildChatItems([assistant('a1', 1, 'one'), user('u1', 2, 'typed'), assistant('a2', 3, 'two'), assistant('a3', 4, 'three')], []);
    expect(shape(mergeLive([replyEntry(reply(8, 4, { entryUuid: 'a3' }))], two))).toEqual(['live:message', 'pane-turn', 'r8']);
  });
  it('a reply whose entry is not live is placed by time among the live rows, as a message is', () => {
    const thread = [replyEntry(reply(8, 20, { entryUuid: 'gone' })), replyEntry(reply(9, 2, { entryUuid: 'gone-too' }))];
    const live = buildChatItems([assistant('a1', 5, 'one'), assistant('a2', 10, 'two'), assistant('a3', 40, 'three')], []);
    expect(shape(mergeLive(thread, live))).toEqual(['r9', 'live:message', 'live:message', 'r8', 'live:message']);
  });
  it('a reply id is drawn once, whatever both sources say: a repeated entry, and two live rows of one record', () => {
    const live = buildChatItems([assistant('a2', 31, 'first block'), assistant('a2', 31, 'second block'), assistant('a3', 40, 'later')], []);
    const one = replyEntry(reply(8, 31, { entryUuid: 'a2' }));
    expect(shape(mergeLive([one, one], live))).toEqual(['r8', 'live:message']);
    expect(shape(mergeLive([one, one], []))).toEqual(['r8']);
  });
  it('a live user row never takes a reply\'s place, nor an assistant row of another uuid', () => {
    const live = buildChatItems([user('a2', 31, 'typed'), assistant('a9', 32, 'other')], []);
    expect(shape(mergeLive([replyEntry(reply(8, 31, { entryUuid: 'a2' }))], live))).toEqual(['pane-turn', 'r8', 'live:message']);
  });
  it('a reply an earlier page already drew is not drawn again', () => {
    const live = buildChatItems([assistant('a2', 31, 'two')], []);
    expect(shape(mergeLive([replyEntry(reply(8, 31, { entryUuid: 'a2' }))], live, new Set([8])))).toEqual(['live:message']);
    expect(shape(mergeLive([replyEntry(reply(8, 31)), message(row(5, 3))], [], new Set([8])))).toEqual(['m5']);
  });
  it('a reply row carries its entry\'s key and both halves of it, for the part to draw', () => {
    const e = replyEntry(reply(8, 31), { kind: 'row', id: 80, handledAt: null });
    expect(mergeLive([e], [])).toEqual([{ kind: 'entry', key: 'reply-8', entry: e }]);
  });
});

describe('historyItemsToChat: the same rule on an earlier page', () => {
  it('an assistant item whose uuid is a recorded reply\'s entry is that reply, once; another turn\'s text stays', () => {
    const e = replyEntry(reply(8, 31, { entryUuid: 'e2' }), { kind: 'row', id: 80, handledAt: null });
    const rows = historyItemsToChat([
      { kind: 'entry', uuid: 'e0', role: 'assistant', text: 'plain answer', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e1', role: 'user', text: 'typed in the pane', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e2', role: 'assistant', text: 'the recorded one', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e2', role: 'assistant', text: 'its second block', trust: 'untrusted' },
    ], [e]);
    expect(rows).toEqual([{ kind: 'history-text', key: 'h-e0', text: 'plain answer' }, { kind: 'pane-turn', key: 'h-e1', text: 'typed in the pane' },
      { kind: 'entry', key: 'reply-8', entry: e }]);
  });
  it('the turn\'s earlier assistant text items are dropped too, back to the previous user item; an item with no role stays', () => {
    const e = replyEntry(reply(8, 31, { entryUuid: 'e3' }));
    const rows = historyItemsToChat([
      { kind: 'entry', uuid: 'e0', role: 'assistant', text: 'an earlier turn', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e1', role: 'user', text: 'typed in the pane', trust: 'untrusted' },
      { kind: 'entry', uuid: 'e2', role: 'assistant', text: 'first block', trust: 'untrusted' },
      { kind: 'entry', uuid: 'k1', trust: 'untrusted', outline: 'tool' },
      { kind: 'entry', uuid: 'e3', role: 'assistant', text: 'last block', trust: 'untrusted' },
    ], [e]);
    expect(rows.map((r) => r.kind)).toEqual(['history-text', 'pane-turn', 'untrusted-block', 'entry']);
    expect(rows.some((r) => r.kind === 'history-text' && r.text === 'first block')).toBe(false);
  });
  it('a user item is never a reply, whatever its uuid', () => {
    const e = replyEntry(reply(8, 31, { entryUuid: 'e2' }));
    const rows = historyItemsToChat([{ kind: 'entry', uuid: 'e2', role: 'user', text: 'typed in the pane', trust: 'untrusted' }], [e]);
    expect(rows.map((r) => r.kind)).toEqual(['pane-turn']);
  });
  it('replyIdsOf and replyEntriesOf read the reply rows and entries, and nothing else', () => {
    const e = replyEntry(reply(8, 31));
    expect([...replyIdsOf(mergeLive([e, message(row(5, 3))], []))]).toEqual([8]);
    expect(replyEntriesOf([message(row(5, 3)), e, divider(1, 1, 0)])).toEqual([e]);
  });
});

describe('ceilingNotBefore: the read ceiling\'s wait, bounded (review ruling 8)', () => {
  it('a stated wait is honoured: now plus retryAfterS', () => {
    expect(ceilingNotBefore(T0, 60)).toBe(T0 + 60_000);
    expect(ceilingNotBefore(T0, 0)).toBe(T0);
  });
  it('the wait is capped at the ceiling\'s own window, one hour, so a timer never gets a delay past its limit', () => {
    expect(CEILING_WAIT_MAX_MS).toBe(READ_CEILING_WINDOW_MS);
    expect(ceilingNotBefore(T0, 3_600)).toBe(T0 + 3_600_000);
    expect(ceilingNotBefore(T0, 3_601)).toBe(T0 + 3_600_000);
    expect(ceilingNotBefore(T0, 2 ** 31)).toBe(T0 + 3_600_000);
    expect(ceilingNotBefore(T0, Number.MAX_SAFE_INTEGER)).toBe(T0 + 3_600_000);
    expect(ceilingNotBefore(T0, Infinity)).toBe(T0 + CEILING_WAIT_DEFAULT_MS);
  });
  it('a refusal that carries no retry time waits the stated default, never none; so does a time that is no wait', () => {
    expect(CEILING_WAIT_DEFAULT_MS).toBe(60_000);
    expect(ceilingNotBefore(T0, undefined)).toBe(T0 + 60_000);
    expect(ceilingNotBefore(T0, Number.NaN)).toBe(T0 + 60_000);
    expect(ceilingNotBefore(T0, -5)).toBe(T0 + 60_000);
  });
});

describe('paging: the older page prepended, the refresh never dropping it, dividers once (the coordinator\'s ruling 4)', () => {
  const page = (entries: readonly ChatEntry[], older: ChatOlder | null, over: Partial<ChatThread> = {}): ChatThread => ({
    v: 1, designation: 'designated', sessionId: 'lane-a-overlord', term: 1, entries,
    messages: { kind: 'read', value: { more: older !== null } }, generations: { kind: 'read', value: { count: 2 } },
    readiness: { kind: 'read', value: { oldest: null } }, replies: { kind: 'read', value: { more: false } }, older, ...over,
  });
  const ids = (es: readonly ChatEntry[]): string[] => es.map((e) => (e.kind === 'message' ? `m${e.row.id}` : e.kind === 'reply' ? `r${e.row.id}`
    : e.kind === 'server-line' ? `s${e.messageId}` : `d${e.gen.term}.${e.gen.n}`));
  const C = (before: number | 'end', replyBefore: number | 'end'): ChatOlder => ({ before, replyBefore });
  const newest = page([divider(1, 2, 10, true), message(row(5, 50)), replyEntry(reply(6, 55)), message(row(7, 60))], C(5, 6));
  const olderPage = page([divider(1, 1, 0), message(row(1, 20)), message(row(3, 30)), replyEntry(reply(2, 25))], null);

  it('the first read is the page itself, its cursor the page\'s own', () => {
    expect(foldNewestPage(null, newest)).toEqual({ entries: newest.entries, older: C(5, 6), paged: false });
  });
  it('an older page lands before what is drawn, its cursor becomes the next press\'s', () => {
    const d = foldNewestPage(null, newest);
    const o = foldOlderPage(d, page(olderPage.entries, C(1, 'end')))!;
    expect(ids(o.entries)).toEqual(['d1.1', 'm1', 'm3', 'r2', 'd1.2', 'm5', 'r6', 'm7']);
    expect([o.older, o.paged]).toEqual([C(1, 'end'), true]);
  });
  it('the refresh of the newest page keeps every older row, replaces a row it read again, and keeps the rows that fell off its page', () => {
    const d1 = foldOlderPage(foldNewestPage(null, newest), page(olderPage.entries, C(1, 'end')))!;
    const settledFive = message(row(5, 50, { state: 'settled', deliveredAt: T0, pickedUpAt: T0, settledAt: T0, settledBy: 'acknowledge' }));
    const refreshed = page([divider(1, 2, 10, true), settledFive, replyEntry(reply(6, 55)), message(row(7, 60)), message(row(8, 70))], C(5, 6));
    const d2 = foldNewestPage(d1, refreshed);
    expect(ids(d2.entries)).toEqual(['d1.1', 'm1', 'm3', 'r2', 'd1.2', 'm5', 'r6', 'm7', 'm8']);
    expect(d2.entries.find((e) => e.kind === 'message' && e.row.id === 5)).toBe(settledFive);
    expect(d2.older, 'the cursor stays at the oldest page read').toEqual(C(1, 'end'));
    // A row that fell off the newest page (a new message pushed it down) stays drawn between the pages: no gap.
    const shifted = page([divider(1, 2, 10, true), replyEntry(reply(6, 55)), message(row(7, 60)), message(row(8, 70))], C(7, 6));
    expect(ids(foldNewestPage(d1, shifted).entries)).toEqual(['d1.1', 'm1', 'm3', 'r2', 'd1.2', 'm5', 'r6', 'm7', 'm8']);
  });
  it('before any older page is read the refresh is the page itself, and its cursor follows it', () => {
    const d = foldNewestPage(null, newest);
    const next = page([divider(1, 2, 10, true), message(row(7, 60)), message(row(8, 70))], C(7, 6));
    expect(foldNewestPage(d, next)).toEqual({ entries: next.entries, older: C(7, 6), paged: false });
  });
  it('a divider repeated by two pages is drawn once, by (term, n)', () => {
    const d = foldNewestPage(null, newest);
    const repeat = page([divider(1, 2, 10, true), message(row(3, 30))], null);
    const o = foldOlderPage(d, repeat)!;
    expect(ids(o.entries).filter((x) => x === 'd1.2')).toHaveLength(1);
  });
  it('a divider older than the oldest drawn row is not drawn while an older page exists', () => {
    const d: ChatPaged = { entries: [divider(1, 1, 0), message(row(5, 50)), divider(1, 2, 60, true)], older: C(5, 'end'), paged: false };
    expect(ids(visibleEntries(d))).toEqual(['m5', 'd1.2']);
    expect(ids(visibleEntries({ ...d, older: null }))).toEqual(['d1.1', 'm5', 'd1.2']);
    expect(ids(visibleEntries(null))).toEqual([]);
  });
  it('a page that cannot be drawn is no page: messages or replies unmeasured, or no Overlord', () => {
    const d = foldNewestPage(null, newest);
    expect(foldOlderPage(d, page([], null, { messages: { kind: 'unmeasured', why: 'closed' } }))).toBeNull();
    expect(foldOlderPage(d, page([], null, { replies: { kind: 'unmeasured', why: 'closed' } }))).toBeNull();
    expect(foldOlderPage(d, page([], null, { designation: 'none', sessionId: null, term: null }))).toBeNull();
    expect(foldOlderPage(d, page([], null, { replies: null }))).not.toBeNull();
  });
  it('a retire resets what is drawn to the page itself', () => {
    const d = foldOlderPage(foldNewestPage(null, newest), page(olderPage.entries, C(1, 'end')))!;
    const none = page([], null, { designation: 'none', sessionId: null, term: null });
    expect(foldNewestPage(d, none)).toEqual({ entries: [], older: null, paged: false });
  });
});

describe('the reply\'s receipt and handled deciders', () => {
  it('half seen: the element\'s ratio, or half of the viewport for an element taller than the viewport', () => {
    expect(replySeenEnough({ ratio: 0.5, visibleHeight: 100, rootHeight: 800 })).toBe(true);
    expect(replySeenEnough({ ratio: 0.49, visibleHeight: 100, rootHeight: 800 })).toBe(false);
    expect(replySeenEnough({ ratio: 0.2, visibleHeight: 400, rootHeight: 800 })).toBe(true);
    expect(replySeenEnough({ ratio: 0.2, visibleHeight: 399, rootHeight: 800 })).toBe(false);
    expect(replySeenEnough({ ratio: 0, visibleHeight: 0, rootHeight: 0 })).toBe(false);
  });
  it('the dwell and the spacing are one second', () => {
    expect([REPLY_DWELL_MS, RECEIPT_SPACING_MS]).toEqual([1_000, 1_000]);
  });
  it('the next receipt is not before one second after the last: a first one goes now', () => {
    expect([nextReceiptAt(null, T0), nextReceiptAt(T0, T0 + 200), nextReceiptAt(T0, T0 + 5_000)]).toEqual([T0, T0 + 1_000, T0 + 5_000]);
  });
  it('a batch is the waiting replies not yet posted, once each, at most one body\'s worth, as opened receipts from the console', () => {
    const b = nextReceiptBatch([3, 4, 3, 5], new Set([4]));
    expect(b.ids).toEqual([3, 5]);
    expect(b.receipts).toEqual([3, 5].map((id) => ({ ref: { kind: 'reply', id }, receipt: 'opened', from: { source: 'console' } })));
    const many = Array.from({ length: RECEIPTS_MAX_PER_BODY + 5 }, (_, i) => i + 1);
    expect(nextReceiptBatch(many, new Set()).ids).toHaveLength(RECEIPTS_MAX_PER_BODY);
    expect(nextReceiptBatch([], new Set()).receipts).toEqual([]);
  });
  it('the handled control is offered on a response row not yet handled, says handled on one handled, and is absent otherwise', () => {
    expect(replyHandledOffer({ kind: 'row', id: 80, handledAt: null })).toEqual({ kind: 'offer', id: 80 });
    expect(replyHandledOffer({ kind: 'row', id: 80, handledAt: 5 })).toEqual({ kind: 'handled' });
    expect(replyHandledOffer({ kind: 'no-row' })).toEqual({ kind: 'none' });
    expect(replyHandledOffer({ kind: 'unmeasured' })).toEqual({ kind: 'none' });
  });
});
