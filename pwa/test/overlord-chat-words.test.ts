// The Overlord chat's console words (Overlord W1, the chat, Task 1; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`,
// questions 5, 6 and 13): the kept draft, what a transcript user turn is, the record placed in the live transcript, and an earlier
// page's items. The live rows are built by today's `buildChatItems`, so the merge reads what the session view reads.
import { describe, it, expect } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { INJECTED_PROMPTS, INJECTED_PROMPT_KEYS } from '../../shared/injected-prompts.mjs';
import { operatorMessageNudgeLine, type OperatorMessageRow } from '../../shared/operatorMessages';
import { chatTicksOf, type ChatEntry, type ChatSendAnswer } from '../../shared/overlordChat';
import { buildChatItems } from '../src/session/chatItems';
import {
  PANE_TURN_WORDS, ccrcLineWords, dividerWords, draftAfterSend, earlierWords, historyItemsToChat, mergeLive, sendNotice, tickWords,
  turnOrigin, type ChatRow,
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
