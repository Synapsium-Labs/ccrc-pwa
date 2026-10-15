// M4.B3, the per-item chat boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's
// refinements (j) and (m)). `ChatList.tsx`'s `ChatItemView` wraps every item in a `RenderBoundary`, so one item that
// throws while rendering costs that item alone: a message falls back to its raw text in `<pre className="msg-plain">`
// followed by "This message could not render; shown as plain text.", any other item to "This item could not be
// shown.". The key is the message text for a message (a streaming message that throws on one chunk is tried again on
// the next) and the item key for every other kind. `ChatListInner` and the virtualised `ChatList` share
// `ChatItemView`, so this one mount covers both; the cases render `ChatListInner` (Virtuoso cannot measure in jsdom).
//
// `MessageBubble` is the real one except for a text carrying THROW_MARK; `ToolCard` (from @ccrc/ui) always throws.
// Both mocks are per-file, which is why this is its own file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';

const THROW_MARK = 'THROW';

vi.mock('../src/session/MessageBubble', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/session/MessageBubble')>();
  return {
    ...actual,
    MessageBubble: (props: ComponentProps<typeof actual.MessageBubble>): ReactNode => {
      if (props.event.text.includes('THROW')) throw new Error('bubble broke');
      return <actual.MessageBubble {...props} />;
    },
  };
});

// ToolCard lives in @ccrc/ui now, so the mock moved with it — a PARTIAL mock via `importOriginal`, because ChatList
// takes MailCard, TaskCard and PROSE from the same package and RenderBoundary its Button: a wholesale factory would
// blank all of them, and a mock of the old path would be inert (ToolCard would never throw).
vi.mock('@ccrc/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ccrc/ui')>();
  return {
    ...actual,
    ToolCard: (): never => {
      throw new Error('tool card broke');
    },
  };
});

const { ChatListInner } = await import('../src/session/ChatList');

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports every error a boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
  error.mockRestore();
});

const TS = '2026-07-20T10:00:00.000Z';
const assistant = (uuid: string, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text });
const toolUse = (uuid: string, toolId: string): ChatEvent =>
  ({ kind: 'tool_use', uuid, ts: TS, toolId, name: 'Bash', input: 'ls' });

const MIDDLE = `${THROW_MARK} in the middle **of** three`;
const NOTE = 'This message could not render; shown as plain text.';

const three = (middle: string): ChatEvent[] => [
  assistant('a1', 'first answer'),
  assistant('a2', middle),
  assistant('a3', 'third answer'),
];

describe('the per-item chat boundary (M4.B3)', () => {
  it('the middle of three messages throws: items 1 and 3 render, item 2 shows its raw text and the note', () => {
    render(<ChatListInner id="demo" events={three(MIDDLE)} pending={[]} />);
    const first = screen.getByText('first answer');
    const third = screen.getByText('third answer');
    const plain = document.querySelector('pre.msg-plain') as HTMLElement;
    expect(plain).not.toBeNull();
    expect(plain.textContent).toBe(MIDDLE);
    const note = screen.getByText(NOTE);
    expect(note).toHaveClass('msg-plain-note');
    // Document order: item 1, then the raw text, then its note, then item 3.
    expect(first.compareDocumentPosition(plain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in chat item', expect.objectContaining({ message: 'bubble broke' }));
  });

  it('the fallback sits in the failed item, not in place of the list', () => {
    render(<ChatListInner id="demo" events={three(MIDDLE)} pending={[]} />);
    const items = [...document.querySelectorAll('.chat-item')];
    const holder = items.find((el) => el.querySelector('pre.msg-plain') !== null);
    expect(holder).toBeDefined();
    expect(holder?.textContent).not.toContain('first answer');
    expect(holder?.textContent).not.toContain('third answer');
  });

  it('a new text for the failed item resets it: the key is the message text', () => {
    const { rerender } = render(<ChatListInner id="demo" events={three(MIDDLE)} pending={[]} />);
    expect(document.querySelector('pre.msg-plain')).not.toBeNull();
    rerender(<ChatListInner id="demo" events={three('second answer, streamed on')} pending={[]} />);
    expect(screen.getByText('second answer, streamed on')).toBeInTheDocument();
    expect(document.querySelector('pre.msg-plain')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('any other kind of item that throws shows "This item could not be shown." and the messages beside it still render', () => {
    render(
      <ChatListInner
        id="demo"
        events={[assistant('a1', 'first answer'), toolUse('a2', 't1'), assistant('a3', 'third answer')]}
        pending={[]}
      />,
    );
    expect(screen.getByText('This item could not be shown.')).toBeInTheDocument();
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getByText('third answer')).toBeInTheDocument();
    expect(document.querySelector('pre.msg-plain')).toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in chat item', expect.objectContaining({ message: 'tool card broke' }));
  });
});

// The virtualised path. Virtuoso cannot measure in jsdom, so it is stood in for by a plain list that calls
// `itemContent` for every index (as chat.test.tsx does); the stand-in is hoisted over the whole file and only
// `ChatList` (never `ChatListInner`) renders through it.
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
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)),
        ),
      ),
  };
});

describe('T11 review 4-1: the per-item boundary holds on the virtualised ChatList', () => {
  it('a throwing item inside ChatList stays inside its own item: the outer boundary never shows', async () => {
    const { ChatList } = await import('../src/session/ChatList');
    const { RenderBoundary } = await import('../src/components/RenderBoundary');
    render(
      <RenderBoundary where="outer" resetKey="outer" fallback={() => <p>OUTER FALLBACK</p>}>
        <ChatList
          id="demo"
          events={[assistant('a1', 'first answer'), toolUse('a2', 't1'), assistant('a3', 'third answer')]}
          pending={[]}
        />
      </RenderBoundary>,
    );
    expect(screen.queryByText('OUTER FALLBACK')).toBeNull();
    expect(screen.getByTestId('virtuoso')).toBeInTheDocument();
    expect(screen.getByText('This item could not be shown.')).toBeInTheDocument();
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getByText('third answer')).toBeInTheDocument();
  });

  it('a message that throws inside ChatList falls back to its raw text and the note, beside its neighbours', async () => {
    const { ChatList } = await import('../src/session/ChatList');
    render(<ChatList id="demo" events={three(MIDDLE)} pending={[]} />);
    const plain = document.querySelector('pre.msg-plain') as HTMLElement;
    expect(plain).not.toBeNull();
    expect(plain.textContent).toBe(MIDDLE);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getByText('third answer')).toBeInTheDocument();
  });
});
