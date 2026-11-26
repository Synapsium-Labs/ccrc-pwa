// The chat part of the Overlord place (Overlord W1, the chat, Task 4; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-chat.md`): what it draws, the kept draft, the toggle, the earlier page and the coalesced refresh, over a fake port.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { isSendKey, operatorMessageNudgeLine, type OperatorMessageRow } from '../../shared/operatorMessages';
import { chatTicksOf, type ChatEntry, type ChatSendAnswer, type ChatThread } from '../../shared/overlordChat';
import { OverlordChat } from '../src/overlord/OverlordChat';
import {
  EARLIER_UNREACHABLE_WORDS, GENERATIONS_UNMEASURED_WORDS, MESSAGES_UNMEASURED_WORDS, NO_OVERLORD_WORDS, PANE_TURN_WORDS,
  READ_CEILING_WORDS,
} from '../src/overlord/chatWords';
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
  readiness: { kind: 'read', value: { oldest: null } }, ...over,
});
const iso = (s: number): string => new Date(T0 + s * 1000).toISOString();
const user = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'user', uuid, ts: iso(s), text });
const assistant = (uuid: string, s: number, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: iso(s), text });

interface Fake extends OverlordChatPort {
  threads: ChatThreadRead[];
  sends: ChatSendAnswer[];
  earliers: ChatEarlierRead[];
  threadCalls: number;
  sendCalls: { sessionId: string; text: string; opts: ChatSendOpts }[];
  earlierCalls: { term: number; n: number; around: string | null }[];
}
/** A port answering from queues; the last thread answer repeats. */
function fakePort(first: ChatThreadRead): Fake {
  const f: Fake = {
    threads: [first], sends: [], earliers: [], threadCalls: 0, sendCalls: [], earlierCalls: [],
    thread: async () => { f.threadCalls += 1; return f.threads.length > 1 ? f.threads.shift()! : f.threads[0]!; },
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
      readiness: { kind: 'read', value: { oldest: null } },
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
    await tick(10_000);
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
