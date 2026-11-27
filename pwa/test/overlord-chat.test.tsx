// The chat part of the Overlord place (Overlord W1, the chat, Task 4; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-chat.md`): what it draws, the kept draft, the toggle, the earlier page and the coalesced refresh, over a fake port.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { isSendKey, operatorMessageNudgeLine, type OperatorMessageRow, type OverlordReplyRow } from '../../shared/operatorMessages';
import { chatTicksOf, readChatThread, type ChatEntry, type ChatOlder, type ChatSendAnswer, type ChatThread, type ReplyResponse } from '../../shared/overlordChat';
import { OverlordChat } from '../src/overlord/OverlordChat';
import {
  EARLIER_UNREACHABLE_WORDS, GENERATIONS_UNMEASURED_WORDS, MESSAGES_UNMEASURED_WORDS, NO_OVERLORD_WORDS, NO_REPLIES_WORDS, OLDER_MESSAGES_WORDS,
  OLDER_PAGE_UNREACHABLE_WORDS, PANE_TURN_WORDS, READ_CEILING_WORDS, REPLIES_UNMEASURED_WORDS,
} from '../src/overlord/chatWords';
import { HANDLED_WORDS } from '../src/responses/responseWords';
import type { ChatEarlierRead, ChatThreadRead, ChatSendOpts, OverlordChatPort } from '../src/overlord/useOverlordChat';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { api } from '../src/lib/api';

const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const SID = 'lane-a-overlord';
const row = (id: number, s: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow => ({
  id, at: T0 + s * 1000, term: 1, state: 'queued', text: `fixture message ${id}`, cut: false, sha256: 'a'.repeat(64),
  queuedAt: T0 + s * 1000, deliveredAt: null, pickedUpAt: null, settledAt: null, settledBy: null, spentAt: null, offRecord: false, ...over,
});
const message = (r: OperatorMessageRow): ChatEntry => ({ kind: 'message', row: r, ticks: chatTicksOf(r) });
const divider = (term: number, n: number, s: number, o: { current?: boolean; newTerm?: boolean; readable?: boolean } = {}): ChatEntry => ({
  kind: 'divider', gen: { term, n }, at: T0 + s * 1000, current: o.current ?? false, newTerm: o.newTerm ?? false,
  earlier: o.readable === true ? 'readable' : 'not-pageable',
});
const settled = (id: number, s: number, over: Partial<OperatorMessageRow> = {}): OperatorMessageRow =>
  row(id, s, { state: 'settled', deliveredAt: T0, pickedUpAt: T0, settledAt: T0, settledBy: 'acknowledge', ...over });
const thread = (entries: ChatEntry[], over: Partial<ChatThread> = {}): ChatThread => ({
  v: 1, designation: 'designated', sessionId: SID, term: 2, entries,
  messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 1 } },
  readiness: { kind: 'read', value: { oldest: null } }, replies: { kind: 'read', value: { more: false } }, older: null, ...over,
});
const reply = (id: number, s: number, over: Partial<OverlordReplyRow> = {}): OverlordReplyRow => ({
  id, at: T0 + s * 1000, turnAt: T0 + s * 1000, term: 2, entryUuid: `e0e0e0e0-0000-4000-8000-${String(id).padStart(12, '0')}`,
  text: `fixture reply ${id}`, cut: false, sha256: 'b'.repeat(64), inReplyTo: null, offRecord: false, ...over,
});
const replyEntry = (r: OverlordReplyRow, response: ReplyResponse = { kind: 'no-row' }): ChatEntry => ({ kind: 'reply', row: r, response });
const C = (before: number | 'end', replyBefore: number | 'end'): ChatOlder => ({ before, replyBefore });
const iso = (s: number): string => new Date(T0 + s * 1000).toISOString();
const user = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'user', uuid, ts: iso(s), text });
const assistant = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: iso(s), text });

interface Fake extends OverlordChatPort {
  threads: ChatThreadRead[];
  sends: ChatSendAnswer[];
  earliers: ChatEarlierRead[];
  /** The answers to a read below a cursor (an older page), in order; none left: no answer. */
  olders: ChatThreadRead[];
  /** The cursor of each thread read: null for the newest page. */
  threadArgs: (ChatOlder | null)[];
  threadCalls: number;
  sendCalls: { sessionId: string; text: string; opts: ChatSendOpts }[];
  earlierCalls: { term: number; n: number; around: string | null }[];
}
/** A port answering from queues; the last thread answer repeats. */
function fakePort(first: ChatThreadRead): Fake {
  const f: Fake = {
    threads: [first], sends: [], earliers: [], olders: [], threadArgs: [], threadCalls: 0, sendCalls: [], earlierCalls: [],
    thread: async (older) => {
      f.threadCalls += 1;
      f.threadArgs.push(older ?? null);
      if (older !== undefined && older !== null) return f.olders.shift() ?? { kind: 'no-answer' };
      return f.threads.length > 1 ? f.threads.shift()! : f.threads[0]!;
    },
    send: async (sessionId, text, opts) => { f.sendCalls.push({ sessionId, text, opts }); return f.sends.shift() ?? { kind: 'no-answer' }; },
    earlier: async (gen, around) => { f.earlierCalls.push({ ...gen, around }); return f.earliers.shift() ?? 'no-answer'; },
  };
  return f;
}

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const mount = async (port: OverlordChatPort, live: ChatItem[] = [], subscribe?: (f: (m: SessionStreamMsg) => void) => () => void) => {
  const r = render(<OverlordChat port={port} live={live} subscribe={subscribe} />);
  await flush();
  return r;
};
const box = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message' });
const type = (text: string): void => { fireEvent.change(box(), { target: { value: text } }); };
const send = async (): Promise<void> => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); }); await flush(); };
const bubbles = (): HTMLElement[] => screen.queryAllByRole('article');

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('what the part draws', () => {
  it('dividers, messages with their ticks, the server line and the marks, in order; a new term names its term', async () => {
    const t = thread([
      divider(1, 1, 0), message(settled(3, 5)), divider(2, 1, 20, { newTerm: true, current: true }),
      message(row(4, 30, { cut: true, offRecord: true, term: 2 })),
      { kind: 'server-line', messageId: 4, text: 'Recorded. The Overlord is renewing.', word: 'renewing' },
    ]);
    await mount(fakePort({ kind: 'thread', thread: t }));
    const part = screen.getByRole('region', { name: 'Chat with the Overlord' });
    const text = part.textContent ?? '';
    const order = ['generation 1', 'fixture message 3', 'term 2, generation 1', 'fixture message 4', 'off the record', 'cut to fit',
      'Recorded. The Overlord is renewing.'].map((w) => text.indexOf(w));
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByLabelText('recorded, delivered, picked up, settled')).toBeInTheDocument();
    expect(screen.getByLabelText('recorded, queued')).toBeInTheDocument();
    expect(screen.getByText('Read generation 1 in ccrc history')).toBeInTheDocument();
    expect(bubbles()).toHaveLength(2);
  });

  it('a nudge turn is its record message, once; an injected prompt is a quiet line; any other user turn is pane text', async () => {
    const t = thread([divider(2, 1, 0, { current: true }), message(row(5, 10, { term: 2 }))]);
    const live = buildChatItems([
      user('u1', 30, operatorMessageNudgeLine(5)), assistant('a1', 31, 'on it'), user('u2', 32, operatorMessageNudgeLine(5)),
      user('u3', 40, INJECTED_PROMPTS.clear.text), user('u4', 50, 'typed by someone at the terminal'),
    ], []);
    await mount(fakePort({ kind: 'thread', thread: t }), live);
    expect(bubbles(), 'one operator bubble: the record\'s').toHaveLength(1);
    expect(screen.getAllByText('fixture message 5')).toHaveLength(1);
    expect(screen.queryByText(operatorMessageNudgeLine(5))).toBeNull();
    expect(screen.getByText('ccrc: clear')).toBeInTheDocument();
    const pane = screen.getByText('typed by someone at the terminal').closest('figure')!;
    expect(within(pane).getByText(PANE_TURN_WORDS)).toBeInTheDocument();
    expect(pane.closest('article'), 'never an operator bubble').toBeNull();
    expect(pane.closest('.msg-user'), 'never the session view\'s user bubble').toBeNull();
    expect(screen.getByText('on it')).toBeInTheDocument();
  });

  it('a part that could not be read draws its line, never an empty conversation', async () => {
    const t = thread([], {
      messages: { kind: 'unmeasured', why: 'store-closed' }, generations: { kind: 'unmeasured', why: 'db' },
    });
    await mount(fakePort({ kind: 'thread', thread: t }));
    expect(screen.getByText(MESSAGES_UNMEASURED_WORDS)).toBeInTheDocument();
    expect(screen.getByText(GENERATIONS_UNMEASURED_WORDS)).toBeInTheDocument();
  });

  it('after a retire the thread reads none: no generation is offered and the composer is held', async () => {
    const none: ChatThread = {
      v: 1, designation: 'none', sessionId: null, term: null, entries: [],
      messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 0 } },
      readiness: { kind: 'read', value: { oldest: null } }, replies: { kind: 'read', value: { more: false } }, older: null,
    };
    await mount(fakePort({ kind: 'thread', thread: none }), buildChatItems([user('u1', 1, 'stale pane text')], []));
    expect(screen.getByText(NO_OVERLORD_WORDS)).toBeInTheDocument();
    expect(screen.queryByText(/generation/)).toBeNull();
    expect(screen.queryByText('stale pane text'), 'no live rows without a designation').toBeNull();
    expect(box()).toBeDisabled();
  });

  it('the composer in the chat offers no attachment and no slash completion', async () => {
    const commands = vi.spyOn(api, 'commands');
    await mount(fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })]) }));
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull();
    type('/');
    await flush();
    expect(commands).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).toBeNull();
  });
});

describe('the kept draft', () => {
  const recorded = (over: Partial<Extract<ChatSendAnswer, { kind: 'recorded' }>> = {}): ChatSendAnswer =>
    ({ kind: 'recorded', messageId: 9, cut: false, replay: false, offRecord: false, ...over });
  const live = (): Fake => fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })]) });

  it('a recorded send clears the box, carries the thread\'s session and term, and the next send has a new key', async () => {
    const port = live();
    port.sends.push(recorded(), recorded({ messageId: 10 }));
    await mount(port);
    type('first');
    await send();
    expect(box().value).toBe('');
    type('second');
    await send();
    const [a, b] = port.sendCalls;
    expect(a).toMatchObject({ sessionId: SID, text: 'first', opts: { overlordTerm: 2, offRecord: false } });
    expect(isSendKey(a!.opts.sendKey)).toBe(true);
    expect(b!.opts.sendKey).not.toBe(a!.opts.sendKey);
  });

  for (const error of ['renewing', 'stale-designation', 'unmeasured', 'read-ceiling']) {
    it(`a ${error} refusal keeps the text and says why`, async () => {
      const port = live();
      port.sends.push({ kind: 'refused', error });
      await mount(port);
      const before = port.threadCalls;
      type('keep me');
      await send();
      expect(box().value).toBe('keep me');
      const notice = document.querySelector('.oc-notice');
      expect(notice?.textContent ?? '').not.toBe('');
      if (error === 'renewing') expect(notice!.textContent).toMatch(/Between conversations/);
      if (error === 'stale-designation') {
        expect(notice!.textContent).toBe('The Overlord changed. Your message was not sent; send it again.');
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(port.threadCalls, 'the thread is read again').toBeGreaterThan(before);
      }
    });
  }

  it('no answer keeps the text, and the retry carries the same key and term; a replay answer clears', async () => {
    const port = live();
    port.sends.push({ kind: 'no-answer' }, recorded({ replay: true }));
    await mount(port);
    type('maybe landed');
    await send();
    expect(box().value).toBe('maybe landed');
    await send();
    const [a, b] = port.sendCalls;
    expect(b!.opts.sendKey).toBe(a!.opts.sendKey);
    expect(b!.opts.overlordTerm).toBe(a!.opts.overlordTerm);
    expect(box().value).toBe('');
  });

  it('after stale-designation the resend carries the new thread\'s term and a new key', async () => {
    const port = fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })]) });
    port.threads.push({ kind: 'thread', thread: thread([divider(3, 1, 0, { current: true, newTerm: true })], { term: 3 }) });
    port.sends.push({ kind: 'refused', error: 'stale-designation' }, { kind: 'no-answer' });
    await mount(port);
    type('to whoever is there');
    await send();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await send();
    const [a, b] = port.sendCalls;
    expect([a!.opts.overlordTerm, b!.opts.overlordTerm]).toEqual([2, 3]);
    expect(b!.opts.sendKey).not.toBe(a!.opts.sendKey);
  });

  it('an edited draft takes a new key', async () => {
    const port = live();
    port.sends.push({ kind: 'no-answer' }, { kind: 'no-answer' });
    await mount(port);
    type('one');
    await send();
    type('one, edited');
    await send();
    expect(port.sendCalls[1]!.opts.sendKey).not.toBe(port.sendCalls[0]!.opts.sendKey);
  });

  it('the toggle sends offRecord and resets after a recorded send; a toggled send with no echo says so', async () => {
    const port = live();
    port.sends.push(recorded({ offRecord: false }));
    await mount(port);
    const toggle = screen.getByRole('button', { name: 'Off the record' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    type('between us');
    await send();
    expect(port.sendCalls[0]!.opts.offRecord).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Recorded on the record/)).toBeInTheDocument();
  });
});

describe('the earlier page', () => {
  it('Show generation 1 reads its page by (term, n) and draws its items; an unreachable answer draws its quiet line', async () => {
    const t = thread([divider(1, 1, 0, { readable: true }), divider(1, 2, 10, { readable: true }), divider(2, 1, 20, { newTerm: true, current: true })]);
    const port = fakePort({ kind: 'thread', thread: t });
    port.earliers.push(
      { ok: true, gen: { term: 1, n: 1 }, page: { outcome: 'rows', exit: 0, items: [
        { kind: 'entry', role: 'assistant', text: 'an old answer', trust: 'untrusted', uuid: 'aaaaaaaa-0000-4000-8000-000000000001' } as never,
        { kind: 'entry', role: 'user', text: 'old pane words', trust: 'untrusted', uuid: 'aaaaaaaa-0000-4000-8000-000000000002' } as never,
      ], shown: 2, total: 2, scope: { kind: 'overlord', id: `session:${SID}`, project: null, families: [], families_total: 0, transcripts: 1 } } },
      { ok: false, error: 'history-unreachable', cause: 'no-agent' },
    );
    await mount(port);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show generation 1' }) ); });
    await flush();
    expect(port.earlierCalls[0]).toEqual({ term: 1, n: 1, around: null });
    expect(screen.getByText('an old answer')).toBeInTheDocument();
    expect(screen.getByText('old pane words').closest('figure')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Show generation 1' }), 'its page is shown, nothing more to show').toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show generation 2' })); });
    await flush();
    expect(port.earlierCalls[1]).toEqual({ term: 1, n: 2, around: null });
    expect(screen.getByText(`${EARLIER_UNREACHABLE_WORDS} (no-agent)`)).toBeInTheDocument();
  });
});

describe('the earlier page, its next page', () => {
  it('Show earlier asks around the page\'s first item and draws the older items above', async () => {
    const t = thread([divider(1, 1, 0, { readable: true }), divider(2, 1, 20, { newTerm: true, current: true })]);
    const port = fakePort({ kind: 'thread', thread: t });
    const scope = { kind: 'overlord', id: `session:${SID}`, project: null, families: [], families_total: 0, transcripts: 1 } as const;
    const item = (n: number, text: string) =>
      ({ kind: 'entry', role: 'assistant', text, trust: 'untrusted', uuid: `aaaaaaaa-0000-4000-8000-00000000000${n}` }) as never;
    port.earliers.push(
      { ok: true, gen: { term: 1, n: 1 }, page: { outcome: 'rows', exit: 0, items: [item(3, 'newer words')], shown: 1, total: 2, scope } },
      { ok: true, gen: { term: 1, n: 1 }, page: { outcome: 'rows', exit: 0, items: [item(2, 'older words')], shown: 1, total: 1, scope } },
    );
    await mount(port);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show generation 1' })); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show earlier' })); });
    await flush();
    expect(port.earlierCalls[1]).toEqual({ term: 1, n: 1, around: 'aaaaaaaa-0000-4000-8000-000000000003' });
    const text = screen.getByRole('region', { name: 'Chat with the Overlord' }).textContent ?? '';
    expect(text.indexOf('older words')).toBeLessThan(text.indexOf('newer words'));
    expect(screen.queryByRole('button', { name: 'Show earlier' }), 'the last page offers no more').toBeNull();
  });
});

describe('the refresh: an allow-list of triggers through one coalescer', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
  const quiet = (): ChatThread => thread([divider(2, 1, 0, { current: true }), message(settled(3, 5))]);
  const waiting = (): ChatThread => thread([divider(2, 1, 0, { current: true }), message(row(4, 5))]);
  const subscribed = () => {
    let push: (m: SessionStreamMsg) => void = () => {};
    return { subscribe: (f: (m: SessionStreamMsg) => void) => { push = f; return () => {}; }, push: (m: SessionStreamMsg) => act(() => { push(m); }) };
  };
  const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const events = (...e: ChatEvent[]): SessionStreamMsg => ({ type: 'events', uuid: 'u', events: e, offset: 0 });

  it('a beat reads nothing, an assistant frame reads nothing, a user turn reads once', async () => {
    const port = fakePort({ kind: 'thread', thread: quiet() });
    const s = subscribed();
    await mount(port, [], s.subscribe);
    expect(port.threadCalls).toBe(1);
    await tick(20_000);
    s.push({ type: 'beat', at: 1 });
    s.push(events(assistant('a', 1, 'text')));
    await tick(20_000);
    expect(port.threadCalls, 'nothing moves, nothing is read').toBe(1);
    s.push(events(user('u', 1, operatorMessageNudgeLine(3))));
    await tick(0);
    expect(port.threadCalls).toBe(2);
  });

  it('a turn\'s end reads: idle after busy, not idle after idle', async () => {
    const port = fakePort({ kind: 'thread', thread: quiet() });
    const s = subscribed();
    await mount(port, [], s.subscribe);
    await tick(20_000);
    s.push({ type: 'status', status: 'idle', statusUpdatedAt: null });
    await tick(20_000);
    expect(port.threadCalls).toBe(1);
    s.push({ type: 'status', status: 'busy', statusUpdatedAt: null });
    s.push({ type: 'status', status: 'idle', statusUpdatedAt: null });
    await tick(0);
    expect(port.threadCalls).toBe(2);
  });

  it('ten trigger frames within 10 s read once', async () => {
    const port = fakePort({ kind: 'thread', thread: quiet() });
    const s = subscribed();
    await mount(port, [], s.subscribe);
    for (let i = 0; i < 10; i++) { s.push(events(user(`u${i}`, i, 'x'))); await tick(900); }
    await tick(10_000);
    expect(port.threadCalls).toBe(2);
  });

  it('the timer reads while a message waits for its pick-up, and only while the document is visible', async () => {
    const port = fakePort({ kind: 'thread', thread: waiting() });
    await mount(port);
    await tick(10_000);
    expect(port.threadCalls).toBe(2);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await tick(60_000);
    expect(port.threadCalls, 'a hidden tab reads nothing').toBe(2);
    vis.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await tick(0);
    expect(port.threadCalls, 'shown again, it reads once').toBe(3);
    port.threads = [{ kind: 'thread', thread: quiet() }];
    // Past the message's first minute the timer's spacing is 30 s (`pickUpReadEvery`), so the next read answers the pick-up.
    await tick(30_000);
    const n = port.threadCalls;
    await tick(60_000);
    expect(port.threadCalls, 'picked up: the timer stops').toBe(n);
  });

  it('read-ceiling keeps the thread, says so, and waits retryAfterS', async () => {
    const port = fakePort({ kind: 'thread', thread: waiting() });
    port.threads.push({ kind: 'refused', error: 'read-ceiling', retryAfterS: 60 }, { kind: 'thread', thread: waiting() });
    await mount(port);
    await tick(10_000);
    expect(port.threadCalls).toBe(2);
    expect(screen.getByText(READ_CEILING_WORDS)).toBeInTheDocument();
    expect(screen.getByText('fixture message 4'), 'the thread is kept').toBeInTheDocument();
    await tick(50_000);
    expect(port.threadCalls, 'not before retryAfterS').toBe(2);
    await tick(10_000);
    expect(port.threadCalls).toBe(3);
    expect(screen.queryByText(READ_CEILING_WORDS)).toBeNull();
  });
});

// ── fix round 1 (review 4070, call 1737) ───────────────────────────────────────────────────────────────────────────────

describe('the pick-up poll has an end (review F1)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
  const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it('a message older than the wait is never polled for: a visible console reads once and then waits for a trigger', async () => {
    const port = fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true }), message(row(4, -700))]) });
    await mount(port);
    expect(port.threadCalls).toBe(1);
    await tick(15 * 60_000);
    expect(port.threadCalls, 'no timer read for an eleven-minute-old message').toBe(1);
  });

  it('the spacing grows: every 10 s in the message\'s first minute, then every 30 s, and none past ten minutes', async () => {
    const port = fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true }), message(row(4, 5))]) });
    await mount(port);
    await tick(10_000);
    expect(port.threadCalls, 'at 65 s old, the first minute\'s spacing still applied to this read').toBe(2);
    await tick(20_000);
    expect(port.threadCalls, 'past the first minute: not before 30 s').toBe(2);
    await tick(10_000);
    expect(port.threadCalls).toBe(3);
    await tick(10 * 60_000);
    const n = port.threadCalls;
    await tick(10 * 60_000);
    expect(port.threadCalls, 'past ten minutes the timer reads nothing').toBe(n);
  });

  it('a message in a state this console cannot read is never polled for', async () => {
    const port = fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true }), message(row(4, 5, { state: 'unknown' as never }))]) });
    await mount(port);
    await tick(5 * 60_000);
    expect(port.threadCalls).toBe(1);
  });
});

describe('a stale-designation answer reads at once, past a pending pick-up timer (review F5)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
  it('with a message awaiting its pick-up, the refused send\'s re-read does not wait out the timer', async () => {
    const port = fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true }), message(row(4, 55))]) });
    port.sends.push({ kind: 'refused', error: 'stale-designation' });
    await mount(port);
    expect(port.threadCalls).toBe(1);
    type('to whoever is there');
    await send();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(port.threadCalls, 'read at once, not 10 s later').toBe(2);
  });
});

describe('the first read\'s trouble, and the older messages line (review F7, F2)', () => {
  it('a first read with no answer says nothing was read, never "as last read"', async () => {
    await mount(fakePort({ kind: 'no-answer' }));
    expect(screen.getByText('No answer from the server; the conversation could not be read yet.')).toBeInTheDocument();
    expect(screen.queryByText(/as last read/)).toBeNull();
  });

  it('when the door answers that older messages exist, one line says so; when it does not, no line', async () => {
    const more = thread([divider(2, 1, 0, { current: true }), message(row(4, 5))], { messages: { kind: 'read', value: { more: true } } });
    const r = await mount(fakePort({ kind: 'thread', thread: more }));
    expect(screen.getByText(OLDER_MESSAGES_WORDS)).toBeInTheDocument();
    r.unmount();
    await mount(fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true }), message(row(4, 5))]) }));
    expect(screen.queryByText(OLDER_MESSAGES_WORDS)).toBeNull();
  });
});

describe('the toggle and the retry (review F3, F4)', () => {
  const recorded = (over: Partial<Extract<ChatSendAnswer, { kind: 'recorded' }>> = {}): ChatSendAnswer =>
    ({ kind: 'recorded', messageId: 9, cut: false, replay: false, offRecord: false, ...over });
  const live = (): Fake => fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })]) });
  const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Off the record' });

  it('a retry after a lost answer, with the toggle changed, keeps its key and says the first record stands', async () => {
    const port = live();
    port.sends.push({ kind: 'no-answer' }, recorded({ replay: true, offRecord: false }));
    await mount(port);
    type('said once');
    await send();
    fireEvent.click(toggle());
    await send();
    expect(port.sendCalls[1]!.opts.sendKey, 'the toggle is not in the key').toBe(port.sendCalls[0]!.opts.sendKey);
    expect(port.sendCalls[1]!.opts.offRecord).toBe(true);
    expect(screen.getByText('This message was already recorded on the record; the first record stands.')).toBeInTheDocument();
    expect(screen.queryByText(/does not know the toggle/)).toBeNull();
  });

  it('the toggle resets only when the box really cleared: an edit made while the answer was on its way keeps the toggle on', async () => {
    const port = live();
    let answer: (a: ChatSendAnswer) => void = () => {};
    port.send = async (sessionId, text, opts) => {
      port.sendCalls.push({ sessionId, text, opts });
      return new Promise<ChatSendAnswer>((r) => { answer = r; });
    };
    await mount(port);
    fireEvent.click(toggle());
    // The first half: the draft is edited while the answer is on its way, so the box keeps the follow-up, and the toggle with it.
    type('between us');
    await send();
    type('and a follow-up, still between us');
    await act(async () => { answer(recorded({ offRecord: true })); });
    await flush();
    expect(box().value).toBe('and a follow-up, still between us');
    expect(toggle(), 'the follow-up stays off the record').toHaveAttribute('aria-pressed', 'true');
    // The second half: nothing edited, so the box clears, and the toggle resets with it.
    await send();
    await act(async () => { answer(recorded({ messageId: 10, offRecord: true })); });
    await flush();
    expect(box().value).toBe('');
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the toggle under a send in flight (review 4084 F2)', () => {
  const live = (): Fake => fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })]) });
  const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Off the record' });

  it('while a send is in flight the toggle is held, and says so; after the clear it is off and free, and the next message goes off the record', async () => {
    const port = live();
    let answer: (a: ChatSendAnswer) => void = () => {};
    port.send = async (sessionId, text, opts) => {
      port.sendCalls.push({ sessionId, text, opts });
      return new Promise<ChatSendAnswer>((r) => { answer = r; });
    };
    await mount(port);
    type('on the record');
    await send();
    // The privacy direction: a press during the wait must never be undone by the clear that follows, so the toggle is held.
    expect(toggle(), 'held while the message is sent').toBeDisabled();
    expect(toggle()).toHaveAccessibleDescription('Held while the message is sent.');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { answer({ kind: 'recorded', messageId: 9, cut: false, replay: false, offRecord: false }); });
    await flush();
    expect(box().value).toBe('');
    expect(toggle(), 'off after the clear').toHaveAttribute('aria-pressed', 'false');
    expect(toggle()).toBeEnabled();
    expect(toggle()).not.toHaveAccessibleDescription('Held while the message is sent.');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    type('between us');
    await send();
    expect(port.sendCalls.map((c) => c.opts.offRecord)).toEqual([false, true]);
    await act(async () => { answer({ kind: 'recorded', messageId: 10, cut: false, replay: false, offRecord: true }); });
    await flush();
  });
});

describe('a trigger past a slower pick-up timer reads at the coalescer\'s spacing (review 4084 F1)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
  const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it('a message past its first minute sets the 30 s timer; a user turn 3 s after the read is read at 10 s, not 30 s', async () => {
    let push: (m: SessionStreamMsg) => void = () => {};
    const port = fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true }), message(row(4, -10))]) });
    await mount(port, [], (f) => { push = f; return () => {}; });
    expect(port.threadCalls).toBe(1);
    await tick(3_000);
    act(() => { push({ type: 'events', uuid: 'u', events: [user('u9', 63, 'a turn')], offset: 0 }); });
    await tick(6_900);
    expect(port.threadCalls, 'not before the coalescer\'s spacing').toBe(1);
    await tick(200);
    expect(port.threadCalls, 'the trigger replaced the slower timer: read at 10 s').toBe(2);
    await tick(29_000);
    expect(port.threadCalls, 'then the 30 s timer again, not before').toBe(2);
    await tick(1_000);
    expect(port.threadCalls).toBe(3);
  });
});

// ── fix round 3 (review 4120, call 1845) ───────────────────────────────────────────────────────────────────────────────

describe('a read refused by the ceiling reads again after the server\'s retry time, on a quiet thread too (review 4120 F2)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
  const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const quiet = (): ChatThread => thread([divider(2, 1, 0, { current: true }), message(settled(3, 5))]);

  it('a quiet thread (no message awaiting its pick-up): the refused read of a trigger is read again at retryAfterS, and the line goes', async () => {
    let push: (m: SessionStreamMsg) => void = () => {};
    const port = fakePort({ kind: 'thread', thread: quiet() });
    port.threads.push({ kind: 'refused', error: 'read-ceiling', retryAfterS: 60 }, { kind: 'thread', thread: quiet() });
    await mount(port, [], (f) => { push = f; return () => {}; });
    expect(port.threadCalls).toBe(1);
    await tick(20_000);
    act(() => { push({ type: 'events', uuid: 'u', events: [user('u9', 80, 'a turn')], offset: 0 }); });
    await tick(0);
    expect(port.threadCalls, 'the trigger reads, and is refused').toBe(2);
    expect(screen.getByText(READ_CEILING_WORDS)).toBeInTheDocument();
    await tick(59_000);
    expect(port.threadCalls, 'not before retryAfterS').toBe(2);
    await tick(1_000);
    expect(port.threadCalls, 'read again at retryAfterS, with no other trigger').toBe(3);
    expect(screen.queryByText(READ_CEILING_WORDS)).toBeNull();
    await tick(120_000);
    expect(port.threadCalls, 'a quiet thread then reads nothing on a timer').toBe(3);
  });

  it('the first read refused by the ceiling: no thread yet, read again at retryAfterS', async () => {
    const port = fakePort({ kind: 'refused', error: 'read-ceiling', retryAfterS: 30 });
    port.threads.push({ kind: 'thread', thread: quiet() });
    await mount(port);
    expect(port.threadCalls).toBe(1);
    await tick(29_000);
    expect(port.threadCalls, 'not before retryAfterS').toBe(1);
    await tick(1_000);
    expect(port.threadCalls, 'read again at retryAfterS').toBe(2);
    expect(screen.getByText('fixture message 3'), 'the thread is drawn').toBeInTheDocument();
    await tick(120_000);
    expect(port.threadCalls).toBe(2);
  });
});

// ── PR B: the replies, the paging, the handled control ─────────────────────────────────────────────────────────────────────

describe('a recorded reply is drawn as the Overlord\'s words, as text', () => {
  it('its words are text: markup, a link and a script are shown as typed, never a link, a control or an element', async () => {
    const hostile = '<b>bold</b> [click](https://example.test/x) <script>window.__x = 1</script> `code`';
    const t = thread([divider(2, 1, 0, { current: true }), replyEntry(reply(8, 10, { text: hostile }))]);
    await mount(fakePort({ kind: 'thread', thread: t }));
    const group = screen.getByRole('group', { name: 'Overlord reply 8' });
    expect(group.querySelector('.oc-reply-text')!.textContent).toBe(hostile);
    expect(group.querySelector('a, b, script, code, button, input, img'), 'no element is made from the words').toBeNull();
    expect(bubbles(), 'a reply is never an operator bubble').toHaveLength(0);
  });

  it('an off-the-record reply and a cut one say so', async () => {
    const t = thread([replyEntry(reply(8, 10, { offRecord: true, cut: true })), replyEntry(reply(9, 11))]);
    await mount(fakePort({ kind: 'thread', thread: t }));
    const [a, b] = [screen.getByRole('group', { name: 'Overlord reply 8' }), screen.getByRole('group', { name: 'Overlord reply 9' })];
    expect([within(a).queryByText('off the record') !== null, within(a).queryByText('cut to fit') !== null]).toEqual([true, true]);
    expect([within(b).queryByText('off the record'), within(b).queryByText('cut to fit')]).toEqual([null, null]);
  });

  it('a reply whose entry is a live row is drawn once, in that row\'s place, and its live copy is not drawn', async () => {
    const t = thread([divider(2, 1, 0, { current: true }), replyEntry(reply(8, 31, { entryUuid: 'a2', text: 'the recorded words' }))]);
    // An earlier turn's text stays; this turn's earlier text block is the recorded reply's words too, so it is not drawn beside it.
    const live = buildChatItems([assistant('a1', 5, 'first live answer'), user('u1', 20, 'typed at the terminal'), assistant('a1b', 25, 'an earlier block of the turn'),
      assistant('a2', 31, 'the live copy'), assistant('a3', 40, 'last live answer')], []);
    await mount(fakePort({ kind: 'thread', thread: t }), live);
    const text = screen.getByRole('region', { name: 'Chat with the Overlord' }).textContent ?? '';
    expect(screen.getAllByText('the recorded words')).toHaveLength(1);
    expect(screen.queryByText('the live copy')).toBeNull();
    expect(screen.queryByText('an earlier block of the turn')).toBeNull();
    expect([text.indexOf('first live answer'), text.indexOf('the recorded words'), text.indexOf('last live answer')].every((i, k, a) => i >= 0 && (k === 0 || i > a[k - 1]!))).toBe(true);
  });

  it('a reply with no live entry is drawn, by time', async () => {
    const t = thread([replyEntry(reply(8, 20, { text: 'a reply with no live row' }))]);
    const live = buildChatItems([assistant('a1', 5, 'early live'), assistant('a3', 40, 'late live')], []);
    await mount(fakePort({ kind: 'thread', thread: t }), live);
    const text = screen.getByRole('region', { name: 'Chat with the Overlord' }).textContent ?? '';
    expect(text.indexOf('early live')).toBeLessThan(text.indexOf('a reply with no live row'));
    expect(text.indexOf('a reply with no live row')).toBeLessThan(text.indexOf('late live'));
  });
});

describe('I handled this elsewhere, on a reply with a response row', () => {
  const entries = (): ChatEntry[] => [
    divider(2, 1, 0, { current: true }),
    replyEntry(reply(8, 10), { kind: 'row', id: 80, handledAt: null }),
    replyEntry(reply(9, 11), { kind: 'no-row' }),
    replyEntry(reply(10, 12), { kind: 'unmeasured' }),
    replyEntry(reply(11, 13), { kind: 'row', id: 110, handledAt: T0 }),
  ];
  const control = (): HTMLElement[] => screen.queryAllByRole('button', { name: HANDLED_WORDS.button });

  it('is offered on the reply with an unhandled row only; a handled row says so; no row and unmeasured draw no control', async () => {
    await mount(fakePort({ kind: 'thread', thread: thread(entries()) }));
    expect(control()).toHaveLength(1);
    expect(within(screen.getByRole('group', { name: 'Overlord reply 8' })).getByRole('button', { name: HANDLED_WORDS.button })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Overlord reply 11' })).getByText(HANDLED_WORDS.handled)).toBeInTheDocument();
    for (const id of [9, 10]) {
      const g = within(screen.getByRole('group', { name: `Overlord reply ${id}` }));
      expect([g.queryByRole('button'), g.queryByText(HANDLED_WORDS.handled)]).toEqual([null, null]);
    }
  });

  it('calls the handled door once with the response row\'s id, even pressed twice while it is on its way; after success the row says so', async () => {
    let finish: (v: { ok: true; id: number; handledAt: number | null; changed: boolean }) => void = () => {};
    const mark = vi.spyOn(api, 'markResponseHandled').mockImplementation(() => new Promise((r) => { finish = r; }));
    await mount(fakePort({ kind: 'thread', thread: thread(entries()) }));
    const b = control()[0]!;
    fireEvent.click(b);
    fireEvent.click(b);
    await flush();
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(80);
    await act(async () => { finish({ ok: true, id: 80, handledAt: T0, changed: true }); });
    await flush();
    expect(control()).toHaveLength(0);
    expect(within(screen.getByRole('group', { name: 'Overlord reply 8' })).getByText(HANDLED_WORDS.handled)).toBeInTheDocument();
  });

  it('a refusal keeps the control and says so quietly; the next press tries again', async () => {
    const mark = vi.spyOn(api, 'markResponseHandled').mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce({ ok: true, id: 80, handledAt: T0, changed: true });
    await mount(fakePort({ kind: 'thread', thread: thread(entries()) }));
    await act(async () => { fireEvent.click(control()[0]!); });
    await flush();
    expect(control()).toHaveLength(1);
    const line = screen.getByText(HANDLED_WORDS.refused);
    expect(line).toHaveAttribute('role', 'status');
    await act(async () => { fireEvent.click(control()[0]!); });
    await flush();
    expect(mark).toHaveBeenCalledTimes(2);
    expect(control()).toHaveLength(0);
  });
});

describe('the lines for replies that were not read, or are not kept', () => {
  it('a server below PR B (no replies part) says so once; a modern server with replies read says nothing', async () => {
    await mount(fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })], { replies: null }) }));
    expect(screen.getByText(NO_REPLIES_WORDS)).toBeInTheDocument();
    cleanup();
    await mount(fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })]) }));
    expect(screen.queryByText(NO_REPLIES_WORDS)).toBeNull();
    expect(screen.queryByText(REPLIES_UNMEASURED_WORDS)).toBeNull();
  });

  it('replies that could not be read draw their own line, never an empty conversation, and the messages still draw', async () => {
    const t = thread([divider(2, 1, 0, { current: true }), message(row(4, 5, { term: 2 }))], { replies: { kind: 'unmeasured', why: 'store-closed' } });
    await mount(fakePort({ kind: 'thread', thread: t }));
    expect(screen.getByText(REPLIES_UNMEASURED_WORDS)).toBeInTheDocument();
    expect(screen.getByText('fixture message 4')).toBeInTheDocument();
  });
});

describe('Show older: the thread\'s older pages', () => {
  const newest = (older: ChatOlder | null = C(5, 'end')): ChatThread => thread([
    // The newest page's first divider is at its oldest row's time: the server sends a divider only where its page reaches.
    divider(2, 1, 110, { current: true }), message(settled(5, 110, { term: 2 })), replyEntry(reply(6, 120)), message(settled(7, 130, { term: 2 })),
  ], { messages: { kind: 'read', value: { more: older !== null } }, older });
  const page = (entries: ChatEntry[], older: ChatOlder | null): ChatThreadRead =>
    ({ kind: 'thread', thread: thread(entries, { messages: { kind: 'read', value: { more: older !== null } }, older }) });
  const showOlder = (): HTMLElement | null => screen.queryByRole('button', { name: 'Show older' });
  const press = async (): Promise<void> => { await act(async () => { fireEvent.click(showOlder()!); }); await flush(); };
  const order = (...words: string[]): boolean => {
    const text = screen.getByRole('region', { name: 'Chat with the Overlord' }).textContent ?? '';
    const at = words.map((w) => text.indexOf(w));
    return at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]!));
  };

  it('is drawn above the oldest row when the thread says an older page is on record, and not otherwise; the old line is gone', async () => {
    await mount(fakePort({ kind: 'thread', thread: newest() }));
    expect(showOlder()).toBeInTheDocument();
    expect(screen.queryByText(OLDER_MESSAGES_WORDS)).toBeNull();
    expect(order('Show older', 'generation 1', 'fixture message 5')).toBe(true);
    cleanup();
    await mount(fakePort({ kind: 'thread', thread: newest(null) }));
    expect(showOlder()).toBeNull();
  });

  it('reads the page below the cursor, prepends it, and the next press asks with the page\'s own cursor; the last page offers no more', async () => {
    const port = fakePort({ kind: 'thread', thread: newest() });
    port.olders.push(
      page([message(settled(3, 60, { term: 2 })), replyEntry(reply(4, 70))], C(3, 4)),
      page([divider(1, 1, 0), message(settled(1, 20, { term: 2 }))], null),
    );
    await mount(port);
    await press();
    expect(port.threadArgs).toEqual([null, C(5, 'end')]);
    expect(order('fixture message 3', 'fixture reply 4', 'fixture message 5', 'fixture reply 6', 'fixture message 7')).toBe(true);
    expect(showOlder(), 'the page names a cursor: the control stays').toBeInTheDocument();
    await press();
    expect(port.threadArgs).toEqual([null, C(5, 'end'), C(3, 4)]);
    expect(order('generation 1', 'fixture message 1', 'fixture message 3', 'fixture message 5')).toBe(true);
    expect(showOlder()).toBeNull();
  });

  it('a press while a page is on its way does nothing more; the control is held, and says it is reading', async () => {
    const port = fakePort({ kind: 'thread', thread: newest() });
    let answer: (r: ChatThreadRead) => void = () => {};
    const base = port.thread;
    port.thread = (older) => (older === undefined || older === null ? base(older) : new Promise<ChatThreadRead>((r) => { answer = r; port.threadArgs.push(older); port.threadCalls += 1; }));
    await mount(port);
    fireEvent.click(showOlder()!);
    fireEvent.click(showOlder()!);
    await flush();
    expect(port.threadArgs.filter((a) => a !== null)).toHaveLength(1);
    expect(showOlder()).toBeDisabled();
    await act(async () => { answer(page([message(settled(3, 60, { term: 2 }))], null)); });
    await flush();
    expect(screen.getByText('fixture message 3')).toBeInTheDocument();
    expect(showOlder()).toBeNull();
  });

  it('a page that could not be read keeps everything drawn, says so in one quiet line, and the control stays for a retry', async () => {
    const port = fakePort({ kind: 'thread', thread: newest() });
    port.olders.push({ kind: 'refused', error: 'read-ceiling', retryAfterS: 30 }, { kind: 'no-answer' }, { kind: 'off-shape' }, page([message(settled(3, 60, { term: 2 }))], null));
    await mount(port);
    for (let i = 0; i < 3; i++) {
      await press();
      expect(screen.getByText(OLDER_PAGE_UNREACHABLE_WORDS)).toHaveAttribute('role', 'status');
      expect(screen.getAllByText(OLDER_PAGE_UNREACHABLE_WORDS)).toHaveLength(1);
      expect(showOlder(), 'the control stays').toBeEnabled();
      expect(screen.getByText('fixture message 7'), 'what was drawn stays').toBeInTheDocument();
    }
    await press();
    expect(screen.queryByText(OLDER_PAGE_UNREACHABLE_WORDS), 'a page read clears the line').toBeNull();
    expect(screen.getByText('fixture message 3')).toBeInTheDocument();
  });

  it('a page whose messages or replies could not be read is no page: the line, never an empty page', async () => {
    const port = fakePort({ kind: 'thread', thread: newest() });
    port.olders.push({ kind: 'thread', thread: thread([], { messages: { kind: 'unmeasured', why: 'closed' } }) },
      { kind: 'thread', thread: thread([], { replies: { kind: 'unmeasured', why: 'closed' } }) });
    await mount(port);
    await press();
    expect(screen.getByText(OLDER_PAGE_UNREACHABLE_WORDS)).toBeInTheDocument();
    await press();
    expect(screen.getByText(OLDER_PAGE_UNREACHABLE_WORDS)).toBeInTheDocument();
    expect(showOlder()).toBeInTheDocument();
  });

  it('a divider repeated by two pages is drawn once; an older divider is not drawn over nothing while an older page waits', async () => {
    // The newest page carries a stray divider older than its oldest row (a server below the divider floor): not drawn.
    const stray = thread([divider(1, 1, 0), divider(1, 2, 100, { current: true }), message(settled(5, 110, { term: 2 }))], { messages: { kind: 'read', value: { more: true } }, older: C(5, 'end') });
    const port = fakePort({ kind: 'thread', thread: stray });
    port.olders.push(page([divider(1, 1, 0), message(settled(3, 60, { term: 2 })), divider(1, 2, 100, { current: true })], null));
    await mount(port);
    expect(screen.queryByText('generation 1'), 'older than every row drawn, with an older page waiting').toBeNull();
    expect(screen.queryByText('generation 2'), 'this one too: the oldest row is later').toBeNull();
    await press();
    expect(screen.getAllByText('generation 1')).toHaveLength(1);
    expect(screen.getAllByText('generation 2'), 'a divider both pages carry is drawn once').toHaveLength(1);
    expect(order('generation 1', 'fixture message 3', 'generation 2', 'fixture message 5')).toBe(true);
  });

  it('a server below PR B (no older field, messages say more) still offers the control, and says it keeps no replies', async () => {
    const raw = {
      v: 1, designation: 'designated', sessionId: SID, term: 2,
      entries: [{ kind: 'divider', gen: { term: 2, n: 1 }, at: T0, current: true, newTerm: false, earlier: 'not-pageable' }, { kind: 'message', row: row(5, 10, { term: 2 }) }],
      messages: { kind: 'read', value: { more: true } }, generations: { kind: 'read', value: { count: 1 } }, readiness: { kind: 'read', value: { oldest: null } },
    };
    const parsed = readChatThread(raw);
    expect(parsed.ok).toBe(true);
    const port = fakePort({ kind: 'thread', thread: (parsed as { thread: ChatThread }).thread });
    port.olders.push(page([message(settled(3, 5, { term: 2 }))], null));
    await mount(port);
    expect(screen.getByText(NO_REPLIES_WORDS)).toBeInTheDocument();
    expect(screen.queryByText(OLDER_MESSAGES_WORDS)).toBeNull();
    await press();
    expect(port.threadArgs[1]).toEqual(C(5, 'end'));
    expect(screen.getByText('fixture message 3')).toBeInTheDocument();
  });

  it('more messages with no cursor to read them by keeps the old line, and no control', async () => {
    await mount(fakePort({ kind: 'thread', thread: thread([divider(2, 1, 0, { current: true })], { messages: { kind: 'read', value: { more: true } }, older: null }) }));
    expect(screen.getByText(OLDER_MESSAGES_WORDS)).toBeInTheDocument();
    expect(showOlder()).toBeNull();
  });

  it('the refresh of the newest page keeps the older pages drawn, and a row it read again shows its new ticks', async () => {
    vi.useFakeTimers({ now: T0 + 135_000 });
    const waiting = (): ChatThread => thread([divider(2, 1, 120, { current: true }), message(row(5, 120, { term: 2 }))], { messages: { kind: 'read', value: { more: true } }, older: C(5, 'end') });
    const port = fakePort({ kind: 'thread', thread: waiting() });
    port.olders.push(page([message(settled(3, 60, { term: 2 }))], null));
    port.threads.push({ kind: 'thread', thread: thread([divider(2, 1, 120, { current: true }), message(settled(5, 120, { term: 2 }))], { messages: { kind: 'read', value: { more: true } }, older: C(5, 'end') }) });
    await mount(port);
    await press();
    expect(screen.getByText('fixture message 3')).toBeInTheDocument();
    expect(screen.getByLabelText('recorded, queued')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(port.threadArgs.filter((a) => a === null).length, 'the newest page was read again').toBeGreaterThanOrEqual(2);
    expect(screen.getByText('fixture message 3'), 'the older page is kept').toBeInTheDocument();
    expect(screen.getAllByLabelText('recorded, delivered, picked up, settled'), 'the row read again shows its new ticks: both messages are settled now').toHaveLength(2);
    expect(screen.queryByLabelText('recorded, queued')).toBeNull();
    expect(showOlder(), 'the older page was read: no more').toBeNull();
  });

  it('a reply an earlier generation\'s page already drew is not drawn twice', async () => {
    const t = thread([divider(1, 1, 0, { readable: true }), divider(2, 1, 20, { newTerm: true, current: true }), replyEntry(reply(6, 5, { entryUuid: 'aaaaaaaa-0000-4000-8000-000000000001', text: 'the recorded words' }))]);
    const port = fakePort({ kind: 'thread', thread: t });
    port.earliers.push({ ok: true, gen: { term: 1, n: 1 }, page: { outcome: 'rows', exit: 0, items: [
      { kind: 'entry', role: 'assistant', text: 'the history copy', trust: 'untrusted', uuid: 'aaaaaaaa-0000-4000-8000-000000000001' } as never,
    ], shown: 1, total: 1, scope: { kind: 'overlord', id: `session:${SID}`, project: null, families: [], families_total: 0, transcripts: 1 } } });
    await mount(port);
    expect(screen.getAllByText('the recorded words')).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show generation 1' })); });
    await flush();
    expect(screen.getAllByText('the recorded words'), 'once, in the earlier page, not again in the thread').toHaveLength(1);
    expect(screen.queryByText('the history copy')).toBeNull();
  });
});

describe('a read refused by the ceiling with no retry time, or an absurd one (ruling 8)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 + 60_000 }); });
  const tick = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const quiet = (): ChatThread => thread([divider(2, 1, 0, { current: true }), message(settled(3, 5))]);

  it('with no retry time the next read waits a minute, not none', async () => {
    const port = fakePort({ kind: 'thread', thread: quiet() });
    port.threads.push({ kind: 'refused', error: 'read-ceiling' }, { kind: 'thread', thread: quiet() });
    let push: (m: SessionStreamMsg) => void = () => {};
    await mount(port, [], (f) => { push = f; return () => {}; });
    await tick(20_000);
    act(() => { push({ type: 'events', uuid: 'u', events: [user('u9', 80, 'a turn')], offset: 0 }); });
    await tick(0);
    expect(port.threadCalls).toBe(2);
    await tick(59_000);
    expect(port.threadCalls, 'not before the default wait').toBe(2);
    await tick(1_000);
    expect(port.threadCalls).toBe(3);
  });

  it('a retry time past a timer\'s limit waits an hour, not a loop of instant reads', async () => {
    const port = fakePort({ kind: 'refused', error: 'read-ceiling', retryAfterS: 2 ** 31 });
    port.threads.push({ kind: 'thread', thread: quiet() });
    await mount(port);
    expect(port.threadCalls).toBe(1);
    await tick(3_599_000);
    expect(port.threadCalls, 'nothing before the hour').toBe(1);
    await tick(1_000);
    expect(port.threadCalls).toBe(2);
    await tick(120_000);
    expect(port.threadCalls).toBe(2);
  });
});
