// The chat's rows are memoised (desktop polish Task C7). A session screen renders again for many reasons that change no
// row: a roster answer, a status word, the composer. Before C7 every such render re-ran react-markdown and highlight.js
// for every mounted message. These cases pin the barriers that stop it: one row barrier in `MeasuredItem` (the item
// compared by `sameTranscriptItem`, every other prop by identity), `MessageBubble` and `ChatMarkdown` memoised, and
// SessionScreen's three row callbacks stable.
//
// Counts come from stand-ins (`vi.mock`, the real module spread, one export wrapped): `ChatMarkdown` counts each time a
// bubble asks for its markdown, `ToolCard` each time a tool row draws, `prescanMarkdown` each time the synchronous
// markdown path runs, and `HistoryTab` (an always-mounted child with no store subscription of its own, as
// `render-fanout.test.tsx` uses it) each time SessionScreen renders. `react-virtuoso` is a plain list, as in
// `chat.test.tsx`. Every count case first asserts that its counter fired at mount and its DOM is present, so a
// never-mounted stand-in cannot read as "no re-render".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChatEvent } from '../../shared/api';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';

const counts = vi.hoisted(() => ({ markdown: 0, toolCard: 0, prescan: 0, screen: 0 }));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: {
      totalCount: number;
      itemContent: (i: number) => ReactNode;
      computeItemKey?: (i: number) => string | number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i))),
      ),
  };
});
vi.mock('../src/lib/markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/markdown')>();
  const { createElement } = await import('react');
  return {
    ...real,
    ChatMarkdown: (props: Parameters<typeof real.ChatMarkdown>[0]) => {
      counts.markdown += 1;
      return createElement(real.ChatMarkdown, props);
    },
  };
});
vi.mock('../src/lib/markdownGuard', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/markdownGuard')>();
  return {
    ...real,
    prescanMarkdown: (...args: Parameters<typeof real.prescanMarkdown>) => {
      counts.prescan += 1;
      return real.prescanMarkdown(...args);
    },
  };
});
vi.mock('@ccrc/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ccrc/ui')>();
  const { createElement } = await import('react');
  return {
    ...real,
    ToolCard: (props: Parameters<typeof real.ToolCard>[0]) => {
      counts.toolCard += 1;
      return createElement(real.ToolCard, props);
    },
  };
});
vi.mock('../src/session/HistoryTab', () => ({
  HistoryTab: () => {
    counts.screen += 1;
    return null;
  },
}));

const { ChatList } = await import('../src/session/ChatList');
const { MessageBubble } = await import('../src/session/MessageBubble');
const { ChatMarkdown } = await import('../src/lib/markdown');
const { SessionScreen } = await import('../src/screens/SessionScreen');
const { createSessionStore } = await import('../src/stores/session');
const { useFleetStore } = await import('../src/stores/fleet');

const TS = '2026-10-28T10:00:00.000Z';
const TS_TEXT = [
  'The helper:',
  '',
  '```ts',
  'export function pick(items: readonly string[]): string | null {',
  '  return items.length === 0 ? null : items[0] ?? null;',
  '}',
  '```',
].join('\n');
const assistant = (uuid: string, text = TS_TEXT): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text });
const mailTurn: ChatEvent = {
  kind: 'user', uuid: 'm1', ts: TS, text: [
    '```' + MAIL_ENVELOPE_FENCE, 'id: 17', 'from: coordinator', 'to: worker-a', 'kind: status', 'subject: wave-brief',
    'ack: ccrc-api mail ack 17 (a delivery id).', '  Ack it promptly.', '--', 'Implement Tasks 1-3 in order.', '```',
  ].join('\n'),
};
/** A TypeScript block, a Bash call with its result, and a mail item. */
const EVENTS: ChatEvent[] = [
  assistant('a1'),
  { kind: 'tool_use', uuid: 'u1', ts: TS, toolId: 't1', name: 'Bash', input: '{"command":"npm run check"}' },
  { kind: 'tool_result', ts: TS, toolId: 't1', text: 'checked: 12 passed', isError: false },
  mailTurn,
];

const reset = (): void => {
  counts.markdown = 0;
  counts.toolCard = 0;
  counts.prescan = 0;
  counts.screen = 0;
};

beforeEach(reset);
afterEach(() => {
  cleanup();
  act(() => useFleetStore.setState({ roster: [] }));
  vi.restoreAllMocks();
});

/** Stable row callbacks, as SessionScreen's are. */
const onRetry = (): void => {};
const onDiscard = (): void => {};
const onAnswer = (): void => {};
const list = (events: ChatEvent[]) => (
  <ChatList id="s" events={events} pending={[]} onRetry={onRetry} onDiscard={onDiscard} onAnswer={onAnswer} />
);

/** Mount the list and prove the stand-ins fired and the rows are drawn. */
function mountList(events: ChatEvent[] = EVENTS): ReturnType<typeof render> {
  const r = render(list(events));
  expect(counts.markdown).toBeGreaterThan(0);
  expect(counts.toolCard).toBeGreaterThan(0);
  expect(document.querySelector('.code-block')).not.toBeNull();
  expect(document.querySelector('.mail-card')).not.toBeNull();
  reset();
  return r;
}

describe('a re-render with unchanged rows does no row work (C7)', () => {
  it('a parent re-render with unchanged items renders no MessageBubble', () => {
    const { rerender } = mountList();
    rerender(list(EVENTS));
    expect(counts.markdown).toBe(0);
  });

  it('a parent re-render with unchanged items renders no transcript row', () => {
    const { rerender } = mountList();
    rerender(list(EVENTS));
    expect(counts.toolCard).toBe(0);
  });

  it('an events frame that appends one message renders only the new row', () => {
    const { rerender } = mountList();
    // A new array, as `dedupeAppend` makes one: the events already held keep their identity, so `buildChatItems`
    // builds every item again over the same events.
    rerender(list([...EVENTS, assistant('a2', 'And one more thing.')]));
    expect(counts.markdown).toBe(1);
    expect(counts.toolCard).toBe(0);
    expect(document.body.textContent).toContain('And one more thing.');
  });

  it('MessageBubble with the same props renders no markdown', () => {
    const event = assistant('a1') as Extract<ChatEvent, { kind: 'assistant' }>;
    const { rerender } = render(<MessageBubble event={event} id="s" />);
    expect(counts.markdown).toBe(1);
    expect(document.querySelector('.code-block')).not.toBeNull();
    reset();
    rerender(<MessageBubble event={event} id="s" />);
    expect(counts.markdown).toBe(0);
  });

  it('ChatMarkdown with the same text pre-scans once', () => {
    const { rerender } = render(<ChatMarkdown text={TS_TEXT} />);
    expect(counts.prescan).toBe(1);
    expect(document.querySelector('.code-block')).not.toBeNull();
    rerender(<ChatMarkdown text={TS_TEXT} />);
    expect(counts.prescan).toBe(1);
  });

  it('a roster change re-renders SessionScreen and no transcript row', () => {
    const store = createSessionStore('s', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    render(<SessionScreen id="s" store={store} />);
    act(() => { store.setState({ uuid: 'u1', status: 'idle', events: EVENTS }); });
    expect(counts.screen).toBeGreaterThan(0);
    expect(counts.toolCard).toBeGreaterThan(0);
    expect(counts.markdown).toBeGreaterThan(0);
    expect(document.querySelector('.code-block')).not.toBeNull();
    reset();
    act(() => { useFleetStore.setState({ roster: [{ id: 'lane-a', label: 'Lane A', hue: 'acct-1', homeAble: true } as never] }); });
    expect(counts.screen).toBeGreaterThan(0);
    expect(counts.toolCard).toBe(0);
    expect(counts.markdown).toBe(0);
  });
});
